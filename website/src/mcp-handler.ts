// Stateless Streamable HTTP transport for the hosted MCP server.
//
// One endpoint: POST /mcp with a JSON-RPC request (or 2025-03-26 batch),
// answered as application/json. No sessions and no SSE stream. GET/DELETE
// return 405 as the Streamable HTTP spec allows for servers that don't offer
// a server-initiated stream.
//
// Successful deterministic pure-tool results are cached privately in the
// injected Cache API. Code Mode execute is deliberately excluded because its
// sandbox exposes time and randomness.
//
// Observability: every HTTP request emits exactly ONE structured wide event
// (McpRequestEvent) through the injectable onEvent hook — console.log JSON by
// default, which Cloudflare Workers Logs ingests as queryable fields.

import { admitHostedRequest, handleAdmittedHostedRequest, cacheKeyFor, HOSTED_MCP_SERVER_NAME, LOCAL_FALLBACK_HINT, SUPPORTED_PROTOCOL_VERSIONS, type HostedMcpContext } from '../../src/mcp/hosted-server.ts'
import { isJsonContentType, preserveExactJsonRpcIds, reply, rpcError, stringifyJsonRpc, type ExactJsonRpcId, type JsonRpcRequest, type JsonRpcResponse } from '../../src/mcp/protocol.ts'
import {
  isAdmittedMcpRequest,
  type AdmittedMcpMessage,
  type AdmittedMcpRequest,
  type McpAdmissionResult,
} from '../../src/mcp/admission.ts'
import { decorateMcpResult, protocolNeutralMcpResult } from '../../src/mcp/tool-surface.ts'
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
  /** Whether this item had a deterministic private-cache key. */
  cache_eligible: boolean
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
  // mcp-method / mcp-name are REQUIRED on every modern (2026-07-28) request, so
  // a browser client's preflight fails outright without them here. mcp-session-id
  // is retained only for legacy clients that still send it; we never read it.
  'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id, mcp-method, mcp-name',
  'access-control-max-age': '86400',
  'access-control-expose-headers': 'x-agentic-mermaid-compute-cache',
}

const BASE64_SENTINEL_PREFIX = '=?base64?'
const BASE64_SENTINEL_SUFFIX = '?='

/** Decode a standard header value that may carry the spec's Base64 sentinel.
 *  Returns null when the sentinel is present but undecodable — which is a
 *  validation failure, not a value. */
function decodeHeaderValue(value: string): string | null {
  if (!value.startsWith(BASE64_SENTINEL_PREFIX) || !value.endsWith(BASE64_SENTINEL_SUFFIX)) return value
  const encoded = value.slice(BASE64_SENTINEL_PREFIX.length, value.length - BASE64_SENTINEL_SUFFIX.length)
  try {
    const binary = atob(encoded)
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** The value Mcp-Name mirrors, per method. Only tools/call applies to us; the
 *  other two are listed so the rule reads the same as the spec's table. */
function mcpNameSourceValue(message: unknown): string | undefined {
  const m = message as { method?: unknown; params?: { name?: unknown; uri?: unknown } } | null
  if (!m || !m.params || typeof m.params !== 'object') return undefined
  if (m.method === 'tools/call' || m.method === 'prompts/get') {
    return typeof m.params.name === 'string' ? m.params.name : undefined
  }
  if (m.method === 'resources/read') {
    return typeof m.params.uri === 'string' ? m.params.uri : undefined
  }
  return undefined
}

/**
 * Modern-era routing-header validation. Admission has already proved the
 * protocol-version header mirrors the body; the remaining headers mirror the
 * method-specific fields so that
 * intermediaries can route without parsing; the server must therefore prove the
 * two agree, "to prevent potential security vulnerabilities when different
 * components in the network rely on different sources of truth". A disagreement
 * — or a missing required header — is -32020 with HTTP 400.
 */
function modernRoutingHeaderProblem(request: Request, message: JsonRpcRequest): string | null {
  const method = (message as { method?: unknown } | null)?.method
  const methodHeader = request.headers.get('mcp-method')
  if (methodHeader === null) return 'Mcp-Method header is required'
  if (methodHeader !== method) {
    return `Mcp-Method header value '${methodHeader}' does not match body value '${String(method)}'`
  }

  const nameSource = mcpNameSourceValue(message)
  if (nameSource === undefined) return null // Mcp-Name is not required for this method
  const nameHeader = request.headers.get('mcp-name')
  if (nameHeader === null) return `Mcp-Name header is required for ${String(method)}`
  const decoded = decodeHeaderValue(nameHeader)
  if (decoded === null) return 'Mcp-Name header uses the Base64 sentinel but is not decodable UTF-8'
  if (decoded !== nameSource) {
    return `Mcp-Name header value '${decoded}' does not match body value '${nameSource}'`
  }
  return null
}

// Browser Origins allowed to read this endpoint cross-origin. Non-browser
// clients (agents, servers, curl) send no Origin and are always allowed — CORS
// governs only browser reads and cannot gate them anyway. An Origin-bearing
// (browser) caller is checked against this set plus same-origin and localhost.
const STATIC_ALLOWED_ORIGINS = new Set(['https://agentic-mermaid.dev'])

function isOriginAllowed(origin: string, requestOrigin: string): boolean {
  if (STATIC_ALLOWED_ORIGINS.has(origin)) return true
  try {
    const o = new URL(origin)
    if ((o.protocol === 'http:' || o.protocol === 'https:') && (o.hostname === 'localhost' || o.hostname === '127.0.0.1')) return true
    if (o.origin === requestOrigin) return true
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
  if (isOriginAllowed(origin, new URL(request.url).origin)) {
    return { 'access-control-allow-origin': origin, vary: 'Origin', ...CORS_BASE }
  }
  return { vary: 'Origin', ...CORS_BASE }
}

function json(status: number, payload: unknown, cors: Record<string, string>, exactIds: ExactJsonRpcId[] = [], extraHeaders: Record<string, string> = {}): Response {
  const body = stringifyJsonRpc(payload, exactIds)
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

/**
 * A transport-level refusal, answered WITHOUT a JSON-RPC envelope.
 *
 * These five paths reject before a JSON-RPC request is ever parsed — a GET has
 * no body, and the content-type and body-size checks refuse precisely because
 * they will not read one. Wrapping that in `{"jsonrpc":"2.0","id":null,...}`
 * claimed to answer a request that does not exist, and forced an error code:
 * we used `-32000`, from the legacy sub-range new implementations "SHOULD NOT
 * use … at all" and whose meaning receivers "MUST NOT assume". So the code
 * conveyed nothing while the envelope implied a protocol exchange.
 *
 * The line this draws: a JSON-RPC envelope iff the spec defines a JSON-RPC
 * error for the condition. `-32020`, `-32022`, and `-32601` keep theirs. These
 * do not, and the HTTP status — 403, 405, 413, 415 — is the machine signal,
 * with the message left readable for the agent that hits it.
 */
function transportError(status: number, message: string, cors: Record<string, string>, extraHeaders: Record<string, string> = {}): Response {
  return json(status, { error: message }, cors, [], extraHeaders)
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
    cache_eligible: false,
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

  async function handleOne(message: AdmittedMcpMessage, item: McpItemEvent): Promise<JsonRpcResponse | null> {
    const started = Date.now()
    const { request } = message
    if (request.method === 'tools/call') {
      const name = (request.params as { name?: unknown } | undefined)?.name
      item.tool = typeof name === 'string' ? name : null
    }
    const itemContext = contextForItem(context, item)
    // Refine to AdmittedMcpRequest before cache code, which constructs a JSON-RPC
    // response directly on hits and therefore cannot accept a notification.
    const response = request.method === 'tools/call' && cache && isAdmittedMcpRequest(message)
      ? await handleCachedToolCall(message, item, itemContext)
      : await handleAdmittedHostedRequest(message, itemContext)
    item.duration_ms = Date.now() - started
    recordItemOutcome(item, response)
    return response
  }

  async function handleCachedToolCall(message: AdmittedMcpRequest, item: McpItemEvent, itemContext: HostedMcpContext): Promise<JsonRpcResponse | null> {
    const { request: req, protocol } = message
    // Key eligible pure tools on their complete raw argument object. Lookup is
    // pre-dispatch, so dropping even an apparently ignored argument could let a
    // later invalid request collide with a warm valid result and skip its
    // validation. A null form means "not cacheable" (including execute).
    const p = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined
    const canonical = cacheKeyFor(p?.name, p?.arguments ?? {})
    if (canonical === null) return handleAdmittedHostedRequest(message, itemContext)
    item.cache_eligible = true
    const cachePartition = {
      era: protocol.era,
      protocolVersion: protocol.version ?? 'unversioned',
      call: canonical,
    }
    const key = new Request(`https://mcp-cache.agentic-mermaid.dev/${encodeURIComponent(cacheVersion)}/${await sha256Hex(JSON.stringify(sortKeys(cachePartition)))}`)
    try {
      const hit = await cache!.match(key)
      if (hit) {
        item.cache_hit = true
        return decorateMcpResult(
          reply(message.id, await hit.json()),
          req.method,
          protocol.era,
          HOSTED_MCP_SERVER_NAME,
        )
      }
    } catch { /* cache failures must never fail the call */ }
    const response = await handleAdmittedHostedRequest(message, itemContext)
    const result = response?.result as { isError?: boolean } | undefined
    if (result && result.isError === false) {
      const write = cache!.put(key, new Response(JSON.stringify(protocolNeutralMcpResult(result)), {
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
    // MCP Origin validation: refuse a cross-origin browser request whose Origin
    // is not allowlisted before any tool runs. Non-browser clients (no Origin)
    // pass. Closes the "malicious site drives visitors' browsers against public
    // compute" vector that wildcard CORS leaves open.
    const origin = request.headers.get('origin')
    if (origin !== null && !isOriginAllowed(origin, new URL(request.url).origin)) {
      return transportError(403, 'origin not allowed', cors)
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST') {
      return transportError(405, 'use POST with a JSON-RPC body; this MCP endpoint is stateless and offers no server-initiated stream', cors, { Allow: 'POST, OPTIONS' })
    }
    // A missing header stays permitted for pre-2025-06-18 clients. Explicit
    // unsupported versions are rejected by message admission after the bounded
    // body parse so a request error can echo its JSON-RPC id.
    const protocolVersion = request.headers.get('mcp-protocol-version')
    if (!isJsonContentType(request.headers.get('content-type'))) {
      return transportError(415, 'content-type must be application/json', cors)
    }
    const declared = Number(request.headers.get('content-length') ?? 0)
    if (Number.isFinite(declared) && declared > MAX_MCP_BODY_BYTES) {
      event.body_bytes = declared
      return transportError(413, `request body exceeds ${MAX_MCP_BODY_BYTES} bytes; ${LOCAL_FALLBACK_HINT}`, cors)
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
      return transportError(413, `request body exceeds ${MAX_MCP_BODY_BYTES} bytes; ${LOCAL_FALLBACK_HINT}`, cors)
    }
    event.body_bytes = new TextEncoder().encode(body).length
    let parsed: unknown
    const exact = preserveExactJsonRpcIds(body)
    try {
      parsed = JSON.parse(exact.body)
    } catch (e) {
      return json(400, rpcError(null, -32700, `parse error: ${e instanceof Error ? e.message : 'invalid JSON'}`), cors)
    }

    if (Array.isArray(parsed)) {
      event.method = 'batch'
      event.batch_size = parsed.length
      // A batch has no single request id to correlate. Reject an unsupported
      // transport pin before applying the revision-specific batch rule.
      if (protocolVersion !== null && !SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)) {
        return json(400, rpcError(null, -32022, `Unsupported protocol version: ${protocolVersion}`, {
          supported: [...SUPPORTED_PROTOCOL_VERSIONS], requested: protocolVersion,
        }), cors, exact.ids)
      }
      // 2025-06-18 removed JSON-RPC batching, and every later revision keeps it
      // removed — 2026-07-28 requires the POST body to be a SINGLE request or
      // notification. Compared lexically, which is chronological for ISO dates,
      // so a new revision inherits the rule instead of needing a new branch.
      // The original Streamable HTTP revision (2025-03-26, or no header) may
      // still batch.
      if (protocolVersion !== null && protocolVersion >= '2025-06-18') {
        return json(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: `JSON-RPC batching was removed in MCP 2025-06-18; send a single message (negotiated ${protocolVersion})` } }, cors, exact.ids)
      }
      if (parsed.length === 0) return json(400, rpcError(null, -32600, 'empty batch'), cors, exact.ids)
      // A batch whose items declare a modern version in `_meta` is refused even
      // without a pinning header: the body is the authority for the era, and
      // the modern revision has no batch form at all.
      const batchAdmissions = parsed.map(item => admitHostedRequest(item, { headerVersion: protocolVersion }))
      if (batchAdmissions.some(admission => admission.ok
        ? admission.message.protocol.era === 'modern'
        : admission.requestedEra === 'modern' || admission.protocol?.era === 'modern')) {
        return json(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'JSON-RPC batching does not exist in this MCP revision; send a single message' } }, cors, exact.ids)
      }
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
      const responses = (await Promise.all(batchAdmissions.map(async (admission, i) => {
        const item = event.items[i]!
        if (admission.ok) return handleOne(admission.message, item)
        recordItemOutcome(item, admission.response)
        return admission.response
      }))).filter((r): r is JsonRpcResponse => r !== null)
      return responses.length === 0 ? new Response(null, { status: 202, headers: { ...cors, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } }) : json(200, responses, cors, exact.ids)
    }
    event.method = typeof (parsed as { method?: unknown } | null)?.method === 'string' ? (parsed as { method: string }).method : null
    event.batch_size = 1

    event.items = [newItemEvent()]
    const admission: McpAdmissionResult = admitHostedRequest(parsed, {
      headerVersion: protocolVersion,
      requireModernVersionHeader: true,
      modernTransportProblem: message => modernRoutingHeaderProblem(request, message),
    })
    if (!admission.ok) {
      recordItemOutcome(event.items[0]!, admission.response)
      if (admission.response === null) {
        return new Response(null, { status: 400, headers: { ...cors, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
      }
      return json(admission.kind === 'invalid-request' ? 200 : 400, admission.response, cors, exact.ids)
    }
    const modern = admission.message.protocol.era === 'modern'
    const response = await handleOne(admission.message, event.items[0]!)
    if (response === null) {
      return new Response(null, { status: 202, headers: { ...cors, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
    }
    // Modern servers MUST answer an unimplemented method with 404, so a client
    // can tell "this server does not have that RPC" from "this server is not
    // there". Legacy requests keep 200 + the JSON-RPC error they expect today.
    const status = modern && response.error?.code === -32601
      ? 404
      : modern && response.error?.code === -32602
        ? 400
        : 200
    return json(status, response, cors, exact.ids)
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
      const eligibleItems = toolItems.filter(item => item.cache_eligible)
      const cacheStatus = !cache ? 'disabled'
        : toolItems.length === 0 ? 'bypass'
          : eligibleItems.length === 0 ? 'bypass'
            : eligibleItems.every(item => item.cache_hit) && eligibleItems.length === toolItems.length ? 'hit'
              : eligibleItems.some(item => item.cache_hit) ? 'mixed' : 'miss'
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
