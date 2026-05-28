// ============================================================================
// agentic-mermaid Code Mode MCP server (stdio transport).
//
// One tool: execute(code: string) → { ok, value, logs, error }
// The SDK declaration is embedded in the server's listed instructions so the
// model sees the typed surface alongside the tool.
//
// Protocol: JSON-RPC 2.0 over newline-delimited messages on stdin/stdout,
// matching the MCP stdio transport. Implements only the methods we need —
// initialize, tools/list, tools/call, ping, prompts/list, resources/list.
//
// This is a small implementation rather than a dependency on the full MCP
// SDK; the protocol surface for one tool is tiny and keeping the dep tree
// minimal helps users who `npx agentic-mermaid-mcp`.
// ============================================================================

import { executeInSandbox } from './sandbox.ts'
import { SDK_DECLARATION } from './sdk-decl.ts'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: number | string | null
  method: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

const SERVER_NAME = 'agentic-mermaid-mcp'
const SERVER_VERSION = '0.1.0'
const PROTOCOL_VERSION = '2024-11-05'

const TOOL_DESCRIPTION = `Run TypeScript against the mermaid SDK in a sandboxed
node:vm context. Code runs as an async arrow body — write \`await\`-able TS,
return the final value. Multi-step diagram edits should be one execute() call.

SDK declaration:
${SDK_DECLARATION}`

const TOOLS = [
  {
    name: 'execute',
    description: TOOL_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'TypeScript to execute. The mermaid.* SDK is available as a global. Async-arrow body pattern; return the final value.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional hard timeout (default 5000ms).',
        },
      },
      required: ['code'],
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
        instructions:
          `agentic-mermaid Code Mode server. One tool, \`execute\`, runs TS\n` +
          `against the typed mermaid.* SDK in a sandbox. The SDK declaration\n` +
          `is in the tool description. Use verifyMermaid after every batch of\n` +
          `mutations before committing.`,
      })
    case 'notifications/initialized':
      // No response expected for notifications.
      return null
    case 'ping':
      return reply(id, {})
    case 'tools/list':
      return reply(id, { tools: TOOLS })
    case 'tools/call':
      return await handleToolCall(id, req.params)
    case 'prompts/list':
      return reply(id, { prompts: [] })
    case 'resources/list':
      return reply(id, { resources: [] })
    default:
      return error(id, -32601, `Method not found: ${req.method}`)
  }
}

async function handleToolCall(
  id: number | string | null,
  params: unknown,
): Promise<JsonRpcResponse> {
  const p = params as { name?: string; arguments?: { code?: string; timeoutMs?: number } } | undefined
  if (!p || p.name !== 'execute') {
    return error(id, -32602, `Unknown tool: ${p?.name ?? '<none>'}`)
  }
  const code = p.arguments?.code
  const timeoutMs = p.arguments?.timeoutMs
  if (typeof code !== 'string') {
    return error(id, -32602, 'execute requires `code` (string) argument')
  }
  const r = await executeInSandbox(code, { timeoutMs })
  return reply(id, {
    content: [
      {
        type: 'text',
        text: JSON.stringify(r),
      },
    ],
    isError: !r.ok,
  })
}

function reply(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function error(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } }
}

// ---- stdio loop ----------------------------------------------------------

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
        const req = JSON.parse(line) as JsonRpcRequest
        const res = await handleRequest(req)
        if (res) {
          process.stdout.write(JSON.stringify(res) + '\n')
        }
      } catch (e) {
        // Best-effort: emit a parse-error response with null id.
        const msg = e instanceof Error ? e.message : String(e)
        process.stdout.write(
          JSON.stringify(error(null, -32700, `parse error: ${msg}`)) + '\n',
        )
      }
    }
  })
  // Keep the process alive until stdin closes.
  return new Promise<void>(resolve => {
    process.stdin.on('end', () => resolve())
    process.stdin.on('close', () => resolve())
  })
}
