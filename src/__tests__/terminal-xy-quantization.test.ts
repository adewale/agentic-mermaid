import { serializeTerminalArtifact } from '../ascii/terminal-artifact.ts'
import { describe, expect, test } from 'bun:test'
import { DEFAULT_ASCII_THEME } from '../ascii/ansi.ts'
import { renderMermaidASCII, renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { renderXYChartTerminal as renderXYChartAscii } from '../ascii/xychart.ts'
import { terminalDocumentOf } from '../ascii/terminal-document.ts'
import type { AsciiConfig } from '../ascii/types.ts'

function chart(source: string, useAscii = false) {
  const config: AsciiConfig = { useAscii, paddingX: 5, paddingY: 5, boxBorderPadding: 1, graphDirection: 'TD' }
  const artifact = renderXYChartAscii(source, config, 'none', DEFAULT_ASCII_THEME)
  return { text: serializeTerminalArtifact(artifact), document: artifact.document }
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
    expect(labels.map(label => label.id)).toEqual(['x-category-0', 'x-category-1', 'x-category-2', 'x-category-3', 'x-category-4'])
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

  test.each([
    [false, '20,50,80,40'], [false, '22.5,52.5,82.5,42.5'],
    [true, '20,50,80,40'], [true, '22.5,52.5,82.5,42.5'],
  ] as const)('mixed lines preserve the visible quantized bar coverage (horizontal=%s, bars=%s)', (horizontal, values) => {
    const source = `xychart-beta${horizontal ? ' horizontal' : ''}\nx-axis [A,B,C,D]\ny-axis 0 --> 100\nbar [${values}]`
    for (const useAscii of [false, true]) {
      const render = (input: string) => {
        const receipt = renderMermaidASCIIWithReceipt(input, { colorMode: 'none', useAscii })
        const document = terminalDocumentOf(receipt)!
        return { document, plot: document.regions().find(region => region.id === 'plot')!, rows: receipt.text.split('\n') }
      }
      const bars = render(source)
      for (const values of ['20,50,80,40', '0,50,100,25', '10,10,10,10']) {
        const mixed = render(`${source}\nline [${values}]`)
        const dx = mixed.plot.canvasColStart - bars.plot.canvasColStart
        const dy = mixed.plot.canvasRow - bars.plot.canvasRow
        let originalCoverage = 0, visibleCoverage = 0
        for (const [x, y, cell] of bars.document.entries()) {
          if (!cell.owners.some(owner => owner.id === 'series-0') || weight(cell.glyph) === 0) continue
          const emitted = mixed.rows[y + dy]![x + dx]!
          expect(emitted, `bar cell ${x},${y} with line [${values}]`).toBe(cell.glyph)
          originalCoverage += weight(cell.glyph)
          visibleCoverage += weight(emitted)
          expect(mixed.document.cell(x + dx, y + dy)?.owners.map(owner => owner.id)).not.toContain('series-1')
        }
        expect(originalCoverage).toBeGreaterThan(0)
        expect(visibleCoverage).toBe(originalCoverage)
        // A line can be hidden behind a filled mark, but remains visible in
        // the plot outside the marks. Neither legend nor ownership alone
        // establishes that it survived in the drawing.
        const visibleLine = [...mixed.document.entries()].filter(([x, y, cell]) =>
          x >= mixed.plot.canvasColStart && x < mixed.plot.canvasColEnd &&
          y >= mixed.plot.canvasRow && y < mixed.plot.canvasRow + mixed.plot.rowSpan! &&
          cell.owners.some(owner => owner.id === 'series-1'))
        expect(visibleLine.length).toBeGreaterThan(0)
        for (const [x, y, cell] of visibleLine) expect(mixed.rows[y]![x]).toBe(cell.glyph)
        expect(mixed.document.diagnostics.filter(diagnostic => /COLLISION|OVERLAP/.test(diagnostic.code))).toEqual([])
      }
    }
  })

  test.each([false, true])('longer later series and many bar series retain every admitted value (horizontal=%s)', horizontal => {
    const values = [[1], [2, 3, 4], [3, 4, 5]]
    for (const useAscii of [false, true]) {
      const { document, text } = chart(`xychart-beta${horizontal ? ' horizontal' : ''}\nx-axis [A]\ny-axis 0 --> 5\nbar [1]\nbar [2,3,4]\nbar [3,4,5]`, useAscii)
      const regions = document.regions()
      const categories = [0, 1, 2].map(index => regions.find(region => region.id === `x-category-${index}`)!)
      expect(regions.filter(region => /^x-category-/.test(region.id))).toHaveLength(3)
      const centers = categories.map(category => horizontal ? category.canvasRow : Math.floor((category.canvasColStart + category.canvasColEnd) / 2))
      const plot = regions.find(region => region.id === 'plot')!
      const extent = horizontal ? plot.canvasColEnd - plot.canvasColStart : plot.rowSpan! - 1
      expect(extent).toBe(horizontal ? 60 : 20)
      const baseline = horizontal ? plot.canvasColStart : plot.canvasRow + extent
      const rows = text.split('\n')
      for (const [series, data] of values.entries()) {
        const ink = [...document.entries()].filter(([x, y, cell]) => x >= plot.canvasColStart && x < plot.canvasColEnd && y >= plot.canvasRow && y < plot.canvasRow + plot.rowSpan! && weight(cell.glyph) > 0 && cell.owners.some(owner => owner.id === `series-${series}`))
        for (const [category, center] of centers.entries()) {
          const lower = category === 0 ? -Infinity : (centers[category - 1]! + center) / 2
          const upper = category === centers.length - 1 ? Infinity : (center + centers[category + 1]!) / 2
          const cells = ink.filter(([x, y]) => (horizontal ? y : x) >= lower && (horizontal ? y : x) < upper)
          if (data[category] === undefined) {
            expect(cells).toEqual([])
            continue
          }
          expect(cells.length, `series ${series}, category ${category}`).toBeGreaterThan(0)
          const cross = [...new Set(cells.map(([x, y]) => horizontal ? y : x))].sort((a, b) => a - b)
          expect(cross.at(-1)! - cross[0]! + 1).toBe(cross.length)
          for (const coordinate of cross) {
            const interval = cells.filter(([x, y]) => (horizontal ? y : x) === coordinate)
            const positions = interval.map(([x, y]) => horizontal ? x : y).sort((a, b) => a - b)
            expect(positions.at(-1)! - positions[0]! + 1).toBe(positions.length)
            expect(horizontal ? positions[0] : positions.at(-1)).toBe(horizontal ? baseline : baseline - 1)
            const magnitude = interval.reduce((sum, [, , cell]) => sum + weight(cell.glyph), 0)
            expect(Math.abs(magnitude - data[category]! * extent / 5)).toBeLessThanOrEqual(useAscii ? 0.5 : 0.25)
          }
          for (const [x, y, cell] of cells) {
            expect(rows[y]![x]).toBe(cell.glyph)
            expect(cell.owners.filter(owner => /^series-\d+$/.test(owner.id)).map(owner => owner.id)).toEqual([`series-${series}`])
          }
        }
      }
      expect(document.diagnostics.filter(diagnostic => diagnostic.code === 'TERMINAL_TEXT_COLLISION')).toEqual([])
    }
  })

  test('horizontal half-cell coverage shares the domain and clamps outside values', () => {
    const { document } = chart('xychart-beta horizontal\nx-axis [A,B,C]\ny-axis 0 --> 4\nbar [0,0.1,20]')
    const lengths = [0, 1, 2].map(index => {
      const category = document.regions().find(region => region.id === `x-category-${index}`)!
      return [...document.entries()].filter(([, y, cell]) => y === category.canvasRow && cell.owners.some(owner => owner.id === 'series-0')).reduce((sum, [, , cell]) => sum + weight(cell.glyph), 0)
    })
    expect(lengths).toEqual([0, 1.5, 60])
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
