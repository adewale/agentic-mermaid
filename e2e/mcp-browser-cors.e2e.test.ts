/**
 * Browser CORS contract for the hosted `/mcp` endpoint (plan §7.4).
 *
 * CORS cannot be verified by curl. A request with no `Origin` is not a browser
 * request, and every probe in `website/e2e-mcp.sh` sends none — so the entire
 * suite passes whether or not a browser could ever read this endpoint. The only
 * honest test is a real browser making a real cross-origin request, which is
 * what this file does: Chromium loads a page from one origin and fetches the
 * MCP endpoint on another. The port (or host) difference is what makes it
 * genuinely cross-origin.
 *
 * This matters most for the modern era. `Mcp-Method` and `Mcp-Name` are REQUIRED
 * on every `2026-07-28` request, and custom request headers force a preflight —
 * so if `CORS_BASE` did not allow them, a browser client's preflight would fail
 * before it could send a single conforming request. No non-browser test can see
 * that, because no non-browser client ever preflights.
 *
 * Two traps this file deliberately encodes:
 *
 *   1. **Diagnose from the network log, never from the thrown error.** A fetch
 *      blocked by CORS and a fetch that failed to connect raise the same
 *      `TypeError: Failed to fetch` in every browser. Asserting on the exception
 *      misattributes the cause and would pass for a server that was simply down.
 *      Every assertion below reads the recorded response instead.
 *   2. **The MCP Inspector is not this test.** Its default mode proxies through a
 *      local Node process and exercises none of these headers.
 *
 * Substitution, stated plainly: the plan specified `wrangler dev` on a second
 * port. Wrangler is not installed in this repo, and the property under test is
 * "a real browser, a real preflight, a real cross-origin response" — not which
 * process serves it. `createMcpHandler` is the same handler the Worker runs, so
 * serving it directly tests the same code with fewer moving parts.
 *
 * Honest status: our CORS is already correct, so this is a REGRESSION GUARD, not
 * a bug-discriminating test. It fails if someone removes `mcp-method`/`mcp-name`
 * from the allowlist, drops CORS decoration from a response path, or widens the
 * origin allowlist to everything.
 *
 * Requires: Playwright Chromium. Run: bun test e2e/mcp-browser-cors.e2e.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { createMcpHandler } from '../website/src/mcp-handler.ts'
import type { HostedMcpContext } from '../src/mcp/hosted-server.ts'
import { serveWithAvailablePort } from './test-port.ts'

const MODERN = '2026-07-28'

/**
 * Playwright resolves its managed browser by build number, so a container that
 * provisioned a different build under `PLAYWRIGHT_BROWSERS_PATH` fails to launch
 * on a path mismatch while holding a perfectly usable Chromium. Prefer the
 * managed build, fall back to whatever is installed, and return null only when
 * there is genuinely no browser — at which point the suite skips VISIBLY. A
 * silent pass would report CORS as verified on a machine that never opened a
 * browser, which is the failure mode this whole file exists to avoid.
 */
function resolveChromium(): { executablePath?: string } | null {
  try {
    if (existsSync(chromium.executablePath())) return {}
  } catch { /* no managed build registered */ }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return null
  // Walk the Playwright cache instead of assuming Linux's `chrome-linux`
  // layout. Managed caches use different leaf directories on macOS, Windows,
  // architectures, and for the headless shell. Prefer full Chromium by path
  // ordering, but accept any executable Playwright provisioned.
  const candidates: string[] = []
  const visit = (dir: string, depth: number) => {
    if (depth > 6) return
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path, depth + 1)
      else if (['chrome', 'chrome.exe', 'Chromium', 'headless_shell', 'headless_shell.exe'].includes(entry.name)) candidates.push(path)
    }
  }
  visit(root, 0)
  const executable = candidates.sort((a, b) => {
    const aShell = a.includes('headless_shell') ? 1 : 0
    const bShell = b.includes('headless_shell') ? 1 : 0
    return aShell - bShell || (a < b ? -1 : a > b ? 1 : 0)
  })[0]
  if (executable) return { executablePath: executable }
  return null
}

const LAUNCH = resolveChromium()

/** 127.0.0.1 is allowlisted as localhost; the page server's directly bound
 *  0.0.0.0 address is not. Using the bind address avoids DNS and avoids relying
 *  on Linux/macOS assigning the same set of secondary 127/8 loopback aliases. */
const ALLOWED_HOST = '127.0.0.1'
const BLOCKED_HOST = '0.0.0.0'

const PAGE = `<!doctype html><meta charset="utf-8"><title>mcp cors probe</title>`

function hostedContext(): HostedMcpContext {
  return { async execute() { return { ok: true, value: 42, logs: [] } } }
}

/**
 * What the server actually answered, recorded at the wire.
 *
 * Playwright does not surface CORS preflights through `page.on('response')` —
 * the browser issues them below the page's network layer — so the preflight,
 * which is the single most important exchange here, is invisible from the
 * client side. Recording at the server is both deterministic and complete: it
 * sees the OPTIONS the browser sent and the exact headers we answered with.
 * This is still "diagnose from the network, not the exception"; it is just the
 * server's end of the same network.
 */
interface Exchange { method: string; status: number; acao: string | null; allowHeaders: string | null }
const exchanges: Exchange[] = []

let browser: Browser
let mcp: { server: ReturnType<typeof Bun.serve>; base: string }
let page: { server: ReturnType<typeof Bun.serve>; base: string }
let pagePort: number

/**
 * Load the probe page from `host`, fetch the MCP endpoint cross-origin, and
 * return what the NETWORK saw — never what the page threw.
 */
async function crossOriginProbe(host: string, body: Record<string, unknown>) {
  exchanges.length = 0
  const context = await browser.newContext()
  const tab = await context.newPage()

  await tab.goto(`http://${host}:${pagePort}/`)
  const outcome = await tab.evaluate(async ({ endpoint, payload }) => {
    try {
      const response = await fetch(`${endpoint}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': String((payload as { method?: unknown }).method ?? ''),
        },
        body: JSON.stringify(payload),
      })
      return { read: true, status: response.status, body: await response.text() }
    } catch (error) {
      // Captured only to prove we do NOT diagnose from it.
      return { read: false, thrown: String(error) }
    }
  }, { endpoint: mcp.base, payload: body })

  await context.close()
  return {
    outcome,
    preflight: exchanges.find(e => e.method === 'OPTIONS'),
    post: exchanges.find(e => e.method === 'POST'),
    exchanges: [...exchanges],
  }
}

const modernList = {
  jsonrpc: '2.0', id: 1, method: 'tools/list',
  params: { _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN, 'io.modelcontextprotocol/clientCapabilities': {} } },
}

describe.skipIf(!LAUNCH)('hosted /mcp in a real cross-origin browser', () => {
  beforeAll(async () => {
    browser = await chromium.launch(LAUNCH ?? {})
    const handler = createMcpHandler({ context: hostedContext(), cacheVersion: 'cors-e2e' })
    mcp = serveWithAvailablePort({
      preferredPort: 8791,
      hostname: ALLOWED_HOST,
      fetch: async request => {
        const response = await handler(request)
        exchanges.push({
          method: request.method,
          status: response.status,
          acao: response.headers.get('access-control-allow-origin'),
          allowHeaders: response.headers.get('access-control-allow-headers'),
        })
        return response
      },
    })
    // Bound to all interfaces so the same page is reachable as both a localhost
    // origin and a non-localhost one.
    page = serveWithAvailablePort({
      preferredPort: 8891,
      hostname: '0.0.0.0',
      fetch: () => new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    })
    pagePort = new URL(page.base).port as unknown as number
  })

  afterAll(async () => {
    await browser?.close()
    mcp?.server.stop(true)
    page?.server.stop(true)
  })

  test('an allowlisted origin preflights and reads a modern response', async () => {
    const { outcome, preflight, post } = await crossOriginProbe(ALLOWED_HOST, modernList)
    const origin = `http://${ALLOWED_HOST}:${pagePort}`

    // The preflight is the part no curl probe can reach.
    expect(preflight).toBeDefined()
    expect(preflight!.status).toBeLessThan(300)
    expect(preflight!.acao).toBe(origin)
    // Without these two the modern era is unreachable from any browser.
    expect(preflight!.allowHeaders?.toLowerCase()).toContain('mcp-method')
    expect(preflight!.allowHeaders?.toLowerCase()).toContain('mcp-name')
    expect(preflight!.allowHeaders?.toLowerCase()).toContain('mcp-protocol-version')

    expect(post?.status).toBe(200)
    expect(post?.acao).toBe(origin)
    // The browser actually let the page READ it — the real end-to-end property.
    expect(outcome.read).toBe(true)
    expect(JSON.parse(outcome.body!).result.resultType).toBe('complete')
  }, 60_000)

  test('a non-allowlisted origin is stopped at the preflight, before any POST', async () => {
    const { outcome, preflight, post } = await crossOriginProbe(BLOCKED_HOST, modernList)

    // The diagnosis, read from the network: we answered the preflight and
    // withheld Access-Control-Allow-Origin. A test that asserted only on the
    // thrown error could not tell this from a dead port.
    expect(preflight).toBeDefined()
    expect(preflight!.status).toBe(403)
    expect(preflight!.acao).toBeNull()
    // The allowlist itself is unconditional; only the origin echo is withheld.
    expect(preflight!.allowHeaders?.toLowerCase()).toContain('mcp-method')

    // The part no handler-level test can observe: the POST never happens. The
    // browser abandons the request after the preflight, so `mcp-handler.ts`'s
    // 403 "origin not allowed" response stops the browser at the preflight;
    // the application POST never reaches the handler's tool dispatch path.
    expect(post).toBeUndefined()

    // The consequence, not the diagnosis — the assertions above are that.
    expect(outcome.read).toBe(false)
  }, 60_000)
})
