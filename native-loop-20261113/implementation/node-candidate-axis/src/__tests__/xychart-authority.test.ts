import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import mermaid from 'mermaid'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { asXyChart } from '../agent/types.ts'
import { parseXYChart } from '../xychart/parser.ts'
import { projectEntityMarkers } from '../shared/mermaid-entity-display.ts'
import { renderMermaidSVG } from '../index.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

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
  test('serialized text preserves spaced, punctuated and reserved chart labels in Mermaid', async () => {
    // A quote or backslash comes in as our escape or as Mermaid's entity code.
    // Mermaid's strings have no escapes, so it goes out as an entity code.
    const source = String.raw`xychart-beta
 title "Revenue for 2026, \"net\""
 x-axis "Dap50te C:\\" ["Research & Development", "EU/UK", "bar", "#quot;Q4#quot;"]
 y-axis "Revenue (USD)" 0 --> 100
 bar "Plan \"A\"" [1, 2, 3, 4]
 line Trend [1 "up \\ #quot;", 2, 3, 4]`
    const canonical = serializeMermaid(structured(source))
    const reference = startUpstreamMermaid()
    try {
      expect(await reference.accepts(canonical)).toBe(true)
      const actual = await reference.project(canonical, diagram => ({
        title: diagram.db.getDiagramTitle(), data: diagram.db.getXYChartData(),
      }))
      // Mermaid's database holds entity markers; the browser shows their characters.
      const shown = (value: unknown): unknown => typeof value === 'string' ? projectEntityMarkers(value)
        : Array.isArray(value) ? value.map(shown)
          : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, shown(entry)])) : value
      expect(shown(actual)).toMatchObject({ ok: true, value: {
        title: 'Revenue for 2026, "net"',
        data: {
          xAxis: { title: 'Dap50te C:\\', categories: ['Research & Development', 'EU/UK', 'bar', '"Q4"'] },
          yAxis: { title: 'Revenue (USD)' },
          plots: [{ title: 'Plan "A"' }, { title: 'Trend', pointLabels: ['up \\ "', '', '', ''] }],
        },
      } })
    } finally { reference.close() }
    expectClosed(source)
  })

  test('an unknown nonblank statement fails native rendering instead of losing authored data', async () => {
    const validSource = 'xychart-beta\n  bar [1, 2]\n'
    const source = `${validSource}  frob official-data-lost\n`
    mermaid.initialize({ startOnLoad: false })
    await expect(mermaid.mermaidAPI.getDiagramFromText(validSource)).resolves.toBeDefined()
    await expect(mermaid.mermaidAPI.getDiagramFromText(source)).rejects.toThrow(/Parse error/i)
    expect(() => parseXYChart(source.trim().split('\n').map(line => line.trim()))).toThrow('Unrecognized XYChart line')
    expect(() => renderMermaidSVG(source)).toThrow('Unrecognized XYChart line')
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.body.kind).toBe('opaque')
      expect(serializeMermaid(parsed.value)).toBe(source)
    }
  })

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
    // An entity code naming a C0, DEL or C1 control character is refused.
    const namesControl = (value: string): boolean => /#(?:Tab|NewLine);/.test(value)
      || [...value.matchAll(/#\+?(\d+);/g)].some(([, code]) => Number(code) < 32 || (Number(code) >= 127 && Number(code) < 160))
    const text = fc.string({ minLength: 1, maxLength: 20 })
      .filter(value => !/[\r\n\0]/.test(value) && value.trim().length > 0 && !namesControl(value))
    fc.assert(fc.property(text, value => {
      const escaped = value.replace(/(["\\])/g, '\\$1')
      expectClosed(`xychart-beta\n  title "${escaped}"\n  bar "${escaped}" [1 "${escaped}"]`)
    }), fcParameters({ numRuns: 100 }))
  })
})
