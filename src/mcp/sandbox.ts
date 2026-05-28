// ============================================================================
// Code Mode sandbox: run agent-supplied TS in a node:vm context with only
// `mermaid.*` and a small allowlist of built-ins reachable. Async-arrow body
// pattern, matching Cloudflare's @cloudflare/codemode shape.
//
// The library is pure-functional so the sandbox concern collapses to "don't
// let the agent's TS escape to filesystem/network/process or burn forever."
// ============================================================================

import vm from 'node:vm'
import * as mermaid from '../agent/index.ts'

export interface ExecuteOptions {
  /** Hard timeout in ms. Default: 5000. */
  timeoutMs?: number
}

export interface ExecuteResult {
  ok: boolean
  /** The async arrow's return value (must be JSON-serializable). */
  value?: unknown
  /** Captured console output (stringified args, newline-joined per call). */
  logs?: string[]
  /** Error message if ok=false. */
  error?: string
}

const SAFE_GLOBALS = {
  // structured-clone-friendly built-ins
  JSON,
  Object,
  Array,
  Map,
  Set,
  WeakMap,
  WeakSet,
  Math,
  Date,
  String,
  Number,
  Boolean,
  Symbol,
  RegExp,
  Error,
  TypeError,
  RangeError,
  Promise,
}

/**
 * Run an async arrow `() => ...` against the typed `mermaid.*` SDK in a
 * sandboxed vm context. Returns the arrow's resolved value plus captured
 * console output. Code that throws or times out fails with a structured
 * error.
 */
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
    // No microtask queue surprises; everything resolves through the
    // returned promise.
    microtaskMode: 'afterEvaluate',
  })

  // Wrap the user code so the last expression (or a top-level async arrow)
  // is awaited and returned. The Cloudflare convention is an async arrow;
  // we accept either:
  //   async () => { ... return ... }
  //   const x = await mermaid.parse(...); return x
  // by wrapping in an IIFE.
  const wrapped = `(async () => { ${ensureReturn(code)} })()`

  let script: vm.Script
  try {
    script = new vm.Script(wrapped, { filename: 'codemode.ts' })
  } catch (e) {
    return { ok: false, error: `compile: ${(e as Error).message}` }
  }

  let result: unknown
  try {
    const ranPromise = script.runInContext(context, { timeout: timeoutMs }) as Promise<unknown>
    result = await withTimeout(ranPromise, timeoutMs)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg, logs }
  }

  // Ensure the return value is JSON-serializable (this also catches
  // accidental Map/Set leakage from the agent's code).
  let safe: unknown
  try {
    safe = JSON.parse(JSON.stringify(result, jsonReplacer))
  } catch (e) {
    return {
      ok: false,
      error: `non-serializable return value: ${(e as Error).message}`,
      logs,
    }
  }

  return { ok: true, value: safe, logs }
}

function ensureReturn(code: string): string {
  // If the code is itself an async arrow, invoke it.
  const trimmed = code.trim()
  if (/^async\s*\(.*?\)\s*=>/.test(trimmed) || /^async\s+function/.test(trimmed)) {
    return `return await (${trimmed})()`
  }
  // If it already has a top-level return, leave it alone.
  if (/(^|\n)\s*return\s/.test(trimmed)) {
    return trimmed
  }
  // Otherwise treat the whole block as statements with the last expression
  // as the implicit return.
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
