import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { useTempDirs } from './helpers/temp-dir.ts'
import { handleRequest } from '../mcp/server.ts'
import { runSourceToolIsolated } from '../mcp/source-worker-client.ts'
import { SourceRenderProcess } from '../mcp/source-render-process.ts'

const temp = useTempDirs('am-source-tools-')

async function call(name: string, args: Record<string, unknown>) {
  const response = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  expect(response?.error).toBeUndefined()
  const result = response?.result as { isError: boolean; content: { text: string }[]; structuredContent: Record<string, any> }
  expect(result.structuredContent).toEqual(JSON.parse(result.content[0]!.text))
  return result
}

describe('local MCP direct source tools', () => {
  test('inherited Node heap flags cannot enlarge the renderer heap', () => {
    const entry = new URL('../mcp/source-render-process.ts', import.meta.url).href
    const limits = new URL('../mcp/source-worker-limits.ts', import.meta.url).href
    const code = `import {SourceRenderProcess} from ${JSON.stringify(entry)}; import {SOURCE_TOOL_NODE_FLAGS} from ${JSON.stringify(limits)}; const worker = new SourceRenderProcess("import {getHeapStatistics} from 'node:v8'; process.on('disconnect', () => process.exit()); process.on('message', () => process.send(getHeapStatistics().heap_size_limit));", SOURCE_TOOL_NODE_FLAGS); worker.on('error', error => { console.error(error); worker.terminate(); process.exitCode=1; }); worker.once('message', value => { console.log(value); worker.terminate(); }); worker.postMessage({});`
    const child = spawnSync('bun', ['-e', code], { env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=1024' }, encoding: 'utf8', timeout: 10_000 })
    expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
    expect(Number(child.stdout)).toBeGreaterThan(0)
    expect(Number(child.stdout)).toBeLessThanOrEqual(512 * 1024 * 1024)
  }, 15_000)

  test('the render process aborts when its V8 heap is exhausted', async () => {
    const worker = new SourceRenderProcess("process.on('message', () => { const values = []; while (true) values.push(new Array(100000).fill(42)); });", ['--max-old-space-size=16', '--max-semi-space-size=1'])
    try {
      const failed = new Promise<string | null>(resolve => worker.once('exit', (_code, signal) => resolve(signal)))
      worker.postMessage({})
      expect(await failed).toBe('SIGABRT')
    } finally { worker.terminate() }
  }, 10_000)

  test('recovers when Node becomes available after a failed spawn', () => {
    // Isolate PATH mutation and the executor singleton from the test runner.
    const entry = new URL('../mcp/source-worker-client.ts', import.meta.url).href
    const code = `import {runSourceToolIsolated as run} from ${JSON.stringify(entry)}; const savedPath = process.env.PATH; process.env.PATH = '/nonexistent'; console.log(JSON.stringify(await run('verify', {source:'sequenceDiagram\\nA->>B: Hello'}))); process.env.PATH = savedPath; console.log(JSON.stringify(await run('verify', {source:'sequenceDiagram\\nA->>B: Hello'}, {timeoutMs:3000})));`
    const child = spawnSync('bun', ['-e', code], { encoding: 'utf8', timeout: 10_000 })
    expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
    const [unavailable, recovered] = child.stdout.trim().split('\n').map(line => JSON.parse(line))
    expect(unavailable).toMatchObject({ ok: false, error: { code: 'WORKER_RUNTIME_UNAVAILABLE' } })
    expect(recovered).toMatchObject({ ok: true, family: 'sequence' })
  }, 15_000)

  test('natural shutdown reaps the unreferenced idle renderer', () => {
    const entry = new URL('../mcp/source-render-process.ts', import.meta.url).href
    const code = `import {SourceRenderProcess} from ${JSON.stringify(entry)}; const renderer = new SourceRenderProcess("process.on('message', () => process.send(process.pid));"); renderer.once('message', pid => { console.log(pid); renderer.unref(); }); renderer.postMessage({});`
    const child = spawnSync('bun', ['-e', code], { encoding: 'utf8', timeout: 10_000 })
    expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
    const pid = Number(child.stdout.trim())
    expect(pid).toBeGreaterThan(0)
    expect(() => process.kill(pid, 0)).toThrow()
  }, 15_000)

  test.skipIf(process.platform === 'win32')('keeps one renderer warm across successive Bun calls', () => {
    const work = temp.dir()
    const counter = join(work, 'starts')
    const node = spawnSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).stdout.trim()
    writeFileSync(join(work, 'node'), '#!/bin/sh\nprintf x >> "$AM_RENDER_STARTS"\nexec "$AM_RENDER_NODE" "$@"\n', { mode: 0o755 })
    const entry = new URL('../mcp/source-worker-client.ts', import.meta.url).href
    const code = `import {runSourceToolIsolated as run} from ${JSON.stringify(entry)}; for (let index=0; index<4; index++) { const result=await run('render_ascii', {source:'sequenceDiagram\\nA->>B: Hello'}); if (!result.ok) throw Error(JSON.stringify(result)); }`
    const child = spawnSync('bun', ['-e', code], { env: { ...process.env, PATH: `${work}:${process.env.PATH}`, AM_RENDER_STARTS: counter, AM_RENDER_NODE: node }, encoding: 'utf8', timeout: 10_000 })
    expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
    expect(readFileSync(counter, 'utf8')).toBe('x')
  }, 15_000)

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
    ['sequenceDiagram\ninvalid ???', { diagramType: 'sequence', line: 2, column: 1 }],
    ['---\ntitle: Invalid\n---\nmindmap\n  Root\n    x[A]\n    x[B]', { diagramType: 'mindmap', line: 7 }],
    ['---\ntitle: Invalid\n---\ngitGraph\n  commit\n  checkout missing', { diagramType: 'gitgraph', line: 6 }],
  ])('preserves source errors across the process boundary: %s', async (source, location) => {
    const bad = await call('render_svg', { source })
    expect(bad.isError).toBe(true)
    expect(bad.structuredContent).toMatchObject({ ok: false, error: { code: 'MERMAID_SYNTAX_ERROR', ...location } })
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
