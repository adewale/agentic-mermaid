import { describe, expect, test } from 'bun:test'
import { applyOps, buildChecked } from '../agent/apply.ts'
import { describeMermaid } from '../agent/describe.ts'
import { describeMermaidFacts } from '../agent/facts.ts'
import { parseMermaid } from '../agent/parse.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { runBatchLine } from '../cli/index.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { handleHostedRequest } from '../mcp/hosted-server.ts'
import { dependencyStartupMessage } from '../../bin/dependency-error.ts'
import { createMcpHandler, preserveUnsafeJsonRpcIds, type McpCache } from '../../website/src/mcp-handler.ts'

const toolCall = (name: string, args: Record<string, unknown>, id: number | string = 1) => ({
  jsonrpc: '2.0' as const, id, method: 'tools/call', params: { name, arguments: args },
})

function payload(response: Awaited<ReturnType<typeof handleHostedRequest>>): any {
  return JSON.parse((response?.result as any).content[0].text)
}

describe('reported contract regressions', () => {
  test('sequence fragments are typed, visible in read-back, and editable', () => {
    const source = `sequenceDiagram
  participant U as User
  participant S as Server
  U->>S: request
  alt accepted
    S-->>U: response
    U->>S: ack
  end`
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok || parsed.value.body.kind !== 'sequence') return
    expect(parsed.value.body.statements?.some(statement => statement.kind === 'fragment')).toBe(true)
    expect(describeMermaid(parsed.value)).toContain('S -> U: response')
    expect(describeMermaidFacts(parsed.value)).toContain('message U -> S : ack')
    expect(verifyMermaid(parsed.value).layout.edges).toHaveLength(3)

    const edited = applyOps({ source, ops: [{ kind: 'set_fragment_message_text', fragmentIndex: 0, index: 0, text: 'accepted response' }] })
    expect(edited.ok).toBe(true)
    if (edited.ok) expect(edited.source).toContain('S-->>U: accepted response')

    const built = applyOps({ family: 'sequence', ops: [
      { kind: 'add_participant', id: 'A' },
      { kind: 'add_participant', id: 'B' },
      { kind: 'add_fragment', fragmentKind: 'loop', label: 'retry' },
      { kind: 'add_fragment_message', fragmentIndex: 0, from: 'A', to: 'B', text: 'again' },
    ] })
    expect(built.ok).toBe(true)
    if (built.ok) expect(built.source).toContain('loop retry\n  A->>B: again\n  end')
  })

  test('tolerant parser repairs always surface through warnings', () => {
    const cases = [
      ['flowchart TD\n  A[Start]\n  A -->', 'flowchart_dangling_edge'],
      ['flowchart TD\n  Server[Server]\n  Client[Client] --> Sevrer', 'flowchart_implicit_endpoint'],
      ['xychart-beta\n  x-axis [Jan, Feb, Mar]\n  line [1, 2]', 'xychart_axis_series_length_mismatch'],
      ['xychart-beta\n  x-axis [Jan, Feb]\n  line [1, 2, 3]', 'xychart_axis_series_length_mismatch'],
    ] as const
    for (const [source, syntax] of cases) {
      const result = verifyMermaid(source)
      expect({ syntax, warned: result.warnings.some(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax === syntax) })
        .toEqual({ syntax, warned: true })
    }
    const metadata = parseMermaid('flowchart LR\n  A e1@--> B\n  e1@{ label: "calls" }')
    expect(metadata.ok).toBe(true)
    if (metadata.ok) {
      expect(metadata.value.body.kind).toBe('opaque')
      expect(verifyMermaid(metadata.value).warnings).toContainEqual(expect.objectContaining({ syntax: 'flowchart_edge_metadata' }))
    }
  })

  test('describe cannot report ok when verify reports RENDER_FAILED', async () => {
    const source = 'quadrantChart\n  title T\n  x-axis L --> R\n  y-axis B --> T2\n  Company A: 0.8, 0.75'
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'RENDER_FAILED' }))
    const response = await handleHostedRequest(toolCall('describe', { source }), { execute: async () => ({ ok: true, value: null, logs: [] }) })
    expect((response?.result as any).isError).toBe(true)
    expect(payload(response)).toEqual(expect.objectContaining({ ok: false, warnings: expect.arrayContaining([expect.objectContaining({ code: 'RENDER_FAILED' })]) }))
  })

  test('ER build ordering and batch ASCII are faithful', () => {
    const built = buildChecked('er', [
      { kind: 'add_entity', id: 'CUSTOMER' },
      { kind: 'add_entity', id: 'ORDER' },
    ])
    expect(built.ok).toBe(true)
    if (built.ok) expect(built.value.canonicalSource).toBe('erDiagram\n  CUSTOMER\n  ORDER\n')
    const rendered = runBatchLine(JSON.stringify({ op: 'render', source: 'flowchart LR\n  A --> B', options: { ascii: true } })) as any
    expect(rendered.ok).toBe(true)
    expect(rendered.data.ascii).toMatch(/^[\x00-\x7f]*$/)
  })

  test('Code Mode ignores ${ in strings/comments and permits template interpolation', async () => {
    expect(await executeInSandbox('return "plain ${ text"')).toEqual(expect.objectContaining({ ok: true, value: 'plain ${ text' }))
    expect(await executeInSandbox('// ${ comment\nreturn 1')).toEqual(expect.objectContaining({ ok: true, value: 1 }))
    expect(await executeInSandbox('return `value ${1 + 1}`')).toEqual(expect.objectContaining({ ok: true, value: 'value 2' }))
    expect((await executeInSandbox('return `${Promise.resolve(1)}`')).ok).toBe(false)
  })

  test('header aliases are consistent and unknown architecture icons are named', () => {
    for (const [source, family] of [
      ['architecture\n  service api(server)[API]', 'architecture'],
      ['quadrant\n  A: [0.2, 0.8]', 'quadrant'],
    ] as const) {
      const parsed = parseMermaid(source)
      expect({ family, parsed: parsed.ok && parsed.value.kind }).toEqual({ family, parsed: family })
      expect(verifyMermaid(source).ok).toBe(true)
    }
    expect(verifyMermaid('architecture-beta\n  service api(definitely-not-an-icon)[API]').warnings)
      .toContainEqual(expect.objectContaining({ code: 'UNKNOWN_SHAPE', node: 'api', shape: 'architecture-icon:definitely-not-an-icon' }))
  })

  test('timeout zero is invalid and source-checkout dependency failures are prescriptive', async () => {
    const response = await handleHostedRequest(toolCall('execute', { code: 'return 1', timeoutMs: 0 }), { execute: async () => ({ ok: true, value: null, logs: [] }) })
    expect(response?.error).toEqual(expect.objectContaining({ code: -32602 }))
    expect(dependencyStartupMessage(new Error("Cannot find module 'entities'"))).toContain('bun install')
  })
})

describe('hosted transport truthfulness', () => {
  const context = { execute: async () => ({ ok: true as const, value: null, logs: [] }) }

  test('unsafe numeric JSON-RPC ids round-trip lexically without touching nested ids', async () => {
    const raw = '{"jsonrpc":"2.0","id":9007199254740993,"method":"ping","params":{"id":9007199254740995}}'
    const protectedBody = preserveUnsafeJsonRpcIds(raw)
    expect(protectedBody.ids.map(id => id.raw)).toEqual(['9007199254740993'])
    expect(protectedBody.body).toContain('"params":{"id":9007199254740995}')
    expect(preserveUnsafeJsonRpcIds('{"jsonrpc":"2.0","id":9007199254740993.0,"method":"ping"}').body).toContain('9007199254740993.0')
    const handler = createMcpHandler({ context, cacheVersion: 'test', onEvent: () => {} })
    const response = await handler(new Request('https://agentic-mermaid.dev/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw }))
    expect(await response.text()).toContain('"id":9007199254740993')
  })

  test('HTTP responses stay no-store while the private compute-cache status is observable', async () => {
    const entries = new Map<string, Response>()
    const cache: McpCache = {
      async match(key) { return entries.get(key.url)?.clone() },
      async put(key, response) { entries.set(key.url, response.clone()) },
    }
    const handler = createMcpHandler({ context, cache, cacheVersion: 'test', onEvent: () => {} })
    const post = () => handler(new Request('https://agentic-mermaid.dev/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toolCall('verify', { source: 'flowchart LR\n  A --> B' })),
    }))
    const miss = await post()
    const hit = await post()
    expect(miss.headers.get('cache-control')).toBe('no-store')
    expect(miss.headers.get('x-agentic-mermaid-compute-cache')).toBe('miss')
    expect(hit.headers.get('x-agentic-mermaid-compute-cache')).toBe('hit')

    const initialize = await handleHostedRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, context)
    const instructions = (initialize?.result as any).instructions as string
    expect(instructions).toContain('private server-side compute cache')
    expect(instructions).toContain('cache-control: no-store')
    expect(instructions).not.toContain('are edge-cached')
  })

  test('405 advertises the allowed methods', async () => {
    const handler = createMcpHandler({ context, cacheVersion: 'test', onEvent: () => {} })
    const response = await handler(new Request('https://agentic-mermaid.dev/mcp', { method: 'GET' }))
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST, OPTIONS')
  })
})
