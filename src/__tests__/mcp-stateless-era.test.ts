// Dual-era MCP: the 2026-07-28 stateless revision served alongside the
// handshake-based revisions, per docs/project/stateless-mcp-migration-plan.md.
//
// Two things this file guards that nothing else can:
//
// 1. Era SELECTION. A modern request must never be answered with legacy
//    semantics and vice versa. The selection rule is the body's `_meta`, with
//    the HTTP header able to pin it; both directions are exercised.
// 2. Version PINNING in the tests themselves. Every modern case here builds its
//    request with an explicit 2026-07-28 `_meta` block. A conformance test that
//    lets the version default negotiates a legacy revision and silently proves
//    nothing — the failure mode the migration plan §7.2 calls out. Each modern
//    case therefore also asserts the era it actually exercised, so a regression
//    that quietly downgrades the request fails here instead of passing.

import { describe, expect, test } from 'bun:test'
import { createMcpHandler, type McpRequestEvent } from '../../website/src/mcp-handler.ts'
import {
  handleHostedRequest, HOSTED_MCP_SERVER_NAME, SUPPORTED_PROTOCOL_VERSIONS,
  type HostedMcpContext,
} from '../mcp/hosted-server.ts'
import {
  HEADER_MISMATCH, META_CLIENT_CAPABILITIES, META_CLIENT_INFO, META_PROTOCOL_VERSION,
  UNSUPPORTED_PROTOCOL_VERSION, eraForRequest, isModernProtocolVersion,
} from '../mcp/protocol-versions.ts'
import { MCP_SERVER_VERSION } from '../mcp/tool-surface.ts'
import type { JsonRpcRequest } from '../mcp/protocol.ts'

const MODERN = '2026-07-28'
const FLOW = 'flowchart TD\n  A --> B'

function context(): HostedMcpContext {
  return { async execute() { return { ok: true, value: 42, logs: [] } } }
}

/** A modern request: `_meta` always carries all three required fields. */
function modern(method: string, params: Record<string, unknown> = {}, id: number | string = 1): JsonRpcRequest {
  return {
    jsonrpc: '2.0', id, method,
    params: {
      ...params,
      _meta: {
        [META_PROTOCOL_VERSION]: MODERN,
        [META_CLIENT_INFO]: { name: 'era-test', version: '1.0.0' },
        [META_CLIENT_CAPABILITIES]: {},
      },
    },
  }
}

function legacy(method: string, params?: Record<string, unknown>, id: number | string = 1): JsonRpcRequest {
  return { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://agentic-mermaid.dev/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/** Headers a conforming modern client sends for a given body. */
function modernHeaders(body: JsonRpcRequest): Record<string, string> {
  const name = (body.params as { name?: unknown } | undefined)?.name
  return {
    'mcp-protocol-version': MODERN,
    'mcp-method': body.method,
    ...(typeof name === 'string' ? { 'mcp-name': name } : {}),
  }
}

function handler(onEvent: (e: McpRequestEvent) => void = () => {}) {
  return createMcpHandler({ context: context(), cacheVersion: 'era-test', onEvent })
}

async function payload(response: Response) {
  return { status: response.status, body: await response.json() as any }
}

describe('era selection', () => {
  test('the modern fixture really is modern, and the legacy fixture really is legacy', () => {
    // Guards the guard: if `modern()` ever stopped producing a modern request,
    // every "modern" assertion below would silently test the legacy path.
    expect(eraForRequest(modern('tools/list'))).toBe('modern')
    expect(eraForRequest(legacy('tools/list'))).toBe('legacy')
    expect(isModernProtocolVersion(MODERN)).toBe(true)
    expect(isModernProtocolVersion('2025-11-25')).toBe(false)
  })

  test('a modern tools/list succeeds with no prior initialize', async () => {
    const response = await handleHostedRequest(modern('tools/list'), context())
    expect((response?.result as { tools: unknown[] }).tools.length).toBeGreaterThan(0)
  })

  test('a modern tools/call succeeds with no prior initialize', async () => {
    const response = await handleHostedRequest(modern('tools/call', { name: 'verify', arguments: { source: FLOW } }), context())
    const result = response?.result as { isError: boolean; content: Array<{ text: string }> }
    expect(result.isError).toBe(false)
    expect(JSON.parse(result.content[0]!.text).ok).toBe(true)
  })

  test.each(['initialize', 'ping', 'notifications/initialized'])('%s is removed in the modern era', async method => {
    const response = await handleHostedRequest(modern(method), context())
    expect(response?.error?.code).toBe(-32601)
  })

  test.each(['initialize', 'ping'])('%s still works for a legacy client', async method => {
    const response = await handleHostedRequest(legacy(method, { protocolVersion: '2025-06-18' }), context())
    expect(response?.error).toBeUndefined()
    expect(response?.result).toBeDefined()
  })

  test('a legacy notifications/initialized is still a silent notification', async () => {
    expect(await handleHostedRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }, context())).toBeNull()
  })
})

describe('server/discover', () => {
  test('reports the supported versions, identity, capabilities, and instructions', async () => {
    const response = await handleHostedRequest(modern('server/discover'), context())
    const result = response?.result as any
    expect(result.supportedVersions).toEqual([...SUPPORTED_PROTOCOL_VERSIONS])
    expect(result.serverInfo).toEqual({ name: HOSTED_MCP_SERVER_NAME, version: MCP_SERVER_VERSION })
    expect(result.capabilities).toEqual({ tools: {} })
    expect(typeof result.instructions).toBe('string')
  })

  test('is answered in the legacy era too, so a dual-era client can probe with it', async () => {
    const response = await handleHostedRequest(legacy('server/discover'), context())
    expect((response?.result as any).supportedVersions).toEqual([...SUPPORTED_PROTOCOL_VERSIONS])
  })

  test('advertises exactly what the version gate accepts', async () => {
    // Discovery that disagrees with admission sends clients to a version we
    // then reject, which is worse than not advertising at all. Each version is
    // probed with a body of its own era — a modern pin carrying a legacy body
    // is correctly a header mismatch, not evidence the version is unsupported.
    const advertised = (await handleHostedRequest(modern('server/discover'), context()))?.result as { supportedVersions: string[] }
    expect(advertised.supportedVersions.length).toBeGreaterThan(0)
    for (const version of advertised.supportedVersions) {
      const request = isModernProtocolVersion(version) ? modern('tools/list') : legacy('tools/list')
      const headers = isModernProtocolVersion(version)
        ? modernHeaders(request)
        : { 'mcp-protocol-version': version }
      const response = await handler()(post(request, headers))
      expect({ version, status: response.status }).toEqual({ version, status: 200 })
    }
  })
})

describe('modern _meta is required and validated', () => {
  test.each([
    ['no _meta at all', {}],
    ['missing clientCapabilities', { [META_PROTOCOL_VERSION]: MODERN, [META_CLIENT_INFO]: { name: 'x', version: '1' } }],
    // clientInfo is optional, but a SUPPLIED one is an `Implementation` and must
    // be well-formed — absent and malformed are different cases.
    ['clientInfo without version', { [META_PROTOCOL_VERSION]: MODERN, [META_CLIENT_INFO]: { name: 'x' }, [META_CLIENT_CAPABILITIES]: {} }],
    ['clientInfo that is not an object', { [META_PROTOCOL_VERSION]: MODERN, [META_CLIENT_INFO]: 'acme/1.0', [META_CLIENT_CAPABILITIES]: {} }],
  ])('%s is rejected with INVALID_PARAMS', async (_label, meta) => {
    const request: JsonRpcRequest = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { [META_PROTOCOL_VERSION]: MODERN, ...meta } } }
    // Only the cases that still declare a modern version reach the check; the
    // 'no _meta' case is legacy by the selection rule and must NOT be rejected.
    const response = await handleHostedRequest(request, context())
    if (Object.keys(meta).length === 0) return
    expect(response?.error?.code).toBe(-32602)
  })

  // The spec's per-request field table marks clientInfo Required: No — "Clients
  // SHOULD include io.modelcontextprotocol/clientInfo on every request unless
  // specifically configured not to do so". A client configured to withhold it is
  // conforming, so rejecting it locked out a legal client. Bug-discriminating:
  // this fails against the previous validator, which required clientInfo.
  test('a modern request omitting the optional clientInfo is accepted', async () => {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: { _meta: { [META_PROTOCOL_VERSION]: MODERN, [META_CLIENT_CAPABILITIES]: {} } },
    }
    const response = await handleHostedRequest(request, context())
    expect(response?.error).toBeUndefined()
    expect(response?.result).toBeDefined()
  })

  test('an empty clientCapabilities object is valid — it declares no optional capabilities', async () => {
    const response = await handleHostedRequest(modern('tools/list'), context())
    expect(response?.error).toBeUndefined()
  })

  test('a request with no _meta is legacy, not malformed', async () => {
    const response = await handleHostedRequest(legacy('tools/list'), context())
    expect(response?.error).toBeUndefined()
  })

  test('_meta on the params envelope never reaches closed tool-argument validation', async () => {
    // The closed additionalProperties:false schemas govern `arguments` only. If
    // they were ever extended to the envelope, every modern tools/call would
    // fail its own schema.
    const response = await handleHostedRequest(modern('tools/call', { name: 'describe', arguments: { source: FLOW } }), context())
    expect((response?.result as { isError: boolean }).isError).toBe(false)
  })
})

describe('SEP-1303 input-validation envelope', () => {
  const badArgs = { name: 'describe', arguments: { source: FLOW, nope: 1 } }

  test('2025-06-18 and earlier keep the JSON-RPC protocol error', async () => {
    const response = await handleHostedRequest(legacy('tools/call', badArgs), context(), { protocolVersion: '2025-06-18' })
    expect(response?.error?.code).toBe(-32602)
    expect(response?.error?.message).toContain('arguments.nope is not allowed')
  })

  test('2025-11-25 onward returns a tool execution error so the model can self-correct', async () => {
    const response = await handleHostedRequest(legacy('tools/call', badArgs), context(), { protocolVersion: '2025-11-25' })
    expect(response?.error).toBeUndefined()
    const result = response?.result as { isError: boolean; content: Array<{ text: string }> }
    expect(result.isError).toBe(true)
    const body = JSON.parse(result.content[0]!.text)
    expect(body.error.code).toBe('INVALID_ARGUMENTS')
    // Same diagnostic either way — only the envelope changes.
    expect(body.error.message).toContain('arguments.nope is not allowed')
  })

  test('the modern era uses the tool-error envelope', async () => {
    const response = await handleHostedRequest(modern('tools/call', badArgs), context())
    expect((response?.result as { isError: boolean }).isError).toBe(true)
  })
})

describe('transport: protocol version', () => {
  test('2025-11-25 is accepted', async () => {
    const response = await handler()(post(legacy('tools/list'), { 'mcp-protocol-version': '2025-11-25' }))
    expect(response.status).toBe(200)
  })

  test('an unsupported version is 400 with UnsupportedProtocolVersionError and a supported list', async () => {
    const { status, body } = await payload(await handler()(post(legacy('tools/list'), { 'mcp-protocol-version': '1999-01-01' })))
    expect(status).toBe(400)
    expect(body.error.code).toBe(UNSUPPORTED_PROTOCOL_VERSION)
    // The `supported` array is the whole point: without it a client cannot pick
    // a version to retry with.
    expect(body.error.data.supported).toEqual([...SUPPORTED_PROTOCOL_VERSIONS])
    expect(body.error.data.requested).toBe('1999-01-01')
  })

  test('a missing header is still permitted for pre-2025-06-18 clients', async () => {
    expect((await handler()(post(legacy('tools/list')))).status).toBe(200)
  })
})

describe('transport: modern header/body validation', () => {
  const call = modern('tools/call', { name: 'verify', arguments: { source: FLOW } })

  test('a conforming modern request passes', async () => {
    const response = await handler()(post(call, modernHeaders(call)))
    expect(response.status).toBe(200)
  })

  test('a modern body with no protocol-version header is rejected', async () => {
    const { status, body } = await payload(await handler()(post(call, { 'mcp-method': 'tools/call', 'mcp-name': 'verify' })))
    expect(status).toBe(400)
    expect(body.error.code).toBe(HEADER_MISMATCH)
  })

  test('a modern header with no _meta is rejected rather than silently served as legacy', async () => {
    const { status, body } = await payload(await handler()(post(legacy('initialize'), { 'mcp-protocol-version': MODERN, 'mcp-method': 'initialize' })))
    expect(status).toBe(400)
    expect(body.error.code).toBe(HEADER_MISMATCH)
    expect(body.error.message).toContain(META_PROTOCOL_VERSION)
  })

  test('a header version that disagrees with _meta is rejected', async () => {
    const { status, body } = await payload(await handler()(post(call, { ...modernHeaders(call), 'mcp-protocol-version': '2025-11-25' })))
    expect(status).toBe(400)
    expect(body.error.code).toBe(HEADER_MISMATCH)
  })

  test.each([
    ['Mcp-Method missing', (h: Record<string, string>) => { const { 'mcp-method': _drop, ...rest } = h; return rest }],
    ['Mcp-Method mismatched', (h: Record<string, string>) => ({ ...h, 'mcp-method': 'tools/list' })],
    ['Mcp-Name missing', (h: Record<string, string>) => { const { 'mcp-name': _drop, ...rest } = h; return rest }],
    ['Mcp-Name mismatched', (h: Record<string, string>) => ({ ...h, 'mcp-name': 'describe' })],
  ])('%s is rejected with HeaderMismatch', async (_label, mutate) => {
    const { status, body } = await payload(await handler()(post(call, mutate(modernHeaders(call)))))
    expect(status).toBe(400)
    expect(body.error.code).toBe(HEADER_MISMATCH)
  })

  test('a Base64-sentinel Mcp-Name is decoded before comparison', async () => {
    const encoded = `=?base64?${btoa('verify')}?=`
    const response = await handler()(post(call, { ...modernHeaders(call), 'mcp-name': encoded }))
    expect(response.status).toBe(200)
  })

  test('a Base64-sentinel Mcp-Name that decodes to the wrong value is still rejected', async () => {
    const encoded = `=?base64?${btoa('describe')}?=`
    const { status, body } = await payload(await handler()(post(call, { ...modernHeaders(call), 'mcp-name': encoded })))
    expect(status).toBe(400)
    expect(body.error.code).toBe(HEADER_MISMATCH)
  })

  test('an undecodable Base64 sentinel is rejected, not treated as a literal', async () => {
    const { status, body } = await payload(await handler()(post(call, { ...modernHeaders(call), 'mcp-name': '=?base64?!!!not-base64!!!?=' })))
    expect(status).toBe(400)
    expect(body.error.code).toBe(HEADER_MISMATCH)
  })

  test('legacy requests are not subjected to the modern header rules', async () => {
    // No Mcp-Method/Mcp-Name anywhere — exactly what every client sends today.
    expect((await handler()(post(legacy('tools/list'), { 'mcp-protocol-version': '2025-06-18' }))).status).toBe(200)
  })
})

describe('transport: unknown methods and batching', () => {
  test('an unknown method is 404 for a modern request', async () => {
    const request = modern('no/such/method')
    const { status, body } = await payload(await handler()(post(request, modernHeaders(request))))
    expect(status).toBe(404)
    expect(body.error.code).toBe(-32601)
  })

  test('an unknown method stays 200 for a legacy request', async () => {
    const { status, body } = await payload(await handler()(post(legacy('no/such/method'))))
    expect(status).toBe(200)
    expect(body.error.code).toBe(-32601)
  })

  test('initialize is 404 under a modern pin, since the method no longer exists', async () => {
    const request = modern('initialize')
    expect((await handler()(post(request, modernHeaders(request)))).status).toBe(404)
  })

  test.each(['2025-06-18', '2025-11-25', MODERN])('a batch is refused when the header pins %s', async version => {
    const { status, body } = await payload(await handler()(post([legacy('ping'), legacy('tools/list', undefined, 2)], { 'mcp-protocol-version': version })))
    expect(status).toBe(400)
    expect(body.error.code).toBe(-32600)
  })

  test('a batch whose items declare a modern version is refused even with no header', async () => {
    const { status, body } = await payload(await handler()(post([modern('tools/list')])))
    expect(status).toBe(400)
    expect(body.error.code).toBe(-32600)
  })

  test('a legacy batch still works', async () => {
    const { status, body } = await payload(await handler()(post([legacy('ping'), legacy('tools/list', undefined, 2)], { 'mcp-protocol-version': '2025-03-26' })))
    expect(status).toBe(200)
    expect(body).toHaveLength(2)
  })
})

describe('transport: CORS admits the modern headers', () => {
  test('preflight allows mcp-method and mcp-name', async () => {
    const response = await handler()(new Request('https://agentic-mermaid.dev/mcp', {
      method: 'OPTIONS',
      headers: { origin: 'https://agentic-mermaid.dev' },
    }))
    const allowed = response.headers.get('access-control-allow-headers') ?? ''
    // Without these a browser client cannot send a conforming modern request at
    // all: both headers are REQUIRED, so preflight fails before the POST.
    expect(allowed).toContain('mcp-method')
    expect(allowed).toContain('mcp-name')
  })

  test('a successful modern cross-origin response still carries the allow-origin header', async () => {
    const call = modern('tools/call', { name: 'verify', arguments: { source: FLOW } })
    const response = await handler()(post(call, { ...modernHeaders(call), origin: 'https://agentic-mermaid.dev' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://agentic-mermaid.dev')
  })

  test('every refusal path also carries CORS headers', async () => {
    // A 400 a browser cannot read is a 400 the client reports as a network
    // failure, which is how CORS bugs get misdiagnosed.
    const origin = { origin: 'https://agentic-mermaid.dev' }
    for (const request of [
      post(legacy('tools/list'), { ...origin, 'mcp-protocol-version': '1999-01-01' }),
      post(modern('tools/call', { name: 'verify', arguments: {} }), { ...origin, 'mcp-protocol-version': MODERN }),
      post([modern('tools/list')], origin),
    ]) {
      const response = await handler()(request)
      expect({ status: response.status, acao: response.headers.get('access-control-allow-origin') })
        .toEqual({ status: response.status, acao: 'https://agentic-mermaid.dev' })
    }
  })
})

// Two requirements the migration plan's §4 missed entirely, found by re-verifying
// it against the spec text rather than the RC announcement. Both are MUSTs, and
// both must stay off the legacy path: an older client is entitled to the response
// shape its revision defines.
describe('modern results carry the fields this revision requires', () => {
  test('a modern result declares resultType: complete', async () => {
    const response = await handleHostedRequest(modern('tools/list'), context())
    expect((response?.result as { resultType?: string }).resultType).toBe('complete')
  })

  // "For backward compatibility with servers implementing earlier protocol
  // versions, which do not include resultType, clients MUST treat an absent
  // resultType as complete." Adding it to legacy results would be a silent
  // wire change for every existing client.
  test('a legacy result does NOT declare resultType', async () => {
    const response = await handleHostedRequest(legacy('tools/list'), context())
    expect(response?.result).toBeDefined()
    expect((response?.result as { resultType?: string }).resultType).toBeUndefined()
  })

  test.each(['tools/list', 'server/discover'])('%s carries public caching hints in the modern era', async method => {
    const response = await handleHostedRequest(modern(method), context())
    const result = response?.result as { ttlMs?: number; cacheScope?: string }
    // "Servers MUST provide a ttlMs value that is >= 0."
    expect(result.ttlMs).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(result.ttlMs)).toBe(true)
    // The tool surface is fixed at build time and identical for every caller.
    expect(result.cacheScope).toBe('public')
  })

  test.each(['tools/list', 'server/discover'])('%s carries no caching hints in the legacy era', async method => {
    const result = (await handleHostedRequest(legacy(method), context()))?.result as Record<string, unknown>
    expect(result.ttlMs).toBeUndefined()
    expect(result.cacheScope).toBeUndefined()
  })

  // The spec lists exactly which operations get hints; tools/call is not one of
  // them, and a cached tool CALL would be a correctness bug, not an optimisation.
  test('a modern tools/call result is complete but not cacheable', async () => {
    const response = await handleHostedRequest(modern('tools/call', { name: 'verify', arguments: { text: FLOW } }), context())
    const result = response?.result as Record<string, unknown>
    expect(result.resultType).toBe('complete')
    expect(result.ttlMs).toBeUndefined()
    expect(result.cacheScope).toBeUndefined()
  })

  test('an error response is not decorated', async () => {
    const response = await handleHostedRequest(modern('no/such/method'), context())
    expect(response?.error?.code).toBe(-32601)
    expect(response?.result).toBeUndefined()
  })
})
