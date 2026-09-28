import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { runSiteSmoke } from '../../scripts/site/smoke-live-site.ts'

const ROOT = join(import.meta.dir, '..', '..')
const EXPECTED_SHA = '0123456789abcdef0123456789abcdef01234567'
const CANDIDATE_ID = '11111111-2222-3333-4444-555555555555'
const OVERRIDE = `agentic-mermaid-website="${CANDIDATE_ID}"`

let servedSha = EXPECTED_SHA
let server: ReturnType<typeof Bun.serve>
let overrides: Array<string | null> = []

function headers(contentType: string, cacheControl = 'no-cache') {
  return { 'content-type': contentType, 'cache-control': cacheControl }
}

function json(body: Record<string, unknown>) {
  return Response.json(body, { headers: { 'cache-control': 'public, max-age=300' } })
}

function generatedFrom() {
  return { packageVersion: '0.4.0', gitSha: servedSha }
}

function html(canonicalPath: string, marker: string) {
  return new Response(`<html><head><link rel="canonical" href="https://agentic-mermaid.dev${canonicalPath}"></head><body>${marker}</body></html>`, {
    headers: headers('text/html; charset=utf-8'),
  })
}

beforeAll(() => {
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      overrides.push(request.headers.get('cloudflare-workers-version-overrides'))

      if (url.pathname === '/' && request.headers.get('accept') === 'text/markdown') {
        return new Response('# Agentic Mermaid\n\nHosted MCP endpoint\n', { headers: headers('text/markdown; charset=utf-8') })
      }
      if (url.pathname === '/') return html('/', '<main id="main"></main>')
      if (url.pathname === '/editor/') {
        return html('/editor/', '<textarea id="code-editor"></textarea><script type="module" src="/editor/editor-abcdef123456.js"></script>')
      }
      if (url.pathname === '/docs/') return html('/docs/', '<main id="main"></main>')
      if (url.pathname === '/examples/') return html('/examples/', '<article class="example-sample"></article>')
      if (url.pathname === '/comparisons/') return html('/comparisons/', '<section data-comparison-engine="agentic"></section>')
      if (url.pathname === '/editor/editor-abcdef123456.js') {
        return new Response('export const editor = true', { headers: headers('text/javascript', 'public, max-age=31536000, immutable') })
      }
      if (url.pathname === '/capabilities.json') {
        return json({ families: ['flowchart'], outputFormats: ['svg'], generatedFrom: generatedFrom() })
      }
      if (url.pathname === '/examples/index.json') {
        return json({ examples: [{ id: 'flowchart' }], richExamples: [{ id: 'rich' }], generatedFrom: generatedFrom() })
      }
      if (url.pathname === '/.well-known/mcp.json') {
        return json({
          transport: 'streamable-http',
          serverUrl: 'https://agentic-mermaid.dev/mcp',
          tools: [{ name: 'verify' }],
          generatedFrom: generatedFrom(),
        })
      }
      if (url.pathname === '/.well-known/mcp/server-card.json') {
        return json({
          transport: 'streamable-http',
          serverUrl: 'https://agentic-mermaid.dev/mcp',
          protocolVersions: ['2026-07-28'],
          tools: [{ name: 'verify' }],
          generatedFrom: generatedFrom(),
        })
      }
      if (url.pathname === '/llms.txt') {
        return new Response('Hosted MCP: https://agentic-mermaid.dev/mcp\n', { headers: headers('text/plain; charset=utf-8') })
      }
      if (url.pathname === '/robots.txt') {
        return new Response('Sitemap: https://agentic-mermaid.dev/sitemap.xml\n', { headers: headers('text/plain; charset=utf-8') })
      }
      if (url.pathname === '/sitemap.xml') {
        return new Response('<urlset><url><loc>https://agentic-mermaid.dev/</loc></url></urlset>', { headers: headers('application/xml') })
      }
      if (url.pathname === '/styles.css' && request.method === 'HEAD') {
        return new Response(null, { headers: headers('text/css') })
      }
      return new Response('not found', { status: 404, headers: headers('text/plain') })
    },
  })
})

afterAll(() => server.stop(true))

describe('production website smoke runner', () => {
  test('checks semantic website contracts through one immutable candidate override', async () => {
    servedSha = EXPECTED_SHA
    overrides = []
    const checks = await runSiteSmoke({
      origin: server.url.origin,
      expectedSha: EXPECTED_SHA,
      workerVersionId: CANDIDATE_ID,
      log: () => {},
    })

    expect(checks).toBeGreaterThan(40)
    expect(overrides.length).toBeGreaterThan(10)
    expect(new Set(overrides)).toEqual(new Set([OVERRIDE]))
  })

  test('rejects a healthy-looking site built from the wrong commit', async () => {
    servedSha = 'ffffffffffffffffffffffffffffffffffffffff'
    await expect(
      runSiteSmoke({
        origin: server.url.origin,
        expectedSha: EXPECTED_SHA,
        workerVersionId: CANDIDATE_ID,
        log: () => {},
      }),
    ).rejects.toThrow(/deployed git SHA is .* expected/)
  })
})

describe('production website smoke deployment wiring', () => {
  interface Step { name?: string; id?: string; if?: string; run?: string; env?: Record<string, string> }
  const steps = (parseYaml(readFileSync(join(ROOT, '.github', 'workflows', 'deploy-cloudflare.yml'), 'utf8')) as {
    jobs: { deploy: { steps: Step[] } }
  }).jobs.deploy.steps
  // Promotion is the step that moves the candidate to all traffic.
  const promoteIndex = steps.findIndex(step => /\bwrangler versions deploy[\s\\]+"\$\{CANDIDATE_ID\}@100%"/.test(step.run ?? ''))
  const siteSmokes = steps.flatMap((step, index) => step.run?.includes('scripts/site/smoke-live-site.ts') ? [{ step, index }] : [])

  test('runs against both the zero-traffic candidate and promoted production', () => {
    expect(promoteIndex).toBeGreaterThan(0)
    const candidate = siteSmokes.filter(({ index }) => index < promoteIndex)
    const promoted = siteSmokes.filter(({ index }) => index > promoteIndex)
    expect({ candidate: candidate.length, promoted: promoted.length }).toEqual({ candidate: 1, promoted: 1 })
    // Before promotion: pinned to the uploaded candidate and to the exact SHA.
    expect(candidate[0]!.step.env).toMatchObject({
      SITE_SMOKE_EXPECTED_SHA: expect.stringContaining('EXPECTED_SHA'),
      SITE_WORKER_VERSION_ID: expect.stringContaining('steps.candidate.outputs.candidate_id'),
    })
    // After promotion: ordinary production traffic, without requiring cached
    // static machine resources to change SHA atomically.
    expect(promoted[0]!.step.env?.SITE_WORKER_VERSION_ID).toBeUndefined()
    expect(promoted[0]!.step.env?.SITE_SMOKE_EXPECTED_SHA).toBeUndefined()
  })

  test('the promoted smoke reports verified only when the smoke passes', () => {
    const promoted = siteSmokes.find(({ index }) => index > promoteIndex)!.step
    expect(promoted.id).toBeDefined()
    for (const [smokeStatus, verified] of [[0, true], [1, false]] as const) {
      const dir = mkdtempSync(join(tmpdir(), 'agentic-mermaid-site-smoke-'))
      try {
        mkdirSync(join(dir, 'bin'))
        writeFileSync(join(dir, 'bin', 'bun'), `#!/usr/bin/env bash\nexit ${smokeStatus}\n`)
        chmodSync(join(dir, 'bin', 'bun'), 0o755)
        writeFileSync(join(dir, 'output'), '')
        spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', promoted.run!], {
          cwd: dir,
          env: { ...process.env, GITHUB_OUTPUT: join(dir, 'output'), PATH: `${join(dir, 'bin')}:${process.env.PATH}` },
        })
        expect({ smokeStatus, verified: readFileSync(join(dir, 'output'), 'utf8').includes('verified=true') })
          .toEqual({ smokeStatus, verified })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  test('rolls back unless every post-promotion verification passes', () => {
    // Every step after promotion that reports `verified` gates the rollback.
    const verifications = steps.slice(promoteIndex + 1).filter(step => step.id && step.run?.includes('verified=true')).map(step => step.id!)
    expect(verifications.length).toBeGreaterThanOrEqual(2)
    const rollback = steps.find(step => /\bwrangler rollback\b/.test(step.run ?? ''))
    expect(rollback?.if).toContain('always()')
    for (const id of verifications) {
      expect({ id, gatesRollback: rollback?.if?.includes(`steps.${id}.outputs.verified != 'true'`) }).toEqual({ id, gatesRollback: true })
    }
  })
})
