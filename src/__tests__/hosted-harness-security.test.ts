// Security regression tests for the hosted Code Mode isolate harness
// (src/mcp/harness-runtime.ts + dynamic-harness.ts). A public, unauthenticated
// endpoint runs agent JS in a dynamic worker; the isolate config
// (globalOutbound:null, empty env, no bindings, cpuMs) is the security
// boundary, and these layers are the defense-in-depth a wrapper breakout
// must not defeat:
//   1. the parenthesized wrap makes static import / statement injection a
//      SyntaxError (so agent code cannot inject `import ... from
//      'cloudflare:sockets'` into top-level module scope);
//   2. hardenIsolateGlobals() strips capability globals before user.js runs,
//      so even a comma+IIFE breakout sees no fetch/caches/crypto.
//
// These pin the containment discovered in the PR-94 security audit.

import { describe, expect, test } from 'bun:test'
import {
  userModuleSources, neutralizeGlobalsOn, runUserCode,
  NEUTRALIZED_ISOLATE_GLOBALS, MAX_LOG_BYTES,
} from '../mcp/harness-runtime.ts'

async function importDefault(src: string): Promise<unknown> {
  const m = await import(`data:text/javascript;base64,${btoa(unescape(encodeURIComponent(src)))}`)
  return (m as { default: unknown }).default
}

describe('wrapper breakout: import / statement injection is a SyntaxError', () => {
  // Each payload closes the harness function early and tries to inject
  // top-level module code. With the parenthesized wrap they must fail to
  // compile (rejected import), not run injected top-level code.
  const injections = [
    ["static import of a workerd built-in", "return 1 } ; import { connect } from 'cloudflare:sockets' ; function _p(){ "],
    ["static import of node:crypto", "0 } ; import * as H from 'node:crypto' ; function _p(){ "],
    ["semicolon top-level statement", "0 } ; globalThis.__leak__ = 1 ; ("],
    ["export injection", "0 } ; export const x = 1 ; function _p(){ "],
  ] as const

  for (const [label, code] of injections) {
    test(label, async () => {
      const { expr, stmt } = userModuleSources(code)
      // Both wrap forms must reject (fail to compile) — no injected code runs.
      await expect(importDefault(expr)).rejects.toBeDefined()
      await expect(importDefault(stmt)).rejects.toBeDefined()
    })
  }

  test('legitimate code of every shape still compiles and runs', async () => {
    const cases: Array<[string, boolean]> = [
      ['1 + 1', true], ['{ answer: 42 }', true], ['const x = 2; return x * 21', false],
      ["mermaid.parseMermaid('flowchart LR\\n A --> B').ok", true],
    ]
    for (const [code, useExpr] of cases) {
      const w = userModuleSources(code)
      const fn = await importDefault(useExpr ? w.expr : w.stmt)
      expect(typeof fn).toBe('function')
    }
  })
})

describe('neutralizeGlobalsOn strips capability globals', () => {
  // Applied to a throwaway target so the real test-process globals are never
  // permanently clobbered. The real-isolate application (hardenIsolateGlobals
  // on the live globalThis, then rendering) is covered by website/e2e-mcp.sh.
  test('every named capability global becomes undefined and cannot be reassigned', () => {
    const target: Record<string, unknown> = {}
    for (const name of NEUTRALIZED_ISOLATE_GLOBALS) target[name] = () => 'REAL'
    const err: { prepareStackTrace?: unknown } = { prepareStackTrace: () => 'leak' }
    neutralizeGlobalsOn(target, err)
    for (const name of NEUTRALIZED_ISOLATE_GLOBALS) {
      expect(target[name]).toBeUndefined()
      // non-configurable/non-writable: a breakout cannot restore the capability
      expect(() => { (target as Record<string, unknown>)[name] = () => 'restored' }).toThrow()
    }
    expect(err.prepareStackTrace).toBeUndefined()
  })

  test('fetch/caches/crypto are in the neutralized set (network + ambient capability)', () => {
    for (const n of ['fetch', 'caches', 'crypto']) {
      expect(NEUTRALIZED_ISOLATE_GLOBALS as readonly string[]).toContain(n)
    }
  })
})

describe('log cap bounds a single oversized line', () => {
  test('one huge console.log is truncated to the byte budget, not returned whole', async () => {
    const fn = await importDefault(userModuleSources("console.log('x'.repeat(5_000_000)); return 1").stmt)
    const r = runUserCode(fn)
    expect(r.ok).toBe(true)
    const logBytes = r.logs!.reduce((n, l) => n + l.length, 0)
    // total logs stay within the cap + one truncation marker, not ~5MB
    expect(logBytes).toBeLessThanOrEqual(MAX_LOG_BYTES + 128)
    expect(r.logs!.some(l => l.includes('truncated'))).toBe(true)
  })
})
