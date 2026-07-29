import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'deploy-cloudflare.yml'), 'utf8')

  test('runs against both the zero-traffic candidate and promoted production', () => {
    expect(workflow.match(/bun run scripts\/site\/smoke-live-site\.ts/g)).toHaveLength(2)

    const candidate = workflow.slice(
      workflow.indexOf('- name: Smoke-test the zero-traffic website candidate'),
      workflow.indexOf('- name: Probe the full zero-traffic /mcp candidate'),
    )
    expect(candidate).toContain('SITE_SMOKE_EXPECTED_SHA: ${{ env.EXPECTED_SHA }}')
    expect(candidate).toContain('SITE_WORKER_VERSION_ID: ${{ steps.candidate.outputs.candidate_id }}')

    const promoted = workflow.slice(
      workflow.indexOf('- name: Smoke-test the promoted production website'),
      workflow.indexOf('- name: Roll back any unverified deployment'),
    )
    expect(promoted).toContain('id: production-site-verify')
    expect(promoted).toContain('echo "verified=true" >> "$GITHUB_OUTPUT"')
  })

  test('rolls back unless both MCP and website production verification pass', () => {
    const rollback = workflow.slice(workflow.indexOf('- name: Roll back any unverified deployment'))
    expect(rollback).toContain("steps.production-verify.outputs.verified != 'true'")
    expect(rollback).toContain("steps.production-site-verify.outputs.verified != 'true'")
  })

})
