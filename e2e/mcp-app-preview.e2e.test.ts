/**
 * Browser contract for the MCP Apps preview view (BUILD-27).
 *
 * A host that supports MCP Apps reads the view with resources/read, renders it
 * in a sandboxed iframe under a CSP derived from the view's `_meta.ui.csp`, and
 * drives it with JSON-RPC over postMessage. This file plays that host. The
 * test server reads the view and calls the `preview` tool through the same
 * handler the Worker runs, then serves the view with the spec's restrictive
 * default policy (the view declares no external origin, so a conforming host
 * can grant it nothing more). The host page answers `ui/initialize`, forwards
 * the tool input and result, and records everything the view sends back.
 *
 * What only a browser can show: the handshake completes across a real sandbox
 * boundary, the diagram decodes as an image under that CSP, the view reports
 * its size, and hostile text or SVG in a result never runs and never fetches.
 * The server records every request it receives, so "never fetches" is read
 * from the network, not inferred from the page.
 *
 * Honest status: written together with the view. It caught one bug before it
 * shipped — the view read the tool's isError flag as a generic failure and hid
 * parse errors and diagrams that fail verify; two tests fail with that fix
 * reverted. Otherwise it is a regression guard: rendering any result field
 * with innerHTML instead of textContent fails the hostile-result test.
 *
 * Requires: Playwright Chromium (AM_CHROMIUM overrides the executable).
 * Run: cd e2e && bun test mcp-app-preview.e2e.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { chromium, type Browser, type Frame, type Page } from 'playwright'
import { createMcpHandler } from '../website/src/mcp-handler.ts'
import type { HostedMcpContext } from '../src/mcp/hosted-server.ts'
import { PREVIEW_VIEW_URI } from '../src/mcp/apps/preview-view.ts'
import { serveWithAvailablePort } from './test-port.ts'

const chromiumExecutable = (() => {
  const override = process.env.AM_CHROMIUM
  if (override && !existsSync(override)) throw new Error(`AM_CHROMIUM is set but no executable exists at: ${override}`)
  return override
})()

// The spec's policy for a view that declares no external origin, plus the two
// directives default-src does not cover.
const VIEW_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const HOST_BACKGROUND = 'rgb(16, 32, 48)'
const HOST_CONTEXT = {
  theme: 'dark',
  displayMode: 'inline',
  styles: { variables: { '--color-background-primary': HOST_BACKGROUND } },
}

const VERIFIED_SOURCE = 'flowchart LR\n  Request --> Verify --> Render'
const BROKEN_SOURCE = 'flowchart TD\n  A -->'
// verify.ok with one advisory warning, and a diagram that renders but fails
// verify — the tool marks that result isError, and the view must still show it.
const WARNED_SOURCE = 'flowchart LR\n  A["This label is deliberately longer than the forty character cap"] --> B'
const EMPTY_SOURCE = 'flowchart LR'

const ping = (tag: string) => `parent.postMessage({pwned:'${tag}'},'*')`
const HOSTILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40" onload="${ping('svg-onload')}">`
  + `<script>${ping('svg-script')}</script>`
  + `<image href="/svg-image" width="1" height="1" onerror="${ping('svg-image')}"/>`
  + '<rect width="120" height="40" fill="#cde"/></svg>'
const HOSTILE_SUMMARY = `<img src="/summary-image" onerror="${ping('summary')}">`
const HOSTILE_WARNING = `<img src="/warning-image" onerror="${ping('warning')}">`
const HOSTILE_RESULT = {
  content: [{
    type: 'text',
    text: JSON.stringify({
      ok: true,
      family: '<b>flowchart</b>',
      summary: HOSTILE_SUMMARY,
      warnings: [{ code: 'LABEL_OVERFLOW', message: HOSTILE_WARNING }],
      svg: HOSTILE_SVG,
    }),
  }],
}

interface Scenario { args: Record<string, unknown>; result: unknown }

const context: HostedMcpContext = { async execute() { return { ok: true, value: null, logs: [] } } }
const handler = createMcpHandler({ context, cacheVersion: 'mcp-app-preview-e2e', onEvent: () => {} })

async function rpc(method: string, params: Record<string, unknown>): Promise<any> {
  const response = await handler(new Request('https://agentic-mermaid.dev/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }))
  const body = await response.json() as { result?: unknown; error?: unknown }
  if (body.result === undefined) throw new Error(`${method} failed: ${JSON.stringify(body.error)}`)
  return body.result
}

/** Embed a value in an inline script without letting `</script>` close it. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

function hostPage(scenario: Scenario): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>MCP Apps contract host</title>
<iframe id="view" title="Diagram preview" sandbox="allow-scripts" src="/view" style="width: 640px; height: 480px; border: 0"></iframe>
<script>
  const ARGS = ${scriptJson(scenario.args)};
  const RESULT = ${scriptJson(scenario.result)};
  const HOST_CONTEXT = ${scriptJson(HOST_CONTEXT)};
  const frame = document.getElementById('view');
  const log = window.__host = { received: [], sizes: [], responses: {}, pwned: [] };
  const post = message => frame.contentWindow.postMessage(message, '*');
  window.__send = post;
  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow) return;
    const message = event.data;
    if (message && message.pwned) { log.pwned.push(message.pwned); return; }
    log.received.push(message);
    if (message.method === 'ui/initialize') {
      post({ jsonrpc: '2.0', id: message.id, result: {
        protocolVersion: '2026-01-26',
        hostInfo: { name: 'contract-host', version: '0' },
        hostCapabilities: {},
        hostContext: HOST_CONTEXT,
      } });
    } else if (message.method === 'ui/notifications/initialized') {
      post({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: ARGS } });
      post({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: RESULT });
    } else if (message.method === 'ui/notifications/size-changed') {
      log.sizes.push(message.params);
      frame.style.height = message.params.height + 'px';
    } else if (message.method === undefined && message.id !== undefined) {
      log.responses[message.id] = message;
    }
  });
</script>`
}

let browser: Browser
let server: ReturnType<typeof Bun.serve>
let base = ''
let verifiedPayload: { summary: string; svg: string }
const scenarios = new Map<string, Scenario>()
/** Every path the server was asked for since the current host page opened. */
const served: string[] = []
/** What the view itself requested: anything but the two documents and the
 *  browser's own favicon probe for the host page. */
const viewRequests = () => served.filter(path => !['/', '/view', '/favicon.ico'].includes(path))

beforeAll(async () => {
  const read = await rpc('resources/read', { uri: PREVIEW_VIEW_URI })
  const view = read.contents[0] as { text: string; _meta?: { ui?: { csp?: Record<string, string[]> } } }
  const declared = Object.values(view._meta?.ui?.csp ?? {}).flat()
  if (declared.length > 0) throw new Error(`the view now declares origins (${declared.join(', ')}); derive VIEW_POLICY from them`)

  const verified = await rpc('tools/call', { name: 'preview', arguments: { source: VERIFIED_SOURCE } })
  verifiedPayload = JSON.parse(verified.content[0].text)
  scenarios.set('verified', { args: { source: VERIFIED_SOURCE }, result: verified })
  for (const [name, source] of [['broken', BROKEN_SOURCE], ['warned', WARNED_SOURCE], ['empty', EMPTY_SOURCE]] as const) {
    scenarios.set(name, { args: { source }, result: await rpc('tools/call', { name: 'preview', arguments: { source } }) })
  }
  scenarios.set('hostile', { args: { source: VERIFIED_SOURCE }, result: HOSTILE_RESULT })

  const started = serveWithAvailablePort({
    preferredPort: 4611,
    fetch(request) {
      const url = new URL(request.url)
      served.push(url.pathname)
      if (url.pathname === '/view') {
        return new Response(view.text, {
          headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': VIEW_POLICY },
        })
      }
      const scenario = url.pathname === '/' ? scenarios.get(url.searchParams.get('scenario') ?? '') : undefined
      if (!scenario) return new Response('not found', { status: 404 })
      return new Response(hostPage(scenario), { headers: { 'content-type': 'text/html; charset=utf-8' } })
    },
  })
  server = started.server
  base = started.base
  browser = await chromium.launch(chromiumExecutable ? { executablePath: chromiumExecutable } : {})
}, 120_000)

afterAll(async () => {
  try { await browser?.close() } catch {}
  server?.stop()
})

interface OpenedHost { page: Page; view: Frame; consoleErrors: string[] }

async function openHost(scenario: string): Promise<OpenedHost> {
  served.length = 0
  const page = await browser.newPage()
  const consoleErrors: string[] = []
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await page.goto(`${base}/?scenario=${scenario}`)
  await page.waitForFunction(() => (window as any).__host.sizes.length > 0, undefined, { timeout: 30_000 })
  const view = page.frames().find(frame => frame.url() === `${base}/view`)
  if (!view) throw new Error('the view frame did not load')
  return { page, view, consoleErrors }
}

/** Wait until the last size the view reported is the size of its content. */
async function settledSize(page: Page, view: Frame) {
  await view.waitForFunction(() => Array.from(document.images).every(image => image.complete))
  const size = await view.evaluate(() => {
    const content = document.body.getBoundingClientRect()
    return { width: Math.ceil(content.width), height: Math.ceil(content.height) }
  })
  await page.waitForFunction(expected => {
    const last = (window as any).__host.sizes.at(-1)
    return last && last.width === expected.width && last.height === expected.height
  }, size, { timeout: 10_000 })
  return size
}

describe('MCP Apps preview view in a sandboxed frame', () => {
  test('completes the handshake and shows the verified diagram as an image', async () => {
    const { page, view, consoleErrors } = await openHost('verified')
    try {
      const received = await page.evaluate(() => (window as any).__host.received)
      expect(received[0]).toMatchObject({
        jsonrpc: '2.0',
        method: 'ui/initialize',
        params: {
          protocolVersion: '2026-01-26',
          clientInfo: { name: 'agentic-mermaid-preview' },
          capabilities: {},
          appCapabilities: { availableDisplayModes: ['inline'] },
        },
      })
      expect(received[1]).toEqual({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} })

      const size = await settledSize(page, view)
      const diagramBottom = await view.evaluate(() => document.querySelector('.diagram')!.getBoundingClientRect().bottom)
      expect(size.width).toBeGreaterThan(0)
      expect(size.height).toBeGreaterThanOrEqual(Math.floor(diagramBottom))

      const shown = await view.evaluate(() => {
        const image = document.querySelector('.diagram img') as HTMLImageElement
        return {
          family: document.querySelector('.family')?.textContent,
          verdict: document.querySelector('.verdict')?.textContent,
          summary: document.querySelector('.summary')?.textContent,
          src: image.getAttribute('src') ?? '',
          alt: image.alt,
          naturalWidth: image.naturalWidth,
          theme: document.documentElement.getAttribute('data-theme'),
          background: getComputedStyle(document.body).backgroundColor,
        }
      })
      expect(shown).toMatchObject({
        family: 'flowchart',
        verdict: 'Verified',
        summary: verifiedPayload.summary,
        alt: verifiedPayload.summary,
        theme: 'dark',
        background: HOST_BACKGROUND,
      })
      expect(shown.src).toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(verifiedPayload.svg)}`)
      expect(shown.naturalWidth).toBeGreaterThan(0)
      // The view neither fetched anything nor tried to: a blocked attempt would
      // have logged a policy violation.
      expect(viewRequests()).toEqual([])
      expect(consoleErrors.filter(text => /Content Security Policy/i.test(text))).toEqual([])
    } finally {
      await page.close()
    }
  })

  test('shows the verdict and readable warnings of every result that carries a diagram', async () => {
    // Verify warnings carry fields, not prose; the view spells them out. An
    // empty diagram renders as a 0x0 SVG, so its box is hidden, not left blank.
    const expected = [
      { scenario: 'warned', isError: false, verdict: 'Verified with 1 warning', warnings: ['LABEL_OVERFLOW — target: A, charCount: 62, limit: 40'], diagram: 'shown' },
      { scenario: 'empty', isError: true, verdict: 'Needs attention', warnings: ['EMPTY_DIAGRAM'], diagram: 'hidden' },
    ]
    for (const { scenario, isError, verdict, warnings, diagram } of expected) {
      expect({ scenario, isError: (scenarios.get(scenario)!.result as { isError?: boolean }).isError }).toEqual({ scenario, isError })
      const { page, view } = await openHost(scenario)
      try {
        await settledSize(page, view)
        const shown = await view.evaluate(() => ({
          verdict: document.querySelector('.verdict')?.textContent,
          warnings: Array.from(document.querySelectorAll('.warnings li'), item => item.textContent),
          diagram: (document.querySelector('.diagram') as HTMLElement | null)?.hidden ? 'hidden' : 'shown',
        }))
        expect({ scenario, ...shown }).toEqual({ scenario, verdict, warnings, diagram })
      } finally {
        await page.close()
      }
    }
  })

  test('answers teardown with an empty result and unknown requests with -32601', async () => {
    const { page } = await openHost('verified')
    try {
      await page.evaluate(() => {
        const send = (window as any).__send
        send({ jsonrpc: '2.0', id: 'teardown', method: 'ui/resource-teardown', params: {} })
        send({ jsonrpc: '2.0', id: 'unknown', method: 'ui/no-such-request', params: {} })
      })
      await page.waitForFunction(() => {
        const responses = (window as any).__host.responses
        return responses.teardown && responses.unknown
      }, undefined, { timeout: 10_000 })
      const responses = await page.evaluate(() => (window as any).__host.responses)
      expect(responses.teardown).toEqual({ jsonrpc: '2.0', id: 'teardown', result: {} })
      expect(responses.unknown).toEqual({ jsonrpc: '2.0', id: 'unknown', error: { code: -32601, message: 'Method not found' } })
    } finally {
      await page.close()
    }
  })

  test('shows parse errors as text and no diagram', async () => {
    const { page, view } = await openHost('broken')
    try {
      await view.waitForSelector('.problems li')
      const shown = await view.evaluate(() => ({
        status: document.querySelector('.status')?.textContent,
        problems: Array.from(document.querySelectorAll('.problems li'), item => item.textContent ?? ''),
        images: document.images.length,
      }))
      expect(shown.status).toBe('The diagram could not be parsed.')
      expect(shown.problems.length).toBeGreaterThan(0)
      expect(shown.problems.every(problem => problem.length > 0)).toBe(true)
      expect(shown.images).toBe(0)
    } finally {
      await page.close()
    }
  })

  test('never runs or fetches anything a hostile result carries', async () => {
    const { page, view } = await openHost('hostile')
    try {
      await settledSize(page, view)
      const shown = await view.evaluate(() => ({
        family: document.querySelector('.family')?.textContent,
        summary: document.querySelector('.summary')?.textContent,
        warning: document.querySelector('.warnings li')?.textContent,
        images: Array.from(document.images, image => ({ src: image.getAttribute('src') ?? '', naturalWidth: image.naturalWidth })),
      }))
      expect(shown.family).toBe('<b>flowchart</b>')
      expect(shown.summary).toBe(HOSTILE_SUMMARY)
      expect(shown.warning).toBe(`LABEL_OVERFLOW — ${HOSTILE_WARNING}`)
      expect(shown.images).toHaveLength(1)
      expect(shown.images[0]!.src.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
      expect(shown.images[0]!.naturalWidth).toBe(120)
      expect(await page.evaluate(() => (window as any).__host.pwned)).toEqual([])
      expect(viewRequests()).toEqual([])
    } finally {
      await page.close()
    }
  })
})
