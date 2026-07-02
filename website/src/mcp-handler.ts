// Stateless Streamable HTTP transport for the hosted MCP server.
//
// One endpoint: POST /mcp with a JSON-RPC request (or 2025-03-26 batch),
// answered as application/json. No sessions, no SSE stream — every tool is a
// pure function of its arguments. GET/DELETE return 405 as the Streamable
// HTTP spec allows for servers that don't offer a server-initiated stream.
//
// Layout is deterministic, so successful tools/call results are cached in the
// (injected) Cache API keyed on a hash of the canonicalized call — repeat
// renders skip compute and repeat execute calls skip the dynamic isolate.

import { handleHostedRequest, cacheKeyFor, SUPPORTED_PROTOCOL_VERSIONS, type HostedMcpContext } from '../../src/mcp/hosted-server.ts'
import { reply, rpcError, type JsonRpcRequest, type JsonRpcResponse } from '../../src/mcp/protocol.ts'
import { readCapped } from './execute-loader.ts'

export const MAX_MCP_BODY_BYTES = 128 * 1024
// Cap batch fan-out: one 128KB body could otherwise pack many tools/call items
// that all run concurrently, each spinning a billable isolate (execute) or
// render, amplifying a single request well past the per-IP WAF limit. A handful
// of calls covers legitimate batching (e.g. initialize + tools/list + a few
// renders); abuse-scale fan-out is refused.
export const MAX_BATCH_ITEMS = 20
const CACHE_TTL_SECONDS = 86_400

export interface McpCache {
  match(key: Request): Promise<Response | undefined>
  put(key: Request, response: Response): Promise<void>
}

export interface McpHandlerOptions {
  context: HostedMcpContext
  /** Cache for successful tools/call results; omit to disable caching. */
  cache?: McpCache
  /** Invalidates cached results across releases (typically the package version). */
  cacheVersion: string
  /** Defer cache writes past the response (ctx.waitUntil in the Worker). */
  waitUntil?: (p: Promise<unknown>) => void
}

const CORS_BASE = {
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id',
  'access-control-max-age': '86400',
}

// Browser Origins allowed to read this endpoint cross-origin. Non-browser
// clients (agents, servers, curl) send no Origin and are always allowed — CORS
// governs only browser reads and cannot gate them anyway. An Origin-bearing
// (browser) caller is checked against this set plus same-origin and localhost.
const STATIC_ALLOWED_ORIGINS = new Set(['https://agenticmermaid.dev'])

function isOriginAllowed(origin: string, host: string | null): boolean {
  if (STATIC_ALLOWED_ORIGINS.has(origin)) return true
  try {
    const o = new URL(origin)
    if (o.hostname === 'localhost' || o.hostname === '127.0.0.1') return true
    if (host !== null && o.host === host) return true
  } catch { /* malformed Origin header → not allowed */ }
  return false
}

/**
 * Reflective CORS with Origin validation (MCP Streamable HTTP security
 * guidance). A request with no Origin is a non-browser client and gets `*`
 * (CORS cannot gate it anyway). A browser Origin is echoed back only when it is
 * same-origin / localhost / allowlisted, so an arbitrary site cannot silently
 * drive a visitor's browser against this public compute endpoint — the one
 * abuse vector wildcard CORS leaves open. A disallowed Origin gets no
 * Access-Control-Allow-Origin (the browser blocks the read) and is additionally
 * refused with 403 on the request path.
 */
function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get('origin')
  if (origin === null) return { 'access-control-allow-origin': '*', ...CORS_BASE }
  if (isOriginAllowed(origin, request.headers.get('host'))) {
    return { 'access-control-allow-origin': origin, vary: 'Origin', ...CORS_BASE }
  }
  return { vary: 'Origin', ...CORS_BASE }
}

function json(status: number, payload: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...cors,
    },
  })
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, sortKeys(v)]))
  }
  return value
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

export function createMcpHandler(options: McpHandlerOptions): (request: Request) => Promise<Response> {
  const { context, cache, cacheVersion, waitUntil } = options

  async function handleOne(req: unknown): Promise<JsonRpcResponse | null> {
    const r = req as JsonRpcRequest | null
    if (!r || typeof r !== 'object' || r.jsonrpc !== '2.0' || typeof r.method !== 'string') {
      return rpcError((r as JsonRpcRequest | null)?.id ?? null, -32600, 'invalid JSON-RPC request')
    }
    if (r.method === 'tools/call' && cache) return handleCachedToolCall(r)
    return handleHostedRequest(r, context)
  }

  async function handleCachedToolCall(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    // Key on the normalized, output-affecting arguments (not raw params): junk
    // or out-of-range args cannot bust the cache or force recompute. A null
    // canonical form means "not cacheable" — run the request directly (it will
    // error, and errors are not cached anyway).
    const p = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined
    const canonical = cacheKeyFor(p?.name, p?.arguments ?? {})
    if (canonical === null) return handleHostedRequest(req, context)
    const key = new Request(`https://mcp-cache.agenticmermaid.dev/${encodeURIComponent(cacheVersion)}/${await sha256Hex(JSON.stringify(sortKeys(canonical)))}`)
    try {
      const hit = await cache!.match(key)
      if (hit) return reply(req.id ?? null, await hit.json())
    } catch { /* cache failures must never fail the call */ }
    const response = await handleHostedRequest(req, context)
    const result = response?.result as { isError?: boolean } | undefined
    if (result && result.isError === false) {
      const write = cache!.put(key, new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${CACHE_TTL_SECONDS}` },
      })).catch(() => {})
      if (waitUntil) waitUntil(write)
      else await write
    }
    return response
  }

  return async (request: Request): Promise<Response> => {
    const cors = corsHeadersFor(request)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    // MCP Origin validation: refuse a cross-origin browser request whose Origin
    // is not allowlisted before any tool runs. Non-browser clients (no Origin)
    // pass. Closes the "malicious site drives visitors' browsers against public
    // compute" vector that wildcard CORS leaves open.
    const origin = request.headers.get('origin')
    if (origin !== null && !isOriginAllowed(origin, request.headers.get('host'))) {
      return json(403, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'origin not allowed' } }, cors)
    }
    if (request.method !== 'POST') {
      return json(405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'use POST with a JSON-RPC body; this MCP endpoint is stateless and offers no server-initiated stream' } }, cors)
    }
    // MCP-Protocol-Version validation: an explicit unsupported version is 400
    // (a missing header stays permitted for pre-2025-06-18 clients that never
    // send one). Used below to enforce that revision's single-message rule.
    const protocolVersion = request.headers.get('mcp-protocol-version')
    if (protocolVersion !== null && !SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)) {
      return json(400, { jsonrpc: '2.0', id: null, error: { code: -32000, message: `unsupported MCP-Protocol-Version: ${protocolVersion}` } }, cors)
    }
    const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
    if (!contentType.startsWith('application/json')) {
      return json(415, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'content-type must be application/json' } }, cors)
    }
    const declared = Number(request.headers.get('content-length') ?? 0)
    if (Number.isFinite(declared) && declared > MAX_MCP_BODY_BYTES) {
      return json(413, { jsonrpc: '2.0', id: null, error: { code: -32000, message: `request body exceeds ${MAX_MCP_BODY_BYTES} bytes` } }, cors)
    }
    // Stream-read with a hard cap so an oversized chunked body (no or false
    // Content-Length) is cancelled at the limit instead of buffered whole.
    let body: string | null
    try {
      body = await readCapped(request.body, MAX_MCP_BODY_BYTES)
    } catch {
      return json(400, rpcError(null, -32700, 'unreadable request body'), cors)
    }
    if (body === null) {
      return json(413, { jsonrpc: '2.0', id: null, error: { code: -32000, message: `request body exceeds ${MAX_MCP_BODY_BYTES} bytes` } }, cors)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch (e) {
      return json(400, rpcError(null, -32700, `parse error: ${e instanceof Error ? e.message : 'invalid JSON'}`), cors)
    }

    if (Array.isArray(parsed)) {
      // 2025-06-18 removed JSON-RPC batching: a client that pins that version via
      // the header must send a single message. Older negotiated versions
      // (2024-11-05 / 2025-03-26, or no header) may still batch.
      if (protocolVersion === '2025-06-18') {
        return json(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'JSON-RPC batching was removed in MCP 2025-06-18; send a single message' } }, cors)
      }
      if (parsed.length === 0) return json(400, rpcError(null, -32600, 'empty batch'), cors)
      // Bound fan-out before running any item: a single request must not spin an
      // unbounded number of billable isolates/renders (see MAX_BATCH_ITEMS).
      if (parsed.length > MAX_BATCH_ITEMS) {
        return json(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: `batch exceeds the ${MAX_BATCH_ITEMS}-request limit` } }, cors)
      }
      const responses = (await Promise.all(parsed.map(handleOne))).filter((r): r is JsonRpcResponse => r !== null)
      return responses.length === 0 ? new Response(null, { status: 202, headers: cors }) : json(200, responses, cors)
    }
    const response = await handleOne(parsed)
    return response === null ? new Response(null, { status: 202, headers: cors }) : json(200, response, cors)
  }
}
