// Website Worker: static assets on Cloudflare's asset path, plus the hosted
// MCP endpoint at /mcp (stateless Streamable HTTP; see mcp-handler.ts).

import { createMcpHandler, type McpCache } from './mcp-handler.ts'
import { createLoaderExecute, type WorkerLoaderBinding } from './execute-loader.ts'
import { renderMermaidPNGWasm } from './png-wasm.ts'
import executeHarness from './generated/execute-harness.js.txt'
import { DEPLOY_VERSION } from './generated/deploy-version.ts'

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  LOADER: WorkerLoaderBinding
}
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }

// Renamed/consolidated routes. Examples absorbed the gallery; Families folded
// into the docs; Why became About. Mirrors the static _redirects file.
const redirects = new Map([
  ['/why', '/about/'], ['/why/', '/about/'],
  ['/gallery', '/examples/'], ['/gallery/', '/examples/'],
  ['/families', '/docs/families/'], ['/families/', '/docs/families/'],
])

const cleanRoutes = new Set([
  '/editor', '/docs', '/skills', '/skills/agentic-mermaid-diagram-workflow',
  '/docs/getting-started', '/docs/api', '/docs/families', '/docs/source-level', '/docs/cli', '/docs/mcp', '/docs/ascii', '/docs/theming',
  '/docs/config', '/docs/react', '/docs/quality', '/docs/fork-differences', '/docs/vocabulary',
  '/warnings', '/errors', '/examples', '/comparisons', '/evidence', '/security', '/releases',
])

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "worker-src 'self'",
  "form-action 'none'",
].join('; ')

function withHeaders(response: Response, pathname: string): Response {
  const headers = new Headers(response.headers)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')

  const type = headers.get('content-type') || ''
  headers.delete('Cache-Control')
  if (type.includes('text/html')) headers.set('Content-Security-Policy', csp)

  if (/\.(json|md|txt)$/i.test(pathname)) {
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Cache-Control', 'public, max-age=300')
  } else if (type.includes('text/html') || response.status === 404) {
    headers.set('Cache-Control', 'no-cache')
  } else if (/^\/(?:editor\/editor-[a-f0-9]{12}|vendor\/mermaid-[a-f0-9]{12}\.min)\.js$/i.test(pathname)) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  } else if (/\.(css|js|svg)$/i.test(pathname)) {
    headers.set('Cache-Control', 'public, max-age=3600')
  }

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // Canonical host redirect. This must run before Static Assets so the
    // homepage and other asset-backed paths do not serve duplicate www content.
    if (url.hostname === 'www.agentic-mermaid.dev') {
      url.hostname = 'agentic-mermaid.dev'
      return Response.redirect(url.toString(), 301)
    }

    const pathname = url.pathname.replace(/\/$/, '') || '/'

    const redirectTo = redirects.get(url.pathname) || redirects.get(pathname)
    if (redirectTo) return Response.redirect(new URL(redirectTo + url.search + url.hash, url).toString(), 308)
    if ((cleanRoutes.has(pathname) || /^\/(warnings|errors)\/[^/.]+$/.test(pathname)) && !url.pathname.endsWith('/')) {
      return Response.redirect(new URL(pathname + '/' + url.search + url.hash, url).toString(), 308)
    }

    if (pathname === '/mcp') {
      const handler = createMcpHandler({
        context: {
          execute: createLoaderExecute(env.LOADER, executeHarness),
          renderPng: renderMermaidPNGWasm,
        },
        // `caches` is a workerd global; guard it so the worker imports and runs
        // off-runtime (bun/node tests), where the response cache is disabled.
        // Cast because the root tsconfig types `caches` as the DOM CacheStorage
        // (no `.default`); workerd/miniflare provide the default cache.
        cache: typeof caches !== 'undefined' ? (caches as unknown as { default: McpCache }).default : undefined,
        // Full-deploy hash (see generated/deploy-version.ts): busts cached
        // results whenever any hosted tool, transport, PNG path, or SDK
        // changes. Isolate IDs use the harness hash inside createLoaderExecute.
        cacheVersion: DEPLOY_VERSION,
        // ctx is absent when the worker is driven directly in tests; then the
        // handler awaits cache writes inline instead of deferring them.
        waitUntil: ctx ? (p => ctx.waitUntil(p)) : undefined,
      })
      return handler(request)
    }

    const response = await env.ASSETS.fetch(request)
    return withHeaders(response, url.pathname)
  },
}
