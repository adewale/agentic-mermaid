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

import { handleHostedRequest, type HostedMcpContext } from '../../src/mcp/hosted-server.ts'
import { reply, rpcError, type JsonRpcRequest, type JsonRpcResponse } from '../../src/mcp/protocol.ts'

export const MAX_MCP_BODY_BYTES = 128 * 1024
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

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id',
  'access-control-max-age': '86400',
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...CORS_HEADERS,
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
    const key = new Request(`https://mcp-cache.agenticmermaid.dev/${encodeURIComponent(cacheVersion)}/${await sha256Hex(JSON.stringify(sortKeys(req.params)))}`)
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
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
    if (request.method !== 'POST') {
      return json(405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'use POST with a JSON-RPC body; this MCP endpoint is stateless and offers no server-initiated stream' } })
    }
    const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
    if (!contentType.startsWith('application/json')) {
      return json(415, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'content-type must be application/json' } })
    }
    const declared = Number(request.headers.get('content-length') ?? 0)
    if (Number.isFinite(declared) && declared > MAX_MCP_BODY_BYTES) {
      return json(413, { jsonrpc: '2.0', id: null, error: { code: -32000, message: `request body exceeds ${MAX_MCP_BODY_BYTES} bytes` } })
    }
    let body: string
    try {
      body = await request.text()
    } catch {
      return json(400, rpcError(null, -32700, 'unreadable request body'))
    }
    if (new TextEncoder().encode(body).length > MAX_MCP_BODY_BYTES) {
      return json(413, { jsonrpc: '2.0', id: null, error: { code: -32000, message: `request body exceeds ${MAX_MCP_BODY_BYTES} bytes` } })
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch (e) {
      return json(400, rpcError(null, -32700, `parse error: ${e instanceof Error ? e.message : 'invalid JSON'}`))
    }

    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return json(400, rpcError(null, -32600, 'empty batch'))
      const responses = (await Promise.all(parsed.map(handleOne))).filter((r): r is JsonRpcResponse => r !== null)
      return responses.length === 0 ? new Response(null, { status: 202, headers: CORS_HEADERS }) : json(200, responses)
    }
    const response = await handleOne(parsed)
    return response === null ? new Response(null, { status: 202, headers: CORS_HEADERS }) : json(200, response)
  }
}
