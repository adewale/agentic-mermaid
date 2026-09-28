import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'

import { verifyMermaid } from '../agent/index.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { runBatchLine } from '../cli/index.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { handleHostedRequest } from '../mcp/hosted-server.ts'
import { drawableAuthoredCssPaint } from '../shared/css-color.ts'

const CHART = 'xychart\n  title Sales\n  x-axis [A, B]\n  y-axis 0 --> 2\n  bar [1, 2]'
const SCALAR_KEYS = [
  'backgroundColor', 'titleColor', 'xAxisLabelColor', 'xAxisTickColor', 'xAxisLineColor',
  'xAxisTitleColor', 'yAxisLabelColor', 'yAxisTickColor', 'yAxisLineColor',
  'yAxisTitleColor', 'legendTextColor',
] as const
const STROKE_KEYS = new Set<string>(['xAxisTickColor', 'xAxisLineColor', 'yAxisTickColor', 'yAxisLineColor'])

function source(xyChart: Record<string, unknown>, chart = CHART): string {
  return `%%{init: ${JSON.stringify({ themeVariables: { xyChart } })}}%%\n${chart}`
}

function named(key: string, value: string): string {
  return `themeVariables.xyChart.${key}: ${JSON.stringify(value)} is not a CSS color`
}

function expectRefusal(input: string, key: string, value: string): void {
  const reason = named(key, value)
  expect(() => renderMermaidSVG(input), input).toThrow(reason)
  expect(() => renderMermaidASCII(input, { useAscii: true }), input).toThrow(reason)
  expect(() => renderMermaidASCII(input, { useAscii: false }), input).toThrow(reason)
  expect(verifyMermaid(input).warnings, input).toContainEqual({ code: 'RENDER_FAILED', reason: expect.stringContaining(reason) })
}

describe('XY Chart authored color admission (#303)', () => {
  test('generated unknown words, malformed functions, bad hex, and URLs agree across every consumed XY Chart color key and output', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 999 }), number => {
      const invalid = [
        `xqnotacolor${number}`,
        `rgb(${number}oops,2,3)`,
        `#${number.toString(16).padStart(5, '0')}`,
        `url(#x${number})`,
      ]
      for (const value of invalid) {
        expect(drawableAuthoredCssPaint(value), value).toBeUndefined()
        for (const key of SCALAR_KEYS) expectRefusal(source({ [key]: value }), key, value)
        expectRefusal(source({ plotColorPalette: `${value}, #00ff00` }), 'plotColorPalette[0]', value)
        expectRefusal(source({ plotColorPalette: ['#00ff00', value] }), 'plotColorPalette[1]', value)
      }
    }), { numRuns: 5 })
  })

  test('a non-string palette entry cannot disappear during normalization', () => {
    const input = source({ plotColorPalette: ['#f96', 42] })
    expect(() => renderMermaidSVG(input)).toThrow('themeVariables.xyChart.plotColorPalette[1]')
    expect(verifyMermaid(input).warnings).toContainEqual({
      code: 'RENDER_FAILED', reason: expect.stringContaining('themeVariables.xyChart.plotColorPalette[1]'),
    })
    expect(() => renderMermaidSVG(source({ plotColorPalette: '#f96,,#00ff00' })))
      .toThrow('themeVariables.xyChart.plotColorPalette[1]: "" is not a CSS color')
  })

  test('valid paints stay available, with none limited to stroke-only keys', () => {
    for (const value of ['red', '#f96', '#11223380', 'rgb(255, 0, 0)', 'hsl(120 100% 50%)', 'transparent', 'currentColor', 'var(--brand)']) {
      for (const key of SCALAR_KEYS) expect(() => renderMermaidSVG(source({ [key]: value })), `${key} ${value}`).not.toThrow()
      expect(() => renderMermaidSVG(source({ plotColorPalette: [value, '#00ff00'] })), value).not.toThrow()
    }
    for (const key of SCALAR_KEYS) {
      const input = source({ [key]: 'none' })
      if (STROKE_KEYS.has(key)) expect(() => renderMermaidSVG(input), key).not.toThrow()
      else expectRefusal(input, key, 'none')
    }
    expectRefusal(source({ plotColorPalette: ['none'] }), 'plotColorPalette[0]', 'none')
    const functionalPalette = renderMermaidSVG(source({ plotColorPalette: 'rgb(255, 0, 0), hsl(120, 100%, 50%)' }, `${CHART}\n  line [1, 2]`))
    expect(functionalPalette).toContain('--xychart-color-0: rgb(255, 0, 0);')
    expect(functionalPalette).toContain('--xychart-color-1: hsl(120, 100%, 50%);')
  })

  test('PNG, CLI, MCP, init, frontmatter, and render options preserve the same named failure', async () => {
    const cases = [
      { input: source({ titleColor: 'notacolor' }), key: 'titleColor', value: 'notacolor' },
      { input: source({ plotColorPalette: 'notacolor, #f96' }), key: 'plotColorPalette[0]', value: 'notacolor' },
      {
        input: `---\nconfig:\n  themeVariables:\n    xyChart:\n      titleColor: "#12345"\n---\n${CHART}`,
        key: 'titleColor', value: '#12345',
      },
    ]
    for (const { input, key, value } of cases) {
      expect(() => renderMermaidPNG(input)).toThrow(named(key, value))
      for (const format of ['svg', 'ascii', 'unicode'] as const) {
        const result = runBatchLine(JSON.stringify({ op: 'render', format, source: input }), 0) as {
          ok: boolean; error: { code: string; key: string; value: string; message: string }
        }
        expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_THEME_COLOR', key: `xyChart.${key}`, value, message: expect.stringContaining(named(key, value)) } })
      }
      const response = await handleHostedRequest(
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_svg', arguments: { source: input } } },
        {
          async execute() { return { ok: true, value: null, logs: [] } },
          async renderPng() { throw new Error('not used by render_svg') },
        },
      )
      const payload = JSON.parse((response?.result as { content: Array<{ text: string }> }).content[0]!.text)
      expect(payload).toMatchObject({ ok: false, error: { code: 'INVALID_THEME_COLOR', key: `xyChart.${key}`, value } })
    }
    const options = { mermaidConfig: { themeVariables: { xyChart: { titleColor: 'rgb(x)' } } } }
    expect(() => renderMermaidSVG(CHART, options)).toThrow(named('titleColor', 'rgb(x)'))
    expect(verifyMermaid(CHART, { renderOptions: options }).warnings).toContainEqual({
      code: 'RENDER_FAILED', reason: expect.stringContaining(named('titleColor', 'rgb(x)')),
    })
    const shadowedBackground = source({ backgroundColor: 'notacolor' })
    expect(() => renderMermaidSVG(shadowedBackground, { bg: '#ffffff' })).not.toThrow()
    expect(verifyMermaid(shadowedBackground, { renderOptions: { bg: '#ffffff' } }).warnings)
      .not.toContainEqual({ code: 'RENDER_FAILED', reason: expect.any(String) })
  })
})
