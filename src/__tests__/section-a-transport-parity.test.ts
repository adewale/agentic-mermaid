import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderGraphicalSvgWithReceipt, renderMermaidSVGWithReceipt } from '../index.ts'
import { renderMermaidPNGWithReceipt } from '../agent/png.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { renderSourceToFormatWithReceipt, runCli } from '../cli/index.ts'
import { handleRequest } from '../mcp/server.ts'
import {
  handleHostedRequest,
  type ExecuteResult,
  type HostedMcpContext,
} from '../mcp/hosted-server.ts'
import type { JsonRpcRequest, JsonRpcResponse } from '../mcp/protocol.ts'
import { renderPngGraphicalProjection } from '../png-graphical.ts'
import { PNG_NAPI_RUNTIME, PNG_WASM_RUNTIME, resolvePngOutputPolicy } from '../png-contract.ts'
import type { RenderOptions } from '../types.ts'
import { decodePng } from './helpers/png-pixels.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { layoutMermaidWithReceipt } from '../agent/core.ts'

const SOURCE = 'flowchart LR\n  A[Start] -->|ships| B[Finish]'
const OPTIONS = {
  style: 'hand-drawn',
  seed: 17,
  padding: 24,
  embedFontImport: false,
  security: 'strict',
  mermaidConfig: { themeVariables: { lineColor: '#24415f' } },
} as const satisfies RenderOptions

function call(name: string, args: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
}

function payloadOf(response: JsonRpcResponse | null): any {
  const result = response?.result as { content?: Array<{ text?: string }> } | undefined
  const text = result?.content?.[0]?.text
  if (typeof text !== 'string') throw new Error('MCP response did not contain a textual payload')
  return JSON.parse(text)
}

function hostedContext(): HostedMcpContext {
  return {
    async execute(): Promise<ExecuteResult> {
      return { ok: true, value: null, logs: [] }
    },
    async renderPng(source, options) {
      const rendered = renderMermaidPNGWithReceipt(source, options)
      return { ...rendered, warnings: [], runtime: PNG_WASM_RUNTIME }
    },
  }
}

function captureStdout(run: () => number): { code: number; stdout: string } {
  const chunks: string[] = []
  const original = process.stdout.write
  process.stdout.write = ((chunk: unknown) => { chunks.push(String(chunk)); return true }) as typeof process.stdout.write
  try {
    return { code: run(), stdout: chunks.join('') }
  } finally {
    process.stdout.write = original
  }
}

describe('Section A transport and backend parity receipts', () => {
  test('canonical PNG policy rejects ambiguous, unsafe, and non-finite output controls', () => {
    expect(() => resolvePngOutputPolicy({ scale: Number.NaN })).toThrow('positive finite')
    expect(() => resolvePngOutputPolicy({ fitTo: { width: 10, height: 10 } })).toThrow('width or height')
    expect(() => resolvePngOutputPolicy({ background: 'red" onload="alert(1)' })).toThrow('safe CSS color')
    expect(resolvePngOutputPolicy({ background: '#123456' }).background).toEqual({ mode: 'explicit', value: '#123456' })
  })
  test('real local Code Mode execution exposes hardened SVG, terminal, and layout receipts', async () => {
    const executed = await executeInSandbox(`
      const source = 'flowchart LR\\n  A --> B'
      const svg = mermaid.renderMermaidSVGWithReceipt(source, { security: 'strict', padding: 17 })
      const ascii = mermaid.renderMermaidASCIIWithReceipt(source, { colorMode: 'none', security: 'strict', padding: 17 })
      const layout = mermaid.layoutMermaidWithReceipt(source, { debug: true, security: 'strict', padding: 17 })
      return {
        svg: svg.receipt,
        ascii: ascii.receipt,
        terminalDiagnostics: ascii.terminalStyle.diagnostics,
        layout: layout.receipt,
        nodeCount: layout.layout.nodes.length,
      }
    `)
    expect(executed.ok).toBe(true)
    const value = (executed as { ok: true; value: any }).value
    expect(value.svg.output).toBe('svg')
    expect(value.ascii.output).toBe('unicode')
    expect(value.layout.output).toBe('layout')
    expect(value.nodeCount).toBe(2)
    expect(value.svg.sharedRequestDigest).toBe(value.ascii.sharedRequestDigest)
    expect(value.svg.sharedRequestDigest).toBe(value.layout.sharedRequestDigest)
    expect(value.terminalDiagnostics).toContainEqual(expect.objectContaining({ feature: 'render-option:padding' }))
  })

  test('library, CLI, and hosted MCP enter the same SVG request boundary', async () => {
    const library = renderMermaidSVGWithReceipt(SOURCE, OPTIONS)
    const cli = renderSourceToFormatWithReceipt(SOURCE, 'svg', OPTIONS)
    const hosted = payloadOf(await handleHostedRequest(
      call('render_svg', { source: SOURCE, options: OPTIONS }),
      hostedContext(),
    ))

    expect(cli.receipt).toEqual(library.receipt)
    expect(hosted.receipt).toEqual(library.receipt)
    expect(cli.output).toBe(library.svg)
    expect(hosted.svg).toBe(library.svg)
  })

  test('CLI JSON delegates every built-in family to the canonical layout request', () => {
    const layoutOptions = {
      security: 'strict',
      padding: 13,
      nodeSpacing: 77,
      layerSpacing: 91,
      mermaidConfig: { themeVariables: { lineColor: '#345678' } },
    } as const satisfies RenderOptions
    for (const family of BUILTIN_FAMILY_METADATA) {
      const library = layoutMermaidWithReceipt(family.example, layoutOptions)
      const cli = renderSourceToFormatWithReceipt(family.example, 'json', layoutOptions)
      expect(cli.output).toEqual(library.layout)
      expect(cli.receipt).toEqual(library.receipt)
    }
  })

  test('CLI JSON applies geometry options instead of changing only its receipt', () => {
    const natural = renderSourceToFormatWithReceipt('flowchart LR\n  A --> B', 'json')
    const spaced = renderSourceToFormatWithReceipt('flowchart LR\n  A --> B', 'json', {
      nodeSpacing: 200,
      layerSpacing: 200,
    })
    expect(spaced.output).not.toEqual(natural.output)
    expect(spaced.receipt.sharedRequestDigest).not.toBe(natural.receipt.sharedRequestDigest)
  })

  test('local MCP indirect SVG and layout routes preserve Code Mode receipts', async () => {
    const options = { security: 'strict', padding: 19 } as const
    const local = payloadOf(await handleRequest(call('execute', {
      code: `return {
        svg: mermaid.renderMermaidSVGWithReceipt(${JSON.stringify(SOURCE)}, ${JSON.stringify(options)}).receipt,
        layout: mermaid.layoutMermaidWithReceipt(${JSON.stringify(SOURCE)}, ${JSON.stringify(options)}).receipt,
      }`,
    })))
    const librarySvg = renderMermaidSVGWithReceipt(SOURCE, options).receipt
    const codeModeLayout = await executeInSandbox(`return mermaid.layoutMermaidWithReceipt(${JSON.stringify(SOURCE)}, ${JSON.stringify(options)}).receipt`)

    expect(local.ok).toBe(true)
    expect(local.value.svg).toEqual(librarySvg)
    expect(codeModeLayout.ok).toBe(true)
    expect(local.value.layout).toEqual((codeModeLayout as { ok: true; value: unknown }).value)
    expect(local.value.layout.sharedRequestDigest).toBe(librarySvg.sharedRequestDigest)
  })

  test('hosted MCP direct ASCII and Unicode preserve library terminal artifacts', async () => {
    for (const useAscii of [true, false]) {
      const library = renderMermaidASCIIWithReceipt(SOURCE, {
        ...OPTIONS,
        useAscii,
        colorMode: 'none',
      })
      const hosted = payloadOf(await handleHostedRequest(call('render_ascii', {
        source: SOURCE,
        useAscii,
        options: OPTIONS,
      }), hostedContext()))
      expect(hosted.receipt).toEqual(library.receipt)
      expect(hosted.text).toBe(library.text)
    }
  })

  test('SVG, PNG, ASCII, and Unicode retain one shared appearance receipt', () => {
    const svg = renderMermaidSVGWithReceipt(SOURCE, OPTIONS).receipt
    const png = renderMermaidPNGWithReceipt(SOURCE, { ...OPTIONS, scale: 0.1, background: '#ffffff' }).receipt
    const ascii = renderMermaidASCIIWithReceipt(SOURCE, { ...OPTIONS, useAscii: true, colorMode: 'none' }).receipt
    const unicode = renderMermaidASCIIWithReceipt(SOURCE, { ...OPTIONS, useAscii: false, colorMode: 'none' }).receipt
    const receipts = [svg, png, ascii, unicode]

    expect(new Set(receipts.map(receipt => receipt.sharedRequestDigest))).toEqual(new Set([svg.sharedRequestDigest]))
    expect(new Set(receipts.map(receipt => receipt.appearanceDigest))).toEqual(new Set([svg.appearanceDigest]))
    expect(new Set(receipts.map(receipt => receipt.requestDigest)).size).toBe(4)
    expect(receipts.map(receipt => receipt.output)).toEqual(['svg', 'png', 'ascii', 'unicode'])
  })

  test('output projections do not rewrite the shared request receipt', () => {
    const svg = renderMermaidSVGWithReceipt(SOURCE).receipt
    const pngSvg = renderGraphicalSvgWithReceipt(SOURCE, {}, 'png')
    const terminal = renderMermaidASCIIWithReceipt(SOURCE, {
      targetWidth: 60,
      colorMode: 'none',
    }).receipt

    expect(pngSvg.svg).not.toContain('@import')
    expect(pngSvg.receipt.sharedRequestDigest).toBe(svg.sharedRequestDigest)
    expect(pngSvg.receipt.appearanceDigest).toBe(svg.appearanceDigest)
    expect(terminal.sharedRequestDigest).toBe(svg.sharedRequestDigest)
    expect(terminal.appearanceDigest).toBe(svg.appearanceDigest)
  })

  test('target-width projection preserves merged frontmatter and init configuration', () => {
    const source = `---
config:
  themeVariables:
    background: "#010203"
    primaryTextColor: "#fefefe"
---
%%{init: {"themeVariables": {"lineColor": "#aabbcc"}}}%%
architecture-beta
  group api(cloud)[A very long API group]
  service db(database)[A very long Database service] in api`
    const natural = renderMermaidASCIIWithReceipt(source, { colorMode: 'html' })
    const bounded = renderMermaidASCIIWithReceipt(source, { colorMode: 'html', targetWidth: 100 })
    const colors = (text: string) => [...new Set(text.match(/color:#[0-9a-f]+/gi) ?? [])].sort()

    expect(colors(natural.text)).toContain('color:#fefefe')
    expect(colors(bounded.text)).toEqual(colors(natural.text))
    expect(bounded.terminalStyle).toEqual(natural.terminalStyle)
    expect(bounded.receipt.sharedRequestDigest).toBe(natural.receipt.sharedRequestDigest)
    expect(bounded.receipt.appearanceDigest).toBe(natural.receipt.appearanceDigest)
    expect(bounded.receipt.requestDigest).not.toBe(natural.receipt.requestDigest)
  })

  test('local and hosted PNG tools preserve the library receipt', async () => {
    const pngOptions = { ...OPTIONS, scale: 0.1, background: '#ffffff' }
    const library = renderMermaidPNGWithReceipt(SOURCE, pngOptions)
    const local = payloadOf(await handleRequest(call('render_png', {
      source: SOURCE,
      scale: pngOptions.scale,
      background: pngOptions.background,
      options: OPTIONS,
    })))
    const hosted = payloadOf(await handleHostedRequest(call('render_png', {
      source: SOURCE,
      scale: pngOptions.scale,
      background: pngOptions.background,
      options: OPTIONS,
    }), hostedContext()))

    expect(local.receipt).toEqual(library.receipt)
    expect(hosted.receipt).toEqual(library.receipt)
  })

  test('dark-style PNG defaults stay aligned across library, CLI, and hosted projection', async () => {
    const style = ['dracula']
    const library = renderMermaidPNGWithReceipt(SOURCE, { style, scale: 0.1 })
    const hostedProjection = renderPngGraphicalProjection(SOURCE, { style }, { scale: 0.1 })
    const hosted = payloadOf(await handleHostedRequest(call('render_png', {
      source: SOURCE,
      scale: 0.1,
      style,
    }), hostedContext()))
    const dir = mkdtempSync(join(tmpdir(), 'am-section-a-png-'))
    const input = join(dir, 'diagram.mmd')
    const output = join(dir, 'diagram.png')
    writeFileSync(input, SOURCE)
    const cli = captureStdout(() => runCli([
      'render', input,
      '--format', 'png',
      '--output', output,
      '--style', 'dracula',
      '--scale', '0.1',
      '--json',
    ]))
    const payload = JSON.parse(cli.stdout) as {
      ok: boolean
      receipt: typeof library.receipt
      runtime: typeof PNG_NAPI_RUNTIME
    }

    expect(cli.code).toBe(0)
    expect(payload.ok).toBe(true)
    expect(readFileSync(output)).toEqual(Buffer.from(library.png))
    expect([...decodePng(library.png).rgba.slice(0, 4)]).toEqual([40, 42, 54, 255])
    expect(payload.receipt).toEqual(library.receipt)
    expect(hostedProjection.receipt).toEqual(library.receipt)
    expect(hosted.receipt).toEqual(library.receipt)
    expect(payload.runtime).toEqual(PNG_NAPI_RUNTIME)
    expect(hosted.runtime).toEqual(PNG_WASM_RUNTIME)
    expect(PNG_WASM_RUNTIME).not.toEqual(PNG_NAPI_RUNTIME)
    expect(library.receipt).not.toHaveProperty('runtime')
    expect(library.receipt).not.toHaveProperty('rasterizer')
  })
})
