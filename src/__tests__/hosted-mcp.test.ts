// Hosted MCP server core (src/mcp/hosted-server.ts): the tool surface the
// website Worker serves at /mcp. Pure tools run for real; the execute /
// renderPng seams — a Dynamic Worker isolate and resvg-wasm in production —
// are purpose-built fakes that record their calls.

import { describe, expect, test } from 'bun:test'
import {
  handleHostedRequest, HOSTED_TOOLS, MAX_CODE_BYTES, MAX_SOURCE_BYTES,
  SUPPORTED_PROTOCOL_VERSIONS, type HostedMcpContext, type ExecuteResult,
} from '../mcp/hosted-server.ts'
import type { JsonRpcRequest } from '../mcp/protocol.ts'
import pkg from '../../package.json'

const FLOW = 'flowchart TD\n  A[Start] --> B{OK?}\n  B -->|yes| C[Done]'

function makeContext(overrides: Partial<HostedMcpContext> = {}): HostedMcpContext & { executeCalls: Array<{ code: string; timeoutMs: number }>; pngCalls: Array<{ source: string; scale?: number; background?: string }> } {
  const executeCalls: Array<{ code: string; timeoutMs: number }> = []
  const pngCalls: Array<{ source: string; scale?: number; background?: string }> = []
  return {
    executeCalls,
    pngCalls,
    async execute(code, timeoutMs): Promise<ExecuteResult> {
      executeCalls.push({ code, timeoutMs })
      return { ok: true, value: 42, logs: [] }
    },
    async renderPng(source, opts) {
      pngCalls.push({ source, ...opts })
      return new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    },
    ...overrides,
  }
}

function rpc(method: string, params?: unknown, id: number | string = 1): JsonRpcRequest {
  return { jsonrpc: '2.0', id, method, params }
}

function call(name: string, args: Record<string, unknown>): JsonRpcRequest {
  return rpc('tools/call', { name, arguments: args })
}

function payloadOf(res: Awaited<ReturnType<typeof handleHostedRequest>>): any {
  const result = res?.result as { content: Array<{ text: string }>; isError: boolean }
  return { ...JSON.parse(result.content[0]!.text), isError: result.isError }
}

describe('hosted MCP handshake', () => {
  test('initialize echoes a supported offered protocol version', async () => {
    for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
      const res = await handleHostedRequest(rpc('initialize', { protocolVersion: version }), makeContext())
      expect((res?.result as any).protocolVersion).toBe(version)
    }
  })

  test('initialize falls back to the default for unknown or missing versions', async () => {
    for (const params of [{ protocolVersion: '1999-01-01' }, {}, undefined]) {
      const res = await handleHostedRequest(rpc('initialize', params), makeContext())
      expect((res?.result as any).protocolVersion).toBe('2025-03-26')
    }
  })

  test('initialize reports the package version and hosted instructions', async () => {
    const res = await handleHostedRequest(rpc('initialize'), makeContext())
    const result = res?.result as any
    expect(result.serverInfo).toEqual({ name: 'agentic-mermaid-mcp', version: pkg.version })
    expect(result.instructions).toContain('stateless')
    expect(result.instructions).toContain('render_svg')
  })

  test('tools/list exposes exactly the hosted six-tool surface', async () => {
    const res = await handleHostedRequest(rpc('tools/list'), makeContext())
    const names = (res?.result as any).tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(['execute', 'render_svg', 'render_ascii', 'render_png', 'verify', 'describe'])
    expect((res?.result as any).tools).toBe(HOSTED_TOOLS)
  })

  test('unknown methods and unknown tools are JSON-RPC errors', async () => {
    const method = await handleHostedRequest(rpc('resources/read'), makeContext())
    expect(method?.error?.code).toBe(-32601)
    const tool = await handleHostedRequest(call('render_gif', { source: FLOW }), makeContext())
    expect(tool?.error?.code).toBe(-32602)
  })

  test('notifications return null; ping pongs', async () => {
    expect(await handleHostedRequest(rpc('notifications/initialized'), makeContext())).toBeNull()
    expect((await handleHostedRequest(rpc('ping'), makeContext()))?.result).toEqual({})
  })
})

describe('hosted pure tools', () => {
  test('render_svg renders deterministic themeable SVG', async () => {
    const first = payloadOf(await handleHostedRequest(call('render_svg', { source: FLOW }), makeContext()))
    expect(first.ok).toBe(true)
    expect(first.isError).toBe(false)
    expect(first.svg).toStartWith('<svg')
    expect(first.svg).toContain('Start')
    const second = payloadOf(await handleHostedRequest(call('render_svg', { source: FLOW }), makeContext()))
    expect(second.svg).toBe(first.svg)
    const dark = payloadOf(await handleHostedRequest(call('render_svg', { source: FLOW, bg: '#101014', fg: '#e6e6f0' }), makeContext()))
    expect(dark.svg).toContain('#101014')
    expect(dark.svg).not.toBe(first.svg)
  })

  test('render_svg rejects unknown themes with the theme list', async () => {
    const p = payloadOf(await handleHostedRequest(call('render_svg', { source: FLOW, theme: 'no-such-theme' }), makeContext()))
    expect(p.ok).toBe(false)
    expect(p.isError).toBe(true)
    expect(p.error.code).toBe('SVG_RENDER_FAILED')
    expect(p.error.message).toContain('unknown theme')
  })

  test('render_ascii switches between Unicode and ASCII charsets', async () => {
    const unicode = payloadOf(await handleHostedRequest(call('render_ascii', { source: 'flowchart LR\n  A --> B' }), makeContext()))
    expect(unicode.ok).toBe(true)
    expect(unicode.text).toContain('┌')
    const ascii = payloadOf(await handleHostedRequest(call('render_ascii', { source: 'flowchart LR\n  A --> B', useAscii: true }), makeContext()))
    expect(ascii.text).not.toContain('┌')
    expect(ascii.text).toContain('+')
  })

  test('verify returns warnings and a layout summary for valid sources', async () => {
    const p = payloadOf(await handleHostedRequest(call('verify', { source: FLOW }), makeContext()))
    expect(p.ok).toBe(true)
    expect(Array.isArray(p.warnings)).toBe(true)
    expect(p.layout.nodes).toBe(3)
    expect(p.layout.edges).toBe(2)
    expect(p.layout.bounds.w).toBeGreaterThan(0)
  })

  test('verify surfaces parse errors as structured payloads, not crashes', async () => {
    const p = payloadOf(await handleHostedRequest(call('verify', { source: 'flowchart XX\n  A --> B' }), makeContext()))
    expect(p.ok).toBe(false)
    expect(p.isError).toBe(true)
    expect(p.errors.length).toBeGreaterThan(0)
    expect(typeof p.errors[0].message).toBe('string')
  })

  test('describe summarizes a diagram', async () => {
    const p = payloadOf(await handleHostedRequest(call('describe', { source: FLOW }), makeContext()))
    expect(p.ok).toBe(true)
    expect(p.text).toContain('flowchart')
  })

  test('pure tools reject missing source and cap oversized source', async () => {
    for (const name of ['render_svg', 'render_ascii', 'verify', 'describe']) {
      const missing = await handleHostedRequest(call(name, {}), makeContext())
      expect(missing?.error?.code).toBe(-32602)
      const big = payloadOf(await handleHostedRequest(call(name, { source: 'flowchart TD\n' + 'x'.repeat(MAX_SOURCE_BYTES) }), makeContext()))
      expect(big.ok).toBe(false)
      expect(big.error.code).toBe('SOURCE_TOO_LARGE')
      expect(big.error.message).toContain('agenticmermaid.dev/docs/mcp')
    }
  })
})

describe('hosted execute', () => {
  test('delegates to the injected sandbox with the default 5s budget', async () => {
    const ctx = makeContext()
    const p = payloadOf(await handleHostedRequest(call('execute', { code: '1 + 1' }), ctx))
    expect(p).toEqual({ ok: true, value: 42, logs: [], isError: false })
    expect(ctx.executeCalls).toEqual([{ code: '1 + 1', timeoutMs: 5000 }])
  })

  test('clamps the requested timeout into [1, 30000]', async () => {
    const ctx = makeContext()
    await handleHostedRequest(call('execute', { code: '1', timeoutMs: 90_000 }), ctx)
    await handleHostedRequest(call('execute', { code: '1', timeoutMs: 0 }), ctx)
    await handleHostedRequest(call('execute', { code: '1', timeoutMs: 250 }), ctx)
    expect(ctx.executeCalls.map(c => c.timeoutMs)).toEqual([30_000, 1, 250])
  })

  test('screens sync-only violations before any isolate is involved', async () => {
    const ctx = makeContext()
    const p = payloadOf(await handleHostedRequest(call('execute', { code: 'await fetch("https://x")' }), ctx))
    expect(p.ok).toBe(false)
    expect(p.error).toContain('Code Mode is synchronous')
    expect(ctx.executeCalls).toHaveLength(0)
  })

  test('rejects non-string code and oversized code without calling the sandbox', async () => {
    const ctx = makeContext()
    const missing = await handleHostedRequest(call('execute', {}), ctx)
    expect(missing?.error?.code).toBe(-32602)
    const big = payloadOf(await handleHostedRequest(call('execute', { code: '1 + ' + '1'.repeat(MAX_CODE_BYTES) }), ctx))
    expect(big.ok).toBe(false)
    expect(big.error).toContain('CODE_TOO_LARGE')
    expect(ctx.executeCalls).toHaveLength(0)
  })

  test('sandbox failures degrade to a structured error, not a thrown 500', async () => {
    const ctx = makeContext({ execute: async () => { throw new Error('loader unavailable') } })
    const p = payloadOf(await handleHostedRequest(call('execute', { code: '1 + 1' }), ctx))
    expect(p.ok).toBe(false)
    expect(p.isError).toBe(true)
    expect(p.error).toContain('loader unavailable')
  })
})

describe('hosted render_png', () => {
  test('returns base64 PNG bytes from the injected rasterizer', async () => {
    const ctx = makeContext()
    const p = payloadOf(await handleHostedRequest(call('render_png', { source: FLOW, scale: 3, background: '#fff' }), ctx))
    expect(p.ok).toBe(true)
    expect(atob(p.png_base64)).toBe('\x89PNG')
    expect(ctx.pngCalls).toEqual([{ source: FLOW, scale: 3, background: '#fff' }])
  })

  test('file/url artifact modes are a local-server feature', async () => {
    const res = await handleHostedRequest(call('render_png', { source: FLOW, output: 'file' }), makeContext())
    expect(res?.error?.code).toBe(-32602)
    expect(res?.error?.message).toContain('base64 only')
  })

  test('reports unavailability when no rasterizer is wired', async () => {
    const ctx = makeContext()
    ctx.renderPng = undefined
    const p = payloadOf(await handleHostedRequest(call('render_png', { source: FLOW }), ctx))
    expect(p.ok).toBe(false)
    expect(p.error.code).toBe('PNG_UNAVAILABLE')
  })

  test('rasterizer failures surface as PNG_RENDER_FAILED', async () => {
    const ctx = makeContext({ renderPng: async () => { throw new Error('wasm init failed') } })
    const p = payloadOf(await handleHostedRequest(call('render_png', { source: FLOW }), ctx))
    expect(p.ok).toBe(false)
    expect(p.error.code).toBe('PNG_RENDER_FAILED')
    expect(p.error.message).toContain('wasm init failed')
  })
})
