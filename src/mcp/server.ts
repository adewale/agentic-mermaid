// agentic-mermaid Code Mode MCP server. Primary tool: execute.
// Transports: stdio newline-delimited JSON-RPC and HTTP/SSE.

import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { URL } from 'node:url'
import { executeInSandbox } from './sandbox.ts'
import { DEFAULT_EXECUTE_TIMEOUT_MS } from './execute-limits.ts'
import { isJsonContentType, preserveExactJsonRpcIds, reply, rpcError as error, stringifyJsonRpc, type ExactJsonRpcId, type JsonRpcRequest, type JsonRpcResponse } from './protocol.ts'
import {
  EXECUTE_TIMEOUT_ERROR,
  createDescribeTool,
  createExecuteTool,
  createRenderPngTool,
  dispatchAdmittedMcpRequest,
  isValidExecuteTimeout,
  projectMcpRenderOptions,
  surfaceSupportedVersions,
  withClosedMcpInputSchema,
  type McpDispatchOptions,
  type McpServerSurface,
} from './tool-surface.ts'
import { SDK_CORE_DECLARATION, createDescribeSdkTool, describeSdkPayload } from './sdk-discovery.ts'
import { mcpDescribePayload } from './describe-payload.ts'
import { createArtifactStore, type ArtifactRecord, type ArtifactStore } from './artifacts.ts'
import { renderMermaidPNG, renderMermaidPNGWithReceipt } from '../agent/png.ts'
import { configWarningsForMermaid } from '../agent/verify.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { projectNativePngOutputPolicyInput } from '../png-contract.ts'
import { projectRenderErrorDiagnostic } from '../render-error-diagnostic.ts'
import type { ProtocolEra } from './protocol-versions.ts'
import { admitMcpMessage, type AdmittedMcpMessage, type McpAdmissionResult } from './admission.ts'

export type { JsonRpcRequest, JsonRpcResponse } from './protocol.ts'

export interface McpRequestContext {
  artifactStore?: ArtifactStore
  maxSandboxTimeoutMs?: number
  /** Transport-owned cancellation. Tool handlers may cooperate with it; the
   * stdio coordinator independently guarantees that an aborted call cannot
   * emit a response. */
  signal?: AbortSignal
}

export interface HttpMcpOptions {
  host?: string
  port?: number
  artifactDir?: string
  publicUrl?: string
  maxArtifactBytes?: number
  maxArtifactTotalBytes?: number
  maxArtifacts?: number
  artifactTtlMs?: number
  maxRpcBodyBytes?: number
  authToken?: string
  maxSandboxTimeoutMs?: number
  maxSseSessions?: number
}

export interface HttpMcpServer {
  server: Server
  url: string
  artifactStore: ArtifactStore
  close(): Promise<void>
}

/**
 * Historical local fallback when a transport does not expose an explicit
 * supported-version list. Normal stdio negotiation selects its newest legacy
 * revision instead.
 */
const PROTOCOL_VERSION = '2024-11-05'

/**
 * What the DISPATCHER implements. Every revision here is honoured by
 * `dispatchMcpRequest`: the legacy handshake, SEP-1303's tool-error envelope
 * from 2025-11-25, and the 2026-07-28 stateless era (server/discover,
 * per-request `_meta`, resultType, caching hints).
 *
 * One honest caveat, pre-existing and unchanged: this server has never
 * implemented JSON-RPC batching — every transport parses a single object, so an
 * array body is refused with -32600 on every revision. That is exactly what
 * 2025-06-18 and later require, and a deviation for the two older revisions
 * that permit it. The previous 2024-11-05-only pin was, on that axis, the least
 * accurate claim this server could have made.
 */
export const STDIO_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28'] as const

/**
 * What the HTTP+SSE transport serves — and it is literally the 2024-11-05 one:
 * it writes `event: endpoint`, hands back a `?sessionId=` URL, and holds a
 * session map. Streamable HTTP replaced that in 2025-03-26, so advertising any
 * newer revision over this transport would be a false claim to every HTTP
 * client, however capable the dispatcher behind it is.
 */
export const HTTP_SSE_PROTOCOL_VERSIONS = ['2024-11-05'] as const

/** Narrowing passed by the HTTP+SSE transport's two dispatch call sites. */
const HTTP_SSE_DISPATCH: McpDispatchOptions = { supportedVersions: HTTP_SSE_PROTOCOL_VERSIONS }
const MAX_RPC_BODY_BYTES = 1024 * 1024
const MAX_SANDBOX_TIMEOUT_MS = 30_000
export const MAX_SSE_SESSIONS = 32

class HttpStatusError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export const LOCAL_TOOLS = [
  createExecuteTool({ sdkDeclaration: SDK_CORE_DECLARATION }),
  withClosedMcpInputSchema(createDescribeSdkTool()),
  createRenderPngTool('local'),
  createDescribeTool(),
]

let defaultArtifactStore: ArtifactStore | undefined
let defaultArtifactStoreExitHook = false
const MCP_NARROWERS = BUILTIN_FAMILY_METADATA.map(f => f.narrower).join('/')

const LOCAL_INSTRUCTIONS = `agentic-mermaid Code Mode server. Primary tool execute runs synchronous JavaScript against the typed mermaid.* SDK in a sandbox; async/await and Promise jobs are not supported. describe_sdk progressively discloses one family's version-matched mutation schema; call it before authoring unfamiliar ops. render_png and describe are narrow helpers. render_png can return base64, managed file paths, or managed URLs when the transport config provides an artifact store. There is no mutate tool on this server: structured edits go through the SDK's mermaid.mutate(...) inside execute; narrow via ${MCP_NARROWERS}. Every built-in renderable family ships a typed path when the body narrows; only opaque fallback bodies are source-level only. Layout is deterministic; there is no layout seed (the optional style seed only re-rolls ink of styled looks, never geometry).`

const LOCAL_SURFACE: McpServerSurface<McpRequestContext> = {
  protocolVersion: PROTOCOL_VERSION,
  supportedVersions: STDIO_PROTOCOL_VERSIONS,
  tools: LOCAL_TOOLS,
  instructions: LOCAL_INSTRUCTIONS,
  handleToolCall,
}

function admitLocalRequest(req: unknown, options: McpDispatchOptions = {}): McpAdmissionResult {
  return admitMcpMessage(req, {
    supportedVersions: surfaceSupportedVersions(LOCAL_SURFACE, options),
    negotiatedVersion: options.protocolVersion,
    protocolEra: options.protocolEra,
  })
}

export async function handleRequest(req: JsonRpcRequest, context: McpRequestContext = {}, options: McpDispatchOptions = {}): Promise<JsonRpcResponse | null> {
  const admission = admitLocalRequest(req, options)
  return admission.ok
    ? dispatchAdmittedMcpRequest(admission.message, context, LOCAL_SURFACE)
    : admission.response
}


async function handleToolCall(id: number | string | null, params: unknown, context: McpRequestContext): Promise<JsonRpcResponse> {
  const p = params as { name?: string; arguments?: Record<string, unknown> } | undefined
  const name = p?.name
  const args = p?.arguments ?? {}
  if (name === 'describe_sdk') {
    try {
      const payload = describeSdkPayload(args)
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false })
    } catch (e) {
      return error(id, -32602, e instanceof Error ? e.message : String(e))
    }
  }
  if (name === 'execute') {
    const code = (args as { code?: string }).code
    const requestedTimeoutMs = (args as { timeoutMs?: number }).timeoutMs
    if (requestedTimeoutMs !== undefined && !isValidExecuteTimeout(requestedTimeoutMs)) {
      return error(id, -32602, EXECUTE_TIMEOUT_ERROR)
    }
    const timeoutMs = Math.min(
      requestedTimeoutMs ?? DEFAULT_EXECUTE_TIMEOUT_MS,
      context.maxSandboxTimeoutMs ?? MAX_SANDBOX_TIMEOUT_MS,
    )
    if (typeof code !== 'string') return error(id, -32602, 'execute requires `code` (string)')
    const r = await executeInSandbox(code, { timeoutMs })
    return reply(id, { content: [{ type: 'text', text: JSON.stringify(r) }], isError: !r.ok })
  }
  if (name === 'render_png') return handleRenderPng(id, args, context)
  if (name === 'describe') {
    const source = (args as { source?: string }).source
    if (typeof source !== 'string') return error(id, -32602, 'describe requires `source` (string)')
    try {
      const payload = mcpDescribePayload(source, args)
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: !payload.ok })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const payload = { ok: false as const, error: { code: 'DESCRIBE_FAILED', message: msg } }
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true })
    }
  }
  return error(id, -32602, `Unknown tool: ${name ?? '<none>'}`)
}

function handleRenderPng(id: number | string | null, args: Record<string, unknown>, context: McpRequestContext): JsonRpcResponse {
  const source = (args as { source?: string }).source
  const output = (args.output ?? 'base64') as 'base64' | 'file' | 'url'
  if (typeof source !== 'string') return error(id, -32602, 'render_png requires `source` (string)')
  if (!['base64', 'file', 'url'].includes(output)) return error(id, -32602, 'render_png output must be one of: base64, file, url')
  try {
    const fontWarnings: Array<Record<string, unknown>> = []
    const pngOutput = projectNativePngOutputPolicyInput(args)
    const rendered = renderMermaidPNGWithReceipt(source, {
      ...projectMcpRenderOptions(args),
      ...pngOutput,
      onWarning: warning => fontWarnings.push(warning as unknown as Record<string, unknown>),
    })
    const warnings = [...configWarningsForMermaid(source), ...fontWarnings]
      .filter((warning, index, all) => all.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(warning)) === index)
    if (output === 'base64') {
      const png_base64 = Buffer.from(rendered.png).toString('base64')
      const payload = { ok: true as const, png_base64, receipt: rendered.receipt, runtime: rendered.runtime, warnings }
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false })
    }
    const store = context.artifactStore ?? getDefaultArtifactStore()
    if (output === 'url' && !store.hasBaseUrl()) return error(id, -32602, 'render_png output=url requires an HTTP/SSE artifact base URL')
    const artifact = store.write(rendered.png, { extension: '.png', mimeType: 'image/png' })
    const payload = { ok: true as const, artifact: artifactPayload(artifact, output as 'file' | 'url'), receipt: rendered.receipt, runtime: rendered.runtime, warnings }
    return reply(id, { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false })
  } catch (e) {
    const payload = {
      ok: false as const,
      error: projectRenderErrorDiagnostic(e),
    }
    return reply(id, { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true })
  }
}

function artifactPayload(artifact: ArtifactRecord, output: 'file' | 'url'): Record<string, unknown> {
  const base = { mimeType: artifact.mimeType, bytes: artifact.bytes, sha256: artifact.sha256 }
  if (output === 'url') return { ...base, url: artifact.url }
  return { ...base, path: artifact.path }
}

function getDefaultArtifactStore(): ArtifactStore {
  defaultArtifactStore ??= createArtifactStore()
  if (!defaultArtifactStoreExitHook) {
    defaultArtifactStoreExitHook = true
    process.once('exit', () => defaultArtifactStore?.close())
  }
  return defaultArtifactStore
}

// Force the native resvg (`@resvg/resvg-js`) addon to load NOW, before the
// server starts handling requests. On Bun, the addon's first `dlopen` — which
// is deferred until the first `new Resvg()` — panics the runtime
// (`panic: unreachable`) if it happens *after* a `node:vm` context has run.
// Code Mode `execute` runs agent code in exactly such a sandbox, so a normal
// `execute` then `render_png` session would otherwise crash the whole process.
// Warming here lands the dlopen up front. Guarded so a host without the binding
// still boots (render_png then reports the failure per-call instead of at start).
function warmUpPngRenderer(): void {
  try {
    renderMermaidPNG('flowchart LR\n  A --> B')
  } catch {
    // Binding unavailable in this environment; render_png will surface the error.
  }
}

type StdioDispatch = (
  message: AdmittedMcpMessage,
  context: McpRequestContext,
  surface: McpServerSurface<McpRequestContext>,
) => Promise<JsonRpcResponse | null>

export interface StdioMessageProcessor {
  /** Accept one complete, non-empty newline-delimited JSON value. */
  accept(line: string): void
  /** Wait until admission and every dispatched request have settled. */
  drain(): Promise<void>
}

function stdioCancellationTarget(value: unknown): number | string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const request = value as Record<string, unknown>
  if (request.jsonrpc !== '2.0' || request.method !== 'notifications/cancelled'
    || Object.prototype.hasOwnProperty.call(request, 'id')) return undefined
  const params = request.params
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined
  const requestId = (params as Record<string, unknown>).requestId
  return typeof requestId === 'string'
    || (typeof requestId === 'number' && Number.isSafeInteger(requestId))
    ? requestId
    : undefined
}

function stdioRequestId(value: unknown): number | string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const request = value as Record<string, unknown>
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string'
    || !Object.prototype.hasOwnProperty.call(request, 'id')) return undefined
  const requestId = request.id
  return typeof requestId === 'string'
    || (typeof requestId === 'number' && Number.isSafeInteger(requestId))
    ? requestId
    : undefined
}

function stdioRequestKey(id: number | string): string {
  return `${typeof id}:${String(id)}`
}

/**
 * Stateful stdio protocol coordinator.
 *
 * Admission is briefly serialized because initialize must commit its selected
 * legacy revision before a following line is classified. Dispatch is not: once
 * the era is known, independent requests run concurrently and cancellation
 * notifications bypass admission/dispatch as connection-level control.
 */
export function createStdioMessageProcessor(
  context: McpRequestContext,
  write: (line: string) => void,
  dispatch: StdioDispatch = dispatchAdmittedMcpRequest,
): StdioMessageProcessor {
  let negotiatedProtocolVersion: string | null = null
  let negotiatedEra: ProtocolEra | null = null
  let admissionGate = Promise.resolve()
  const tasks = new Set<Promise<void>>()
  const inFlight = new Map<string, Set<AbortController>>()

  const register = (id: number | string | undefined, controller: AbortController): void => {
    if (id === undefined) return
    const key = stdioRequestKey(id)
    const controllers = inFlight.get(key) ?? new Set<AbortController>()
    controllers.add(controller)
    inFlight.set(key, controllers)
  }
  const unregister = (id: number | string | undefined, controller: AbortController): void => {
    if (id === undefined) return
    const key = stdioRequestKey(id)
    const controllers = inFlight.get(key)
    controllers?.delete(controller)
    if (controllers?.size === 0) inFlight.delete(key)
  }
  const emit = (response: JsonRpcResponse | null, exactIds: ExactJsonRpcId[], signal?: AbortSignal): void => {
    if (response && !signal?.aborted) write(stringifyJsonRpc(response, exactIds) + '\n')
  }

  const accept = (line: string): void => {
    let exact: { body: string; ids: ExactJsonRpcId[] }
    let request: JsonRpcRequest
    try {
      exact = preserveExactJsonRpcIds(line)
      request = JSON.parse(exact.body) as JsonRpcRequest
    } catch (cause) {
      write(JSON.stringify(error(null, -32700, `parse error: ${cause instanceof Error ? cause.message : String(cause)}`)) + '\n')
      return
    }

    // Cancellation is a connection-level notification. It deliberately has no
    // per-request modern metadata and must remain actionable after modern pinning.
    const cancellationTarget = stdioCancellationTarget(request)
    if (cancellationTarget !== undefined) {
      for (const controller of inFlight.get(stdioRequestKey(cancellationTarget)) ?? []) controller.abort()
      return
    }

    const requestId = stdioRequestId(request)
    const controller = new AbortController()
    register(requestId, controller)

    // Keep only classification/era commitment behind the gate. A modern first
    // request commits its era immediately; initialize stays in the gate until
    // its response selects the legacy version, so later lines cannot race it.
    const preparation = admissionGate.then(async () => {
      const dispatchOptions: McpDispatchOptions = negotiatedEra === 'legacy'
        ? { protocolEra: 'legacy', protocolVersion: negotiatedProtocolVersion, supportedVersions: negotiatedProtocolVersion ? [negotiatedProtocolVersion] : undefined }
        : negotiatedEra === 'modern'
          ? { protocolEra: 'modern', supportedVersions: STDIO_PROTOCOL_VERSIONS }
          : {}
      const admission = admitLocalRequest(request, dispatchOptions)

      if (admission.ok && negotiatedEra === null && request.method === 'initialize') {
        const response = controller.signal.aborted
          ? null
          : await dispatch(admission.message, { ...context, signal: controller.signal }, LOCAL_SURFACE)
        if (!controller.signal.aborted && response?.result && typeof response.result === 'object') {
          const selected = (response.result as { protocolVersion?: unknown }).protocolVersion
          if (typeof selected === 'string' && (STDIO_PROTOCOL_VERSIONS as readonly string[]).includes(selected)) {
            negotiatedProtocolVersion = selected
            negotiatedEra = 'legacy'
          }
        }
        emit(response, exact.ids, controller.signal)
        return { handled: true as const, admission }
      }

      if (admission.ok && negotiatedEra === null && admission.message.protocol.era === 'modern') {
        negotiatedEra = 'modern'
      }
      return { handled: false as const, admission }
    })
    admissionGate = preparation.then(() => undefined, () => undefined)

    let task: Promise<void>
    task = preparation.then(async prepared => {
      if (prepared.handled) return
      const response = prepared.admission.ok
        ? controller.signal.aborted
          ? null
          : await dispatch(prepared.admission.message, { ...context, signal: controller.signal }, LOCAL_SURFACE)
        : prepared.admission.response
      emit(response, exact.ids, controller.signal)
    }).catch(cause => {
      emit(
        error(requestId ?? null, -32603, `internal error: ${cause instanceof Error ? cause.message : String(cause)}`),
        exact.ids,
        controller.signal,
      )
    }).finally(() => {
      unregister(requestId, controller)
      tasks.delete(task)
    })
    tasks.add(task)
  }

  return {
    accept,
    async drain() {
      await admissionGate
      while (tasks.size > 0) await Promise.allSettled([...tasks])
    },
  }
}

export async function runStdio(options: { artifactDir?: string; maxArtifactBytes?: number; maxArtifactTotalBytes?: number; maxArtifacts?: number; artifactTtlMs?: number; maxSandboxTimeoutMs?: number } = {}): Promise<void> {
  warmUpPngRenderer()
  const artifactStore = createArtifactStore({
    dir: options.artifactDir,
    maxBytes: options.maxArtifactBytes,
    maxTotalBytes: options.maxArtifactTotalBytes,
    maxArtifacts: options.maxArtifacts,
    ttlMs: options.artifactTtlMs,
  })
  const processor = createStdioMessageProcessor(
    { artifactStore, maxSandboxTimeoutMs: options.maxSandboxTimeoutMs },
    line => process.stdout.write(line),
  )
  process.stdin.setEncoding('utf8')
  let buf = ''
  process.stdin.on('data', (chunk: string) => {
    buf += chunk
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      processor.accept(line)
    }
  })
  try {
    await new Promise<void>(resolve => {
      process.stdin.on('end', () => resolve())
      process.stdin.on('close', () => resolve())
    })
    await processor.drain()
  } finally {
    artifactStore.close()
  }
}

export async function startHttpServer(options: HttpMcpOptions = {}): Promise<HttpMcpServer> {
  warmUpPngRenderer()
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 3000
  if (!isLoopbackHost(host) && !options.authToken) throw new Error('HTTP MCP remote bind requires --auth-token')
  const sessions = new Map<string, ServerResponse>()
  let baseUrl = ''
  const maxRpcBodyBytes = options.maxRpcBodyBytes ?? MAX_RPC_BODY_BYTES
  const maxSseSessions = options.maxSseSessions ?? MAX_SSE_SESSIONS
  const publicOrigin = httpOrigin(options.publicUrl, 'publicUrl')
  if (!Number.isInteger(maxSseSessions) || maxSseSessions <= 0) throw new Error('maxSseSessions must be a positive integer')
  const artifactStore = createArtifactStore({
    dir: options.artifactDir,
    maxBytes: options.maxArtifactBytes,
    maxTotalBytes: options.maxArtifactTotalBytes,
    maxArtifacts: options.maxArtifacts,
    ttlMs: options.artifactTtlMs,
  })
  const context = { artifactStore, maxSandboxTimeoutMs: options.maxSandboxTimeoutMs }

  const server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', baseUrl || `http://${host}:${port || 0}`)
      if (req.method === 'GET' && u.pathname === '/health') return sendJson(res, 200, { ok: true })
      if (req.method === 'GET' && u.pathname === '/sse') {
        if (!authorizeHttpAccess(req, res, baseUrl, publicOrigin, options.authToken)) return
        return openSse(req, res, sessions, publicOrigin ?? baseUrl, maxSseSessions)
      }
      if (req.method === 'POST' && u.pathname === '/message') {
        if (!authorizeHttpRpc(req, res, baseUrl, publicOrigin, options.authToken)) return
        return await postSseMessage(req, res, sessions, context, maxRpcBodyBytes)
      }
      if (req.method === 'POST' && u.pathname === '/rpc') {
        if (!authorizeHttpRpc(req, res, baseUrl, publicOrigin, options.authToken)) return
        return await postRpc(req, res, context, maxRpcBodyBytes)
      }
      if (req.method === 'GET' && u.pathname.startsWith('/artifacts/')) {
        if (!authorizeHttpAccess(req, res, baseUrl, publicOrigin, options.authToken)) return
        return serveArtifact(res, artifactStore, decodeURIComponent(u.pathname.slice('/artifacts/'.length)))
      }
      return sendJson(res, 404, { ok: false, error: 'not found' })
    } catch (e) {
      if (e instanceof HttpStatusError) return sendJson(res, e.status, { ok: false, error: e.message })
      return sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('HTTP MCP server did not expose a TCP address')
    baseUrl = `http://${host}:${address.port}`
    artifactStore.setBaseUrl(options.publicUrl ?? `${baseUrl}/artifacts`)
  } catch (error) {
    artifactStore.close()
    try { server.close() } catch {}
    throw error
  }
  return {
    server,
    url: baseUrl,
    artifactStore,
    close: () => new Promise<void>((resolve, reject) => {
      for (const sse of sessions.values()) sse.end()
      sessions.clear()
      server.close(err => {
        artifactStore.close()
        if (err) reject(err)
        else resolve()
      })
    }),
  }
}

export async function runHttp(options: HttpMcpOptions = {}): Promise<void> {
  const started = await startHttpServer(options)
  process.stderr.write(`agentic-mermaid-mcp HTTP/SSE listening at ${started.url} (SSE: ${started.url}/sse, plain JSON-RPC: ${started.url}/rpc)\n`)
  return new Promise<void>(resolve => {
    const shutdown = () => { started.close().finally(resolve) }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  })
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function httpOrigin(value: string | undefined, label: string): string | undefined {
  if (!value) return undefined
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label} must be an absolute http(s) URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must be an absolute http(s) URL`)
  }
  return parsed.origin
}

function authorizeHttpAccess(req: IncomingMessage, res: ServerResponse, baseUrl: string, publicOrigin?: string, authToken?: string): boolean {
  const origin = req.headers.origin
  if (origin && origin !== baseUrl && origin !== publicOrigin) {
    sendJson(res, 403, { ok: false, error: 'origin not allowed' })
    return false
  }
  if (authToken && req.headers.authorization !== `Bearer ${authToken}`) {
    sendJson(res, 401, { ok: false, error: 'missing or invalid bearer token' })
    return false
  }
  return true
}

function authorizeHttpRpc(req: IncomingMessage, res: ServerResponse, baseUrl: string, publicOrigin?: string, authToken?: string): boolean {
  if (!authorizeHttpAccess(req, res, baseUrl, publicOrigin, authToken)) return false
  if (!isJsonContentType(String(req.headers['content-type'] ?? ''))) {
    sendJson(res, 415, { ok: false, error: 'HTTP MCP JSON-RPC requires content-type application/json' })
    return false
  }
  return true
}

function openSse(req: IncomingMessage, res: ServerResponse, sessions: Map<string, ServerResponse>, baseUrl: string, maxSessions: number): void {
  if (sessions.size >= maxSessions) {
    sendJson(res, 503, { ok: false, error: `SSE session limit reached (${maxSessions})` })
    return
  }
  const sessionId = randomUUID()
  sessions.set(sessionId, res)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(`event: endpoint\ndata: ${baseUrl}/message?sessionId=${encodeURIComponent(sessionId)}\n\n`)
  const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 25_000)
  req.on('close', () => {
    clearInterval(heartbeat)
    sessions.delete(sessionId)
  })
}

async function postSseMessage(req: IncomingMessage, res: ServerResponse, sessions: Map<string, ServerResponse>, context: McpRequestContext, maxBytes: number): Promise<void> {
  const u = new URL(req.url ?? '/', 'http://localhost')
  const sessionId = u.searchParams.get('sessionId') ?? ''
  const sse = sessions.get(sessionId)
  if (!sse) return sendJson(res, 404, { ok: false, error: 'unknown sessionId' })
  const body = await readRequestBody(req, maxBytes)
  const exact = preserveExactJsonRpcIds(body)
  let parsed: JsonRpcRequest
  try { parsed = JSON.parse(exact.body) as JsonRpcRequest } catch { throw new HttpStatusError(400, 'invalid JSON-RPC body') }
  const response = await handleRequest(parsed, context, HTTP_SSE_DISPATCH)
  if (response) {
    sse.write(`event: message\ndata: ${stringifyJsonRpc(response, exact.ids)}\n\n`)
    return sendJson(res, 202, { ok: true })
  }
  res.writeHead(202)
  res.end()
}

async function postRpc(req: IncomingMessage, res: ServerResponse, context: McpRequestContext, maxBytes: number): Promise<void> {
  const body = await readRequestBody(req, maxBytes)
  const exact = preserveExactJsonRpcIds(body)
  let parsed: JsonRpcRequest
  try { parsed = JSON.parse(exact.body) as JsonRpcRequest } catch { throw new HttpStatusError(400, 'invalid JSON-RPC body') }
  const response = await handleRequest(parsed, context, HTTP_SSE_DISPATCH)
  if (response === null) {
    res.writeHead(202)
    res.end()
    return
  }
  sendJson(res, 200, response, exact.ids)
}

function serveArtifact(res: ServerResponse, store: ArtifactStore, name: string): void {
  const artifact = store.read(name)
  if (!artifact) return sendJson(res, 404, { ok: false, error: 'artifact not found' })
  res.writeHead(200, {
    'Content-Type': artifact.mimeType,
    'Content-Length': artifact.bytes.length,
    'Cache-Control': `private, max-age=${artifact.cacheMaxAgeSeconds}, immutable`,
  })
  res.end(artifact.bytes)
}

function sendJson(res: ServerResponse, status: number, payload: unknown, exactIds: ExactJsonRpcId[] = []): void {
  const body = stringifyJsonRpc(payload, exactIds)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

export async function readRequestBody(req: IncomingMessage, maxBytes = MAX_RPC_BODY_BYTES): Promise<string> {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpStatusError(413, `request body exceeds ${maxBytes} bytes`)
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    bytes += buffer.byteLength
    if (bytes > maxBytes) throw new HttpStatusError(413, `request body exceeds ${maxBytes} bytes`)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}
