// Sandbox + MCP, including sad paths (which I skipped in prior loops).

import { describe, test, expect } from 'bun:test'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { handleRequest } from '../mcp/server.ts'
import { runCli } from '../cli/index.ts'

describe('sandbox — happy', () => {
  test('flowchart workflow', async () => {
    const r = await executeInSandbox(`
      const r0 = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r0.value); if (!flow) return { kind: r0.value.kind }
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'C', label: 'Cache' })
      return { source: mermaid.serializeMermaid(r1.value) }
    `)
    expect(r.ok && (r.value as any).source.includes('Cache')).toBe(true)
  })
  test('sequence workflow', async () => {
    const r = await executeInSandbox(`
      const r0 = mermaid.parseMermaid('sequenceDiagram\\n  A->>B: Hi')
      const seq = mermaid.asSequence(r0.value); if (!seq) return { kind: r0.value.kind }
      const r1 = mermaid.mutate(seq, { kind: 'add_message', from: 'B', to: 'A', text: 'Bye', style: 'reply' })
      return { msgs: r1.value.body.messages.length }
    `)
    expect(r.ok && (r.value as any).msgs).toBe(2)
  })
  test('console captured', async () => {
    const r = await executeInSandbox(`console.log('a','b'); return 1`)
    expect(r.logs).toEqual(['a b'])
  })
})

describe('sandbox — isolation + sad paths', () => {
  test('process/require/fetch unreachable', async () => {
    const r = await executeInSandbox(`return { p: typeof process, r: typeof require, f: typeof fetch }`)
    expect(r.value).toMatchObject({ p: 'undefined', r: 'undefined', f: 'undefined' })
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

describe('MCP — JSON-RPC happy + sad', () => {
  test('initialize', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    expect((r!.result as any).serverInfo.name).toBe('agentic-mermaid-mcp')
  })
  test('tools/list has execute with SDK', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const tools = (r!.result as any).tools
    expect(tools).toHaveLength(1)
    expect(tools[0].description).toContain('asSequence')
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

  test('mutate on opaque family returns UNSUPPORTED_FAMILY (exit 2)', () => {
    // Pipe a class diagram via a temp file path is overkill; use stdin shim by
    // writing the source to a temp file.
    const tmp = `/tmp/cli-class-${Date.now()}.mmd`
    require('node:fs').writeFileSync(tmp, 'classDiagram\n  Animal <|-- Duck\n')
    const { code, out } = capture(() => runCli(['mutate', tmp, '--op', '{"kind":"add_node","id":"X","label":"X"}']))
    expect(code).toBe(2)
    expect(out).toContain('UNSUPPORTED_FAMILY')
  })

  test('mutate on sequence-with-notes (opaque) returns UNSUPPORTED_FAMILY', () => {
    const tmp = `/tmp/cli-seqnote-${Date.now()}.mmd`
    require('node:fs').writeFileSync(tmp, 'sequenceDiagram\n  A->>B: Hi\n  Note over A: thinking\n')
    const { code, out } = capture(() => runCli(['mutate', tmp, '--op', '{"kind":"add_message","from":"A","to":"B","text":"x"}']))
    expect(code).toBe(2)
    expect(out).toContain('UNSUPPORTED_FAMILY')
  })

  test('verify exit code 2 on empty', () => {
    const tmp = `/tmp/cli-empty-${Date.now()}.mmd`
    require('node:fs').writeFileSync(tmp, '')
    const { code } = capture(() => runCli(['verify', tmp]))
    expect(code).toBe(2)
  })

  test('--help per command differs from global', () => {
    const g = capture(() => runCli(['--help']))
    const v = capture(() => runCli(['verify', '--help']))
    expect(v.out).toContain('am verify')
    expect(v.out).not.toEqual(g.out)
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
