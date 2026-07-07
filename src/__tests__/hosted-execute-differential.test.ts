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
// Documented divergences (asserted explicitly at the bottom, not hidden):
//  1. Sloppy-mode implicit globals (`x = 1`) work in the vm context but throw
//     in strict ES modules.
//  2. Timeout wording differs (vm wall-clock timeout vs isolate cpuMs budget).

import { describe, expect, test } from 'bun:test'
import { executeInSandbox, type ExecuteResult } from '../mcp/sandbox.ts'
import { unsupportedCodeReason } from '../mcp/facade.ts'
import { runUserCode, userModuleSources, formatHarnessError, MAX_LOG_ENTRIES, LOGS_TRUNCATED_MARKER } from '../mcp/harness-runtime.ts'

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

const PARSE = "const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')"

// Each case must produce identical results through both implementations.
const EQUIVALENT_CASES: Array<[label: string, code: string]> = [
  ['bare arithmetic expression', '1 + 1'],
  ['bare object literal', '{ answer: 42 }'],
  ['multi-statement body with return', 'const x = 2; return x * 21'],
  ['no explicit return promotes undefined to null', 'const unused = 1'],
  ['console coercion of strings and objects', "console.log('hi', { x: 1 }, [1, 'two']); console.warn(7); return 'done'"],
  ['SDK parse ok flag', `${PARSE}; return r.ok`],
  ['SDK parse → narrow → serialize round trip', `${PARSE}; const f = mermaid.asFlowchart(r.value); return mermaid.serializeMermaid(f)`],
  ['SDK mutate adds a node', `${PARSE}; const m = mermaid.mutate(r.value, { kind: 'add_node', id: 'C', label: 'New' }); return { ok: m.ok, source: m.ok ? mermaid.serializeMermaid(m.value) : null }`],
  ['SDK render through execute', `${PARSE}; return mermaid.renderMermaidSVG(r.value).length`],
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
  ['template interpolation is rejected by the pre-screen', 'return `x${1}`'],
  ['WebAssembly is rejected by the pre-screen', 'return WebAssembly'],
  ['unparseable code errors in both', 'return ) === ('],
]

describe('hosted execute ≡ vm sandbox', () => {
  for (const [label, code] of EQUIVALENT_CASES) {
    test(label, async () => {
      const local = await executeInSandbox(code)
      const hosted = await executeHosted(code)
      expect(hosted.ok).toBe(local.ok)
      expect(hosted.value).toEqual(local.value as never)
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
      expect(r.error).toContain('must come from mermaid.parseMermaid(...)')
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

describe('documented divergences from the vm sandbox', () => {
  test('hosted log spam truncates at the cap; vm logs are unbounded', async () => {
    const code = 'for (let i = 0; i < 2000; i++) console.log("line", i); return 1'
    const local = await executeInSandbox(code)
    const hosted = await executeHosted(code)
    expect(local.logs).toHaveLength(2000)
    expect(hosted.ok).toBe(true)
    expect(hosted.logs).toHaveLength(MAX_LOG_ENTRIES + 1)
    expect(hosted.logs![hosted.logs!.length - 1]).toBe(LOGS_TRUNCATED_MARKER)
  })

  test('hosted results are capped at MAX_RESULT_BYTES; vm results are unbounded', async () => {
    const code = 'return "x".repeat(3000000)'
    const local = await executeInSandbox(code)
    const hosted = await executeHosted(code)
    expect(local.ok).toBe(true)
    expect(hosted.ok).toBe(false)
    expect(hosted.error).toContain('exceeded')
    expect(hosted.error).toContain('bytes')
  })

  test('sloppy-mode implicit globals: vm allows, strict modules throw', async () => {
    const code = 'x = 1; return x'
    const local = await executeInSandbox(code)
    const hosted = await executeHosted(code)
    expect(local).toEqual({ ok: true, value: 1, logs: [] })
    expect(hosted.ok).toBe(false)
    expect(hosted.error).toContain('x')
  })
})

/** Syntax and JSON-serialization messages come from the engine, not from us. */
function isEngineAuthored(error: string): boolean {
  return error.startsWith('non-serializable:') || /unexpected|expected|parse|token|circular/i.test(error)
}
