// Worker Loader glue for hosted execute and the direct tools' layout isolate
// (website/src/execute-loader.ts):
// isolate keying, the expression-first startup-probe fallback, limit plumbing,
// and failure mapping. The loader binding is a purpose-built fake recording
// every isolate request; real loader behavior is covered by website/e2e-mcp.sh.

import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { createLoaderExecute, createLoaderToolRunner, deployTag, DYNAMIC_WORKER_COMPAT_DATE, MAX_RESULT_BYTES, MAX_TOOL_RESULT_BYTES, readCapped, type WorkerLoaderBinding } from '../../website/src/execute-loader.ts'
import { HOSTED_TOOL_CPU_MS, hostedToolNeedsIsolate, isolateHeavyHostedTools, runHostedTool, withRequestCpuAllowance, withRequestCpuAllowanceForIsolate, type HostedToolRequest } from '../mcp/hosted-tool-runtime.ts'
import { handleHostedRequest, type HostedMcpContext } from '../mcp/hosted-server.ts'
import type { JsonRpcResponse } from '../mcp/protocol.ts'
import { renderPortablePngGraphicalProjection } from '../png-graphical.ts'
import { HOSTED_RENDER_OPTIONS } from '../render-host-policy.ts'
import { PNG_WASM_RUNTIME } from '../png-contract.ts'
import pkg from '../../package.json'

interface IsolateRequest { id: string; modules: Record<string, string>; globalOutbound: unknown; limits?: { cpuMs?: number; subRequests?: number } }

/** Fake loader: `respond` decides what each isolate start does. */
function makeLoader(respond: (req: IsolateRequest) => Response | Error): { loader: WorkerLoaderBinding; requests: IsolateRequest[] } {
  const requests: IsolateRequest[] = []
  const loader: WorkerLoaderBinding = {
    get(id, getCode) {
      return {
        getEntrypoint(_name, options) {
          return {
            async fetch() {
              const code = await getCode()
              const req: IsolateRequest = { id, modules: code.modules as Record<string, string>, globalOutbound: code.globalOutbound, limits: options?.limits }
              requests.push(req)
              const out = respond(req)
              if (out instanceof Error) throw out
              return out
            },
          }
        },
      }
    },
  }
  return { loader, requests }
}

const okResponse = (payload: unknown) => new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })

describe('hosted execute loader glue', () => {
  test('expression-form isolate wins when it starts; code is hash-keyed with no network and no env', async () => {
    const { loader, requests } = makeLoader(() => okResponse({ ok: true, value: 2, logs: [] }))
    const execute = createLoaderExecute(loader, 'HARNESS')
    const result = await execute('1 + 1', 5000)
    expect(result).toEqual({ ok: true, value: 2, logs: [] })
    expect(requests).toHaveLength(1)
    const req = requests[0]!
    // version + harness hash + wrap variant + SHA-256 of the user code
    const codeHash = createHash('sha256').update('1 + 1').digest('hex')
    expect(req.id).toBe(`exec-${await deployTag('HARNESS')}-e-${codeHash}`)
    expect(req.id).toMatch(new RegExp(`^exec-v${pkg.version.replace(/\./g, '\\.')}-[0-9a-f]{16}-e-[0-9a-f]{64}$`))
    expect(req.globalOutbound).toBeNull()
    expect(req.limits).toEqual({ cpuMs: 5000, subRequests: 0 })
    expect(req.modules['harness.js']).toBe('HARNESS')
    expect(req.modules['user.js']).toContain('return (')
  })

  test('identical code produces identical isolate ids; different code differs', async () => {
    const { loader, requests } = makeLoader(() => okResponse({ ok: true, value: null, logs: [] }))
    const execute = createLoaderExecute(loader, 'H')
    await execute('1 + 1', 5000)
    await execute('1 + 1', 5000)
    await execute('2 + 2', 5000)
    expect(requests[0]!.id).toBe(requests[1]!.id)
    expect(requests[2]!.id).not.toBe(requests[0]!.id)
  })

  test('a changed harness produces different isolate ids for identical code', async () => {
    // Worker Loader contract: one ID must always map to the same WorkerCode.
    // A harness/SDK change without a package version bump must still move the
    // ID, or a warm isolate keeps serving the old code after a deploy.
    const { loader, requests } = makeLoader(() => okResponse({ ok: true, value: null, logs: [] }))
    await createLoaderExecute(loader, 'HARNESS-A')('1 + 1', 5000)
    await createLoaderExecute(loader, 'HARNESS-B')('1 + 1', 5000)
    expect(requests[0]!.id).not.toBe(requests[1]!.id)
  })

  test('a SyntaxError startup failure falls back to the statement-form isolate and reports both loader attempts', async () => {
    const { loader, requests } = makeLoader(req =>
      req.id.includes('-e-')
        ? new Error("Failed to start Worker:\nUncaught SyntaxError: Unexpected token 'const'\n  at user.js:1")
        : okResponse({ ok: true, value: 42, logs: [] }))
    const execute = createLoaderExecute(loader, 'H')
    const telemetry: unknown[] = []
    const result = await execute('const x = 42; return x', 5000, event => telemetry.push(event))
    expect(result).toEqual({ ok: true, value: 42, logs: [] })
    expect(requests.map(r => r.id.includes('-e-') ? 'e' : 's')).toEqual(['e', 's'])
    expect(requests[1]!.modules['user.js']).not.toContain('return (')
    expect(telemetry).toEqual([{ loaderAttempts: 2 }])
  })

  test('a bare parser startup failure also falls back to the statement-form isolate', async () => {
    const { loader, requests } = makeLoader(req =>
      req.id.includes('-e-')
        ? new Error("Unexpected token 'const'")
        : okResponse({ ok: true, value: 42, logs: [] }))
    const execute = createLoaderExecute(loader, 'H')
    const result = await execute('const x = 42; return x', 5000)
    expect(result).toEqual({ ok: true, value: 42, logs: [] })
    expect(requests.map(r => r.id.includes('-e-') ? 'e' : 's')).toEqual(['e', 's'])
  })

  test('workerd reserved-word startup errors also fall back for leading let', async () => {
    const { loader, requests } = makeLoader(req =>
      req.id.includes('-e-')
        ? new Error('Unexpected strict mode reserved word at user.js:2:1')
        : okResponse({ ok: true, value: 1, logs: [] }))
    const result = await createLoaderExecute(loader, 'H')('let x = 1; return x', 5000)
    expect(result).toEqual({ ok: true, value: 1, logs: [] })
    expect(requests.map(request => request.id.includes('-e-') ? 'e' : 's')).toEqual(['e', 's'])
  })

  test('a double SyntaxError reports the statement attempt message, stripped of the startup preamble', async () => {
    const { loader } = makeLoader(() => new Error("Failed to start Worker:\nUncaught SyntaxError: Unexpected token ')'\n  at user.js:1"))
    const execute = createLoaderExecute(loader, 'H')
    const result = await execute('return ) === (', 5000)
    expect(result.ok).toBe(false)
    expect(result.error).toBe("Unexpected token ')'")
  })

  test('a double bare parser startup failure reports the statement attempt message', async () => {
    const { loader } = makeLoader(() => new Error("Unexpected token ')'"))
    const execute = createLoaderExecute(loader, 'H')
    const result = await execute('return ) === (', 5000)
    expect(result.ok).toBe(false)
    expect(result.error).toBe("Unexpected token ')'")
  })

  test('non-syntax loader failures do not trigger the statement fallback', async () => {
    const { loader, requests } = makeLoader(() => new Error('internal error; loader unavailable'))
    const execute = createLoaderExecute(loader, 'H')
    const result = await execute('1 + 1', 5000)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('loader unavailable')
    expect(requests).toHaveLength(1)
  })

  test('non-syntax loader failures omit stack lines and harness offsets', async () => {
    const { loader } = makeLoader(() => new Error('loader failed at harness.js:812:33\n    at secret harness frame'))
    const result = await createLoaderExecute(loader, 'H')('1 + 1', 5000)
    expect(result.error).toBe('sandbox error: loader failed at <sandbox>')
    expect(result.error).not.toContain('812')
    expect(result.error).not.toContain('secret harness frame')
  })

  test('cpu-limit exceptions map to the CPU-budget error', async () => {
    const { loader } = makeLoader(() => new Error('Worker exceeded CPU time limit.'))
    const execute = createLoaderExecute(loader, 'H')
    const result = await execute('for(let i=0;i<1e9;i++){}', 250)
    expect(result).toEqual({ ok: false, error: 'Script execution exceeded its 250ms CPU budget', code: 'EXECUTE_TIMEOUT', logs: [] })
  })

  test('oversized sandbox results are bounded', async () => {
    const { loader } = makeLoader(() => okResponse({ ok: true, value: 'x'.repeat(MAX_RESULT_BYTES), logs: [] }))
    const execute = createLoaderExecute(loader, 'H')
    const result = await execute('return big', 5000)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('exceeded')
    expect(result.error).toContain('bytes')
  })

  test('malformed sandbox payloads degrade to a structured error', async () => {
    const { loader } = makeLoader(() => okResponse({ unexpected: true }))
    const execute = createLoaderExecute(loader, 'H')
    const result = await execute('1', 5000)
    expect(result).toEqual({ ok: false, error: 'sandbox returned a malformed result', logs: [] })
  })

  test('an empty isolate body is a malformed result, not a leaked JSON.parse error', async () => {
    // Guards the empty/non-JSON body path: a 200 with no body must not surface
    // a raw `Unexpected end of JSON input` through failure().
    const { loader } = makeLoader(() => new Response('', { headers: { 'content-type': 'application/json' } }))
    const execute = createLoaderExecute(loader, 'H')
    const result = await execute('1', 5000)
    expect(result).toEqual({ ok: false, error: 'sandbox returned a malformed result', logs: [] })
  })

  test('a non-JSON isolate body is a malformed result, not a leaked parse error', async () => {
    const { loader } = makeLoader(() => new Response('not json at all', { headers: { 'content-type': 'application/json' } }))
    const execute = createLoaderExecute(loader, 'H')
    const result = await execute('1', 5000)
    expect(result).toEqual({ ok: false, error: 'sandbox returned a malformed result', logs: [] })
  })

  test('non-OK sandbox responses degrade to a structured error', async () => {
    const { loader } = makeLoader(() => new Response('nope', { status: 500 }))
    const execute = createLoaderExecute(loader, 'H')
    const result = await execute('1', 5000)
    expect(result).toEqual({ ok: false, error: 'sandbox returned HTTP 500', logs: [] })
  })

  test('the isolate compatibility date matches the parent wrangler config', async () => {
    const wrangler = await Bun.file(new URL('../../website/wrangler.jsonc', import.meta.url).pathname).text()
    expect(wrangler).toContain(`"compatibility_date": "${DYNAMIC_WORKER_COMPAT_DATE}"`)
  })

  test('a hung isolate fetch is cut off by the wall-clock backstop, not left pending', async () => {
    // cpuMs is the real budget in production; wrangler dev does not enforce it,
    // so a loader hang must still resolve the call via the Promise.race timer.
    // Deleting that race would leave this hanging forever (test times out) —
    // the test discriminates the backstop from a no-op. A tiny backstopMargin
    // keeps the wait sub-second.
    const loader: WorkerLoaderBinding = {
      get() {
        return { getEntrypoint() { return { fetch: () => new Promise<Response>(() => {}) } } }
      },
    }
    const execute = createLoaderExecute(loader, 'H', 20)
    const result = await execute('1 + 1', 30)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Script execution exceeded its 30ms CPU budget')
  })
})

describe('readCapped', () => {
  function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c)
        controller.close()
      },
    })
  }

  test('a null body reads as the empty string', async () => {
    expect(await readCapped(null, 10)).toBe('')
  })

  test('a body exactly at the cap is accepted; one byte over is rejected', async () => {
    const bytes = new Uint8Array(16).fill(0x61) // 16 × 'a'
    expect(await readCapped(streamOf([bytes]), 16)).toBe('a'.repeat(16))
    expect(await readCapped(streamOf([bytes]), 15)).toBeNull()
  })

  test('the cap counts bytes across chunk boundaries, not per chunk', async () => {
    // Two 10-byte chunks against a 15-byte cap must overrun (the naive per-chunk
    // check would let both through).
    const chunk = new Uint8Array(10).fill(0x62)
    expect(await readCapped(streamOf([chunk, chunk]), 15)).toBeNull()
  })

  test('a multi-byte UTF-8 char split across chunks decodes correctly', async () => {
    // '€' is E2 82 AC; split it across two chunks so decoding must join them.
    const euro = new TextEncoder().encode('€') // 3 bytes
    const a = euro.subarray(0, 1)
    const b = euro.subarray(1)
    expect(await readCapped(streamOf([a, b]), 10)).toBe('€')
  })
})

// The direct tools' layout isolate (createLoaderToolRunner). The fake loader
// runs the harness's /tool route body, runHostedTool, on the JSON the parent
// sent, so these cases cover the real request, round trip and failure mapping;
// cpuMs enforcement itself belongs to workerd and is exercised only at deploy.
describe('hosted direct-tool isolate', () => {
  interface ToolIsolateRequest { id: string; modules: Record<string, string>; globalOutbound: unknown; limits?: { cpuMs?: number; subRequests?: number }; body: Record<string, unknown> }
  function toolLoader(respond: (body: HostedToolRequest) => Response | Error | Promise<never> = body => okResponse(runHostedTool(body))) {
    const requests: ToolIsolateRequest[] = []
    const loader: WorkerLoaderBinding = {
      get(id, getCode) {
        return {
          getEntrypoint(_name, options) {
            return {
              async fetch(url, init) {
                const code = await getCode()
                const body = JSON.parse(String(init?.body))
                requests.push({ id, modules: code.modules, globalOutbound: code.globalOutbound, limits: options?.limits, body: { url, ...body } })
                const out = await respond(body)
                if (out instanceof Error) throw out
                return out
              },
            }
          },
        }
      },
    }
    return { loader, requests }
  }
  const execute = async () => ({ ok: true as const, value: null, logs: [] })
  const payloadOf = (response: JsonRpcResponse | null) => JSON.parse((response?.result as { content: Array<{ text: string }> }).content[0]!.text)
  const callTool = async (context: HostedMcpContext, name: string, args: Record<string, unknown>) =>
    payloadOf(await handleHostedRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, context))
  const tools = (context: HostedMcpContext) => Promise.all(([
    ['render_svg', { source: 'flowchart LR\n  A --> B' }],
    ['render_ascii', { source: 'sequenceDiagram\n  A->>B: Hi', useAscii: true }],
    ['verify', { source: 'flowchart TD\n  B --> [oops' }],
    ['describe', { source: 'mindmap\n  Root\n    Leaf', format: 'facts' }],
    ['mutate', { source: 'flowchart LR\n  A --> B', ops: [{ kind: 'add_node', id: 'C', label: 'C' }] }],
    ['build', { family: 'flowchart', ops: [{ kind: 'add_node', id: 'A', label: 'Start' }] }],
  ] as const).map(([name, args]) => callTool(context, name, args)))

  test('every layout tool runs in one per-deploy isolate with no network and its cpuMs, and answers as the inline path does', async () => {
    const { loader, requests } = toolLoader()
    const isolated = await tools({ execute, runTool: createLoaderToolRunner(loader, 'HARNESS') })
    expect(isolated).toEqual(await tools({ execute }))
    expect(isolated.map(payload => payload.ok)).toEqual([true, true, false, true, true, true])
    expect(requests.map(request => [request.body.url, request.body.name])).toEqual(['render_svg', 'render_ascii', 'verify', 'describe', 'mutate', 'build'].map(name => ['https://tool.internal/tool', name]))
    for (const request of requests) {
      expect(request).toMatchObject({ id: `tool-${await deployTag('HARNESS')}`, globalOutbound: null, limits: { cpuMs: HOSTED_TOOL_CPU_MS, subRequests: 0 } })
      expect(request.modules).toEqual({ 'harness.js': 'HARNESS', 'user.js': 'export default undefined' })
    }
  })

  test('render_png lays out in the isolate and a failed layout is the tool result', async () => {
    const source = 'flowchart LR\n  A --> B'
    const projections: unknown[] = []
    const renderPng: NonNullable<HostedMcpContext['renderPng']> = async (input, opts, project) => {
      const { scale, background, fitTo, minLabelPx, ...renderOptions } = opts
      const projection = await project!(input, renderOptions, { scale, background, fitTo, minLabelPx })
      projections.push(projection)
      return { png: new Uint8Array([137, 80, 78, 71]), warnings: [], receipt: projection.receipt, runtime: PNG_WASM_RUNTIME }
    }
    const { loader, requests } = toolLoader()
    expect(await callTool({ execute, renderPng, runTool: createLoaderToolRunner(loader, 'H') }, 'render_png', { source })).toMatchObject({ ok: true, png_base64: 'iVBORw==' })
    expect(requests.map(request => request.body.name)).toEqual(['png_projection'])
    expect(JSON.parse(JSON.stringify(projections[0]))).toEqual(JSON.parse(JSON.stringify(renderPortablePngGraphicalProjection(source, HOSTED_RENDER_OPTIONS, { scale: 2 }))))
    const timedOut = toolLoader(() => new Error('Worker exceeded CPU time limit.'))
    expect(await callTool({ execute, renderPng, runTool: createLoaderToolRunner(timedOut.loader, 'H') }, 'render_png', { source }))
      .toEqual({ ok: false, error: { code: 'RENDER_TIMEOUT', message: `Operation exceeded its ${HOSTED_TOOL_CPU_MS}ms CPU budget` } })
  })

  test.each([
    ['a cpuMs overrun', () => new Error('Worker exceeded CPU time limit.'), 'RENDER_TIMEOUT'],
    ['a memory overrun', () => new Error('Worker exceeded memory limit.'), 'RENDER_MEMORY_LIMIT'],
    ['an isolate failure', () => new Error('internal error'), 'RENDER_WORKER_FAILED'],
    ['a non-OK response', () => new Response('nope', { status: 500 }), 'RENDER_WORKER_FAILED'],
    ['a malformed body', () => okResponse({ unexpected: true }), 'RENDER_WORKER_FAILED'],
    ['an oversized body', () => okResponse({ ok: true, svg: 'x'.repeat(MAX_TOOL_RESULT_BYTES) }), 'RENDER_OUTPUT_LIMIT'],
    ['a hung call past the wall-clock backstop', () => new Promise<never>(() => {}), 'RENDER_TIMEOUT'],
  ] as const)('%s is a structured failure', async (_label, respond, code) => {
    const { loader } = toolLoader(respond)
    const result = await createLoaderToolRunner(loader, 'H', 10)({ name: 'verify', args: { source: 'flowchart LR\n  A --> B' } }, 20)
    expect(result).toMatchObject({ ok: false, error: { code } })
  })
})

describe('per-request CPU allowance', () => {
  test('calls run one at a time, each budget is clamped to what remains, and a spent allowance starts nothing', async () => {
    let now = 0
    let active = 0
    const started: Array<{ name: string; cpuMs: number; active: number }> = []
    const runner = withRequestCpuAllowance(async (request, cpuMs, onStart) => {
      onStart?.(cpuMs)
      started.push({ name: request.name, cpuMs, active: ++active })
      await Promise.resolve()
      now += 12_000 // each call takes longer than its share
      active--
      return { ok: true }
    }, 30_000, () => now)
    const reported: number[] = []
    const results = await Promise.all(['render_svg', 'verify', 'describe', 'render_ascii'].map(name =>
      runner({ name: name as 'verify', args: {} }, 10_000, cpuMs => reported.push(cpuMs))))
    expect(started).toEqual([
      { name: 'render_svg', cpuMs: 10_000, active: 1 },
      { name: 'verify', cpuMs: 10_000, active: 1 },
      { name: 'describe', cpuMs: 6_000, active: 1 },
    ])
    expect(reported).toEqual([10_000, 10_000, 6_000])
    expect(results.slice(0, 3)).toEqual([{ ok: true }, { ok: true }, { ok: true }])
    expect(results[3]).toMatchObject({ ok: false, error: { code: 'RENDER_TIMEOUT', message: expect.stringContaining('30000ms CPU allowance') } })
  })

  test('over a split runner only isolate calls queue on and draw from the allowance', async () => {
    let now = 0
    const isolated: string[] = []
    const light: HostedToolRequest = { name: 'verify', args: { source: 'flowchart LR\n  A --> B' } }
    const heavy = (tag: string): HostedToolRequest => ({ name: 'verify', args: { source: `flowchart LR\n  ${tag} --> B` } })
    const split = isolateHeavyHostedTools(async request => {
      isolated.push(request.name === 'png_projection' ? request.source : String(request.args.source))
      now += 31_000 // spends the whole allowance
      return { ok: true }
    }, request => request !== light)
    const runner = withRequestCpuAllowanceForIsolate(split, 30_000, () => now)
    expect(await runner(heavy('H1'), 10_000)).toEqual({ ok: true })
    expect(await runner(light, 10_000)).toEqual(runHostedTool(light))
    expect(await runner(heavy('H2'), 10_000)).toMatchObject({ ok: false, error: { code: 'RENDER_TIMEOUT', message: expect.stringContaining('30000ms CPU allowance') } })
    expect(isolated).toEqual(['flowchart LR\n  H1 --> B'])
  })
})

// Hybrid isolate use: only a diagram whose pre-layout cost estimate is heavy
// pays for a Dynamic Worker request. Expectations come from each shape's
// layering, computed by hand: an N × N `&` cartesian puts N² edges in one
// layer gap; a complete DAG on n nodes has Σ(span − 1) = C(n, 3) dummy segments.
describe('hosted isolate only for heavy layout', () => {
  const cartesian = (n: number) => `flowchart TD\n${Array.from({ length: n }, (_, i) => `a${i}`).join(' & ')} --> ${Array.from({ length: n }, (_, i) => `b${i}`).join(' & ')}`
  const completeDag = (n: number) => ['flowchart TD', ...Array.from({ length: n }, (_, i) => Array.from({ length: n - i - 1 }, (_, k) => `n${i} --> n${i + k + 1}`)).flat()].join('\n')
  const stateTable = (n: number) => ['stateDiagram-v2', ...Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => `a${i} --> b${j}`)).flat()].join('\n')
  const call = (source: string): HostedToolRequest => ({ name: 'render_svg', args: { source } })

  test.each([
    ['20 × 20 cartesian: 400 edges in one gap', true, cartesian(20)],
    ['19 × 19 cartesian: 361 edges in one gap', false, cartesian(19)],
    ['complete DAG on 20 nodes: 1,140 dummy segments', true, completeDag(20)],
    ['complete DAG on 18 nodes: 816 dummy segments', false, completeDag(18)],
    ['state transition table 30 × 30: bundle work 900 × 1,800', true, stateTable(30)],
    ['an ordinary flowchart', false, 'flowchart LR\n  A --> B --> C\n  A --> C'],
    ['a sequence diagram (not laid out on ELK)', false, 'sequenceDiagram\n  A->>B: hi'],
    ['unparseable source', false, 'flowchart LR\n  A[unclosed --> B'],
  ] as const)('%s (isolate: %p)', (_name, heavy, source) => {
    expect(hostedToolNeedsIsolate(call(source))).toBe(heavy)
    expect(hostedToolNeedsIsolate({ name: 'png_projection', source, renderOptions: {}, outputOptions: {} as never })).toBe(heavy)
  })

  // mutate and build lay out the diagram their ops produce; their ops
  // declare nodes first, so model order puts every a before every b. 300
  // composites each run start --> Xi --> Yi --> end inside their own scope,
  // with distinct start and end pseudostates: 300 edges per layer gap and no
  // fan of 2. One shared [*] node would give fans of 300 in and out: bundle
  // work 900 × 600 = 540,000.
  const composites = (n: number) => ['stateDiagram-v2', ...Array.from({ length: n }, (_, i) => `state C${i} {\n  [*] --> X${i}\n  X${i} --> Y${i}\n  Y${i} --> [*]\n}`)].join('\n')
  const fanOps = (n: number, from = 0) => [
    ...['a', 'b'].flatMap(side => Array.from({ length: n }, (_, i) => ({ kind: 'add_node', id: `${side}${i}`, label: `${side}${i}` })).filter((_, i) => side === 'b' || i >= from)),
    ...Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => ({ kind: 'add_edge', from: `a${i}`, to: `b${j}` }))).flat(),
  ]
  test.each([
    ['300 composites each with their own [*]', false, call(composites(300))],
    ['mutate adding a 20 × 20 fan to a small flowchart', true, { name: 'mutate', args: { source: 'flowchart TD\n  a0', ops: fanOps(20, 1) } }],
    ['mutate adding one edge to a small flowchart', false, { name: 'mutate', args: { source: 'flowchart TD\n  a0 --> b0', ops: [{ kind: 'add_edge', from: 'b0', to: 'c0' }] } }],
    ['mutate whose ops fail is judged on its source', true, { name: 'mutate', args: { source: cartesian(20), ops: [{ kind: 'remove_node', id: 'missing' }] } }],
    ['build of a 20 × 20 fan', true, { name: 'build', args: { family: 'flowchart', ops: fanOps(20) } }],
    ['build of a 19 × 19 fan', false, { name: 'build', args: { family: 'flowchart', ops: fanOps(19) } }],
  ] as const)('%s (isolate: %p)', (_name, heavy, request) => {
    expect(hostedToolNeedsIsolate(request as HostedToolRequest)).toBe(heavy)
  })

  test('light calls run inline without starting the isolate; heavy calls go to it', async () => {
    const started: string[] = []
    const run = isolateHeavyHostedTools(async request => {
      started.push(request.name === 'png_projection' ? request.source : String(request.args.source))
      return { ok: false, error: { code: 'RENDER_TIMEOUT', message: 'isolate' } }
    })
    const light = call('flowchart LR\n  A --> B')
    expect(await run(light, HOSTED_TOOL_CPU_MS)).toEqual(runHostedTool(light))
    expect(started).toEqual([])
    const heavy = call(cartesian(20))
    expect((await run(heavy, HOSTED_TOOL_CPU_MS)).ok).toBe(false)
    expect(started).toEqual([cartesian(20)])
  })
})
