import { describe, expect, spyOn, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { pathToFileURL } from 'node:url'
import { useTempDirs } from './helpers/temp-dir.ts'
import { handleRequest } from '../mcp/server.ts'
import { runSourceToolIsolated, SourceToolExecutor, type RenderProcess } from '../mcp/source-worker-client.ts'
import { sourceToolMessage, SourceToolMessageLimitError, type SourceToolRequest } from '../mcp/source-tool-message.ts'
import { SourceRenderProcess } from '../mcp/source-render-process.ts'

const temp = useTempDirs('am-source-tools-')

function workerFixture(code: string): URL {
  return pathToFileURL(temp.file('renderer-fixture.mjs', `import { parentPort } from 'node:worker_threads';\n${code}`))
}

function rendererExit(renderer: SourceRenderProcess): Promise<{ code: number | null; signal: string | null }> {
  return new Promise(resolve => renderer.once('exit', (code, signal) => resolve({ code, signal })))
}

function rendererReply(renderer: SourceRenderProcess, id: number): Promise<Record<string, any>> {
  return new Promise(resolve => {
    renderer.once('message', reply => { expect(reply.id).toBe(id); resolve(JSON.parse(reply.json)) })
    renderer.postMessage({ type: 'request', id, json: '{}' })
  })
}

class ControlledRenderer extends EventEmitter implements RenderProcess {
  readonly sent: SourceToolRequest[] = []
  terminations = 0
  postMessage(message: SourceToolRequest): void { this.sent.push(message) }
  terminate(): void { this.terminations++ }
  ref(): void {}
  unref(): void {}
  reply(id: number, value: unknown): void { this.emit('message', { type: 'result', id, json: JSON.stringify(value) }) }
}

async function call(name: string, args: Record<string, unknown>) {
  const response = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  expect(response?.error).toBeUndefined()
  const result = response?.result as { isError: boolean; content: { text: string }[]; structuredContent: Record<string, any> }
  expect(result.structuredContent).toEqual(JSON.parse(result.content[0]!.text))
  return result
}

describe('local MCP direct source tools', () => {
  test('inherited Node flags cannot enlarge the optional V8 heap guard', () => {
    const worker = workerFixture(`import { getHeapStatistics } from 'node:v8';
parentPort.on('message', ({id}) => parentPort.postMessage({type:'result',id,json:JSON.stringify({heap:getHeapStatistics().heap_size_limit})}));
parentPort.postMessage({type:'ready'});`)
    const entry = new URL('../mcp/source-render-process.ts', import.meta.url).href
    const code = `import {SourceRenderProcess} from ${JSON.stringify(entry)}; const renderer=new SourceRenderProcess({worker:new URL(${JSON.stringify(worker.href)})}); renderer.once('message', reply=>{console.log(reply.json);renderer.terminate()}); renderer.postMessage({type:'request',id:1,json:'{}'});`
    const child = spawnSync('node', ['--max-old-space-size=1024', '--input-type=module', '-e', code], {
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048' }, encoding: 'utf8', timeout: 10_000,
    })
    expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
    const { heap } = JSON.parse(child.stdout)
    expect(heap).toBeGreaterThan(480 * 1024 * 1024)
    expect(heap).toBeLessThanOrEqual(512 * 1024 * 1024)
  }, 15_000)

  test('bounds native Buffer allocations with the whole-process watchdog', async () => {
    const worker = workerFixture(`parentPort.on('message', () => { const held=[]; for(let i=0;i<32;i++) held.push(Buffer.alloc(8*1024*1024,42)); parentPort.postMessage({type:'result',id:1,json:'{}'}); }); parentPort.postMessage({type:'ready'});`)
    const renderer = new SourceRenderProcess({ worker, memoryBudgetBytes: 96 * 1024 * 1024 })
    const closed = rendererExit(renderer)
    try {
      const ready = await Promise.race([new Promise(resolve => renderer.once('ready', resolve)), closed])
      expect(ready).toMatchObject({ type: 'ready' })
      renderer.postMessage({ type: 'request', id: 1, json: '{}' })
      expect(await closed).toMatchObject({ code: 72 })
    } finally { renderer.terminate(); await closed }
  }, 10_000)

  test('failed spawn produces a structured failure and releases the executor slot', async () => {
    const broken = new SourceRenderProcess({ executable: '/nonexistent/am-renderer' })
    const closed = rendererExit(broken)
    let starts = 0
    let recovered: SourceRenderProcess | undefined
    let recoveredExit: ReturnType<typeof rendererExit> | undefined
    const executor = new SourceToolExecutor(() => {
      if (++starts === 1) return broken
      recovered = new SourceRenderProcess()
      recoveredExit = rendererExit(recovered)
      return recovered
    })
    try {
      expect(await executor.run('verify', { source: 'sequenceDiagram\nA->>B: Hello' })).toMatchObject({ ok: false, error: { code: 'RENDER_WORKER_FAILED' } })
      await closed
      expect(await executor.run('verify', { source: 'sequenceDiagram\nA->>B: Recovered' })).toMatchObject({ ok: true, family: 'sequence' })
      expect(starts).toBe(2)
    } finally { broken.terminate(); recovered?.terminate(); await Promise.all([closed, recoveredExit]) }
  }, 15_000)

  test.each(['before ready', 'after ready'])('worker failure %s terminates its supervisor', async phase => {
    const worker = workerFixture(phase === 'before ready'
      ? `throw new Error('fixture startup failure')`
      : `parentPort.on('message',()=>{throw new Error('fixture request failure')}); parentPort.postMessage({type:'ready'});`)
    const renderer = new SourceRenderProcess({ worker })
    const closed = rendererExit(renderer)
    try {
      renderer.postMessage({ type: 'request', id: 1, json: '{}' })
      expect(await closed).toMatchObject({ code: 73 })
    } finally { renderer.terminate(); await closed }
  }, 10_000)

  test('supervisor rejects an oversized worker reply before forwarding it', async () => {
    const worker = workerFixture(`parentPort.on('message', ({id}) => parentPort.postMessage({type:'result',id,json:'x'.repeat(16*1024*1024+1)}));parentPort.postMessage({type:'ready'});`)
    const renderer = new SourceRenderProcess({ worker })
    const closed = rendererExit(renderer)
    let forwarded = false
    renderer.on('message', () => { forwarded = true })
    try {
      renderer.postMessage({ type: 'request', id: 1, json: '{}' })
      expect(await closed).toMatchObject({ code: 73 })
      expect(forwarded).toBe(false)
    } finally { renderer.terminate(); await closed }
  }, 10_000)

  test('a malformed source remains a typed result and leaves the renderer usable', async () => {
    let starts = 0
    let renderer: SourceRenderProcess | undefined
    let closed: ReturnType<typeof rendererExit> | undefined
    const executor = new SourceToolExecutor(() => {
      starts++
      renderer = new SourceRenderProcess()
      closed = rendererExit(renderer)
      return renderer
    })
    try {
      expect(await executor.run('render_svg', { source: 'sequenceDiagram\ninvalid ???' })).toMatchObject({ ok: false, error: { code: 'MERMAID_SYNTAX_ERROR', diagramType: 'sequence', line: 2 } })
      expect(await executor.run('verify', { source: 'sequenceDiagram\nA->>B: Recovered' })).toMatchObject({ ok: true, family: 'sequence' })
      expect(starts).toBe(1)
    } finally { renderer?.terminate(); await closed }
  }, 15_000)

  test('a busy worker times out and a fresh renderer accepts the next request', async () => {
    const worker = workerFixture(`parentPort.on('message',({id})=>{parentPort.postMessage({type:'started',id});while(true){}});parentPort.postMessage({type:'ready'});`)
    const busy = new SourceRenderProcess({ worker })
    const busyExit = rendererExit(busy)
    let fresh: SourceRenderProcess | undefined
    let freshExit: ReturnType<typeof rendererExit> | undefined
    let started = false
    busy.on('message', message => { if (message.type === 'started') started = true })
    const executor = new SourceToolExecutor(() => {
      if (!started) return busy
      fresh = new SourceRenderProcess()
      freshExit = rendererExit(fresh)
      return fresh
    })
    try {
      await Promise.race([new Promise(resolve => busy.once('ready', resolve)), busyExit])
      expect(await executor.run('verify', {}, { timeoutMs: 100 })).toMatchObject({ ok: false, error: { code: 'RENDER_TIMEOUT' } })
      expect(started).toBe(true)
      expect(await executor.run('verify', { source: 'sequenceDiagram\nA->>B: Recovered' })).toMatchObject({ ok: true, family: 'sequence' })
    } finally { busy.terminate(); fresh?.terminate(); await Promise.all([busyExit, freshExit]) }
  }, 15_000)

  test('natural shutdown reaps the unreferenced idle renderer', () => {
    const worker = workerFixture(`parentPort.on('message',({id})=>parentPort.postMessage({type:'result',id,json:JSON.stringify({pid:process.pid})}));parentPort.postMessage({type:'ready'});`)
    const entry = new URL('../mcp/source-render-process.ts', import.meta.url).href
    const code = `import {SourceRenderProcess} from ${JSON.stringify(entry)}; const renderer=new SourceRenderProcess({worker:new URL(${JSON.stringify(worker.href)})}); renderer.once('message', reply=>{console.log(reply.json);renderer.unref()});renderer.postMessage({type:'request',id:1,json:'{}'});`
    const child = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 10_000 })
    expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
    const { pid } = JSON.parse(child.stdout)
    expect(pid).toBeGreaterThan(0)
    expect(() => process.kill(pid, 0)).toThrow()
  }, 15_000)

  test('Bun renders all three tools without Node on PATH', () => {
    const entry = new URL('../mcp/source-worker-client.ts', import.meta.url).href
    const code = `import {runSourceToolIsolated as run} from ${JSON.stringify(entry)}; for (const name of ['render_svg','render_ascii','verify']) console.log(JSON.stringify(await run(name,{source:'sequenceDiagram\\nA->>B: Hello'})));`
    const child = spawnSync(process.execPath, ['-e', code], { env: { ...process.env, PATH: '/nonexistent' }, encoding: 'utf8', timeout: 10_000 })
    expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
    const [svg, ascii, verify] = child.stdout.trim().split('\n').map(line => JSON.parse(line))
    expect(svg).toMatchObject({ ok: true, svg: expect.stringContaining('<svg') })
    expect(ascii).toMatchObject({ ok: true, text: expect.stringContaining('Hello') })
    expect(verify).toMatchObject({ ok: true, family: 'sequence' })
  }, 15_000)

  test('successive calls reuse the same initialized renderer worker', async () => {
    const worker = workerFixture(`const initialization=Math.random();parentPort.on('message',({id})=>parentPort.postMessage({type:'result',id,json:JSON.stringify({pid:process.pid,initialization})}));parentPort.postMessage({type:'ready'});`)
    const renderer = new SourceRenderProcess({ worker })
    const closed = rendererExit(renderer)
    try {
      const first = await rendererReply(renderer, 1)
      const second = await rendererReply(renderer, 2)
      expect(second).toEqual(first)
      expect(first.pid).toBeGreaterThan(0)
    } finally { renderer.terminate(); await closed }
  }, 10_000)

  test('renders SVG and terminal text with structured receipts', async () => {
    const source = '---\ntitle: Greeting\n---\nsequenceDiagram\nA->>B: Hello'
    const svg = await call('render_svg', { source })
    expect(svg.isError).toBe(false)
    expect(svg.structuredContent).toMatchObject({ ok: true, svg: expect.stringContaining('<svg'), receipt: { output: 'svg' } })
    const ascii = await call('render_ascii', { source, useAscii: true })
    const text = ascii.structuredContent.text
    expect(ascii.isError).toBe(false)
    expect(ascii.structuredContent).toMatchObject({ ok: true, text: expect.stringContaining('Hello'), receipt: { output: 'ascii' } })
    expect(text).not.toMatch(/[┌─│]/)
  }, 30_000)

  test('verifies valid source and rejects ambiguous malformed edges', async () => {
    const good = await call('verify', { source: 'sequenceDiagram\nA->>B: Hello' })
    expect(good.isError).toBe(false)
    expect(good.structuredContent).toMatchObject({ ok: true, family: 'sequence', layout: { nodes: 2, edges: 1 } })
    const bad = await call('verify', { source: 'flowchart TD\nB --> [oops' })
    expect(bad.isError).toBe(true)
    expect(bad.structuredContent).toMatchObject({ ok: false, errors: [{ code: 'PARSE_FAILED' }] })
  }, 30_000)

  test.each([
    // A statement only the renderer refuses is a syntax error at its location;
    // source the registered parser rejects is that parse failure, as verify
    // and the CLI report it.
    ['sequenceDiagram\ninvalid ???', { code: 'MERMAID_SYNTAX_ERROR', diagramType: 'sequence', line: 2, column: 1 }],
    ['---\ntitle: Invalid\n---\nmindmap\n  Root\n  Other', { code: 'PARSE_FAILED', details: [{ diagramType: 'mindmap', line: 6 }] }],
    ['---\ntitle: Invalid\n---\ngitGraph\n  commit\n  checkout missing', { code: 'PARSE_FAILED', details: [{ diagramType: 'gitgraph', line: 6 }] }],
  ])('preserves source errors across the process boundary: %s', async (source, error) => {
    const bad = await call('render_svg', { source })
    expect(bad.isError).toBe(true)
    expect(bad.structuredContent).toMatchObject({ ok: false, error })
  }, 30_000)

  test('rejects invalid arguments at admission', async () => {
    const response = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_ascii', arguments: { source: 'sequenceDiagram', targetWidth: 'wide' } } })
    expect(response?.error?.code).toBe(-32602)
  })

  test('concurrent operations cannot consume each other\'s results', async () => {
    const [first, second] = await Promise.all([
      runSourceToolIsolated('render_ascii', { source: 'sequenceDiagram\nA->>B: First' }),
      runSourceToolIsolated('render_ascii', { source: 'sequenceDiagram\nA->>B: Second' }),
    ])
    expect(first).toMatchObject({ ok: true, text: expect.stringContaining('First') })
    expect(second).toMatchObject({ ok: true, text: expect.stringContaining('Second') })
  }, 30_000)

  test('bounds admission and preserves every accepted result during a burst', async () => {
    // Warm the renderer so the burst exercises an occupied slot and its queue.
    await runSourceToolIsolated('render_ascii', { source: 'sequenceDiagram\nA->>B: Warm' })
    const results = await Promise.all(Array.from({ length: 40 }, (_, index) => runSourceToolIsolated('render_ascii', { source: `sequenceDiagram\nA->>B: Burst${index}` })))
    expect(results.filter(result => (result.error as { code?: string } | undefined)?.code === 'RENDER_BUSY')).toHaveLength(7)
    for (let index = 0; index < 33; index++) expect(results[index]).toMatchObject({ ok: true, text: expect.stringContaining(`Burst${index}`) })
  }, 30_000)

  test('cancelling or expiring queued work leaves the active call intact', async () => {
    const active = runSourceToolIsolated('render_svg', { source: 'flowchart TD\n' + Array.from({ length: 20 }, (_, i) => `A${i}-->A${i+1}`).join('\n') })
    const controller = new AbortController()
    const cancelled = runSourceToolIsolated('render_ascii', { source: 'sequenceDiagram\nA->>B: Cancelled' }, { signal: controller.signal })
    const expired = runSourceToolIsolated('render_ascii', { source: 'sequenceDiagram\nA->>B: Expired' }, { timeoutMs: 0 })
    controller.abort()
    expect(await cancelled).toMatchObject({ ok: false, error: { code: 'RENDER_CANCELLED' } })
    expect(await expired).toMatchObject({ ok: false, error: { code: 'RENDER_TIMEOUT' } })
    expect(await active).toMatchObject({ ok: true, svg: expect.stringContaining('<svg') })
  }, 30_000)

  test('times out, cancels active work and then accepts a fresh request', async () => {
    expect(await runSourceToolIsolated('render_svg', { source: 'flowchart TD\nA-->B' }, { timeoutMs: 0 })).toMatchObject({ ok: false, error: { code: 'RENDER_TIMEOUT' } })
    const controller = new AbortController()
    const pending = runSourceToolIsolated('render_svg', { source: 'flowchart TD\nA-->B' }, { signal: controller.signal })
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, error: { code: 'RENDER_CANCELLED' } })
    expect(await runSourceToolIsolated('render_ascii', { source: 'sequenceDiagram\nA->>B: Recovered' })).toMatchObject({ ok: true, text: expect.stringContaining('Recovered') })
  }, 30_000)
})


describe('render process message and generation boundaries', () => {
  test.each(['argument getter', 'toJSON', 'timeout getter', 'signal registration'])('rechecks queue capacity after caller code in %s', async boundary => {
    const renderer = new ControlledRenderer(), executor = new SourceToolExecutor(() => renderer)
    const jobs = [executor.run('verify', {})]
    let calls = 0
    const fill = () => {
      calls++
      for (let index = 0; index < 32; index++) jobs.push(executor.run('verify', {}))
    }
    const controller = new AbortController()
    const args = boundary === 'argument getter' ? { get source() { fill(); return 'A' } }
      : boundary === 'toJSON' ? { toJSON() { fill(); return { source: 'A' } } } : { source: 'A' }
    if (boundary === 'signal registration') {
      const add = controller.signal.addEventListener
      Object.defineProperty(controller.signal, 'addEventListener', { value: (...values: unknown[]) => {
        fill()
        return Reflect.apply(add, controller.signal, values)
      } })
    }
    const outer = executor.run('verify', args, { signal: controller.signal,
      get timeoutMs() { if (boundary === 'timeout getter') fill(); return 30_000 },
    })
    for (let index = 0; index < renderer.sent.length; index++) renderer.reply(renderer.sent[index]!.id, { ok: true })
    expect(await outer).toMatchObject({ error: { code: 'RENDER_BUSY' } })
    expect(calls).toBe(1)
    expect(renderer.sent).toHaveLength(33)
    await Promise.all(jobs)
  })

  test.each(['argument getter', 'toJSON', 'timeout getter', 'signal registration'])('cancellation during %s prevents dispatch', async boundary => {
    const renderer = new ControlledRenderer(), executor = new SourceToolExecutor(() => renderer), controller = new AbortController()
    let calls = 0
    const cancel = () => { calls++; controller.abort() }
    const args = boundary === 'argument getter' ? { get source() { cancel(); return 'A' } }
      : boundary === 'toJSON' ? { toJSON() { cancel(); return { source: 'A' } } } : { source: 'A' }
    if (boundary === 'signal registration') {
      const add = controller.signal.addEventListener
      Object.defineProperty(controller.signal, 'addEventListener', { value: (...values: unknown[]) => {
        cancel()
        return Reflect.apply(add, controller.signal, values)
      } })
    }
    const result = executor.run('verify', args, { signal: controller.signal,
      get timeoutMs() { if (boundary === 'timeout getter') cancel(); return 30_000 },
    })
    if (renderer.sent.length) renderer.reply(renderer.sent[0]!.id, { ok: true })
    expect(await result).toMatchObject({ error: { code: 'RENDER_CANCELLED' } })
    expect(calls).toBe(1)
    expect(renderer.sent).toEqual([])
  })

  test('a timeout getter cannot overbook the queued byte budget', async () => {
    const renderer = new ControlledRenderer(), executor = new SourceToolExecutor(() => renderer)
    const jobs = [executor.run('verify', {})], source = 'x'.repeat(3 * 1024 * 1024)
    const outer = executor.run('verify', { source }, {
      get timeoutMs() {
        for (let index = 0; index < 5; index++) jobs.push(executor.run('verify', { source }))
        return 30_000
      },
    })
    for (let index = 0; index < renderer.sent.length; index++) renderer.reply(renderer.sent[index]!.id, { ok: true })
    expect(await outer).toMatchObject({ error: { code: 'RENDER_BUSY' } })
    expect(renderer.sent).toHaveLength(6)
    for (const result of await Promise.all(jobs)) expect(result).toEqual({ ok: true })
  })

  test('captures the cancellation signal once for admission, listening and cleanup', async () => {
    const renderer = new ControlledRenderer(), executor = new SourceToolExecutor(() => renderer), controller = new AbortController()
    let reads = 0
    const result = executor.run('verify', {}, {
      get signal() {
        if (++reads > 1) throw new Error('signal was read after admission')
        return controller.signal
      },
    })
    renderer.reply(renderer.sent[0]!.id, { ok: true })
    expect(await result).toEqual({ ok: true })
    expect(reads).toBe(1)
    controller.abort()
    expect(renderer.terminations).toBe(0)
  })

  test('timeout cleanup releases its timer and abort listener when retirement throws', async () => {
    const renderer = new ControlledRenderer(), controller = new AbortController()
    const retirementError = new Error('cannot retire renderer')
    renderer.terminate = () => { throw retirementError }
    let expire!: () => void
    const timer = spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: any[]) => void) => {
      expire = callback
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout)
    const clear = spyOn(globalThis, 'clearTimeout').mockImplementation(() => {})
    const remove = spyOn(controller.signal, 'removeEventListener')
    try {
      const executor = new SourceToolExecutor(() => renderer)
      const result = executor.run('verify', {}, { signal: controller.signal })
      expect(() => expire()).toThrow(retirementError)
      expect(await result).toMatchObject({ error: { code: 'RENDER_TIMEOUT' } })
      expect(clear).toHaveBeenCalledTimes(1)
      expect(remove).toHaveBeenCalledTimes(1)
      renderer.emit('exit', 73)
    } finally { timer.mockRestore(); clear.mockRestore(); remove.mockRestore() }
  })

  test('releases queued byte reservations on cancellation and completion', async () => {
    const renderer = new ControlledRenderer(), executor = new SourceToolExecutor(() => renderer)
    const controllers = Array.from({ length: 7 }, () => new AbortController())
    const source = 'x'.repeat(3 * 1024 * 1024)
    const jobs = controllers.slice(0, 6).map(controller => executor.run('verify', { source }, { signal: controller.signal }))
    expect(await executor.run('verify', { source })).toMatchObject({ error: { code: 'RENDER_BUSY' } })
    controllers[1]!.abort()
    expect(await jobs[1]).toMatchObject({ error: { code: 'RENDER_CANCELLED' } })
    jobs.push(executor.run('verify', { source }, { signal: controllers[6]!.signal }))
    renderer.reply(renderer.sent[0]!.id, { ok: true })
    expect(await jobs[0]).toEqual({ ok: true })
    // Dequeueing the next job releases another reservation.
    const last = new AbortController()
    jobs.push(executor.run('verify', { source }, { signal: last.signal }))
    controllers.forEach(controller => controller.abort()); last.abort()
    renderer.emit('exit', 0)
    const results = await Promise.all(jobs)
    for (const result of results.slice(1)) expect(result).toMatchObject({ error: { code: 'RENDER_CANCELLED' } })
  })

  test('rejects oversized strings, escaped text and scalar-heavy results before IPC', () => {
    const value = { text: 'Hello \u{1f30d}\n' }
    expect(JSON.parse(sourceToolMessage(value, 128))).toEqual(value)
    expect(() => sourceToolMessage({ text: 'x'.repeat(128) }, 64)).toThrow(SourceToolMessageLimitError)
    expect(() => sourceToolMessage({ text: '\u0000'.repeat(16) }, 64)).toThrow(SourceToolMessageLimitError)
    expect(() => sourceToolMessage(Array(64).fill(999999), 64)).toThrow(SourceToolMessageLimitError)
  })

  test.each(['null', '42', '[]', '{}', '{"ok":"false"}'])('retires malformed JSON result shapes and recovers: %s', async json => {
    const renderers: ControlledRenderer[] = []
    const executor = new SourceToolExecutor(() => { const renderer = new ControlledRenderer(); renderers.push(renderer); return renderer })
    const failed = executor.run('verify', {})
    const queued = executor.run('verify', {})
    const old = renderers[0]!
    old.emit('message', { type: 'result', id: old.sent[0]!.id, json })
    expect(await failed).toMatchObject({ ok: false, error: { code: 'RENDER_WORKER_FAILED' } })
    expect(old.terminations).toBe(1)
    expect(renderers).toHaveLength(1)
    old.emit('exit', 73)
    const fresh = renderers[1]!
    fresh.reply(fresh.sent[0]!.id, { ok: true, recovered: true })
    expect(await queued).toEqual({ ok: true, recovered: true })
  })

  test('rejects an oversized request without starting a renderer', async () => {
    let starts = 0
    const executor = new SourceToolExecutor(() => { starts++; return new ControlledRenderer() })
    expect(await executor.run('verify', { source: 'x'.repeat(4 * 1024 * 1024) })).toMatchObject({ ok: false, error: { code: 'RENDER_REQUEST_LIMIT' } })
    expect(starts).toBe(0)
  })

  test('an already expired cold call never starts a renderer', async () => {
    let starts = 0
    const executor = new SourceToolExecutor(() => { starts++; return new ControlledRenderer() })
    expect(await executor.run('verify', {}, { timeoutMs: 0 })).toMatchObject({ ok: false, error: { code: 'RENDER_TIMEOUT' } })
    expect(starts).toBe(0)
  })

  test('enforces the deadline again after decoding a response', async () => {
    const renderer = new ControlledRenderer()
    const executor = new SourceToolExecutor(() => renderer)
    const originalParse = JSON.parse
    let now = 1000
    const clock = spyOn(Date, 'now').mockImplementation(() => now)
    const result = executor.run('verify', {}, { timeoutMs: 50 })
    const json = JSON.stringify({ ok: true, marker: 'decoded too late' })
    const decoder = spyOn(JSON, 'parse').mockImplementation((text, reviver) => {
      const decoded = originalParse(text, reviver)
      if (text === json) now = 1051
      return decoded
    })
    try { renderer.emit('message', { type: 'result', id: renderer.sent[0]!.id, json }) }
    finally { decoder.mockRestore(); clock.mockRestore() }
    expect(await result).toMatchObject({ ok: false, error: { code: 'RENDER_TIMEOUT' } })
    expect(renderer.terminations).toBe(1)
  })

  test('rejects late success and ignores retired generations and mismatched request IDs', async () => {
    const renderers: ControlledRenderer[] = []
    const executor = new SourceToolExecutor(() => { const renderer = new ControlledRenderer(); renderers.push(renderer); return renderer })
    const first = executor.run('verify', {}, { timeoutMs: 10 })
    const second = executor.run('verify', {}, { timeoutMs: 1000 })
    const old = renderers[0]!
    const oldId = old.sent[0]!.id
    // Keep timer delivery pending while a late IPC message arrives.
    const until = Date.now() + 20
    while (Date.now() < until) {}
    old.reply(oldId, { ok: true, marker: 'late' })
    expect(await first).toMatchObject({ ok: false, error: { code: 'RENDER_TIMEOUT' } })
    expect(old.terminations).toBe(1)
    expect(renderers).toHaveLength(1)
    old.emit('exit', null, 'SIGKILL')
    expect(renderers).toHaveLength(2)
    const fresh = renderers[1]!
    const freshId = fresh.sent[0]!.id
    let settled = false
    void second.then(() => { settled = true })
    old.reply(freshId, { ok: true, marker: 'retired' })
    fresh.reply(oldId, { ok: true, marker: 'wrong ID' })
    await Promise.resolve()
    expect(settled).toBe(false)
    fresh.reply(freshId, { ok: true, marker: 'fresh' })
    expect(await second).toEqual({ ok: true, marker: 'fresh' })
  })

  test.each([[72, 'RENDER_MEMORY_LIMIT'], [73, 'RENDER_WORKER_FAILED'], [74, 'RENDER_LIMIT_UNAVAILABLE']] as const)('projects supervisor exit %s and permits recovery', async (code, expected) => {
    const renderers: ControlledRenderer[] = []
    const executor = new SourceToolExecutor(() => { const renderer = new ControlledRenderer(); renderers.push(renderer); return renderer })
    const failed = executor.run('verify', {})
    renderers[0]!.emit('exit', code, null)
    expect(await failed).toMatchObject({ ok: false, error: { code: expected } })
    const recovered = executor.run('verify', {})
    const renderer = renderers[1]!
    renderer.reply(renderer.sent[0]!.id, { ok: true })
    expect(await recovered).toEqual({ ok: true })
  })
})
