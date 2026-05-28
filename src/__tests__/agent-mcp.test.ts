// Tests for the Code Mode sandbox and MCP server.

import { describe, test, expect } from 'bun:test'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { handleRequest } from '../mcp/server.ts'

// ============================================================================
// Sandbox
// ============================================================================

describe('sandbox — happy path', () => {
  test('parse → narrow → mutate → serialize in one execute', async () => {
    const r = await executeInSandbox(`
      const r0 = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      if (!r0.ok) return { error: r0.error }
      const flow = mermaid.asFlowchart(r0.value)
      if (!flow) return { kind: r0.value.kind }
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'C', label: 'Cache' })
      if (!r1.ok) return { error: r1.error }
      return { source: mermaid.serializeMermaid(r1.value) }
    `)
    expect(r.ok).toBe(true)
    expect(r.value).toMatchObject({ source: expect.stringContaining('Cache') })
  })

  test('async arrow body', async () => {
    const r = await executeInSandbox(`async () => mermaid.verifyMermaid('flowchart TD\\n  A --> B').ok`)
    expect(r.ok).toBe(true)
    expect(r.value).toBe(true)
  })

  test('captures console.log', async () => {
    const r = await executeInSandbox(`console.log('hi'); console.log('a','b'); return 1`)
    expect(r.ok).toBe(true)
    expect(r.logs).toEqual(['hi', 'a b'])
  })
})

describe('sandbox — isolation', () => {
  test('process unreachable', async () => {
    const r = await executeInSandbox(`return typeof process`)
    expect(r.value).toBe('undefined')
  })

  test('require unreachable', async () => {
    const r = await executeInSandbox(`return typeof require`)
    expect(r.value).toBe('undefined')
  })

  test('fetch unreachable', async () => {
    const r = await executeInSandbox(`return typeof fetch`)
    expect(r.value).toBe('undefined')
  })

  test('only mermaid + safe-globals reachable', async () => {
    const r = await executeInSandbox(`return {
      mermaid: typeof mermaid !== 'undefined',
      json: typeof JSON !== 'undefined',
      math: typeof Math !== 'undefined',
      process: typeof process !== 'undefined',
      require: typeof require !== 'undefined',
      fetch: typeof fetch !== 'undefined',
    }`)
    expect(r.value).toMatchObject({ mermaid: true, json: true, math: true, process: false, require: false, fetch: false })
  })
})

describe('sandbox — errors and timeouts', () => {
  test('thrown error reported', async () => {
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

// ============================================================================
// MCP JSON-RPC
// ============================================================================

describe('MCP — handshake and discovery', () => {
  test('initialize returns serverInfo + capabilities', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    expect(r).not.toBeNull()
    const result = r!.result as Record<string, unknown>
    expect(result.serverInfo).toBeDefined()
    expect(result.capabilities).toBeDefined()
  })

  test('notifications/initialized returns null', async () => {
    expect(await handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
  })

  test('ping returns empty result', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'ping' })
    expect(r!.result).toEqual({})
  })

  test('tools/list returns the single execute tool', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
    const tools = (r!.result as { tools: { name: string; description: string }[] }).tools
    expect(tools).toHaveLength(1)
    expect(tools[0]!.name).toBe('execute')
    expect(tools[0]!.description).toContain('declare const mermaid')
    expect(tools[0]!.description).toContain('parseMermaid')
    expect(tools[0]!.description).toContain('asFlowchart')
    expect(tools[0]!.description).toContain('FlowchartValidDiagram')
  })

  test('unknown method returns -32601', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 4, method: 'made/up' })
    expect(r!.error!.code).toBe(-32601)
  })
})

describe('MCP — tools/call execute', () => {
  test('runs code and returns result', async () => {
    const r = await handleRequest({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'execute', arguments: { code: `return mermaid.verifyMermaid('flowchart TD\\n  A --> B').ok` } },
    })
    const result = r!.result as { content: { text: string }[]; isError: boolean }
    expect(result.isError).toBe(false)
    expect(JSON.parse(result.content[0]!.text).value).toBe(true)
  })

  test('isError=true on thrown', async () => {
    const r = await handleRequest({
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { name: 'execute', arguments: { code: `throw new Error('boom')` } },
    })
    expect((r!.result as { isError: boolean }).isError).toBe(true)
  })

  test('rejects unknown tool', async () => {
    const r = await handleRequest({
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: { name: 'unknown', arguments: {} },
    })
    expect(r!.error).toBeDefined()
  })

  test('rejects missing code', async () => {
    const r = await handleRequest({
      jsonrpc: '2.0', id: 8, method: 'tools/call',
      params: { name: 'execute', arguments: {} },
    })
    expect(r!.error).toBeDefined()
  })
})
