// Hosted MCP server core (src/mcp/hosted-server.ts): the tool surface the
// website Worker serves at /mcp. Pure tools run for real; the execute /
// renderPng seams — a Dynamic Worker isolate and resvg-wasm in production —
// are purpose-built fakes that record their calls.

import { describe, expect, test } from 'bun:test'
import {
  handleHostedRequest, HOSTED_MCP_SERVER_NAME, HOSTED_TOOLS, MAX_CODE_BYTES, MAX_SOURCE_BYTES,
  SUPPORTED_PROTOCOL_VERSIONS, cacheKeyFor, type HostedMcpContext, type ExecuteResult,
} from '../mcp/hosted-server.ts'
import { MCP_SERVER_NAME } from '../mcp/tool-surface.ts'
import type { JsonRpcRequest } from '../mcp/protocol.ts'
import pkg from '../../package.json'
import { visualWidth } from '../ascii/width.ts'
import { knownStyleDescriptors } from '../scene/style-registry.ts'
import { verifyNoExternalRefs } from '../index.ts'
import { MAX_HOSTED_PNG_BYTES, PNG_WASM_RUNTIME } from '../png-contract.ts'
import { THEMES } from '../theme.ts'

const FLOW = 'flowchart TD\n  A[Start] --> B{OK?}\n  B -->|yes| C[Done]'
const TEST_PNG_RECEIPT = { version: 1, output: 'png', sharedRequestDigest: 'test-shared', requestDigest: 'test-request', appearanceDigest: 'test-appearance' } as const

function makeContext(overrides: Partial<HostedMcpContext> = {}): HostedMcpContext & { executeCalls: Array<{ code: string; timeoutMs: number }>; pngCalls: Array<{ source: string; scale?: number; background?: string; security?: 'default' | 'strict'; embedFontImport?: boolean }> } {
  const executeCalls: Array<{ code: string; timeoutMs: number }> = []
  const pngCalls: Array<{ source: string; scale?: number; background?: string; security?: 'default' | 'strict'; embedFontImport?: boolean }> = []
  return {
    executeCalls,
    pngCalls,
    async execute(code, timeoutMs): Promise<ExecuteResult> {
      executeCalls.push({ code, timeoutMs })
      return { ok: true, value: 42, logs: [] }
    },
    async renderPng(source, opts) {
      pngCalls.push({ source, ...opts })
      return { png: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), warnings: [], receipt: TEST_PNG_RECEIPT, runtime: PNG_WASM_RUNTIME }
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
    expect(result.serverInfo).toEqual({ name: 'agentic-mermaid-hosted', version: pkg.version })
    expect(result.instructions).toContain('stateless')
    expect(result.instructions).toContain('render_svg')
  })

  test('the hosted identity is distinct from the local stdio server', () => {
    // Registries and clients cache tool lists by server identity; the hosted
    // surface (9 tools) must never shadow the local server's (4 tools).
    expect(HOSTED_MCP_SERVER_NAME).not.toBe(MCP_SERVER_NAME)
  })

  test('tools/list exposes exactly the hosted tool surface', async () => {
    const res = await handleHostedRequest(rpc('tools/list'), makeContext())
    const names = (res?.result as any).tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(['execute', 'describe_sdk', 'render_svg', 'render_ascii', 'render_png', 'verify', 'describe', 'mutate', 'build'])
    expect((res?.result as any).tools).toBe(HOSTED_TOOLS)
    const execute = (res?.result as any).tools.find((tool: { name: string }) => tool.name === 'execute')
    for (const signature of ['renderMermaidSVGWithReceipt(', 'renderMermaidASCIIWithReceipt(', 'layoutMermaidWithReceipt(']) {
      expect(execute.description).toContain(signature)
    }
    for (const tool of (res?.result as any).tools) {
      expect(tool.annotations).toEqual(expect.objectContaining({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      }))
    }
    expect((res?.result as any).tools.find((tool: any) => tool.name === 'execute').annotations.idempotentHint).toBe(false)
    for (const name of ['describe_sdk', 'render_svg', 'render_ascii', 'render_png', 'verify', 'describe', 'mutate', 'build']) {
      expect((res?.result as any).tools.find((tool: any) => tool.name === name).annotations.idempotentHint).toBe(true)
    }
  })

  test('render_svg discovery lists every registered built-in look', () => {
    const renderSvg = HOSTED_TOOLS.find(tool => tool.name === 'render_svg')!
    const styleDescription = (renderSvg.inputSchema.properties as Record<string, { description?: string }>).style?.description ?? ''
    const looks = knownStyleDescriptors()
      .filter(descriptor => descriptor.kind === 'look')
      .map(descriptor => descriptor.inputName)
    for (const look of looks) expect(styleDescription).toContain(look)
    expect(styleDescription.toLowerCase()).not.toContain('cupertino')
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
  test('dispatch rejects malformed convenience and advanced arguments as -32602', async () => {
    const context = makeContext()
    const malformed: JsonRpcRequest[] = [
      rpc('tools/call', { name: 'render_svg', arguments: [] }),
      call('render_svg', { source: FLOW, bg: 123 }),
      call('render_svg', { source: FLOW, seed: 'bad' }),
      call('render_svg', { source: FLOW, options: { padding: 'wide' } }),
      call('render_svg', { source: FLOW, style: 'not-a-registered-style' }),
      call('render_svg', { source: FLOW, bg: 'url(https://invalid.example)' }),
      call('render_ascii', { source: FLOW, useAscii: 'yes' }),
      call('render_ascii', { source: FLOW, targetWidth: 3.5 }),
      call('render_ascii', { source: FLOW, targetWidth: 0 }),
      call('render_png', { source: FLOW, scale: 'large' }),
      call('render_png', { source: FLOW, background: 123 }),
      call('render_png', { source: FLOW, seed: 'bad' }),
      call('describe', { source: FLOW, format: 'yaml' }),
      call('verify', { source: 42 }),
      call('execute', { code: '1 + 1', timeoutMs: 'fast' }),
      call('render_svg', { source: FLOW, unexpected: true }),
    ]
    for (const request of malformed) {
      const response = await handleHostedRequest(request, context)
      expect(response?.error?.code).toBe(-32602)
      expect(response?.error?.message).toContain('Invalid')
    }
    expect(context.executeCalls).toEqual([])
    expect(context.pngCalls).toEqual([])
  })

  test('dispatch rejects a below-64KB deeply nested advanced config without throwing', async () => {
    let config: unknown = true
    for (let index = 0; index < 8_000; index++) config = { a: config }
    const args = { source: FLOW, options: { mermaidConfig: config } }
    expect(JSON.stringify(args).length).toBeLessThan(64 * 1024)
    const context = makeContext()
    const response = await handleHostedRequest(call('render_svg', args), context)
    expect(response?.error?.code).toBe(-32602)
    expect(response?.error?.message).toContain('exceeds maximum nesting depth 64')
    expect(context.executeCalls).toEqual([])
    expect(context.pngCalls).toEqual([])
  })

  test('render_svg renders deterministic themeable SVG', async () => {
    const first = payloadOf(await handleHostedRequest(call('render_svg', { source: FLOW }), makeContext()))
    expect(first.ok).toBe(true)
    expect(first.isError).toBe(false)
    expect(first.svg).toStartWith('<svg')
    expect(first.svg).toContain('Start')
    expect(verifyNoExternalRefs(first.svg)).toEqual({ ok: true, refs: [] })
    const second = payloadOf(await handleHostedRequest(call('render_svg', { source: FLOW }), makeContext()))
    expect(second.svg).toBe(first.svg)
    const dark = payloadOf(await handleHostedRequest(call('render_svg', { source: FLOW, bg: '#101014', fg: '#e6e6f0' }), makeContext()))
    expect(dark.svg).toContain('#101014')
    expect(dark.svg).not.toBe(first.svg)
    const weaker = payloadOf(await handleHostedRequest(call('render_svg', {
      source: FLOW,
      options: { security: 'default', embedFontImport: true },
    }), makeContext()))
    expect(weaker.svg).toBe(first.svg)
    expect(verifyNoExternalRefs(weaker.svg)).toEqual({ ok: true, refs: [] })
    expect(weaker.svg).not.toContain('@import')
  })

  test('render_svg applies canonical options before top-level compatibility conveniences', async () => {
    const direct = payloadOf(await handleHostedRequest(call('render_svg', {
      source: FLOW,
      bg: '#101014',
      seed: 7,
    }), makeContext()))
    const overlaid = payloadOf(await handleHostedRequest(call('render_svg', {
      source: FLOW,
      options: { bg: '#ffffff', seed: 1 },
      bg: '#101014',
      seed: 7,
    }), makeContext()))
    expect(overlaid.svg).toBe(direct.svg)
    expect(overlaid.receipt).toEqual(direct.receipt)
  })

  test('retains theme as a diagnosed legacy compatibility input', async () => {
    const tool = HOSTED_TOOLS.find(candidate => candidate.name === 'render_svg')!
    const themeSchema = (tool.inputSchema.properties as Record<string, any>).theme
    expect(themeSchema.deprecated).toBe(true)
    expect(themeSchema['x-agentic-mermaid-diagnostic']).toMatchObject({
      code: 'THEME_INPUT_DEPRECATED',
      removal: { release: '0.3.0', date: '2027-01-31' },
    })
    const payload = payloadOf(await handleHostedRequest(call('render_svg', { source: FLOW, theme: 'paper' }), makeContext()))
    expect(payload.ok).toBe(true)
    expect(payload.warnings).toContainEqual(expect.objectContaining({ code: 'THEME_INPUT_DEPRECATED' }))
  })

  test('render_svg rejects raw theme CSS instead of rewriting active content', async () => {
    const injected = '@import url(https://evil.example/font.css);</style><svg id="hosted-xss" onload="globalThis.pwned=1"></svg><style>'
    const source = `%%{init: ${JSON.stringify({ themeCSS: injected })}}%%\nxychart-beta\n  x-axis [A, B]\n  y-axis 0 --> 10\n  bar [1, 2]`
    const payload = payloadOf(await handleHostedRequest(call('render_svg', { source }), makeContext()))
    expect(payload.ok).toBe(false)
    expect(payload.isError).toBe(true)
    expect(payload.error.code).toBe('SVG_RENDER_FAILED')
    expect(payload.error.message).toContain('Raw Mermaid themeCSS is not allowed')
    expect(payload).not.toHaveProperty('svg')
  })

  test('render tools expose source config diagnostics instead of dropping them', async () => {
    const source = '---\nconfig:\n  state:\n    titleTopMargin: 10\n---\nstateDiagram-v2\n  A --> B'
    for (const name of ['render_svg', 'render_ascii']) {
      const payload = payloadOf(await handleHostedRequest(call(name, { source }), makeContext()))
      expect(payload.ok).toBe(true)
      expect(payload.warnings).toContainEqual(expect.objectContaining({
        code: 'INEFFECTIVE_CONFIG', field: 'state.titleTopMargin',
      }))
    }
  })

  test('render_svg rejects unknown themes at the advertised schema boundary', async () => {
    const response = await handleHostedRequest(call('render_svg', { source: FLOW, theme: 'no-such-theme' }), makeContext())
    expect(response?.error?.code).toBe(-32602)
    expect(response?.error?.message).toContain('arguments.theme')
  })

  test('render_ascii switches between Unicode and ASCII charsets', async () => {
    const unicode = payloadOf(await handleHostedRequest(call('render_ascii', { source: 'flowchart LR\n  A --> B' }), makeContext()))
    expect(unicode.ok).toBe(true)
    expect(unicode.text).toContain('┌')
    const ascii = payloadOf(await handleHostedRequest(call('render_ascii', { source: 'flowchart LR\n  A --> B', useAscii: true }), makeContext()))
    expect(ascii.text).not.toContain('┌')
    expect(ascii.text).toContain('+')
  })

  test('render_ascii keeps security and font-import policy host-owned', async () => {
    const source = 'flowchart LR\n  A --> B'
    const baseline = payloadOf(await handleHostedRequest(call('render_ascii', { source }), makeContext()))
    const weaker = payloadOf(await handleHostedRequest(call('render_ascii', {
      source,
      options: { security: 'default', embedFontImport: true },
    }), makeContext()))
    expect(weaker.text).toBe(baseline.text)
    expect(weaker.receipt).toEqual(baseline.receipt)
    expect(cacheKeyFor('render_ascii', { source, options: { security: 'default', embedFontImport: true } }))
      .toEqual(cacheKeyFor('render_ascii', { source }))
  })

  test('render_ascii exposes targetWidth and typed impossible-width errors', async () => {
    const bounded = payloadOf(await handleHostedRequest(call('render_ascii', {
      source: 'flowchart TD\n  A["日本語 descriptive terminal label"] --> B[Done]',
      targetWidth: 28,
    }), makeContext()))
    expect(bounded.ok).toBe(true)
    expect(Math.max(...bounded.text.split('\n').map(visualWidth))).toBeLessThanOrEqual(28)

    const impossible = payloadOf(await handleHostedRequest(call('render_ascii', {
      source: 'flowchart TD\n  A[🙂]',
      targetWidth: 1,
    }), makeContext()))
    expect(impossible.ok).toBe(false)
    expect(impossible.error).toMatchObject({
      code: 'ASCII_TARGET_WIDTH_IMPOSSIBLE',
      requestedWidth: 1,
      family: 'flowchart',
      reason: 'UNBREAKABLE_GRAPHEME',
    })
  })

  test('verify returns warnings and a layout summary for valid sources', async () => {
    const p = payloadOf(await handleHostedRequest(call('verify', { source: FLOW }), makeContext()))
    expect(p.ok).toBe(true)
    expect(Array.isArray(p.warnings)).toBe(true)
    expect(p.layout.nodes).toBe(3)
    expect(p.layout.edges).toBe(2)
    expect(p.layout.bounds.w).toBeGreaterThan(0)
    // The result echoes the detected family + a summary so ok:true is never a
    // silent pass on the wrong diagram type.
    expect(p.family).toBe('flowchart')
    expect(typeof p.summary).toBe('string')
    expect(p.summary.length).toBeGreaterThan(0)
  })

  test('verify echoes the detected family so a wrong-type diagram is self-evident', async () => {
    // Asked (elsewhere) for an architecture diagram but authored a flowchart:
    // verify still passes structurally, but the echoed family reveals the mismatch.
    const p = payloadOf(await handleHostedRequest(call('verify', { source: 'graph TD\n  API --> DB' }), makeContext()))
    expect(p.ok).toBe(true)
    expect(p.family).toBe('flowchart')
    expect(p.summary.toLowerCase()).toContain('flowchart')
  })

  test('verify surfaces parse errors as structured payloads, not crashes', async () => {
    const p = payloadOf(await handleHostedRequest(call('verify', { source: 'flowchart XX\n  A --> B' }), makeContext()))
    expect(p.ok).toBe(false)
    expect(p.isError).toBe(true)
    expect(p.errors.length).toBeGreaterThan(0)
    expect(typeof p.errors[0].message).toBe('string')
    // Self-describing: the header names a known family, so the failure response
    // carries that family's canonical example to author from.
    expect(p.family).toBe('flowchart')
    expect(p.example).toContain('flowchart')
  })

  test('describe summarizes a diagram and can return json or facts', async () => {
    const text = payloadOf(await handleHostedRequest(call('describe', { source: FLOW }), makeContext()))
    expect(text.ok).toBe(true)
    expect(text.text).toContain('flowchart')
    const tree = payloadOf(await handleHostedRequest(call('describe', { source: FLOW, format: 'json' }), makeContext()))
    expect(tree.ok).toBe(true)
    expect(tree.tree.kind).toBe('flowchart')
    const facts = payloadOf(await handleHostedRequest(call('describe', { source: FLOW, format: 'facts' }), makeContext()))
    expect(facts.ok).toBe(true)
    expect(facts.facts).toContain('edge A -> B')
    expect(facts.facts).toContain('edge B -> C : yes')
  })

  test('pure tools reject missing source and cap oversized source', async () => {
    for (const name of ['render_svg', 'render_ascii', 'verify', 'describe']) {
      const missing = await handleHostedRequest(call(name, {}), makeContext())
      expect(missing?.error?.code).toBe(-32602)
      const big = payloadOf(await handleHostedRequest(call(name, { source: 'flowchart TD\n' + 'x'.repeat(MAX_SOURCE_BYTES) }), makeContext()))
      expect(big.ok).toBe(false)
      expect(big.error.code).toBe('SOURCE_TOO_LARGE')
      expect(big.error.message).toContain('agentic-mermaid.dev/docs/mcp')
    }
  })
})

describe('hosted declarative mutate/build tools', () => {
  test('build authors a diagram from ops and returns the canonical envelope', async () => {
    const res = await handleHostedRequest(call('build', { family: 'class', ops: [
      { kind: 'add_class', id: 'Duck' }, { kind: 'add_member', class: 'Duck', text: '+quack()' },
    ] }), makeContext())
    const p = payloadOf(res)
    expect(p.isError).toBe(false)
    expect(p.ok).toBe(true)
    expect(p.family).toBe('class')
    expect(p.source).toContain('Duck')
    expect(p.verify).toHaveProperty('ok')
  })

  test('mutate edits existing source', async () => {
    const res = await handleHostedRequest(call('mutate', { source: 'classDiagram\n  class Animal', ops: [{ kind: 'add_class', id: 'Dog' }] }), makeContext())
    const p = payloadOf(res)
    expect(p.ok).toBe(true)
    expect(p.source).toContain('class Dog')
  })

  test('Architecture junction, boundary-edge, accessibility, and in-place edge ops cross the hosted boundary', async () => {
    const built = payloadOf(await handleHostedRequest(call('build', { family: 'architecture', ops: [
      { kind: 'set_accessibility_title', title: 'Hosted topology' },
      { kind: 'add_group', id: 'app', label: 'Application' },
      { kind: 'add_service', id: 'api', label: 'API', group: 'app' },
      { kind: 'add_junction', id: 'bus' },
      { kind: 'add_edge', from: 'api', to: 'bus', fromSide: 'R', toSide: 'L', fromBoundary: 'group', label: 'events' },
    ] }), makeContext()))
    expect(built.ok).toBe(true)
    expect(built.source).toContain('accTitle: Hosted topology')
    expect(built.source).toContain('api{group}:R -[events]-> L:bus')

    const mutated = payloadOf(await handleHostedRequest(call('mutate', { source: built.source, ops: [
      { kind: 'update_edge', index: 0, fromBoundary: 'item', fromSide: 'B', toSide: 'T', label: 'queued' },
      { kind: 'set_group_label', id: 'app', label: 'App Plane' },
    ] }), makeContext()))
    expect(mutated.ok).toBe(true)
    expect(mutated.source).toContain('group app[App Plane]')
    expect(mutated.source).toContain('api:B -[queued]-> T:bus')
    expect(mutated.verify.ok).toBe(true)
  })

  test('a malformed op is a prescriptive in-band error (isError), not a mangled diagram', async () => {
    const res = await handleHostedRequest(call('build', { family: 'class', ops: [{ kind: 'add_class', name: 'Duck' }] }), makeContext())
    const p = payloadOf(res)
    expect(p.isError).toBe(true)
    expect(p.ok).toBe(false)
    expect(p.opIndex).toBe(0)
    expect(p.error.message).toContain('Valid fields: id, label, generic, members, namespace')
    expect(p.error.message).not.toContain('undefined')
  })

  test('mutate requires source+ops; build requires family+ops', async () => {
    expect((await handleHostedRequest(call('mutate', { ops: [] }), makeContext()))?.error?.code).toBe(-32602)
    expect((await handleHostedRequest(call('build', { family: 'class' }), makeContext()))?.error?.code).toBe(-32602)
  })

  test('tool descriptions defer family schemas to describe_sdk', () => {
    const execute = HOSTED_TOOLS.find(t => t.name === 'execute')!
    const mutate = HOSTED_TOOLS.find(t => t.name === 'mutate')!
    const build = HOSTED_TOOLS.find(t => t.name === 'build')!
    // The core SDK declaration carries one DiagramKind + narrower per built-in
    // family; the ceiling has headroom for the current roster (radar is the 15th).
    expect(new TextEncoder().encode(execute.description).length).toBeLessThan(11_000)
    expect(mutate.description).toContain('describe_sdk')
    expect(build.description).toContain('describe_sdk')
    expect(mutate.description).not.toContain('add_class(id, label?, generic?, members?, namespace?)')
    expect(build.description).not.toContain('add_series(kind2, name?, values)')
  })

  test('describe_sdk returns compact signatures or exact family field schemas', async () => {
    const signatures = payloadOf(await handleHostedRequest(call('describe_sdk', { family: 'xychart', detail: 'signatures' }), makeContext()))
    expect(signatures).toEqual(expect.objectContaining({ ok: true, family: 'xychart', detail: 'signatures', isError: false }))
    expect(signatures.signatures).toContain('add_series(kind2, name?, values)')

    const fields = payloadOf(await handleHostedRequest(call('describe_sdk', { family: 'gantt' }), makeContext()))
    expect(fields).toEqual(expect.objectContaining({ ok: true, family: 'gantt', detail: 'fields', isError: false }))
    expect(fields.ops.add_task).toContainEqual(expect.objectContaining({ name: 'taskId', required: false, type: 'string' }))

    const badFamily = await handleHostedRequest(call('describe_sdk', { family: 'nope' }), makeContext())
    expect(badFamily?.error?.code).toBe(-32602)
    expect(badFamily?.error?.message).toContain('family must be one of')
  })
})

describe('hosted execute', () => {
  test('delegates to the injected sandbox with the default 5s budget', async () => {
    const ctx = makeContext()
    const p = payloadOf(await handleHostedRequest(call('execute', { code: '1 + 1' }), ctx))
    expect(p).toEqual({ ok: true, value: 42, logs: [], isError: false })
    expect(ctx.executeCalls).toEqual([{ code: '1 + 1', timeoutMs: 5000 }])
  })

  test('caps positive timeouts and rejects nonpositive budgets', async () => {
    const ctx = makeContext()
    await handleHostedRequest(call('execute', { code: '1', timeoutMs: 90_000 }), ctx)
    const invalid = await handleHostedRequest(call('execute', { code: '1', timeoutMs: 0 }), ctx)
    await handleHostedRequest(call('execute', { code: '1', timeoutMs: 250 }), ctx)
    expect(ctx.executeCalls.map(c => c.timeoutMs)).toEqual([30_000, 250])
    expect(invalid?.error).toEqual(expect.objectContaining({ code: -32602 }))
  })

  test('screens sync-only violations before any isolate is involved', async () => {
    const ctx = makeContext()
    const p = payloadOf(await handleHostedRequest(call('execute', { code: 'await fetch("https://x")' }), ctx))
    expect(p.ok).toBe(false)
    expect(p.error.code).toBe('EXECUTE_FAILED')
    expect(p.error.message).toContain('Code Mode is synchronous')
    expect(ctx.executeCalls).toHaveLength(0)
  })

  test('rejects non-string code and oversized code without calling the sandbox', async () => {
    const ctx = makeContext()
    const missing = await handleHostedRequest(call('execute', {}), ctx)
    expect(missing?.error?.code).toBe(-32602)
    const big = payloadOf(await handleHostedRequest(call('execute', { code: '1 + ' + '1'.repeat(MAX_CODE_BYTES) }), ctx))
    expect(big.ok).toBe(false)
    expect(big.error.code).toBe('CODE_TOO_LARGE')
    expect(big.error.message).toContain('agentic-mermaid.dev/docs/mcp')
    expect(ctx.executeCalls).toHaveLength(0)
  })

  test('sandbox failures degrade to a structured { code, message } error, not a thrown 500', async () => {
    const ctx = makeContext({ execute: async () => { throw new Error('loader unavailable') } })
    const p = payloadOf(await handleHostedRequest(call('execute', { code: '1 + 1' }), ctx))
    expect(p.ok).toBe(false)
    expect(p.isError).toBe(true)
    expect(p.error.code).toBe('EXECUTE_FAILED')
    expect(p.error.message).toContain('loader unavailable')
  })

  test('sandbox-reported failures carry the same envelope, classified by cause', async () => {
    // Every hosted tool errors as { code, message }; execute is no exception.
    // A CPU-budget overrun (execute-loader failure() wording) is EXECUTE_TIMEOUT;
    // anything else — user throw, syntax error — is EXECUTE_FAILED, message verbatim.
    const timedOut = makeContext({ execute: async () => ({ ok: false, error: 'Script execution exceeded its 5000ms CPU budget', logs: [] }) })
    const t = payloadOf(await handleHostedRequest(call('execute', { code: 'while (true) {}' }), timedOut))
    expect(t.error).toEqual({ code: 'EXECUTE_TIMEOUT', message: 'Script execution exceeded its 5000ms CPU budget' })
    const threw = makeContext({ execute: async () => ({ ok: false, error: 'boom', logs: ['before the throw'] }) })
    const e = payloadOf(await handleHostedRequest(call('execute', { code: 'throw new Error("boom")' }), threw))
    expect(e.error).toEqual({ code: 'EXECUTE_FAILED', message: 'boom' })
    expect(e.logs).toEqual(['before the throw']) // logs survive the re-shaping
  })
})

describe('hosted render_png', () => {
  test('threads deterministic font warnings through the complete tool payload', async () => {
    const warning = {
      code: 'PNG_FONT_COVERAGE' as const,
      script: 'CJK',
      chars: ['日', '本', '語'],
      message: 'known bundled-font coverage gap',
    }
    const ctx = makeContext({ renderPng: async () => ({ png: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), warnings: [warning], receipt: TEST_PNG_RECEIPT, runtime: PNG_WASM_RUNTIME }) })
    const payload = payloadOf(await handleHostedRequest(call('render_png', { source: 'flowchart LR\n  A[日本語]' }), ctx))
    expect(payload.ok).toBe(true)
    expect(payload.png_base64).toBe('iVBORw==')
    expect(payload.warnings).toEqual([warning])
  })
  test('combines source config diagnostics with raster font warnings', async () => {
    const fontWarning = { code: 'PNG_FONT_COVERAGE' as const, script: 'CJK', chars: ['日'], message: 'font gap' }
    const ctx = makeContext({ renderPng: async () => ({ png: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), warnings: [fontWarning], receipt: TEST_PNG_RECEIPT, runtime: PNG_WASM_RUNTIME }) })
    const source = '---\nconfig:\n  state:\n    titleTopMargin: 10\n---\nstateDiagram-v2\n  A[日] --> B'
    const payload = payloadOf(await handleHostedRequest(call('render_png', { source }), ctx))
    expect(payload.ok).toBe(true)
    expect(payload.warnings).toContainEqual(expect.objectContaining({ field: 'state.titleTopMargin' }))
    expect(payload.warnings).toContainEqual(fontWarning)
  })

  test('returns base64 PNG bytes from the injected rasterizer', async () => {
    const ctx = makeContext()
    const p = payloadOf(await handleHostedRequest(call('render_png', { source: FLOW, scale: 3, background: '#fff' }), ctx))
    expect(p.ok).toBe(true)
    expect(atob(p.png_base64)).toBe('\x89PNG')
    expect(p.runtime).toEqual(PNG_WASM_RUNTIME)
    expect(ctx.pngCalls).toEqual([{
      source: FLOW, scale: 3, background: '#ffffff', security: 'strict', embedFontImport: false,
    }])
  })

  test('forces strict PNG security after caller-supplied advanced options', async () => {
    const ctx = makeContext()
    const payload = payloadOf(await handleHostedRequest(call('render_png', {
      source: FLOW,
      options: { security: 'default', seed: 4 },
    }), ctx))
    expect(payload.ok).toBe(true)
    expect(ctx.pngCalls).toEqual([expect.objectContaining({ security: 'strict', seed: 4 })])
  })

  test('PNG compatibility conveniences override the canonical options object', async () => {
    const ctx = makeContext()
    const payload = payloadOf(await handleHostedRequest(call('render_png', {
      source: FLOW,
      options: { style: 'hand-drawn', seed: 1 },
      style: 'crisp',
      seed: 7,
    }), ctx))
    expect(payload.ok).toBe(true)
    expect(ctx.pngCalls).toEqual([expect.objectContaining({ style: 'crisp', seed: 7, security: 'strict' })])
  })

  test('a PNG larger than one base64 chunk round-trips byte-for-byte', async () => {
    // base64Encode spreads each 0x8000-byte slice through String.fromCharCode;
    // a payload spanning several chunks (plus a partial tail) exercises the
    // boundary joins. A wrong chunk stride would drop or duplicate bytes.
    const big = new Uint8Array(0x8000 * 2 + 123)
    for (let i = 0; i < big.length; i++) big[i] = i % 256
    const ctx = makeContext({ renderPng: async () => ({ png: big, warnings: [], receipt: TEST_PNG_RECEIPT, runtime: PNG_WASM_RUNTIME }) })
    const p = payloadOf(await handleHostedRequest(call('render_png', { source: FLOW }), ctx))
    expect(p.ok).toBe(true)
    const decoded = Uint8Array.from(atob(p.png_base64), c => c.charCodeAt(0))
    expect(decoded).toEqual(big)
  })

  test('rejects oversized hosted bytes before constructing a base64 response', async () => {
    const oversized = new Uint8Array(MAX_HOSTED_PNG_BYTES + 1)
    const ctx = makeContext({ renderPng: async () => ({
      png: oversized,
      warnings: [],
      receipt: TEST_PNG_RECEIPT,
      runtime: PNG_WASM_RUNTIME,
    }) })
    const payload = payloadOf(await handleHostedRequest(call('render_png', { source: FLOW }), ctx))
    expect(payload.ok).toBe(false)
    expect(payload.isError).toBe(true)
    expect(payload.error.code).toBe('PNG_OUTPUT_TOO_LARGE')
    expect(payload).not.toHaveProperty('png_base64')
  })

  test('preserves every positive finite portable scale before rasterizing', async () => {
    const ctx = makeContext()
    await handleHostedRequest(call('render_png', { source: FLOW, scale: 100 }), ctx)
    await handleHostedRequest(call('render_png', { source: FLOW, scale: 0.001 }), ctx)
    await handleHostedRequest(call('render_png', { source: FLOW, scale: 3 }), ctx)
    expect(ctx.pngCalls.map(c => c.scale)).toEqual([100, 0.001, 3])
  })

  test('file/url artifact modes are a local-server feature', async () => {
    const res = await handleHostedRequest(call('render_png', { source: FLOW, output: 'file' }), makeContext())
    expect(res?.error?.code).toBe(-32602)
    expect(res?.error?.message).toContain('arguments.output is not allowed')
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

describe('cacheKeyFor (validated, normalized, output-affecting arguments)', () => {
  test('normalizes describe_sdk defaults and rejects invalid discovery requests', () => {
    expect(cacheKeyFor('describe_sdk', { family: 'gantt' }))
      .toEqual(cacheKeyFor('describe_sdk', { family: 'gantt', detail: 'fields' }))
    expect(cacheKeyFor('describe_sdk', { family: 'gantt', detail: 'signatures' }))
      .not.toEqual(cacheKeyFor('describe_sdk', { family: 'gantt', detail: 'fields' }))
    expect(cacheKeyFor('describe_sdk', { family: 'gantt', ignored: true })).toBeNull()
    expect(cacheKeyFor('describe_sdk', { family: 'unknown' })).toBeNull()
    expect(cacheKeyFor('describe_sdk', { family: 'gantt', detail: 'unknown' })).toBeNull()
  })

  test('does not cache arguments rejected by the advertised tool schema', () => {
    expect(cacheKeyFor('describe', { source: FLOW, nonce: 'x', foo: 1 })).toBeNull()
  })

  test('execute is never response-cached because it exposes time and randomness', () => {
    expect(cacheKeyFor('execute', { code: '1 + 1', timeoutMs: 100 })).toBeNull()
    expect(cacheKeyFor('execute', { code: 'Date.now()' })).toBeNull()
  })

  test('render_png keys on the exact requested portable scale', () => {
    expect(cacheKeyFor('render_png', { source: FLOW, scale: 100 }))
      .not.toEqual(cacheKeyFor('render_png', { source: FLOW, scale: 999 }))
    expect(cacheKeyFor('render_png', { source: FLOW, scale: 100 }))
      .not.toEqual(cacheKeyFor('render_png', { source: FLOW, scale: 8 }))
    expect(cacheKeyFor('render_png', { source: FLOW, scale: 2 }))
      .not.toEqual(cacheKeyFor('render_png', { source: FLOW, scale: 4 }))
  })

  test('render_png background and source both participate in the key', () => {
    expect(cacheKeyFor('render_png', { source: FLOW, background: 'white' }))
      .not.toEqual(cacheKeyFor('render_png', { source: FLOW, background: 'black' }))
    expect(cacheKeyFor('render_png', { source: FLOW }))
      .not.toEqual(cacheKeyFor('render_png', { source: 'flowchart TD\n  X --> Y' }))
    expect(cacheKeyFor('render_png', { source: FLOW, background: '#fff' }))
      .toEqual(cacheKeyFor('render_png', { source: FLOW, background: '#ffffff' }))
  })

  test('render_png omitted scale and explicit default scale collapse to one entry', () => {
    // both render at scale 2 (png-wasm applies `?? 2`), so they must share a key
    const absent = cacheKeyFor('render_png', { source: FLOW }) as Record<string, unknown>
    expect(absent).toHaveProperty('output.scale', 2)
    expect(absent).toEqual(cacheKeyFor('render_png', { source: FLOW, scale: 2 }) as Record<string, unknown>)
    // An ill-typed scale is not cacheable because dispatch rejects it.
    expect(cacheKeyFor('render_png', { source: FLOW, scale: 'big' })).toBeNull()
  })

  test('render_png cache identity follows effective fit/style precedence', () => {
    expect(cacheKeyFor('render_png', { source: FLOW, scale: 2, fitTo: { width: 64 } }))
      .toEqual(cacheKeyFor('render_png', { source: FLOW, scale: 99, fitTo: { width: 64 } }))
    expect(cacheKeyFor('render_png', {
      source: FLOW,
      style: 'crisp',
      options: { style: 'hand-drawn', seed: 1 },
    })).toEqual(cacheKeyFor('render_png', {
      source: FLOW,
      style: 'crisp',
      options: { style: 'crisp', seed: 1 },
    }))
  })

  test('the source/code payload is keyed verbatim (comment junk is NOT normalized)', () => {
    // Documented scope limit: insignificant source bytes are not normalized —
    // keying on raw source keeps a cached result provably correct
    // for that exact input. The rate limit, not the cache, bounds this.
    expect(cacheKeyFor('render_svg', { source: 'flowchart LR\n  A --> B' }))
      .not.toEqual(cacheKeyFor('render_svg', { source: 'flowchart LR\n  A --> B\n%% c' }))
  })

  test('render_svg keys validated theme/bg/fg inputs and rejects junk', () => {
    expect(cacheKeyFor('render_svg', { source: FLOW, bg: '#000' }))
      .toEqual({
        t: 'render_svg',
        source: FLOW,
        render: { bg: '#000', security: 'strict', embedFontImport: false },
        legacyThemeDiagnostic: false,
      })
    expect(cacheKeyFor('render_svg', { source: FLOW, bg: '#000', junk: 1 })).toBeNull()
    expect(cacheKeyFor('render_svg', { source: FLOW, theme: 'paper' }))
      .not.toEqual(cacheKeyFor('render_svg', { source: FLOW, theme: 'dusk' }))
  })

  test('render_svg cache identity preserves the legacy-theme diagnostic', () => {
    const legacy = cacheKeyFor('render_svg', { source: FLOW, theme: 'paper' }) as Record<string, unknown>
    const canonical = cacheKeyFor('render_svg', { source: FLOW, options: THEMES.paper }) as Record<string, unknown>

    expect(legacy.render).toEqual(canonical.render)
    expect(legacy).toHaveProperty('legacyThemeDiagnostic', true)
    expect(canonical).toHaveProperty('legacyThemeDiagnostic', false)
    expect(legacy).not.toEqual(canonical)
  })

  test('render_ascii distinguishes charset and target width', () => {
    expect(cacheKeyFor('render_ascii', { source: FLOW, useAscii: true }))
      .not.toEqual(cacheKeyFor('render_ascii', { source: FLOW }))
    expect(cacheKeyFor('render_ascii', { source: FLOW, targetWidth: 40 }))
      .not.toEqual(cacheKeyFor('render_ascii', { source: FLOW, targetWidth: 60 }))
  })

  test('returns null for uncacheable calls (unknown tool, missing arg, bad output)', () => {
    expect(cacheKeyFor('render_gif', { source: FLOW })).toBeNull()
    expect(cacheKeyFor(undefined, {})).toBeNull()
    expect(cacheKeyFor('describe', {})).toBeNull()
    expect(cacheKeyFor('execute', { code: 42 })).toBeNull()
    expect(cacheKeyFor('render_png', { source: FLOW, output: 'file' })).toBeNull()
  })

  test('distinct tools never collide on identical source', () => {
    const keys = ['render_svg', 'render_ascii', 'verify', 'describe']
      .map(t => JSON.stringify(cacheKeyFor(t, { source: FLOW })))
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('describe format participates in the cache key', () => {
    expect(cacheKeyFor('describe', { source: FLOW })).toEqual(cacheKeyFor('describe', { source: FLOW, format: 'text' }))
    expect(cacheKeyFor('describe', { source: FLOW, format: 'facts' })).not.toEqual(cacheKeyFor('describe', { source: FLOW, format: 'json' }))
    expect(cacheKeyFor('describe', { source: FLOW, format: 'bad' })).toBeNull()
  })
})
