// Code Mode sandbox: run agent-supplied TS in a node:vm context.

import vm from 'node:vm'
import * as mermaid from '../agent/index.ts'

export type ExecutionTraceCall =
  | { verb: 'parse'; diagram?: number; source?: string }
  | { verb: 'narrow'; family: 'flowchart' | 'sequence' | 'timeline' | 'class' | 'er'; input?: number; ok: boolean }
  | { verb: 'mutate'; body: 'flowchart' | 'sequence' | 'timeline' | 'class' | 'er' | 'opaque'; input?: number; output?: number; opKind?: string }
  | { verb: 'verify'; diagram?: number; ok?: boolean; inspected?: boolean }
  | { verb: 'serialize'; diagram?: number; source?: string }

type TraceMutationBody = Extract<ExecutionTraceCall, { verb: 'mutate' }>['body']
type TraceNarrowFamily = Extract<ExecutionTraceCall, { verb: 'narrow' }>['family']

export interface ExecuteOptions { timeoutMs?: number; trace?: boolean }
export interface ExecuteResult { ok: boolean; value?: unknown; logs?: string[]; error?: string; trace?: ExecutionTraceCall[] }

const SAFE_GLOBALS = {
  JSON, Object, Array, Map, Set, WeakMap, WeakSet, Math, Date,
  String, Number, Boolean, Symbol, RegExp, Error, TypeError, RangeError, Promise,
}

export async function executeInSandbox(code: string, opts: ExecuteOptions = {}): Promise<ExecuteResult> {
  const timeoutMs = opts.timeoutMs ?? 5000
  const logs: string[] = []
  const trace: ExecutionTraceCall[] = []
  const sandbox = {
    ...SAFE_GLOBALS,
    mermaid: opts.trace ? createTracingMermaid(trace) : mermaid,
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
  const withTrace = <T extends Omit<ExecuteResult, 'trace'>>(r: T): ExecuteResult => opts.trace ? { ...r, trace } : r
  if (runErr) return withTrace({ ok: false, error: runErr.message, logs })

  // `undefined` isn't valid JSON; promote it to null so code with no explicit
  // return value still produces ok:true with a well-defined payload.
  if (result === undefined) return withTrace({ ok: true, value: null, logs })
  // Functions / symbols / other non-JSON values: JSON.stringify returns
  // undefined for them. Treat the same as a missing value (null) rather
  // than calling JSON.parse('undefined').
  const stringified = JSON.stringify(result, jsonReplacer)
  if (stringified === undefined) return withTrace({ ok: true, value: null, logs })
  try { return withTrace({ ok: true, value: JSON.parse(stringified), logs }) }
  catch (e) { return withTrace({ ok: false, error: `non-serializable: ${(e as Error).message}`, logs }) }
}

function createTracingMermaid(trace: ExecutionTraceCall[]): typeof mermaid {
  const diagramIds = new WeakMap<object, number>()
  let nextId = 1
  const idOf = (value: unknown): number | undefined => {
    if (!value || typeof value !== 'object') return undefined
    if (!('body' in value) || !('canonicalSource' in value)) return undefined
    const obj = value as object
    let id = diagramIds.get(obj)
    if (!id) { id = nextId++; diagramIds.set(obj, id) }
    return id
  }
  const bodyKind = (value: unknown): TraceMutationBody => {
    const kind = (value as { body?: { kind?: string } } | undefined)?.body?.kind
    return (kind === 'flowchart' || kind === 'sequence' || kind === 'timeline' || kind === 'class' || kind === 'er') ? kind : 'opaque'
  }
  return new Proxy(mermaid, {
    get(target, prop, receiver) {
      if (prop === 'parseMermaid') return (source: string) => {
        const r = target.parseMermaid(source)
        const diagram = r.ok ? idOf(r.value) : undefined
        trace.push({ verb: 'parse', diagram, source: r.ok ? r.value.canonicalSource : undefined })
        return r
      }
      if (prop === 'asFlowchart' || prop === 'asSequence' || prop === 'asTimeline' || prop === 'asClass' || prop === 'asEr') {
        return (d: any) => {
          const r = ((target as any)[prop] as (diagram: any) => unknown)(d)
          trace.push({ verb: 'narrow', family: narrowerFamily(prop), input: idOf(d), ok: r !== null })
          return r
        }
      }
      if (prop === 'mutate') return (d: any, op: any) => {
        const call: Extract<ExecutionTraceCall, { verb: 'mutate' }> = {
          verb: 'mutate', body: bodyKind(d), input: idOf(d), opKind: typeof op === 'object' && op && 'kind' in op ? String(op.kind) : undefined,
        }
        const r = target.mutate(d, op)
        if (r.ok) call.output = idOf(r.value)
        trace.push(call)
        return r
      }
      if (prop === 'verifyMermaid') return (input: any, opts?: any) => {
        const r = target.verifyMermaid(input, opts)
        const call: Extract<ExecutionTraceCall, { verb: 'verify' }> = { verb: 'verify', diagram: idOf(input), ok: r.ok, inspected: false }
        trace.push(call)
        return new Proxy(r, {
          get(verifyTarget, verifyProp, verifyReceiver) {
            if (verifyProp === 'ok' || verifyProp === 'warnings' || verifyProp === 'layout') call.inspected = true
            return Reflect.get(verifyTarget, verifyProp, verifyReceiver)
          },
        })
      }
      if (prop === 'serializeMermaid') return (d: any) => {
        const source = target.serializeMermaid(d)
        trace.push({ verb: 'serialize', diagram: idOf(d), source })
        return source
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as typeof mermaid
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
