// Streamable HTTP transport for the hosted MCP endpoint
// (website/src/mcp-handler.ts), driven with real Request/Response objects.
// The only fakes are the seams that need workerd: the Cache API (Map-backed,
// same match/put contract) and the execute sandbox (call-recording).

import { describe, expect, test } from 'bun:test'
import { createMcpHandler, MAX_MCP_BODY_BYTES, MAX_BATCH_ITEMS, type McpCache } from '../../website/src/mcp-handler.ts'
import type { HostedMcpContext } from '../mcp/hosted-server.ts'

const FLOW = 'flowchart LR\n  A --> B'

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

function makeHandler(overrides: { cache?: McpCache; context?: Partial<HostedMcpContext>; waitUntil?: (p: Promise<unknown>) => void } = {}) {
  const executeCalls: string[] = []
  const context: HostedMcpContext = {
    async execute(code) {
      executeCalls.push(code)
      return { ok: true, value: 'ran', logs: [] }
    },
    ...overrides.context,
  }
  const handler = createMcpHandler({ context, cache: overrides.cache, cacheVersion: 'test-1', waitUntil: overrides.waitUntil })
  return { handler, executeCalls }
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return new Request('https://agenticmermaid.dev/mcp', {
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
    const res = await handler(new Request('https://agenticmermaid.dev/mcp', { method: 'OPTIONS' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
  })

  test('GET is 405: stateless server, no server-initiated stream', async () => {
    const { handler } = makeHandler()
    const res = await handler(new Request('https://agenticmermaid.dev/mcp'))
    expect(res.status).toBe(405)
    expect(((await res.json()) as any).error.message).toContain('stateless')
  })

  test('non-JSON content types are 415', async () => {
    const { handler } = makeHandler()
    const res = await handler(post('x', { 'content-type': 'text/plain' }))
    expect(res.status).toBe(415)
  })

  test('bodies over the cap are 413, declared or not', async () => {
    const { handler } = makeHandler()
    const big = JSON.stringify(call('describe', { source: 'x'.repeat(MAX_MCP_BODY_BYTES) }))
    const declared = await handler(post(big))
    expect(declared.status).toBe(413)
    const undeclared = await handler(new Request('https://agenticmermaid.dev/mcp', {
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
    expect(((await res.json()) as any).error.code).toBe(-32600)
  })

  test('HTTP-level error responses still carry CORS so a browser client can read them', async () => {
    // 405/415/413/400 all flow through the same json() helper; a browser fetch
    // needs the CORS header on the error too or it never sees the status.
    const { handler } = makeHandler()
    const errorResponses = [
      await handler(new Request('https://agenticmermaid.dev/mcp')), // 405
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

  test('notifications get an empty 202', async () => {
    const { handler } = makeHandler()
    const res = await handler(post({ jsonrpc: '2.0', method: 'notifications/initialized' }))
    expect(res.status).toBe(202)
    expect(await res.text()).toBe('')
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
    const res = await handler(post(rpc('ping'), { origin: 'https://agenticmermaid.dev' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://agenticmermaid.dev')
    expect(res.headers.get('vary')).toContain('Origin')
  })

  test('a disallowed cross-origin browser request is 403 with no ACAO, before any tool runs', async () => {
    const { handler, executeCalls } = makeHandler()
    const res = await handler(post(call('execute', { code: '1' }), { origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(executeCalls).toHaveLength(0)
  })

  test('a disallowed Origin is refused on the OPTIONS preflight too (no ACAO granted)', async () => {
    const { handler } = makeHandler()
    const res = await handler(new Request('https://agenticmermaid.dev/mcp', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }))
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
  test('identical tools/call requests hit the cache; ids are re-stamped', async () => {
    const cache = makeCache()
    const { handler, executeCalls } = makeHandler({ cache })
    const first = (await (await handler(post(call('execute', { code: '1 + 1' }, 'first')))).json()) as any
    const second = (await (await handler(post(call('execute', { code: '1 + 1' }, 'second')))).json()) as any
    expect(executeCalls).toHaveLength(1)
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

describe('cache-key normalization (cost control)', () => {
  test('unknown arguments cannot bust the cache', async () => {
    const cache = makeCache()
    const { handler, executeCalls } = makeHandler({ cache })
    await handler(post(call('execute', { code: '1 + 1', nonce: 'a' })))
    await handler(post(call('execute', { code: '1 + 1', nonce: 'b' })))
    await handler(post(call('execute', { code: '1 + 1' })))
    expect(executeCalls).toHaveLength(1)
    expect(cache.store.size).toBe(1)
  })

  test('a differing timeoutMs does not split the execute cache', async () => {
    const cache = makeCache()
    const { handler, executeCalls } = makeHandler({ cache })
    await handler(post(call('execute', { code: '1 + 1', timeoutMs: 1000 })))
    await handler(post(call('execute', { code: '1 + 1', timeoutMs: 30000 })))
    expect(executeCalls).toHaveLength(1)
  })

  test('out-of-range scale values that clamp to the same effective scale share one entry', async () => {
    const cache = makeCache()
    const pngCalls: number[] = []
    const { handler } = makeHandler({
      cache,
      context: { renderPng: async (_s, opts) => { pngCalls.push(opts.scale ?? -1); return new Uint8Array([1]) } },
    })
    await handler(post(call('render_png', { source: FLOW, scale: 100 })))
    await handler(post(call('render_png', { source: FLOW, scale: 999 })))
    expect(pngCalls).toEqual([8]) // both clamp to 8; second is a cache hit
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
