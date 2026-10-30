// Differential tests: the local node:vm sandbox (executeInSandbox) is the
// reference implementation for Code Mode; the hosted path — pre-screen, module
// wrapping (userModuleSources), expression-first import fallback, runUserCode —
// must produce the same { ok, value, logs, error } surface for the same code.
//
// The hosted path is exercised exactly as the Worker + dynamic-harness run it,
// with one substitution: modules load through bun `data:` imports instead of
// the Worker Loader's per-isolate module registry (module parse/eval semantics
// are the engine's either way). The real loader wiring is covered by the
// wrangler e2e (website/e2e-mcp.sh).
//
// Both runtimes use strict function-body semantics. Timeout wording and
// host-owned render security still differ by execution environment.

import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { executeInSandbox, type ExecuteResult } from '../mcp/sandbox.ts'
import { unsupportedCodeReason } from '../mcp/facade.ts'
import { runUserCode, userModuleSources, formatHarnessError, MAX_LOG_ENTRIES, MAX_RESULT_BYTES, LOGS_TRUNCATED_MARKER } from '../mcp/harness-runtime.ts'
import {
  renderMermaidASCIIWithReceipt,
  renderMermaidSVGWithReceipt,
  verifyNoExternalRefs,
} from '../index.ts'
import { layoutMermaidWithReceipt } from '../agent/core.ts'
import { handleRequest } from '../mcp/server.ts'
import { handleHostedRequest } from '../mcp/hosted-server.ts'
import type { JsonRpcRequest, JsonRpcResponse } from '../mcp/protocol.ts'
import { createLoaderExecute, type WorkerLoaderBinding } from '../../website/src/execute-loader.ts'

// Memoized: re-importing an identical data: URL deadlocks under `bun test`
// (fine in plain bun), and the loader caches per-id isolates anyway.
const importedModules = new Map<string, Promise<unknown>>()
async function importUserModule(source: string): Promise<unknown> {
  if (!importedModules.has(source)) {
    importedModules.set(source, import(`data:text/javascript;base64,${btoa(unescape(encodeURIComponent(source)))}`).then(m => (m as { default: unknown }).default))
  }
  return importedModules.get(source)!
}

/** The hosted execute path as the Worker + harness compose it. */
async function executeHosted(code: string): Promise<ExecuteResult> {
  const reason = unsupportedCodeReason(code)
  if (reason) return { ok: false, error: reason, logs: [] }
  const { expr, stmt } = userModuleSources(code)
  let fn: unknown
  try {
    fn = await importUserModule(expr)
  } catch {
    try {
      fn = await importUserModule(stmt)
    } catch (e) {
      return { ok: false, error: formatHarnessError(e), logs: [] }
    }
  }
  return runUserCode(fn)
}

const PARSE = "const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')"

// Each case must produce identical results through both implementations.
const EQUIVALENT_CASES: Array<[label: string, code: string, expectedValue?: unknown]> = [
  ['bare arithmetic expression', '1 + 1'],
  ['new.target is undefined in a normal call', 'new.target === undefined', true],
  ['new.target in a statement body', 'const target = new.target; target === undefined', true],
  ['strict this is undefined', 'this === undefined', true],
  ['wrapper arguments match the public SDK parameters', 'arguments.length === 2 && arguments[0] === mermaid && arguments[1] === console', true],
  ['ordinary nested functions retain their own arguments', 'function count() { return arguments.length }; count(1, 2, 3)', 3],
  ['constructor new.target remains local to its constructor', 'class C { constructor() { this.ok = new.target === C } }; new C().ok', true],
  ['return followed by a newline follows automatic semicolon insertion', 'return\n42', null],
  ['trailing comment stays outside a captured expression', 'const value = 42; value // comment\n;;', 42],
  ['bare object literal', '{ answer: 42 }'],
  ['multi-statement body with return', 'const x = 2; return x * 21'],
  ['final expression before empty statements and a comment', 'const x = 41; x + 1;; // done', 42],
  ['no explicit return promotes undefined to null', 'const unused = 1'],
  ['console coercion of strings and objects', "console.log('hi', { x: 1 }, [1, 'two']); console.warn(7); return 'done'"],
  ['SDK parse ok flag', `${PARSE}; return r.ok`],
  ['SDK parse → narrow → serialize round trip', `${PARSE}; const f = mermaid.asFlowchart(r.value); return mermaid.serializeMermaid(f)`],
  ['SDK mutate adds a node', `${PARSE}; const m = mermaid.mutate(r.value, { kind: 'add_node', id: 'C', label: 'New' }); return { ok: m.ok, source: m.ok ? mermaid.serializeMermaid(m.value) : null }`],
  ['SDK render through execute', `${PARSE}; return mermaid.renderMermaidSVG(r.value, { security: 'strict', embedFontImport: false }).length`],
  ['SDK render config callback survives the façade', `const warnings = []; mermaid.renderMermaidSVG('stateDiagram-v2\\n  A --> B', { mermaidConfig: { state: { titleTopMargin: 10 } }, onConfigDiagnostic: d => warnings.push(d.field) }); return warnings`],
  ['SDK verify warnings shape', `${PARSE}; const v = mermaid.verifyMermaid(r.value); return { ok: v.ok, warnings: v.warnings.length }`],
  ['returning a diagram marshals to the canonical envelope', `${PARSE}; return r.value`],
  ['returning a mutate Result marshals to the canonical envelope', `${PARSE}; return mermaid.mutate(mermaid.asFlowchart(r.value), { kind: 'add_node', id: 'C', label: 'New' })`],
  ['returning a verify result is a prescriptive non-serializable error', `${PARSE}; return mermaid.verifyMermaid(r.value)`],
  ['verify rejects untrusted diagram objects', "return mermaid.verifyMermaid({ body: {}, canonicalSource: 'x' }).ok"],
  ['SDK results are read-only', `${PARSE}; r.value.meta.comments.push('x'); return 1`],
  ['user exception surfaces its message', "throw new Error('boom')"],
  ['non-Error throw surfaces via String()', 'throw 42'],
  ['Map results normalize to plain objects', "const m = new Map(); m.set('a', 1); return m"],
  ['Set results normalize to arrays', 'return new Set([1, 2, 2])'],
  ['function results promote to null like undefined', 'return () => 1'],
  ['circular structures are non-serializable', 'const a = {}; a.self = a; return a'],
  ['async is rejected by the pre-screen', "await fetch('https://example.com')"],
  ['Promise mention is rejected by the pre-screen', 'return Promise.resolve(1)'],
  ['postfix division cannot hide a Promise reference', 'let x = 8; return x++ / Promise / 2'],
  ['postfix division cannot hide dynamic import', 'let x = 8; return x++ / import("cloudflare:sockets") / 2'],
  ['regex after a control-flow head remains literal data', 'if (true) /Promise/.test("Promise"); return 1'],
  ['template interpolation is rejected by the pre-screen', 'return `x${1}`'],
  ['WebAssembly is rejected by the pre-screen', 'return WebAssembly'],
  ['unparseable code errors in both', 'return ) === ('],
]

describe('hosted execute ≡ vm sandbox', () => {
  for (const code of ['with ({ x: 1 }) { return x }', 'function f(a, a) { return a }; f(1, 2)', 'return 010', 'return arguments.callee']) {
    test(`strict-mode rejection: ${code}`, async () => {
      for (const result of [await executeInSandbox(code), await executeHosted(code)]) expect(result.ok).toBe(false)
    })
  }
  test('generated bodies capture the expected expression across grammar boundaries', async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: -1000, max: 1000 }),
      fc.constantFrom('plain', 'function', 'arrow', 'loop', 'newTarget'),
      fc.integer({ min: 0, max: 5 }), fc.constantFrom('', '// trailing', '/* trailing */', '// newline\n'),
      async (a, b, form, emptyStatements, comment) => {
        const expressions = {
          plain: `const a = ${a}; const b = ${b}; a + b`,
          function: `function sum(a, b) { return a + b }; sum(${a}, ${b})`,
          arrow: `const sum = (a, b) => a + b; sum(${a}, ${b})`,
          loop: `let sum = ${a}; for (const n of [${b}]) { sum += n }; sum`,
          newTarget: `const target = new.target; target === undefined ? ${a} + ${b} : -999999`,
        }
        const code = `"use strict";\n${expressions[form]};${';'.repeat(emptyStatements)} ${comment}`
        for (const result of [await executeInSandbox(code), await executeHosted(code)]) {
          expect(result.ok).toBe(true)
          expect(result.value).toBe(a + b)
          expect(result.logs).toEqual([])
        }
      },
    ), fcParameters({ numRuns: 150 }))
  })
  for (const [label, code, expectedValue] of EQUIVALENT_CASES) {
    test(label, async () => {
      const local = await executeInSandbox(code)
      const hosted = await executeHosted(code)
      expect(hosted.ok).toBe(local.ok)
      expect(hosted.value).toEqual(local.value as never)
      if (expectedValue !== undefined) expect(hosted.value).toEqual(expectedValue as never)
      expect(hosted.logs).toEqual(local.logs ?? [])
      // Error strings must agree except for engine-authored messages
      // (syntax/serialization errors), where both sides still must fail with
      // the same error class prefix.
      if (local.ok) {
        expect(hosted.error).toBeUndefined()
      } else if (local.error && isEngineAuthored(local.error)) {
        expect(typeof hosted.error).toBe('string')
      } else {
        expect(hosted.error).toBe(local.error!)
      }
    })
  }

  test('read-only SDK violation carries the mutate guidance verbatim', async () => {
    const code = `${PARSE}; r.value.meta.comments.push('x'); return 1`
    const [local, hosted] = [await executeInSandbox(code), await executeHosted(code)]
    for (const r of [local, hosted]) {
      expect(r.ok).toBe(false)
      expect(r.error).toBe('Code Mode SDK results are read-only; use mermaid.mutate(...) for structured edits')
    }
  })

  test('untrusted diagram rejection names the parse entry point in both', async () => {
    const code = "return mermaid.verifyMermaid({ body: {}, canonicalSource: 'x' }).ok"
    const [local, hosted] = [await executeInSandbox(code), await executeHosted(code)]
    for (const r of [local, hosted]) {
      expect(r.ok).toBe(false)
      expect(r.error).toContain('must come from mermaid.parseRegisteredMermaid(...)')
    }
  })

  test('SDK arrays answer every non-mutating Array method exactly like a plain copy', async () => {
    // Oracle: the engine's own Array.prototype applied to a JSON copy of the
    // same SDK array, inside the same sandbox. Element arguments are named by
    // index so identity searches resolve within each array's own world. The
    // object array is meta.comments; the string array is its .map result
    // (a re-hardened array), which also covers duplicates and ''.
    const index = fc.integer({ min: -4, max: 6 })
    const element = fc.oneof(fc.record({ el: fc.integer({ min: 0, max: 5 }) }), fc.constantFrom('a', 'a,b', '', 'zz'))
    const call = fc.oneof(
      fc.record({ m: fc.constantFrom('includes', 'indexOf', 'lastIndexOf'), args: fc.oneof(fc.tuple(element), fc.tuple(element, index)) }),
      fc.record({ m: fc.constantFrom('at', 'flat'), args: fc.tuple(index) }),
      fc.record({ m: fc.constantFrom('slice', 'toSpliced'), args: fc.array(index, { maxLength: 2 }) }),
      fc.record({ m: fc.constant('with'), args: fc.tuple(index, element) }),
      fc.record({ m: fc.constant('join'), args: fc.oneof(fc.constant([]), fc.tuple(fc.constantFrom('', '|', ', '))) }),
      fc.record({ m: fc.constant('concat'), args: fc.array(fc.oneof(element, fc.constant({ self: true }), fc.constant(['q', ['r']])), { maxLength: 3 }) }),
      fc.record({ m: fc.constantFrom('toString', 'toLocaleString', 'toReversed', 'entries', 'keys', 'values'), args: fc.constant([]) }),
      fc.record({ m: fc.constantFrom('map', 'filter', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap', 'forEach', 'reduce', 'reduceRight', 'toSorted'), args: fc.constant([]) }),
    )
    await fc.assert(fc.asyncProperty(
      fc.array(fc.constantFrom('a', 'b', 'a,b', '', 'x y'), { maxLength: 5 }),
      fc.array(call, { minLength: 1, maxLength: 8 }),
      async (comments, calls) => {
        const source = ['flowchart TD', ...comments.map(text => `  %%${text ? ` ${text}` : ''}`), '  A --> B'].join('\n')
        const code = `
          const objects = mermaid.parseRegisteredMermaid(${JSON.stringify(source)}).value.meta.comments
          const strings = objects.map(comment => comment.text)
          const callbacks = {
            map: [(x, i) => [i, x]], filter: [(x, i) => (JSON.stringify(x).length + i) % 2 === 0],
            some: [x => JSON.stringify(x).includes('b')], every: [x => JSON.stringify(x).length > 2],
            find: [x => JSON.stringify(x).includes('a')], findIndex: [x => JSON.stringify(x).includes('a')],
            findLast: [x => JSON.stringify(x).includes('a')], findLastIndex: [x => JSON.stringify(x).includes('a')],
            flatMap: [(x, i) => [x, [i]]], forEach: [() => {}], reduce: [(a, x) => a + JSON.stringify(x), '>'],
            reduceRight: [(a, x) => a + JSON.stringify(x), '<'],
            toSorted: [(a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0],
          }
          const outcome = (array, call) => {
            const resolve = arg => arg && typeof arg === 'object' && !Array.isArray(arg) ? (arg.self ? array : array[arg.el]) : arg
            try {
              const args = callbacks[call.m] ?? call.args.map(resolve)
              let value = array[call.m](...args)
              if (call.m === 'entries' || call.m === 'keys' || call.m === 'values') value = [...value]
              return { value: JSON.stringify(value) }
            } catch (e) {
              return { threw: true }
            }
          }
          const sides = { sdk: {}, plain: {} }
          for (const [name, array] of [['objects', objects], ['strings', strings]]) {
            const plain = JSON.parse(JSON.stringify(array))
            sides.sdk[name] = { length: array.length, outcomes: ${JSON.stringify(calls)}.map(call => outcome(array, call)) }
            sides.plain[name] = { length: plain.length, outcomes: ${JSON.stringify(calls)}.map(call => outcome(plain, call)) }
          }
          return sides`
        for (const result of [await executeInSandbox(code), await executeHosted(code)]) {
          expect(result.error).toBeUndefined()
          const { sdk, plain } = result.value as { sdk: { strings: { length: number } }; plain: unknown }
          expect(sdk.strings.length).toBe(comments.length)
          expect(sdk).toEqual(plain as never)
        }
      },
    ), fcParameters({ numRuns: 40 }))
  })

  test('a failed narrowing passed on to any diagram verb gets the narrower guidance, not an engine TypeError', async () => {
    // asSequence(flowchart) is null; every verb that takes a diagram must say
    // why the input is missing instead of dereferencing it.
    const verbs = ['mutate', 'mutatePreservingSource', 'verifyMermaid', 'analyzeMermaid', 'describeMermaidFacts', 'checkMermaid', 'serializeMermaid', 'asFlowchart', 'renderMermaidSVG', 'renderMermaidASCII', 'layoutMermaidWithReceipt']
    const code = `${PARSE}
      const narrowed = mermaid.asSequence(r.value)
      const out = { narrowed }
      for (const verb of ${JSON.stringify(verbs)}) {
        for (const [label, input] of [['null', narrowed], ['undefined', undefined]]) {
          try { mermaid[verb](input, { kind: 'add_node', id: 'X' }); out[verb + ':' + label] = 'returned' }
          catch (e) { out[verb + ':' + label] = e.message }
        }
      }
      return out`
    for (const r of [await executeInSandbox(code), await executeHosted(code)]) {
      expect(r.ok).toBe(true)
      const { narrowed, ...messages } = r.value as Record<string, unknown>
      expect(narrowed).toBeNull()
      expect(Object.keys(messages)).toHaveLength(verbs.length * 2)
      for (const [key, message] of Object.entries(messages)) {
        const [verb, label] = key.split(':')
        expect({ key, message }).toEqual({ key, message: expect.stringContaining(`Code Mode ${verb} input is ${label}`) })
        expect({ key, message }).toEqual({ key, message: expect.stringContaining('returns null when d is a different family') })
      }
    }
  })

  test('a returned diagram marshals to the { ok, family, source, verify } envelope in both', async () => {
    const code = `${PARSE}; return r.value`
    for (const r of [await executeInSandbox(code), await executeHosted(code)]) {
      expect(r.ok).toBe(true)
      const v = r.value as { ok: boolean; family: string; source: string; verify: { ok: boolean } }
      expect(v.family).toBe('flowchart')
      expect(v.source).toContain('A --> B')
      expect(v.verify.ok).toBe(true)
      // Pure JSON: the marshalled envelope round-trips losslessly.
      expect(JSON.parse(JSON.stringify(v))).toEqual(v)
    }
  })

  test('a returned verify result fails with the prescriptive plain-data hint in both', async () => {
    const code = `${PARSE}; return mermaid.verifyMermaid(r.value)`
    for (const r of [await executeInSandbox(code), await executeHosted(code)]) {
      expect(r.ok).toBe(false)
      expect(r.error).toContain('non-serializable')
      expect(r.error).toContain('return plain data')
    }
  })
})

describe('hosted execute render policy', () => {
  const source = 'flowchart LR\n  A[Start] --> B[Finish]'
  const expected = renderMermaidSVGWithReceipt(source, {
    security: 'strict',
    embedFontImport: false,
  })

  test('both execute SVG APIs default to the host-owned strict projection', async () => {
    const hosted = await executeHosted(`
      const source = ${JSON.stringify(source)}
      return {
        plain: mermaid.renderMermaidSVG(source),
        artifact: mermaid.renderMermaidSVGWithReceipt(source),
      }
    `)
    expect(hosted.ok).toBe(true)
    const value = hosted.value as { plain: string; artifact: typeof expected }
    expect(value.plain).toBe(expected.svg)
    expect(value.artifact).toEqual(expected)
    expect(verifyNoExternalRefs(value.plain)).toEqual({ ok: true, refs: [] })
    expect(verifyNoExternalRefs(value.artifact.svg)).toEqual({ ok: true, refs: [] })
  })

  test('caller options cannot weaken strict security or re-enable font imports', async () => {
    const hosted = await executeHosted(`
      const source = ${JSON.stringify(source)}
      const weaker = { security: 'default', embedFontImport: true }
      return {
        plain: mermaid.renderMermaidSVG(source, weaker),
        artifact: mermaid.renderMermaidSVGWithReceipt(source, weaker),
      }
    `)
    expect(hosted.ok).toBe(true)
    const value = hosted.value as { plain: string; artifact: typeof expected }
    expect(value.plain).toBe(expected.svg)
    expect(value.artifact).toEqual(expected)
    expect(verifyNoExternalRefs(value.plain)).toEqual({ ok: true, refs: [] })
    expect(verifyNoExternalRefs(value.artifact.svg)).toEqual({ ok: true, refs: [] })
    expect(value.plain).not.toContain('@import')
  })

  test('ASCII and layout use the same host-owned request projection', async () => {
    const hosted = await executeHosted(`
      const source = ${JSON.stringify(source)}
      const weaker = { security: 'default', embedFontImport: true }
      return {
        ascii: mermaid.renderMermaidASCIIWithReceipt(source, weaker),
        layout: mermaid.layoutMermaidWithReceipt(source, weaker),
      }
    `)
    expect(hosted.ok).toBe(true)
    const value = hosted.value as {
      ascii: ReturnType<typeof renderMermaidASCIIWithReceipt>
      layout: ReturnType<typeof layoutMermaidWithReceipt>
    }
    const expectedAscii = renderMermaidASCIIWithReceipt(source, {
      security: 'strict', embedFontImport: false,
    })
    const expectedLayout = layoutMermaidWithReceipt(source, {
      security: 'strict', embedFontImport: false,
    })
    expect(value.ascii).toEqual(JSON.parse(JSON.stringify(expectedAscii)))
    expect(value.layout).toEqual(JSON.parse(JSON.stringify(expectedLayout)))
  })
})

describe('bounded local/hosted Code Mode output', () => {
  test('hosted and local log spam truncate at the shared cap', async () => {
    const code = 'for (let i = 0; i < 2000; i++) console.log("line", i); return 1'
    const local = await executeInSandbox(code)
    const hosted = await executeHosted(code)
    for (const result of [local, hosted]) {
      expect(result.ok).toBe(true)
      expect(result.logs).toHaveLength(MAX_LOG_ENTRIES + 1)
      expect(result.logs![result.logs!.length - 1]).toBe(LOGS_TRUNCATED_MARKER)
    }
  })

  test('hosted and local results reject JSON beyond the shared UTF-8 byte cap', async () => {
    const code = 'return "x".repeat(3000000)'
    const local = await executeInSandbox(code)
    const hosted = await executeHosted(code)
    for (const result of [local, hosted]) {
      expect(result.ok).toBe(false)
      expect(result.error).toContain('exceeded')
      expect(result.error).toContain('bytes')
      expect(result.error).toContain(String(MAX_RESULT_BYTES))
    }
  })

  test('local custom limits count UTF-8 bytes and preserve code points while truncating logs', async () => {
    const result = await executeInSandbox('console.warn("🙂🙂"); return "🙂🙂"', {
      outputLimits: { maxResultBytes: 9, maxLogEntries: 1, maxLogBytes: 5 },
    })
    expect(result.ok).toBe(false) // JSON quotes + two emoji = 10 UTF-8 bytes
    expect(result.logs).toEqual(['🙂', LOGS_TRUNCATED_MARKER])
  })

  test('implicit global writes fail in both strict execution bodies', async () => {
    const code = 'x = 1; return x'
    const local = await executeInSandbox(code)
    const hosted = await executeHosted(code)
    for (const result of [local, hosted]) {
      expect(result.ok).toBe(false)
      expect(result.error).toContain('x')
    }
  })
})

// The execute tool payload as each server returns it. Hosted runs the real
// hosted-server → execute-loader → harness-runtime path; only workerd is
// replaced, by a loader that starts an "isolate" the way dynamic-harness.ts
// does (a module that fails to parse fails the start with workerd's
// SyntaxError wording, which drives the loader's statement-form fallback).
function runningLoader(): WorkerLoaderBinding {
  return {
    get(_id, getCode) {
      return {
        getEntrypoint() {
          return {
            async fetch() {
              const { modules } = await getCode()
              let fn: unknown
              try { fn = await importUserModule(modules['user.js']!) }
              catch (e) { throw new Error(`Uncaught SyntaxError: ${formatHarnessError(e)}`) }
              return new Response(JSON.stringify(runUserCode(fn)), { headers: { 'content-type': 'application/json' } })
            },
          }
        },
      }
    },
  }
}
/** workerd stops an isolate that exhausts cpuMs by failing the call. */
const cpuLimitLoader: WorkerLoaderBinding = {
  get() { return { getEntrypoint() { return { fetch: async () => { throw new Error('Worker exceeded CPU time limit.') } } } } },
}
function executeCall(code: string, timeoutMs: number): JsonRpcRequest {
  return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'execute', arguments: { code, timeoutMs } } }
}
function toolPayload(response: JsonRpcResponse | null): { isError: boolean; payload: any } {
  const result = response?.result as { isError?: boolean; content?: Array<{ text?: string }> } | undefined
  return { isError: result?.isError === true, payload: JSON.parse(result?.content?.[0]?.text ?? 'null') }
}
async function stdioTool(code: string, timeoutMs = 5000) {
  return toolPayload(await handleRequest(executeCall(code, timeoutMs)))
}
async function hostedTool(code: string, timeoutMs = 5000, loader: WorkerLoaderBinding = runningLoader()) {
  return toolPayload(await handleHostedRequest(executeCall(code, timeoutMs), { execute: createLoaderExecute(loader, 'HARNESS') }))
}

describe('execute tool error envelope is one shape on stdio and hosted', () => {
  // Messages are each runner's own wording; the shape and the code are shared.
  const cases: Array<{ label: string; code: string; expected: string; message?: string; timeoutMs?: number; hostedLoader?: WorkerLoaderBinding }> = [
    { label: 'user throw', code: "throw new Error('boom')", expected: 'EXECUTE_FAILED', message: 'boom' },
    { label: 'sync-only pre-screen', code: 'await 1', expected: 'EXECUTE_FAILED', message: 'Code Mode is synchronous; async/await, Promise jobs, finalizers, queueMicrotask, Array.fromAsync, and dynamic import are not supported' },
    { label: 'syntax error', code: 'return ) === (', expected: 'EXECUTE_FAILED' },
    { label: 'non-serializable result', code: 'const a = {}; a.self = a; return a', expected: 'EXECUTE_FAILED' },
    { label: 'time budget exhausted', code: 'while (true) {}', expected: 'EXECUTE_TIMEOUT', timeoutMs: 200, hostedLoader: cpuLimitLoader },
  ]
  for (const { label, code, expected, message, timeoutMs, hostedLoader } of cases) {
    test(label, async () => {
      const channels = { stdio: await stdioTool(code, timeoutMs), hosted: await hostedTool(code, timeoutMs, hostedLoader) }
      for (const [channel, { isError, payload }] of Object.entries(channels)) {
        expect({ channel, isError, ok: payload.ok, logs: payload.logs }).toEqual({ channel, isError: true, ok: false, logs: [] })
        expect({ channel, error: payload.error }).toEqual({
          channel,
          error: { code: expected, message: message ?? expect.any(String) },
        })
      }
    })
  }
})

/** Syntax and JSON-serialization messages come from the engine, not from us. */
function isEngineAuthored(error: string): boolean {
  return error.startsWith('non-serializable:') || /unexpected|expected|parse|token|circular/i.test(error)
}
