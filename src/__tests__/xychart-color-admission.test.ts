import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'

import { verifyMermaid } from '../agent/index.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { drawableAuthoredCssPaint } from '../shared/css-color.ts'

// Every scalar xyChart color key and the array palette run through the shared
// #303 admission table in theme-color-admission.test.ts. This file keeps the
// XY Chart rules outside that template: the comma-separated palette string,
// palette-to-terminal projection, and the render background that shadows
// xyChart.backgroundColor.

const CHART = 'xychart\n  title Sales\n  x-axis [A, B]\n  y-axis 0 --> 2\n  bar [1, 2]'

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
  test('generated unknown words, malformed functions, bad hex, and URLs are refused in string and array palettes', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 999 }), number => {
      const invalid = [
        `xqnotacolor${number}`,
        `rgb(${number}oops,2,3)`,
        `#${number.toString(16).padStart(5, '0')}`,
        `url(#x${number})`,
      ]
      for (const value of invalid) {
        expect(drawableAuthoredCssPaint(value), value).toBeUndefined()
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
    const defaultSvg = renderMermaidSVG(CHART)
    for (const empty of ['', '   ']) {
      expect(renderMermaidSVG(source({ plotColorPalette: empty }))).toContain('--xychart-color-0: #3b82f6;')
      expect(defaultSvg).toContain('--xychart-color-0: #3b82f6;')
    }
  })

  test('palette paints keep their functional form in SVG and terminal output', () => {
    const functionalPalette = renderMermaidSVG(source({ plotColorPalette: 'rgb(255, 0, 0), hsl(120, 100%, 50%)' }, `${CHART}\n  line [1, 2]`))
    expect(functionalPalette).toContain('--xychart-color-0: rgb(255, 0, 0);')
    expect(functionalPalette).toContain('--xychart-color-1: hsl(120, 100%, 50%);')
    const functionalInput = source({ plotColorPalette: 'rgb(255, 0, 0), hsl(120, 100%, 50%)' }, `${CHART}\n  line [1, 2]`)
    const terminal = renderMermaidASCII(functionalInput, { colorMode: 'truecolor' })
    expect(terminal).toContain('\u001b[38;2;255;0;0m')
    expect(terminal).toContain('\u001b[38;2;0;255;0m')
    const html = renderMermaidASCII(functionalInput, { colorMode: 'html' })
    expect(html).toContain('style="color:rgb(255, 0, 0)"')
    expect(html).toContain('style="color:hsl(120, 100%, 50%)"')
    const variableHtml = renderMermaidASCII(source({ plotColorPalette: ['var(--brand)'] }), { colorMode: 'html' })
    expect(variableHtml).toContain('<span style="color:var(--brand)">')
    expect(variableHtml).not.toContain('&lt;span style=')
    for (const [paint, expected] of [['red', '255;0;0'], ['#f96', '255;153;102']] as const) {
      expect(renderMermaidASCII(source({ plotColorPalette: [paint] }), { colorMode: 'truecolor' }))
        .toContain(`\u001b[38;2;${expected}m`)
    }
    for (const translucent of ['transparent', 'rgba(255,0,0,0)', '#ff000080']) {
      const terminal = renderMermaidASCII(source({ plotColorPalette: [translucent] }), { colorMode: 'truecolor' })
      expect(terminal).not.toContain('\u001b[38;2;255;0;0m')
      if (translucent === 'transparent') expect(terminal).not.toContain('\u001b[38;2;0;0;0m')
      expect(renderMermaidASCII(source({ plotColorPalette: [translucent] }), { colorMode: 'html' }))
        .toContain(`style="color:${translucent}"`)
    }
  })

  test('an explicit render background shadows xyChart.backgroundColor', () => {
    const shadowedBackground = source({ backgroundColor: 'notacolor' })
    expect(() => renderMermaidSVG(shadowedBackground, { bg: '#ffffff' })).not.toThrow()
    expect(verifyMermaid(shadowedBackground, { renderOptions: { bg: '#ffffff' } }).warnings)
      .not.toContainEqual({ code: 'RENDER_FAILED', reason: expect.any(String) })
  })
})
