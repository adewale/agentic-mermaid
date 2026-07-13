// JSON-RPC 2.0 plumbing shared by every MCP transport (stdio, node HTTP/SSE,
// and the hosted Cloudflare Worker). Runtime-neutral: no node:* imports.

export interface JsonRpcRequest { jsonrpc: '2.0'; id?: number | string | null; method: string; params?: unknown }
export interface JsonRpcResponse { jsonrpc: '2.0'; id: number | string | null; result?: unknown; error?: { code: number; message: string; data?: unknown } }

export interface ExactJsonRpcId { sentinel: string; raw: string }

/**
 * Protect top-level numeric JSON-RPC ids that JavaScript cannot round-trip
 * lexically through JSON.parse/JSON.stringify. The JSON-RPC specification
 * permits Number ids (while discouraging fractions), so every transport must
 * preserve the request token used for response correlation rather than
 * silently coercing it through IEEE-754.
 *
 * Only an individual request object's `id` is protected: nested `params.id`
 * values remain ordinary application data. Direct batch-item ids are included.
 */
export function preserveExactJsonRpcIds(body: string): { body: string; ids: ExactJsonRpcId[] } {
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
      const rpcObject = (stack.length === 1 && stack[0] === '{')
        || (stack.length === 2 && stack[0] === '[' && stack[1] === '{')
      let cursor = end
      while (/\s/.test(body[cursor] ?? '')) cursor++
      if (rpcObject && key === 'id' && body[cursor] === ':') {
        cursor++
        while (/\s/.test(body[cursor] ?? '')) cursor++
        const number = body.slice(cursor).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)?.[0]
        if (number && !isSafelyRoundTrippableInteger(number)) {
          let sentinel = `__agentic_mermaid_exact_id_${replacements.length}__`
          while (body.includes(sentinel)) sentinel += '_'
          replacements.push({ sentinel, raw: number, start: cursor, end: cursor + number.length })
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

function isSafelyRoundTrippableInteger(token: string): boolean {
  if (!/^-?(?:0|[1-9]\d*)$/.test(token)) return false
  try {
    const value = BigInt(token)
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
  } catch {
    return false
  }
}

/** Serialize a JSON-RPC response (or response batch) while restoring exact
 * numeric ids. Sentinels can only occur in top-level response `id` positions;
 * replacement includes the `"id":` key so equal strings in result data are
 * never rewritten. */
export function stringifyJsonRpc(payload: unknown, exactIds: ExactJsonRpcId[] = []): string {
  let body = JSON.stringify(payload)
  for (const { sentinel, raw } of exactIds) {
    body = body.replace(`"id":${JSON.stringify(sentinel)}`, `"id":${raw}`)
  }
  return body
}

export function reply(id: number | string | null, result: unknown): JsonRpcResponse { return { jsonrpc: '2.0', id, result } }
export function rpcError(id: number | string | null, code: number, message: string): JsonRpcResponse { return { jsonrpc: '2.0', id, error: { code, message } } }

/** Wrap a tool payload in the MCP tools/call content envelope. */
export function toolResult(id: number | string | null, payload: unknown, isError: boolean): JsonRpcResponse {
  return reply(id, { content: [{ type: 'text', text: JSON.stringify(payload) }], isError })
}
