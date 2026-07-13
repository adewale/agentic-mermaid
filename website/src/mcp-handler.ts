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
//
// Observability: every HTTP request emits exactly ONE structured wide event
// (McpRequestEvent) through the injectable onEvent hook — console.log JSON by
// default, which Cloudflare Workers Logs ingests as queryable fields.

import { handleHostedRequest, cacheKeyFor, LOCAL_FALLBACK_HINT, SUPPORTED_PROTOCOL_VERSIONS, type HostedMcpContext } from '../../src/mcp/hosted-server.ts'
import { reply, rpcError, type JsonRpcRequest, type JsonRpcResponse } from '../../src/mcp/protocol.ts'
import { readCapped } from './execute-loader.ts'

export const MAX_MCP_BODY_BYTES = 128 * 1024
// Cap batch fan-out: one 128KB body could otherwise pack many tools/call items
// that all run concurrently, each spinning a billable isolate (execute) or
// render, amplifying a single request well past the per-IP WAF limit. A handful
// of calls covers legitimate batching (e.g. initialize + tools/list + a few
// renders); abuse-scale fan-out is refused.
export const MAX_BATCH_ITEMS = 20
// See the batch validation below: execute items get their own dynamic-worker
// isolate with a full cpuMs budget each, so they are capped per-request
// independently of the cheap declarative tools.
export const MAX_EXECUTE_ITEMS_PER_BATCH = 1

function isExecuteCall(message: unknown): boolean {
  const m = message as { method?: unknown; params?: { name?: unknown } } | null
  return !!m && m.method === 'tools/call' && m.params?.name === 'execute'
}
const CACHE_TTL_SECONDS = 86_400

export interface McpCache {
  match(key: Request): Promise<Response | undefined>
  put(key: Request, response: Response): Promise<void>
}

// ---- Wide-event logging -----------------------------------------------------
// One canonical log line per HTTP request (the "wide events" pattern): every
// fact the request accumulates — transport verdict, per-item tool outcomes,
// cache hits, timings — lands in a single structured JSON event emitted from a
// finally block, not scattered console lines. Payload contents (source / code /
// labels) are NEVER logged: sizes and codes only.

export interface McpItemEvent {
  /** Tool name for tools/call items; null for every other method. */
  tool: string | null
  /** The tool-level isError flag (or a JSON-RPC error response). */
  is_error: boolean
  /** Structured tool error code (e.g. SOURCE_TOO_LARGE) or JSON-RPC error code. */
  error_code: string | number | null
  cache_hit: boolean
  /** Dynamic Worker entrypoint calls made for this item; 0 if none started. */
  loader_attempts: 0 | 1 | 2
  /** The normalized Dynamic Worker cpuMs limit; null when no loader ran. */
  configured_cpu_limit_ms: number | null
  duration_ms: number
}

export interface McpRequestEvent {
  event: 'mcp_request'
  /** Unique per request — high cardinality is intentional in wide events. */
  request_id: string
  timestamp: string
  /** JSON-RPC method of a single request, 'batch' for a batch, null before parse. */
  method: string | null
  http_status: number
  outcome: 'success' | 'tool_error' | 'transport_error' | 'exception'
  duration_ms: number
  deploy_version: string
  /** JSON-RPC items in the body (1 for a single request, 0 before parse). */
  batch_size: number
  protocol_version: string | null
  /** Whether an Origin header was present — the value itself is not logged. */
  has_origin: boolean
  /** UTF-8 bytes of the body read (the declared length or the cap when refused). */
  body_bytes: number
  items: McpItemEvent[]
  /** Set when outcome is 'exception': bounded error class + stable code; no message, stack, or payload. */
  error?: { type: McpInternalErrorType; code: 'INTERNAL_ERROR' }
}

type McpInternalErrorType = 'Error' | 'TypeError' | 'RangeError' | 'SyntaxError' | 'ReferenceError' | 'EvalError' | 'URIError' | 'UnknownError'

export interface McpHandlerOptions {
  context: HostedMcpContext
  /** Cache for successful tools/call results; omit to disable caching. */
  cache?: McpCache
  /** Invalidates cached results across releases (typically the package version). */
  cacheVersion: string
  /** Defer cache writes past the response (ctx.waitUntil in the Worker). */
  waitUntil?: (p: Promise<unknown>) => void
  /** Receives the one wide event per HTTP request. Defaults to a single
   *  console.log(JSON.stringify(event)) — the shape Workers Logs ingests as a
   *  structured, queryable object. Injectable so tests assert on events. */
  onEvent?: (event: McpRequestEvent) => void
}

const CORS_BASE = {
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id',
  'access-control-max-age': '86400',
  'access-control-expose-headers': 'x-agentic-mermaid-compute-cache',
}

// Browser Origins allowed to read this endpoint cross-origin. Non-browser
// clients (agents, servers, curl) send no Origin and are always allowed — CORS
// governs only browser reads and cannot gate them anyway. An Origin-bearing
// (browser) caller is checked against this set plus same-origin and localhost.
const STATIC_ALLOWED_ORIGINS = new Set(['https://agentic-mermaid.dev'])

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

interface ExactJsonRpcId { sentinel: string; raw: string }

function json(status: number, payload: unknown, cors: Record<string, string>, exactIds: ExactJsonRpcId[] = [], extraHeaders: Record<string, string> = {}): Response {
  let body = JSON.stringify(payload)
  for (const id of exactIds) body = body.replaceAll(JSON.stringify(id.sentinel), id.raw)
  return new Response(body, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...cors,
      ...extraHeaders,
    },
  })
}

/** Protect unsafe integer ids before JSON.parse coerces them through Number.
 * Only the top-level JSON-RPC id of a single request or direct batch item is
 * rewritten; identically named fields inside params remain ordinary data. */
export function preserveUnsafeJsonRpcIds(body: string): { body: string; ids: ExactJsonRpcId[] } {
  const replacements: Array<ExactJsonRpcId & { start: number; end: number }> = []
  const stack: Array<'{' | '['> = []
  let i = 0
  const stringEnd = (start: number): number => {
    let j = start + 1
    while (j < body.length) {
      if (body[j] === '\\') { j += 2; continue }
      if (body[j] === '"') return j + 1
      j++
    }
    return j
  }
  while (i < body.length) {
    const ch = body[i]!
    if (ch === '"') {
      const end = stringEnd(i)
      let key: unknown
      try { key = JSON.parse(body.slice(i, end)) } catch { i = end; continue }
      const rpcObject = stack.length === 1 && stack[0] === '{'
        || stack.length === 2 && stack[0] === '[' && stack[1] === '{'
      let cursor = end
      while (/\s/.test(body[cursor] ?? '')) cursor++
      if (rpcObject && key === 'id' && body[cursor] === ':') {
        cursor++
        while (/\s/.test(body[cursor] ?? '')) cursor++
        const number = body.slice(cursor).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)?.[0]
        if (number && /^-?\d+$/.test(number)) {
          try {
            const value = BigInt(number)
            if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
              let sentinel = `__agentic_mermaid_exact_id_${replacements.length}__`
              while (body.includes(sentinel)) sentinel += '_'
              replacements.push({ sentinel, raw: number, start: cursor, end: cursor + number.length })
            }
          } catch { /* JSON.parse reports malformed numbers */ }
        }
      }
      i = end
      continue
    }
    if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') stack.pop()
    i++
  }
  let protectedBody = body
  for (const replacement of replacements.slice().reverse()) {
    protectedBody = protectedBody.slice(0, replacement.start) + JSON.stringify(replacement.sentinel) + protectedBody.slice(replacement.end)
  }
  return { body: protectedBody, ids: replacements.map(({ sentinel, raw }) => ({ sentinel, raw })) }
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

function newItemEvent(): McpItemEvent {
  return {
    tool: null,
    is_error: false,
    error_code: null,
    cache_hit: false,
    loader_attempts: 0,
    configured_cpu_limit_ms: null,
    duration_ms: 0,
  }
}

function internalErrorType(error: unknown): McpInternalErrorType {
  if (error instanceof TypeError) return 'TypeError'
  if (error instanceof RangeError) return 'RangeError'
  if (error instanceof SyntaxError) return 'SyntaxError'
  if (error instanceof ReferenceError) return 'ReferenceError'
  if (error instanceof EvalError) return 'EvalError'
  if (error instanceof URIError) return 'URIError'
  if (error instanceof Error) return 'Error'
  return 'UnknownError'
}

/** Scope the execution telemetry callback to the item which started the
 * loader. A test/local context that does not implement the optional callback
 * still truthfully records the one execute call it received. */
function contextForItem(context: HostedMcpContext, item: McpItemEvent): HostedMcpContext {
  return {
    ...context,
    async execute(code, timeoutMs) {
      item.configured_cpu_limit_ms = timeoutMs
      let reported = false
      try {
        return await context.execute(code, timeoutMs, telemetry => {
          item.loader_attempts = telemetry.loaderAttempts
          reported = true
        })
      } finally {
        if (!reported) item.loader_attempts = 1
      }
    },
  }
}

/** Fill an item's error fields from its JSON-RPC response: the tool-level
 *  isError flag, plus a structured code when the payload carries one — the
 *  code only, never the payload itself. */
function recordItemOutcome(item: McpItemEvent, response: JsonRpcResponse | null): void {
  if (response === null) return // notification: nothing to record
  if (response.error) {
    item.is_error = true
    item.error_code = response.error.code
    return
  }
  const result = response.result as { isError?: boolean; content?: Array<{ text?: string }> } | undefined
  if (result?.isError !== true) return
  item.is_error = true
  try {
    const payload = JSON.parse(result.content?.[0]?.text ?? '') as { error?: { code?: unknown } }
    const code = payload.error?.code
    if (typeof code === 'string' || typeof code === 'number') item.error_code = code
  } catch { /* unstructured tool error: is_error stands with no code */ }
}

export function createMcpHandler(options: McpHandlerOptions): (request: Request) => Promise<Response> {
  const { context, cache, cacheVersion, waitUntil } = options
  const onEvent = options.onEvent ?? ((event: McpRequestEvent) => console.log(JSON.stringify(event)))

  async function handleOne(req: unknown, item: McpItemEvent): Promise<JsonRpcResponse | null> {
    const started = Date.now()
    const r = req as JsonRpcRequest | null
    let response: JsonRpcResponse | null
    if (!r || typeof r !== 'object' || r.jsonrpc !== '2.0' || typeof r.method !== 'string') {
      response = rpcError(null, -32600, 'invalid JSON-RPC request')
    } else {
      if (r.method === 'tools/call') {
        const name = (r.params as { name?: unknown } | undefined)?.name
        item.tool = typeof name === 'string' ? name : null
      }
      const itemContext = contextForItem(context, item)
      response = r.method === 'tools/call' && cache
        ? await handleCachedToolCall(r, item, itemContext)
        : await handleHostedRequest(r, itemContext)
    }
    item.duration_ms = Date.now() - started
    recordItemOutcome(item, response)
    return response
  }

  async function handleCachedToolCall(req: JsonRpcRequest, item: McpItemEvent, itemContext: HostedMcpContext): Promise<JsonRpcResponse | null> {
    // Key on the normalized, output-affecting arguments (not raw params): junk
    // or out-of-range args cannot bust the cache or force recompute. A null
    // canonical form means "not cacheable" — run the request directly (it will
    // error, and errors are not cached anyway).
    const p = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined
    const canonical = cacheKeyFor(p?.name, p?.arguments ?? {})
    if (canonical === null) return handleHostedRequest(req, itemContext)
    const key = new Request(`https://mcp-cache.agentic-mermaid.dev/${encodeURIComponent(cacheVersion)}/${await sha256Hex(JSON.stringify(sortKeys(canonical)))}`)
    try {
      const hit = await cache!.match(key)
      if (hit) {
        item.cache_hit = true
        return reply(req.id ?? null, await hit.json())
      }
    } catch { /* cache failures must never fail the call */ }
    const response = await handleHostedRequest(req, itemContext)
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

  // The transport body, instrumented: `event` accumulates the wide-event
  // fields as the request moves through validation, parse, and dispatch.
  async function respond(request: Request, event: McpRequestEvent): Promise<Response> {
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
      return json(405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'use POST with a JSON-RPC body; this MCP endpoint is stateless and offers no server-initiated stream' } }, cors, [], { Allow: 'POST, OPTIONS' })
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
      event.body_bytes = declared
      return json(413, { jsonrpc: '2.0', id: null, error: { code: -32000, message: `request body exceeds ${MAX_MCP_BODY_BYTES} bytes; ${LOCAL_FALLBACK_HINT}` } }, cors)
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
      event.body_bytes = MAX_MCP_BODY_BYTES // read cancelled at the cap; true size unknown
      return json(413, { jsonrpc: '2.0', id: null, error: { code: -32000, message: `request body exceeds ${MAX_MCP_BODY_BYTES} bytes; ${LOCAL_FALLBACK_HINT}` } }, cors)
    }
    event.body_bytes = new TextEncoder().encode(body).length
    let parsed: unknown
    const exact = preserveUnsafeJsonRpcIds(body)
    try {
      parsed = JSON.parse(exact.body)
    } catch (e) {
      return json(400, rpcError(null, -32700, `parse error: ${e instanceof Error ? e.message : 'invalid JSON'}`), cors)
    }

    if (Array.isArray(parsed)) {
      event.method = 'batch'
      event.batch_size = parsed.length
      // 2025-06-18 removed JSON-RPC batching: a client that pins that version via
      // the header must send a single message. Older negotiated versions
      // (2024-11-05 / 2025-03-26, or no header) may still batch.
      if (protocolVersion === '2025-06-18') {
        return json(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'JSON-RPC batching was removed in MCP 2025-06-18; send a single message' } }, cors, exact.ids)
      }
      if (parsed.length === 0) return json(400, rpcError(null, -32600, 'empty batch'), cors, exact.ids)
      // Bound fan-out before running any item: a single request must not spin an
      // unbounded number of billable isolates/renders (see MAX_BATCH_ITEMS).
      if (parsed.length > MAX_BATCH_ITEMS) {
        return json(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: `batch exceeds the ${MAX_BATCH_ITEMS}-request limit` } }, cors, exact.ids)
      }
      // execute is the one tool with its own per-item isolate CPU budget, so it
      // is the one batch amplifier: 20 executes × 30s cpuMs = 600 billable
      // CPU-seconds from one HTTP request, while pure tools share the parent
      // request's own CPU cap. Measured worst legit item (64KB flowchart,
      // parse+verify+serialize) needs ~18s of that 30s budget, so the per-item
      // budget stays; the amplification goes. Real MCP clients send one
      // tools/call per request, so a 1-per-request execute cap costs nothing.
      const executeItems = parsed.filter((p) => isExecuteCall(p)).length
      if (executeItems > MAX_EXECUTE_ITEMS_PER_BATCH) {
        return json(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: `a batch may contain at most ${MAX_EXECUTE_ITEMS_PER_BATCH} execute call (execute runs in its own CPU-budgeted isolate); send execute calls as separate requests` } }, cors, exact.ids)
      }
      // One event per request even for batches: each item gets an entry, not a line.
      event.items = parsed.map(() => newItemEvent())
      const responses = (await Promise.all(parsed.map((p, i) => handleOne(p, event.items[i]!)))).filter((r): r is JsonRpcResponse => r !== null)
      return responses.length === 0 ? new Response(null, { status: 202, headers: { ...cors, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } }) : json(200, responses, cors, exact.ids)
    }
    event.method = typeof (parsed as { method?: unknown } | null)?.method === 'string' ? (parsed as { method: string }).method : null
    event.batch_size = 1
    event.items = [newItemEvent()]
    const response = await handleOne(parsed, event.items[0]!)
    return response === null ? new Response(null, { status: 202, headers: { ...cors, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } }) : json(200, response, cors, exact.ids)
  }

  return async (request: Request): Promise<Response> => {
    const started = Date.now()
    const event: McpRequestEvent = {
      event: 'mcp_request',
      request_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      method: null,
      http_status: 0,
      outcome: 'success',
      duration_ms: 0,
      deploy_version: cacheVersion, // the full-deploy hash in production wiring
      batch_size: 0,
      protocol_version: request.headers.get('mcp-protocol-version'),
      has_origin: request.headers.get('origin') !== null,
      body_bytes: 0,
      items: [],
    }
    try {
      const response = await respond(request, event)
      event.http_status = response.status
      // Dispatched items decide success vs tool_error; a request refused before
      // dispatch (4xx from the transport itself) is a transport error. OPTIONS
      // preflights and pure-notification 202s count as success.
      event.outcome = event.items.length > 0
        ? (event.items.some(i => i.is_error) ? 'tool_error' : 'success')
        : response.status < 400 ? 'success' : 'transport_error'
      const headers = new Headers(response.headers)
      const toolItems = event.items.filter(item => item.tool !== null)
      const cacheStatus = !cache ? 'disabled'
        : toolItems.length === 0 ? 'bypass'
          : toolItems.every(item => item.cache_hit) ? 'hit'
            : toolItems.some(item => item.cache_hit) ? 'mixed' : 'miss'
      headers.set('x-agentic-mermaid-compute-cache', cacheStatus)
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    } catch (e) {
      // The event must survive an escaping exception without recording a
      // user-controlled message, stack, request body, or code string.
      event.http_status = 500
      event.outcome = 'exception'
      event.error = { type: internalErrorType(e), code: 'INTERNAL_ERROR' }
      return json(500, rpcError(null, -32603, 'internal error'), corsHeadersFor(request))
    } finally {
      event.duration_ms = Date.now() - started
      onEvent(event)
    }
  }
}
