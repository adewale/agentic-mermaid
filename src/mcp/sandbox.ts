// ============================================================================
// Code Mode sandbox: run agent-supplied TS in a node:vm context.
// ============================================================================

import vm from 'node:vm'
import * as mermaid from '../agent/index.ts'

export interface ExecuteOptions {
  timeoutMs?: number
}

export interface ExecuteResult {
  ok: boolean
  value?: unknown
  logs?: string[]
  error?: string
}

const SAFE_GLOBALS = {
  JSON, Object, Array, Map, Set, WeakMap, WeakSet,
  Math, Date, String, Number, Boolean, Symbol, RegExp,
  Error, TypeError, RangeError, Promise,
}

export async function executeInSandbox(
  code: string,
  opts: ExecuteOptions = {},
): Promise<ExecuteResult> {
  const timeoutMs = opts.timeoutMs ?? 5000
  const logs: string[] = []

  const sandbox = {
    ...SAFE_GLOBALS,
    mermaid,
    console: {
      log: (...args: unknown[]) => logs.push(args.map(stringify).join(' ')),
      error: (...args: unknown[]) => logs.push(args.map(stringify).join(' ')),
      warn: (...args: unknown[]) => logs.push(args.map(stringify).join(' ')),
    },
  }

  const context = vm.createContext(sandbox, {
    name: 'agentic-mermaid-codemode',
    microtaskMode: 'afterEvaluate',
  })

  const wrapped = `(async () => { ${ensureReturn(code)} })()`

  let script: vm.Script
  try {
    script = new vm.Script(wrapped, { filename: 'codemode.ts' })
  } catch (e) {
    return { ok: false, error: `compile: ${(e as Error).message}` }
  }

  let result: unknown
  try {
    const p = script.runInContext(context, { timeout: timeoutMs }) as Promise<unknown>
    result = await withTimeout(p, timeoutMs)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), logs }
  }

  let safe: unknown
  try {
    safe = JSON.parse(JSON.stringify(result, jsonReplacer))
  } catch (e) {
    return { ok: false, error: `non-serializable: ${(e as Error).message}`, logs }
  }

  return { ok: true, value: safe, logs }
}

function ensureReturn(code: string): string {
  const trimmed = code.trim()
  if (/^async\s*\(.*?\)\s*=>/.test(trimmed) || /^async\s+function/.test(trimmed)) {
    return `return await (${trimmed})()`
  }
  if (/(^|\n)\s*return\s/.test(trimmed)) return trimmed
  return trimmed
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeoutP = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
  })
  return Promise.race([p, timeoutP]).finally(() => clearTimeout(timer))
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, jsonReplacer)
  } catch {
    return String(v)
  }
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries(value)
  if (value instanceof Set) return Array.from(value)
  return value
}
