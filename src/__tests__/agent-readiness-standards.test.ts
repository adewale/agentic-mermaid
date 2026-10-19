import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { BROWSER_CONTRACT_FILES } from '../../e2e/browser-contract-files.ts'
import { QUALITY_CHECKS } from '../../scripts/ci/quality-gates.ts'
import { ensureWebsiteBuilt } from './website-public-fixture.ts'

ensureWebsiteBuilt()

const REPO = join(import.meta.dir, '..', '..')
const SITE = join(REPO, 'website', 'public')

function read(rel: string) {
  return readFileSync(join(SITE, rel), 'utf8')
}

function readJson(rel: string) {
  return JSON.parse(read(rel))
}

function htmlJsonLd(html: string) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]!))
}

function graphNodes(doc: any) {
  return Array.isArray(doc['@graph']) ? doc['@graph'] : [doc]
}

function h2Sections(markdown: string) {
  const matches = [...markdown.matchAll(/^##\s+(.+)$/gm)]
  return matches.map((match, index) => {
    const next = matches[index + 1]
    return {
      title: match[1]!,
      body: markdown.slice(match.index! + match[0].length, next?.index ?? markdown.length).trim(),
    }
  })
}

function expectAbsoluteHttps(url: unknown) {
  expect(typeof url).toBe('string')
  expect(() => new URL(String(url))).not.toThrow()
  expect(String(url)).toStartWith('https://')
}

interface WorkflowStep { name?: string; id?: string; if?: string; uses?: string; run?: string; env?: Record<string, unknown>; with?: Record<string, unknown>; 'working-directory'?: string }
interface WorkflowJob { needs?: string | string[]; if?: string; permissions?: string | Record<string, string>; strategy?: { matrix?: Record<string, unknown[]> }; steps?: WorkflowStep[] }
interface Workflow { on?: Record<string, unknown>; permissions?: string | Record<string, string>; concurrency?: unknown; jobs: Record<string, WorkflowJob> }

const WORKFLOWS_DIR = join(REPO, '.github', 'workflows')
const PACKAGE_SCRIPTS = (JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts

function loadWorkflow(file: string): Workflow {
  return parseYaml(readFileSync(join(WORKFLOWS_DIR, file), 'utf8')) as Workflow
}

const WORKFLOW_FILES = readdirSync(WORKFLOWS_DIR).filter(file => /\.ya?ml$/.test(file))

function needsOf(job: WorkflowJob): string[] {
  return job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs]
}

/** Every job `id` waits for, directly or through another job. */
function upstreamOf(jobs: Record<string, WorkflowJob>, id: string): Set<string> {
  const seen = new Set<string>()
  const pending = [...needsOf(jobs[id]!)]
  while (pending.length > 0) {
    const next = pending.pop()!
    if (seen.has(next)) continue
    seen.add(next)
    pending.push(...needsOf(jobs[next]!))
  }
  return seen
}

function runsOf(job: WorkflowJob): string[] {
  return (job.steps ?? []).flatMap(step => step.run === undefined ? [] : [step.run])
}

/** `bun run <target>` targets, where a target is a package script or a file. */
function bunRunTargets(run: string): string[] {
  return [...run.matchAll(/\bbun run ([^\s;&|)]+)/g)].map(match => match[1]!)
}

function grantsWrite(permissions: WorkflowJob['permissions']): boolean {
  if (typeof permissions === 'string') return permissions === 'write-all'
  return Object.values(permissions ?? {}).includes('write')
}

function holdsOidc(job: WorkflowJob): boolean {
  return typeof job.permissions === 'object' && job.permissions['id-token'] === 'write'
}

const NEEDS_RESULT = /^\$\{\{\s*needs(?:\.([\w-]+)|\[['"]([\w-]+)['"]\])\.result\s*\}\}$/

describe('agent-readiness standards syntax', () => {
  test('release attestation gates every job, and OIDC is minted only after it without repository code', () => {
    const publish = loadWorkflow('publish.yml')
    const ids = Object.keys(publish.jobs)
    const roots = ids.filter(id => needsOf(publish.jobs[id]!).length === 0)
    expect(roots).toHaveLength(1)
    const root = roots[0]!
    for (const id of ids.filter(other => other !== root)) {
      expect({ job: id, gatedByAttestation: upstreamOf(publish.jobs, id).has(root) }).toEqual({ job: id, gatedByAttestation: true })
    }
    // The attestation and packing scripts are exercised directly by
    // release-identity.test.ts and verify-publish-package.test.ts; the
    // attestation's CI query by release-publish-steps.test.ts.
    expect(runsOf(publish.jobs[root]!).some(run => run.includes('scripts/ci/release-identity.ts'))).toBe(true)
    const uploaders = ids.filter(id => (publish.jobs[id]!.steps ?? []).some(step => step.uses?.startsWith('actions/upload-artifact@')))
    expect(uploaders.length).toBeGreaterThan(0)
    for (const id of uploaders) {
      expect({ job: id, verifiesPack: runsOf(publish.jobs[id]!).some(run => run.includes('scripts/ci/verify-publish-package.ts')) })
        .toEqual({ job: id, verifiesPack: true })
    }

    expect(ids.filter(id => holdsOidc(publish.jobs[id]!)).length).toBeGreaterThan(0)
    for (const file of WORKFLOW_FILES) {
      const workflow = loadWorkflow(file)
      // OIDC is never granted at workflow scope, where every job inherits it.
      const workflowScope = workflow.permissions
      const workflowOidc = workflowScope === 'write-all' || (typeof workflowScope === 'object' && workflowScope['id-token'] === 'write')
      expect({ file, workflowOidc }).toEqual({ file, workflowOidc: false })
      const jobIds = Object.keys(workflow.jobs)
      for (const id of jobIds.filter(candidate => holdsOidc(workflow.jobs[candidate]!))) {
        const job = workflow.jobs[id]!
        expect({ file, job: id, checksOut: (job.steps ?? []).some(step => step.uses?.startsWith('actions/checkout@')) })
          .toEqual({ file, job: id, checksOut: false })
        const upstream = upstreamOf(workflow.jobs, id)
        const unprivileged = jobIds.filter(other => !holdsOidc(workflow.jobs[other]!))
        expect({ file, job: id, notYetFinished: unprivileged.filter(other => !upstream.has(other)) })
          .toEqual({ file, job: id, notYetFinished: [] })
      }
    }
  })

  test('privileged and release jobs never interpolate expressions into shell or install mutable tools', () => {
    const npmPins = new Set<string>()
    for (const file of WORKFLOW_FILES) {
      const workflow = loadWorkflow(file)
      const release = workflow.on !== undefined && Object.hasOwn(workflow.on, 'release')
      for (const [id, job] of Object.entries(workflow.jobs)) {
        const privileged = release || grantsWrite(job.permissions ?? workflow.permissions)
        for (const step of job.steps ?? []) {
          if (step.run === undefined) continue
          for (const match of step.run.matchAll(/\bnpm install -g npm@(\S+)/g)) npmPins.add(match[1]!)
          if (!privileged) continue
          // `${{ }}` inside run: is spliced into the script before bash parses
          // it; privileged steps must pass values through env: instead.
          expect({ file, job: id, step: step.name, interpolates: step.run.includes('${{') })
            .toEqual({ file, job: id, step: step.name, interpolates: false })
          expect({ file, job: id, step: step.name, installsLatest: /@latest\b/.test(step.run) })
            .toEqual({ file, job: id, step: step.name, installsLatest: false })
        }
      }
    }
    // CI verifies the reviewed file manifest with the npm that release packs with.
    expect(npmPins.size).toBe(1)
    expect([...npmPins][0]).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test('llms.txt follows the published parser-compatible Markdown shape', () => {
    const text = read('llms.txt')
    const lines = text.split(/\r?\n/)
    expect(lines[0]).toBe('# Agentic Mermaid')
    expect(lines[1]).toBe('')
    expect(lines[2]).toStartWith('> ')
    expect(lines.filter((line) => line.trim()).length).toBeGreaterThanOrEqual(5)

    const sections = h2Sections(text)
    expect(sections.map((section) => section.title)).toEqual(['Start Here', 'Optional'])
    for (const section of sections) {
      const items = section.body.split(/\n+/).filter((line) => line.trim())
      expect(items.length).toBeGreaterThan(0)
      for (const item of items) {
        expect({ section: section.title, item, ok: /^-\s+\[[^\]]+\]\(https:\/\/[^)]+\)(?::\s+.+)?$/.test(item) })
          .toEqual({ section: section.title, item, ok: true })
      }
    }

    expect(read('llms.md')).toBe(text)
    expect(read('.well-known/llms.txt')).toBe(text)
  })

  test('homepage JSON-LD is parseable and uses schema.org node types we claim', () => {
    const docs = htmlJsonLd(read('index.html'))
    expect(docs.length).toBeGreaterThanOrEqual(1)
    for (const doc of docs) expect(doc['@context']).toBe('https://schema.org')

    const nodes = docs.flatMap(graphNodes)
    const byType = new Map(nodes.map((node: any) => [node['@type'], node]))
    expect([...byType.keys()]).toEqual(expect.arrayContaining(['Organization', 'WebSite', 'SoftwareApplication', 'Service', 'WebPage']))

    const organization = byType.get('Organization') as any
    expect(organization.contactPoint['@type']).toBe('ContactPoint')
    expectAbsoluteHttps(organization.contactPoint.url)
    expect(organization.address['@type']).toBe('PostalAddress')
    expect(organization.address.addressCountry).toBe('US')

    const app = byType.get('SoftwareApplication') as any
    expect(app.applicationCategory).toBe('DeveloperApplication')
    expect(typeof app.operatingSystem).toBe('string')
    expect(app.operatingSystem.length).toBeGreaterThan(0)
    expect(Array.isArray(app.featureList)).toBe(true)
    expect(app.offers['@type']).toBe('Offer')

    const service = byType.get('Service') as any
    expect(service.provider['@id']).toBe(organization['@id'])
    expect(service.serviceType).toContain('Model Context Protocol')

    const page = byType.get('WebPage') as any
    expect(page.speakable['@type']).toBe('SpeakableSpecification')
    expect(page.speakable.cssSelector).toEqual(expect.arrayContaining(['h1']))

    // FAQPage markup is scoped to /about/, where the FAQ content is visible.
    expect([...byType.keys()]).not.toContain('FAQPage')
    const aboutNodes = htmlJsonLd(read('about/index.html')).flatMap(graphNodes)
    const faq = aboutNodes.find((node: any) => node['@type'] === 'FAQPage') as any
    expect(Boolean(faq)).toBe(true)
    expect(faq.mainEntity.every((entry: any) => entry['@type'] === 'Question' && entry.acceptedAnswer['@type'] === 'Answer')).toBe(true)
  })

  test('MCP discovery manifests expose MCP-shaped tools and Ora-style discovery records', () => {
    const card = readJson('.well-known/mcp/server-card.json')
    const manifest = readJson('.well-known/mcp.json')
    const catalog = readJson('.well-known/ai-catalog.json')

    expect(card).toEqual(expect.objectContaining({
      // The hosted transport identifies itself distinctly from the local stdio
      // server (different tool sets must not share a cached identity).
      name: 'agentic-mermaid-hosted',
      kind: 'product',
      transport: 'streamable-http',
      capabilities: { tools: true, resources: true },
    }))
    expectAbsoluteHttps(card.url)
    expectAbsoluteHttps(card.serverUrl)
    expectAbsoluteHttps(card.wellKnownUrl)
    expect(card.wellKnownUrl).toBe('https://agentic-mermaid.dev/.well-known/mcp')
    expect(card.protocolVersions).toEqual(expect.arrayContaining(['2025-06-18']))

    expect(manifest.serverUrl).toBe(card.serverUrl)
    expect(manifest.transport).toBe(card.transport)
    expect(manifest.tools.map((tool: any) => tool.name)).toEqual(card.tools.map((tool: any) => tool.name))
    expect(manifest.tools.map((tool: any) => tool.title)).toEqual(card.tools.map((tool: any) => tool.title))

    for (const tool of card.tools) {
      expect(typeof tool.name).toBe('string')
      expect(typeof tool.title).toBe('string')
      expect(tool.title.trim().length).toBeGreaterThan(0)
      expect(typeof tool.description).toBe('string')
      expect(tool.inputSchema).toEqual(expect.objectContaining({ type: 'object' }))
      expect(typeof tool.inputSchema.properties).toBe('object')
      expect(Array.isArray(tool.inputSchema.required ?? [])).toBe(true)
      expect(tool.parameters && typeof tool.parameters).toBe('object')
      expect(tool.annotations).toEqual(expect.objectContaining({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: expect.any(Boolean),
        openWorldHint: false,
      }))
    }

    expect(catalog.specVersion).toBe('1.0')
    expect(catalog.host).toEqual(expect.objectContaining({
      displayName: 'Agentic Mermaid',
      identifier: 'did:web:agentic-mermaid.dev',
    }))
    expectAbsoluteHttps(catalog.host.documentationUrl)
    const mcpEntry = catalog.entries.find((entry: any) => entry.type === 'application/mcp-server-card+json')
    expect(mcpEntry).toEqual(expect.objectContaining({
      identifier: 'urn:air:agentic-mermaid.dev:mcp:agentic-mermaid',
      url: 'https://agentic-mermaid.dev/.well-known/mcp/server-card.json',
    }))
    expect(mcpEntry.capabilities).toEqual(card.tools.map((tool: any) => tool.name))
  })

  test('the committed llms.txt names the published package version', () => {
    const packageJson = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
    expect(readFileSync(join(REPO, 'llms.txt'), 'utf8')).toContain(`\nVersion: ${packageJson.version}\n`)
  })

  test('official MCP Registry metadata matches the npm package and hosted server', () => {
    const packageJson = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
    const registry = JSON.parse(readFileSync(join(REPO, 'server.json'), 'utf8'))
    const publish = loadWorkflow('publish.yml')

    expect(registry.$schema).toBe('https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json')
    expect(registry.name).toBe('io.github.adewale/agentic-mermaid')
    expect(packageJson.mcpName).toBe(registry.name)
    expect(registry.version).toBe(packageJson.version)
    expect(registry.description.length).toBeLessThanOrEqual(100)
    expect(registry.repository).toEqual({
      url: 'https://github.com/adewale/agentic-mermaid',
      source: 'github',
    })
    expect(registry.packages).toEqual([{
      registryType: 'npm',
      identifier: packageJson.name,
      version: packageJson.version,
      runtimeHint: 'npx',
      runtimeArguments: [{ type: 'positional', value: '-y' }],
      packageArguments: [{ type: 'positional', value: 'mcp' }],
      transport: { type: 'stdio' },
    }])
    expect(registry.remotes).toEqual([{
      type: 'streamable-http',
      url: 'https://agentic-mermaid.dev/mcp',
    }])
    // The Registry validates the npm package it points at, so metadata is
    // published only after npm publication. The publisher's pinned digest and
    // login/publish sequence are executed in release-publish-steps.test.ts and
    // mcp-publish-recovery.test.ts; server.json shipping in the tarball is a
    // required file of scripts/ci/verify-publish-package.ts.
    const publishingJobs = (pattern: RegExp) => Object.keys(publish.jobs).filter(id => runsOf(publish.jobs[id]!).some(run => pattern.test(run)))
    const npmPublishers = publishingJobs(/\bnpm publish\b/)
    const registryPublishers = publishingJobs(/\bmcp-publisher publish\b/)
    expect({ npm: npmPublishers.length, registry: registryPublishers.length }).toEqual({ npm: 1, registry: 1 })
    expect(upstreamOf(publish.jobs, registryPublishers[0]!).has(npmPublishers[0]!)).toBe(true)

    const packageBin = spawnSync('bun', ['run', join(REPO, 'bin/am.ts'), 'mcp', '--help'], { encoding: 'utf8' })
    expect({ status: packageBin.status, stderr: packageBin.stderr }).toEqual({ status: 0, stderr: '' })
    expect(packageBin.stdout).toContain('agentic-mermaid-mcp [--transport stdio|http]')
  })
})
