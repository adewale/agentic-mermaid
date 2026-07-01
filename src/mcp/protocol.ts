// JSON-RPC 2.0 plumbing shared by every MCP transport (stdio, node HTTP/SSE,
// and the hosted Cloudflare Worker). Runtime-neutral: no node:* imports.

export interface JsonRpcRequest { jsonrpc: '2.0'; id?: number | string | null; method: string; params?: unknown }
export interface JsonRpcResponse { jsonrpc: '2.0'; id: number | string | null; result?: unknown; error?: { code: number; message: string; data?: unknown } }

export function reply(id: number | string | null, result: unknown): JsonRpcResponse { return { jsonrpc: '2.0', id, result } }
export function rpcError(id: number | string | null, code: number, message: string): JsonRpcResponse { return { jsonrpc: '2.0', id, error: { code, message } } }

/** Wrap a tool payload in the MCP tools/call content envelope. */
export function toolResult(id: number | string | null, payload: unknown, isError: boolean): JsonRpcResponse {
  return reply(id, { content: [{ type: 'text', text: JSON.stringify(payload) }], isError })
}
