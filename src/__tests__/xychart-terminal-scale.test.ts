import { describe, expect, it } from 'bun:test'
import { renderMermaidASCII } from '../ascii/index.ts'

function render(values: number[], range: [number, number], horizontal = false, useAscii = false): string[] {
  const categories = values.map((_, index) => `C${index}`)
  return renderMermaidASCII(`xychart${horizontal ? ' horizontal' : ''}\nx-axis [${categories.join(', ')}]\ny-axis ${range[0]} --> ${range[1]}\nbar [${values.join(', ')}]`, { colorMode: 'none', useAscii }).split('\n')
}

const blocks = /[█▄▀▌▐#]/

// Issue 384 and Beautiful Mermaid PR 163: ticks and interval coverage must
// describe the same authored domain, rather than two differently sized grids.
describe('terminal XY numeric projection', () => {
  it('puts the zero tick on the category axis and spaces equal tick intervals equally', () => {
    const rows = render([400, 1200, 1900, 2500, 800], [0, 2500])
    expect(rows.flatMap((row, index) => /^\s*\d+[┤┼]/.test(row) ? [index] : [])).toEqual([0, 4, 8, 12, 16, 20])
    expect(rows[20]).toMatch(/^\s*0┼─/)
  })

  for (const horizontal of [false, true]) {
    for (const useAscii of [false, true]) {
      it(`does not invent a bar at the baseline (${horizontal ? 'horizontal' : 'vertical'}, ${useAscii ? 'ASCII' : 'Unicode'})`, () => {
        expect(render([0, 0], [0, 100], horizontal, useAscii).join('\n')).not.toMatch(blocks)
      })
    }
  }

  it('covers exactly the interval length in whole-cell ASCII', () => {
    const rows = render([0, 5, 25, 100], [0, 100], false, true)
    const axisRow = rows.findIndex(row => /^\s*0\+-/.test(row))
    const columns = [...rows[axisRow]!.matchAll(/\+/g)].slice(1).map(match => match.index!)
    expect(columns.map(column => rows.slice(0, axisRow).filter(row => row[column] === '#').length)).toEqual([0, 1, 5, 20])
  })

  for (const { horizontal, range, value, glyph } of [
    { horizontal: false, range: [0, 40] as [number, number], value: 1, glyph: '▄' },
    { horizontal: false, range: [-40, 0] as [number, number], value: -1, glyph: '▀' },
    { horizontal: true, range: [0, 120] as [number, number], value: 1, glyph: '▌' },
    { horizontal: true, range: [-120, 0] as [number, number], value: -1, glyph: '▐' },
  ]) {
    it(`uses ${glyph} for a half-cell ${horizontal ? 'horizontal' : 'vertical'} interval`, () => {
      expect(Array.from(render([value], range, horizontal).join('\n').match(/[█▄▀▌▐#]/g) ?? [])).toEqual(horizontal ? [glyph] : Array(8).fill(glyph))
      expect(render([value], range, horizontal, true).join('\n')).not.toMatch(/[▄▀▌▐]/)
    })
  }

  for (const horizontal of [false, true]) {
    it(`preserves an authored 1..14 domain (${horizontal ? 'horizontal' : 'vertical'})`, () => {
      const baseline = render([1], [1, 14], horizontal).join('\n')
      expect(baseline).not.toMatch(blocks)
      expect(baseline).toMatch(/\b14\b/)
      expect(baseline).toMatch(/\b1\b/)
      expect(baseline).not.toMatch(/\b0\b/)
      expect(render([14], [1, 14], horizontal).join('\n').match(/█/g)?.length).toBe(horizontal ? 60 : 160)
    })
  }

  for (const horizontal of [false, true]) {
    for (const range of [[-4, 4], [4, -4]] as [number, number][]) {
      it(`uses symmetric interval lengths for mixed signs (${horizontal ? 'horizontal' : 'vertical'}, ${range.join('..')})`, () => {
        const rows = render([-4, -2, 0, 2, 4], range, horizontal, true)
        if (horizontal) {
          expect(rows.filter(row => /C\d\|/.test(row)).map(row => row.match(/#/g)?.length ?? 0)).toEqual([30, 15, 0, 15, 30])
        } else {
          const axis = rows.find(row => /^\s*[-\d.]+\+-/.test(row))!
          const columns = [...axis.matchAll(/\+/g)].slice(1).map(match => match.index!)
          expect(columns.map(column => rows.filter(row => row[column] === '#').length)).toEqual([10, 5, 0, 5, 10])
        }
      })
    }
  }

  it('retains partial cells and geometry through ANSI and HTML encoding', () => {
    const source = 'xychart horizontal\nx-axis [A]\ny-axis 0 --> 120\nbar [1]'
    const plain = renderMermaidASCII(source, { colorMode: 'none' })
    const ansi = renderMermaidASCII(source, { colorMode: 'ansi16' })
    const html = renderMermaidASCII(source, { colorMode: 'html' })
    expect(ansi.replace(/\x1b\[[0-9;]*m/g, '')).toBe(plain)
    expect(html.replace(/<[^>]+>/g, '')).toBe(plain)
    expect(plain).toContain('▌')
  })

  it('keeps signed endpoint labels intact when the cell lattice is coarse', () => {
    const source = `---
config:
  xyChart:
    xAxis:
      showLabel: false
---
xychart horizontal
x-axis [A, B]
y-axis -120 --> 0
bar [-120, 0]`
    const rows = renderMermaidASCII(source, { colorMode: 'none', targetWidth: 12 }).split('\n')
    const labels = rows.at(-1)!.trim().split(/\s+/).map(Number)
    expect(labels[0]).toBe(-120)
    expect(labels.at(-1)).toBe(0)
    expect(labels.every((value, index) => index === 0 || value > labels[index - 1]!)).toBe(true)
    expect(rows.every(row => row.length <= 12)).toBe(true)
  })

  it('retains distinct fractional ticks instead of rounding them all to zero', () => {
    const output = render([0, 0.005, 0.01], [0, 0.01]).join('\n')
    expect(output).toMatch(/0\.002┤/)
    expect(output).toMatch(/0\.008┤/)
    expect(output).not.toContain('0.0┤')
  })

  for (const horizontal of [false, true]) {
    it(`measures both signs from a baseline inside a half cell (${horizontal ? 'horizontal' : 'vertical'})`, () => {
      const rows = render([-1, 0, 1], [-1, 7], horizontal)
      const length = (glyph: string) => glyph === '█' ? 1 : /[▄▀▌▐]/.test(glyph) ? 0.5 : 0
      if (horizontal) {
        expect(rows.filter(row => /C\d│/.test(row)).map(row => [...row].reduce((sum, glyph) => sum + length(glyph), 0))).toEqual([7.5, 0, 7.5])
      } else {
        const axis = rows.find(row => /^\s*-1┼/.test(row))!
        const columns = [...axis.matchAll(/┬/g)].map(match => match.index!)
        expect(columns.map(column => rows.reduce((sum, row) => sum + length(row[column] ?? ' '), 0))).toEqual([2.5, 0, 2.5])
      }
    })
  }

  it('uses the same clamped scale for values outside the authored domain', () => {
    expect(render([-5, 25], [0, 20])).toEqual(render([0, 20], [0, 20]))
  })

  it('keeps visible line segments and bar coverage regardless of source series order', () => {
    const body = 'x-axis [A, B]\ny-axis 0 --> 20\n'
    const options = { colorMode: 'none' as const }
    const first = renderMermaidASCII(`xychart\n${body}bar [5, 5]\nline [10, 10]`, options).split('\n').slice(1)
    const second = renderMermaidASCII(`xychart\n${body}line [10, 10]\nbar [5, 5]`, options).split('\n').slice(1)
    expect(first).toEqual(second)
    expect(first[10]).toMatch(/─{20}/)
    expect(first[19]).toContain('█')
  })
})
