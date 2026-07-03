// Code Mode sandbox: run agent-supplied JavaScript in a node:vm context.

import vm from 'node:vm'
import { createTracingMermaid, expressionFirstWraps, unsupportedCodeReason } from './facade.ts'

import type { ExecutionTraceCall } from './facade.ts'
export type { ExecutionTraceCall } from './facade.ts'

export interface ExecuteOptions { timeoutMs?: number; trace?: boolean }
export interface ExecuteResult { ok: boolean; value?: unknown; logs?: string[]; error?: string; trace?: ExecutionTraceCall[] }

// Do not inject host constructors (Object, Function, Array, etc.) into the
// context: host constructors can pierce node:vm via `.constructor.constructor`.
// The context gets its own standard intrinsics from vm.createContext; we expose
// only the hardened mermaid facade and a logging console.
const SAFE_GLOBALS = {}

export async function executeInSandbox(code: string, opts: ExecuteOptions = {}): Promise<ExecuteResult> {
  try {
    return runInSandbox(code, opts)
  } finally {
    // Bun defect (verified on 1.3.13/1.3.14): the node:vm `timeout` watchdog
    // is NOT disarmed when the script completes — at its original deadline it
    // uncatchably terminates whatever host JS is running, which killed
    // CPU-heavy synchronous work that followed a sandbox call. One macrotask
    // turn fully disarms it; microtasks (`await Promise.resolve()`) do not.
    // Keep the `timeout` option itself — it is a security boundary.
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

function runInSandbox(code: string, opts: ExecuteOptions = {}): ExecuteResult {
  const timeoutMs = opts.timeoutMs ?? 5000
  const trace: ExecutionTraceCall[] = []
  const early = (error: string): ExecuteResult => opts.trace ? { ok: false, error, logs: [], trace } : { ok: false, error, logs: [] }
  const unsupported = unsupportedCodeReason(code)
  if (unsupported) return early(unsupported)
  const sandbox: Record<string, unknown> = {
    ...SAFE_GLOBALS,
    eval: undefined,
    Function: undefined,
  }
  const context = vm.createContext(sandbox, {
    name: 'agentic-mermaid-codemode',
    microtaskMode: 'afterEvaluate',
    codeGeneration: { strings: false, wasm: false },
  })
  vm.runInContext(`
    (() => {
      const logs = []
      const safeString = String
      const safeStringify = JSON.stringify.bind(JSON)
      const objectToString = Object.prototype.toString
      const safeToStringTag = (v) => objectToString.call(v)
      const safeFromEntries = Object.fromEntries.bind(Object)
      const safeArrayFrom = Array.from.bind(Array)
      const str = (v) => {
        if (typeof v === 'string') return v
        try {
          const json = safeStringify(v)
          return typeof json === 'string' ? json : safeString(v)
        } catch {
          try { return safeString(v) } catch { return '[unprintable]' }
        }
      }
      Object.defineProperty(globalThis, '__pi_read_logs', {
        value: () => safeStringify(logs),
        writable: false,
        configurable: false,
      })
      Object.defineProperty(globalThis, '__pi_result', { value: undefined, writable: true, configurable: false })
      Object.defineProperty(globalThis, '__pi_error', { value: undefined, writable: true, configurable: false })
      Object.defineProperty(globalThis, '__pi_format_error', {
        value: (err) => {
          try {
            if (typeof err === 'string') return err
            if (err && (typeof err === 'object' || typeof err === 'function')) {
              const message = err.message
              if (typeof message === 'string') return message
            }
            return safeString(err)
          } catch { return 'sandbox error' }
        },
        writable: false,
        configurable: false,
      })
      Object.defineProperty(globalThis, '__pi_stringify_result', {
        value: (value) => safeStringify(value, (_k, v) => {
          const tag = safeToStringTag(v)
          if (tag === '[object Map]') return safeFromEntries(v)
          if (tag === '[object Set]') return safeArrayFrom(v)
          return v
        }),
        writable: false,
        configurable: false,
      })
      Object.defineProperty(globalThis, 'console', {
        value: Object.freeze({
          log: (...a) => logs.push(a.map(str).join(' ')),
          error: (...a) => logs.push(a.map(str).join(' ')),
          warn: (...a) => logs.push(a.map(str).join(' ')),
        }),
        writable: false,
        configurable: false,
      })
      try {
        Object.defineProperty(Error, 'prepareStackTrace', { value: undefined, writable: false, configurable: false })
        Object.freeze(Error)
        Object.freeze(Error.prototype)
      } catch {}
      try { Object.defineProperty(Array, 'fromAsync', { value: undefined, writable: false, configurable: false }) } catch {}
      try { Object.freeze(Promise.prototype); Object.freeze(Promise) } catch {}
      for (const name of [
        'constructor', '__proto__', 'eval', 'Function', 'Promise',
        'Atomics', 'SharedArrayBuffer', 'ShadowRealm', 'WebAssembly',
        'queueMicrotask', 'setTimeout', 'setInterval', 'setImmediate',
        'fetch', 'process', 'require', 'Bun', 'Worker', 'MessageChannel', 'MessagePort',
        'AsyncDisposableStack', 'DisposableStack', 'SuppressedError', 'FinalizationRegistry', 'WeakRef',
      ]) {
        try { Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false }) } catch {}
      }
      try { Object.setPrototypeOf(globalThis, null) } catch {}
    })()
  `, context)
  const makeSandboxError = vm.runInContext(`(message) => new Error(String(message))`, context) as (message: string) => Error
  let sdkClosed = false
  sandbox.mermaid = createTracingMermaid(opts.trace ? trace : undefined, makeSandboxError, () => sdkClosed)
  const readLogs = (): string[] => {
    try {
      const encoded = vm.runInContext(`__pi_read_logs()`, context, { timeout: 50 })
      if (typeof encoded !== 'string') return []
      const value = JSON.parse(encoded)
      return Array.isArray(value) ? value.filter(v => typeof v === 'string') : []
    } catch { return [] }
  }
  const errorMessage = (err: unknown): string => {
    try {
      sandbox.__pi_error = err
      const message = vm.runInContext(`__pi_format_error(__pi_error)`, context, { timeout: 50 })
      return typeof message === 'string' ? message : 'sandbox error'
    } catch (e) {
      return e instanceof Error ? e.message : 'sandbox error'
    } finally {
      try { sandbox.__pi_error = undefined } catch {}
    }
  }
  // Choose expression-vs-statement form by host-side parse only. Do not inspect
  // sandbox-thrown error.name/prototypes while the SDK is open: getters/proxy
  // traps can run attacker code outside the VM timeout/commit boundary.
  const wraps = expressionFirstWraps(code)
  let result: unknown
  let runErr: unknown = null
  for (const wrapped of wraps) {
    let script: vm.Script
    try { script = new vm.Script(wrapped, { filename: 'codemode.ts' }) }
    catch (e) { runErr = e; break }
    try {
      result = script.runInContext(context, { timeout: timeoutMs })
      runErr = null
      break
    } catch (e) {
      runErr = e
      break
    }
  }
  const withTrace = <T extends Omit<ExecuteResult, 'trace'>>(r: T): ExecuteResult => opts.trace ? { ...r, trace } : r
  if (runErr) { sdkClosed = true; return withTrace({ ok: false, error: errorMessage(runErr), logs: readLogs() }) }

  // `undefined` isn't valid JSON; promote it to null so code with no explicit
  // return value still produces ok:true with a well-defined payload.
  if (result === undefined) { sdkClosed = true; return withTrace({ ok: true, value: null, logs: readLogs() }) }
  // Functions / symbols / other non-JSON values: JSON.stringify returns
  // undefined for them. Treat the same as a missing value (null) rather
  // than calling JSON.parse('undefined'). Close the SDK first: result
  // conversion may invoke sandbox getters/proxy traps, and those must not be
  // able to perform late verify/serialize/mutate work after the commit point.
  sdkClosed = true
  let stringified: string | undefined
  try {
    sandbox.__pi_result = result
    stringified = vm.runInContext('__pi_stringify_result(__pi_result)', context, { timeout: timeoutMs }) as string | undefined
  } catch (e) {
    return withTrace({ ok: false, error: `non-serializable: ${errorMessage(e)}`, logs: readLogs() })
  } finally {
    try { sandbox.__pi_result = undefined } catch {}
  }
  if (stringified === undefined) return withTrace({ ok: true, value: null, logs: readLogs() })
  if (typeof stringified !== 'string') return withTrace({ ok: false, error: 'non-serializable: result did not stringify to JSON text', logs: readLogs() })
  try { return withTrace({ ok: true, value: JSON.parse(stringified), logs: readLogs() }) }
  catch (e) { return withTrace({ ok: false, error: `non-serializable: ${e instanceof Error ? e.message : 'invalid JSON'}`, logs: readLogs() }) }
}

