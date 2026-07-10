// Website Worker routing core: static-asset header/redirect behavior plus
// hosted MCP transport wiring. The production Worker entry injects workerd-only
// assets; unit tests inject fakes so routing can run under Bun without Wrangler
// data-module loaders.

import { createMcpHandler, type McpCache } from './mcp-handler.ts'
import { createLoaderExecute, type WorkerLoaderBinding } from './execute-loader.ts'
import type { HostedMcpContext } from '../../src/mcp/hosted-server.ts'

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  LOADER: WorkerLoaderBinding
}

export interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }

export interface WebsiteWorkerRuntime {
  executeHarness: string
  renderPng: NonNullable<HostedMcpContext['renderPng']>
  deployVersion: string
}

// Renamed/consolidated routes. Examples absorbed the gallery; Why became
// About. Mirrors the static _redirects file.
const redirects = new Map([
  ['/why', '/about/'], ['/why/', '/about/'],
  ['/gallery', '/examples/'], ['/gallery/', '/examples/'],
])

const cleanRoutes = new Set([
  '/about', '/about/design', '/comparisons', '/docs', '/editor', '/errors', '/examples', '/warnings',
  '/docs/getting-started', '/docs/api', '/docs/cli', '/docs/mcp', '/docs/ascii', '/docs/theming', '/docs/custom-styles',
  '/docs/quality', '/docs/fork-differences', '/skills/agentic-mermaid-diagram-workflow',
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

const homepageDiscoveryLinks = [
  '</index.md>; rel="alternate"; type="text/markdown"',
  '</llms.txt>; rel="describedby"; type="text/plain"',
  '</sitemap.xml>; rel="index"; type="application/xml"',
  '</.well-known/mcp/server-card.json>; rel="service-desc"; type="application/json"',
  '</skills/agentic-mermaid-diagram-workflow/SKILL.md>; rel="describedby"; type="text/markdown"',
].join(', ')

function appendVary(headers: Headers, field: string) {
  const values = (headers.get('Vary') ?? '').split(',').map(value => value.trim()).filter(Boolean)
  if (!values.some(value => value === '*' || value.toLowerCase() === field.toLowerCase())) {
    values.push(field)
  }
  headers.set('Vary', values.join(', '))
}

function acceptedQuality(accept: string, representation: string): number {
  const [targetType, targetSubtype] = representation.toLowerCase().split('/')
  let bestSpecificity = -1
  let bestQuality = 0

  for (const entry of accept.split(',')) {
    const [rawRange, ...parameters] = entry.split(';')
    const [rangeType, rangeSubtype] = rawRange!.trim().toLowerCase().split('/')
    if (!rangeType || !rangeSubtype) continue
    if (rangeType !== '*' && rangeType !== targetType) continue
    if (rangeSubtype !== '*' && rangeSubtype !== targetSubtype) continue

    const specificity = rangeType === '*' ? 0 : rangeSubtype === '*' ? 1 : 2
    if (specificity <= bestSpecificity) continue

    const qualityParameter = parameters.find(parameter => /^\s*q\s*=/i.test(parameter))
    const parsedQuality = qualityParameter
      ? Number(qualityParameter.slice(qualityParameter.indexOf('=') + 1).trim())
      : 1
    bestSpecificity = specificity
    bestQuality = Number.isFinite(parsedQuality) && parsedQuality >= 0 && parsedQuality <= 1
      ? parsedQuality
      : 0
  }

  return bestQuality
}

function prefersMarkdown(accept: string | null): boolean {
  if (!accept) return false
  const markdownQuality = acceptedQuality(accept, 'text/markdown')
  const htmlQuality = acceptedQuality(accept, 'text/html')
  return markdownQuality > 0 && markdownQuality > htmlQuality
}

function withHeaders(response: Response, pathname: string, negotiatesHomepage = false): Response {
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
  } else if (/\.(css|js|svg|ttf)$/i.test(pathname)) {
    headers.set('Cache-Control', 'public, max-age=3600')
  }

  if (negotiatesHomepage) {
    appendVary(headers, 'Accept')
    const existingLinks = headers.get('Link')
    headers.set('Link', existingLinks ? `${existingLinks}, ${homepageDiscoveryLinks}` : homepageDiscoveryLinks)
    if (pathname === '/index.md') headers.set('Content-Location', '/index.md')
  }

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export function createWebsiteWorker(runtime: WebsiteWorkerRuntime) {
  return {
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

      // `/.well-known/mcp` is the standard discovery alias for the same hosted
      // Streamable HTTP transport as `/mcp`.
      if (pathname === '/mcp' || pathname === '/.well-known/mcp') {
        const handler = createMcpHandler({
          context: {
            execute: createLoaderExecute(env.LOADER, runtime.executeHarness),
            renderPng: runtime.renderPng,
          },
          // `caches` is a workerd global; guard it so the worker imports and runs
          // off-runtime (bun/node tests), where the response cache is disabled.
          // Cast because the root tsconfig types `caches` as the DOM CacheStorage
          // (no `.default`); workerd/miniflare provide the default cache.
          cache: typeof caches !== 'undefined' ? (caches as unknown as { default: McpCache }).default : undefined,
          // Full-deploy hash (see generated/deploy-version.ts): busts cached
          // results whenever any hosted tool, transport, PNG path, or SDK
          // changes. Isolate IDs use the harness hash inside createLoaderExecute.
          cacheVersion: runtime.deployVersion,
          // ctx is absent when the worker is driven directly in tests; then the
          // handler awaits cache writes inline instead of deferring them.
          waitUntil: ctx ? (p => ctx.waitUntil(p)) : undefined,
        })
        return handler(request)
      }

      const negotiatesHomepage = url.pathname === '/' && (request.method === 'GET' || request.method === 'HEAD')
      let assetRequest = request
      let assetPathname = url.pathname
      if (negotiatesHomepage && prefersMarkdown(request.headers.get('Accept'))) {
        const markdownUrl = new URL(url)
        markdownUrl.pathname = '/index.md'
        assetRequest = new Request(markdownUrl, request)
        assetPathname = markdownUrl.pathname
      }

      const response = await env.ASSETS.fetch(assetRequest)
      return withHeaders(response, assetPathname, negotiatesHomepage)
    },
  }
}
