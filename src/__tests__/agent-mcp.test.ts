// Sandbox + MCP, including sad paths (which I skipped in prior loops).

import { beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyOps, createMermaid, mutate, mutateChecked, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/core.ts'
import { renderMermaidSVG } from '../index.ts'
import vm from 'node:vm'
import pkg from '../../package.json'
import { BUILTIN_FAMILY_METADATA, getFamily, replaceFamilyForTest } from '../agent/families.ts'
import { runCli, runBatchLine } from '../cli/index.ts'
import { MCP_CLI_HELP, parseMcpCliOptions, runMcpCli } from '../mcp/mcp-cli.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { handleRequest, LOCAL_TOOLS } from '../mcp/server.ts'
import { captureCli as capture } from './helpers/cli-capture.ts'
import { useTempDirs } from './helpers/temp-dir.ts'
import { useTestChildren } from './helpers/test-child.ts'

const runChild = useTestChildren(20_000)

const temp = useTempDirs()

describe('source-preserving edits across agent channels', () => {
  test.each([
    ['classDiagram\nnamespace `~`{class P}', { kind: 'add_member', class: 'P', text: '+read()' }],
    ['classDiagram\nnamespace `~T~A::B` {\nclass `IPC::Sender`\n}', { kind: 'add_member', class: 'IPC::Sender', text: '+read()' }],
    ['flowchart TD\nA[Old]-->B\nclassDef retained border:1px s:::colid red', { kind: 'set_label', target: 'A', label: 'Reviewed' }],
  ] as const)('retains source, warnings and atomic results in library, CLI and MCP: %s', async (source, op) => {
    const result = applyOps({ source, ops: [op], mode: 'source-preserving' })
    expect(result).toMatchObject({ ok: true, mode: 'source-preserving', verify: { ok: true, warnings: expect.arrayContaining([expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX' })]) } })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.source.startsWith(source)).toBe(true)
    expect(applyOps({ source, ops: [op] }).ok).toBe(false)
    const file = join(temp.dir('source-mode-'), 'diagram.mmd')
    writeFileSync(file, source)
    const cli = capture(() => runCli(['mutate', file, '--op', JSON.stringify(op), '--preserve-source', '--json']))
    expect(cli.code).toBe(0)
    expect(JSON.parse(cli.out)).toMatchObject({ ok: true, source: result.source, mode: 'source-preserving' })
    expect(runBatchLine(JSON.stringify({ op: 'mutate', source, mutation: op, preserveSource: true }))).toMatchObject({ ok: true, data: { source: result.source, mode: 'source-preserving' } })
    const response = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'mutate', arguments: { source, ops: [op], mode: 'source-preserving' } } })
    expect(JSON.parse((response!.result as any).content[0].text)).toEqual(result)
    const script = await executeInSandbox(`const d=mermaid.parseRegisteredMermaid(${JSON.stringify(source)}).value; const edited=mermaid.mutatePreservingSource(d,${JSON.stringify(op)}); if(!edited.ok) return edited; return {source:edited.value.source, warnings:mermaid.verifyMermaid(edited.value.diagram).warnings};`)
    expect(script.ok).toBe(true)
    expect(script.value).toMatchObject({ source: result.source, warnings: expect.arrayContaining([expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX' })]) })
    const direct = await executeInSandbox(`const d=mermaid.parseRegisteredMermaid(${JSON.stringify(source)}).value; return mermaid.mutatePreservingSource(d,${JSON.stringify(op)});`)
    expect(direct.ok).toBe(true)
    expect(direct.value).toEqual(result)
    const failed = applyOps({ source, ops: [op, { kind: 'invalid_second_op' }], mode: 'source-preserving' })
    expect(failed).toMatchObject({ ok: false, opIndex: 1 })
    expect('source' in failed).toBe(false)
  })
  test('refuses invalid modes and source-preserving builders', () => {
    for (const mode of ['unknown', null, false]) expect(applyOps({ source: 'flowchart TD\nA', ops: [], mode } as any).ok).toBe(false)
    expect(applyOps({ family: 'class', ops: [{ kind: 'add_class', id: 'A' }], mode: 'source-preserving' }).ok).toBe(false)
  })
})

describe('sandbox — happy', () => {
  test('flowchart workflow', async () => {
    const r = await executeInSandbox(`
      const r0 = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r0.value); if (!flow) return { kind: r0.value.kind }
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'C', label: 'Cache' })
      const v = mermaid.verifyMermaid(r1.value); if (!v.ok) return { warnings: v.warnings }
      return { source: mermaid.serializeMermaid(r1.value) }
    `)
    expect(r.ok && (r.value as any).source.includes('Cache')).toBe(true)
  })
  test('sequence workflow', async () => {
    const r = await executeInSandbox(`
      const r0 = mermaid.parseRegisteredMermaid('sequenceDiagram\\n  A->>B: Hi')
      const seq = mermaid.asSequence(r0.value); if (!seq) return { kind: r0.value.kind }
      const r1 = mermaid.mutate(seq, { kind: 'add_message', from: 'B', to: 'A', text: 'Bye', style: 'reply' })
      const v = mermaid.verifyMermaid(r1.value); if (!v.ok) return { warnings: v.warnings }
      return { msgs: r1.value.body.messages.length }
    `)
    expect(r.ok && (r.value as any).msgs).toBe(2)
  })
  test('Architecture B04 workflow stays typed in Code Mode', async () => {
    const r = await executeInSandbox(`
      const r0 = mermaid.parseRegisteredMermaid('architecture-beta\\n  accTitle: Topology\\n  group app[App]\\n  service api[API] in app\\n  junction bus\\n  api{group}:R --> L:bus')
      const arch = mermaid.asArchitecture(r0.value); if (!arch) return { kind: r0.value.body.kind }
      const r1 = mermaid.mutate(arch, { kind: 'update_edge', index: 0, fromBoundary: 'item', label: 'events' })
      if (!r1.ok) return { error: r1.error }
      const r2 = mermaid.mutate(r1.value, { kind: 'set_group_label', id: 'app', label: 'App Plane' })
      const v = mermaid.verifyMermaid(r2.value); if (!v.ok) return { warnings: v.warnings }
      return { source: mermaid.serializeMermaid(r2.value), junctions: r2.value.body.junctions.length }
    `)
    expect(r.ok && (r.value as any).junctions).toBe(1)
    expect((r.value as any).source).toContain('api:R -[events]-> L:bus')
    expect((r.value as any).source).toContain('group app[App Plane]')
  })
  test('ValidDiagram render inputs use mutated body, not stale canonicalSource', () => {
    const { parseRegisteredMermaid, asFlowchart, mutate, serializeMermaid, renderMermaidSVG, renderMermaidASCII } = require('../agent/index.ts')
    const r0 = parseRegisteredMermaid('flowchart TD\n  API --> DB')
    const flow = asFlowchart(r0.value)
    const r1 = mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
    expect(serializeMermaid(r1.value)).toContain('Cache')
    expect(renderMermaidSVG(r1.value)).toContain('Cache')
    expect(renderMermaidASCII(r1.value, { useAscii: true })).toContain('Cache')
  })
  test('blank-slate workflow: buildMermaid result is trusted and chains into mutate', async () => {
    const r = await executeInSandbox(`
      const b = mermaid.buildMermaid('flowchart', [
        { kind: 'add_node', id: 'A', label: 'Start' },
        { kind: 'add_edge', from: 'A', to: 'B', label: 'go' },
      ], { direction: 'LR' })
      if (!b.ok) return { error: b.error }
      const r1 = mermaid.mutate(b.value, { kind: 'add_node', id: 'C', label: 'Cache' })
      const v = mermaid.verifyMermaid(r1.value); if (!v.ok) return { warnings: v.warnings }
      return { source: mermaid.serializeMermaid(r1.value) }
    `)
    expect(r.ok && (r.value as any).source).toBe('flowchart LR\n  A[Start] -->|go| B\n  C[Cache]\n')
  })
  test('createMermaid result is trusted by mutate/serialize', async () => {
    const r = await executeInSandbox(`
      const d = mermaid.createMermaid('pie')
      const m = mermaid.mutate(d, { kind: 'add_slice', label: 'A', value: 5 })
      return { ok: m.ok, source: mermaid.serializeMermaid(m.value) }
    `)
    expect(r.ok && (r.value as any).source).toBe('pie\n  "A" : 5\n')
  })

  test('returned renderable empty diagrams keep verification diagnostics', async () => {
    for (const code of ['return mermaid.createMermaid("flowchart")', 'return mermaid.buildMermaid("flowchart", [])']) {
      const result = await executeInSandbox(code)
      expect(result.ok).toBe(true)
      expect(result.value).toMatchObject({
        ok: true,
        family: 'flowchart',
        source: 'flowchart TD\n',
        verify: { ok: false, warnings: [{ code: 'EMPTY_DIAGRAM' }] },
      })
    }
  })
  test('console captured', async () => {
    const r = await executeInSandbox(`console.log('a','b'); return 1`)
    expect(r.logs).toEqual(['a b'])
  })
})

describe('sandbox — isolation + sad paths', () => {
  test('process/require/fetch/eval/Function unreachable', async () => {
    const r = await executeInSandbox(`return { p: typeof process, r: typeof require, f: typeof fetch, e: typeof eval, fn: typeof Function }`)
    expect(r.value).toMatchObject({ p: 'undefined', r: 'undefined', f: 'undefined', e: 'undefined', fn: 'undefined' })
  })
  test('dynamic code generation is blocked', async () => {
    expect((await executeInSandbox(`return eval('2+3')`)).ok).toBe(false)
    expect((await executeInSandbox(`return Function('return 7')()`)).ok).toBe(false)
    expect((await executeInSandbox(`return Object.constructor('return 7')()`)).ok).toBe(false)
    expect((await executeInSandbox(`return console.log.constructor('return 7')()`)).ok).toBe(false)
    expect((await executeInSandbox(`const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B'); const flow = mermaid.asFlowchart(r.value); return flow.body.graph.edges.push.constructor('return 7')()`)).ok).toBe(false)
    expect((await executeInSandbox(`const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B'); return Object.getOwnPropertyDescriptor(r.value, 'body').value.constructor.constructor('return 7')()`)).ok).toBe(false)
    expect((await executeInSandbox(`try { const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B'); const flow = mermaid.asFlowchart(r.value); flow.body.graph.edges.push({ source: 'B', target: 'C' }) } catch (e) { return e.constructor.constructor('return 7')() }`)).ok).toBe(false)
    expect((await executeInSandbox(`try { const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B'); Object.preventExtensions(r.value) } catch (e) { return e.constructor.constructor('return 7')() }`)).ok).toBe(false)
    expect((await executeInSandbox(`return mermaid.parseRegisteredMermaid.constructor('return 7')()`)).ok).toBe(false)
    expect(
      (await executeInSandbox(`const fakeSource = { replace: String.prototype.replace.bind('flowchart TD\\n  A --> B'), split: String.prototype.split.bind('flowchart TD\\n  A --> B'), trim: String.prototype.trim.bind('flowchart TD\\n  A --> B') }; return mermaid.parseRegisteredMermaid(fakeSource)`)).error,
    ).toContain('source must be a string')
    expect((await executeInSandbox(`const r = mermaid.parseRegisteredMermaid('flowchart TD\\n A --> B'); return r.value.constructor.constructor('return 7')()`)).ok).toBe(false)
    expect((await executeInSandbox(`return globalThis.constructor.constructor('return typeof process')()`)).ok).toBe(false)
    expect((await executeInSandbox(`Error.prepareStackTrace = (_, frames) => frames; return new Error().stack[0].constructor.constructor('return process.cwd()')()`)).ok).toBe(false)
    const stackOverride = await executeInSandbox(`try { Error.prepareStackTrace = (_, frames) => frames } catch {} return Array.isArray(new Error().stack)`)
    expect(stackOverride.ok).toBe(true)
    expect(stackOverride.value).toBe(false)
    expect((await executeInSandbox(`return typeof mermaid.registerFamily`)).value).toBe('undefined')
    expect((await executeInSandbox(`const d = Object.getOwnPropertyDescriptor(mermaid, 'registerFamily'); return d && d.value.constructor.constructor('return 7')()`)).value).toBeNull()
  })

  test('SDK results are read-only; structured edits must go through mutate', async () => {
    const setProp = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.edges[0].target = 'C'
      return 'unreachable'
    `)
    const pushArray = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.edges.push({ source: 'B', target: 'C' })
      return 'unreachable'
    `)
    const mapSet = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.nodes.set('C', {})
      return 'unreachable'
    `)
    const toJson = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      r.value.toJSON = () => 'hide-drift'
      return 'unreachable'
    `)
    const constructHostHelper = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      const arr = new (flow.body.graph.edges.toSpliced)(0, 0)
      return arr.constructor.constructor('return process.cwd()')()
    `)
    const reflectConstructNewTarget = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      const C = flow.body.graph.edges.toSpliced
      const o = Reflect.construct(Object, [], C)
      return o.constructor.constructor('return process.cwd()')()
    `)
    const mapOwnGetOverride = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.nodes.get = function () { return this.constructor.constructor('return process.cwd()')() }
      return flow.body.graph.nodes.get('A')
    `)
    const mapIteratorInjection = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.nodes[Symbol.iterator] = function * () { yield ['C', { id: 'C', label: 'Cache', shape: 'rectangle' }] }
      return mermaid.serializeMermaid(flow)
    `)
    const mapDefineProperty = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      Object.defineProperty(flow.body.graph.nodes, 'get', { value: () => 'owned' })
      return 'unreachable'
    `)
    const manualClone = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const clone = JSON.parse(JSON.stringify(r.value))
      return mermaid.mutate(clone, { kind: 'add_node', id: 'C', label: 'C' })
    `)
    const forgedProxy = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const clone = JSON.parse(JSON.stringify(r.value))
      const forged = new Proxy(clone, { has: () => true, get: (target, prop) => target[prop] })
      return mermaid.mutate(forged, { kind: 'add_node', id: 'C', label: 'C' })
    `)
    expect(setProp.error).toContain('read-only')
    expect(pushArray.error).toContain('read-only')
    expect(mapSet.error).toContain('read-only')
    expect(toJson.error).toContain('read-only')
    expect(constructHostHelper.ok).toBe(false)
    expect(reflectConstructNewTarget.ok).toBe(false)
    expect(mapOwnGetOverride.error).toContain('read-only')
    expect(mapIteratorInjection.error).toContain('read-only')
    expect(mapDefineProperty.error).toContain('read-only')
    expect(manualClone.error).toContain('must come from mermaid.parseRegisteredMermaid')
    expect(forgedProxy.error).toContain('must come from mermaid.parseRegisteredMermaid')
  })

  test('collection callback helpers expose hardened values, not raw host objects', async () => {
    const ctor = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      let leaked = 'blocked'
      flow.body.graph.edges.forEach(e => { try { leaked = e.constructor.constructor('return typeof process')() } catch (_) { leaked = 'blocked' } })
      return leaked
    `)
    const arrayMutation = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.edges.map(e => { e.target = 'C'; return e })
      return mermaid.serializeMermaid(flow)
    `)
    const mapMutation = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.nodes.forEach(n => { n.label = 'Changed' })
      return mermaid.serializeMermaid(flow)
    `)
    const findLastCtor = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      let leaked = 'blocked'
      flow.body.graph.edges.findLast(e => { try { leaked = e.constructor.constructor('return typeof process')() } catch (_) { leaked = 'blocked' }; return false })
      return leaked
    `)
    const toSortedCtor = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B\\n  C --> D')
      const flow = mermaid.asFlowchart(r.value)
      const edges = flow.body.graph.edges
      const compared = new Set()
      const escapes = []
      const sorted = edges.toSorted((a, b) => {
        for (const edge of [a, b]) {
          compared.add(edge.source)
          try { escapes.push(edge.constructor.constructor('return typeof process')()) } catch (_) { escapes.push('blocked') }
        }
        return b.source.localeCompare(a.source)
      })
      return { compared: [...compared].sort(), escapes: [...new Set(escapes)], sorted: sorted.map(e => e.source), original: edges.map(e => e.source) }
    `)
    const mapGetOrInsert = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.nodes.getOrInsert('C', { id: 'C', label: 'Cache', shape: 'rectangle' })
      return mermaid.serializeMermaid(flow)
    `)
    const defineGetter = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.edges[0].__defineGetter__('target', () => 'C')
      return mermaid.serializeMermaid(flow)
    `)
    const lookupProtoMapMutator = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      const protoGetter = flow.body.graph.nodes.__lookupGetter__('__proto__')
      const proto = protoGetter && protoGetter.call(flow.body.graph.nodes)
      proto.getOrInsert.call(flow.body.graph.nodes, 'C', { id: 'C', label: 'C', shape: 'rectangle' })
      return mermaid.serializeMermaid(flow)
    `)
    const callbackThisArgEscape = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      let leaked = 'blocked'
      flow.body.graph.edges.forEach(function () { try { leaked = this.constructor.constructor('return typeof process')() } catch (_) { leaked = 'blocked' } }, flow.body.graph.edges[0])
      return leaked
    `)
    const callbackThisArgMutation = await executeInSandbox(`
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.nodes.forEach(function () { this.label = 'Changed' }, flow.body.graph.nodes.get('A'))
      return mermaid.serializeMermaid(flow)
    `)
    expect(ctor).toMatchObject({ ok: true, value: 'blocked' })
    expect(arrayMutation.error).toContain('read-only')
    expect(mapMutation.error).toContain('read-only')
    expect(findLastCtor).toMatchObject({ ok: true, value: 'blocked' })
    expect(toSortedCtor).toMatchObject({
      ok: true,
      value: {
        compared: ['A', 'C'],
        escapes: ['blocked'],
        sorted: ['C', 'A'],
        original: ['A', 'C'],
      },
    })
    expect(mapGetOrInsert.error).toContain('read-only')
    expect(defineGetter.ok).toBe(false)
    expect(lookupProtoMapMutator.ok).toBe(false)
    expect(callbackThisArgEscape).toMatchObject({ ok: true, value: 'blocked' })
    expect(callbackThisArgMutation.error).toContain('read-only')
  })
  test('owned collection iterators expose hardened methods, entry identity and exhaustion', async () => {
    const result = await executeInSandbox(`
      const parsed = mermaid.parseRegisteredMermaid('flowchart LR\\n A[Alpha] --> B[Beta]')
      const nodes = mermaid.asFlowchart(parsed.value).body.graph.nodes
      const values = nodes.values()
      const first = values.next()
      const pair = nodes.entries().next().value
      let blocked = 0
      try { first.value.label = 'Changed' } catch (_) { blocked++ }
      try { Object.defineProperty(values, 'next', { value: () => ({ done: true }) }) } catch (_) { blocked++ }
      try { Reflect.construct(values.next, []) } catch (_) { blocked++ }
      const second = values.next()
      const done = values.next()
      return {
        self: values[Symbol.iterator]() === values,
        descriptor: Object.getOwnPropertyDescriptor(values, 'next').value === values.next,
        constructor: typeof values.next.constructor,
        prototype: Object.getPrototypeOf(values),
        first: [first.value.id, first.value.label, first.value === nodes.get('A')],
        second: second.value.id,
        pair: [pair[0], pair[1] === nodes.get(pair[0])],
        keys: [...nodes.keys()],
        entries: [...nodes].map(([key, value]) => [key, value.label]),
        done: [done.done, done.value === undefined, values.next().done],
        blocked,
      }
    `)
    expect(result).toMatchObject({ ok: true, value: {
      self: true, descriptor: true, constructor: 'undefined', prototype: null,
      first: ['A', 'Alpha', true], second: 'B', pair: ['A', true],
      keys: ['A', 'B'], entries: [['A', 'Alpha'], ['B', 'Beta']], done: [true, true, true], blocked: 3,
    } })
  })

  test('owned Set and array iterators retain pair aliases and sparse index values', async () => {
    const result = await executeInSandbox(`
      const parsed = mermaid.parseRegisteredMermaid('flowchart LR\\n A --> B')
      const graph = mermaid.asFlowchart(parsed.value).body.graph
      const node = graph.nodes.get('A')
      const set = graph.edges.map(() => new Set([node]))[0]
      const pair = set.entries().next().value
      let blocked = false
      try { set.values().next().value.label = 'Changed' } catch (_) { blocked = true }
      const sparse = graph.edges.map(() => { const values = []; values.length = 4; values[1] = node; return values })[0]
      return {
        pair: [pair[0] === pair[1], pair[0] === node],
        values: [...set].map(value => value.id),
        keys: [...set.keys()].map(value => value.id),
        indices: [...sparse.keys()],
        sparse: [...sparse.entries()].map(([index, value]) => [index, value === undefined ? null : value.id]),
        arrayIdentity: graph.edges.values().next().value === graph.edges[0],
        blocked,
      }
    `)
    expect(result).toMatchObject({ ok: true, value: {
      pair: [true, true], values: ['A'], keys: ['A'], indices: [0, 1, 2, 3],
      sparse: [[0, null], [1, 'A'], [2, null], [3, null]], arrayIdentity: true, blocked: true,
    } })
  })

  test('array short-circuit callbacks visit only needed values and preserve holes and reducer seeds', async () => {
    const result = await executeInSandbox(`
      const parsed = mermaid.parseRegisteredMermaid('flowchart LR\\n A --> B')
      const graph = mermaid.asFlowchart(parsed.value).body.graph
      const values = graph.edges.map(() => {
        const a = []; a.length = 4; a[1] = graph.nodes.get('A'); a[3] = graph.nodes.get('B'); return a
      })[0]
      const calls = []
      const context = { marker: 'context' }
      const some = values.some(function (value, index, owner) {
        calls.push([value.id, index, owner === values, this === context]); return true
      }, context)
      const holes = []
      values.find((value, index) => { holes.push(index); return value === undefined })
      const reverseHoles = []
      values.findLast((value, index) => { reverseHoles.push(index); return value === undefined })
      const mapped = values.map(value => value.id)
      const reduced = values.reduce((previous, current, index, owner) =>
        [previous === graph.nodes.get('A'), current === graph.nodes.get('B'), index, owner === values, typeof previous.constructor])
      const right = values.reduceRight((previous, current, index) => [previous.id, current.id, index])
      const seed = { count: 0 }
      const seeded = values.reduce((sum, value) => { sum.count++; return sum }, seed)
      const empty = graph.edges.map(() => [])[0]
      let missingSeed = false
      try { empty.reduce(() => 0) } catch (_) { missingSeed = true }
      const explicitUndefined = empty.reduce(() => 0, undefined) === undefined
      const lazy = graph.edges.map(() => {
        const a = [graph.nodes.get('A')]
        Object.defineProperty(a, 1, { get() { throw new Error('unvisited value') }, enumerable: true })
        return a
      })[0]
      return {
        some, calls, holes, reverseHoles, mapped: [0 in mapped, mapped[1], 2 in mapped, mapped[3]],
        reduced, right, seeded: [seeded.count, seed.count], missingSeed, explicitUndefined,
        lazy: lazy.some(value => value.id === 'A'),
      }
    `)
    expect(result).toMatchObject({ ok: true, value: {
      some: true, calls: [['A', 1, true, true]], holes: [0], reverseHoles: [3, 2], mapped: [false, 'A', false, 'B'],
      reduced: [true, true, 3, true, 'undefined'], right: ['B', 'A', 1], seeded: [2, 2],
      missingSeed: true, explicitUndefined: true, lazy: true,
    } })
  })

  test('result getters are rejected instead of running after the VM timeout/commit point', async () => {
    const r = await executeInSandbox(
      `
      const r0 = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'C', label: 'Cache' })
      const verify = mermaid.verifyMermaid(r1.value)
      return { verify, get source() { return mermaid.serializeMermaid(r1.value) } }
    `,
      { trace: true },
    )
    expect(r.ok).toBe(false)
    expect(r.error).toContain('not allowed while returning results')
    expect((r.trace ?? []).some(c => c.verb === 'serialize')).toBe(false)
  })

  test('result serialization runs under the VM timeout', async () => {
    const r = await executeInSandbox(`return { get x() { while (true) {} } }`, { timeoutMs: 50 })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/timed out|timeout/i)
  })

  test('trusted-diagram auto-verification shares the execute deadline', async () => {
    // Observe the real commit watchdog after 750ms of the shared budget has
    // elapsed. A fixed diagram size need not run slowly on every machine.
    const commitTimeouts: Array<number | undefined> = []
    const originalRun = vm.runInContext
    const watchdog = spyOn(vm, 'runInContext').mockImplementation((code, context, options) => {
      if (code.startsWith('globalThis["__pi_marshal_')) commitTimeouts.push(typeof options === 'object' ? options?.timeout : undefined)
      return originalRun(code, context, options)
    })
    const clock = spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(750)
    try {
      const r = await executeInSandbox('return mermaid.parseRegisteredMermaid("flowchart TD\\n A --> B").value', { timeoutMs: 2_000 })
      expect(r).toMatchObject({ ok: true, value: { ok: true, family: 'flowchart', source: 'flowchart TD\n  A --> B\n', verify: { ok: true } } })
      expect(commitTimeouts).toEqual([1_250])
    } finally {
      clock.mockRestore()
      watchdog.mockRestore()
    }
  })

  test('the post-close commit watchdog never exposes a raw host callable', async () => {
    const r = await executeInSandbox(`
      mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
      return new Proxy({ guard: null }, {
        get(target, property, receiver) {
          if (property === 'ok') {
            const key = Reflect.ownKeys(globalThis).find(candidate =>
              typeof candidate === 'string' && candidate.startsWith('__pi_marshal_'))
            const commit = key ? globalThis[key] : undefined
            target.guard = {
              constructor: typeof commit?.constructor,
              bind: typeof commit?.bind,
              prototype: commit ? Object.getPrototypeOf(commit) : 'missing',
            }
            return false
          }
          return Reflect.get(target, property, receiver)
        },
      })
    `)
    expect(r).toMatchObject({
      ok: true,
      value: { guard: { constructor: 'undefined', bind: 'undefined', prototype: null } },
    })
  })

  test('result handoff slot cannot be replaced with a host-assignment setter', async () => {
    const r = await executeInSandbox(
      `
      Object.defineProperty(globalThis, '__pi_result', { set(v) { while (true) {} }, configurable: true })
      return 1
    `,
      { timeoutMs: 50 },
    )
    expect(r.ok).toBe(false)
  })

  test('log extraction does not call sandbox-controlled arrays with host constructors', async () => {
    const r = await executeInSandbox(`
      try { Object.defineProperty(globalThis, '__pi_read_logs', { value: () => '["owned"]', configurable: true }) } catch (_) {}
      if (typeof __pi_logs !== 'undefined') __pi_logs.slice = () => { const a = []; a.map = hostString => [hostString.constructor.constructor('return process.env.HOME')()]; return a }
      console.log('visible')
      return 1
    `)
    expect(r.ok).toBe(true)
    expect(r.value).toBe(1)
    expect(r.logs).toEqual(['visible'])
  })

  test('sandbox-controlled stringify/errors cannot run host post-processing outside timeout', async () => {
    const stringify = await executeInSandbox(
      `
      JSON.stringify = () => ({ toString() { while (true) {} } })
      return 1
    `,
      { timeoutMs: 50 },
    )
    expect(stringify).toMatchObject({ ok: true, value: 1 })

    const thrown = await executeInSandbox(`throw { get message() { while (true) {} } }`, { timeoutMs: 50 })
    expect(thrown.ok).toBe(false)
    expect(thrown.error).toMatch(/timed out|timeout|sandbox error/i)

    const spoof = await executeInSandbox(
      `
      const r = mermaid.parseRegisteredMermaid('flowchart TD\\n A --> B')
      throw { get name() { mermaid.serializeMermaid(r.value); return 'SyntaxError' }, message: 'fake' }
    `,
      { trace: true },
    )
    expect(spoof.ok).toBe(false)
    expect(spoof.trace?.map(c => c.verb)).toEqual(['parse'])
  })

  test('SDK facade descriptors expose wrapped traced functions, not raw SDK functions', async () => {
    const traced = await executeInSandbox(
      `
      const parse = Object.getOwnPropertyDescriptor(mermaid, 'parseRegisteredMermaid').value
      const verifyMermaid = Object.getOwnPropertyDescriptor(mermaid, 'verifyMermaid').value
      const r0 = parse('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r0.value)
      const v = verifyMermaid(flow)
      return { ok: v.ok }
    `,
      { trace: true },
    )
    expect(traced.ok).toBe(true)
    expect((traced.trace ?? []).map(c => c.verb)).toEqual(['parse', 'narrow', 'verify', 'verify_inspect'])

    const closed = await executeInSandbox(
      `
      const parse = Object.getOwnPropertyDescriptor(mermaid, 'parseRegisteredMermaid').value
      const verifyMermaid = Object.getOwnPropertyDescriptor(mermaid, 'verifyMermaid').value
      const r0 = parse('flowchart TD\\n  A --> B')
      return { get late() { return verifyMermaid(r0.value).ok } }
    `,
      { trace: true },
    )
    expect(closed.ok).toBe(false)
    expect(closed.error).toContain('not allowed while returning results')
    expect((closed.trace ?? []).map(c => c.verb)).toEqual(['parse'])
  })

  test('async and blocking realm primitives are unavailable', async () => {
    expect((await executeInSandbox(`await 0`)).error).toContain('synchronous')
    expect((await executeInSandbox(`Promise.resolve(1)`)).error).toContain('synchronous')
    expect((await executeInSandbox(`Array.fromAsync([1])`)).error).toContain('fromAsync')
    expect((await executeInSandbox(`new AsyncDisposableStack().disposeAsync()`)).error).toContain('synchronous')
    expect((await executeInSandbox(`new FinalizationRegistry(() => {}).register({}, 0)`)).error).toContain('finalizers')
    expect((await executeInSandbox(`Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)`)).error).toContain('blocking')
    const globals = await executeInSandbox(`return ['Promise', 'Atomics', 'SharedArrayBuffer', 'ShadowRealm', 'AsyncDisposableStack', 'FinalizationRegistry', 'WeakRef'].map(k => typeof globalThis[k]).concat(typeof Array['fromAsync'])`)
    expect(globals).toMatchObject({ ok: true, value: ['undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined'] })
  })

  test('safe object property spellings are not confused with disabled async globals', async () => {
    expect((await executeInSandbox('return ({ Promise: 1 }).Promise')).value).toBe(1)
    expect((await executeInSandbox('return ({ fromAsync: 2 }).fromAsync')).value).toBe(2)
    expect((await executeInSandbox('return ({ [Promise]: 1 })')).error).toContain('synchronous')
    expect((await executeInSandbox('return Promise')).error).toContain('synchronous')
    expect((await executeInSandbox('return Array.fromAsync([1])')).error).toContain('fromAsync')
  })

  test('Bun rejects unsafe sub-second SDK watchdogs as a tagged result', async () => {
    expect(await executeInSandbox('return "mermaid"', { timeoutMs: 100 })).toMatchObject({ ok: true, value: 'mermaid' })
    const result = await executeInSandbox('return mermaid.parseRegisteredMermaid("flowchart TD\\n A --> B")', { timeoutMs: 100 })
    if (typeof Bun !== 'undefined') {
      expect(result).toMatchObject({ ok: false })
      expect(result.error).toContain('timeoutMs >= 1000')
      const computed = await executeInSandbox('return globalThis["mer" + "maid"].parseRegisteredMermaid("flowchart TD\\n A --> B")', { timeoutMs: 100 })
      expect(computed.error).toContain('timeoutMs >= 1000')
    }
  })
  test('thrown error', async () => {
    const r = await executeInSandbox(`throw new Error('boom')`)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('boom')
  })
  test('broken arrow (syntax) reported, not crashed', async () => {
    const r = await executeInSandbox(`this is not valid :::`)
    expect(r.ok).toBe(false)
  })
  test('runaway loop hits timeout', async () => {
    const r = await executeInSandbox(`while (true) {}`, { timeoutMs: 200 })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/timed out|timeout/i)
  })
})

describe('sandbox — expression-first wrap handles every common code shape', () => {
  // The naive heuristic in earlier loops mishandled trailing-semi, multi-line
  // template literals, multi-line args, and object literals. Expression-first
  // try/fallback covers them all.
  test('bare single expression returns value', async () => {
    expect((await executeInSandbox(`1 + 2`)).value).toBe(3)
  })
  test('expression with trailing semicolon returns value (not null)', async () => {
    expect((await executeInSandbox(`1 + 2;`)).value).toBe(3)
  })
  test('template literal with embedded newline returns the string', async () => {
    expect((await executeInSandbox('`a\nb`')).value).toBe('a\nb')
  })
  test('multi-line argument (no semi) returns the value', async () => {
    expect((await executeInSandbox(`JSON.stringify({\n  a: 1\n})`)).value).toBe('{"a":1}')
  })
  test('object literal as bare expression returns the object', async () => {
    expect((await executeInSandbox(`{a: 1}`)).value).toEqual({ a: 1 })
  })
  test('ternary as bare expression', async () => {
    expect((await executeInSandbox(`1 > 0 ? "yes" : "no"`)).value).toBe('yes')
  })
  test('arrow value returns null (function not JSON-serializable; no crash)', async () => {
    const r = await executeInSandbox(`(x => x + 1)`)
    expect(r.ok).toBe(true)
    expect(r.value).toBeNull()
  })
  test('top-level await is rejected because Code Mode is synchronous', async () => {
    const r = await executeInSandbox(`await Promise.resolve(42)`)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('synchronous')
  })
  test('multi-statement no-return → ok with null', async () => {
    const r = await executeInSandbox(`const x = 5\nconst y = 10`)
    expect(r.ok).toBe(true)
    expect(r.value).toBeNull()
  })
  test('explicit return after const decl', async () => {
    expect((await executeInSandbox(`const x = 5; return x * 2`)).value).toBe(10)
  })
})

describe('MCP — JSON-RPC happy + sad', () => {
  test('initialize', async () => {
    const r = await handleRequest({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
    })
    expect((r!.result as any).serverInfo.name).toBe('agentic-mermaid-mcp')
    // The MCP handshake version is derived from package.json; keep them aligned.
    expect((r!.result as any).serverInfo.version).toBe(pkg.version)
    const instructions = (r!.result as any).instructions as string
    for (const family of BUILTIN_FAMILY_METADATA) expect(instructions).toContain(family.narrower)
    expect(instructions).not.toContain('Journey, xychart, architecture')
    expect((r!.result as any).capabilities).toEqual({ tools: {} })
  })
  test.each([
    undefined,
    {},
    { protocolVersion: '2025-11-25', capabilities: {} },
    { protocolVersion: '2025-11-25', capabilities: [], clientInfo: { name: 'test', version: '0' } },
    { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test' } },
  ])('initialize rejects malformed params %#', async params => {
    const response = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', ...(params === undefined ? {} : { params }) })
    expect(response?.error?.code).toBe(-32602)
  })
  test('tools/list has a compact execute SDK plus progressive family discovery', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const tools = (r!.result as any).tools
    expect(tools).toBe(LOCAL_TOOLS)
    expect(tools.map((t: any) => t.name)).toEqual(['execute', 'describe_sdk', 'render_png', 'describe', 'mutate', 'build'])
    for (const token of [...BUILTIN_FAMILY_METADATA.map(f => f.narrower), 'MutationOp']) {
      expect(tools[0].description).toContain(token)
    }
    expect(tools[0].description).not.toContain('TimelineMutationOp')
    for (const signature of ['renderMermaidSVGWithReceipt(', 'renderMermaidASCIIWithReceipt(', 'layoutMermaidWithReceipt(']) {
      expect(tools[0].description).toContain(signature)
    }
    expect(tools[0].description).toContain('interface RenderRequestReceipt')
    expect(tools[0].description).toMatch(/interface RenderRequestReceipt\s*\{\s*version:\s*2;/)
    // Includes strict StyleSpec and native family narrowers (15,004 bytes);
    // retain only 46 bytes of headroom for the compact contract.
    expect(new TextEncoder().encode(tools[0].description).length).toBeLessThan(15_050)
  })
  test('tools/call execute', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'execute', arguments: { code: 'return mermaid.verifyMermaid("flowchart TD\\n A --> B").ok' } } })
    expect((r!.result as any).isError).toBe(false)
    expect(JSON.parse((r!.result as any).content[0].text).value).toBe(true)
  })
  test('tools/call describe supports facts format', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 30, method: 'tools/call', params: { name: 'describe', arguments: { source: 'classDiagram\n  class Duck {\n    +quack()\n  }', format: 'facts' } } })
    expect((r!.result as any).isError).toBe(false)
    expect(JSON.parse((r!.result as any).content[0].text).facts).toContain('member Duck +quack()')
  })
  test('tools/call describe_sdk exposes exact op fields without an execute call', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 31, method: 'tools/call', params: { name: 'describe_sdk', arguments: { family: 'journey' } } })
    expect((r!.result as any).isError).toBe(false)
    const payload = JSON.parse((r!.result as any).content[0].text)
    expect(payload).toEqual(expect.objectContaining({ ok: true, family: 'journey', detail: 'fields' }))
    expect(payload.ops.add_task).toContainEqual(expect.objectContaining({ name: 'score', required: true, note: 'finite number 1..5' }))
  })
  test('transport maximum caps execute even when the request omits timeoutMs', async () => {
    const r = await handleRequest(
      {
        jsonrpc: '2.0',
        id: 32,
        method: 'tools/call',
        params: { name: 'execute', arguments: { code: 'while (true) {}' } },
      },
      { maxSandboxTimeoutMs: 25 },
    )
    const payload = JSON.parse((r!.result as any).content[0].text)
    expect(payload.ok).toBe(false)
    // The reported deadline is the 25 ms transport cap, not the default
    // sandbox timeout, so the cap applied without timing the call.
    const deadline = Number(String(payload.error).match(/timed out after (\d+)ms/)?.[1])
    expect(deadline).toBeGreaterThan(0)
    expect(deadline).toBeLessThanOrEqual(25)
  })

  test('unknown tool → -32602 naming the tool', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } })
    expect(r).toMatchObject({ id: 4, error: { code: -32602, message: 'Unknown tool: nope' } })
  })
  test('missing code arg → -32602 naming the argument', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'execute', arguments: {} } })
    expect(r).toMatchObject({ id: 5, error: { code: -32602, message: expect.stringContaining('arguments.code is required') } })
  })
  test('tool schemas reject malformed local arguments before handlers run', async () => {
    const malformed = [
      { name: 'execute', arguments: { code: '1 + 1', timeoutMs: 'fast' } },
      { name: 'describe', arguments: { source: 'flowchart LR\nA-->B', format: 'yaml' } },
      { name: 'render_png', arguments: { source: 'flowchart LR\nA-->B', scale: 'large' } },
      { name: 'render_png', arguments: { source: 'flowchart LR\nA-->B', scale: 0 } },
      { name: 'render_png', arguments: { source: 'flowchart LR\nA-->B', background: 123 } },
      { name: 'render_png', arguments: { source: 'flowchart LR\nA-->B', options: { seed: 'bad' } } },
      { name: 'render_png', arguments: { source: 'flowchart LR\nA-->B', options: { style: 'not-a-registered-style' } } },
      { name: 'render_png', arguments: { source: 'flowchart LR\nA-->B', options: { padding: 'wide' } } },
      { name: 'render_png', arguments: { source: 'flowchart LR\nA-->B', unexpected: true } },
    ]
    for (const params of malformed) {
      const response = await handleRequest({ jsonrpc: '2.0', id: 51, method: 'tools/call', params })
      expect(response?.error?.code).toBe(-32602)
      expect(response?.error?.message).toContain('Invalid arguments')
    }
  })
  test('unknown method → -32601', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 6, method: 'made/up' })
    expect(r!.error!.code).toBe(-32601)
  })
  test('every JSON-RPC notification is processed without a response', async () => {
    expect(await handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
    expect(await handleRequest({ jsonrpc: '2.0', method: 'ping' })).toBeNull()
    expect(await handleRequest({ jsonrpc: '2.0', method: 'made/up' })).toBeNull()
  })
  test('malformed JSON-RPC envelopes are rejected before dispatch', async () => {
    const missingVersion = await handleRequest({ id: 8, method: 'ping' } as any)
    expect(missingVersion).toMatchObject({ id: null, error: { code: -32600 } })
    const wrongVersion = await handleRequest({ jsonrpc: '1.0', id: 9, method: 'ping' } as any)
    expect(wrongVersion).toMatchObject({ id: null, error: { code: -32600 } })
    const missingMethod = await handleRequest({ jsonrpc: '2.0', id: 10 } as any)
    expect(missingMethod).toMatchObject({ id: null, error: { code: -32600 } })
    const malformedWithoutId = await handleRequest({ method: 'ping' } as any)
    expect(malformedWithoutId?.error?.code).toBe(-32600)
    expect(malformedWithoutId?.id).toBeNull()
  })
  test('malformed params on tools/call are rejected as -32602, not thrown', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: null })
    expect(r).toMatchObject({ id: 7, error: { code: -32602, message: expect.stringContaining('tools/call requires an object') } })
  })
})

describe('MCP bin shim', () => {
  test('parseMcpCliOptions is the shared flag parser for both bins', () => {
    const parsed = parseMcpCliOptions([
      '--transport',
      'http',
      '--host',
      '0.0.0.0',
      '--port',
      '3001',
      '--artifact-dir',
      '/tmp/am',
      '--public-url',
      'https://example.test/artifacts',
      '--max-artifact-bytes',
      '123',
      '--max-artifact-total-bytes',
      '1000',
      '--max-artifacts',
      '5',
      '--artifact-ttl-ms',
      '456',
      '--max-rpc-body-bytes',
      '789',
      '--auth-token',
      'secret',
      '--max-sandbox-timeout-ms',
      '1000',
    ])
    expect(parsed.transport).toBe('http')
    expect(parsed.httpOptions).toEqual({
      host: '0.0.0.0',
      port: 3001,
      artifactDir: '/tmp/am',
      publicUrl: 'https://example.test/artifacts',
      maxArtifactBytes: 123,
      maxArtifactTotalBytes: 1000,
      maxArtifacts: 5,
      artifactTtlMs: 456,
      maxRpcBodyBytes: 789,
      authToken: 'secret',
      maxSandboxTimeoutMs: 1000,
    })
  })

  test('the MCP parser rejects unknown, missing, duplicate, positional, and inapplicable arguments', () => {
    for (const argv of [['--bogus'], ['--port'], ['--port', '--http'], ['stray'], ['--transport', 'http', '--transport', 'http'], ['--http', '--transport', 'stdio'], ['--host', '127.0.0.1'], ['--transport=']]) {
      expect(() => parseMcpCliOptions(argv), argv.join(' ')).toThrow()
    }
    expect(parseMcpCliOptions(['--transport=http', '--port=0']).transport).toBe('http')
  })

  test('runMcpCli handles help and bad flags without launching a server', async () => {
    const out: string[] = []
    const err: string[] = []
    const io = {
      stdout: {
        write: (s: string) => {
          out.push(s)
          return true
        },
      },
      stderr: {
        write: (s: string) => {
          err.push(s)
          return true
        },
      },
    }
    expect(await runMcpCli(['--help'], io)).toBe(0)
    expect(out.join('')).toContain('agentic-mermaid-mcp')
    for (const argv of [['--bogus', '--help'], ['--transport=http', '--port', '70000', '--help'], ['--help', '--help'], ['--', '-h']]) {
      out.length = 0; err.length = 0
      expect(await runMcpCli(argv, io)).toBe(0)
      expect(out.join('')).toBe(MCP_CLI_HELP)
      expect(err).toEqual([])
    }
    expect(await runMcpCli(['--transport', 'smtp'], io)).toBe(1)
    expect(err.join('')).toContain('unknown transport: smtp')
    expect(await runMcpCli(['--transport', 'http', '--port', '70000'], io)).toBe(1)
    expect(err.join('')).toContain('--port must be an integer between 0 and 65535')
    expect(await runMcpCli(['--http'], io)).toBe(1)
    expect(err.join('')).toContain('unknown option: --http')
    expect(await runMcpCli(['--bogus'], io)).toBe(1)
    expect(err.join('')).toContain('unknown option: --bogus')
    expect(() => parseMcpCliOptions(['--host'])).toThrow('--host requires a value')
  })
})

describe('CLI — sad paths via runCli', () => {
  let dir = ''
  beforeAll(() => {
    dir = temp.dir('am-cli-sad-')
  })
  const tmpFile = (name: string, content: string): string => {
    const path = join(dir, name)
    writeFileSync(path, content)
    return path
  }


  test('render parse failures exit 2 with PARSE_FAILED, not INTERNAL', () => {
    const tmp = tmpFile('render-invalid.mmd', 'flowchart XX\n  A --> B\n')
    const { code, out } = capture(() => runCli(['render', tmp, '--format', 'svg', '--json']))
    expect(code).toBe(2)
    expect(out).toContain('PARSE_FAILED')
  })

  test('mutate on structured architecture preserves typed accessibility directives (B04)', () => {
    const tmp = tmpFile('architecture.mmd', 'architecture-beta\n  service api(server)[API]\n')
    const { code, out } = capture(() => runCli(['mutate', tmp, '--op', '{"kind":"add_service","id":"db","label":"Database","icon":"database"}', '--json']))
    expect(code).toBe(0)
    const payload = JSON.parse(out)
    expect(payload.ok).toBe(true)
    expect(payload.source).toContain('service db(database)[Database]')

    const accessibleTmp = tmpFile('architecture-accessible.mmd', 'architecture-beta\n  accTitle: A11y\n  service api(server)[API]\n')
    const accessible = capture(() => runCli(['mutate', accessibleTmp, '--op', '{"kind":"add_service","id":"db","label":"DB"}', '--json']))
    expect(accessible.code).toBe(0)
    const accessiblePayload = JSON.parse(accessible.out)
    expect(accessiblePayload.source).toContain('accTitle: A11y')
    expect(accessiblePayload.source).toContain('service db[DB]')
  })

  test('mutate on structured journey succeeds (BUILD-15); opaque journey stays unsupported', () => {
    const tmp = tmpFile('journey.mmd', 'journey\n  section Work\n  Code: 4: Me\n')
    const { code, out } = capture(() => runCli(['mutate', tmp, '--op', '{"kind":"add_task","sectionIndex":0,"text":"Review","score":5,"actors":["Me"]}', '--json']))
    expect(code).toBe(0)
    const payload = JSON.parse(out)
    expect(payload.ok).toBe(true)
    expect(payload.source).toContain('Review: 5: Me')

    const opaqueTmp = tmpFile('journey-opaque.mmd', 'journey\n  Code: 9: Me\n')
    const opaque = capture(() => runCli(['mutate', opaqueTmp, '--op', '{"kind":"add_task","sectionIndex":0,"text":"Review","score":5}', '--json']))
    expect(opaque.code).toBe(2)
    expect(JSON.parse(opaque.out).error.code).toBe('UNSUPPORTED_FAMILY')
  })

  test('mutate on structured xychart preserves delimiter-bearing quoted text', () => {
    const tmp = tmpFile('xychart.mmd', 'xychart-beta\n  x-axis [Jan, Feb]\n  bar [1, 2]\n')
    const { code, out } = capture(() => runCli(['mutate', tmp, '--op', '{"kind":"add_series","kind2":"line","name":"Mobile","values":[3,4]}', '--json']))
    expect(code).toBe(0)
    const payload = JSON.parse(out)
    expect(payload.ok).toBe(true)
    expect(payload.source).toContain('line Mobile [3, 4]')

    const accessibleTmp = tmpFile('xychart-accessible.mmd', 'xychart-beta\n  accTitle: Sales chart\n  bar [1, 2]\n')
    const accessible = capture(() => runCli(['mutate', accessibleTmp, '--op', '{"kind":"set_title","title":"X"}', '--json']))
    expect(accessible.code).toBe(0)
    expect(JSON.parse(accessible.out).source).toContain('accTitle: Sales chart')

    const quotedTmp = tmpFile('xychart-quoted.mmd', 'xychart-beta\n  title "Quoted [supported]"\n  bar [1, 2]\n')
    const quoted = capture(() => runCli(['mutate', quotedTmp, '--op', '{"kind":"set_y_axis","axis":{"range":{"min":0,"max":5}}}', '--json']))
    expect(quoted.code).toBe(0)
    expect(JSON.parse(quoted.out).source).toContain('title "Quoted [supported]"')
  })

  test('mutate on sequence-with-notes (BUILD-18: structured-with-segments) succeeds and keeps the note', () => {
    const tmp = tmpFile('seqnote.mmd', 'sequenceDiagram\n  A->>B: Hi\n  Note over A: thinking\n')
    const { code, out } = capture(() => runCli(['mutate', tmp, '--op', '{"kind":"add_message","from":"A","to":"B","text":"x"}']))
    expect(code).toBe(0)
    // The Note rides along verbatim; the new message lands after it.
    expect(out).toContain('Note over A: thinking')
    expect(out).toContain('A->>B: x')
  })

  test.each([
    ['pie\n  "Only" : 1', { kind: 'remove_slice', label: 'Only' }, 'pie\n'],
    ['journey\n  Only: 5: Me', { kind: 'remove_task', sectionIndex: 0, taskIndex: 0 }, 'journey\n'],
    ['xychart-beta\n  bar [1]', { kind: 'remove_series', index: 0 }, 'xychart-beta\n'],
    ['architecture-beta\n  service only(server)[Only]', { kind: 'remove_service', id: 'only' }, 'architecture-beta\n'],
    ['flowchart TD\n  A[Only]', { kind: 'remove_node', id: 'A' }, 'flowchart TD\n'],
  ])('intentional empty edit publishes renderable source: %s', async (source, op, expected) => {
    const parsed = parseRegisteredMermaid(source as string)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const original = serializeMermaid(parsed.value)
    const direct = mutate(parsed.value as Parameters<typeof mutateChecked>[0], op as Parameters<typeof mutate>[1])
    expect(direct.ok).toBe(true)
    if (direct.ok) expect(serializeMermaid(direct.value)).toBe(expected)
    const checked = mutateChecked(parsed.value as Parameters<typeof mutateChecked>[0], op)
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect(serializeMermaid(checked.value)).toBe(expected)
    expect(serializeMermaid(parsed.value)).toBe(original)
    expect(verifyMermaid(checked.value)).toMatchObject({ ok: false, warnings: [{ code: 'EMPTY_DIAGRAM' }] })
    expect(renderMermaidSVG(expected as string)).toContain('<svg')
    const envelope = { ok: true, source: expected, verify: { ok: false, warnings: [{ code: 'EMPTY_DIAGRAM' }] } }
    expect(applyOps({ source: source as string, ops: [op] })).toMatchObject(envelope)
    const tmp = tmpFile('empty-edit.mmd', source as string)
    const cli = capture(() => runCli(['mutate', tmp, '--op', JSON.stringify(op), '--json']))
    expect(cli.code).toBe(0)
    expect(JSON.parse(cli.out)).toMatchObject(envelope)
    const sandbox = await executeInSandbox(`const d = mermaid.parseRegisteredMermaid(${JSON.stringify(source)}); return mermaid.mutate(d.value, ${JSON.stringify(op)})`)
    expect(sandbox.ok).toBe(true)
    expect(sandbox.value).toMatchObject(envelope)
  })

  test('empty pie can be titled before its first slice; unrenderable scaffolds remain rejected', async () => {
    const result = mutateChecked(createMermaid('pie'), { kind: 'set_title', title: 'Pending' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(serializeMermaid(result.value)).toBe('pie\n  title Pending\n')
    expect(applyOps({ family: 'pie', ops: [{ kind: 'set_title', title: 'Pending' }] })).toMatchObject({ ok: true, source: 'pie\n  title Pending\n', verify: { ok: false, warnings: [{ code: 'EMPTY_DIAGRAM' }] } })
    expect(applyOps({ family: 'sankey', ops: [{ kind: 'add_link', source: 'A', target: 'B', value: 1 }, { kind: 'remove_link', source: 'A', target: 'B' }] })).toMatchObject({ ok: false })
    const sandbox = await executeInSandbox('return mermaid.createMermaid("sankey")')
    expect(sandbox.ok).toBe(true)
    expect(sandbox.value).toMatchObject({ ok: false, error: { code: 'VERIFY_FAILED' } })
    expect(sandbox.value).not.toHaveProperty('source')
  })

  test('mutate --json includes verify warnings on success', () => {
    const tmp = tmpFile('mutate-warning.mmd', 'flowchart TD\n  A --> B\n')
    const long = 'X'.repeat(80)
    const { code, out } = capture(() => runCli(['mutate', tmp, '--op', JSON.stringify({ kind: 'add_node', id: 'C', label: long }), '--json']))
    expect(code).toBe(0)
    const payload = JSON.parse(out)
    expect(payload.ok).toBe(true)
    expect(payload.source).toContain('C')
    expect(payload.verify.warnings.map((w: any) => w.code)).toContain('LABEL_OVERFLOW')
  })

  test('mutate supports class diagrams through the public CLI surface', () => {
    const tmp = tmpFile('class.mmd', 'classDiagram\n  class Animal\n')
    const { code, out } = capture(() => runCli(['mutate', tmp, '--op', JSON.stringify({ kind: 'add_class', id: 'Duck', members: ['+quack()'] })]))
    expect(code).toBe(0)
    expect(out).toContain('Duck')
    expect(out).toContain('+quack()')
  })

  // A flowchart layout that raises a TypeError for any diagram naming a
  // `Defect` node (or a different one for an `Other` node): an engine fault,
  // which no diagram or edit should be blamed for.
  const withLayoutDefect = (run: () => void): void => {
    const flowchart = getFamily('flowchart')!
    const restore = replaceFamilyForTest('flowchart', {
      ...flowchart,
      layout: context => {
        if (context.source.text.includes('Other')) throw new TypeError('another layout defect')
        if (context.source.text.includes('Defect')) throw new TypeError('layout defect')
        return flowchart.layout!(context)
      },
    })
    try {
      run()
    } finally {
      restore()
    }
  }
  const layoutDefect = expect.objectContaining({ code: 'INTERNAL_ERROR', defaultRender: 'fails' })

  test('verify exits 3 for errors in the diagram and 4 when every error is INTERNAL_ERROR', () => {
    // Exit 3 was 2 in Loop ≤6 (when verify-failed shared an exit code with
    // arg errors); Loop 7 split out EXIT_VERIFY_FAILED=3 so a CI script can
    // branch on cause-of-failure. An engine defect is not the diagram's
    // failure, so it takes the internal code.
    withLayoutDefect(() => {
      for (const [name, source, exit] of [
        ['empty', '', 3],
        ['authored style color', 'flowchart LR\n  A --> B\n  style A fill:notacolor', 3],
        ['engine defect', 'flowchart LR\n  Defect --> B', 4],
      ] as const) {
        const { code, out } = capture(() => runCli(['verify', tmpFile('verify-exit.mmd', source)]))
        expect({ name, code }).toEqual({ name, code: exit })
        if (exit === 4) expect(JSON.parse(out).warnings).toContainEqual(layoutDefect)
      }
    })
  })

  test('an edit is blocked by an engine defect only when the edit introduces it', () => {
    withLayoutDefect(() => {
      // The defect predates the edit: accept it, and keep reporting the defect.
      const before = 'flowchart LR\n  Defect --> B'
      const addC = { kind: 'add_node', id: 'C', label: 'C' }
      expect(applyOps({ source: before, ops: [addC] })).toMatchObject({ ok: true, verify: { ok: false, warnings: expect.arrayContaining([layoutDefect]) } })
      const accepted = capture(() => runCli(['mutate', tmpFile('defect-before.mmd', before), '--op', JSON.stringify(addC), '--json']))
      expect(accepted.code).toBe(0)
      expect(JSON.parse(accepted.out)).toMatchObject({ ok: true, verify: { warnings: expect.arrayContaining([layoutDefect]) } })
      // The edit introduces it: reject the edit, with the internal exit code.
      const addDefect = { kind: 'add_node', id: 'Defect', label: 'Defect' }
      expect(applyOps({ source: 'flowchart LR\n  A --> B', ops: [addDefect] })).toMatchObject({ ok: false, error: { code: 'VERIFY_FAILED', details: expect.arrayContaining([layoutDefect]) } })
      const rejected = capture(() => runCli(['mutate', tmpFile('defect-after.mmd', 'flowchart LR\n  A --> B'), '--op', JSON.stringify(addDefect)]))
      expect(rejected.code).toBe(4)
      // A pre-existing defect does not excuse a different one the edit adds.
      const addOther = { kind: 'add_node', id: 'Other', label: 'Other' }
      expect(applyOps({ source: before, ops: [addOther] })).toMatchObject({ ok: false, error: { code: 'VERIFY_FAILED' } })
    })
  })

  test('verify resolves and safely admits file-backed Styles so constraints match render', () => {
    const source = tmpFile('verify-style.mmd', 'flowchart TD\n  A[Alpha]\n')
    const style = join(dir, 'verify-style.json')
    const fs = require('node:fs') as typeof import('node:fs')
    try {
      fs.writeFileSync(
        style,
        JSON.stringify({
          roles: { node: { fillColor: '#111111', textColor: '#111111' } },
          constraints: [{ kind: 'contrast', action: 'warn', minimum: 4.5 }],
        }),
      )
      const warned = capture(() => runCli(['verify', source, '--style', style]))
      expect(warned.code).toBe(0)
      expect(JSON.parse(warned.out).warnings).toContainEqual(
        expect.objectContaining({
          code: 'BRAND_CONSTRAINT_WARNING',
          ratio: 1,
        }),
      )

      fs.writeFileSync(
        style,
        JSON.stringify({
          roles: { node: { fillColor: '#111111', textColor: '#111111' } },
          constraints: [{ kind: 'contrast', action: 'error', minimum: 4.5 }],
        }),
      )
      const errored = capture(() => runCli(['verify', source, '--style', style]))
      expect(errored.code).toBe(3)
      expect(JSON.parse(errored.out).warnings).toContainEqual(
        expect.objectContaining({
          code: 'BRAND_CONSTRAINT_ERROR',
          ratio: 1,
        }),
      )

      fs.writeFileSync(style, JSON.stringify({ roles: { node: { fillColor: 'url(https://evil.test/x)' } } }))
      const hostile = capture(() => runCli(['verify', source, '--style', style]))
      expect(hostile.code).toBe(2)
      expect(hostile.err).toContain('must be a safe non-fetching CSS paint')
    } finally {
      fs.rmSync(source, { force: true })
      fs.rmSync(style, { force: true })
    }
  })

  test('verify rejects malformed label caps and unknown suppression codes', () => {
    const tmp = tmpFile('verify-options.mmd', 'flowchart TD\n  A --> B\n')
    for (const args of [
      ['verify', tmp, '--label-cap', 'nope'],
      ['verify', tmp, '--label-cap', '1.5'],
      ['verify', tmp, '--suppress', 'NOT_A_WARNING'],
    ]) {
      const result = capture(() => runCli(args))
      expect(result.code).toBe(2)
      expect(result.err).toMatch(/known warning codes|positive safe integer/)
    }
  })

  test('--help per command differs from global', () => {
    const g = capture(() => runCli(['--help']))
    expect(g.code).toBe(0)
    const v = capture(() => runCli(['verify', '--help']))
    expect(v.out).toContain('am verify')
    expect(v.out).not.toEqual(g.out)
  })

  // `am serialize` reads the parse JSON on stdin, so it runs as a subprocess.
  const amSerialize = async (json: string) => {
    const r = await runChild('bun', ['run', join(import.meta.dir, '..', '..', 'bin', 'am.ts'), 'serialize'], { input: json })
    return { code: r.status, out: r.stdout, err: r.stderr }
  }

  test('REGRESSION: am parse | am serialize supports structured payload families', async () => {
    const sources = ['classDiagram\n  class Animal\n', 'timeline\n  title Plan\n  2024 : Alpha\n', 'erDiagram\n  CUSTOMER {\n    string id\n  }\n']
    for (const [i, src] of sources.entries()) {
      const parsed = capture(() => runCli(['parse', tmpFile(`structured-${i}.mmd`, src)]))
      expect(parsed.code).toBe(0)
      const serialized = await amSerialize(parsed.out)
      expect({ code: serialized.code, err: serialized.err }).toEqual({ code: 0, err: '' })
      expect(serialized.out.trim()).toContain(src.trim().split('\n')[0]!)
    }
  })

  test('REGRESSION: am parse | am serialize preserves flowchart styling (lossless)', async () => {
    const tmp = tmpFile('styled.mmd', 'flowchart TD\n  A[Start] --> B[End]\n  classDef hot fill:#f00\n  class A hot\n  style B stroke:#0f0\n  linkStyle 0 stroke:#00f\n')
    const parsed = capture(() => runCli(['parse', tmp]))
    expect(parsed.code).toBe(0)
    const serialized = await amSerialize(parsed.out)
    expect({ code: serialized.code, err: serialized.err }).toEqual({ code: 0, err: '' })
    const out = serialized.out
    expect(out).toContain('classDef hot fill:#f00')
    expect(out).toContain('class A hot')
    expect(out).toContain('style B stroke:#0f0')
    expect(out).toContain('linkStyle 0 stroke:#00f')
  })

  test('format idempotent over 3 rounds', () => {
    const tmp = tmpFile('fmt.mmd', 'flowchart TD\n  A[Alpha] --> B{D}\n  B -->|yes| C((End))\n')
    const r1 = capture(() => runCli(['format', tmp]))
    expect({ code: r1.code, err: r1.err }).toEqual({ code: 0, err: '' })
    writeFileSync(tmp, r1.out)
    const r2 = capture(() => runCli(['format', tmp]))
    expect({ code: r2.code, err: r2.err }).toEqual({ code: 0, err: '' })
    writeFileSync(tmp, r2.out)
    const r3 = capture(() => runCli(['format', tmp]))
    expect({ code: r3.code, err: r3.err }).toEqual({ code: 0, err: '' })
    const parsed = parseRegisteredMermaid(r3.out)
    if (!parsed.ok || parsed.value.body.kind !== 'flowchart') throw new Error('Expected formatted flowchart')
    expect([...parsed.value.body.graph.nodes.values()].map(node => [node.id, node.label])).toEqual([['A', 'Alpha'], ['B', 'D'], ['C', 'End']])
    expect(parsed.value.body.graph.edges.map(edge => [edge.source, edge.target, edge.label])).toEqual([['A', 'B', undefined], ['B', 'C', 'yes']])
    expect(r2.out).toEqual(r1.out)
    expect(r3.out).toEqual(r1.out)
  })
})


describe('declarative local editing and script results', () => {
  test('local build and mutate work without generated JavaScript', async () => {
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
      return JSON.parse((response!.result as any).content[0].text)
    }
    const built = await call('build', { family: 'flowchart', ops: [{ kind: 'add_node', id: 'A', label: 'Start' }] })
    expect(built.ok).toBe(true)
    const edited = await call('mutate', { source: built.source, ops: [{ kind: 'add_node', id: 'B', label: 'Finish' }, { kind: 'add_edge', from: 'A', to: 'B' }] })
    expect(edited.ok).toBe(true)
    expect(edited.source).toContain('Finish')
    const rejected = await call('mutate', { source: built.source, ops: [{ kind: 'remove_node', id: 'missing' }] })
    expect(rejected).toMatchObject({ ok: false, opIndex: 0 })
  })
  test.each([
    'const x = 41; x + 1;',
    'const x = 41; x + 1; // done',
    'const x = 41; x + 1;;',
    'const x = 41; x + 1;; // done',
    'const x = 41; return x + 1; // done',
    'const x = 41; ({ answer: x + 1 }).answer // done',
  ])('captures a result with a trailing comment: %s', async code => {
    expect(await executeInSandbox(code)).toMatchObject({ ok: true, value: 42 })
  })
})
