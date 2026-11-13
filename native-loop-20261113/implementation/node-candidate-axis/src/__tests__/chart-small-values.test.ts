import { expect, test } from 'bun:test'
import fc from 'fast-check'
import { decodeXML } from 'entities'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { parseRegisteredMermaid, serializeMermaid, asPie, asRadar, mutate, verifyMermaid } from '../agent/core.ts'
import { layoutRadarChart } from '../radar/layout.ts'
import { parseRadarChart } from '../radar/parser.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { fcParameters } from './helpers/fc-parameters.ts'

test('nonzero sub-cent chart values remain nonzero in visible labels in both outputs', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 9 }), fc.integer({ min: 4, max: 6 }), (numerator, decimals) => {
    const value = numerator / 10 ** decimals
    const sources = [
      `pie showData\n"Sample": ${value}`,
      `sankey-beta\nA,B,${value}`,
      `---\nconfig:\n  radar:\n    tickLabels: true\n---\nradar-beta\naxis a,b,c\ncurve sample{${value},${value},${value}}\nmax ${value}`,
      `---\nconfig:\n  xyChart:\n    showDataLabel: true\n---\nxychart-beta\nx-axis [a]\nbar [${value}]`,
    ]
    for (const source of sources) {
      const svg = renderMermaidSVG(source)
      const visible = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => decodeXML(match[1]!.replace(/<[^>]*>/g, ''))).join('\n')
      expect(visible).toContain(String(value))
      expect(renderMermaidASCII(source)).toContain(String(value))
    }
  }), fcParameters({ numRuns: 30, examples: [[1, 4]] }))
}, 30000)

test('decimal-only chart sources retain structured values across JS exponent boundaries', () => {
  const literals = ['0.0000001', `0.${'0'.repeat(323)}5`, `1${'0'.repeat(21)}`, `1${'0'.repeat(308)}`]
  for (const literal of literals) {
    for (const source of [`pie showData\n"Sample": ${literal}`, `radar-beta\naxis a\ncurve sample{${literal}}\nmax ${literal}`]) {
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
      const serialized = serializeMermaid(parsed.value)
      const reparsed = parseRegisteredMermaid(serialized)
      expect(reparsed.ok).toBe(true)
      if (!reparsed.ok) throw new Error(JSON.stringify(reparsed.error))
      expect(reparsed.value.body.kind).toBe(parsed.value.body.kind)
      const value = asPie(reparsed.value)?.body.slices[0]?.value ?? asRadar(reparsed.value)?.body.curves[0]?.values[0]
      expect(value).toBe(Number(literal))
      expect(() => renderMermaidSVG(serialized)).not.toThrow()
    }
  }
})

test('positive finite binary64 values survive typed Pie and Radar edits and decimal serialization', () => {
  fc.assert(fc.property(fc.double({ min: Number.MIN_VALUE, max: Number.MAX_VALUE, noNaN: true, noDefaultInfinity: true }), value => {
    for (const source of ['pie\n"Sample": 1', 'radar-beta\naxis a\ncurve sample{1}']) {
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
      const edited = parsed.value.body.kind === 'pie'
        ? mutate(parsed.value, { kind: 'set_slice_value', label: 'Sample', value })
        : mutate(parsed.value, { kind: 'set_curve_value', curve: 'sample', axis: 'a', value })
      expect(edited.ok).toBe(true)
      if (!edited.ok) throw new Error(JSON.stringify(edited.error))
      const reparsed = parseRegisteredMermaid(serializeMermaid(edited.value))
      expect(reparsed.ok).toBe(true)
      if (!reparsed.ok) throw new Error(JSON.stringify(reparsed.error))
      expect(reparsed.value.body.kind).toBe(parsed.value.body.kind)
      expect(asPie(reparsed.value)?.body.slices[0]?.value ?? asRadar(reparsed.value)?.body.curves[0]?.values[0]).toBe(value)
    }
  }), fcParameters({ numRuns: 200, examples: [[Number.MIN_VALUE], [1e-7], [Number.MAX_VALUE]] }))
})

test('finite enormous Radar domains keep every ring finite and the outer endpoint exact', () => {
  const maximum = `1${'0'.repeat(308)}`
  const source = `radar-beta\naxis a,b,c\ncurve sample{${maximum},${maximum},${maximum}}\nmax ${maximum}`
  const positioned = layoutRadarChart(parseRadarChart(normalizeMermaidSource(source).lines), {}, { tickLabels: true })
  expect(positioned.rings).toHaveLength(5)
  for (const [index, ring] of positioned.rings.entries()) {
    expect(Number.isFinite(ring.value)).toBe(true)
    expect(ring.value / Number(maximum)).toBeCloseTo((index + 1) / 5, 12)
  }
  expect(positioned.rings.at(-1)!.value).toBe(Number(maximum))
})

test('overflowing Pie totals refuse a misleading zero-share drawing in either output', () => {
  const value = `1${'0'.repeat(308)}`
  const source = `pie showData\n"A": ${value}\n"B": ${value}`
  expect(() => renderMermaidSVG(source)).toThrow('Pie total exceeds the finite numeric range')
  expect(() => renderMermaidASCII(source)).toThrow('Pie total exceeds the finite numeric range')
  expect(verifyMermaid(source).ok).toBe(false)
})

test('mixed-magnitude positive Pie entries never verify a zero percentage caused by numeric underflow', () => {
  fc.assert(fc.property(fc.integer({ min: 300, max: 323 }), fc.integer({ min: 0, max: 100 }), fc.boolean(), (decimals, magnitude, reverse) => {
    const entries = [`"Tiny": 0.${'0'.repeat(decimals - 1)}1`, `"Large": 1${'0'.repeat(magnitude)}`]
    if (reverse) entries.reverse()
    const source = `pie showData\n${entries.join('\n')}`
    let svg: string
    try { svg = renderMermaidSVG(source) }
    catch (error) {
      expect(String(error)).toContain('Pie slice share underflows the finite numeric range')
      expect(() => renderMermaidASCII(source)).toThrow('Pie slice share underflows the finite numeric range')
      expect(verifyMermaid(source).ok).toBe(false)
      return
    }
    expect(svg).not.toContain('(0.0%)')
    expect(renderMermaidASCII(source)).not.toContain(' 0.0%')
  }), fcParameters({ numRuns: 60, examples: [[323, 1, false], [323, 1, true]] }))
})

test('large safe integers retain their exact value in visible Pie and Radar labels', () => {
  fc.assert(fc.property(fc.integer({ min: 2 ** 50, max: Number.MAX_SAFE_INTEGER }), value => {
    const pie = renderMermaidSVG(`pie showData\n"Sample": ${value}`)
    const text = [...pie.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => decodeXML(match[1]!.replace(/<[^>]*>/g, ''))).join('\n')
    expect(text).toContain(String(value))
    expect(renderMermaidASCII(`radar-beta\naxis a\ncurve sample{${value}}`)).toContain(String(value))
  }), fcParameters({ numRuns: 30, examples: [[1125899906842622], [4503599627370495], [9007199254740990]] }))
}, 30000)
