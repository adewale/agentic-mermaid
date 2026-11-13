// Assert protocol codes on emitted responses. The 2026-07-28 revision reserves
// -32020..-32099 for specified MCP meanings and retires legacy codes such as
// -32002 and -32042. Source literals cannot prove which code a client receives.
import { describe, expect, test } from 'bun:test'
import { handleHostedRequest, type HostedMcpContext } from '../mcp/hosted-server.ts'
import { handleRequest } from '../mcp/server.ts'
import { createMcpHandler } from '../../website/src/mcp-handler.ts'
import { META_CLIENT_CAPABILITIES, META_CLIENT_INFO, META_PROTOCOL_VERSION } from '../mcp/protocol-versions.ts'
import type { JsonRpcRequest } from '../mcp/protocol.ts'

const MODERN = '2026-07-28'
const context = (): HostedMcpContext => ({ async execute() { throw new Error('unexpected execution of rejected request') } })
const modernMeta = {
  [META_PROTOCOL_VERSION]: MODERN,
  [META_CLIENT_INFO]: { name: 'error-contract-test', version: '1.0.0' },
  [META_CLIENT_CAPABILITIES]: {},
}

function modern(method = 'tools/list', params: Record<string, unknown> = {}): JsonRpcRequest {
  return { jsonrpc: '2.0', id: 'code-probe', method, params: { _meta: modernMeta, ...params } }
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://agentic-mermaid.dev/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'mcp-protocol-version': MODERN, 'mcp-method': 'tools/list', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function handler() {
  return createMcpHandler({ context: context(), cacheVersion: 'error-contract-test', onEvent: () => {} })
}

describe('MCP error codes received by clients', () => {
  test.each([
    ['unsupported version', modern(), { 'mcp-protocol-version': '1999-01-01' }, -32022],
    ['version header disagrees with body', modern(), { 'mcp-protocol-version': '2025-11-25' }, -32020],
    ['method header disagrees with body', modern(), { 'mcp-method': 'tools/call' }, -32020],
    ['missing capabilities', modern('tools/list', { _meta: { [META_PROTOCOL_VERSION]: MODERN } }), {}, -32602],
    ['unknown method', modern('missing/method'), { 'mcp-method': 'missing/method' }, -32601],
    ['unknown tool', modern('tools/call', { name: 'missing_tool', arguments: {} }), { 'mcp-method': 'tools/call', 'mcp-name': 'missing_tool' }, -32602],
    ['malformed JSON', '{', {}, -32700],
    ['invalid request envelope', { jsonrpc: '2.0', id: 'code-probe', method: 7 }, {}, -32600],
  ] as const)('%s emits the specified JSON-RPC error', async (_name, request, headers, code) => {
    const response = await handler()(post(request, headers))
    const body = await response.json() as { jsonrpc: string; id: unknown; error: { code: number; message: string; data?: { supported?: string[] } }; result?: unknown }
    expect(body).toMatchObject({ jsonrpc: '2.0', error: { code } })
    expect(body.error.message.length).toBeGreaterThan(0)
    expect(body).not.toHaveProperty('result')
    expect(body.id).toBe(code === -32700 || code === -32600 ? null : 'code-probe')
    if (code === -32022) expect(body.error.data?.supported).toContain(MODERN)
  })

  // Both dispatchers must retain standard JSON-RPC errors, rather than invent
  // a code in the MCP-reserved range for ordinary invalid input.
  for (const [surface, dispatch] of [
    ['hosted', (request: JsonRpcRequest) => handleHostedRequest(request, context())],
    ['local', (request: JsonRpcRequest) => handleRequest(request)],
  ] as const) {
    test.each([
      ['missing capabilities', modern('tools/list', { _meta: { [META_PROTOCOL_VERSION]: MODERN } }), -32602],
      ['unknown method', modern('missing/method'), -32601],
      ['unknown tool', modern('tools/call', { name: 'missing_tool', arguments: {} }), -32602],
    ] as const)(`${surface}: %s retains the standard error code`, async (_name, request, code) => {
      const response = await dispatch(request)
      expect(response).toMatchObject({ jsonrpc: '2.0', id: 'code-probe', error: { code } })
      expect(response).not.toHaveProperty('result')
    })
  }

  test.each([
    ['origin refusal', { origin: 'https://attacker.invalid' }, 403],
    ['non-JSON body', { 'content-type': 'text/plain' }, 415],
    ['oversized declared body', { 'content-length': String(10 * 1024 * 1024) }, 413],
  ] as const)('%s is an HTTP failure without a fabricated JSON-RPC error', async (_name, headers, status) => {
    const response = await handler()(post(modern(), headers))
    expect(response.status).toBe(status)
    const body = await response.json()
    expect(body).not.toHaveProperty('jsonrpc')
    expect(body).not.toHaveProperty('id')
    expect(body).not.toHaveProperty('error.code')
  })

  test('a well-formed modern request returns tools without an error', async () => {
    const response = await handler()(post(modern()))
    expect(response.status).toBe(200)
    const body = await response.json() as { result: { tools: unknown[] } }
    expect(body).toMatchObject({ jsonrpc: '2.0', id: 'code-probe' })
    expect(body).not.toHaveProperty('error')
    expect(body.result.tools.length).toBeGreaterThan(0)
  })
})
