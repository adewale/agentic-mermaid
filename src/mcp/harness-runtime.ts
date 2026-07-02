// Hosted Code Mode execution semantics, shared between the dynamic-worker
// harness (dynamic-harness.ts, bundled into the isolate) and the differential
// tests that pin harness behavior against the node:vm sandbox. Runtime-neutral.
//
// The isolate — not this code — is the hosted security boundary
// (`globalOutbound: null`, empty env, cpuMs limits). Everything here exists
// for behavioral parity with sandbox.ts: same hardened facade, same console
// coercion, same result serialization, same error surface.

import { createTracingMermaid } from './facade.ts'
import type { ExecuteResult } from './sandbox.ts'

// Hosted output bounds, enforced at the source (inside the isolate) so a
// log-spamming or huge-result run never builds an unbounded response body;
// the parent's capped read of the isolate response is the backstop. The
// local vm sandbox has no such caps — a documented hosted divergence.
export const MAX_RESULT_BYTES = 2 * 1024 * 1024
export const MAX_LOG_ENTRIES = 1_000
export const MAX_LOG_BYTES = 256 * 1024
export const LOGS_TRUNCATED_MARKER = '…[logs truncated: hosted execute caps console output]'

// The globals sandbox.ts pins to undefined in the vm context, minus the ones
// that are not legal strict-mode parameter names ('constructor' is harmless as
// a shadow anyway; 'eval' cannot be shadowed but workerd bans it at runtime).
// 'globalThis'/'self'/'caches'/'crypto' are extra: the vm context simply never
// had them, and shadowing globalThis also closes off cross-request state in a
// warm isolate for straightforward code.
const SHADOWED_GLOBALS = [
  'Function', 'Promise', 'Atomics', 'SharedArrayBuffer', 'ShadowRealm', 'WebAssembly',
  'queueMicrotask', 'setTimeout', 'setInterval', 'setImmediate',
  'fetch', 'process', 'require', 'Bun', 'Worker', 'MessageChannel', 'MessagePort',
  'AsyncDisposableStack', 'DisposableStack', 'SuppressedError', 'FinalizationRegistry', 'WeakRef',
  'globalThis', 'self', 'caches', 'crypto', 'performance', 'navigator', 'scheduler',
] as const

/**
 * Wrap agent code as the two candidate ES modules the harness tries in order:
 * expression form first (bare expressions, object/arrow/template literals),
 * then statement form (multi-statement bodies with `return`). Mirrors
 * sandbox.ts `expressionFirstWraps`, with the parse test replaced by the
 * import-and-fall-back the harness performs (a module whose only top-level
 * statement is a function declaration can fail import only by failing to
 * parse).
 */
export function userModuleSources(code: string): { expr: string; stmt: string } {
  const params = ['mermaid', 'console', ...SHADOWED_GLOBALS].join(', ')
  const stripped = code.trim().replace(/;\s*$/, '') // drop a single trailing semicolon
  return {
    expr: `export default function (${params}) { return (\n${stripped}\n) }\n`,
    stmt: `export default function (${params}) { ${code} }\n`,
  }
}

/** Coerce a console argument to the string the vm bootstrap would log. */
function coerceLogArg(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    const json = JSON.stringify(v)
    return typeof json === 'string' ? json : String(v)
  } catch {
    try { return String(v) } catch { return '[unprintable]' }
  }
}

/** Mirror of the vm bootstrap's __pi_format_error. */
export function formatHarnessError(err: unknown): string {
  try {
    if (typeof err === 'string') return err
    if (err && (typeof err === 'object' || typeof err === 'function')) {
      const message = (err as { message?: unknown }).message
      if (typeof message === 'string') return message
    }
    return String(err)
  } catch { return 'sandbox error' }
}

const toStringTag = (v: unknown): string => Object.prototype.toString.call(v)

/**
 * Run an already-compiled user function against a fresh hardened facade and
 * serialize its result exactly the way executeInSandbox does: undefined
 * promotes to null, Map/Set normalize to object/array, and anything JSON
 * cannot represent is a `non-serializable:` error. The SDK closes before
 * serialization so getters/proxy traps cannot do late SDK work.
 */
export function runUserCode(fn: unknown): ExecuteResult {
  const logs: string[] = []
  let logBytes = 0
  let logsTruncated = false
  const append = (a: unknown[]) => {
    if (logsTruncated) return
    if (logs.length >= MAX_LOG_ENTRIES || logBytes >= MAX_LOG_BYTES) {
      logsTruncated = true
      logs.push(LOGS_TRUNCATED_MARKER)
      return
    }
    const line = a.map(coerceLogArg).join(' ')
    logBytes += line.length
    logs.push(line)
  }
  const consoleObj = Object.freeze({
    log: (...a: unknown[]) => { append(a) },
    error: (...a: unknown[]) => { append(a) },
    warn: (...a: unknown[]) => { append(a) },
  })
  let closed = false
  const mermaid = createTracingMermaid(undefined, message => new Error(String(message)), () => closed)
  if (typeof fn !== 'function') return { ok: false, error: 'sandbox error: user module did not export a function', logs }

  let result: unknown
  try {
    result = fn(mermaid, consoleObj)
  } catch (e) {
    closed = true
    return { ok: false, error: formatHarnessError(e), logs }
  }
  closed = true

  if (result === undefined) return { ok: true, value: null, logs }
  let stringified: string | undefined
  try {
    stringified = JSON.stringify(result, (_k, v) => {
      const tag = toStringTag(v)
      if (tag === '[object Map]') return Object.fromEntries(v as Map<unknown, unknown>)
      if (tag === '[object Set]') return Array.from(v as Set<unknown>)
      return v
    })
  } catch (e) {
    return { ok: false, error: `non-serializable: ${formatHarnessError(e)}`, logs }
  }
  if (stringified === undefined) return { ok: true, value: null, logs }
  if (stringified.length > MAX_RESULT_BYTES) {
    return { ok: false, error: `sandbox result exceeded ${MAX_RESULT_BYTES} bytes; reduce console output or returned data`, logs }
  }
  try { return { ok: true, value: JSON.parse(stringified), logs } }
  catch (e) { return { ok: false, error: `non-serializable: ${e instanceof Error ? e.message : 'invalid JSON'}`, logs } }
}
