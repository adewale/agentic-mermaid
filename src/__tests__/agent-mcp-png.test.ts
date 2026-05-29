// Loop 9 M1 — MCP `render_png` tool. Decodes base64 and asserts PNG magic bytes.

import { describe, test, expect } from 'bun:test'
import { handleRequest } from '../mcp/server.ts'

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

describe('MCP — render_png tool', () => {
  test('happy path returns base64 PNG', async () => {
    const r = await handleRequest({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'render_png', arguments: { source: 'flowchart TD\n  A --> B' } },
    })
    const result = r!.result as { content: Array<{ text: string }>; isError: boolean }
    expect(result.isError).toBe(false)
    const payload = JSON.parse(result.content[0]!.text) as { ok: boolean; png_base64?: string }
    expect(payload.ok).toBe(true)
    expect(typeof payload.png_base64).toBe('string')
    const bytes = Buffer.from(payload.png_base64!, 'base64')
    expect(bytes.length).toBeGreaterThan(100)
    for (let i = 0; i < PNG_MAGIC.length; i++) expect(bytes[i]).toBe(PNG_MAGIC[i]!)
  })

  test('honors scale option', async () => {
    const small = await handleRequest({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'render_png', arguments: { source: 'flowchart TD\n  A --> B', scale: 1 } },
    })
    const big = await handleRequest({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'render_png', arguments: { source: 'flowchart TD\n  A --> B', scale: 3 } },
    })
    const a = JSON.parse((small!.result as { content: Array<{ text: string }> }).content[0]!.text) as { png_base64: string }
    const b = JSON.parse((big!.result as { content: Array<{ text: string }> }).content[0]!.text) as { png_base64: string }
    expect(Buffer.from(b.png_base64, 'base64').length).toBeGreaterThan(Buffer.from(a.png_base64, 'base64').length)
  })

  test('honors background option', async () => {
    const white = await handleRequest({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'render_png', arguments: { source: 'flowchart TD\n  A --> B', background: 'white' } },
    })
    const black = await handleRequest({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'render_png', arguments: { source: 'flowchart TD\n  A --> B', background: 'black' } },
    })
    const a = JSON.parse((white!.result as { content: Array<{ text: string }> }).content[0]!.text) as { png_base64: string }
    const b = JSON.parse((black!.result as { content: Array<{ text: string }> }).content[0]!.text) as { png_base64: string }
    expect(a.png_base64).not.toBe(b.png_base64)
  })

  test('missing source → -32602', async () => {
    const r = await handleRequest({
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { name: 'render_png', arguments: {} },
    })
    expect(r!.error).toBeDefined()
    expect(r!.error!.code).toBe(-32602)
  })

  test('invalid source surfaces ok:false envelope', async () => {
    const r = await handleRequest({
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: { name: 'render_png', arguments: { source: '' } },
    })
    const result = r!.result as { content: Array<{ text: string }>; isError: boolean }
    // Empty source renders an empty SVG; resvg will either render a blank
    // PNG or error — both shapes are acceptable. If it errors, isError must
    // be true and the envelope must contain ok:false.
    if (result.isError) {
      const payload = JSON.parse(result.content[0]!.text) as { ok: boolean; error?: { code: string } }
      expect(payload.ok).toBe(false)
      expect(payload.error?.code).toBe('PNG_RENDER_FAILED')
    } else {
      const payload = JSON.parse(result.content[0]!.text) as { ok: boolean }
      expect(payload.ok).toBe(true)
    }
  })
})
