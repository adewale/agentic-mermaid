// agentic-mermaid Code Mode MCP server. Primary tool: execute.
// Transports: stdio newline-delimited JSON-RPC and HTTP/SSE.

import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { URL } from 'node:url'
import { executeInSandbox } from './sandbox.ts'
import { SDK_DECLARATION } from './sdk-decl.ts'
import { createArtifactStore, type ArtifactRecord, type ArtifactStore } from './artifacts.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'

export interface JsonRpcRequest { jsonrpc: '2.0'; id?: number | string | null; method: string; params?: unknown }
export interface JsonRpcResponse { jsonrpc: '2.0'; id: number | string | null; result?: unknown; error?: { code: number; message: string; data?: unknown } }

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
  artifactTtlMs?: number
  maxRpcBodyBytes?: number
  authToken?: string
  maxSandboxTimeoutMs?: number
}

export interface HttpMcpServer {
  server: Server
  url: string
  artifactStore: ArtifactStore
  close(): Promise<void>
}

const SERVER_NAME = 'agentic-mermaid-mcp'
const SERVER_VERSION = '0.4.0'
const PROTOCOL_VERSION = '2024-11-05'
const MAX_RPC_BODY_BYTES = 1024 * 1024
const MAX_SANDBOX_TIMEOUT_MS = 30_000

class HttpStatusError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

const TOOLS = [
  {
    name: 'execute',
    description: `Run synchronous JavaScript against the mermaid SDK in a sandboxed node:vm context.
Code runs as an expression or statement body — return the final value. Promise jobs,
async/await, and dynamic import are not supported.
Multi-step diagram edits should be one execute() call. The SDK declaration is
TypeScript-shaped for guidance; the sandbox does not transpile type annotations.

SDK declaration:
${SDK_DECLARATION}`,
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript to execute; mermaid.* SDK is global.' },
        timeoutMs: { type: 'number', description: 'Optional hard timeout (default 5000ms).' },
      },
      required: ['code'],
    },
  },
  {
    name: 'render_png',
    description: `Rasterize a Mermaid source string to PNG. By default returns base64-encoded PNG bytes.
Set output to "file" or "url" to write a managed artifact instead; artifact responses include
{path?, url?, mimeType, bytes, sha256}. File/URL artifacts are generated under the MCP server's
artifact directory with safe names, size limits, and TTL cleanup.
Uses bundled resvg + DejaVu Sans for same-machine cross-runtime determinism where verified.
Agentic Mermaid outputs ASCII, PNG, and SVG. For non-PNG output (ASCII/SVG), use execute() with mermaid.renderMermaidASCII or mermaid.renderMermaidSVG — those are streaming text and don't need a dedicated tool.`,
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Mermaid source.' },
        scale: { type: 'number', description: 'Output scale multiplier (default 2 — retina).' },
        background: { type: 'string', description: "CSS color string (default 'white')." },
        output: { type: 'string', enum: ['base64', 'file', 'url'], description: 'PNG return mode (default base64).' },
      },
      required: ['source'],
    },
  },
  {
    name: 'describe',
    description: `Produce a natural-language summary of a Mermaid diagram. Returns
{ ok, text } with one or two sentences per family covering entities, edges,
and notable structure. Intended for screen-reader output, doc generation, and
LLM context compaction without re-parsing.`,
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Mermaid source.' },
      },
      required: ['source'],
    },
  },
]

let defaultArtifactStore: ArtifactStore | undefined
const MCP_NARROWERS = BUILTIN_FAMILY_METADATA.map(f => f.narrower).join('/')

export async function handleRequest(req: JsonRpcRequest, context: McpRequestContext = {}): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null
  switch (req.method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        capabilities: { tools: {} },
        instructions: `agentic-mermaid Code Mode server. Primary tool execute runs synchronous JavaScript against the typed mermaid.* SDK in a sandbox; async/await and Promise jobs are not supported. render_png and describe are narrow helpers. render_png can return base64, managed file paths, or managed URLs when the transport config provides an artifact store. mutate is overloaded by family; narrow via ${MCP_NARROWERS}. Every built-in renderable family ships a typed path when the body narrows; only opaque fallback bodies are source-level only. Layout is deterministic; there is no seed.`,
      })
    case 'notifications/initialized': return null
    case 'ping': return reply(id, {})
    case 'tools/list': return reply(id, { tools: TOOLS })
    case 'tools/call': return await handleToolCall(id, req.params, context)
    case 'prompts/list': return reply(id, { prompts: [] })
    case 'resources/list': return reply(id, { resources: [] })
    default: return error(id, -32601, `Method not found: ${req.method}`)
  }
}

async function handleToolCall(id: number | string | null, params: unknown, context: McpRequestContext): Promise<JsonRpcResponse> {
  const p = params as { name?: string; arguments?: Record<string, unknown> } | undefined
  const name = p?.name
  const args = p?.arguments ?? {}
  if (name === 'execute') {
    const code = (args as { code?: string }).code
    const requestedTimeoutMs = (args as { timeoutMs?: number }).timeoutMs
    const timeoutMs = typeof requestedTimeoutMs === 'number' && Number.isFinite(requestedTimeoutMs)
      ? Math.max(1, Math.min(requestedTimeoutMs, context.maxSandboxTimeoutMs ?? MAX_SANDBOX_TIMEOUT_MS))
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
      const { describeMermaidSource } = require('../agent/describe.ts') as typeof import('../agent/describe.ts')
      const text = describeMermaidSource(source)
      const payload = { ok: true as const, text }
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false })
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
  const scale = (args as { scale?: number }).scale
  const background = (args as { background?: string }).background
  const output = String((args as { output?: string; outputMode?: string }).output ?? (args as { outputMode?: string }).outputMode ?? 'base64')
  if (typeof source !== 'string') return error(id, -32602, 'render_png requires `source` (string)')
  if (!['base64', 'file', 'url'].includes(output)) return error(id, -32602, 'render_png output must be one of: base64, file, url')
  try {
    const png = renderMermaidPNG(source, { scale, background })
    if (output === 'base64') {
      const png_base64 = Buffer.from(png).toString('base64')
      const payload = { ok: true as const, png_base64 }
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false })
    }
    const store = context.artifactStore ?? getDefaultArtifactStore()
    if (output === 'url' && !store.hasBaseUrl()) return error(id, -32602, 'render_png output=url requires an HTTP/SSE artifact base URL')
    const artifact = store.write(png, { extension: '.png', mimeType: 'image/png' })
    const payload = { ok: true as const, artifact: artifactPayload(artifact, output as 'file' | 'url') }
    return reply(id, { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const payload = { ok: false as const, error: { code: 'PNG_RENDER_FAILED', message: msg } }
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

function reply(id: number | string | null, result: unknown): JsonRpcResponse { return { jsonrpc: '2.0', id, result } }
function error(id: number | string | null, code: number, message: string): JsonRpcResponse { return { jsonrpc: '2.0', id, error: { code, message } } }

export async function runStdio(options: { artifactDir?: string; maxArtifactBytes?: number; artifactTtlMs?: number } = {}): Promise<void> {
  const artifactStore = createArtifactStore({ dir: options.artifactDir, maxBytes: options.maxArtifactBytes, ttlMs: options.artifactTtlMs })
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
        const res = await handleRequest(JSON.parse(line) as JsonRpcRequest, { artifactStore })
        if (res) process.stdout.write(JSON.stringify(res) + '\n')
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
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 3000
  if (!isLoopbackHost(host) && !options.authToken) throw new Error('HTTP MCP remote bind requires --auth-token')
  const sessions = new Map<string, ServerResponse>()
  let baseUrl = ''
  const artifactStore = createArtifactStore({
    dir: options.artifactDir,
    maxBytes: options.maxArtifactBytes,
    ttlMs: options.artifactTtlMs,
  })
  const maxRpcBodyBytes = options.maxRpcBodyBytes ?? MAX_RPC_BODY_BYTES
  const context = { artifactStore, maxSandboxTimeoutMs: options.maxSandboxTimeoutMs }

  const server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', baseUrl || `http://${host}:${port || 0}`)
      if (req.method === 'GET' && u.pathname === '/health') return sendJson(res, 200, { ok: true })
      if (req.method === 'GET' && u.pathname === '/sse') return openSse(req, res, sessions, baseUrl)
      if (req.method === 'POST' && u.pathname === '/message') {
        if (!authorizeHttpRpc(req, res, baseUrl, options.authToken)) return
        return await postSseMessage(req, res, sessions, context, maxRpcBodyBytes)
      }
      if (req.method === 'POST' && u.pathname === '/rpc') {
        if (!authorizeHttpRpc(req, res, baseUrl, options.authToken)) return
        return await postRpc(req, res, context, maxRpcBodyBytes)
      }
      if (req.method === 'GET' && u.pathname.startsWith('/artifacts/')) return serveArtifact(res, artifactStore, decodeURIComponent(u.pathname.slice('/artifacts/'.length)))
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
  process.stderr.write(`agentic-mermaid-mcp HTTP/SSE listening at ${started.url} (SSE: ${started.url}/sse)\n`)
  return new Promise<void>(resolve => {
    const shutdown = () => { started.close().finally(resolve) }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  })
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function authorizeHttpRpc(req: IncomingMessage, res: ServerResponse, baseUrl: string, authToken?: string): boolean {
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase()
  if (!contentType.startsWith('application/json')) {
    sendJson(res, 415, { ok: false, error: 'HTTP MCP JSON-RPC requires content-type application/json' })
    return false
  }
  const origin = req.headers.origin
  if (origin && origin !== baseUrl) {
    sendJson(res, 403, { ok: false, error: 'origin not allowed' })
    return false
  }
  if (authToken && req.headers.authorization !== `Bearer ${authToken}`) {
    sendJson(res, 401, { ok: false, error: 'missing or invalid bearer token' })
    return false
  }
  return true
}

function openSse(req: IncomingMessage, res: ServerResponse, sessions: Map<string, ServerResponse>, baseUrl: string): void {
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
  let parsed: JsonRpcRequest
  try { parsed = JSON.parse(body) as JsonRpcRequest } catch { throw new HttpStatusError(400, 'invalid JSON-RPC body') }
  const response = await handleRequest(parsed, context)
  if (response) sse.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`)
  sendJson(res, 202, { ok: true })
}

async function postRpc(req: IncomingMessage, res: ServerResponse, context: McpRequestContext, maxBytes: number): Promise<void> {
  const body = await readRequestBody(req, maxBytes)
  let parsed: JsonRpcRequest
  try { parsed = JSON.parse(body) as JsonRpcRequest } catch { throw new HttpStatusError(400, 'invalid JSON-RPC body') }
  const response = await handleRequest(parsed, context)
  if (response === null) return sendJson(res, 202, { ok: true })
  sendJson(res, 200, response)
}

function serveArtifact(res: ServerResponse, store: ArtifactStore, name: string): void {
  const artifact = store.read(name)
  if (!artifact) return sendJson(res, 404, { ok: false, error: 'artifact not found' })
  res.writeHead(200, {
    'Content-Type': artifact.mimeType,
    'Content-Length': artifact.bytes.length,
    'Cache-Control': 'private, max-age=3600',
  })
  res.end(artifact.bytes)
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

async function readRequestBody(req: IncomingMessage, maxBytes = MAX_RPC_BODY_BYTES): Promise<string> {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpStatusError(413, `request body exceeds ${maxBytes} bytes`)
  let body = ''
  let bytes = 0
  for await (const chunk of req) {
    const s = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    bytes += Buffer.byteLength(s)
    if (bytes > maxBytes) throw new HttpStatusError(413, `request body exceeds ${maxBytes} bytes`)
    body += s
  }
  return body
}
