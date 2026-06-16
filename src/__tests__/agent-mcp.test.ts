// Sandbox + MCP, including sad paths (which I skipped in prior loops).

import { describe, test, expect } from 'bun:test'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { handleRequest } from '../mcp/server.ts'
import { runCli } from '../cli/index.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'

describe('sandbox — happy', () => {
  test('flowchart workflow', async () => {
    const r = await executeInSandbox(`
      const r0 = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r0.value); if (!flow) return { kind: r0.value.kind }
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'C', label: 'Cache' })
      const v = mermaid.verifyMermaid(r1.value); if (!v.ok) return { warnings: v.warnings }
      return { source: mermaid.serializeMermaid(r1.value) }
    `)
    expect(r.ok && (r.value as any).source.includes('Cache')).toBe(true)
  })
  test('sequence workflow', async () => {
    const r = await executeInSandbox(`
      const r0 = mermaid.parseMermaid('sequenceDiagram\\n  A->>B: Hi')
      const seq = mermaid.asSequence(r0.value); if (!seq) return { kind: r0.value.kind }
      const r1 = mermaid.mutate(seq, { kind: 'add_message', from: 'B', to: 'A', text: 'Bye', style: 'reply' })
      const v = mermaid.verifyMermaid(r1.value); if (!v.ok) return { warnings: v.warnings }
      return { msgs: r1.value.body.messages.length }
    `)
    expect(r.ok && (r.value as any).msgs).toBe(2)
  })
  test('ValidDiagram render inputs use mutated body, not stale canonicalSource', () => {
    const { parseMermaid, asFlowchart, mutate, serializeMermaid, renderMermaidSVG, renderMermaidASCII } = require('../agent/index.ts')
    const r0 = parseMermaid('flowchart TD\n  API --> DB')
    const flow = asFlowchart(r0.value)
    const r1 = mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
    expect(serializeMermaid(r1.value)).toContain('Cache')
    expect(renderMermaidSVG(r1.value)).toContain('Cache')
    expect(renderMermaidASCII(r1.value, { useAscii: true })).toContain('Cache')
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
    expect((await executeInSandbox(`const r = mermaid.parseMermaid('flowchart TD\\n  A --> B'); const flow = mermaid.asFlowchart(r.value); return flow.body.graph.edges.push.constructor('return 7')()`)).ok).toBe(false)
    expect((await executeInSandbox(`const r = mermaid.parseMermaid('flowchart TD\\n  A --> B'); return Object.getOwnPropertyDescriptor(r.value, 'body').value.constructor.constructor('return 7')()`)).ok).toBe(false)
    expect((await executeInSandbox(`try { const r = mermaid.parseMermaid('flowchart TD\\n  A --> B'); const flow = mermaid.asFlowchart(r.value); flow.body.graph.edges.push({ source: 'B', target: 'C' }) } catch (e) { return e.constructor.constructor('return 7')() }`)).ok).toBe(false)
    expect((await executeInSandbox(`try { const r = mermaid.parseMermaid('flowchart TD\\n  A --> B'); Object.preventExtensions(r.value) } catch (e) { return e.constructor.constructor('return 7')() }`)).ok).toBe(false)
    expect((await executeInSandbox(`return mermaid.parseMermaid.constructor('return 7')()`)).ok).toBe(false)
    expect((await executeInSandbox(`const fakeSource = { replace: String.prototype.replace.bind('flowchart TD\\n  A --> B'), split: String.prototype.split.bind('flowchart TD\\n  A --> B'), trim: String.prototype.trim.bind('flowchart TD\\n  A --> B') }; return mermaid.parseMermaid(fakeSource)`)).error).toContain('source must be a string')
    expect((await executeInSandbox(`const r = mermaid.parseMermaid('flowchart TD\\n A --> B'); return r.value.constructor.constructor('return 7')()`)).ok).toBe(false)
    expect((await executeInSandbox(`return globalThis.constructor.constructor('return typeof process')()`)).ok).toBe(false)
    expect((await executeInSandbox(`Error.prepareStackTrace = (_, frames) => frames; return new Error().stack[0].constructor.constructor('return process.cwd()')()`)).ok).toBe(false)
    expect((await executeInSandbox(`Error.prepareStackTrace = (_, frames) => frames; return Array.isArray(new Error().stack)`)).value).toBe(false)
    expect((await executeInSandbox(`return typeof mermaid.registerFamily`)).value).toBe('undefined')
    expect((await executeInSandbox(`const d = Object.getOwnPropertyDescriptor(mermaid, 'registerFamily'); return d && d.value.constructor.constructor('return 7')()`)).value).toBeNull()
  })

  test('SDK results are read-only; structured edits must go through mutate', async () => {
    const setProp = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.edges[0].target = 'C'
      return 'unreachable'
    `)
    const pushArray = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.edges.push({ source: 'B', target: 'C' })
      return 'unreachable'
    `)
    const mapSet = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.nodes.set('C', {})
      return 'unreachable'
    `)
    const toJson = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      r.value.toJSON = () => 'hide-drift'
      return 'unreachable'
    `)
    const constructHostHelper = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      const arr = new (flow.body.graph.edges.toSpliced)(0, 0)
      return arr.constructor.constructor('return process.cwd()')()
    `)
    const reflectConstructNewTarget = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      const C = flow.body.graph.edges.toSpliced
      const o = Reflect.construct(Object, [], C)
      return o.constructor.constructor('return process.cwd()')()
    `)
    const mapOwnGetOverride = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.nodes.get = function () { return this.constructor.constructor('return process.cwd()')() }
      return flow.body.graph.nodes.get('A')
    `)
    const mapIteratorInjection = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.nodes[Symbol.iterator] = function * () { yield ['C', { id: 'C', label: 'Cache', shape: 'rectangle' }] }
      return mermaid.serializeMermaid(flow)
    `)
    const mapDefineProperty = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      Object.defineProperty(flow.body.graph.nodes, 'get', { value: () => 'owned' })
      return 'unreachable'
    `)
    const manualClone = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const clone = JSON.parse(JSON.stringify(r.value))
      return mermaid.mutate(clone, { kind: 'add_node', id: 'C', label: 'C' })
    `)
    const forgedProxy = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
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
    expect(manualClone.error).toContain('must come from mermaid.parseMermaid')
    expect(forgedProxy.error).toContain('must come from mermaid.parseMermaid')
  })

  test('collection callback helpers expose hardened values, not raw host objects', async () => {
    const ctor = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      let leaked = 'blocked'
      flow.body.graph.edges.forEach(e => { try { leaked = e.constructor.constructor('return typeof process')() } catch (_) { leaked = 'blocked' } })
      return leaked
    `)
    const arrayMutation = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.edges.map(e => { e.target = 'C'; return e })
      return mermaid.serializeMermaid(flow)
    `)
    const mapMutation = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.nodes.forEach(n => { n.label = 'Changed' })
      return mermaid.serializeMermaid(flow)
    `)
    const findLastCtor = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      let leaked = 'blocked'
      flow.body.graph.edges.findLast(e => { try { leaked = e.constructor.constructor('return typeof process')() } catch (_) { leaked = 'blocked' }; return false })
      return leaked
    `)
    const toSortedCtor = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B\\n  C --> D')
      const flow = mermaid.asFlowchart(r.value)
      let leaked = 'blocked'
      flow.body.graph.edges.toSorted((a, b) => { try { leaked = a.constructor.constructor('return typeof process')() } catch (_) { leaked = 'blocked' }; return 0 })
      return leaked
    `)
    const mapGetOrInsert = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.nodes.getOrInsert('C', { id: 'C', label: 'Cache', shape: 'rectangle' })
      return mermaid.serializeMermaid(flow)
    `)
    const defineGetter = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.edges[0].__defineGetter__('target', () => 'C')
      return mermaid.serializeMermaid(flow)
    `)
    const lookupProtoMapMutator = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      const protoGetter = flow.body.graph.nodes.__lookupGetter__('__proto__')
      const proto = protoGetter && protoGetter.call(flow.body.graph.nodes)
      proto.getOrInsert.call(flow.body.graph.nodes, 'C', { id: 'C', label: 'C', shape: 'rectangle' })
      return mermaid.serializeMermaid(flow)
    `)
    const callbackThisArgEscape = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      let leaked = 'blocked'
      flow.body.graph.edges.forEach(function () { try { leaked = this.constructor.constructor('return typeof process')() } catch (_) { leaked = 'blocked' } }, flow.body.graph.edges[0])
      return leaked
    `)
    const callbackThisArgMutation = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r.value)
      flow.body.graph.nodes.forEach(function () { this.label = 'Changed' }, flow.body.graph.nodes.get('A'))
      return mermaid.serializeMermaid(flow)
    `)
    expect(ctor).toMatchObject({ ok: true, value: 'blocked' })
    expect(arrayMutation.error).toContain('read-only')
    expect(mapMutation.error).toContain('read-only')
    expect(findLastCtor).toMatchObject({ ok: true, value: 'blocked' })
    expect(toSortedCtor).toMatchObject({ ok: true, value: 'blocked' })
    expect(mapGetOrInsert.error).toContain('read-only')
    expect(defineGetter.ok).toBe(false)
    expect(lookupProtoMapMutator.ok).toBe(false)
    expect(callbackThisArgEscape).toMatchObject({ ok: true, value: 'blocked' })
    expect(callbackThisArgMutation.error).toContain('read-only')
  })
  test('result getters are rejected instead of running after the VM timeout/commit point', async () => {
    const r = await executeInSandbox(`
      const r0 = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'C', label: 'Cache' })
      const verify = mermaid.verifyMermaid(r1.value)
      return { verify, get source() { return mermaid.serializeMermaid(r1.value) } }
    `, { trace: true })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('not allowed while returning results')
    expect((r.trace ?? []).some(c => c.verb === 'serialize')).toBe(false)
  })

  test('result serialization runs under the VM timeout', async () => {
    const r = await executeInSandbox(`return { get x() { while (true) {} } }`, { timeoutMs: 50 })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/timed out|timeout/i)
  })

  test('result handoff slot cannot be replaced with a host-assignment setter', async () => {
    const r = await executeInSandbox(`
      Object.defineProperty(globalThis, '__pi_result', { set(v) { while (true) {} }, configurable: true })
      return 1
    `, { timeoutMs: 50 })
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
    const stringify = await executeInSandbox(`
      JSON.stringify = () => ({ toString() { while (true) {} } })
      return 1
    `, { timeoutMs: 50 })
    expect(stringify).toMatchObject({ ok: true, value: 1 })

    const thrown = await executeInSandbox(`throw { get message() { while (true) {} } }`, { timeoutMs: 50 })
    expect(thrown.ok).toBe(false)
    expect(thrown.error).toMatch(/timed out|timeout|sandbox error/i)

    const spoof = await executeInSandbox(`
      const r = mermaid.parseMermaid('flowchart TD\\n A --> B')
      throw { get name() { mermaid.serializeMermaid(r.value); return 'SyntaxError' }, message: 'fake' }
    `, { trace: true })
    expect(spoof.ok).toBe(false)
    expect(spoof.trace?.map(c => c.verb)).toEqual(['parse'])
  })

  test('SDK facade descriptors expose wrapped traced functions, not raw SDK functions', async () => {
    const traced = await executeInSandbox(`
      const parse = Object.getOwnPropertyDescriptor(mermaid, 'parseMermaid').value
      const verifyMermaid = Object.getOwnPropertyDescriptor(mermaid, 'verifyMermaid').value
      const r0 = parse('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r0.value)
      const v = verifyMermaid(flow)
      return { ok: v.ok }
    `, { trace: true })
    expect(traced.ok).toBe(true)
    expect((traced.trace ?? []).map(c => c.verb)).toEqual(['parse', 'narrow', 'verify', 'verify_inspect'])

    const closed = await executeInSandbox(`
      const parse = Object.getOwnPropertyDescriptor(mermaid, 'parseMermaid').value
      const verifyMermaid = Object.getOwnPropertyDescriptor(mermaid, 'verifyMermaid').value
      const r0 = parse('flowchart TD\\n  A --> B')
      return { get late() { return verifyMermaid(r0.value).ok } }
    `, { trace: true })
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
  test('thrown error', async () => {
    const r = await executeInSandbox(`throw new Error('boom')`)
    expect(r.ok).toBe(false); expect(r.error).toContain('boom')
  })
  test('broken arrow (syntax) reported, not crashed', async () => {
    const r = await executeInSandbox(`this is not valid :::`)
    expect(r.ok).toBe(false)
  })
  test('runaway loop hits timeout', async () => {
    const r = await executeInSandbox(`while (true) {}`, { timeoutMs: 200 })
    expect(r.ok).toBe(false); expect(r.error).toMatch(/timed out|timeout/i)
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
    expect(r.ok).toBe(true); expect(r.value).toBeNull()
  })
  test('top-level await is rejected because Code Mode is synchronous', async () => {
    const r = await executeInSandbox(`await Promise.resolve(42)`)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('synchronous')
  })
  test('multi-statement no-return → ok with null', async () => {
    const r = await executeInSandbox(`const x = 5\nconst y = 10`)
    expect(r.ok).toBe(true); expect(r.value).toBeNull()
  })
  test('explicit return after const decl', async () => {
    expect((await executeInSandbox(`const x = 5; return x * 2`)).value).toBe(10)
  })
})

describe('MCP — JSON-RPC happy + sad', () => {
  test('initialize', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    expect((r!.result as any).serverInfo.name).toBe('agentic-mermaid-mcp')
    const instructions = (r!.result as any).instructions as string
    for (const family of BUILTIN_FAMILY_METADATA) expect(instructions).toContain(family.narrower)
    expect(instructions).not.toContain('Journey, xychart, architecture')
  })
  test('tools/list has execute with SDK', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const tools = (r!.result as any).tools
    // Loop 9 M1 + M12: render_png and describe joined execute.
    expect(tools.map((t: any) => t.name)).toEqual(['execute', 'render_png', 'describe'])
    for (const token of [
      ...BUILTIN_FAMILY_METADATA.map(f => f.narrower),
      'TimelineMutationOp',
      'ClassMutationOp',
      'ErMutationOp',
    ]) {
      expect(tools[0].description).toContain(token)
    }
  })
  test('tools/call execute', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'execute', arguments: { code: 'return mermaid.verifyMermaid("flowchart TD\\n A --> B").ok' } } })
    expect((r!.result as any).isError).toBe(false)
    expect(JSON.parse((r!.result as any).content[0].text).value).toBe(true)
  })
  test('unknown tool → error', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } })
    expect(r!.error).toBeDefined()
  })
  test('missing code arg → error', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'execute', arguments: {} } })
    expect(r!.error).toBeDefined()
  })
  test('unknown method → -32601', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 6, method: 'made/up' })
    expect(r!.error!.code).toBe(-32601)
  })
  test('notifications/initialized → null (no response)', async () => {
    expect(await handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
  })
  test('malformed params on tools/call do not throw', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: null })
    expect(r!.error).toBeDefined()
  })
})

describe('CLI — sad paths via runCli', () => {
  // Capture stdout
  function capture(fn: () => number): { code: number; out: string } {
    const chunks: string[] = []
    const orig = process.stdout.write.bind(process.stdout)
    ;(process.stdout as any).write = (s: string) => { chunks.push(s); return true }
    let code: number
    try { code = fn() } finally { (process.stdout as any).write = orig }
    return { code, out: chunks.join('') }
  }

  test('render parse failures exit 2 with PARSE_FAILED, not INTERNAL', () => {
    const tmp = `/tmp/cli-render-invalid-${Date.now()}.mmd`
    require('node:fs').writeFileSync(tmp, 'notmermaid\n')
    const { code, out } = capture(() => runCli(['render', tmp, '--format', 'svg', '--json']))
    expect(code).toBe(2)
    expect(out).toContain('PARSE_FAILED')
  })

  test('mutate on structured architecture succeeds (BUILD-17); opaque architecture stays unsupported', () => {
    const tmp = `/tmp/cli-architecture-${Date.now()}.mmd`
    require('node:fs').writeFileSync(tmp, 'architecture-beta\n  service api(server)[API]\n')
    const { code, out } = capture(() => runCli(['mutate', tmp, '--op', '{"kind":"add_service","id":"db","label":"Database","icon":"database"}', '--json']))
    expect(code).toBe(0)
    const payload = JSON.parse(out)
    expect(payload.ok).toBe(true)
    expect(payload.source).toContain('service db(database)[Database]')

    // The {group} boundary modifier is unmodeled → opaque → not mutable.
    const opaqueTmp = `/tmp/cli-architecture-opaque-${Date.now()}.mmd`
    require('node:fs').writeFileSync(opaqueTmp, 'architecture-beta\n  accTitle: A11y\n  service api(server)[API]\n')
    const opaque = capture(() => runCli(['mutate', opaqueTmp, '--op', '{"kind":"add_service","id":"db","label":"DB"}', '--json']))
    expect(opaque.code).toBe(2)
    expect(JSON.parse(opaque.out).error.code).toBe('UNSUPPORTED_FAMILY')
  })

  test('mutate on structured journey succeeds (BUILD-15); opaque journey stays unsupported', () => {
    const tmp = `/tmp/cli-journey-${Date.now()}.mmd`
    require('node:fs').writeFileSync(tmp, 'journey\n  section Work\n  Code: 4: Me\n')
    const { code, out } = capture(() => runCli(['mutate', tmp, '--op', '{"kind":"add_task","sectionIndex":0,"text":"Review","score":5,"actors":["Me"]}', '--json']))
    expect(code).toBe(0)
    const payload = JSON.parse(out)
    expect(payload.ok).toBe(true)
    expect(payload.source).toContain('Review: 5: Me')

    const opaqueTmp = `/tmp/cli-journey-opaque-${Date.now()}.mmd`
    require('node:fs').writeFileSync(opaqueTmp, 'journey\n  accTitle: A11y\n  Code: 4: Me\n')
    const opaque = capture(() => runCli(['mutate', opaqueTmp, '--op', '{"kind":"add_task","sectionIndex":0,"text":"Review","score":5}', '--json']))
    expect(opaque.code).toBe(2)
    expect(JSON.parse(opaque.out).error.code).toBe('UNSUPPORTED_FAMILY')
  })

  test('mutate on structured xychart succeeds (BUILD-16); opaque xychart stays unsupported', () => {
    const tmp = `/tmp/cli-xychart-${Date.now()}.mmd`
    require('node:fs').writeFileSync(tmp, 'xychart-beta\n  x-axis [Jan, Feb]\n  bar [1, 2]\n')
    const { code, out } = capture(() => runCli(['mutate', tmp, '--op', '{"kind":"add_series","kind2":"line","name":"Mobile","values":[3,4]}', '--json']))
    expect(code).toBe(0)
    const payload = JSON.parse(out)
    expect(payload.ok).toBe(true)
    expect(payload.source).toContain('line Mobile [3, 4]')

    const opaqueTmp = `/tmp/cli-xychart-opaque-${Date.now()}.mmd`
    require('node:fs').writeFileSync(opaqueTmp, 'xychart-beta\n  title "Quoted"\n  bar [1, 2]\n')
    const opaque = capture(() => runCli(['mutate', opaqueTmp, '--op', '{"kind":"set_title","title":"X"}', '--json']))
    expect(opaque.code).toBe(2)
    expect(JSON.parse(opaque.out).error.code).toBe('UNSUPPORTED_FAMILY')
  })

  test('mutate on sequence-with-notes (BUILD-18: structured-with-segments) succeeds and keeps the note', () => {
    const tmp = `/tmp/cli-seqnote-${Date.now()}.mmd`
    require('node:fs').writeFileSync(tmp, 'sequenceDiagram\n  A->>B: Hi\n  Note over A: thinking\n')
    const { code, out } = capture(() => runCli(['mutate', tmp, '--op', '{"kind":"add_message","from":"A","to":"B","text":"x"}']))
    expect(code).toBe(0)
    // The Note rides along verbatim; the new message lands after it.
    expect(out).toContain('Note over A: thinking')
    expect(out).toContain('A->>B: x')
  })

  test('mutate verifies before emitting and exits 3 when the result is invalid', () => {
    const tmp = `/tmp/cli-mutate-invalid-${Date.now()}.mmd`
    require('node:fs').writeFileSync(tmp, 'flowchart TD\n  A[Only]\n')
    const { code, out } = capture(() => runCli(['mutate', tmp, '--op', '{"kind":"remove_node","id":"A"}', '--json']))
    expect(code).toBe(3)
    const payload = JSON.parse(out)
    expect(payload.ok).toBe(false)
    expect(payload.error.code).toBe('VERIFY_FAILED')
    expect(payload.error.details.map((w: any) => w.code)).toContain('EMPTY_DIAGRAM')
    expect(payload.source).toBeUndefined()
  })

  test('mutate --json includes verify warnings on success', () => {
    const tmp = `/tmp/cli-mutate-warning-${Date.now()}.mmd`
    require('node:fs').writeFileSync(tmp, 'flowchart TD\n  A --> B\n')
    const long = 'X'.repeat(80)
    const { code, out } = capture(() => runCli(['mutate', tmp, '--op', JSON.stringify({ kind: 'add_node', id: 'C', label: long }), '--json']))
    expect(code).toBe(0)
    const payload = JSON.parse(out)
    expect(payload.ok).toBe(true)
    expect(payload.source).toContain('C')
    expect(payload.verify.warnings.map((w: any) => w.code)).toContain('LABEL_OVERFLOW')
  })

  test('mutate supports class diagrams through the public CLI surface', () => {
    const tmp = `/tmp/cli-class-${Date.now()}.mmd`
    require('node:fs').writeFileSync(tmp, 'classDiagram\n  class Animal\n')
    const { code, out } = capture(() => runCli(['mutate', tmp, '--op', JSON.stringify({ kind: 'add_class', id: 'Duck', members: ['+quack()'] })]))
    expect(code).toBe(0)
    expect(out).toContain('Duck')
    expect(out).toContain('+quack()')
  })

  test('verify exit code 3 on empty (Loop 7: EXIT_VERIFY_FAILED)', () => {
    // Was 2 in Loop ≤6 (when verify-failed shared an exit code with arg
    // errors); Loop 7 split out a dedicated EXIT_VERIFY_FAILED=3 so a CI
    // script can branch on cause-of-failure.
    const tmp = `/tmp/cli-empty-${Date.now()}.mmd`
    require('node:fs').writeFileSync(tmp, '')
    const { code } = capture(() => runCli(['verify', tmp]))
    expect(code).toBe(3)
  })

  test('--help per command differs from global', () => {
    const g = capture(() => runCli(['--help']))
    expect(g.code).toBe(0)
    const v = capture(() => runCli(['verify', '--help']))
    expect(v.out).toContain('am verify')
    expect(v.out).not.toEqual(g.out)
  })

  test('REGRESSION: am parse | am serialize supports structured payload families', () => {
    const { synthesizeFromGraph, serializeMermaid } = require('../agent/serialize.ts')
    for (const src of [
      'classDiagram\n  class Animal\n',
      'timeline\n  title Plan\n  2024 : Alpha\n',
      'erDiagram\n  CUSTOMER {\n    string id\n  }\n',
    ]) {
      const tmp = `/tmp/cli-structured-${Date.now()}-${Math.random()}.mmd`
      require('node:fs').writeFileSync(tmp, src)
      const parsed = capture(() => runCli(['parse', tmp]))
      expect(parsed.code).toBe(0)
      const payload = JSON.parse(parsed.out)
      const r = synthesizeFromGraph(payload)
      expect(r.ok).toBe(true)
      expect(serializeMermaid(r.value).trim()).toContain(src.trim().split('\n')[0])
    }
  })

  test('REGRESSION: am parse | am serialize preserves flowchart styling (lossless)', () => {
    const tmp = `/tmp/cli-styled-${Date.now()}.mmd`
    require('node:fs').writeFileSync(tmp, 'flowchart TD\n  A[Start] --> B[End]\n  classDef hot fill:#f00\n  class A hot\n  style B stroke:#0f0\n  linkStyle 0 stroke:#00f\n')
    const parsed = capture(() => runCli(['parse', tmp]))
    expect(parsed.code).toBe(0)
    const tmpJson = `/tmp/cli-styled-json-${Date.now()}.json`
    require('node:fs').writeFileSync(tmpJson, parsed.out)
    // Feed the parse JSON back through serialize via a stdin shim: write to fd 0
    // is awkward in-process, so re-synthesize directly to assert the data path.
    const { synthesizeFromGraph } = require('../agent/serialize.ts')
    const { serializeMermaid } = require('../agent/serialize.ts')
    const payload = JSON.parse(parsed.out)
    const r = synthesizeFromGraph(payload)
    expect(r.ok).toBe(true)
    const out = serializeMermaid(r.value)
    expect(out).toContain('classDef hot fill:#f00')
    expect(out).toContain('class A hot')
    expect(out).toContain('style B stroke:#0f0')
    expect(out).toContain('linkStyle 0 stroke:#00f')
  })

  test('format idempotent over 3 rounds', () => {
    const tmp = `/tmp/cli-fmt-${Date.now()}.mmd`
    require('node:fs').writeFileSync(tmp, 'flowchart TD\n  A[Alpha] --> B{D}\n  B -->|yes| C((End))\n')
    const r1 = capture(() => runCli(['format', tmp]))
    require('node:fs').writeFileSync(tmp, r1.out)
    const r2 = capture(() => runCli(['format', tmp]))
    require('node:fs').writeFileSync(tmp, r2.out)
    const r3 = capture(() => runCli(['format', tmp]))
    expect(r2.out).toEqual(r1.out)
    expect(r3.out).toEqual(r1.out)
  })
})
