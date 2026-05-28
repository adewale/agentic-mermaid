// Code Mode sandbox: run agent-supplied TS in a node:vm context.

import vm from 'node:vm'
import * as mermaid from '../agent/index.ts'

export interface ExecuteOptions { timeoutMs?: number }
export interface ExecuteResult { ok: boolean; value?: unknown; logs?: string[]; error?: string }

const SAFE_GLOBALS = {
  JSON, Object, Array, Map, Set, WeakMap, WeakSet, Math, Date,
  String, Number, Boolean, Symbol, RegExp, Error, TypeError, RangeError, Promise,
}

export async function executeInSandbox(code: string, opts: ExecuteOptions = {}): Promise<ExecuteResult> {
  const timeoutMs = opts.timeoutMs ?? 5000
  const logs: string[] = []
  const sandbox = {
    ...SAFE_GLOBALS,
    mermaid,
    console: {
      log: (...a: unknown[]) => logs.push(a.map(str).join(' ')),
      error: (...a: unknown[]) => logs.push(a.map(str).join(' ')),
      warn: (...a: unknown[]) => logs.push(a.map(str).join(' ')),
    },
  }
  const context = vm.createContext(sandbox, { name: 'agentic-mermaid-codemode', microtaskMode: 'afterEvaluate' })
  // Try expression form first; if it throws a SyntaxError at RUN-TIME (bun's
  // vm.Script is lazy — compile succeeds, body parses on first eval), fall
  // through to the statement form. Real thrown values, timeouts, and
  // isolation breaches propagate as failures without retry.
  const wraps = expressionFirstWraps(code)
  let result: unknown
  let runErr: Error | null = null
  for (const wrapped of wraps) {
    let script: vm.Script
    try { script = new vm.Script(wrapped, { filename: 'codemode.ts' }) }
    catch (e) { runErr = e as Error; continue }
    try {
      result = await withTimeout(script.runInContext(context, { timeout: timeoutMs }) as Promise<unknown>, timeoutMs)
      runErr = null
      break
    } catch (e) {
      runErr = e as Error
      if (e instanceof SyntaxError || /SyntaxError/.test(String(e))) continue
      break
    }
  }
  if (runErr) return { ok: false, error: runErr.message, logs }

  // `undefined` isn't valid JSON; promote it to null so code with no explicit
  // return value still produces ok:true with a well-defined payload.
  if (result === undefined) return { ok: true, value: null, logs }
  // Functions / symbols / other non-JSON values: JSON.stringify returns
  // undefined for them. Treat the same as a missing value (null) rather
  // than calling JSON.parse('undefined').
  const stringified = JSON.stringify(result, jsonReplacer)
  if (stringified === undefined) return { ok: true, value: null, logs }
  try { return { ok: true, value: JSON.parse(stringified), logs } }
  catch (e) { return { ok: false, error: `non-serializable: ${(e as Error).message}`, logs } }
}

/**
 * Generate candidate wrappings in order of preference: expression form first
 * (handles bare expressions including objects/arrows/templates), then
 * statement form (handles multi-statement bodies with `return` etc.). The
 * first that compiles wins. Always async-IIFE so `await` works at "top level".
 */
function expressionFirstWraps(code: string): string[] {
  const t = code.trim()
  // Special case: explicit async arrow / function — invoke directly.
  if (/^async\s*\(.*?\)\s*=>/.test(t) || /^async\s+function/.test(t)) {
    return [`(async () => { return await (${t})() })()`]
  }
  const stripped = t.replace(/;\s*$/, '') // drop a single trailing semicolon
  return [
    // Expression form: forces expression context so {a:1}, (x=>x), `a\nb`,
    // ternaries, multi-line calls all parse correctly.
    `(async () => { return (\n${stripped}\n) })()`,
    // Statement form: for code with explicit returns, multiple statements,
    // declarations, etc.
    `(async () => { ${code} })()`,
  ]
}
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const t = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms) })
  return Promise.race([p, t]).finally(() => clearTimeout(timer))
}
function str(v: unknown): string {
  if (typeof v === 'string') return v
  try { return JSON.stringify(v, jsonReplacer) } catch { return String(v) }
}
function jsonReplacer(_k: string, v: unknown): unknown {
  if (v instanceof Map) return Object.fromEntries(v)
  if (v instanceof Set) return Array.from(v)
  return v
}
