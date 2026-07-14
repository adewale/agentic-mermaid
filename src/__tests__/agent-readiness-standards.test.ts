import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

describe('agent-readiness standards syntax', () => {
  test('local, CI, and release gates share one bounded covered-suite command', () => {
    const packageJson = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
    const ciWorkflow = readFileSync(join(REPO, '.github/workflows/ci.yml'), 'utf8')
    const publishWorkflow = readFileSync(join(REPO, '.github/workflows/publish.yml'), 'utf8')
    const strategy = readFileSync(join(REPO, 'docs/testing-strategy.md'), 'utf8')
    const pullRequestTemplate = readFileSync(join(REPO, '.github/PULL_REQUEST_TEMPLATE.md'), 'utf8')
    const agentGuide = readFileSync(join(REPO, 'CLAUDE.md'), 'utf8')

    expect(packageJson.scripts.test).toBe('bun test --coverage --timeout 30000 src/__tests__/')
    expect(ciWorkflow.match(/run: bun run test/g)?.length).toBe(1)
    expect(publishWorkflow.match(/run: bun run test/g)?.length).toBe(1)
    expect(strategy).toContain('`bun run test`')
    expect(pullRequestTemplate).toContain('`bun run test`')
    expect(agentGuide).toContain('`bun run test`')
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
      capabilities: { tools: true, resources: false },
    }))
    expectAbsoluteHttps(card.url)
    expectAbsoluteHttps(card.serverUrl)
    expectAbsoluteHttps(card.wellKnownUrl)
    expect(card.wellKnownUrl).toBe('https://agentic-mermaid.dev/.well-known/mcp')
    expect(card.protocolVersions).toEqual(expect.arrayContaining(['2025-06-18']))

    expect(manifest.serverUrl).toBe(card.serverUrl)
    expect(manifest.transport).toBe(card.transport)
    expect(manifest.tools.map((tool: any) => tool.name)).toEqual(card.tools.map((tool: any) => tool.name))

    for (const tool of card.tools) {
      expect(typeof tool.name).toBe('string')
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

  test('official MCP Registry metadata matches the npm package and hosted server', () => {
    const packageJson = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
    const registry = JSON.parse(readFileSync(join(REPO, 'server.json'), 'utf8'))
    const publishWorkflow = readFileSync(join(REPO, '.github/workflows/publish.yml'), 'utf8')

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
    expect(packageJson.files).toContain('server.json')
    expect(publishWorkflow).toMatch(/\n  publish-mcp:\n(?:    .*\n)*?    needs: publish\n/)
    expect(publishWorkflow).toContain('releases/download/v1.7.9/mcp-publisher_linux_amd64.tar.gz')
    expect(publishWorkflow).toContain('ab128162b0616090b47cf245afe0a23f3ef08936fdce19074f5ba0a4469281ac')
    expect(publishWorkflow).toContain('./mcp-publisher login github-oidc')
    expect(publishWorkflow).toContain('./mcp-publisher publish')

    const packageBin = spawnSync('bun', ['run', join(REPO, 'bin/am.ts'), 'mcp', '--help'], { encoding: 'utf8' })
    expect({ status: packageBin.status, stderr: packageBin.stderr }).toEqual({ status: 0, stderr: '' })
    expect(packageBin.stdout).toContain('agentic-mermaid-mcp [--transport stdio|http]')
  })
})
