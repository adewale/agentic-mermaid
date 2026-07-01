// Streamable HTTP transport for the hosted MCP endpoint
// (website/src/mcp-handler.ts), driven with real Request/Response objects.
// The only fakes are the seams that need workerd: the Cache API (Map-backed,
// same match/put contract) and the execute sandbox (call-recording).

import { describe, expect, test } from 'bun:test'
import { createMcpHandler, MAX_MCP_BODY_BYTES, type McpCache } from '../../website/src/mcp-handler.ts'
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
