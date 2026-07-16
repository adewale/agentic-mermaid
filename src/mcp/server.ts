// agentic-mermaid Code Mode MCP server. Primary tool: execute.
// Transports: stdio newline-delimited JSON-RPC and HTTP/SSE.

import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { URL } from 'node:url'
import { executeInSandbox } from './sandbox.ts'
import { isJsonContentType, preserveExactJsonRpcIds, reply, rpcError as error, stringifyJsonRpc, type ExactJsonRpcId, type JsonRpcRequest, type JsonRpcResponse } from './protocol.ts'
import {
  EXECUTE_TIMEOUT_ERROR,
  createDescribeTool,
  createExecuteTool,
  createRenderPngTool,
  dispatchMcpRequest,
  isValidExecuteTimeout,
  projectMcpRenderOptions,
  withClosedMcpInputSchema,
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

export type { JsonRpcRequest, JsonRpcResponse } from './protocol.ts'

export interface McpRequestContext {
  artifactStore?: ArtifactStore
  maxSandboxTimeoutMs?: number
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

const PROTOCOL_VERSION = '2024-11-05'
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
const MCP_NARROWERS = BUILTIN_FAMILY_METADATA.map(f => f.narrower).join('/')

const LOCAL_INSTRUCTIONS = `agentic-mermaid Code Mode server. Primary tool execute runs synchronous JavaScript against the typed mermaid.* SDK in a sandbox; async/await and Promise jobs are not supported. describe_sdk progressively discloses one family's version-matched mutation schema; call it before authoring unfamiliar ops. render_png and describe are narrow helpers. render_png can return base64, managed file paths, or managed URLs when the transport config provides an artifact store. There is no mutate tool on this server: structured edits go through the SDK's mermaid.mutate(...) inside execute; narrow via ${MCP_NARROWERS}. Every built-in renderable family ships a typed path when the body narrows; only opaque fallback bodies are source-level only. Layout is deterministic; there is no layout seed (the optional style seed only re-rolls ink of styled looks, never geometry).`

const LOCAL_SURFACE: McpServerSurface<McpRequestContext> = {
  protocolVersion: PROTOCOL_VERSION,
  tools: LOCAL_TOOLS,
  instructions: LOCAL_INSTRUCTIONS,
  handleToolCall,
}

export async function handleRequest(req: JsonRpcRequest, context: McpRequestContext = {}): Promise<JsonRpcResponse | null> {
  return dispatchMcpRequest(req, context, LOCAL_SURFACE)
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
    const timeoutMs = typeof requestedTimeoutMs === 'number' && Number.isFinite(requestedTimeoutMs)
      ? Math.min(requestedTimeoutMs, context.maxSandboxTimeoutMs ?? MAX_SANDBOX_TIMEOUT_MS)
      : undefined
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
  defaultArtifactStore ??= createArtifactStore({ dir: join(tmpdir(), 'agentic-mermaid-mcp-artifacts') })
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

export async function runStdio(options: { artifactDir?: string; maxArtifactBytes?: number; maxArtifactTotalBytes?: number; maxArtifacts?: number; artifactTtlMs?: number; maxSandboxTimeoutMs?: number } = {}): Promise<void> {
  warmUpPngRenderer()
  const artifactStore = createArtifactStore({
    dir: options.artifactDir,
    maxBytes: options.maxArtifactBytes,
    maxTotalBytes: options.maxArtifactTotalBytes,
    maxArtifacts: options.maxArtifacts,
    ttlMs: options.artifactTtlMs,
  })
  process.stdin.setEncoding('utf8')
  let buf = ''
  process.stdin.on('data', async (chunk: string) => {
    buf += chunk
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      try {
        const exact = preserveExactJsonRpcIds(line)
        const res = await handleRequest(JSON.parse(exact.body) as JsonRpcRequest, { artifactStore, maxSandboxTimeoutMs: options.maxSandboxTimeoutMs })
        if (res) process.stdout.write(stringifyJsonRpc(res, exact.ids) + '\n')
      } catch (e) {
        process.stdout.write(JSON.stringify(error(null, -32700, `parse error: ${(e as Error).message}`)) + '\n')
      }
    }
  })
  return new Promise<void>(resolve => {
    process.stdin.on('end', () => resolve())
    process.stdin.on('close', () => resolve())
  })
}

export async function startHttpServer(options: HttpMcpOptions = {}): Promise<HttpMcpServer> {
  warmUpPngRenderer()
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 3000
  if (!isLoopbackHost(host) && !options.authToken) throw new Error('HTTP MCP remote bind requires --auth-token')
  const sessions = new Map<string, ServerResponse>()
  let baseUrl = ''
  const artifactStore = createArtifactStore({
    dir: options.artifactDir,
    maxBytes: options.maxArtifactBytes,
    maxTotalBytes: options.maxArtifactTotalBytes,
    maxArtifacts: options.maxArtifacts,
    ttlMs: options.artifactTtlMs,
  })
  const maxRpcBodyBytes = options.maxRpcBodyBytes ?? MAX_RPC_BODY_BYTES
  const maxSseSessions = options.maxSseSessions ?? MAX_SSE_SESSIONS
  const publicOrigin = httpOrigin(options.publicUrl, 'publicUrl')
  if (!Number.isInteger(maxSseSessions) || maxSseSessions <= 0) throw new Error('maxSseSessions must be a positive integer')
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
  return {
    server,
    url: baseUrl,
    artifactStore,
    close: () => new Promise<void>((resolve, reject) => {
      for (const sse of sessions.values()) sse.end()
      sessions.clear()
      server.close(err => err ? reject(err) : resolve())
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
  const response = await handleRequest(parsed, context)
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
  const response = await handleRequest(parsed, context)
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
