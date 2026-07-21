// Website Worker routing core: static-asset header/redirect behavior plus
// hosted MCP transport wiring. The production Worker entry injects workerd-only
// assets; unit tests inject fakes so routing can run under Bun without Wrangler
// data-module loaders.

import { createMcpHandler, type McpCache } from './mcp-handler.ts'
import { createLoaderExecute, type WorkerLoaderBinding } from './execute-loader.ts'
import type { HostedMcpContext } from '../../src/mcp/hosted-server.ts'
import { CLEAN_ROUTE_PATHS, LEGACY_REDIRECTS } from './site-routes.ts'

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

// Keep Worker-first redirects and clean-route canonicalization identical to
// the generated Static Assets manifest.
const redirects = new Map(LEGACY_REDIRECTS)
const cleanRoutes = new Set(CLEAN_ROUTE_PATHS)

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
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

const HOURLY_STATIC_ASSET = /\.(?:css|js|svg|ttf|woff2|png|ico)$/i
const STRICT_TRANSPORT_SECURITY = 'max-age=31536000'
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

type ImmutableAssetRule = Readonly<{ path: RegExp, contentTypes: readonly string[] }>
const IMMUTABLE_ASSET_RULES: readonly ImmutableAssetRule[] = Object.freeze([
  Object.freeze({ path: /^\/(?:editor\/editor-(?:(?:app|renderer)-)?[a-f0-9]{12}|vendor\/mermaid-[a-f0-9]{12}\.min)\.js$/i, contentTypes: ['text/javascript', 'application/javascript'] }),
  Object.freeze({ path: /^\/examples\/fragments\/(?:style-palette|corpus)-[a-f0-9]{12}\.html$/i, contentTypes: ['text/html'] }),
  Object.freeze({ path: /^\/examples-[a-f0-9]{12}\.js$/i, contentTypes: ['text/javascript', 'application/javascript'] }),
  Object.freeze({ path: /^\/fonts\/Inter-(?:Regular|Medium|SemiBold|Bold)\.subset-[a-f0-9]{12}\.woff2$/i, contentTypes: ['font/woff2'] }),
])

export interface WebsiteAssetCacheInput {
  pathname: string
  method: string
  status: number
  contentType: string
  hasSetCookie?: boolean
}

/** Cache authority for static assets. A hash-shaped path is only immutable
 * when the asset response itself proves it is the complete expected object. */
export function classifyWebsiteAssetCache(input: WebsiteAssetCacheInput): string {
  const contentType = input.contentType.toLowerCase()
  const immutableRule = IMMUTABLE_ASSET_RULES.find(rule => rule.path.test(input.pathname))
  if (immutableRule) {
    const complete = input.method === 'GET' || input.method === 'HEAD'
    const expectedType = immutableRule.contentTypes.some(type => contentType.includes(type))
    return complete && input.status === 200 && expectedType && !input.hasSetCookie ? IMMUTABLE_CACHE : 'no-store'
  }
  if (/\.(json|md|txt)$/i.test(input.pathname)) {
    return input.status === 200 && (input.method === 'GET' || input.method === 'HEAD')
      ? 'public, max-age=300'
      : 'no-store'
  }
  if (contentType.includes('text/html') || input.status === 404) return 'no-cache'
  if (input.status !== 200) return 'no-store'
  if (HOURLY_STATIC_ASSET.test(input.pathname)) return 'public, max-age=3600'
  return 'no-cache'
}

function withTransportSecurity(response: Response, httpsRequest: boolean): Response {
  if (!httpsRequest) return response
  const headers = new Headers(response.headers)
  headers.set('Strict-Transport-Security', STRICT_TRANSPORT_SECURITY)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function withHeaders(response: Response, pathname: string, method: string, negotiatesHomepage = false): Response {
  const headers = new Headers(response.headers)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')

  const type = headers.get('content-type') || ''
  headers.delete('Cache-Control')
  if (type.includes('text/html')) headers.set('Content-Security-Policy', csp)

  if (/\.(json|md|txt)$/i.test(pathname)) headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Cache-Control', classifyWebsiteAssetCache({
    pathname,
    method,
    status: response.status,
    contentType: type,
    hasSetCookie: headers.has('Set-Cookie'),
  }))

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
      const httpsRequest = url.protocol === 'https:'
      const finish = (response: Response) => withTransportSecurity(response, httpsRequest)

      // Canonical scheme + host redirect. Keep this one hop: preserving http on
      // the www redirect would still expose the complete site over plaintext.
      // Scope the scheme redirect to production hosts so local Wrangler remains
      // usable over http.
      const productionHost = url.hostname === 'agentic-mermaid.dev' || url.hostname === 'www.agentic-mermaid.dev'
      if (productionHost && (!httpsRequest || url.hostname === 'www.agentic-mermaid.dev')) {
        url.protocol = 'https:'
        url.hostname = 'agentic-mermaid.dev'
        return finish(Response.redirect(url.toString(), 301))
      }

      const pathname = url.pathname.replace(/\/$/, '') || '/'

      const redirectTo = redirects.get(url.pathname) || redirects.get(pathname)
      if (redirectTo) return finish(Response.redirect(new URL(redirectTo + url.search + url.hash, url).toString(), 308))
      if ((cleanRoutes.has(pathname) || /^\/(warnings|errors)\/[^/.]+$/.test(pathname)) && !url.pathname.endsWith('/')) {
        return finish(Response.redirect(new URL(pathname + '/' + url.search + url.hash, url).toString(), 308))
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
        return finish(await handler(request))
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
      return finish(withHeaders(response, assetPathname, assetRequest.method, negotiatesHomepage))
    },
  }
}
