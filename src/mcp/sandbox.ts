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
  const wrapped = `(async () => { ${ensureReturn(code)} })()`

  let script: vm.Script
  try { script = new vm.Script(wrapped, { filename: 'codemode.ts' }) }
  catch (e) { return { ok: false, error: `compile: ${(e as Error).message}` } }

  let result: unknown
  try { result = await withTimeout(script.runInContext(context, { timeout: timeoutMs }) as Promise<unknown>, timeoutMs) }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e), logs } }

  try { return { ok: true, value: JSON.parse(JSON.stringify(result, jsonReplacer)), logs } }
  catch (e) { return { ok: false, error: `non-serializable: ${(e as Error).message}`, logs } }
}

function ensureReturn(code: string): string {
  const t = code.trim()
  if (/^async\s*\(.*?\)\s*=>/.test(t) || /^async\s+function/.test(t)) return `return await (${t})()`
  return t
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
