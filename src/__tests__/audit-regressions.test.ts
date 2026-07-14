import { describe, expect, test } from 'bun:test'
import { rmSync, writeFileSync } from 'node:fs'
import { applyOps, buildChecked } from '../agent/apply.ts'
import { describeMermaid, describeMermaidSource } from '../agent/describe.ts'
import { describeMermaidFacts } from '../agent/facts.ts'
import { parseMermaid } from '../agent/parse.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { runBatchLine, runCli } from '../cli/index.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { handleRequest as handleLocalRequest } from '../mcp/server.ts'
import { handleHostedRequest } from '../mcp/hosted-server.ts'
import { dependencyStartupMessage } from '../../bin/dependency-error.ts'
import { createMcpHandler, preserveUnsafeJsonRpcIds, type McpCache } from '../../website/src/mcp-handler.ts'

const toolCall = (name: string, args: Record<string, unknown>, id: number | string = 1) => ({
  jsonrpc: '2.0' as const, id, method: 'tools/call', params: { name, arguments: args },
})

function payload(response: Awaited<ReturnType<typeof handleHostedRequest>>): any {
  return JSON.parse((response?.result as any).content[0].text)
}

function captureCli(run: () => number): { code: number; output: string; stdout: string; stderr: string } {
  const stdout: string[] = []
  const stderr: string[] = []
  const original = process.stdout.write
  const originalError = process.stderr.write
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
    return true
  }) as typeof process.stderr.write
  try {
    const code = run()
    return { code, output: stdout.join(''), stdout: stdout.join(''), stderr: stderr.join('') }
  } finally {
    process.stdout.write = original
    process.stderr.write = originalError
  }
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
  else rejected
    S-->>U: denied
  end`
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok || parsed.value.body.kind !== 'sequence') return
    expect(parsed.value.body.statements?.some(statement => statement.kind === 'fragment')).toBe(true)
    const prose = describeMermaid(parsed.value)
    expect(prose).toContain('branch 0 (accepted): S -> U: response; U -> S: ack')
    expect(prose).toContain('branch 1 (rejected): S -> U: denied')
    expect(prose).not.toContain('Messages in order')
    const facts = describeMermaidFacts(parsed.value)
    expect(facts).toContain('message#2 fragment#0 branch#0 U -> S : ack')
    expect(facts).toContain('fragment#0 branch#1 : rejected')
    expect(verifyMermaid(parsed.value).layout.edges).toHaveLength(4)

    const edited = applyOps({ source, ops: [{ kind: 'set_fragment_message_text', fragmentIndex: 0, index: 0, text: 'accepted response' }] })
    expect(edited.ok).toBe(true)
    if (edited.ok) expect(edited.source).toContain('S-->>U: accepted response')

    const branchEdited = applyOps({ source, ops: [{ kind: 'set_fragment_branch_label', fragmentIndex: 0, branchIndex: 0, label: 'CHANGED' }] })
    expect(branchEdited.ok).toBe(true)
    if (branchEdited.ok) expect(branchEdited.source).toContain('alt CHANGED')

    const built = applyOps({ family: 'sequence', ops: [
      { kind: 'add_participant', id: 'A' },
      { kind: 'add_participant', id: 'B' },
      { kind: 'add_fragment', fragmentKind: 'loop', label: 'retry' },
      { kind: 'add_fragment_message', fragmentIndex: 0, from: 'A', to: 'B', text: 'again' },
    ] })
    expect(built.ok).toBe(true)
    if (built.ok) expect(built.source).toContain('loop retry\n  A->>B: again\n  end')
  })

  test('opaque sequence semantics are explicit instead of silently absent from read-back', () => {
    const source = 'sequenceDiagram\n  alt outer\n    loop retry\n      A->>B: hidden\n    end\n  end'
    const result = verifyMermaid(source)
    expect(result.layout.edges).toHaveLength(1)
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'sequence_opaque_segment',
    }))
  })

  test('tolerant parser repairs always surface through warnings', () => {
    const cases = [
      ['flowchart TD\n  A[Start]\n  A -->', 'flowchart_dangling_edge'],
      ['flowchart TD\n  A[Start] -->|go|', 'flowchart_dangling_edge'],
      ['flowchart TD\n  Server[Server]\n  Client[Client] --> Sevrer', 'flowchart_implicit_endpoint'],
      ['flowchart TD\n  Server\n  Client --> Sevrer', 'flowchart_implicit_endpoint'],
      ['flowchart TD\n  Server@{ shape: rect, label: "Server" }\n  Client --> Sevrer', 'flowchart_implicit_endpoint'],
      ['flowchart TD\n  Server>Server]\n  Client --> Sevrer', 'flowchart_implicit_endpoint'],
      ['flowchart TD\n  Customer[Customer]\n  Customer --> Customar', 'flowchart_implicit_endpoint'],
      ['xychart-beta\n  x-axis [Jan, Feb, Mar]\n  line [1, 2]', 'xychart_axis_series_length_mismatch'],
      ['xychart-beta\n  x-axis [Jan, Feb]\n  line [1, 2, 3]', 'xychart_axis_series_length_mismatch'],
    ] as const
    for (const [source, syntax] of cases) {
      const result = verifyMermaid(source)
      expect({ syntax, warned: result.warnings.some(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax === syntax) })
        .toEqual({ syntax, warned: true })
    }
    expect(verifyMermaid('flowchart LR\n  Customer[Customer]\n  Custome[Custome]\n  A[Start] --> Custome').warnings)
      .not.toContainEqual(expect.objectContaining({ syntax: 'flowchart_implicit_endpoint' }))
    const metadata = parseMermaid('flowchart LR\n  A e1@--> B\n  e1@{ label: "calls" }')
    expect(metadata.ok).toBe(true)
    if (metadata.ok) {
      expect(metadata.value.body.kind).toBe('opaque')
      expect(verifyMermaid(metadata.value).warnings).toContainEqual(expect.objectContaining({ syntax: 'flowchart_edge_metadata' }))
    }
  })

  test('sequence prose preserves source-order interleaving around fragments', () => {
    const summary = describeMermaidSource([
      'sequenceDiagram',
      '  A->>B: before',
      '  alt yes',
      '    B-->>A: inside',
      '  end',
      '  A->>B: after',
    ].join('\n'))
    const before = summary.indexOf('message A -> B: before')
    const fragment = summary.indexOf('fragment 0 (alt)')
    const after = summary.indexOf('message A -> B: after')
    expect({ includesAll: before >= 0 && fragment >= 0 && after >= 0, ordered: before < fragment && fragment < after })
      .toEqual({ includesAll: true, ordered: true })
  })

  test('local and hosted describe cannot report ok when verify reports RENDER_FAILED', async () => {
    const source = 'quadrantChart\n  title T\n  x-axis L --> R\n  y-axis B --> T2\n  Company A: 0.8, 0.75'
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'RENDER_FAILED' }))
    const responses = [
      await handleLocalRequest(toolCall('describe', { source }) as any),
      await handleHostedRequest(toolCall('describe', { source }), { execute: async () => ({ ok: true, value: null, logs: [] }) }),
    ]
    for (const response of responses) {
      expect((response?.result as any).isError).toBe(true)
      expect(payload(response)).toEqual(expect.objectContaining({ ok: false, warnings: expect.arrayContaining([expect.objectContaining({ code: 'RENDER_FAILED' })]) }))
    }
  })

  test('CLI describe cannot exit successfully when verify reports RENDER_FAILED', () => {
    const source = 'pie\n  "A" : notanumber'
    const path = `/tmp/agentic-mermaid-describe-${process.pid}-${Date.now()}.mmd`
    writeFileSync(path, source)
    for (const format of ['text', 'json', 'facts']) {
      const result = captureCli(() => runCli(['describe', path, '--format', format, '--json']))
      expect(result.code).toBe(3)
      expect(JSON.parse(result.output)).toEqual(expect.objectContaining({
        ok: false,
        family: 'pie',
        warnings: expect.arrayContaining([expect.objectContaining({ code: 'RENDER_FAILED' })]),
      }))
    }
  })

  test('CLI describe keeps verify failures human-readable outside JSON mode', () => {
    const path = `/tmp/agentic-mermaid-describe-text-${process.pid}-${Date.now()}.mmd`
    writeFileSync(path, 'pie\n  "A" : notanumber\n')
    try {
      const result = captureCli(() => runCli(['describe', path, '--format', 'text']))
      expect(result.code).toBe(3)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('describe: verify failed:')
    } finally {
      rmSync(path, { force: true })
    }
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
    expect(await executeInSandbox('return /Promise/.test("Promise")')).toEqual(expect.objectContaining({ ok: true, value: true }))
    expect(await executeInSandbox('return /WebAssembly/.source')).toEqual(expect.objectContaining({ ok: true, value: 'WebAssembly' }))
    expect((await executeInSandbox('const x = 8; return x / Promise / 2')).ok).toBe(false)
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
    expect(verifyMermaid('architecture-beta\n  title A\n  title B\n  service api(definitely-not-an-icon)[API]').warnings)
      .toContainEqual(expect.objectContaining({ code: 'UNKNOWN_SHAPE', node: 'api', shape: 'architecture-icon:definitely-not-an-icon' }))
  })

  test('timeout zero is invalid and source-checkout dependency failures are prescriptive', async () => {
    for (const timeoutMs of [0, -1, 0.5, 1.5, Number.POSITIVE_INFINITY, 'bad']) {
      const response = await handleHostedRequest(toolCall('execute', { code: 'return 1', timeoutMs }), { execute: async () => ({ ok: true, value: null, logs: [] }) })
      expect({ timeoutMs, error: response?.error }).toEqual({ timeoutMs, error: expect.objectContaining({ code: -32602 }) })
      const local = await handleLocalRequest(toolCall('execute', { code: 'return 1', timeoutMs }) as any)
      expect({ timeoutMs, error: local?.error }).toEqual({ timeoutMs, error: expect.objectContaining({ code: -32602 }) })
    }
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
    expect(preserveUnsafeJsonRpcIds('{"jsonrpc":"2.0","id":9007199254740993.0,"method":"ping"}').ids.map(id => id.raw)).toEqual(['9007199254740993.0'])
    const handler = createMcpHandler({ context, cacheVersion: 'test', onEvent: () => {} })
    for (const id of ['-0', '9007199254740993', '9007199254740993.0', '9007199254740993e0', '9.007199254740993e15']) {
      const body = `{"jsonrpc":"2.0","id":${id},"method":"ping"}`
      const response = await handler(new Request('https://agentic-mermaid.dev/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body }))
      expect(await response.text()).toContain(`"id":${id}`)
    }
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
    const execute = await handler(new Request('https://agentic-mermaid.dev/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toolCall('execute', { code: 'return Date.now()' })),
    }))
    expect(execute.headers.get('x-agentic-mermaid-compute-cache')).toBe('bypass')

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
