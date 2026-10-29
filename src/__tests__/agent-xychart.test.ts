// BUILD-16: xychart structured mutation (promoting xychart from opaque-only
// fallback semantics, following the BUILD-15 journey and BUILD-17 architecture
// pilots). Parse / narrow / mutate / verify / serialize, the structured-or-
// opaque fallback, round-trip identity, and a differential check that the
// canonical source we emit re-parses identically under the legacy renderer's
// parseXYChart.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { decodeXML } from 'entities'
import { fcParameters } from './helpers/fc-parameters.ts'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { asXyChart } from '../agent/types.ts'
import type { XyChartValidDiagram, XyChartMutationOp } from '../agent/types.ts'
import { applyXYChartFrontmatterConfig, parseXYChart } from '../xychart/parser.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { renderMermaidSVG } from '../index.ts'

const SRC = `xychart-beta
  title Sales Report
  x-axis Months [Jan, Feb, Mar]
  y-axis Revenue 0 --> 100
  bar Online [10, 20.5, 30]
  line Store [5, -2, 0.1]
`

function xychart(src: string = SRC): XyChartValidDiagram {
  const r = parseMermaid(src)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  const x = asXyChart(r.value)
  if (!x) throw new Error('not a structured xychart: ' + r.value.body.kind)
  return x
}

function apply(d: XyChartValidDiagram, op: XyChartMutationOp): XyChartValidDiagram {
  const r = mutate(d, op)
  if (!r.ok) throw new Error('mutate: ' + JSON.stringify(r.error))
  return r.value
}

describe('xychart structured parse', () => {
  test('models title, named categorical x-axis, named range y-axis, and bar/line series', () => {
    const d = xychart()
    expect(d.kind).toBe('xychart')
    expect(d.body.title).toBe('Sales Report')
    expect(d.body.xAxis).toEqual({ name: 'Months', categories: ['Jan', 'Feb', 'Mar'] })
    expect(d.body.yAxis).toEqual({ name: 'Revenue', range: { min: 0, max: 100 } })
    expect(d.body.series.map(s => s.kind)).toEqual(['bar', 'line'])
    expect(d.body.series[0]).toMatchObject({ name: 'Online', values: [10, 20.5, 30] })
    expect(d.body.series[1]!.values).toEqual([5, -2, 0.1])
  })

  test('bare categorical x-axis and range-only / name-only axes parse structurally', () => {
    const d = xychart('xychart-beta\n  x-axis [a, b]\n  y-axis 0 --> 50\n  bar [1, 2]')
    expect(d.body.xAxis).toEqual({ categories: ['a', 'b'] })
    expect(d.body.yAxis).toEqual({ range: { min: 0, max: 50 } })
    const e = xychart('xychart-beta\n  y-axis Amount\n  line [3, 4]')
    expect(e.body.yAxis).toEqual({ name: 'Amount' })
  })

  test('horizontal orientation suffix is modeled', () => {
    const d = xychart('xychart-beta horizontal\n  bar [1, 2, 3]')
    expect(d.body.horizontal).toBe(true)
    expect(serializeMermaid(d)).toContain('xychart-beta horizontal')
  })

  test('round-trips to canonical source and re-parses identically', () => {
    const d = xychart()
    const out = serializeMermaid(d)
    const d2 = xychart(out)
    expect(d2.body).toEqual(d.body)
    expect(serializeMermaid(d2)).toBe(out)
  })
})

describe('xychart differential vs legacy parseXYChart', () => {
  // The canonical source the structured serializer emits must re-parse to the
  // SAME semantics under the legacy renderer's parseXYChart, or the agent and
  // the renderer would disagree about what a mutated chart means.
  const samples = [
    SRC,
    'xychart-beta\n  x-axis [a, b, c]\n  bar S [1, 2, 3]\n  line [4, 5, 6]',
    'xychart-beta horizontal\n  title T\n  y-axis Y -10 --> 10\n  bar [0.5, -0.5]',
  ]
  for (const [i, src] of samples.entries()) {
    test(`sample ${i}: structured + legacy agree on canonical output`, () => {
      const d = xychart(src)
      const out = serializeMermaid(d)
      const norm = normalizeMermaidSource(out)
      const legacy = applyXYChartFrontmatterConfig(parseXYChart(norm.lines), norm.frontmatter)

      expect(legacy.title).toBe(d.body.title)
      expect(legacy.horizontal).toBe(Boolean(d.body.horizontal))
      // Axis name maps to legacy `title`; categories/range map directly.
      expect(legacy.xAxis.title).toBe(d.body.xAxis?.name)
      expect(legacy.xAxis.categories).toEqual(d.body.xAxis?.categories)
      expect(legacy.yAxis.title).toBe(d.body.yAxis?.name)
      // Only assert range equality when our body declares one (legacy
      // auto-derives a y-range from the data when none is written).
      if (d.body.yAxis?.range) expect(legacy.yAxis.range).toEqual(d.body.yAxis.range)
      // Series type/label/data agree one-for-one.
      expect(legacy.series.map(s => s.type)).toEqual(d.body.series.map(s => s.kind))
      expect(legacy.series.map(s => s.label)).toEqual(d.body.series.map(s => s.name))
      expect(legacy.series.map(s => s.data)).toEqual(d.body.series.map(s => s.values))
    })
  }
})

describe('xychart structured-or-opaque fallback', () => {
  const opaqueCases: Array<[string, string]> = [
    ['unmodeled token (curve)', 'xychart-beta\n  bar [1, 2]\n  curve basis'],
    ['non-numeric series value', 'xychart-beta\n  bar [1, two, 3]'],
    ['header EXTRA suffix', 'xychart-beta EXTRA\n  bar [1, 2]'],
    ['empty category', 'xychart \nx-axis    [   ]'],
    ['missing category between commas', 'xychart \nx-axis    [  "cat."  ,   ,   cat2a  ]'],
    ['text after a quoted category', 'xychart \nx-axis xAxisName    [  "cat1 "cat ]'],
    ['malformed quotes among categories', 'xychart \nx-axis xAxisName    [  "cat1 "cat , 1"   with space"note ,   cat2 asdf , cat3]'],
  ]
  for (const [name, src] of opaqueCases) {
    test(`${name} falls back to opaque and round-trips verbatim`, () => {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.body.kind).toBe('opaque')
      expect(asXyChart(r.value)).toBeNull()
      expect(serializeMermaid(r.value).trimEnd()).toBe(src)
      for (const input of [src, r.value]) {
        const verification = verifyMermaid(input)
        expect(verification.ok).toBe(false)
        expect(verification.checks?.renderability).toBe('failed')
        expect(verification.warnings).toContainEqual(expect.objectContaining({ code: 'RENDER_FAILED', origin: 'source' }))
      }
    })
  }

  test('semicolon statements use the shared grammar and remain structured', () => {
    const d = xychart('xychart-beta\n  title T; bar [1, 2]')
    expect(d.body.title).toBe('T')
    expect(d.body.series[0]?.values).toEqual([1, 2])
  })

  test('statements sharing a line and quoted text across lines stay structured through the writer', () => {
    const d = xychart('xychart-beta\n  title "multi\nline" bar "Sales" [1, 2] line [2, 1]')
    expect(d.body).toMatchObject({
      title: 'multi\nline',
      series: [{ kind: 'bar', name: 'Sales', values: [1, 2] }, { kind: 'line', values: [2, 1] }],
    })
    expect(xychart(serializeMermaid(d)).body).toEqual(d.body)
  })

  test('an accessibility directive after another statement on its line stays structured and joins the envelope', () => {
    const cases: Array<[string, object, { title?: string; descr?: string }]> = [
      // An inline directive's value runs to the end of its line, `;` included.
      ['xychart-beta horizontal; accTitle: Accessible; bar [1, 2]', { horizontal: true, accessibilityTitle: 'Accessible; bar [1, 2]', series: [] }, { title: 'Accessible; bar [1, 2]' }],
      ['xychart-beta\n  bar [1, 2] accTitle: a; line [3, 4]', { accessibilityTitle: 'a; line [3, 4]', series: [{ values: [1, 2] }] }, { title: 'a; line [3, 4]' }],
      ['xychart-beta\n  bar [1, 2] accDescr: a; line [3, 4]', { accessibilityDescription: 'a; line [3, 4]', series: [{ values: [1, 2] }] }, { descr: 'a; line [3, 4]' }],
      ['xychart-beta\n  bar [1, 2] accTitle: hi bar [2, 1]', { accessibilityTitle: 'hi bar [2, 1]', series: [{ values: [1, 2] }] }, { title: 'hi bar [2, 1]' }],
      ['xychart-beta\n  accTitle: T\n  bar [1] accDescr { x } bar [2]', { accessibilityTitle: 'T', accessibilityDescription: 'x', series: [{ values: [1] }, { values: [2] }] }, { title: 'T', descr: 'x' }],
      ['xychart-beta\n  bar [1, 2] accTitle: Quarterly revenue\n  accDescr: Two bars\n  line [3, 4]', { accessibilityTitle: 'Quarterly revenue', accessibilityDescription: 'Two bars', series: [{ values: [1, 2] }, { values: [3, 4] }] }, { title: 'Quarterly revenue', descr: 'Two bars' }],
      // `%%` in the value is text, and a `"` in it opens no string.
      ['xychart-beta\n  bar [1, 2] accTitle: a %% b', { accessibilityTitle: 'a %% b', series: [{ values: [1, 2] }] }, { title: 'a %% b' }],
      ['xychart-beta\n  bar [1, 2] accDescr: a %% b\n  line [3, 4]', { accessibilityDescription: 'a %% b', series: [{ values: [1, 2] }, { values: [3, 4] }] }, { descr: 'a %% b' }],
      ['xychart-beta\n  bar [1, 2] accTitle: a "b\n  line "s" [3, 4]', { accessibilityTitle: 'a "b', series: [{ values: [1, 2] }, { name: 's', values: [3, 4] }] }, { title: 'a "b' }],
      ['xychart-beta\n  bar [1, 2] accDescr: a "b %% c\n  line "s" [3, 4]', { accessibilityDescription: 'a "b %% c', series: [{ values: [1, 2] }, { name: 's', values: [3, 4] }] }, { descr: 'a "b %% c' }],
    ]
    for (const [source, body, accessibility] of cases) {
      const d = xychart(source)
      expect(d.body, source).toMatchObject(body)
      expect(d.meta.accessibility, source).toEqual(accessibility)
      expect(d.meta.droppedComments, source).toBeUndefined()
      expect(xychart(serializeMermaid(d)).body).toEqual(d.body)
      // The drawing names the chart as the body does, each directive wherever it stands.
      const svg = renderMermaidSVG(source)
      expect(decodeXML(svg.match(/<title\b[^>]*>([^<]*)<\/title>/)?.[1] ?? '') || undefined, source).toBe(accessibility.title)
      expect(decodeXML(svg.match(/<desc\b[^>]*>([^<]*)<\/desc>/)?.[1] ?? '') || undefined, source).toBe(accessibility.descr)
    }
    // Beside another value on a line of its own, Mermaid keeps the one written
    // last, which neither reader can order: the source is kept, and said so.
    const source = 'xychart-beta\n  accTitle: first\n  bar [1] accTitle: second\n'
    const parsed = parseMermaid(source)
    expect(parsed.ok && parsed.value.body.kind).toBe('opaque')
    if (parsed.ok) expect(serializeMermaid(parsed.value)).toBe(source)
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'xychart_accessibility_order' }))
  })

  test('repeated axis directives preserve independently authored components in either order', () => {
    for (const source of [
      'xychart-beta\nx-axis [Jan, Feb]; x-axis Months\ny-axis 0 --> 100; y-axis Revenue\nbar [1, 2]',
      'xychart-beta\nx-axis Months; x-axis [Jan, Feb]\ny-axis Revenue; y-axis 0 --> 100\nbar [1, 2]',
    ]) {
      const d = xychart(source)
      expect(d.body.xAxis).toEqual({ name: 'Months', categories: ['Jan', 'Feb'] })
      expect(d.body.yAxis).toEqual({ name: 'Revenue', range: { min: 0, max: 100 } })
    }
  })

  // Characterized against the Mermaid 11.16 xychart Jison grammar pinned in
  // node_modules/mermaid. These cases keep the compatibility claim independent
  // of our parse→serialize self-closure properties.
  const mermaid1116Characterization: Array<{
    name: string
    source: string
    structured: boolean
  }> = [
    { name: 'same-line header separator', source: 'xychart-beta horizontal; bar [1]', structured: true },
    { name: 'case-insensitive series keyword', source: 'xychart-beta\n  BAR [1, 2]', structured: true },
    { name: 'quoted point label', source: 'xychart-beta\n  bar [1 "peak", 2 "close"]', structured: true },
    { name: 'empty list', source: 'xychart-beta\n  bar []', structured: false },
    { name: 'only separator', source: 'xychart-beta\n  bar [,]', structured: false },
    { name: 'missing middle point', source: 'xychart-beta\n  bar [1,,2]', structured: false },
    { name: 'trailing separator', source: 'xychart-beta\n  bar [1,]', structured: false },
    { name: 'unquoted point label', source: 'xychart-beta\n  bar [1 peak]', structured: false },
    { name: 'single-quoted point label', source: "xychart-beta\n  bar [1 'peak']", structured: false },
    { name: 'exponent notation', source: 'xychart-beta\n  bar [1e3]', structured: false },
  ]
  for (const { name, source, structured } of mermaid1116Characterization) {
    test(`Mermaid 11.16 characterization: ${name}`, () => {
      const parsed = parseMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      expect(parsed.value.body.kind === 'xychart').toBe(structured)
      if (!structured) expect(serializeMermaid(parsed.value).trimEnd()).toBe(source)
    })
  }

  test('universal accessibility stays structured and round-trips through the family serializer', () => {
    const src = 'xychart-beta\n  accTitle: Accessible\n  accDescr {\n    first line\n    second line\n  }\n  bar [1, 2]'
    const r = parseMermaid(src)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(asXyChart(r.value)?.body).toMatchObject({
      accessibilityTitle: 'Accessible',
      accessibilityDescription: 'first line\nsecond line',
    })
    expect(parseMermaid(serializeMermaid(r.value))).toMatchObject({ ok: true, value: { body: { kind: 'xychart' } } })
  })

  // Mermaid's xychart syntax quotes text, and the family's own example did too —
  // quoting must NOT drop the whole chart to opaque (it caused an eval failure).
  // Quoted text stays STRUCTURED; the writer keeps quotes where they preserve meaning.
  const quotedStructured: Array<[string, string]> = [
    ['quoted title', 'xychart-beta\n  title "Monthly Revenue"\n  bar [1, 2]'],
    ['quoted category', 'xychart-beta\n  x-axis ["Jan", "Feb"]\n  bar [1, 2]'],
    ['quoted named range axis', 'xychart-beta\n  y-axis "Revenue" 0 --> 200\n  bar [1, 2]'],
    ['quoted series name', 'xychart-beta\n  bar "Revenue" [1, 2]'],
  ]
  for (const [name, src] of quotedStructured) {
    test(`${name} parses STRUCTURED (quotes accepted, not opaque)`, () => {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.body.kind).toBe('xychart')
      expect(asXyChart(r.value)).not.toBeNull()
      // Simple words can canonicalize unquoted; spaces must survive upstream's lexer.
      const out = serializeMermaid(r.value)
      if (name === 'quoted title') expect(out).toContain('title "Monthly Revenue"')
      else expect(out).not.toContain('"')
      const re = parseMermaid(out)
      expect(re.ok && re.value.body.kind).toBe('xychart')
    })
  }
})

describe('xychart mutation ops', () => {
  test('set_title / clear title', () => {
    expect(apply(xychart(), { kind: 'set_title', title: 'Q4' }).body.title).toBe('Q4')
    expect(apply(xychart(), { kind: 'set_title', title: null }).body.title).toBeUndefined()
  })

  test('set_x_axis (categories) / set_y_axis (range) / clear axis', () => {
    let d = apply(xychart(), { kind: 'set_x_axis', axis: { name: 'Q', categories: ['Q1', 'Q2'] } })
    expect(d.body.xAxis).toEqual({ name: 'Q', categories: ['Q1', 'Q2'] })
    d = apply(d, { kind: 'set_y_axis', axis: { range: { min: -5, max: 5 } } })
    expect(d.body.yAxis).toEqual({ range: { min: -5, max: 5 } })
    d = apply(d, { kind: 'set_x_axis', axis: null })
    expect(d.body.xAxis).toBeUndefined()
    expect(d.canonicalSource).not.toContain('x-axis')
  })

  test('add_series / remove_series / set_series_values / set_series_name', () => {
    let d = apply(xychart(), { kind: 'add_series', kind2: 'bar', name: 'New', values: [7, 8, 9] })
    expect(d.body.series).toHaveLength(3)
    expect(d.body.series[2]).toMatchObject({ kind: 'bar', name: 'New', values: [7, 8, 9] })
    // canonicalSource is rebuilt after mutation — never stale.
    expect(d.canonicalSource).toContain('bar New [7, 8, 9]')
    d = apply(d, { kind: 'set_series_values', index: 2, values: [1, 2, 3] })
    expect(d.body.series[2]!.values).toEqual([1, 2, 3])
    d = apply(d, { kind: 'set_series_name', index: 2, name: null })
    expect(d.body.series[2]!.name).toBeUndefined()
    d = apply(d, { kind: 'remove_series', index: 0 })
    expect(d.body.series).toHaveLength(2)
  })

  test('reorder_series moves a series', () => {
    const d = apply(xychart(), { kind: 'reorder_series', from: 0, to: 1 })
    expect(d.body.series.map(s => s.name)).toEqual(['Store', 'Online'])
  })

  test('category/series length mismatch is allowed (mermaid + legacy renderer accept it)', () => {
    // 3 categories, a 2-value series: the legacy renderer does not reject this,
    // so the structured layer must not either. Decision: allow, and prove the
    // canonical output still parses under the legacy parser.
    const d = apply(xychart(), { kind: 'add_series', kind2: 'bar', values: [99, 100] })
    expect(d.body.series[2]!.values).toHaveLength(2)
    const norm = normalizeMermaidSource(serializeMermaid(d))
    const legacy = applyXYChartFrontmatterConfig(parseXYChart(norm.lines), norm.frontmatter)
    expect(legacy.series[2]!.data).toEqual([99, 100])
    expect(legacy.xAxis.categories).toHaveLength(3)
  })

  test('error paths: missing series, non-finite values, bad text', () => {
    const cases: Array<[XyChartMutationOp, import('../agent/types.ts').MutationError['code']]> = [
      [{ kind: 'remove_series', index: 9 }, 'SERIES_NOT_FOUND'],
      [{ kind: 'set_series_values', index: 9, values: [1] }, 'SERIES_NOT_FOUND'],
      [{ kind: 'set_series_name', index: 9, name: 'X' }, 'SERIES_NOT_FOUND'],
      [{ kind: 'reorder_series', from: 0, to: 9 }, 'SERIES_NOT_FOUND'],
      [{ kind: 'add_series', kind2: 'bar', values: [Number.NaN] }, 'INVALID_OP'],
      [{ kind: 'add_series', kind2: 'bar', values: [Infinity] }, 'INVALID_OP'],
      [{ kind: 'add_series', kind2: 'bar', values: [] }, 'INVALID_OP'],
      [{ kind: 'set_title', title: 'has "quote"' }, 'INVALID_OP'],
      [{ kind: 'set_x_axis', axis: { categories: ['ok', 'bad]'] } }, 'INVALID_OP'],
      [{ kind: 'set_y_axis', axis: { categories: ['x'] } }, 'INVALID_OP'],
      [{ kind: 'add_series', kind2: 'pie' as never, values: [1] }, 'INVALID_OP'],
    ]
    for (const [op, code] of cases) {
      const r = mutate(xychart(), op)
      expect({ op: op.kind, ok: r.ok, code: r.ok ? null : r.error.code }).toEqual({ op: op.kind, ok: false, code })
    }
  })

  test('mutation does not alias the input diagram', () => {
    const d = xychart()
    apply(d, { kind: 'set_series_values', index: 0, values: [0, 0, 0] })
    expect(d.body.series[0]!.values).toEqual([10, 20.5, 30])
  })
})

describe('xychart verify + render', () => {
  test('verify passes on a healthy chart and serializes after the loop', () => {
    let d = xychart()
    d = apply(d, { kind: 'add_series', kind2: 'line', name: 'Mobile', values: [1, 2, 3] })
    const v = verifyMermaid(d)
    expect(v.ok).toBe(true)
    expect(serializeMermaid(d)).toContain('line Mobile [1, 2, 3]')
  })

  test('EMPTY_DIAGRAM fires on a header-only chart', () => {
    const v = verifyMermaid('xychart-beta')
    expect(v.warnings.map(w => w.code)).toContain('EMPTY_DIAGRAM')
    expect(v.ok).toBe(false)
  })

  test('LABEL_OVERFLOW fires on an over-cap title, axis name, and series name', () => {
    const long = 'X'.repeat(80)
    const title = verifyMermaid(xychart(`xychart-beta\n  title ${long}\n  bar [1, 2]`))
    expect(title.warnings.find(w => w.code === 'LABEL_OVERFLOW')).toMatchObject({ target: 'title', limit: 40 })
    const axis = verifyMermaid(xychart(`xychart-beta\n  y-axis ${long}\n  bar [1, 2]`))
    expect(axis.warnings.find(w => w.code === 'LABEL_OVERFLOW')).toMatchObject({ target: 'y-axis' })
    const series = verifyMermaid(xychart(`xychart-beta\n  bar ${long} [1, 2]`))
    expect(series.warnings.find(w => w.code === 'LABEL_OVERFLOW')).toBeDefined()
  })

  test('mixed-length bar and line series stay inside the chart bounds', () => {
    const d = xychart(`xychart-beta
  x-axis xAxisName
  y-axis yAxisName
  bar barTitle1 [23, 45, 56.6]
  line lineTitle1 [11, 45.5, 67, 23]
  bar barTitle2 [13, 42, 56.89]
  line lineTitle2 [45, 99, 12]`)
    const v = verifyMermaid(d)
    expect(v.warnings.filter(w => w.code === 'OFF_CANVAS')).toEqual([])
    expect(v.ok).toBe(true)
  })

  test('mutated chart renders through the legacy renderer', async () => {
    const { renderMermaidSVG } = await import('../agent/index.ts')
    const d = apply(xychart(), { kind: 'set_title', title: 'Rendered' })
    const svg = renderMermaidSVG(d)
    expect(svg).toContain('<svg')
    expect(svg).toContain('Rendered')
  })
})

describe('xychart set_orientation / set_data_point ops', () => {
  test('set_orientation horizontal flips the header and serialize→re-parse preserves it', () => {
    const d = apply(xychart(), { kind: 'set_orientation', horizontal: true })
    expect(d.body.horizontal).toBe(true)
    const out = serializeMermaid(d)
    expect(out).toContain('xychart-beta horizontal')
    // Agent re-parse agrees.
    expect(Boolean(xychart(out).body.horizontal)).toBe(true)
    // Legacy renderer parser agrees.
    const norm = normalizeMermaidSource(out)
    expect(applyXYChartFrontmatterConfig(parseXYChart(norm.lines), norm.frontmatter).horizontal).toBe(true)
  })

  test('explicit vertical mutation wins over contradictory horizontal frontmatter', () => {
    const source = `---
config:
  xyChart:
    chartOrientation: horizontal
---
xychart-beta
  bar [1, 2]`
    const d = apply(xychart(source), { kind: 'set_orientation', horizontal: false })
    const out = serializeMermaid(d)
    expect(out).toContain('chartOrientation: horizontal')
    expect(out).toContain('xychart-beta vertical')
    const normalized = normalizeMermaidSource(out)
    expect(applyXYChartFrontmatterConfig(parseXYChart(normalized.lines), normalized.frontmatter).horizontal).toBe(false)
  })

  test('set_orientation back to vertical preserves an explicit vertical header', () => {
    let d = apply(xychart('xychart-beta horizontal\n  bar [1, 2]'), { kind: 'set_orientation', horizontal: false })
    expect(Boolean(d.body.horizontal)).toBe(false)
    const out = serializeMermaid(d)
    expect(out).toContain('xychart-beta vertical')
    expect(xychart(out).body.horizontal).toBe(false)
    // Idempotent: setting the current orientation is a no-op, not an error.
    d = apply(d, { kind: 'set_orientation', horizontal: false })
    expect(Boolean(d.body.horizontal)).toBe(false)
  })

  test('set_data_point edits exactly one value and serialize→re-parse preserves', () => {
    const d = apply(xychart(), { kind: 'set_data_point', seriesIndex: 0, index: 1, value: 99.5 })
    expect(d.body.series[0]!.values).toEqual([10, 99.5, 30])
    // Neighbors and the other series are untouched.
    expect(d.body.series[1]!.values).toEqual([5, -2, 0.1])
    expect(d.canonicalSource).toContain('bar Online [10, 99.5, 30]')
    const d2 = xychart(serializeMermaid(d))
    expect(d2.body.series[0]!.values).toEqual([10, 99.5, 30])
    // Legacy renderer parser sees the same data.
    const norm = normalizeMermaidSource(serializeMermaid(d))
    expect(applyXYChartFrontmatterConfig(parseXYChart(norm.lines), norm.frontmatter).series[0]!.data).toEqual([10, 99.5, 30])
  })

  test('set_data_point error paths are prescriptive', () => {
    // Series index out of range → SERIES_NOT_FOUND naming the valid range.
    const badSeries = mutate(xychart(), { kind: 'set_data_point', seriesIndex: 5, index: 0, value: 1 })
    expect(badSeries.ok).toBe(false)
    if (!badSeries.ok) {
      expect(badSeries.error.code).toBe('SERIES_NOT_FOUND')
      expect(badSeries.error.message).toContain('0..1')
    }
    // Point index out of range → POINT_NOT_FOUND naming the valid range.
    const badIndex = mutate(xychart(), { kind: 'set_data_point', seriesIndex: 0, index: 3, value: 1 })
    expect(badIndex.ok).toBe(false)
    if (!badIndex.ok) {
      expect(badIndex.error.code).toBe('POINT_NOT_FOUND')
      expect(badIndex.error.message).toContain('0..2')
    }
    // Non-integer indices are rejected, not truncated.
    const fracIndex = mutate(xychart(), { kind: 'set_data_point', seriesIndex: 0, index: 0.5, value: 1 })
    expect(fracIndex.ok).toBe(false)
    const fracSeries = mutate(xychart(), { kind: 'set_data_point', seriesIndex: 0.5 as never, index: 0, value: 1 })
    expect(fracSeries.ok).toBe(false)
    // Non-finite values are rejected so the serializer never emits NaN.
    for (const value of [Number.NaN, Infinity, -Infinity]) {
      const r = mutate(xychart(), { kind: 'set_data_point', seriesIndex: 0, index: 0, value })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('INVALID_OP')
    }
  })

  test('mutation does not alias the input diagram (set_data_point / set_orientation)', () => {
    const d = xychart()
    apply(d, { kind: 'set_data_point', seriesIndex: 0, index: 0, value: -1 })
    apply(d, { kind: 'set_orientation', horizontal: true })
    expect(d.body.series[0]!.values[0]).toBe(10)
    expect(Boolean(d.body.horizontal)).toBe(false)
  })
})

describe('xychart round-trip property', () => {
  const nameArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,12}[A-Za-z0-9]$/)
  const catArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,6}$/)
  // Number format round-trip hazard: floats must survive String(n) → parseFloat.
  // Include integers, negatives, and decimals from a finite-safe generator.
  const valueArb = fc.oneof(
    fc.integer({ min: -1000, max: 1000 }),
    fc.constantFrom(0.1, -0.5, 2.5, 3.14, -42, 0, 100),
  )

  test('parse(serialize(parse(src))) is identity on generated charts', () => {
    fc.assert(
      fc.property(
        fc.option(nameArb, { nil: undefined }),
        fc.uniqueArray(catArb, { minLength: 1, maxLength: 5 }),
        fc.array(
          fc.record({
            kind: fc.constantFrom('bar', 'line'),
            name: fc.option(nameArb, { nil: undefined }),
            values: fc.array(valueArb, { minLength: 1, maxLength: 5 }),
          }),
          { minLength: 1, maxLength: 3 },
        ),
        (title, cats, series) => {
          const lines = ['xychart-beta']
          if (title) lines.push(`  title ${title}`)
          lines.push(`  x-axis [${cats.join(', ')}]`)
          for (const s of series) {
            const namePart = s.name ? `${s.name} ` : ''
            lines.push(`  ${s.kind} ${namePart}[${s.values.join(', ')}]`)
          }
          const d = xychart(lines.join('\n'))
          const expected = { title, categories: cats, series }
          const meaning = (diagram: XyChartValidDiagram) => ({
            title: diagram.body.title,
            categories: diagram.body.xAxis?.categories,
            series: diagram.body.series.map(({ kind, name, values }) => ({ kind, name, values })),
          })
          expect(meaning(d)).toEqual(expected)
          const out = serializeMermaid(d)
          const d2 = xychart(out)
          expect(meaning(d2)).toEqual(expected)
          expect(serializeMermaid(d2)).toBe(out)
        },
      ),
      fcParameters({ numRuns: 50 }),
    )
  })

  test('canonical number format survives 0.1, integers, and negatives', () => {
    const d = xychart('xychart-beta\n  bar [0.1, 42, -5, 0, 3.14]')
    const out = serializeMermaid(d)
    expect(out).toContain('[0.1, 42, -5, 0, 3.14]')
    expect(xychart(out).body.series[0]!.values).toEqual([0.1, 42, -5, 0, 3.14])
  })

  test('canonical number format closes every finite exponent-form boundary over the decimal grammar', () => {
    const values = [1e21, 1e-7, -1e21, -1e-7, Number.MIN_VALUE, Number.MAX_VALUE, -0]
    let d = xychart('xychart-beta\n  bar [1]')
    d = apply(d, { kind: 'set_series_values', index: 0, values })
    const out = serializeMermaid(d)
    expect(out).not.toMatch(/[0-9]e[+-]?\d/i)
    const reparsed = xychart(out)
    values.forEach((value, index) => expect(Object.is(reparsed.body.series[0]!.values[index], value), String(value)).toBe(true))
    expect(serializeMermaid(reparsed)).toBe(out)
  })
})


test('XYChart writer quotes keyword prefixes and shields comment openers without changing stored text', async () => {
  const { startUpstreamMermaid } = await import('./helpers/upstream-mermaid.ts')
  const upstream = startUpstreamMermaid()
  try {
    for (const label of ['verticala', 'horizontal2', 'titleRevenue', 'barGraph', 'lineItem', '60% on MMLU', '%%', 'Revenue %%{text', '#37; literal']) {
      const sourceLabel = label === '#37; literal' ? '#35;37; literal' : label
      const source = `xychart
  title "${sourceLabel}"
  x-axis "${sourceLabel}" ["${sourceLabel}"]
  y-axis "${sourceLabel}" 0 --> 10
  line "${sourceLabel}" [1 "${sourceLabel}"]`
      const diagram = xychart(source)
      const written = serializeMermaid(diagram)
      if (label === '60% on MMLU') expect(written).toContain('title "60% on MMLU"')
      expect(await upstream.publicAccepts(written)).toBe(true)
      expect(xychart(written).body).toEqual(diagram.body)
      expect(diagram.body.title).toBe(label)
      expect(diagram.body.xAxis).toEqual({ name: label, categories: [label] })
      expect(diagram.body.series[0]).toMatchObject({ name: label, pointLabels: [label] })
      if (label.includes(';')) {
        expect(mutate(xychart(), { kind: 'set_title', title: label }).ok).toBe(false)
      } else {
        const edited = apply(xychart(), { kind: 'set_title', title: label })
        expect(await upstream.publicAccepts(serializeMermaid(edited))).toBe(true)
        expect(xychart(serializeMermaid(edited)).body.title).toBe(label)
      }
    }
    for (const statement of ['title ""', 'x-axis ""', 'x-axis [""]', 'line "" [1]', 'line [1 ""]']) {
      const source = `xychart\n${statement}`
      const parsed = parseMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) throw Error(JSON.stringify(parsed.error))
      expect(parsed.value.body.kind).toBe('opaque')
      expect(serializeMermaid(parsed.value).trim()).toBe(source)
    }
  } finally { upstream.close() }
})
