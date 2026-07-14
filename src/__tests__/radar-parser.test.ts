import { describe, expect, test } from 'bun:test'
import { parseRadarChart } from '../radar/parser.ts'

const lines = (src: string): string[] => src.split('\n').map(l => l.trim()).filter(Boolean)

describe('radar parser', () => {
  test('parses header forms, axes, curves, options', () => {
    for (const header of ['radar-beta', 'radar-beta:', 'radar-beta :']) {
      const chart = parseRadarChart(lines(`${header}\n  axis a, b, c\n  curve x{1,2,3}`))
      expect(chart.axes.map(a => a.id)).toEqual(['a', 'b', 'c'])
      expect(chart.curves[0]!.values).toEqual([1, 2, 3])
    }
  })

  test('axis and curve labels default to id; quoted labels are captured', () => {
    const chart = parseRadarChart(lines('radar-beta\n  axis a["Alpha"], b\n  curve x["Series"]{1,2}'))
    expect(chart.axes[0]).toEqual({ id: 'a', label: 'Alpha' })
    expect(chart.axes[1]).toEqual({ id: 'b', label: 'b' })
    expect(chart.curves[0]).toEqual({ id: 'x', label: 'Series', values: [1, 2] })
  })

  test('keyed entries (colon optional) reorder to axis order', () => {
    expect(parseRadarChart(lines('radar-beta\n  axis A,B,C\n  curve m{ C: 3, A: 1, B: 2 }')).curves[0]!.values).toEqual([1, 2, 3])
    expect(parseRadarChart(lines('radar-beta\n  axis A,B,C\n  curve m{ C 3, A 1, B 2 }')).curves[0]!.values).toEqual([1, 2, 3])
  })

  test('resolves keyed curves against the final axis set regardless of statement order', () => {
    const chart = parseRadarChart(lines('radar-beta\n  curve m{ B: 2, A: 1 }\n  axis A, B'))
    expect(chart.axes.map(axis => axis.id)).toEqual(['A', 'B'])
    expect(chart.curves[0]!.values).toEqual([1, 2])
  })

  test('accepts multiline curve entries and trailing Mermaid comments', () => {
    const chart = parseRadarChart(lines(`radar-beta
      axis A, B, C %% dimensions
      curve m{
        1,
        2,
        3
      } %% observations`))
    expect(chart.axes.map(axis => axis.id)).toEqual(['A', 'B', 'C'])
    expect(chart.curves[0]!.values).toEqual([1, 2, 3])
  })

  test('decodes quoted escapes and rejects forms outside the upstream grammar', () => {
    const chart = parseRadarChart(lines(String.raw`radar-beta
      axis a["A \"quoted\" label"], b
      curve x{1,2}`))
    expect(chart.axes[0]!.label).toBe('A "quoted" label')
    expect(() => parseRadarChart(lines('radar-beta\n  axis a[Unquoted], b\n  curve x{1,2}'))).toThrow(/quoted label/i)
    expect(() => parseRadarChart(lines('radar-beta\n  axis a-, b\n  curve x{1,2}'))).toThrow(/Invalid radar axis/)
    expect(() => parseRadarChart(lines('radar-beta\n  axis a, b\n  curve x{1,,2}'))).toThrow(/empty/i)
  })

  test('ticks is a bounded positive integer', () => {
    expect(parseRadarChart(lines('radar-beta\n  axis a\n  curve x{1}\n  ticks 64\n  max 2')).ticks).toBe(64)
    for (const ticks of ['0', '2.5', '65']) {
      expect(() => parseRadarChart(lines(`radar-beta\n  axis a\n  curve x{1}\n  ticks ${ticks}\n  max 2`))).toThrow(/ticks/i)
    }
  })

  test('multiple axes/curves per line, comma-joined options', () => {
    const chart = parseRadarChart(lines('radar-beta\n  axis a, b\n  curve x{1,2}, y{2,1}\n  min 1, max 10, ticks 4, graticule polygon'))
    expect(chart.curves.map(c => c.id)).toEqual(['x', 'y'])
    expect({ min: chart.min, max: chart.max, ticks: chart.ticks, graticule: chart.graticule }).toEqual({ min: 1, max: 10, ticks: 4, graticule: 'polygon' })
  })

  test('comments and blank lines are ignored', () => {
    const chart = parseRadarChart(lines('radar-beta\n  %% a comment\n  axis a, b\n\n  curve x{1,2}'))
    expect(chart.axes).toHaveLength(2)
  })

  test('rejects malformed input loudly', () => {
    expect(() => parseRadarChart(lines('radar-beta\n  axis a, b, c\n  curve x{1,-2,3}'))).toThrow(/non-negative|sign/)
    expect(() => parseRadarChart(lines('radar-beta\n  axis a\n  curve x{}'))).toThrow(/empty/)
    expect(() => parseRadarChart(lines('radar-beta\n  axis A,B,C\n  curve x{ A: 1, B: 2 }'))).toThrow(/missing an entry/i)
    expect(() => parseRadarChart(lines('radar-beta\n  axis a, b\n  min 5\n  max 5'))).toThrow(/greater than min/)
    expect(() => parseRadarChart(lines('radar-beta\n  curve x{1}'))).toThrow(/no axes/)
    expect(() => parseRadarChart(lines('radar-beta\n  axis a\n  curve x{1, a: 2}'))).toThrow(/mixes/)
    expect(() => parseRadarChart(lines('radar-beta\n  axis a\n  wut'))).toThrow(/Unrecognized/i)
  })

  test('a positional curve with the wrong value count is kept (not an error)', () => {
    const chart = parseRadarChart(lines('radar-beta\n  axis a, b, c\n  curve x{1, 2}\n  max 5'))
    expect(chart.curves[0]!.values).toEqual([1, 2]) // arity handled at layout, still legended
  })
})
