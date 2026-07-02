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

function withHeaders(response, pathname) {
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
  async fetch(request, env) {
    const url = new URL(request.url)
    const pathname = url.pathname.replace(/\/$/, '') || '/'

    const redirectTo = redirects.get(url.pathname) || redirects.get(pathname)
    if (redirectTo) return Response.redirect(new URL(redirectTo + url.search + url.hash, url), 308)
    if ((cleanRoutes.has(pathname) || /^\/(warnings|errors)\/[^/.]+$/.test(pathname)) && !url.pathname.endsWith('/')) {
      return Response.redirect(new URL(pathname + '/' + url.search + url.hash, url), 308)
    }

    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      return new Response(JSON.stringify({
        error: 'hosted_mcp_not_enabled',
        message: 'This Workers Static Assets preview does not enable the optional hosted MCP route. Use local agentic-mermaid-mcp over stdio.',
        recommended: 'self-host',
      }, null, 2) + '\n', {
        status: 501,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'strict-origin-when-cross-origin',
          'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        },
      })
    }

    const response = await env.ASSETS.fetch(request)
    return withHeaders(response, url.pathname)
  },
}
