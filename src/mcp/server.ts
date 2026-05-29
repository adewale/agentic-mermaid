// agentic-mermaid Code Mode MCP server (stdio, JSON-RPC 2.0). One tool: execute.

import { executeInSandbox } from './sandbox.ts'
import { SDK_DECLARATION } from './sdk-decl.ts'
import { renderMermaidPNG } from '../agent/png.ts'

interface JsonRpcRequest { jsonrpc: '2.0'; id?: number | string | null; method: string; params?: unknown }
interface JsonRpcResponse { jsonrpc: '2.0'; id: number | string | null; result?: unknown; error?: { code: number; message: string; data?: unknown } }

const SERVER_NAME = 'agentic-mermaid-mcp'
const SERVER_VERSION = '0.4.0'
const PROTOCOL_VERSION = '2024-11-05'

const TOOLS = [
  {
    name: 'execute',
    description: `Run TypeScript against the mermaid SDK in a sandboxed node:vm context.
Code runs as an async arrow body — return the final value. Multi-step diagram
edits should be one execute() call.

SDK declaration:
${SDK_DECLARATION}`,
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'TypeScript to execute; mermaid.* SDK is global.' },
        timeoutMs: { type: 'number', description: 'Optional hard timeout (default 5000ms).' },
      },
      required: ['code'],
    },
  },
  {
    name: 'render_png',
    description: `Rasterize a Mermaid source string to PNG. Returns base64-encoded PNG bytes.
Uses the bundled resvg + DejaVu Sans for cross-runtime determinism (x86_64).
For non-PNG output (SVG, ASCII), use execute() with mermaid.renderMermaidSVG /
renderMermaidASCII — those are streaming-text and don't need a dedicated tool.`,
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Mermaid source.' },
        scale: { type: 'number', description: 'Output scale multiplier (default 2 — retina).' },
        background: { type: 'string', description: "CSS color string (default 'white')." },
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

export async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null
  switch (req.method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        capabilities: { tools: {} },
        instructions: 'agentic-mermaid Code Mode server. One tool, execute, runs TS against the typed mermaid.* SDK in a sandbox. mutate is overloaded by family; narrow via asFlowchart/asSequence. Layout is deterministic; there is no seed.',
      })
    case 'notifications/initialized': return null
    case 'ping': return reply(id, {})
    case 'tools/list': return reply(id, { tools: TOOLS })
    case 'tools/call': return await handleToolCall(id, req.params)
    case 'prompts/list': return reply(id, { prompts: [] })
    case 'resources/list': return reply(id, { resources: [] })
    default: return error(id, -32601, `Method not found: ${req.method}`)
  }
}

async function handleToolCall(id: number | string | null, params: unknown): Promise<JsonRpcResponse> {
  const p = params as { name?: string; arguments?: Record<string, unknown> } | undefined
  const name = p?.name
  const args = p?.arguments ?? {}
  if (name === 'execute') {
    const code = (args as { code?: string }).code
    const timeoutMs = (args as { timeoutMs?: number }).timeoutMs
    if (typeof code !== 'string') return error(id, -32602, 'execute requires `code` (string)')
    const r = await executeInSandbox(code, { timeoutMs })
    return reply(id, { content: [{ type: 'text', text: JSON.stringify(r) }], isError: !r.ok })
  }
  if (name === 'render_png') {
    const source = (args as { source?: string }).source
    const scale = (args as { scale?: number }).scale
    const background = (args as { background?: string }).background
    if (typeof source !== 'string') return error(id, -32602, 'render_png requires `source` (string)')
    try {
      const png = renderMermaidPNG(source, { scale, background })
      const png_base64 = Buffer.from(png).toString('base64')
      const payload = { ok: true as const, png_base64 }
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const payload = { ok: false as const, error: { code: 'PNG_RENDER_FAILED', message: msg } }
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true })
    }
  }
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

function reply(id: number | string | null, result: unknown): JsonRpcResponse { return { jsonrpc: '2.0', id, result } }
function error(id: number | string | null, code: number, message: string): JsonRpcResponse { return { jsonrpc: '2.0', id, error: { code, message } } }

export async function runStdio(): Promise<void> {
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
        const res = await handleRequest(JSON.parse(line) as JsonRpcRequest)
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
