// Code Mode sandbox: run agent-supplied JavaScript in a node:vm context.

import vm from 'node:vm'
import { unsupportedBunReason } from './bun-version.ts'
import {
  agentCodeLocation,
  codeModeScreen,
  createTracingMermaid,
  expressionFirstWraps,
  firstStackFrame,
  marshalCodeModeResult,
  CODE_MODE_RETURN_HINT,
  type CodeModeLocation,
  type CodeModeWrapForm,
} from './facade.ts'
import {
  DEFAULT_EXECUTE_TIMEOUT_MS,
  LOGS_TRUNCATED_MARKER,
  normalizeExecuteOutputLimits,
  utf8ByteLength,
  type ExecuteErrorCode,
  type ExecuteOutputLimits,
} from './execute-limits.ts'

import type { ExecutionTraceCall } from './facade.ts'
export type { ExecutionTraceCall } from './facade.ts'

export interface ExecuteOptions {
  timeoutMs?: number
  trace?: boolean
  outputLimits?: Readonly<ExecuteOutputLimits>
  /** Trusted host instrumentation; never exposed to agent code. */
  onTraceCall?: (call: ExecutionTraceCall) => void
}
export interface ExecuteResult {
  ok: boolean
  value?: unknown
  logs?: string[]
  error?: string
  /** Set on a failure the runner's own time budget caused; absent means EXECUTE_FAILED. */
  code?: ExecuteErrorCode
  /** Where an uncaught error was thrown, or where unparseable code stopped,
   * in the agent's own code (1-based). Absent when no frame of the agent's
   * code is known (a thrown non-Error, a timeout). */
  location?: CodeModeLocation
  trace?: ExecutionTraceCall[]
}

// node:vm's watchdog message and the pre-run budget check above it. Only the
// formatted message is classified (sandbox values are never inspected), so a
// script that throws this exact text misclassifies only its own failure.
const RUN_TIMEOUT_MESSAGE = /^(?:Script|Code Mode) execution timed out after \d+ms$/
const TIMEOUT: Pick<ExecuteResult, 'code'> = { code: 'EXECUTE_TIMEOUT' }

const MIN_BUN_SDK_TIMEOUT_MS = 1_000
const SCRIPT_FILENAME = 'codemode.ts'

// Do not inject host constructors (Object, Function, Array, etc.) into the
// context: host constructors can pierce node:vm via `.constructor.constructor`.
// The context gets its own standard intrinsics from vm.createContext; we expose
// only the hardened mermaid facade and a logging console.
const SAFE_GLOBALS = {}

export async function executeInSandbox(code: string, opts: ExecuteOptions = {}): Promise<ExecuteResult> {
  return runInSandbox(code, opts)
}

function runInSandbox(code: string, opts: ExecuteOptions = {}): ExecuteResult {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_EXECUTE_TIMEOUT_MS
  const outputLimits = normalizeExecuteOutputLimits(opts.outputLimits)
  const startedAt = performance.now()
  const remainingBudgetMs = () => Math.floor(timeoutMs - (performance.now() - startedAt))
  const trace: ExecutionTraceCall[] = []
  const early = (error: string, location?: CodeModeLocation): ExecuteResult => ({
    ok: false, error, ...(location ? { location } : {}), logs: [], ...(opts.trace ? { trace } : {}),
  })
  // The `timeout` option below is a security boundary, and only Bun 1.4.0+
  // honors it without outliving the call (see bun-version.ts).
  const unsupportedBun = unsupportedBunReason()
  if (unsupportedBun) return early(unsupportedBun)
  const screened = codeModeScreen(code)
  if (screened) return early(screened.message, screened.location)
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
      let logBytes = 0
      let logsTruncated = false
      const maxLogEntries = ${outputLimits.maxLogEntries}
      const maxLogBytes = ${outputLimits.maxLogBytes}
      const truncationMarker = ${JSON.stringify(LOGS_TRUNCATED_MARKER)}
      const safeString = String
      const safeStringify = JSON.stringify.bind(JSON)
      const objectToString = Object.prototype.toString
      const safeToStringTag = (v) => objectToString.call(v)
      const safeFromEntries = Object.fromEntries.bind(Object)
      const safeArrayFrom = Array.from.bind(Array)
      const utf8Bytes = (value) => {
        let bytes = 0
        for (const char of value) {
          const code = char.codePointAt(0)
          bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
        }
        return bytes
      }
      const truncateUtf8 = (value, maximum) => {
        let bytes = 0
        let output = ''
        for (const char of value) {
          const code = char.codePointAt(0)
          const width = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
          if (bytes + width > maximum) break
          output += char
          bytes += width
        }
        return output
      }
      const str = (v) => {
        if (typeof v === 'string') return v
        try {
          const json = safeStringify(v)
          return typeof json === 'string' ? json : safeString(v)
        } catch {
          try { return safeString(v) } catch { return '[unprintable]' }
        }
      }
      const appendLog = (args) => {
        if (logsTruncated) return
        if (logs.length >= maxLogEntries || logBytes >= maxLogBytes) {
          logsTruncated = true
          logs.push(truncationMarker)
          return
        }
        let line = args.map(str).join(' ')
        const remaining = maxLogBytes - logBytes
        if (utf8Bytes(line) > remaining) {
          line = truncateUtf8(line, remaining)
          logsTruncated = true
        }
        logBytes += utf8Bytes(line)
        logs.push(line)
        if (logsTruncated) logs.push(truncationMarker)
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
      Object.defineProperty(globalThis, '__pi_error_stack', {
        value: (err) => {
          try {
            if (err && (typeof err === 'object' || typeof err === 'function')) {
              const stack = err.stack
              if (typeof stack === 'string') return stack
            }
          } catch {}
          return undefined
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
          log: (...a) => appendLog(a),
          error: (...a) => appendLog(a),
          warn: (...a) => appendLog(a),
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
  let sdkCallOccurred = false
  // Bun's node:vm watchdog can fire while a sandbox call is executing a host
  // SDK function, wedging the source-checkout MCP instead of returning a tagged
  // timeout. Gate the actual SDK call rather than source spelling: ordinary
  // strings remain valid and computed access cannot bypass the budget check.
  sandbox.mermaid = createTracingMermaid(
    opts.trace ? trace : undefined,
    makeSandboxError,
    () => sdkClosed,
    undefined,
    () => {
      sdkCallOccurred = true
      if (typeof Bun === 'undefined') return undefined
      const remaining = remainingBudgetMs()
      return remaining < MIN_BUN_SDK_TIMEOUT_MS
        ? `Code Mode SDK calls under Bun require at least ${MIN_BUN_SDK_TIMEOUT_MS}ms of remaining timeout budget (timeoutMs >= ${MIN_BUN_SDK_TIMEOUT_MS})`
        : undefined
    },
    opts.onTraceCall,
  )
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
  // The stack is read inside the context under the same short watchdog as the
  // message (a `stack` getter is agent code); only a host string comes back.
  const errorLocation = (err: unknown, form: CodeModeWrapForm): CodeModeLocation | undefined => {
    try {
      sandbox.__pi_error = err
      const stack = vm.runInContext(`__pi_error_stack(__pi_error)`, context, { timeout: 50 })
      const frame = firstStackFrame(stack, SCRIPT_FILENAME)
      return frame && agentCodeLocation(code, form, frame.line, frame.column)
    } catch {
      return undefined
    } finally {
      try { sandbox.__pi_error = undefined } catch {}
    }
  }
  // Choose expression-vs-statement form by host-side parse only. Do not inspect
  // sandbox-thrown error.name/prototypes while the SDK is open: getters/proxy
  // traps can run attacker code outside the VM timeout/commit boundary.
  const wrapped = expressionFirstWraps(code)
  let result: unknown
  let runErr: unknown = null
  let started = false
  try {
    const script = new vm.Script(wrapped.source, { filename: SCRIPT_FILENAME })
    const remainingMs = remainingBudgetMs()
    if (remainingMs <= 0) throw new Error(`Code Mode execution timed out after ${timeoutMs}ms`)
    started = true
    result = script.runInContext(context, { timeout: remainingMs })
  } catch (e) {
    runErr = e
  }
  const withTrace = <T extends Omit<ExecuteResult, 'trace'>>(r: T): ExecuteResult => opts.trace ? { ...r, trace } : r
  if (runErr) {
    sdkClosed = true
    const error = errorMessage(runErr)
    if (RUN_TIMEOUT_MESSAGE.test(error)) return withTrace({ ok: false, error, ...TIMEOUT, logs: readLogs() })
    const location = started ? errorLocation(runErr, wrapped.form) : undefined
    return withTrace({ ok: false, error, ...(location ? { location } : {}), logs: readLogs() })
  }

  // `undefined` isn't valid JSON; promote it to null so code with no explicit
  // return value still produces ok:true with a well-defined payload.
  if (result === undefined) { sdkClosed = true; return withTrace({ ok: true, value: null, logs: readLogs() }) }
  // Functions / symbols / other non-JSON values: JSON.stringify returns
  // undefined for them. Treat the same as a missing value (null) rather
  // than calling JSON.parse('undefined'). Close the SDK first: result
  // conversion may invoke sandbox getters/proxy traps, and those must not be
  // able to perform late verify/serialize/mutate work after the commit point.
  sdkClosed = true
  // Marshal a returned SDK diagram to the canonical plain-JSON envelope before
  // serialization (host-side, on the raw object). Non-SDK values pass through.
  // This is still part of execute's hard deadline: verification/layout can be
  // substantially more expensive than parsing a large trusted diagram.
  let marshalled: unknown = result
  const resultMayContainSdkValue = sdkCallOccurred
    && result !== null
    && (typeof result === 'object' || typeof result === 'function')
  if (resultMayContainSdkValue) {
    const remainingMs = remainingBudgetMs()
    if (remainingMs <= 0 || (typeof Bun !== 'undefined' && remainingMs < MIN_BUN_SDK_TIMEOUT_MS)) {
      return withTrace({ ok: false, error: `Code Mode execution timed out after ${timeoutMs}ms while committing the result`, ...TIMEOUT, logs: readLogs() })
    }
    const marshalKey = `__pi_marshal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
    const marshalTarget = () => marshalCodeModeResult(sandbox.mermaid, result)
    // Never expose a raw host function to the vm realm: inherited bind/call or
    // constructor access would pierce node:vm. The callable proxy has no visible
    // prototype or function-valued properties; it exists only for this one
    // controlled post-close invocation.
    const safeMarshal = new Proxy(marshalTarget, {
      apply: target => Reflect.apply(target, undefined, []),
      get(target, prop, receiver) {
        if (prop === 'constructor' || prop === '__proto__' || prop === 'prototype') return undefined
        return Object.prototype.hasOwnProperty.call(target, prop)
          ? Reflect.get(target, prop, receiver)
          : undefined
      },
      getPrototypeOf: () => null,
      has: (target, prop) => Object.prototype.hasOwnProperty.call(target, prop)
        && prop !== 'constructor' && prop !== '__proto__' && prop !== 'prototype',
      set: () => false,
      defineProperty: () => false,
      deleteProperty: () => false,
      setPrototypeOf: () => false,
    })
    try {
      if (!Reflect.defineProperty(sandbox, marshalKey, {
        value: safeMarshal,
        enumerable: false,
        writable: false,
        configurable: true,
      })) throw new Error('could not install the result commit guard')
      marshalled = vm.runInContext(`globalThis[${JSON.stringify(marshalKey)}]()`, context, { timeout: remainingMs })
    } catch (e) {
      const message = errorMessage(e)
      return withTrace(/timed out/i.test(message)
        ? { ok: false, error: `Code Mode execution timed out after ${timeoutMs}ms while committing the result`, ...TIMEOUT, logs: readLogs() }
        : { ok: false, error: `could not commit Code Mode result: ${message}`, logs: readLogs() })
    } finally {
      try { Reflect.deleteProperty(sandbox, marshalKey) } catch {}
    }
  }
  let stringified: string | undefined
  try {
    const stringifyTimeoutMs = remainingBudgetMs()
    if (stringifyTimeoutMs <= 0) {
      return withTrace({ ok: false, error: `Code Mode execution timed out after ${timeoutMs}ms while serializing the result`, ...TIMEOUT, logs: readLogs() })
    }
    sandbox.__pi_result = marshalled
    stringified = vm.runInContext('__pi_stringify_result(__pi_result)', context, { timeout: stringifyTimeoutMs }) as string | undefined
  } catch (e) {
    const message = errorMessage(e)
    return withTrace({ ok: false, error: `non-serializable: ${message} — ${CODE_MODE_RETURN_HINT}`, ...(RUN_TIMEOUT_MESSAGE.test(message) ? TIMEOUT : {}), logs: readLogs() })
  } finally {
    try { sandbox.__pi_result = undefined } catch {}
  }
  if (stringified === undefined) return withTrace({ ok: true, value: null, logs: readLogs() })
  if (typeof stringified !== 'string') return withTrace({ ok: false, error: 'non-serializable: result did not stringify to JSON text', logs: readLogs() })
  if (utf8ByteLength(stringified) > outputLimits.maxResultBytes) {
    return withTrace({ ok: false, error: `sandbox result exceeded ${outputLimits.maxResultBytes} bytes; reduce console output or returned data`, logs: readLogs() })
  }
  try { return withTrace({ ok: true, value: JSON.parse(stringified), logs: readLogs() }) }
  catch (e) { return withTrace({ ok: false, error: `non-serializable: ${e instanceof Error ? e.message : 'invalid JSON'}`, logs: readLogs() }) }
}
