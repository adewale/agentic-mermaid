// Sandbox + MCP tests.

import { describe, test, expect } from 'bun:test'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { handleRequest } from '../mcp/server.ts'

describe('sandbox — happy path', () => {
  test('flowchart workflow in one execute()', async () => {
    const r = await executeInSandbox(`
      const r0 = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      if (!r0.ok) return { err: r0.error }
      const flow = mermaid.asFlowchart(r0.value)
      if (!flow) return { kind: r0.value.kind }
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'C', label: 'Cache' })
      if (!r1.ok) return { err: r1.error }
      return { source: mermaid.serializeMermaid(r1.value) }
    `)
    expect(r.ok).toBe(true)
    expect(r.value).toMatchObject({ source: expect.stringContaining('Cache') })
  })

  test('sequence workflow in one execute()', async () => {
    const r = await executeInSandbox(`
      const r0 = mermaid.parseMermaid('sequenceDiagram\\n  A->>B: Hi')
      if (!r0.ok) return { err: r0.error }
      const seq = mermaid.asSequence(r0.value)
      if (!seq) return { kind: r0.value.kind }
      const r1 = mermaid.mutate(seq, { kind: 'add_message', from: 'B', to: 'A', text: 'Bye', style: 'reply' })
      if (!r1.ok) return { err: r1.error }
      return { source: mermaid.serializeMermaid(r1.value), msgCount: r1.value.body.messages.length }
    `)
    expect(r.ok).toBe(true)
    expect(r.value).toMatchObject({ msgCount: 2 })
  })

  test('console.log captured', async () => {
    const r = await executeInSandbox(`console.log('hi','there'); return 1`)
    expect(r.ok).toBe(true)
    expect(r.logs).toEqual(['hi there'])
  })
})

describe('sandbox — isolation', () => {
  test('process / require / fetch all unreachable', async () => {
    const r = await executeInSandbox(`return {
      mermaid: typeof mermaid !== 'undefined',
      process: typeof process !== 'undefined',
      require: typeof require !== 'undefined',
      fetch: typeof fetch !== 'undefined',
    }`)
    expect(r.value).toMatchObject({ mermaid: true, process: false, require: false, fetch: false })
  })

  test('thrown errors reported', async () => {
    const r = await executeInSandbox(`throw new Error('boom')`)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('boom')
  })

  test('runaway loop hits timeout', async () => {
    const r = await executeInSandbox(`while (true) {}`, { timeoutMs: 200 })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/timeout|Execution timed out/i)
  })
})

describe('MCP — JSON-RPC', () => {
  test('initialize', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    expect(r).not.toBeNull()
    expect((r!.result as Record<string, unknown>).serverInfo).toBeDefined()
  })

  test('tools/list returns single execute tool', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const tools = (r!.result as { tools: { name: string; description: string }[] }).tools
    expect(tools).toHaveLength(1)
    expect(tools[0]!.name).toBe('execute')
    expect(tools[0]!.description).toContain('asSequence')
    expect(tools[0]!.description).toContain('SequenceMutationOp')
  })

  test('tools/call execute runs', async () => {
    const r = await handleRequest({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'execute', arguments: { code: 'return mermaid.verifyMermaid("flowchart TD\\n  A --> B").ok' } },
    })
    const result = r!.result as { content: { text: string }[]; isError: boolean }
    expect(result.isError).toBe(false)
    expect(JSON.parse(result.content[0]!.text).value).toBe(true)
  })

  test('unknown method', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 4, method: 'made/up' })
    expect(r!.error!.code).toBe(-32601)
  })

  test('notifications/initialized returns null', async () => {
    expect(await handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
  })
})
