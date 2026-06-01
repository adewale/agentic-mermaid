// Code Mode sandbox: run agent-supplied JavaScript in a node:vm context.

import vm from 'node:vm'
import * as mermaid from '../agent/index.ts'

export type ExecutionTraceCall =
  | { verb: 'parse'; diagram?: number; source?: string }
  | { verb: 'narrow'; family: 'flowchart' | 'sequence' | 'timeline' | 'class' | 'er'; input?: number; ok: boolean }
  | { verb: 'mutate'; body: 'flowchart' | 'sequence' | 'timeline' | 'class' | 'er' | 'opaque'; input?: number; output?: number; opKind?: string; fingerprint?: string }
  | { verb: 'verify'; diagram?: number; ok?: boolean; inspected?: boolean; fingerprint?: string }
  | { verb: 'verify_inspect'; diagram?: number; property: 'ok' | 'warnings' | 'layout' }
  | { verb: 'serialize'; diagram?: number; source?: string; fingerprint?: string }

type TraceMutationBody = Extract<ExecutionTraceCall, { verb: 'mutate' }>['body']
type TraceNarrowFamily = Extract<ExecutionTraceCall, { verb: 'narrow' }>['family']

export interface ExecuteOptions { timeoutMs?: number; trace?: boolean }
export interface ExecuteResult { ok: boolean; value?: unknown; logs?: string[]; error?: string; trace?: ExecutionTraceCall[] }

// Do not inject host constructors (Object, Function, Array, etc.) into the
// context: host constructors can pierce node:vm via `.constructor.constructor`.
// The context gets its own standard intrinsics from vm.createContext; we expose
// only the hardened mermaid facade and a logging console.
const SAFE_GLOBALS = {}

export async function executeInSandbox(code: string, opts: ExecuteOptions = {}): Promise<ExecuteResult> {
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

function createTracingMermaid(trace?: ExecutionTraceCall[], makeSandboxError?: (message: string) => Error, isClosed?: () => boolean): typeof mermaid {
  const diagramIds = new WeakMap<object, number>()
  const trusted = new WeakSet<object>()
  const hardened = new WeakMap<object, unknown>()
  const raw = new WeakMap<object, object>()
  let nextId = 1

  const forbidden = (prop: string | symbol): boolean => prop === 'constructor' || prop === '__proto__' || prop === 'prototype'
  const protoFor = (target: object): object | null => Object.isExtensible(target) ? null : Reflect.getPrototypeOf(target)
  const sandboxError = (message: string): Error => makeSandboxError ? makeSandboxError(message) : new Error(message)
  const assertOpen = () => { if (isClosed?.()) throw sandboxError('Code Mode SDK calls are not allowed while returning results') }
  const readonly = () => { throw sandboxError('Code Mode SDK results are read-only; use mermaid.mutate(...) for structured edits') }
  const arrayMutators = new Set(['copyWithin', 'fill', 'pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'])
  const arrayCallbackMethods = new Set(['forEach', 'map', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every', 'flatMap'])
  const rawOf = <T>(value: T): T => (value && (typeof value === 'object' || typeof value === 'function') && raw.has(value as object) ? raw.get(value as object) : value) as T
  const isMap = (value: unknown): value is Map<unknown, unknown> => value instanceof Map || Object.prototype.toString.call(value) === '[object Map]'
  const isSet = (value: unknown): value is Set<unknown> => value instanceof Set || Object.prototype.toString.call(value) === '[object Set]'
  const hostCall = <T>(fn: () => T): T => {
    try { return fn() } catch (e) { throw sandboxError((e as Error).message) }
  }
  const jsonClone = <T>(value: T): T => hostCall(() => {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return value
    const encoded = JSON.stringify(value)
    return (encoded === undefined ? undefined : JSON.parse(encoded)) as T
  })
  const iteratorOf = (items: unknown[]) => {
    let index = 0
    const iterator = {
      [Symbol.iterator]() { return this },
      next() {
        return index < items.length
          ? { value: items[index++], done: false }
          : { value: undefined, done: true }
      },
    }
    return harden(iterator)
  }
  function descriptorFor(target: object, prop: string | symbol): PropertyDescriptor | undefined {
    if (forbidden(prop)) return undefined
    const desc = Reflect.getOwnPropertyDescriptor(target, prop)
    if (!desc) return undefined
    if ('value' in desc) return { ...desc, value: harden(desc.value) }
    return { ...desc, get: desc.get ? harden(desc.get) : undefined, set: desc.set ? harden(readonly) : undefined }
  }
  const isDiagramLike = (value: unknown): value is object => Boolean(value && typeof value === 'object' && 'body' in value && 'canonicalSource' in value)
  const idOf = (value: unknown): number | undefined => {
    value = rawOf(value)
    if (!isDiagramLike(value)) return undefined
    const obj = value as object
    let id = diagramIds.get(obj)
    if (!id) { id = nextId++; diagramIds.set(obj, id) }
    return id
  }
  const trustDiagram = (value: unknown): void => {
    value = rawOf(value)
    if (isDiagramLike(value)) trusted.add(value as object)
  }
  const requireTrustedDiagram = (value: unknown, verb: string): void => {
    value = rawOf(value)
    if (value && (typeof value === 'object' || typeof value === 'function') && !trusted.has(value as object)) {
      throw sandboxError(`Code Mode ${verb} input must come from mermaid.parseMermaid(...) or mermaid.mutate(...)`)
    }
  }
  const rememberRaw = <T extends object>(proxy: T, target: object): T => {
    raw.set(proxy, target)
    if (isDiagramLike(target)) diagramIds.set(proxy, idOf(target)!)
    return proxy
  }
  const harden = <T>(value: T): T => {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return value
    const unwrapped = rawOf(value)
    if (unwrapped !== value) return harden(unwrapped) as T
    const obj = value as object
    const cached = hardened.get(obj)
    if (cached) return cached as T

    if (isMap(value)) {
      let proxy: Map<unknown, unknown>
      proxy = new Proxy(value, {
        get(target, prop) {
          if (forbidden(prop)) return undefined
          if (prop === 'size') return target.size
          if (prop === 'get') return harden((key: unknown) => harden(target.get(rawOf(key))))
          if (prop === 'set' || prop === 'delete' || prop === 'clear' || prop === 'getOrInsert' || prop === 'getOrInsertComputed') return harden(readonly)
          if (prop === 'has') return harden((key: unknown) => target.has(rawOf(key)))
          if (prop === Symbol.iterator || prop === 'entries') return harden(() => iteratorOf(Array.from(target.entries(), ([k, v]) => harden([harden(k), harden(v)]))))
          if (prop === 'values') return harden(() => iteratorOf(Array.from(target.values(), v => harden(v))))
          if (prop === 'keys') return harden(() => iteratorOf(Array.from(target.keys(), k => harden(k))))
          if (prop === 'forEach') return harden((cb: (value: unknown, key: unknown, map: Map<unknown, unknown>) => unknown, thisArg?: unknown) => { for (const [k, v] of target.entries()) cb.call(thisArg, harden(v), harden(k), proxy) })
          const got = hostCall(() => Reflect.get(target, prop, target))
          return typeof got === 'function' ? undefined : harden(got)
        },
        set() { return readonly() },
        deleteProperty() { return readonly() },
        defineProperty() { return readonly() },
        setPrototypeOf() { return readonly() },
        getOwnPropertyDescriptor(target, prop) { return descriptorFor(target, prop) },
        preventExtensions() { return readonly() },
        getPrototypeOf(target) { return protoFor(target) },
      })
      hardened.set(obj, proxy)
      return rememberRaw(proxy, value) as T
    }

    if (isSet(value)) {
      let proxy: Set<unknown>
      proxy = new Proxy(value, {
        get(target, prop) {
          if (forbidden(prop)) return undefined
          if (prop === 'size') return target.size
          if (prop === 'add' || prop === 'delete' || prop === 'clear') return harden(readonly)
          if (prop === 'has') return harden((val: unknown) => target.has(rawOf(val)))
          if (prop === Symbol.iterator || prop === 'values' || prop === 'keys') return harden(() => iteratorOf(Array.from(target.values(), v => harden(v))))
          if (prop === 'entries') return harden(() => iteratorOf(Array.from(target.values(), v => harden([harden(v), harden(v)]))))
          if (prop === 'forEach') return harden((cb: (value: unknown, value2: unknown, set: Set<unknown>) => unknown, thisArg?: unknown) => { for (const v of target.values()) cb.call(thisArg, harden(v), harden(v), proxy) })
          const got = hostCall(() => Reflect.get(target, prop, target))
          return typeof got === 'function' ? undefined : harden(got)
        },
        set() { return readonly() },
        deleteProperty() { return readonly() },
        defineProperty() { return readonly() },
        setPrototypeOf() { return readonly() },
        getOwnPropertyDescriptor(target, prop) { return descriptorFor(target, prop) },
        preventExtensions() { return readonly() },
        getPrototypeOf(target) { return protoFor(target) },
      })
      hardened.set(obj, proxy)
      return rememberRaw(proxy, value) as T
    }

    if (typeof value === 'function') {
      const original = value
      const callable = (...args: unknown[]) => harden(hostCall(() => Reflect.apply(original, undefined, args)))
      const proxy = new Proxy(callable, {
        apply(_target, thisArg, args) { return harden(hostCall(() => Reflect.apply(original, thisArg, args))) },
        get(_target, prop, receiver) {
          if (forbidden(prop)) return undefined
          if (!Reflect.getOwnPropertyDescriptor(original, prop)) return undefined
          return harden(hostCall(() => Reflect.get(original, prop, receiver)))
        },
        set() { return readonly() },
        deleteProperty() { return readonly() },
        defineProperty() { return readonly() },
        setPrototypeOf() { return readonly() },
        getOwnPropertyDescriptor(_target, prop) { return descriptorFor(original, prop) },
        preventExtensions() { return readonly() },
        getPrototypeOf() { return protoFor(original) },
      })
      hardened.set(obj, proxy)
      return rememberRaw(proxy, value) as T
    }

    let proxy: object
    proxy = new Proxy(value as object, {
      get(target, prop, receiver) {
        if (forbidden(prop)) return undefined
        if (Array.isArray(target)) {
          if (typeof prop === 'string' && arrayMutators.has(prop)) return harden(readonly)
          if (prop === Symbol.iterator || prop === 'values') return harden(() => iteratorOf(Array.prototype.map.call(target, (v) => harden(v))))
          if (prop === 'entries') return harden(() => iteratorOf(Array.prototype.map.call(target, (v, i) => harden([i, harden(v)]))))
          if (prop === 'keys') return harden(() => iteratorOf(Array.from({ length: target.length }, (_, i) => i)))
          if (typeof prop === 'string' && arrayCallbackMethods.has(prop)) {
            return harden((cb: (value: unknown, index: number, array: unknown) => unknown, thisArg?: unknown) => {
              const values = Array.prototype.map.call(target, (v) => harden(v))
              const call = (v: unknown, i: number) => cb.call(thisArg, v, i, proxy)
              if (prop === 'forEach') { values.forEach(call); return undefined }
              if (prop === 'map') return values.map(call)
              if (prop === 'filter') return values.filter((v, i) => call(v, i))
              if (prop === 'find') return values.find((v, i) => Boolean(call(v, i)))
              if (prop === 'findIndex') return values.findIndex((v, i) => Boolean(call(v, i)))
              if (prop === 'findLast') { for (let i = values.length - 1; i >= 0; i--) if (call(values[i], i)) return values[i]; return undefined }
              if (prop === 'findLastIndex') { for (let i = values.length - 1; i >= 0; i--) if (call(values[i], i)) return i; return -1 }
              if (prop === 'some') return values.some((v, i) => Boolean(call(v, i)))
              if (prop === 'every') return values.every((v, i) => Boolean(call(v, i)))
              if (prop === 'flatMap') return values.flatMap(call as any)
            })
          }
          if (prop === 'toSorted') {
            return harden((compare?: (a: unknown, b: unknown) => number) => {
              const values = Array.prototype.map.call(target, (v) => harden(v))
              return compare ? values.slice().sort((a, b) => compare(a, b)) : values.slice().sort()
            })
          }
          if (prop === 'toReversed') return harden(() => Array.prototype.map.call(target, (v) => harden(v)).reverse())
          if (prop === 'toSpliced') return harden(function (start: number, deleteCount?: number, ...items: unknown[]) {
            const values = Array.prototype.map.call(target, (v) => harden(v))
            const copy = values.slice()
            if (arguments.length === 1) copy.splice(start)
            else copy.splice(start, deleteCount ?? 0, ...items.map(item => harden(rawOf(item))))
            return copy
          })
          if (prop === 'with') return harden((index: number, item: unknown) => {
            const values = Array.prototype.map.call(target, (v) => harden(v))
            const normalized = index < 0 ? values.length + index : index
            if (normalized < 0 || normalized >= values.length) throw sandboxError('Invalid array index')
            const copy = values.slice(); copy[normalized] = harden(rawOf(item)); return copy
          })
          if (prop === 'reduce' || prop === 'reduceRight') {
            return harden(function (cb: (previous: unknown, current: unknown, index: number, array: unknown) => unknown, initial?: unknown) {
              const values = Array.prototype.map.call(target, (v) => harden(v))
              const reducer = (previous: unknown, current: unknown, index: number) => cb(previous, current, index, proxy)
              return arguments.length >= 2
                ? (prop === 'reduce' ? values.reduce(reducer, initial) : values.reduceRight(reducer, initial))
                : (prop === 'reduce' ? values.reduce(reducer) : values.reduceRight(reducer))
            })
          }
        }
        if (!Reflect.getOwnPropertyDescriptor(target, prop)) return undefined
        const got = hostCall(() => Reflect.get(target, prop, receiver))
        return typeof got === 'function' ? undefined : harden(got)
      },
      set() { return readonly() },
      deleteProperty() { return readonly() },
      defineProperty() { return readonly() },
      setPrototypeOf() { return readonly() },
      has(target, prop) { return forbidden(prop) ? false : Reflect.has(target, prop) },
      getOwnPropertyDescriptor(target, prop) { return descriptorFor(target, prop) },
      preventExtensions() { return readonly() },
      getPrototypeOf(target) { return protoFor(target) },
    })
    hardened.set(obj, proxy)
    return rememberRaw(proxy, value as object) as T
  }

  const fingerprint = (value: unknown): string | undefined => fingerprintDiagram(rawOf(value))
  const bodyKind = (value: unknown): TraceMutationBody => {
    const kind = (value as { body?: { kind?: string } } | undefined)?.body?.kind
    return (kind === 'flowchart' || kind === 'sequence' || kind === 'timeline' || kind === 'class' || kind === 'er') ? kind : 'opaque'
  }
  const push = (call: ExecutionTraceCall) => { trace?.push(call) }
  const sdkTarget = {
    parseMermaid: mermaid.parseMermaid,
    asFlowchart: mermaid.asFlowchart,
    asSequence: mermaid.asSequence,
    asTimeline: mermaid.asTimeline,
    asClass: mermaid.asClass,
    asEr: mermaid.asEr,
    mutate: mermaid.mutate,
    verifyMermaid: mermaid.verifyMermaid,
    serializeMermaid: mermaid.serializeMermaid,
    renderMermaidSVG: mermaid.renderMermaidSVG,
    renderMermaidASCII: mermaid.renderMermaidASCII,
  } as unknown as typeof mermaid
  const sdkProps = new Set<string | symbol>(Reflect.ownKeys(sdkTarget))

  const sdkValues = new Map<string | symbol, unknown>()
  const sdkValue = (target: typeof sdkTarget, prop: string | symbol): unknown => {
    if (forbidden(prop) || !sdkProps.has(prop)) return undefined
    if (sdkValues.has(prop)) return sdkValues.get(prop)
    let value: unknown
    if (prop === 'parseMermaid') value = harden((source: string) => {
      assertOpen()
      if (typeof source !== 'string') throw sandboxError('Code Mode parseMermaid source must be a string')
      const r = hostCall(() => target.parseMermaid(source))
      if (r.ok) trustDiagram(r.value)
      const diagram = r.ok ? idOf(r.value) : undefined
      push({ verb: 'parse', diagram, source: r.ok ? (r.value.body.kind === 'opaque' ? r.value.body.source : r.value.canonicalSource) : undefined })
      return harden(r)
    })
    else if (prop === 'asFlowchart' || prop === 'asSequence' || prop === 'asTimeline' || prop === 'asClass' || prop === 'asEr') {
      value = harden((d: any) => {
        assertOpen()
        requireTrustedDiagram(d, String(prop))
        const input = idOf(d)
        const r = hostCall(() => ((target as any)[prop] as (diagram: any) => unknown)(rawOf(d)))
        if (r) trustDiagram(r)
        push({ verb: 'narrow', family: narrowerFamily(prop), input, ok: r !== null })
        return harden(r)
      })
    } else if (prop === 'mutate') value = harden((d: any, op: any) => {
      assertOpen()
      requireTrustedDiagram(d, 'mutate')
      const opForHost = jsonClone(op)
      const call: Extract<ExecutionTraceCall, { verb: 'mutate' }> = {
        verb: 'mutate', body: bodyKind(rawOf(d)), input: idOf(d), opKind: typeof opForHost === 'object' && opForHost && 'kind' in opForHost ? String((opForHost as { kind: unknown }).kind) : undefined,
      }
      push(call)
      const r = hostCall(() => target.mutate(rawOf(d), opForHost))
      if (r.ok) {
        trustDiagram(r.value)
        call.output = idOf(r.value)
        call.fingerprint = fingerprint(r.value)
      }
      return harden(r)
    })
    else if (prop === 'verifyMermaid') value = harden((input: any, opts?: any) => {
      assertOpen()
      requireTrustedDiagram(input, 'verifyMermaid')
      const r = hostCall(() => target.verifyMermaid(rawOf(input), opts))
      const diagram = idOf(input)
      push({ verb: 'verify', diagram, ok: r.ok, inspected: false, fingerprint: fingerprint(input) })
      return harden(new Proxy(r, {
        get(verifyTarget, verifyProp, verifyReceiver) {
          if (isClosed?.()) throw sandboxError('Code Mode SDK calls are not allowed while returning results')
          if (verifyProp === 'ok' || verifyProp === 'warnings' || verifyProp === 'layout') {
            push({ verb: 'verify_inspect', diagram, property: verifyProp })
          }
          if (forbidden(verifyProp)) return undefined
          return harden(hostCall(() => Reflect.get(verifyTarget, verifyProp, verifyReceiver)))
        },
        set() { return readonly() },
        deleteProperty() { return readonly() },
        defineProperty() { return readonly() },
        setPrototypeOf() { return readonly() },
        getOwnPropertyDescriptor(target, prop) { return descriptorFor(target, prop) },
        preventExtensions() { return readonly() },
        getPrototypeOf(target) { return protoFor(target) },
      }))
    })
    else if (prop === 'serializeMermaid') value = harden((d: any) => {
      assertOpen()
      requireTrustedDiagram(d, 'serializeMermaid')
      const source = hostCall(() => target.serializeMermaid(rawOf(d)))
      push({ verb: 'serialize', diagram: idOf(d), source, fingerprint: fingerprint(d) })
      return source
    })
    else if (prop === 'renderMermaidSVG' || prop === 'renderMermaidASCII') value = harden((input: any, opts?: any) => {
      assertOpen()
      if (input && typeof input === 'object') requireTrustedDiagram(input, String(prop))
      return hostCall(() => ((target as any)[prop] as (diagram: any, options?: any) => unknown)(rawOf(input), jsonClone(opts)))
    })
    sdkValues.set(prop, value)
    return value
  }

  return new Proxy(sdkTarget, {
    get(target, prop) { return sdkValue(target, prop) },
    set() { return readonly() },
    deleteProperty() { return readonly() },
    defineProperty() { return readonly() },
    setPrototypeOf() { return readonly() },
    getOwnPropertyDescriptor(target, prop) {
      if (!sdkProps.has(prop) || forbidden(prop)) return undefined
      const desc = Reflect.getOwnPropertyDescriptor(target, prop)
      return desc && 'value' in desc ? { ...desc, value: sdkValue(target, prop) } : undefined
    },
    preventExtensions() { return readonly() },
    getPrototypeOf(target) { return protoFor(target) },
    has(_target, prop) { return sdkProps.has(prop) && !forbidden(prop) },
    ownKeys() { return Array.from(sdkProps) },
  }) as typeof mermaid
}

function fingerprintDiagram(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  if (!('body' in value) || !('canonicalSource' in value)) return undefined
  try { return JSON.stringify(value, jsonReplacer) } catch { return undefined }
}

function narrowerFamily(prop: string | symbol): TraceNarrowFamily {
  if (prop === 'asFlowchart') return 'flowchart'
  if (prop === 'asSequence') return 'sequence'
  if (prop === 'asTimeline') return 'timeline'
  if (prop === 'asClass') return 'class'
  return 'er'
}

/**
 * Generate candidate wrappings in order of preference: expression form first
 * (handles bare expressions including objects/arrows/templates), then
 * statement form (handles multi-statement bodies with `return` etc.). The
 * first that compiles wins. Code Mode is deliberately synchronous: allowing
 * Promise jobs after `vm.runInContext` lets sandbox code block the host event
 * loop outside the VM timeout.
 */
function expressionFirstWraps(code: string): string[] {
  const t = code.trim()
  const stripped = t.replace(/;\s*$/, '') // drop a single trailing semicolon
  const expressionWrapped = `(() => { return (\n${stripped}\n) })()`
  const statementWrapped = `(() => { ${code} })()`
  // Expression form handles bare expressions including objects/arrows/templates.
  // Pick it only if host parsing succeeds; never retry based on sandbox-thrown
  // values, because their getters/proxy traps are attacker-controlled.
  try {
    // eslint-disable-next-line no-new-func
    new Function(`return (\n${stripped}\n)`)
    return [expressionWrapped]
  } catch {
    return [statementWrapped]
  }
}

function unsupportedCodeReason(code: string): string | undefined {
  if (code.includes('${')) return 'Code Mode does not support template literal interpolation'
  const scan = stripStringsAndComments(code)
  if (/\b(?:async|await|Promise|AsyncDisposableStack|FinalizationRegistry|WeakRef|fromAsync)\b/.test(scan) || /\bqueueMicrotask\b/.test(scan) || /\bimport\s*\(/.test(scan)) {
    return 'Code Mode is synchronous; async/await, Promise jobs, finalizers, queueMicrotask, Array.fromAsync, and dynamic import are not supported'
  }
  if (/\b(?:Atomics|SharedArrayBuffer|ShadowRealm|WebAssembly)\b/.test(scan)) {
    return 'Code Mode does not expose blocking or realm-creating globals'
  }
  return undefined
}

function stripStringsAndComments(code: string): string {
  let out = ''
  for (let i = 0; i < code.length;) {
    const ch = code[i]!
    const next = code[i + 1]
    if (ch === '/' && next === '/') {
      out += '  '; i += 2
      while (i < code.length && code[i] !== '\n') { out += ' '; i++ }
      continue
    }
    if (ch === '/' && next === '*') {
      out += '  '; i += 2
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) { out += code[i] === '\n' ? '\n' : ' '; i++ }
      if (i < code.length) { out += '  '; i += 2 }
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      out += ' '; i++
      while (i < code.length) {
        const c = code[i]!
        out += c === '\n' ? '\n' : ' '
        i++
        if (c === '\\') {
          if (i < code.length) { out += code[i] === '\n' ? '\n' : ' '; i++ }
          continue
        }
        if (c === quote) break
      }
      continue
    }
    out += ch
    i++
  }
  return out
}
function jsonReplacer(_k: string, v: unknown): unknown {
  if (v instanceof Map) return Object.fromEntries(v)
  if (v instanceof Set) return Array.from(v)
  return v
}
