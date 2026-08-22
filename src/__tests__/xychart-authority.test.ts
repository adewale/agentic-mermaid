import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { asXyChart } from '../agent/types.ts'
import { parseXYChart } from '../xychart/parser.ts'

function structured(source: string) {
  const parsed = parseRegisteredMermaid(source)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const chart = asXyChart(parsed.value)
  expect(chart).not.toBeNull()
  if (!chart) throw new Error(`Expected structured XYChart for ${source}`)
  return chart
}

function expectClosed(source: string): void {
  const first = structured(source)
  const canonical = serializeMermaid(first)
  const second = structured(canonical)
  expect(second.body).toEqual(first.body)
  expect(serializeMermaid(second)).toBe(canonical)
}

describe('XYChart shared grammar authority', () => {
  test('preserves semicolon-authored axes instead of inferring authorship from physical lines', () => {
    const chart = structured('xychart-beta\n  title T; y-axis 0 --> 100; bar [20, 40]')
    expect(chart.body.yAxis).toEqual({ range: { min: 0, max: 100 } })
    expectClosed('xychart-beta\n  title T; x-axis [A, B]; bar [20, 40]')
  })

  test('preserves point labels on both bar and line series', () => {
    const chart = structured('xychart-beta\n  bar [1 "One", 2 "Two"]\n  line [3 "Three", 4]')
    expect(chart.body.series[0]!.pointLabels).toEqual(['One', 'Two'])
    expect(chart.body.series[1]!.pointLabels).toEqual(['Three', undefined])
    expectClosed('xychart-beta\n  bar [1 "One", 2 "Two"]\n  line [3 "Three", 4]')
  })

  test('quotes every delimiter-bearing text position with parser/serializer closure', () => {
    for (const source of [
      'xychart-beta\n  title "Revenue; Q1"\n  bar [1, 2]',
      'xychart-beta\n  bar "Revenue; Online" [1, 2]',
      'xychart-beta\n  y-axis "Revenue;Net" 0 --> 10\n  bar [1, 2]',
      'xychart-beta\n  y-axis "Trailing\\\\" 0 --> 10\n  bar [1, 2]',
      'xychart-beta\n  x-axis ["North, east", "Semi;colon", "Slash\\\\"]\n  bar [1, 2, 3]',
    ]) expectClosed(source)
  })

  test('uses last-writer semantics for repeated axis directives', () => {
    const ranged = structured('xychart-beta\n  x-axis [A, B]\n  x-axis 0 --> 10\n  bar [1, 2]')
    expect(ranged.body.xAxis).toEqual({ range: { min: 0, max: 10 } })
    const categorical = structured('xychart-beta\n  x-axis 0 --> 10\n  x-axis [A, B]\n  bar [1, 2]')
    expect(categorical.body.xAxis).toEqual({ categories: ['A', 'B'] })
    expectClosed('xychart-beta\n  x-axis [A, B]\n  x-axis 0 --> 10\n  bar [1, 2]')
    expectClosed('xychart-beta\n  x-axis 0 --> 10\n  x-axis [A, B]\n  bar [1, 2]')
  })

  test('strict parsing rejects later headers, header-like garbage, and malformed accessibility blocks', () => {
    expect(() => parseXYChart(['xychart-beta', 'bar [1]', 'xychart-garbage'], { strict: true }))
      .toThrow(/xychart-garbage/)
    expect(() => parseXYChart(['xychart-beta', 'xychart-beta EXTRA', 'bar [1]'], { strict: true }))
      .toThrow(/xychart-beta EXTRA/)
    expect(() => parseXYChart(['xychart-beta', 'bar [1]', 'accDescr {', 'never closes'], { strict: true }))
      .toThrow(/accDescr|closing/i)
  })

  test('agent fallback preserves unknown and malformed syntax byte-for-byte', () => {
    for (const source of [
      'xychart-beta\n  bar [1]\n  xychart-garbage\n',
      'xychart-beta\n  bar [1]\n  accDescr {\n    never closes\n',
    ]) {
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.value.body.kind).toBe('opaque')
      expect(serializeMermaid(parsed.value)).toBe(source)
    }
  })

  test('adversarial quoted text is closed under parse and serialization', () => {
    const text = fc.string({ minLength: 1, maxLength: 20 })
      .filter(value => !/[\r\n\0]/.test(value) && value.trim().length > 0)
    fc.assert(fc.property(text, value => {
      const escaped = value.replace(/(["\\])/g, '\\$1')
      expectClosed(`xychart-beta\n  title "${escaped}"\n  bar "${escaped}" [1 "${escaped}"]`)
    }), { numRuns: 100 })
  })
})
