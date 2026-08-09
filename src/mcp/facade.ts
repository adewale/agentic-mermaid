// Code Mode SDK facade — runtime-neutral. Shared by the node:vm sandbox
// (sandbox.ts) and the hosted dynamic-worker harness: the hardened read-only
// mermaid.* proxy, the sync-only code screen, and the expression-first code
// wrapping. Must stay free of node:* imports so it bundles for workerd.

import type { Node as AcornNode } from 'acorn'
import { parse as parseJavaScript } from 'acorn'
import * as mermaid from '../agent/core.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import type { DiagramKind } from '../agent/types.ts'
import { ParsedDiagramFamilyMismatchError, RenderCapabilityError } from '../render-contract.ts'
import { projectKnownRenderErrorDiagnostic, projectRenderErrorDiagnostic } from '../render-error-diagnostic.ts'
import type { CodeModeHostPolicy } from '../render-host-policy.ts'

export type ExecutionTraceCall =
  | { verb: 'parse'; diagram?: number; source?: string }
  | { verb: 'create'; family?: DiagramKind; diagram?: number; ops?: number; ok?: boolean }
  | { verb: 'narrow'; family: DiagramKind; input?: number; ok: boolean }
  | { verb: 'mutate'; body: DiagramKind | 'opaque'; input?: number; output?: number; opKind?: string; fingerprint?: string }
  | { verb: 'verify'; diagram?: number; ok?: boolean; inspected?: boolean; fingerprint?: string }
  | { verb: 'verify_inspect'; diagram?: number; property: 'ok' | 'warnings' | 'layout' }
  | { verb: 'analyze'; diagram?: number; source?: string; ok?: boolean; fingerprint?: string }
  | { verb: 'facts'; diagram?: number; source?: string; ok?: boolean; fingerprint?: string }
  | { verb: 'check'; diagram?: number; source?: string; ok?: boolean; fingerprint?: string }
  | { verb: 'serialize'; diagram?: number; source?: string; fingerprint?: string }

type TraceMutationBody = Extract<ExecutionTraceCall, { verb: 'mutate' }>['body']
type TraceNarrowFamily = Extract<ExecutionTraceCall, { verb: 'narrow' }>['family']

export function createTracingMermaid(trace?: ExecutionTraceCall[], makeSandboxError?: (message: string) => Error, isClosed?: () => boolean, hostPolicy?: CodeModeHostPolicy, beforeSdkCall?: () => string | undefined): typeof mermaid {
  const diagramIds = new WeakMap<object, number>()
  const trusted = new WeakSet<object>()
  const hardened = new WeakMap<object, unknown>()
  const raw = new WeakMap<object, object>()
  let nextId = 1

  const forbidden = (prop: string | symbol): boolean => prop === 'constructor' || prop === '__proto__' || prop === 'prototype'
  const protoFor = (target: object): object | null => (Object.isExtensible(target) ? null : Reflect.getPrototypeOf(target))
  const sandboxError = (message: string): Error => (makeSandboxError ? makeSandboxError(message) : new Error(message))
  const assertOpen = () => {
    if (isClosed?.()) throw sandboxError('Code Mode SDK calls are not allowed while returning results')
    const blocked = beforeSdkCall?.()
    if (blocked) throw sandboxError(blocked)
  }
  const readonly = () => {
    throw sandboxError('Code Mode SDK results are read-only; use mermaid.mutate(...) for structured edits')
  }
  const arrayMutators = new Set(['copyWithin', 'fill', 'pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'])
  const arrayCallbackMethods = new Set(['forEach', 'map', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every', 'flatMap'])
  const rawOf = <T>(value: T): T => (value && (typeof value === 'object' || typeof value === 'function') && raw.has(value as object) ? raw.get(value as object) : value) as T
  const isMap = (value: unknown): value is Map<unknown, unknown> => value instanceof Map || Object.prototype.toString.call(value) === '[object Map]'
  const isSet = (value: unknown): value is Set<unknown> => value instanceof Set || Object.prototype.toString.call(value) === '[object Set]'
  const structuredErrorMetadata = new WeakMap<object, Record<string, unknown>>()
  /** Copy only documented structured-error data. The JSON round trip detaches
   * nested records from the host before the read-only membrane exposes them to
   * Code Mode; stacks, prototypes, accessors, and arbitrary error properties
   * never cross the boundary. */
  const structuredErrorFields = (error: unknown): Record<string, unknown> | undefined => {
    if (typeof error !== 'object' || error === null) return undefined
    const carried = structuredErrorMetadata.get(error)
    if (carried) return carried
    let fields: Record<string, unknown> | undefined
    if (error instanceof RenderCapabilityError) {
      fields = {
        name: error.name,
        code: error.code,
        output: error.output,
        family: error.family,
        decision: error.decision,
      }
    } else if (error instanceof ParsedDiagramFamilyMismatchError) {
      fields = {
        name: error.name,
        code: error.code,
        expectedFamilyId: error.expectedFamilyId,
        detectedFamilyId: error.detectedFamilyId,
      }
    } else {
      const renderDiagnostic = projectKnownRenderErrorDiagnostic(error)
      if (!renderDiagnostic) return undefined
      fields = {
        name: renderDiagnostic.code === 'ASCII_TARGET_WIDTH_IMPOSSIBLE' ? 'AsciiWidthError' : 'MermaidFamilyDetectionError',
        ...renderDiagnostic,
      }
    }
    if (!fields) return undefined
    const encoded = JSON.stringify(fields)
    return encoded === undefined ? undefined : (JSON.parse(encoded) as Record<string, unknown>)
  }
  /** A proxy may not substitute hardened child proxies for non-configurable,
   * non-writable properties on a frozen target. Move plain immutable data onto
   * an extensible envelope first so nested parsed receipts remain both
   * accessible and read-only through the Code Mode membrane. */
  const extensibleDataEnvelope = (value: object): object => {
    if (Object.isExtensible(value)) return value
    if (Array.isArray(value)) return value.slice()
    const prototype = Reflect.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null ? Object.assign(Object.create(prototype), value) : value
  }
  const hostCall = <T>(fn: () => T, genericRenderFailure = false): T => {
    try {
      return fn()
    } catch (e) {
      const fields = structuredErrorFields(e) ?? (genericRenderFailure ? { name: 'RenderError', ...projectRenderErrorDiagnostic(e) } : undefined)
      const wrapped = sandboxError((fields?.message as string) ?? (e as Error).message)
      if (fields) {
        structuredErrorMetadata.set(wrapped, fields)
        for (const [field, value] of Object.entries(fields)) {
          Object.defineProperty(wrapped, field, {
            value: harden(value),
            enumerable: true,
            writable: false,
            configurable: false,
          })
        }
      }
      throw wrapped
    }
  }
  const jsonClone = <T>(value: T): T =>
    hostCall(() => {
      if (!value || (typeof value !== 'object' && typeof value !== 'function')) return value
      const encoded = JSON.stringify(value)
      return (encoded === undefined ? undefined : JSON.parse(encoded)) as T
    })
  const iteratorOf = (items: unknown[]) => {
    let index = 0
    const iterator = {
      [Symbol.iterator]() {
        return this
      },
      next() {
        return index < items.length ? { value: items[index++], done: false } : { value: undefined, done: true }
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
    if (!id) {
      id = nextId++
      diagramIds.set(obj, id)
    }
    return id
  }
  const trustDiagram = (value: unknown): void => {
    value = rawOf(value)
    if (isDiagramLike(value)) trusted.add(value as object)
  }
  const requireTrustedDiagram = (value: unknown, verb: string): void => {
    value = rawOf(value)
    if (value && (typeof value === 'object' || typeof value === 'function') && !trusted.has(value as object)) {
      throw sandboxError(`Code Mode ${verb} input must come from mermaid.parseRegisteredMermaid(...) or mermaid.mutate(...)`)
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
          if (prop === 'forEach')
            return harden((cb: (value: unknown, key: unknown, map: Map<unknown, unknown>) => unknown, thisArg?: unknown) => {
              for (const [k, v] of target.entries()) cb.call(thisArg, harden(v), harden(k), proxy)
            })
          const got = hostCall(() => Reflect.get(target, prop, target))
          return typeof got === 'function' ? undefined : harden(got)
        },
        set() {
          return readonly()
        },
        deleteProperty() {
          return readonly()
        },
        defineProperty() {
          return readonly()
        },
        setPrototypeOf() {
          return readonly()
        },
        getOwnPropertyDescriptor(target, prop) {
          return descriptorFor(target, prop)
        },
        preventExtensions() {
          return readonly()
        },
        getPrototypeOf(target) {
          return protoFor(target)
        },
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
          if (prop === 'forEach')
            return harden((cb: (value: unknown, value2: unknown, set: Set<unknown>) => unknown, thisArg?: unknown) => {
              for (const v of target.values()) cb.call(thisArg, harden(v), harden(v), proxy)
            })
          const got = hostCall(() => Reflect.get(target, prop, target))
          return typeof got === 'function' ? undefined : harden(got)
        },
        set() {
          return readonly()
        },
        deleteProperty() {
          return readonly()
        },
        defineProperty() {
          return readonly()
        },
        setPrototypeOf() {
          return readonly()
        },
        getOwnPropertyDescriptor(target, prop) {
          return descriptorFor(target, prop)
        },
        preventExtensions() {
          return readonly()
        },
        getPrototypeOf(target) {
          return protoFor(target)
        },
      })
      hardened.set(obj, proxy)
      return rememberRaw(proxy, value) as T
    }

    if (typeof value === 'function') {
      const original = value
      const callable = (...args: unknown[]) => harden(hostCall(() => Reflect.apply(original, undefined, args)))
      const proxy = new Proxy(callable, {
        apply(_target, thisArg, args) {
          return harden(hostCall(() => Reflect.apply(original, thisArg, args)))
        },
        get(_target, prop, receiver) {
          if (forbidden(prop)) return undefined
          if (!Reflect.getOwnPropertyDescriptor(original, prop)) return undefined
          return harden(hostCall(() => Reflect.get(original, prop, receiver)))
        },
        set() {
          return readonly()
        },
        deleteProperty() {
          return readonly()
        },
        defineProperty() {
          return readonly()
        },
        setPrototypeOf() {
          return readonly()
        },
        getOwnPropertyDescriptor(_target, prop) {
          return descriptorFor(original, prop)
        },
        preventExtensions() {
          return readonly()
        },
        getPrototypeOf() {
          return protoFor(original)
        },
      })
      hardened.set(obj, proxy)
      return rememberRaw(proxy, value) as T
    }

    const proxyTarget = extensibleDataEnvelope(value as object)
    let proxy: object
    proxy = new Proxy(proxyTarget, {
      get(target, prop, receiver) {
        if (forbidden(prop)) return undefined
        if (Array.isArray(target)) {
          if (typeof prop === 'string' && arrayMutators.has(prop)) return harden(readonly)
          if (prop === Symbol.iterator || prop === 'values') return harden(() => iteratorOf(Array.prototype.map.call(target, v => harden(v))))
          if (prop === 'entries') return harden(() => iteratorOf(Array.prototype.map.call(target, (v, i) => harden([i, harden(v)]))))
          if (prop === 'keys') return harden(() => iteratorOf(Array.from({ length: target.length }, (_, i) => i)))
          if (typeof prop === 'string' && arrayCallbackMethods.has(prop)) {
            return harden((cb: (value: unknown, index: number, array: unknown) => unknown, thisArg?: unknown) => {
              const values = Array.prototype.map.call(target, v => harden(v))
              const call = (v: unknown, i: number) => cb.call(thisArg, v, i, proxy)
              if (prop === 'forEach') {
                values.forEach(call)
                return undefined
              }
              if (prop === 'map') return values.map(call)
              if (prop === 'filter') return values.filter((v, i) => call(v, i))
              if (prop === 'find') return values.find((v, i) => Boolean(call(v, i)))
              if (prop === 'findIndex') return values.findIndex((v, i) => Boolean(call(v, i)))
              if (prop === 'findLast') {
                for (let i = values.length - 1; i >= 0; i--) if (call(values[i], i)) return values[i]
                return undefined
              }
              if (prop === 'findLastIndex') {
                for (let i = values.length - 1; i >= 0; i--) if (call(values[i], i)) return i
                return -1
              }
              if (prop === 'some') return values.some((v, i) => Boolean(call(v, i)))
              if (prop === 'every') return values.every((v, i) => Boolean(call(v, i)))
              if (prop === 'flatMap') return values.flatMap(call as any)
            })
          }
          if (prop === 'toSorted') {
            return harden((compare?: (a: unknown, b: unknown) => number) => {
              const values = Array.prototype.map.call(target, v => harden(v))
              return compare ? values.slice().sort((a, b) => compare(a, b)) : values.slice().sort()
            })
          }
          if (prop === 'toReversed') return harden(() => Array.prototype.map.call(target, v => harden(v)).reverse())
          if (prop === 'toSpliced')
            return harden(function (start: number, deleteCount?: number, ...items: unknown[]) {
              const values = Array.prototype.map.call(target, v => harden(v))
              const copy = values.slice()
              if (arguments.length === 1) copy.splice(start)
              else copy.splice(start, deleteCount ?? 0, ...items.map(item => harden(rawOf(item))))
              return copy
            })
          if (prop === 'with')
            return harden((index: number, item: unknown) => {
              const values = Array.prototype.map.call(target, v => harden(v))
              const normalized = index < 0 ? values.length + index : index
              if (normalized < 0 || normalized >= values.length) throw sandboxError('Invalid array index')
              const copy = values.slice()
              copy[normalized] = harden(rawOf(item))
              return copy
            })
          if (prop === 'reduce' || prop === 'reduceRight') {
            return harden(function (cb: (previous: unknown, current: unknown, index: number, array: unknown) => unknown, initial?: unknown) {
              const values = Array.prototype.map.call(target, v => harden(v))
              const reducer = (previous: unknown, current: unknown, index: number) => cb(previous, current, index, proxy)
              return arguments.length >= 2 ? (prop === 'reduce' ? values.reduce(reducer, initial) : values.reduceRight(reducer, initial)) : prop === 'reduce' ? values.reduce(reducer) : values.reduceRight(reducer)
            })
          }
        }
        if (!Reflect.getOwnPropertyDescriptor(target, prop)) return undefined
        const got = hostCall(() => Reflect.get(target, prop, receiver))
        return typeof got === 'function' ? undefined : harden(got)
      },
      set() {
        return readonly()
      },
      deleteProperty() {
        return readonly()
      },
      defineProperty() {
        return readonly()
      },
      setPrototypeOf() {
        return readonly()
      },
      has(target, prop) {
        return forbidden(prop) ? false : Reflect.has(target, prop)
      },
      getOwnPropertyDescriptor(target, prop) {
        return descriptorFor(target, prop)
      },
      preventExtensions() {
        return readonly()
      },
      getPrototypeOf(target) {
        return protoFor(target)
      },
    })
    hardened.set(obj, proxy)
    if (proxyTarget !== obj) hardened.set(proxyTarget, proxy)
    return rememberRaw(proxy, value as object) as T
  }

  const fingerprint = (value: unknown): string | undefined => fingerprintDiagram(rawOf(value))
  const bodyKind = (value: unknown): TraceMutationBody => {
    const kind = (value as { body?: { kind?: string } } | undefined)?.body?.kind
    return kind != null && FAMILY_KINDS.has(kind as DiagramKind) ? (kind as DiagramKind) : 'opaque'
  }
  const push = (call: ExecutionTraceCall) => {
    trace?.push(call)
  }
  const sdkTarget = {
    parseRegisteredMermaid: mermaid.parseRegisteredMermaid,
    createMermaid: mermaid.createMermaid,
    buildMermaid: mermaid.buildMermaid,
    asFlowchart: mermaid.asFlowchart,
    asState: mermaid.asState,
    asSequence: mermaid.asSequence,
    asTimeline: mermaid.asTimeline,
    asClass: mermaid.asClass,
    asEr: mermaid.asEr,
    asJourney: mermaid.asJourney,
    asArchitecture: mermaid.asArchitecture,
    asXyChart: mermaid.asXyChart,
    asPie: mermaid.asPie,
    asQuadrant: mermaid.asQuadrant,
    asGantt: mermaid.asGantt,
    asMindmap: mermaid.asMindmap,
    asGitGraph: mermaid.asGitGraph,
    asRadar: mermaid.asRadar,
    asSankey: mermaid.asSankey,
    mutate: mermaid.mutate,
    verifyMermaid: mermaid.verifyMermaid,
    analyzeMermaid: mermaid.analyzeMermaid,
    analyzeMermaidSource: mermaid.analyzeMermaidSource,
    describeMermaidFacts: mermaid.describeMermaidFacts,
    describeMermaidFactsSource: mermaid.describeMermaidFactsSource,
    checkMermaid: mermaid.checkMermaid,
    checkMermaidSource: mermaid.checkMermaidSource,
    serializeMermaid: mermaid.serializeMermaid,
    renderMermaidSVG: mermaid.renderMermaidSVG,
    renderMermaidSVGWithReceipt: mermaid.renderMermaidSVGWithReceipt,
    renderMermaidASCII: mermaid.renderMermaidASCII,
    renderMermaidASCIIWithReceipt: mermaid.renderMermaidASCIIWithReceipt,
    layoutMermaidWithReceipt: mermaid.layoutMermaidWithReceipt,
    // Read-only op discovery: field shapes / enum values / constraint notes and
    // compact signatures for a family's ops, so a Code Mode script can look up
    // exact op shapes at runtime instead of guessing (or triggering INVALID_OP).
    describeOps: mermaid.describeOps,
    opSignatures: mermaid.opSignatures,
  } as unknown as typeof mermaid
  const sdkProps = new Set<string | symbol>(Reflect.ownKeys(sdkTarget))

  const sdkValues = new Map<string | symbol, unknown>()
  const sdkValue = (target: typeof sdkTarget, prop: string | symbol): unknown => {
    if (forbidden(prop) || !sdkProps.has(prop)) return undefined
    if (sdkValues.has(prop)) return sdkValues.get(prop)
    let value: unknown
    if (prop === 'parseRegisteredMermaid')
      value = harden((source: string) => {
        assertOpen()
        if (typeof source !== 'string') throw sandboxError(`Code Mode ${prop} source must be a string`)
        const r = hostCall(() => target.parseRegisteredMermaid(source))
        if (r.ok) trustDiagram(r.value)
        const diagram = r.ok ? idOf(r.value) : undefined
        push({ verb: 'parse', diagram, source: r.ok ? (r.value.body.kind === 'opaque' ? r.value.body.source : r.value.canonicalSource) : undefined })
        return harden(r)
      })
    else if (prop === 'createMermaid')
      value = harden((kind: unknown, opts?: unknown) => {
        assertOpen()
        const r = hostCall(() => target.createMermaid(kind as DiagramKind, jsonClone(opts) as Parameters<typeof target.createMermaid>[1]))
        trustDiagram(r)
        push({ verb: 'create', family: FAMILY_KINDS.has(kind as DiagramKind) ? (kind as DiagramKind) : undefined, diagram: idOf(r), ok: true })
        return harden(r)
      })
    else if (prop === 'buildMermaid')
      value = harden((kind: unknown, ops: unknown, opts?: unknown) => {
        assertOpen()
        const opsForHost = jsonClone(ops) as Parameters<typeof target.buildMermaid>[1]
        // buildChecked shape-validates each op before the mutator, so a malformed
        // op fails with a prescriptive INVALID_OP error instead of silently
        // building a mangled diagram — the same check the declarative path uses.
        const r = hostCall(() => mermaid.buildChecked(kind as DiagramKind, opsForHost as unknown[], jsonClone(opts) as Parameters<typeof target.buildMermaid>[2]))
        if (r.ok) trustDiagram(r.value)
        push({
          verb: 'create',
          family: FAMILY_KINDS.has(kind as DiagramKind) ? (kind as DiagramKind) : undefined,
          diagram: r.ok ? idOf(r.value) : undefined,
          ops: Array.isArray(ops) ? ops.length : undefined,
          ok: r.ok,
        })
        return harden(r)
      })
    else if (typeof prop === 'string' && prop.startsWith('as') && prop in target) {
      value = harden((d: any) => {
        assertOpen()
        requireTrustedDiagram(d, String(prop))
        const input = idOf(d)
        const r = hostCall(() => ((target as any)[prop] as (diagram: any) => unknown)(rawOf(d)))
        if (r) trustDiagram(r)
        push({ verb: 'narrow', family: narrowerFamily(prop), input, ok: r !== null })
        return harden(r)
      })
    } else if (prop === 'mutate')
      value = harden((d: any, op: any) => {
        assertOpen()
        requireTrustedDiagram(d, 'mutate')
        const opForHost = jsonClone(op)
        const call: Extract<ExecutionTraceCall, { verb: 'mutate' }> = {
          verb: 'mutate',
          body: bodyKind(rawOf(d)),
          input: idOf(d),
          opKind: typeof opForHost === 'object' && opForHost && 'kind' in opForHost ? String((opForHost as { kind: unknown }).kind) : undefined,
        }
        push(call)
        // mutateChecked runs the shape validator before the mutator: the SAME
        // choke point the declarative applyOps path funnels through, so an op
        // rejected here is rejected identically there (no second validator).
        const r = hostCall(() => mermaid.mutateChecked(rawOf(d), opForHost))
        if (r.ok) {
          trustDiagram(r.value)
          call.output = idOf(r.value)
          call.fingerprint = fingerprint(r.value)
        }
        return harden(r)
      })
    else if (prop === 'verifyMermaid')
      value = harden((input: any, opts?: any) => {
        assertOpen()
        requireTrustedDiagram(input, 'verifyMermaid')
        const r = hostCall(() => target.verifyMermaid(rawOf(input), opts))
        const diagram = idOf(input)
        push({ verb: 'verify', diagram, ok: r.ok, inspected: false, fingerprint: fingerprint(input) })
        return harden(
          new Proxy(r, {
            get(verifyTarget, verifyProp, verifyReceiver) {
              if (isClosed?.()) throw sandboxError('Code Mode SDK calls are not allowed while returning results')
              if (verifyProp === 'ok' || verifyProp === 'warnings' || verifyProp === 'layout') {
                push({ verb: 'verify_inspect', diagram, property: verifyProp })
              }
              if (forbidden(verifyProp)) return undefined
              return harden(hostCall(() => Reflect.get(verifyTarget, verifyProp, verifyReceiver)))
            },
            set() {
              return readonly()
            },
            deleteProperty() {
              return readonly()
            },
            defineProperty() {
              return readonly()
            },
            setPrototypeOf() {
              return readonly()
            },
            getOwnPropertyDescriptor(target, prop) {
              return descriptorFor(target, prop)
            },
            preventExtensions() {
              return readonly()
            },
            getPrototypeOf(target) {
              return protoFor(target)
            },
          }),
        )
      })
    else if (prop === 'analyzeMermaid')
      value = harden((d: any) => {
        assertOpen()
        requireTrustedDiagram(d, 'analyzeMermaid')
        const r = hostCall(() => target.analyzeMermaid(rawOf(d)))
        push({ verb: 'analyze', diagram: idOf(d), ok: true, fingerprint: fingerprint(d) })
        return harden(r)
      })
    else if (prop === 'analyzeMermaidSource')
      value = harden((source: string) => {
        assertOpen()
        if (typeof source !== 'string') throw sandboxError('Code Mode analyzeMermaidSource source must be a string')
        const r = hostCall(() => target.analyzeMermaidSource(source))
        push({ verb: 'analyze', source, ok: r.ok })
        return harden(r)
      })
    else if (prop === 'describeMermaidFacts')
      value = harden((d: any) => {
        assertOpen()
        requireTrustedDiagram(d, 'describeMermaidFacts')
        const r = hostCall(() => target.describeMermaidFacts(rawOf(d)))
        push({ verb: 'facts', diagram: idOf(d), ok: true, fingerprint: fingerprint(d) })
        return harden(r)
      })
    else if (prop === 'describeMermaidFactsSource')
      value = harden((source: string) => {
        assertOpen()
        if (typeof source !== 'string') throw sandboxError('Code Mode describeMermaidFactsSource source must be a string')
        const r = hostCall(() => target.describeMermaidFactsSource(source))
        push({ verb: 'facts', source, ok: r.ok })
        return harden(r)
      })
    else if (prop === 'checkMermaid')
      value = harden((d: any, spec: any) => {
        assertOpen()
        requireTrustedDiagram(d, 'checkMermaid')
        const r = hostCall(() => target.checkMermaid(rawOf(d), jsonClone(spec) as Parameters<typeof target.checkMermaid>[1]))
        push({ verb: 'check', diagram: idOf(d), ok: r.ok, fingerprint: fingerprint(d) })
        return harden(r)
      })
    else if (prop === 'checkMermaidSource')
      value = harden((source: string, spec: any) => {
        assertOpen()
        if (typeof source !== 'string') throw sandboxError('Code Mode checkMermaidSource source must be a string')
        const r = hostCall(() => target.checkMermaidSource(source, jsonClone(spec) as Parameters<typeof target.checkMermaidSource>[1]))
        push({ verb: 'check', source, ok: r.ok ? r.value.ok : false })
        return harden(r)
      })
    else if (prop === 'serializeMermaid')
      value = harden((d: any) => {
        assertOpen()
        requireTrustedDiagram(d, 'serializeMermaid')
        const source = hostCall(() => target.serializeMermaid(rawOf(d)))
        push({ verb: 'serialize', diagram: idOf(d), source, fingerprint: fingerprint(d) })
        return source
      })
    else if (prop === 'renderMermaidSVG' || prop === 'renderMermaidSVGWithReceipt' || prop === 'renderMermaidASCII' || prop === 'renderMermaidASCIIWithReceipt' || prop === 'layoutMermaidWithReceipt')
      value = harden((input: any, opts?: any) => {
        assertOpen()
        if (input && typeof input === 'object') requireTrustedDiagram(input, String(prop))
        const isAscii = prop === 'renderMermaidASCII' || prop === 'renderMermaidASCIIWithReceipt'
        const configCallback = opts?.onConfigDiagnostic
        const projectionCallback = isAscii ? opts?.onProjectionDiagnostic : undefined
        if (configCallback !== undefined && typeof configCallback !== 'function') {
          throw sandboxError(`Code Mode ${String(prop)} onConfigDiagnostic must be a function`)
        }
        if (projectionCallback !== undefined && typeof projectionCallback !== 'function') {
          throw sandboxError(`Code Mode ${String(prop)} onProjectionDiagnostic must be a function`)
        }
        let cloned = jsonClone(opts) as Record<string, unknown> | undefined
        // The host policy is applied after cloning caller data, so even an
        // explicit weaker value cannot cross any hosted render/layout boundary.
        // Local Code Mode supplies no policy and retains caller-selectable
        // behavior.
        if (hostPolicy) cloned = { ...(cloned ?? {}), ...hostPolicy.render }
        const configDiagnostics: unknown[] = []
        const projectionDiagnostics: unknown[] = []
        if (configCallback || projectionCallback) cloned ??= {}
        if (configCallback) {
          cloned!.onConfigDiagnostic = (diagnostic: unknown) => configDiagnostics.push(diagnostic)
        }
        if (projectionCallback) {
          cloned!.onProjectionDiagnostic = (diagnostic: unknown) => projectionDiagnostics.push(diagnostic)
        }
        const rendered = hostCall(() => ((target as any)[prop] as (diagram: any, options?: any) => unknown)(rawOf(input), cloned), true)
        for (const diagnostic of configDiagnostics) configCallback(harden(jsonClone(diagnostic)))
        for (const diagnostic of projectionDiagnostics) projectionCallback(harden(jsonClone(diagnostic)))
        // Render artifacts/receipts are immutable host records. Clone to an
        // extensible data envelope before hardening so Proxy descriptor
        // invariants remain valid when Code Mode returns the artifact as JSON.
        return jsonClone(rendered)
      })
    else if (prop === 'describeOps' || prop === 'opSignatures')
      value = harden((family: any) => {
        assertOpen()
        if (typeof family !== 'string') throw sandboxError(`Code Mode ${String(prop)} family must be a string`)
        if (!mermaid.hasOpSchema(family)) {
          const families = mermaid.knownBuiltinFamilies().filter(mermaid.hasOpSchema)
          throw sandboxError(`Code Mode ${String(prop)} family must be one of: ${families.join(', ')}`)
        }
        // Pure lookup over static op schemas — no diagram, no trace, read-only.
        return harden(hostCall(() => ((target as any)[prop] as (f: string) => unknown)(family)))
      })
    sdkValues.set(prop, value)
    return value
  }

  // Marshal a Code Mode RETURN value at the boundary the host owns. A sandbox
  // that returns a live SDK diagram (or a Result wrapping one) can't be JSON-
  // stringified — it is a hardened provenance proxy over Maps, and the verify
  // proxy actively throws once the SDK is closed. Rather than surface the raw
  // "non-serializable" failure, marshal the ONE shape agents naturally return —
  // a trusted diagram — to the SAME canonical envelope the declarative mutate/
  // build tools emit: { ok, family, source, verify }. Everything else passes
  // through untouched (plain data already stringifies; genuinely unserializable
  // values still error, now with a prescriptive hint — see codeModeReturnHint).
  // Runs host-side on the RAW object, so it is safe after the SDK is closed.
  const marshalResult = (value: unknown): unknown => {
    try {
      const rawObj = rawOf(value)
      // Unwrap a Result<diagram> ({ ok:true, value:<diagram> }) to the diagram.
      const candidate = rawObj && typeof rawObj === 'object' && !Array.isArray(rawObj) && (rawObj as { ok?: unknown }).ok === true && 'value' in (rawObj as object) ? rawOf((rawObj as { value: unknown }).value) : rawObj
      if (isDiagramLike(candidate) && trusted.has(candidate as object)) {
        const d = candidate as unknown as Parameters<typeof mermaid.serializeMermaid>[0] & { kind: DiagramKind }
        const verification = mermaid.verifyMermaid(d)
        const summary = mermaid.verifySummary(verification)
        if (!verification.ok) {
          return {
            ok: false,
            family: d.kind,
            error: {
              code: 'VERIFY_FAILED',
              message: 'returned diagram failed verify; source was not emitted',
              details: summary.warnings,
            },
          }
        }
        return { ok: true, family: d.kind, source: mermaid.serializeMermaid(d), verify: summary }
      }
    } catch {
      // A returned value whose inspection trips a post-close proxy guard (e.g. a
      // verify result) is not a plain diagram — fall through and let the normal
      // serializer produce the prescriptive non-serializable error.
    }
    return value
  }
  const proxy = new Proxy(sdkTarget, {
    get(target, prop) {
      return sdkValue(target, prop)
    },
    set() {
      return readonly()
    },
    deleteProperty() {
      return readonly()
    },
    defineProperty() {
      return readonly()
    },
    setPrototypeOf() {
      return readonly()
    },
    getOwnPropertyDescriptor(target, prop) {
      if (!sdkProps.has(prop) || forbidden(prop)) return undefined
      const desc = Reflect.getOwnPropertyDescriptor(target, prop)
      return desc && 'value' in desc ? { ...desc, value: sdkValue(target, prop) } : undefined
    },
    preventExtensions() {
      return readonly()
    },
    getPrototypeOf(target) {
      return protoFor(target)
    },
    has(_target, prop) {
      return sdkProps.has(prop) && !forbidden(prop)
    },
    ownKeys() {
      return Array.from(sdkProps)
    },
  }) as typeof mermaid
  resultMarshallers.set(proxy, marshalResult)
  return proxy
}

/** Per-facade result marshallers, keyed by the SDK proxy handed to a sandbox.
 *  Host-only: the sandbox never sees this map; the runner looks up the marshaller
 *  for its facade and applies it to the returned value before serialization. */
const resultMarshallers = new WeakMap<object, (value: unknown) => unknown>()

/**
 * Marshal a Code Mode return `value` produced against `sdk` (the proxy from
 * createTracingMermaid): a trusted diagram (or Result wrapping one) becomes the
 * canonical { ok, family, source, verify } envelope; anything else is returned
 * unchanged. The single boundary both runners (node:vm sandbox and the workerd
 * harness) call before serializing a result.
 */
export function marshalCodeModeResult(sdk: unknown, value: unknown): unknown {
  const fn = sdk && typeof sdk === 'object' ? resultMarshallers.get(sdk as object) : undefined
  return fn ? fn(value) : value
}

/** A one-line, prescriptive tail for a `non-serializable:` error: point the
 *  caller at the plain-data return shapes that always serialize, so a returned
 *  SDK object (verify result, narrowed view, custom nesting) is a fixable
 *  mistake rather than a dead end. */
export const CODE_MODE_RETURN_HINT = 'return plain data instead — e.g. serializeMermaid(d) for a diagram, or read the fields you need (verifyMermaid(d).ok, .warnings); the declarative mutate/build tools return a ready { ok, family, source, verify } envelope'

function fingerprintDiagram(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  if (!('body' in value) || !('canonicalSource' in value)) return undefined
  try {
    return JSON.stringify(value, jsonReplacer)
  } catch {
    return undefined
  }
}

/** Kind/narrower lookup tables derived from the family metadata (single source of truth). */
const FAMILY_KINDS: ReadonlySet<DiagramKind> = new Set(BUILTIN_FAMILY_METADATA.map(m => m.id))
const NARROWER_TO_FAMILY: ReadonlyMap<string, DiagramKind> = new Map(BUILTIN_FAMILY_METADATA.map(m => [m.narrower, m.id]))

function narrowerFamily(prop: string | symbol): TraceNarrowFamily {
  const family = NARROWER_TO_FAMILY.get(String(prop))
  if (!family) throw new Error(`Unknown Code Mode narrower: ${String(prop)}`)
  return family
}

/**
 * Generate candidate wrappings in order of preference: expression form first
 * (handles bare expressions including objects/arrows/templates), then
 * statement form (handles multi-statement bodies with `return` etc.). The
 * first that compiles wins. Code Mode is deliberately synchronous: allowing
 * Promise jobs after `vm.runInContext` lets sandbox code block the host event
 * loop outside the VM timeout.
 */
export function expressionFirstWraps(code: string): string[] {
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

export function unsupportedCodeReason(code: string): string | undefined {
  const ast = parseCodeModeAst(code)
  if (!ast) return undefined // Let the selected runtime return the syntax error.
  let usesAsync = false
  let usesRealm = false
  walkJavaScriptAst(ast, (node, parent, parentKey) => {
    if (node.type === 'ImportExpression' || node.type === 'AwaitExpression') usesAsync = true
    if ('async' in node && node.async === true) usesAsync = true
    if (node.type !== 'Identifier' || !('name' in node) || typeof node.name !== 'string') return
    // Identifier spellings used only as object/member property names do not
    // reference the corresponding global. Preserve the explicit Array.fromAsync
    // rejection because that is the actual disabled async intrinsic.
    const propertyNameOnly = (parentKey === 'key' && parent?.computed !== true) || (parent?.type === 'MemberExpression' && parentKey === 'property' && parent.computed === false)
    if (propertyNameOnly && !(node.name === 'fromAsync' && parent?.type === 'MemberExpression' && (parent.object as { type?: unknown; name?: unknown } | undefined)?.type === 'Identifier' && (parent.object as { name?: unknown }).name === 'Array')) return
    if (SYNC_UNSUPPORTED_IDENTIFIERS.has(node.name)) usesAsync = true
    if (REALM_UNSUPPORTED_IDENTIFIERS.has(node.name)) usesRealm = true
  })
  if (usesAsync) {
    return 'Code Mode is synchronous; async/await, Promise jobs, finalizers, queueMicrotask, Array.fromAsync, and dynamic import are not supported'
  }
  if (usesRealm) {
    return 'Code Mode does not expose blocking or realm-creating globals'
  }
  return undefined
}

const SYNC_UNSUPPORTED_IDENTIFIERS = new Set(['async', 'await', 'Promise', 'AsyncDisposableStack', 'FinalizationRegistry', 'WeakRef', 'fromAsync', 'queueMicrotask'])
const REALM_UNSUPPORTED_IDENTIFIERS = new Set(['Atomics', 'SharedArrayBuffer', 'ShadowRealm', 'WebAssembly'])

/** Parse the same expression-first/statement-fallback language Code Mode runs.
 * A real ECMAScript parser is intentional here: slash heuristics cannot
 * distinguish regex literals from division safely and previously created both
 * false positives and a dynamic-import screening bypass. */
function parseCodeModeAst(code: string): AcornNode | undefined {
  const stripped = code.trim().replace(/;\s*$/, '')
  const candidates = [
    `(${stripped})`,
    `function __agent_code__(){\n${code}\n}`,
    // Parse otherwise-invalid top-level await so it is rejected before an
    // isolate/CPU budget is allocated and telemetry remains truthful.
    `async function __agent_code__(){\n${code}\n}`,
  ]
  for (const candidate of candidates) {
    try {
      return parseJavaScript(candidate, { ecmaVersion: 'latest', sourceType: 'script' })
    } catch {
      // Try the statement body after expression parsing fails. If both fail,
      // the runtime owns the syntax diagnostic.
    }
  }
  return undefined
}

function walkJavaScriptAst(node: AcornNode, visit: (node: AcornNode & Record<string, unknown>, parent?: AcornNode & Record<string, unknown>, parentKey?: string) => void, parent?: AcornNode & Record<string, unknown>, parentKey?: string): void {
  const record = node as AcornNode & Record<string, unknown>
  visit(record, parent, parentKey)
  for (const [key, value] of Object.entries(record)) {
    if (key === 'start' || key === 'end' || key === 'type') continue
    if (Array.isArray(value)) {
      for (const child of value) if (isAcornNode(child)) walkJavaScriptAst(child, visit, record, key)
    } else if (isAcornNode(value)) {
      walkJavaScriptAst(value, visit, record, key)
    }
  }
}

function isAcornNode(value: unknown): value is AcornNode {
  return Boolean(value && typeof value === 'object' && 'type' in value && typeof (value as { type?: unknown }).type === 'string')
}
function jsonReplacer(_k: string, v: unknown): unknown {
  if (v instanceof Map) return Object.fromEntries(v)
  if (v instanceof Set) return Array.from(v)
  return v
}
