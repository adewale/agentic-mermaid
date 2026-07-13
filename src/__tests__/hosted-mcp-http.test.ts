// Streamable HTTP transport for the hosted MCP endpoint
// (website/src/mcp-handler.ts), driven with real Request/Response objects.
// The only fakes are the seams that need workerd: the Cache API (Map-backed,
// same match/put contract) and the execute sandbox (call-recording).

import { describe, expect, test } from 'bun:test'
import { createMcpHandler, MAX_MCP_BODY_BYTES, MAX_BATCH_ITEMS, type McpCache, type McpRequestEvent } from '../../website/src/mcp-handler.ts'
import type { HostedMcpContext } from '../mcp/hosted-server.ts'
import { PNG_WASM_RUNTIME } from '../png-contract.ts'

const FLOW = 'flowchart LR\n  A --> B'
const TEST_PNG_RECEIPT = { version: 1, output: 'png', sharedRequestDigest: 'test-shared', requestDigest: 'test-request', appearanceDigest: 'test-appearance' } as const

function makeCache(): McpCache & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    async match(key) {
      const hit = store.get(key.url)
      return hit === undefined ? undefined : new Response(hit, { headers: { 'content-type': 'application/json' } })
    },
    async put(key, response) {
      store.set(key.url, await response.text())
    },
  }
}

function makeHandler(overrides: { cache?: McpCache; context?: Partial<HostedMcpContext>; waitUntil?: (p: Promise<unknown>) => void; onEvent?: (e: McpRequestEvent) => void } = {}) {
  const executeCalls: string[] = []
  const context: HostedMcpContext = {
    async execute(code) {
      executeCalls.push(code)
      return { ok: true, value: 'ran', logs: [] }
    },
    ...overrides.context,
  }
  // Silence the default console.log wide event; event-shape tests inject a collector.
  const handler = createMcpHandler({ context, cache: overrides.cache, cacheVersion: 'test-1', waitUntil: overrides.waitUntil, onEvent: overrides.onEvent ?? (() => {}) })
  return { handler, executeCalls }
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return new Request('https://agentic-mermaid.dev/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: text,
  })
}

const rpc = (method: string, params?: unknown, id: number | string = 1) => ({ jsonrpc: '2.0', id, method, params })
const call = (name: string, args: Record<string, unknown>, id: number | string = 1) => rpc('tools/call', { name, arguments: args }, id)

describe('method and header validation', () => {
  test('OPTIONS preflight answers CORS without touching the server', async () => {
    const { handler } = makeHandler()
    const res = await handler(new Request('https://agentic-mermaid.dev/mcp', { method: 'OPTIONS' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
  })

  test('GET is 405: stateless server, no server-initiated stream', async () => {
    const { handler } = makeHandler()
    const res = await handler(new Request('https://agentic-mermaid.dev/mcp'))
    expect(res.status).toBe(405)
    expect(((await res.json()) as any).error.message).toContain('stateless')
  })

  test('non-JSON content types are 415', async () => {
    const { handler } = makeHandler()
    const res = await handler(post('x', { 'content-type': 'text/plain' }))
    expect(res.status).toBe(415)
  })

  test('bodies over the cap are 413 with the local-fallback hint, declared or not', async () => {
    const { handler } = makeHandler()
    const big = JSON.stringify(call('describe', { source: 'x'.repeat(MAX_MCP_BODY_BYTES) }))
    const declared = await handler(post(big))
    expect(declared.status).toBe(413)
    // Parity with the 64KB per-field cap: the refusal names the way out.
    expect(((await declared.json()) as any).error.message).toContain('agentic-mermaid.dev/docs/mcp')
    const undeclared = await handler(new Request('https://agentic-mermaid.dev/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // A stream hides the length until read.
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(big))
          controller.close()
        },
      }),
    }))
    expect(undeclared.status).toBe(413)
  })

  test('malformed JSON is a -32700 parse error', async () => {
    const { handler } = makeHandler()
    const res = await handler(post('{"jsonrpc": "2.0",'))
    expect(res.status).toBe(400)
    expect(((await res.json()) as any).error.code).toBe(-32700)
  })

  test('non-request shapes are -32600', async () => {
    const { handler } = makeHandler()
    const res = await handler(post({ id: 1, method: 'ping' })) // missing jsonrpc
    expect(await res.json()).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32600 } })
    const noId = await handler(post({ method: 'ping' }))
    expect(noId.status).toBe(200)
    const noIdBody = (await noId.json()) as any
    expect(noIdBody).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32600 } })
  })

  test('HTTP-level error responses still carry CORS so a browser client can read them', async () => {
    // 405/415/413/400 all flow through the same json() helper; a browser fetch
    // needs the CORS header on the error too or it never sees the status.
    const { handler } = makeHandler()
    const errorResponses = [
      await handler(new Request('https://agentic-mermaid.dev/mcp')), // 405
      await handler(post('x', { 'content-type': 'text/plain' })), // 415
      await handler(post('{"jsonrpc": "2.0",')), // 400 parse error
    ]
    for (const res of errorResponses) {
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
    }
  })
})

describe('JSON-RPC round trips', () => {
  test('initialize round trip carries protocol version and CORS', async () => {
    const { handler } = makeHandler()
    const res = await handler(post(rpc('initialize', { protocolVersion: '2025-03-26' })))
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as any
    expect(body.result.protocolVersion).toBe('2025-03-26')
  })

  test('every notification gets an empty 202', async () => {
    const { handler } = makeHandler()
    for (const method of ['notifications/initialized', 'ping', 'made/up']) {
      const res = await handler(post({ jsonrpc: '2.0', method }))
      expect({ method, status: res.status, body: await res.text() }).toEqual({ method, status: 202, body: '' })
    }
  })

  test('batches answer per-request and drop notification slots', async () => {
    const { handler } = makeHandler()
    const res = await handler(post([rpc('ping', undefined, 'a'), { jsonrpc: '2.0', method: 'notifications/initialized' }, rpc('tools/list', undefined, 'b')]))
    const body = (await res.json()) as any[]
    expect(body.map(r => r.id)).toEqual(['a', 'b'])
  })

  test('empty batches are -32600', async () => {
    const { handler } = makeHandler()
    expect((await handler(post([]))).status).toBe(400)
  })

  test('a batch over the fan-out cap is refused before any tool runs', async () => {
    const { handler, executeCalls } = makeHandler()
    const overCap = Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, i) => call('execute', { code: `${i}` }, i))
    const res = await handler(post(overCap))
    expect(res.status).toBe(400)
    expect(((await res.json()) as any).error.message).toContain(`${MAX_BATCH_ITEMS}`)
    expect(executeCalls).toHaveLength(0) // nothing executed — cap is enforced up front
  })

  test('a batch exactly at the cap still runs', async () => {
    const { handler } = makeHandler()
    const atCap = Array.from({ length: MAX_BATCH_ITEMS }, (_, i) => rpc('ping', undefined, i))
    const res = await handler(post(atCap))
    expect(res.status).toBe(200)
    expect((await res.json()) as any[]).toHaveLength(MAX_BATCH_ITEMS)
  })

  // execute is the only tool with a per-item isolate CPU budget, so it is the
  // one batch amplifier (20 × 30s cpuMs = 600 billable CPU-seconds per HTTP
  // request). Measured worst legitimate single item — a 64KB flowchart through
  // parse+verify+serialize — needs ~18s, so the per-item budget stays and the
  // per-request multiplicity goes.
  test('a batch may carry at most one execute item, refused before any isolate spins', async () => {
    const { handler, executeCalls } = makeHandler()
    const res = await handler(post([call('execute', { code: '1' }, 'a'), call('execute', { code: '2' }, 'b')]))
    expect(res.status).toBe(400)
    expect(((await res.json()) as any).error.message).toContain('at most 1 execute call')
    expect(executeCalls).toHaveLength(0)
  })

  test('one execute may ride with cheap tools up to the fan-out cap', async () => {
    const { handler } = makeHandler()
    const items = [call('execute', { code: '40 + 2' }, 'x'), ...Array.from({ length: MAX_BATCH_ITEMS - 1 }, (_, i) => rpc('ping', undefined, i))]
    const res = await handler(post(items))
    expect(res.status).toBe(200)
    expect((await res.json()) as any[]).toHaveLength(MAX_BATCH_ITEMS)
  })
})

describe('protocol-version header validation', () => {
  test('a supported version header is accepted', async () => {
    const { handler } = makeHandler()
    const res = await handler(post(rpc('ping'), { 'mcp-protocol-version': '2025-03-26' }))
    expect(res.status).toBe(200)
  })

  test('an unsupported version header is 400 before any work', async () => {
    const { handler, executeCalls } = makeHandler()
    const res = await handler(post(call('execute', { code: '1' }), { 'mcp-protocol-version': '1999-01-01' }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as any).error.message).toContain('1999-01-01')
    expect(executeCalls).toHaveLength(0)
  })

  test('a 2025-06-18 client cannot batch (batching was removed in that revision)', async () => {
    const { handler } = makeHandler()
    const res = await handler(post([rpc('ping', undefined, 'a'), rpc('ping', undefined, 'b')], { 'mcp-protocol-version': '2025-06-18' }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as any).error.message).toContain('2025-06-18')
  })

  test('a batch with no version header still works (pre-2025-06-18 semantics)', async () => {
    const { handler } = makeHandler()
    const res = await handler(post([rpc('ping', undefined, 'a'), rpc('ping', undefined, 'b')]))
    expect(res.status).toBe(200)
    expect(((await res.json()) as any[]).map(r => r.id)).toEqual(['a', 'b'])
  })
})

describe('CORS Origin validation', () => {
  test('a request with no Origin (agent/server) keeps wildcard CORS', async () => {
    const { handler } = makeHandler()
    const res = await handler(post(rpc('ping')))
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  test('an allowlisted browser Origin is echoed back, not wildcarded', async () => {
    const { handler } = makeHandler()
    const res = await handler(post(rpc('ping'), { origin: 'https://agentic-mermaid.dev' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://agentic-mermaid.dev')
    expect(res.headers.get('vary')).toContain('Origin')
  })

  test('a disallowed cross-origin browser request is 403 with no ACAO, before any tool runs', async () => {
    const { handler, executeCalls } = makeHandler()
    const res = await handler(post(call('execute', { code: '1' }), { origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(executeCalls).toHaveLength(0)
  })

  test('same host with a different or non-HTTP scheme is not same-origin', async () => {
    const { handler } = makeHandler()
    for (const origin of ['http://agentic-mermaid.dev', 'ftp://agentic-mermaid.dev']) {
      const res = await handler(post(rpc('ping'), { origin, host: 'agentic-mermaid.dev' }))
      expect({ origin, status: res.status, reflected: res.headers.get('access-control-allow-origin') })
        .toEqual({ origin, status: 403, reflected: null })
    }
  })

  test('invalid JSON media-type lookalikes are rejected', async () => {
    const { handler } = makeHandler()
    for (const contentType of ['application/jsonp', 'application/json-patch+json', 'application/json garbage']) {
      const res = await handler(post(rpc('ping'), { 'content-type': contentType }))
      expect({ contentType, status: res.status }).toEqual({ contentType, status: 415 })
    }
  })

  test('a disallowed Origin is refused on the OPTIONS preflight too (no ACAO granted)', async () => {
    const { handler } = makeHandler()
    const res = await handler(new Request('https://agentic-mermaid.dev/mcp', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('tool errors still travel as 200-with-isError, not HTTP failures', async () => {
    const { handler } = makeHandler()
    const res = await handler(post(call('render_svg', { source: 'flowchart XX\n  A --> B' })))
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.result.isError).toBe(true)
  })
})

describe('deterministic-response caching', () => {
  test('identical deterministic tools/call requests hit the cache; ids are re-stamped', async () => {
    const cache = makeCache()
    const { handler, executeCalls } = makeHandler({ cache })
    const first = (await (await handler(post(call('describe', { source: FLOW }, 'first')))).json()) as any
    const second = (await (await handler(post(call('describe', { source: FLOW }, 'second')))).json()) as any
    expect(executeCalls).toHaveLength(0)
    expect(cache.store.size).toBe(1)
    expect(first.id).toBe('first')
    expect(second.id).toBe('second')
    expect(second.result).toEqual(first.result)
  })

  test('argument key order does not split the cache', async () => {
    const cache = makeCache()
    const { handler } = makeHandler({ cache })
    await handler(post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'describe', arguments: { source: FLOW } } }))
    await handler(post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { arguments: { source: FLOW }, name: 'describe' } }))
    expect(cache.store.size).toBe(1)
  })

  test('error results are never cached', async () => {
    const cache = makeCache()
    const { handler, executeCalls } = makeHandler({
      cache,
      context: { execute: async code => ({ ok: false, error: 'transient loader failure', logs: [] }) },
    })
    await handler(post(call('execute', { code: '1 + 1' })))
    await handler(post(call('execute', { code: '1 + 1' })))
    expect(cache.store.size).toBe(0)
  })

  test('cache writes ride waitUntil when provided', async () => {
    const cache = makeCache()
    const deferred: Promise<unknown>[] = []
    const { handler } = makeHandler({ cache, waitUntil: p => { deferred.push(p) } })
    await handler(post(call('describe', { source: FLOW })))
    expect(deferred).toHaveLength(1)
    await Promise.all(deferred)
    expect(cache.store.size).toBe(1)
  })

  test('a broken cache degrades to uncached, not to failure', async () => {
    const cache: McpCache = {
      match: async () => { throw new Error('cache backend down') },
      put: async () => { throw new Error('cache backend down') },
    }
    const { handler } = makeHandler({ cache })
    const res = await handler(post(call('describe', { source: FLOW })))
    expect(res.status).toBe(200)
    expect(((await res.json()) as any).result.isError).toBe(false)
  })

  test('non-tool methods bypass the cache entirely', async () => {
    const cache = makeCache()
    const { handler } = makeHandler({ cache })
    await handler(post(rpc('tools/list')))
    await handler(post(rpc('initialize')))
    expect(cache.store.size).toBe(0)
  })
})

describe('cache eligibility and validation isolation', () => {
  test('invalid execute arguments are rejected and valid execute calls bypass the cache', async () => {
    const cache = makeCache()
    const { handler, executeCalls } = makeHandler({ cache })
    const first = await handler(post(call('execute', { code: '1 + 1', nonce: 'a' })))
    const second = await handler(post(call('execute', { code: '1 + 1', nonce: 'b' })))
    expect(((await first.json()) as any).error.code).toBe(-32602)
    expect(((await second.json()) as any).error.code).toBe(-32602)
    await handler(post(call('execute', { code: '1 + 1' })))
    await handler(post(call('execute', { code: '1 + 1' })))
    expect(executeCalls).toHaveLength(2)
    expect(cache.store.size).toBe(0)
  })

  test('execute timeouts cannot be hidden by a warm response cache entry', async () => {
    const cache = makeCache()
    const { handler, executeCalls } = makeHandler({ cache })
    await handler(post(call('execute', { code: '1 + 1', timeoutMs: 1000 })))
    const invalid = await handler(post(call('execute', { code: '1 + 1', timeoutMs: 0 })))
    expect(executeCalls).toHaveLength(1)
    expect(cache.store.size).toBe(0)
    expect(((await invalid.json()) as any).error).toEqual(expect.objectContaining({ code: -32602 }))
  })

  test('validated scale inputs that clamp identically share a cache entry', async () => {
    const cache = makeCache()
    const pngCalls: number[] = []
    const { handler } = makeHandler({
      cache,
      context: { renderPng: async (_s, opts) => { pngCalls.push(opts.scale ?? -1); return { png: new Uint8Array([1]), warnings: [], receipt: TEST_PNG_RECEIPT, runtime: PNG_WASM_RUNTIME } } },
    })
    await handler(post(call('render_png', { source: FLOW, scale: 100 })))
    await handler(post(call('render_png', { source: FLOW, scale: 999 })))
    expect(pngCalls).toEqual([8])
    expect(cache.store.size).toBe(1)
  })

  test('semantically distinct calls still get distinct entries', async () => {
    const cache = makeCache()
    const { handler } = makeHandler({ cache })
    await handler(post(call('describe', { source: FLOW })))
    await handler(post(call('describe', { source: 'flowchart TD\n  X --> Y' })))
    expect(cache.store.size).toBe(2)
  })

  test('unknown tool names bypass the cache without a lookup or store', async () => {
    const cache = makeCache()
    let matches = 0
    const spied: McpCache = {
      match: async k => { matches++; return cache.match(k) },
      put: (k, r) => cache.put(k, r),
    }
    const { handler } = makeHandler({ cache: spied })
    const res = await handler(post(call('render_gif', { source: FLOW })))
    expect(((await res.json()) as any).error.code).toBe(-32602)
    expect(matches).toBe(0)
    expect(cache.store.size).toBe(0)
  })
})

describe('wide-event canonical log lines', () => {
  // One structured event per HTTP request (Stripe canonical-log-lines shape),
  // collected through the injectable onEvent seam instead of stdout capture.
  function capture() {
    const events: McpRequestEvent[] = []
    return { events, onEvent: (e: McpRequestEvent) => events.push(e) }
  }

  test('a verify call emits exactly one success event; the repeat is a cache hit', async () => {
    const { events, onEvent } = capture()
    const { handler } = makeHandler({ cache: makeCache(), onEvent })
    await handler(post(call('verify', { source: FLOW })))
    await handler(post(call('verify', { source: FLOW })))
    expect(events).toHaveLength(2)
    const [first, second] = events as [McpRequestEvent, McpRequestEvent]
    expect(first).toEqual(expect.objectContaining({
      event: 'mcp_request', method: 'tools/call', http_status: 200, outcome: 'success',
      deploy_version: 'test-1', batch_size: 1, protocol_version: null, has_origin: false,
    }))
    expect(first.request_id).not.toBe(second.request_id) // high-cardinality by design
    expect(Number.isNaN(Date.parse(first.timestamp))).toBe(false)
    expect(first.body_bytes).toBeGreaterThan(0)
    expect(first.duration_ms).toBeGreaterThanOrEqual(0)
    expect(first.items).toEqual([expect.objectContaining({ tool: 'verify', is_error: false, error_code: null, cache_eligible: true, cache_hit: false })])
    expect(second.items).toEqual([expect.objectContaining({ tool: 'verify', is_error: false, cache_eligible: true, cache_hit: true })])
  })

  test('events carry sizes and codes, never the diagram payload', async () => {
    const { events, onEvent } = capture()
    const { handler } = makeHandler({ onEvent })
    await handler(post(call('verify', { source: FLOW })))
    expect(JSON.stringify(events)).not.toContain('flowchart')
  })

  test('execute events carry only the configured CPU limit and loader-attempt proxy', async () => {
    const { events, onEvent } = capture()
    const { handler } = makeHandler({ onEvent })
    const code = '/* private agent code */ 20 + 22'
    await handler(post(call('execute', { code, timeoutMs: 1234 })))
    expect(events).toHaveLength(1)
    expect(events[0]!.items).toEqual([expect.objectContaining({
      tool: 'execute', cache_eligible: false, cache_hit: false, loader_attempts: 1, configured_cpu_limit_ms: 1234,
    })])
    expect(JSON.stringify(events)).not.toContain(code)
  })

  test('the handler preserves a statement-fallback loader-attempt count', async () => {
    const { events, onEvent } = capture()
    const { handler } = makeHandler({
      onEvent,
      context: {
        async execute(_code, _timeoutMs, onTelemetry) {
          onTelemetry?.({ loaderAttempts: 2 })
          return { ok: true, value: 'ran', logs: [] }
        },
      },
    })
    await handler(post(call('execute', { code: 'const x = 42; return x', timeoutMs: 1234 })))
    expect(events[0]!.items).toEqual([expect.objectContaining({
      tool: 'execute', loader_attempts: 2, configured_cpu_limit_ms: 1234,
    })])
  })

  test('pre-screened execute errors do not claim a loader attempt or CPU allocation', async () => {
    const { events, onEvent } = capture()
    const { handler } = makeHandler({ onEvent })
    await handler(post(call('execute', { code: 'await fetch("https://example.test")', timeoutMs: 1234 })))
    expect(events[0]!.items).toEqual([expect.objectContaining({
      tool: 'execute', is_error: true, loader_attempts: 0, configured_cpu_limit_ms: null,
    })])
  })

  test('an unknown tool is a tool_error carrying the JSON-RPC error code', async () => {
    const { events, onEvent } = capture()
    const { handler } = makeHandler({ onEvent })
    await handler(post(call('render_gif', { source: FLOW })))
    expect(events).toHaveLength(1)
    expect(events[0]!.outcome).toBe('tool_error')
    expect(events[0]!.items).toEqual([expect.objectContaining({ tool: 'render_gif', is_error: true, error_code: -32602 })])
  })

  test('a structured tool error surfaces its code, not its message', async () => {
    const { events, onEvent } = capture()
    const { handler } = makeHandler({ onEvent })
    await handler(post(call('verify', { source: 'flowchart TD\n' + 'x'.repeat(64 * 1024) })))
    expect(events[0]!.outcome).toBe('tool_error')
    expect(events[0]!.http_status).toBe(200) // tool errors are in-band, not HTTP failures
    expect(events[0]!.items[0]).toEqual(expect.objectContaining({ tool: 'verify', is_error: true, error_code: 'SOURCE_TOO_LARGE' }))
  })

  test('an oversized body is a transport_error with http_status 413 and no items', async () => {
    const { events, onEvent } = capture()
    const { handler } = makeHandler({ onEvent })
    await handler(post(JSON.stringify(call('describe', { source: 'x'.repeat(MAX_MCP_BODY_BYTES) }))))
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual(expect.objectContaining({ outcome: 'transport_error', http_status: 413, items: [] }))
    expect(events[0]!.body_bytes).toBeGreaterThanOrEqual(MAX_MCP_BODY_BYTES)
  })

  test('a batch emits ONE event with an item entry per JSON-RPC item', async () => {
    const { events, onEvent } = capture()
    const { handler } = makeHandler({ onEvent })
    await handler(post([rpc('ping', undefined, 'a'), call('render_gif', {}, 'b'), call('describe', { source: FLOW }, 'c')]))
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual(expect.objectContaining({ method: 'batch', batch_size: 3, outcome: 'tool_error' }))
    expect(events[0]!.items.map(i => ({ tool: i.tool, is_error: i.is_error }))).toEqual([
      { tool: null, is_error: false },
      { tool: 'render_gif', is_error: true },
      { tool: 'describe', is_error: false },
    ])
  })

  test('an escaping exception still emits the event, then answers a clean 500', async () => {
    const { events, onEvent } = capture()
    const { handler } = makeHandler({
      cache: makeCache(),
      onEvent,
      waitUntil: () => { throw new Error('waitUntil rejected') },
    })
    const res = await handler(post(call('describe', { source: FLOW })))
    expect(res.status).toBe(500)
    expect(((await res.json()) as any).error.code).toBe(-32603)
    expect(events).toHaveLength(1)
    expect(events[0]!.outcome).toBe('exception')
    expect(events[0]!.http_status).toBe(500)
    expect(events[0]!.error).toEqual({ type: 'Error', code: 'INTERNAL_ERROR' })
    expect(JSON.stringify(events[0])).not.toContain('waitUntil rejected')
  })

  test('OPTIONS and other pre-dispatch requests emit transport-level events', async () => {
    const { events, onEvent } = capture()
    const { handler } = makeHandler({ onEvent })
    await handler(new Request('https://agentic-mermaid.dev/mcp', { method: 'OPTIONS' }))
    await handler(new Request('https://agentic-mermaid.dev/mcp')) // GET → 405
    expect(events.map(e => ({ status: e.http_status, outcome: e.outcome, items: e.items.length }))).toEqual([
      { status: 204, outcome: 'success', items: 0 },
      { status: 405, outcome: 'transport_error', items: 0 },
    ])
  })
})
