import { describe, expect, test } from 'bun:test'
import { DEFAULT_ASCII_THEME } from '../ascii/ansi.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import { renderXYChartAscii } from '../ascii/xychart.ts'
import { beginTerminalCapture, capturedTerminalDocument } from '../ascii/terminal-document.ts'
import type { AsciiConfig } from '../ascii/types.ts'

function chart(source: string, useAscii = false) {
  const config: AsciiConfig = { useAscii, paddingX: 5, paddingY: 5, boxBorderPadding: 1, graphDirection: 'TD' }
  beginTerminalCapture(config)
  const text = renderXYChartAscii(source, config, 'none', DEFAULT_ASCII_THEME)
  return { text, document: capturedTerminalDocument(config)! }
}

const weight = (glyph: string): number => glyph === '█' || glyph === '#' ? 1 : /[▄▀▌▐]/.test(glyph) ? 0.5 : 0

describe('terminal XY numeric projection', () => {
  test('equal tick intervals have equal distance and the zero tick sits on the baseline', () => {
    const source = 'xychart-beta\nx-axis [Jan, Feb, Mar, Apr, May]\ny-axis 0 --> 2500\nbar [400,1200,1900,2500,800]'
    const text = renderMermaidASCII(source, { colorMode: 'none' })
    const { document } = chart(source)
    const rows = text.split('\n')
    const tickRows = [0, 500, 1000, 1500, 2000, 2500].map(value => rows.findIndex(row => new RegExp(`^\\s*${value}\\s*[┤┼]`).test(row)))
    expect(tickRows).toEqual([20, 16, 12, 8, 4, 0])
    expect(rows[20]).toContain('─')
    const labels = document.regions().filter(region => /^x-category-/.test(region.id))
    const values = [400, 1200, 1900, 2500, 800]
    labels.forEach((label, index) => {
      const column = Math.floor((label.canvasColStart + label.canvasColEnd) / 2)
      const coverage = [...document.entries()].filter(([x, , cell]) => x === column && cell.owners.some(owner => owner.id === 'series-0')).reduce((sum, [, , cell]) => sum + weight(cell.glyph), 0)
      // Twenty cells represent 2500 units. The half-cell endpoint has at
      // most quarter-cell error; this expectation does not call the scale.
      expect(Math.abs(coverage - values[index]! / 125)).toBeLessThanOrEqual(0.25)
    })
  })

  test('an authored nonzero domain is retained and a baseline-valued bar is empty', () => {
    const { document, text } = chart('xychart-beta\nx-axis [A,B]\ny-axis 1 --> 14\nbar [1,14]')
    const a = document.regions().find(region => region.id === 'x-category-0')!
    const b = document.regions().find(region => region.id === 'x-category-1')!
    const coverageAt = (column: number) => [...document.entries()].filter(([x]) => x === column).reduce((sum, [, , cell]) => sum + weight(cell.glyph), 0)
    expect(coverageAt(a.canvasColStart)).toBe(0)
    expect(coverageAt(b.canvasColStart)).toBe(20)
    expect(text.split('\n').some(row => /^\s*0\s*[┤┼]/.test(row))).toBe(false)
  })

  test('positive and negative bars use the same baseline, with no phantom zero cell', () => {
    for (const useAscii of [false, true]) {
      const { document } = chart('xychart-beta\nx-axis [A,B,C]\ny-axis -2 --> 2\nbar [-2,0,2]', useAscii)
      const lengths = [0, 1, 2].map(index => {
        const label = document.regions().find(region => region.id === `x-category-${index}`)!
        return [...document.entries()].filter(([x]) => x === label.canvasColStart).reduce((sum, [, , cell]) => sum + weight(cell.glyph), 0)
      })
      expect(lengths).toEqual([10, 0, 10])
    }
  })

  test('longer later series and many bar series retain every admitted value', () => {
    const { document } = chart('xychart-beta\nx-axis [A]\nbar [1]\nbar [2,3,4]\nbar [3,4,5]')
    expect(document.regions().filter(region => /^x-category-/.test(region.id))).toHaveLength(3)
    for (const id of ['series-0', 'series-1', 'series-2']) {
      expect([...document.entries()].some(([, , cell]) => weight(cell.glyph) > 0 && cell.owners.some(owner => owner.id === id))).toBe(true)
    }
    expect(document.diagnostics.filter(diagnostic => diagnostic.code === 'TERMINAL_TEXT_COLLISION')).toEqual([])
  })

  test('horizontal half-cell coverage shares the domain and clamps outside values', () => {
    const { document } = chart('xychart-beta horizontal\nx-axis [A,B,C]\ny-axis 0 --> 4\nbar [0,0.1,20]')
    const lengths = [0, 1, 2].map(index => {
      const category = document.regions().find(region => region.id === `x-category-${index}`)!
      return [...document.entries()].filter(([, y, cell]) => y === category.canvasRow && cell.owners.some(owner => owner.id === 'series-0')).reduce((sum, [, , cell]) => sum + weight(cell.glyph), 0)
    })
    expect(lengths).toEqual([0, 1.5, 59])
  })

  test('literal axis titles and axis visibility survive the terminal projection', () => {
    const source = '---\nconfig:\n  xyChart:\n    xAxis:\n      showTick: false\n      showAxisLine: false\n    yAxis:\n      showTick: false\n      showAxisLine: false\n---\nxychart-beta\nx-axis "<b>Categories</b>" [A,B]\ny-axis "<i>Values</i>" 0 --> 4\nbar [1,2]'
    const text = renderMermaidASCII(source, { colorMode: 'none' })
    expect(text).toContain('<b>Categories</b>')
    expect(text).toContain('<i>Values</i>')
    expect(text).not.toContain('┤')
    expect(text).not.toContain('┬')
  })

  test('soft width wraps native text without turning an impossible small preference into a refusal', () => {
    const source = 'xychart-beta horizontal\nx-axis [A,B]\nline [1,2]'
    expect(() => renderMermaidASCII(source, { maxWidth: 1, colorMode: 'none' })).not.toThrow()
    const wrapped = renderMermaidASCII('xychart-beta\ntitle "A very long literal title with several words"\nx-axis [A,B]\nbar [1,2]', { maxWidth: 30, colorMode: 'none' })
    expect(wrapped).not.toContain('<br/>')
    expect(wrapped).toContain('literal title')
  })
})
