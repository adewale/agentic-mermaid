// Tests for the MCP request handler. We test handleRequest directly rather
// than spawning the stdio loop to keep things deterministic.

import { describe, test, expect } from 'bun:test'
import { handleRequest } from '../mcp/server.ts'

describe('MCP — initialize handshake', () => {
  test('returns serverInfo and capabilities', async () => {
    const r = await handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    })
    expect(r).not.toBeNull()
    expect(r!.id).toBe(1)
    const result = r!.result as Record<string, unknown>
    expect(result.serverInfo).toBeDefined()
    expect(result.capabilities).toBeDefined()
  })

  test('returns null for the notifications/initialized notification', async () => {
    const r = await handleRequest({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    expect(r).toBeNull()
  })
})

describe('MCP — tools/list', () => {
  test('lists exactly one tool: execute', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(r).not.toBeNull()
    const tools = (r!.result as { tools: { name: string }[] }).tools
    expect(tools).toHaveLength(1)
    expect(tools[0]!.name).toBe('execute')
  })

  test('tool description embeds the SDK declaration', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
    const tools = (r!.result as { tools: { description: string }[] }).tools
    const desc = tools[0]!.description
    expect(desc).toContain('declare const mermaid')
    expect(desc).toContain('parseMermaid')
    expect(desc).toContain('verifyMermaid')
    expect(desc).toContain('mutate')
    expect(desc).toContain('serializeMermaid')
  })
})

describe('MCP — tools/call execute', () => {
  test('runs valid code and returns the result', async () => {
    const r = await handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'execute',
        arguments: {
          code: `return mermaid.verifyMermaid('flowchart TD\\n  A --> B').ok`,
        },
      },
    })
    const result = r!.result as { content: { type: string; text: string }[]; isError: boolean }
    expect(result.isError).toBe(false)
    const inner = JSON.parse(result.content[0]!.text) as { ok: boolean; value: unknown }
    expect(inner.ok).toBe(true)
    expect(inner.value).toBe(true)
  })

  test('isError=true on a thrown error', async () => {
    const r = await handleRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'execute',
        arguments: { code: `throw new Error('boom')` },
      },
    })
    const result = r!.result as { isError: boolean }
    expect(result.isError).toBe(true)
  })

  test('rejects unknown tool names', async () => {
    const r = await handleRequest({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'unknown', arguments: {} },
    })
    expect(r!.error).toBeDefined()
  })

  test('rejects missing code argument', async () => {
    const r = await handleRequest({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'execute', arguments: {} },
    })
    expect(r!.error).toBeDefined()
  })
})

describe('MCP — ping and method-not-found', () => {
  test('ping returns empty result', async () => {
    const r = await handleRequest({ jsonrpc: '2.0', id: 8, method: 'ping' })
    expect(r!.result).toEqual({})
  })

  test('unknown method returns -32601', async () => {
    const r = await handleRequest({
      jsonrpc: '2.0',
      id: 9,
      method: 'made/up/method',
    })
    expect(r!.error).toBeDefined()
    expect(r!.error!.code).toBe(-32601)
  })
})
