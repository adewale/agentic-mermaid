// Quadrant structured mutation (promoting quadrantChart from opaque-only
// fallback semantics, following the journey/architecture/xychart pilots). Parse
// / narrow / mutate / verify / serialize, the structured-or-opaque fallback,
// round-trip identity, and a differential check that the canonical source we
// emit re-parses identically under the legacy renderer's parseQuadrantChart.

import { describe, test, expect } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { serializeMermaid, synthesizeFromGraph } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { asQuadrant } from '../agent/types.ts'
import type { QuadrantValidDiagram, QuadrantMutationOp } from '../agent/types.ts'
import { parseQuadrantChart } from '../quadrant/parser.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'
import { normalizeSvg } from './helpers/svg-normalize.ts'
import { renderMermaidSVG, renderMermaidASCII } from '../index.ts'
import { renderMermaidSVG as renderDiagramSVG, renderMermaidASCII as renderDiagramASCII } from '../agent/index.ts'

const SRC = `quadrantChart
  title Reach and engagement of campaigns
  x-axis Low Reach --> High Reach
  y-axis Low Engagement --> High Engagement
  quadrant-1 We should expand
  quadrant-2 Need to promote
  quadrant-3 Re-evaluate
  quadrant-4 May be improved
  Campaign A: [0.3, 0.6]
  Campaign B: [0.45, 0.23]
`

test('Quadrant transport references preserve authored label spacing through saving and editing', async () => {
  const upstream = startUpstreamMermaid()
  try {
    for (const [source, axis, near] of [
      ['quadrantChart\nx-axis Café --&amp; Größe', 'xAxis', 'Café --& Größe'],
      ['quadrantChart\ny-axis &lt; U\\nrgent --> Not Urgent', 'yAxis', '< U\nrgent'],
      ['quadrantChart\nx-axis A&amp;amp; B', 'xAxis', 'A&amp; B'],
    ] as const) {
      const diagram = quadrant(source)
      expect(diagram.body[axis]?.near).toBe(near)
      const saved = serializeMermaid(diagram, { wrapper: 'canonical' })
      expect(await upstream.publicAccepts(saved)).toBe(true)
      expect(parseQuadrantChart(normalizeMermaidSource(saved, {}, 'render').familyLines)[axis]?.near).toBe(near)
      expect(renderMermaidSVG(saved)).toBe(renderMermaidSVG(source))
      expect(renderMermaidASCII(saved)).toBe(renderMermaidASCII(source))
      const edited = mutate(diagram, { kind: 'set_title', title: 'Edited' })
      if (!edited.ok) throw Error(edited.error.message)
      expect(quadrant(serializeMermaid(edited.value)).body[axis]?.near).toBe(near)
    }
    const source = 'quadrantChart\n"A&amp;amp; B": [0.2,0.3]'
    const diagram = quadrant(source)
    expect(diagram.body.points[0]!.label).toBe('A&amp; B')
    const span = diagram.source.spans?.labels.get('quadrant:point#0')
    expect(span).toBeDefined()
    expect(source.slice(span!.start.offset, span!.end.offset)).toBe('"A&amp;amp; B"')
    const saved = serializeMermaid(diagram, { wrapper: 'canonical' })
    expect(await upstream.publicAccepts(saved)).toBe(true)
    expect(renderMermaidSVG(saved)).toBe(renderMermaidSVG(source))
  } finally { upstream.close() }
})

test('backtick Quadrant labels that require quotes stay source-only without changed text', async () => {
  const upstream = startUpstreamMermaid()
  try {
    for (const label of ['`Point1 : (* +=[❤', '`x-axis title', '``Point; next']) {
      const source = `quadrantChart\n"${label}": [1, 0]\n`
      expect(await upstream.publicAccepts(source)).toBe(false)
      const parsed = parseMermaid(source)
      if (!parsed.ok) throw new Error('Quadrant source must remain readable')
      expect(parseQuadrantChart(source.split('\n')).points[0]!.label).toBe(label)
      expect(parsed.value.body.kind).toBe('opaque')
      expect(serializeMermaid(parsed.value)).toBe(source)
      expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'quadrant_text' }))
      expect(mutate(parsed.value, { kind: 'add_point', label: 'Other', x: 0.5, y: 0.5 }).ok).toBe(false)
      const valid = quadrant('quadrantChart\nControl: [0.5, 0.5]')
      expect(mutate(valid, { kind: 'add_point', label, x: 1, y: 0 }).ok).toBe(false)
      expect(synthesizeFromGraph({ kind: 'quadrant', body: { ...valid.body, points: [{ label, x: 1, y: 0 }] } }).ok).toBe(false)
    }
    const control = quadrant('quadrantChart\n`Point: [1, 0]')
    expect(await upstream.publicAccepts(serializeMermaid(control))).toBe(true)
    expect(quadrant(serializeMermaid(control)).body.points[0]!.label).toBe('`Point')
  } finally { upstream.close() }
})

function quadrant(src: string = SRC): QuadrantValidDiagram {
  const r = parseMermaid(src)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  const q = asQuadrant(r.value)
  if (!q) throw new Error('not a structured quadrant: ' + r.value.body.kind)
  return q
}

function apply(d: QuadrantValidDiagram, op: QuadrantMutationOp): QuadrantValidDiagram {
  const r = mutate(d, op)
  if (!r.ok) throw new Error('mutate: ' + JSON.stringify(r.error))
  return r.value
}

test('Quadrant header separators share the direct reader and public routing boundary', async () => {
  const source = 'quadrantChart; A: [0.1, 0.2];; B: [0.3, 0.4];'
  const expected = [{ label: 'A', x: 0.1, y: 0.2 }, { label: 'B', x: 0.3, y: 0.4 }]
  expect(parseQuadrantChart([source]).points).toEqual(expected)
  expect(quadrant(source).body.points).toEqual(expected)
  expect(renderMermaidSVG(source)).toBe(renderMermaidSVG('quadrantChart\nA: [0.1, 0.2]\nB: [0.3, 0.4]'))
  const upstream = startUpstreamMermaid()
  try { expect(await upstream.accepts(source)).toBe(true) }
  finally { upstream.close() }
})

test('semicolon-separated Quadrant statements retain quoted text, styles and editable points', async () => {
  const source = `quadrantChart
title Semicolons; stay in the title
x-axis "Low; reach" --> High; quadrant-1 "Top; right"
classDef hot radius: 8; "A; one":::hot: [0.1, 0.2]; B: [0.3, 0.4] radius: 12; C: [0.6, 0.7]; %% D: [0.9, 0.9]
`
  const diagram = quadrant(source)
  expect(diagram.body.title).toBe('Semicolons; stay in the title')
  expect(diagram.body.xAxis).toEqual({ near: 'Low; reach', far: 'High' })
  expect(diagram.body.quadrants[0]).toBe('Top; right')
  expect(diagram.body.classDefs).toEqual({ hot: { radius: 8 } })
  expect(diagram.body.points).toEqual([
    { label: 'A; one', x: 0.1, y: 0.2, className: 'hot' },
    { label: 'B', x: 0.3, y: 0.4, style: { radius: 12 } },
    { label: 'C', x: 0.6, y: 0.7 },
  ])
  const edited = apply(diagram, { kind: 'rename_point', from: 'B', to: 'Edited; B' })
  const output = serializeMermaid(edited)
  expect(quadrant(output).body).toEqual(edited.body)
  expect(renderMermaidSVG(source)).toContain('A; one')
  expect(renderMermaidASCII(source)).toContain('A; one')
  const upstream = startUpstreamMermaid()
  try {
    expect(await upstream.accepts(source)).toBe(true)
    expect(await upstream.accepts(output)).toBe(true)
    expect(await upstream.project(output, value => value.db.getQuadrantData().points.map((point: { text: { text: string } }) => point.text.text).sort()))
      .toEqual({ ok: true, value: ['A; one', 'C', 'Edited; B'] })
  } finally { upstream.close() }
})

describe('quadrant structured parse', () => {
  test('quotes leading minus and semicolon text through editing and portable reload', async () => {
    const source = 'quadrantChart\n  x-axis - --> High\n  y-axis Low --> ;\n  quadrant-2 A;B\n  -point: [0.2, 0.8]\n'
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(false)
      const original = quadrant(source)
      const edited = apply(apply(original, { kind: 'set_axis_labels', axis: 'x', near: '-low', far: 'high;end' }), { kind: 'rename_point', from: '-point', to: 'point;edited' })
      for (const diagram of [original, edited]) {
        const output = serializeMermaid(diagram)
        expect(await upstream.accepts(output)).toBe(true)
        expect(quadrant(output).body).toEqual(diagram.body)
        expect(serializeMermaid(quadrant(output))).toBe(output)
      }
      const projected = await upstream.project(serializeMermaid(edited), diagram => {
        const data = diagram.db.getQuadrantData()
        return { axes: data.axisLabels.map((label: { text: string }) => label.text), quadrant: data.quadrants[1].text.text, point: data.points[0].text.text }
      })
      expect(projected).toEqual({ ok: true, value: { axes: ['-low', 'high;end', 'Low', ';'], quadrant: 'A;B', point: 'point;edited' } })
      expect(renderMermaidSVG(serializeMermaid(original))).toBe(renderMermaidSVG(source))
      expect(renderMermaidASCII(serializeMermaid(original))).toBe(renderMermaidASCII(source))
      expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'quadrant_unquoted_text' }))
    } finally { upstream.close() }
  })

  test('writes unitless integer stroke widths as exact pixel widths', async () => {
    const source = 'quadrantChart\n  A: [0.2, 0.8] stroke-color: #fff, stroke-width: 0\n  B:::accent: [0.7, 0.3] stroke-width: 1\n  classDef accent radius: 10, color: #f90, stroke-color: #abc, stroke-width: 10\n'
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(false)
      const diagram = quadrant(source)
      expect(diagram.body.points[0]!.style?.strokeWidth).toBe('0px')
      expect(diagram.body.points[1]!.style?.strokeWidth).toBe('1px')
      expect(diagram.body.classDefs!.accent!.strokeWidth).toBe('10px')
      const edited = apply(diagram, { kind: 'move_point', label: 'B', x: 0.6, y: 0.4 })
      for (const candidate of [diagram, edited]) {
        const output = serializeMermaid(candidate)
        expect(await upstream.accepts(output)).toBe(true)
        expect(quadrant(output).body).toEqual(candidate.body)
      }
      expect(await upstream.project(serializeMermaid(edited), value => Object.fromEntries(value.db.getQuadrantData().points.map((point: { text: { text: string }; strokeWidth: string }) => [point.text.text, point.strokeWidth]))))
        .toEqual({ ok: true, value: { A: '0px', B: '1px' } })
      // SVG accepts both spellings in user units. Only the unit spelling changes.
      const pixelWidths = (svg: string) => normalizeSvg(svg.replace(/stroke-width="(\d+)"/g, 'stroke-width="$1px"'), { maskStyleScope: true })
      expect(pixelWidths(renderMermaidSVG(serializeMermaid(diagram)))).toBe(pixelWidths(renderMermaidSVG(source)))
      expect(renderMermaidASCII(serializeMermaid(diagram))).toBe(renderMermaidASCII(source))
      expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'quadrant_stroke_width' }))
    } finally { upstream.close() }
  })
  test.each([
    ['x-axis "Left --> literal"', { near: 'Left --> literal' }],
    ['x-axis "Left --> literal" --> "Right --> literal"', { near: 'Left --> literal', far: 'Right --> literal' }],
    ['x-axis "Left --> literal" -->', { near: 'Left --> literal ⟶ ' }],
  ])('keeps quoted axis delimiters as text: %s', async (axis, expected) => {
    const diagram = quadrant(`quadrantChart\n  ${axis}`)
    expect(diagram.body.xAxis).toEqual(expected)
    const serialized = serializeMermaid(diagram)
    expect(quadrant(serialized).body.xAxis).toEqual(expected)
    const upstream = startUpstreamMermaid()
    try { expect(await upstream.accepts(serialized)).toBe(true) }
    finally { upstream.close() }
  })

  test('keeps reserved grammar words quoted in axis labels after edits', async () => {
    const upstream = startUpstreamMermaid()
    try {
      const diagram = quadrant('quadrantChart\n  x-axis "x-axis-1" --> "x-axis-2"\n  y-axis "title low" --> "quadrant-1 high"\n  A: [0.5, 0.5]')
      for (const candidate of [diagram, apply(diagram, { kind: 'set_axis_labels', axis: 'x', near: 'y-axis low', far: 'classDef high' })]) {
        const serialized = serializeMermaid(candidate)
        expect(await upstream.accepts(serialized)).toBe(true)
        expect(quadrant(serialized).body).toEqual(candidate.body)
        expect(serializeMermaid(quadrant(serialized))).toBe(serialized)
      }
    } finally { upstream.close() }
  })

  test('keeps distinct class definition and reference spellings through edits and reload', async () => {
    const source = 'quadrantChart\n  A:::constructor: [0.2, 0.8]\n  B:::__proto__: [0.7, 0.3]\n  C:::title: [0.4, 0.6]\n  classDef constructor radius: 11\n  classDef a-b radius: 9\n  classDef a-titleOne color: #abc\n  classDef ax-axis color: #def\n'
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
      const original = quadrant(source)
      const edited = apply(apply(original, { kind: 'rename_point', from: 'A', to: 'Renamed' }), { kind: 'move_point', label: 'B', x: 0.6, y: 0.4 })
      for (const diagram of [original, edited]) {
        const output = serializeMermaid(diagram)
        expect(await upstream.accepts(output)).toBe(true)
        expect(quadrant(output).body).toEqual(diagram.body)
        expect(serializeMermaid(quadrant(output))).toBe(output)
        expect(diagram.body.points.map(point => point.className)).toEqual(['constructor', '__proto__', 'title'])
        expect(Object.keys(diagram.body.classDefs!)).toEqual(['constructor', 'a-b', 'a-titleOne', 'ax-axis'])
      }
      expect(await upstream.project(serializeMermaid(edited), value => Object.fromEntries(value.db.getQuadrantData().points.map((point: { text: { text: string }; radius: number }) => [point.text.text, point.radius]))))
        .toEqual({ ok: true, value: { Renamed: 11, B: 5, C: 5 } })
      expect(renderMermaidSVG(serializeMermaid(original))).toBe(renderMermaidSVG(source))
      expect(renderMermaidASCII(serializeMermaid(original))).toBe(renderMermaidASCII(source))
    } finally { upstream.close() }
  })

  test('models title, axes, 1..4 quadrant labels, and [0,1] points', () => {
    const d = quadrant()
    expect(d.kind).toBe('quadrant')
    expect(d.body.title).toBe('Reach and engagement of campaigns')
    expect(d.body.xAxis).toEqual({ near: 'Low Reach', far: 'High Reach' })
    expect(d.body.yAxis).toEqual({ near: 'Low Engagement', far: 'High Engagement' })
    // Mermaid numbering: index n-1 holds quadrant-n.
    expect(d.body.quadrants).toEqual(['We should expand', 'Need to promote', 'Re-evaluate', 'May be improved'])
    expect(d.body.points).toEqual([
      { label: 'Campaign A', x: 0.3, y: 0.6 },
      { label: 'Campaign B', x: 0.45, y: 0.23 },
    ])
  })

  test('axis without a far side and a bare header parse structurally', () => {
    const d = quadrant('quadrantChart\n  x-axis Left\n  A: [0, 1]')
    expect(d.body.xAxis).toEqual({ near: 'Left' })
    expect(d.body.yAxis).toBeUndefined()
    const bare = quadrant('quadrantChart')
    expect(bare.body.points).toHaveLength(0)
    expect(bare.body.quadrants).toEqual([undefined, undefined, undefined, undefined])
  })

  test('round-trips to canonical source and re-parses identically', () => {
    const d = quadrant()
    const out = serializeMermaid(d)
    const d2 = quadrant(out)
    expect(d2.body).toEqual(d.body)
    expect(serializeMermaid(d2)).toBe(out)
  })

  // A "…" string runs across a line break, so the writer keeps the break
  // inside the quotes; a title runs to the end of its line, so its break is
  // written `<br/>`.
  test('serializes parser-normalized line breaks as one Mermaid statement', () => {
    for (const source of [`quadrantChart
  title Reach<br/>map
  x-axis "Low<br/>reach" --> "High<br/>reach"
  quadrant-1 "Do<br/>first"
  "Quick<br/>win": [0.2, 0.8]`, `quadrantChart
  title Reach<br/>map
  x-axis "Low
    reach" --> "High
    reach"
  quadrant-1 "Do
    first"
  "Quick
    win": [0.2, 0.8]`]) {
      const d = quadrant(source)
      expect(d.body).toMatchObject({
        title: 'Reach\nmap',
        xAxis: { near: 'Low\nreach', far: 'High\nreach' },
        quadrants: ['Do\nfirst', undefined, undefined, undefined],
        points: [{ label: 'Quick\nwin', x: 0.2, y: 0.8 }],
      })
      const out = serializeMermaid(d)
      expect(out).toContain('title Reach<br/>map')
      expect(out).toContain('x-axis "Low\nreach" --> "High\nreach"')
      expect(out).toContain('quadrant-1 "Do\nfirst"')
      expect(out).toContain('"Quick\nwin": [0.2, 0.8]')
      expect(quadrant(out).body).toEqual(d.body)
    }
  })
})

describe('quadrant differential vs legacy parseQuadrantChart', () => {
  const samples = [
    SRC,
    'quadrantChart\n  title T\n  x-axis L --> R\n  A: [0.1, 0.9]',
    'quadrantChart\n  quadrant-1 Q1\n  quadrant-3 Q3\n  P: [0.5, 0.5]',
  ]
  for (const [i, src] of samples.entries()) {
    test(`sample ${i}: structured + legacy agree on canonical output`, () => {
      const d = quadrant(src)
      const out = serializeMermaid(d)
      const legacy = parseQuadrantChart(normalizeMermaidSource(out).lines)
      expect(legacy.title).toBe(d.body.title)
      expect(legacy.xAxis).toEqual(d.body.xAxis)
      expect(legacy.yAxis).toEqual(d.body.yAxis)
      expect(legacy.quadrants).toEqual(d.body.quadrants)
      expect(legacy.points).toEqual(d.body.points)
    })
  }
})

describe('quadrant structured-or-opaque fallback', () => {
  test.each([
    ['leading comment marker', 'quadrant-4 "%%["', 'quadrant_text'],
    ['embedded directive marker', 'quadrant-4 "Delet%%{e(* +=[❤"', 'quadrant_text'],
    ['literal double quote', 'x-axis Say "hi"', 'quadrant_text'],
    ['fractional radius', 'A: [0.2, 0.8] radius: 1.5', 'quadrant_style_value'],
    ['fractional width', 'A: [0.2, 0.8] stroke-width: 1.5px', 'quadrant_style_value'],
    ['alpha color', 'A: [0.2, 0.8] color: #ff08', 'quadrant_style_value'],
    ['functional color', 'A: [0.2, 0.8] color: rgb(255, 0, 0)', 'quadrant_style_value'],
    ['variable class paint', 'classDef accent color: var(--brand)\n  A:::accent: [0.2, 0.8]', 'quadrant_style_value'],
    ['unknown class property', 'classDef accent banana: split\n  A:::accent: [0.2, 0.8]', 'quadrant_style_property'],
    ['prototype class definition', 'classDef __proto__ radius: 11\n  A:::__proto__: [0.2, 0.8]', 'quadrant_class_name'],
    ['underscored class definition', 'classDef a_b radius: 11\n  A:::a_b: [0.2, 0.8]', 'quadrant_class_name'],
    ['hyphenated class reference', 'classDef a-b radius: 11\n  A:::a-b: [0.2, 0.8]', 'quadrant_class_name'],
    ['reserved class definition', 'classDef title radius: 11\n  A:::title: [0.2, 0.8]', 'quadrant_class_name'],
    ['reserved class definition suffix', 'classDef a1title radius: 11\n  A:::a1title: [0.2, 0.8]', 'quadrant_class_name'],
    ['reserved class definition prefix', 'classDef x-axisFoo radius: 11\n  A: [0.2, 0.8]', 'quadrant_class_name'],
  ])('preserves %s as source with native output and a portability warning', async (_name, statement, syntax) => {
    const source = `quadrantChart\n  ${statement}\n`
    const upstream = startUpstreamMermaid()
    try { expect(await upstream.accepts(source)).toBe(false) }
    finally { upstream.close() }
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value)).toBe(source)
    expect(renderDiagramSVG(parsed.value)).toBe(renderMermaidSVG(source))
    expect(renderDiagramASCII(parsed.value)).toBe(renderMermaidASCII(source))
    for (const input of [source, parsed.value]) {
      const verdict = verifyMermaid(input)
      expect(verdict.ok).toBe(true)
      expect(verdict.warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax }))
    }
    expect(mutate(parsed.value as QuadrantValidDiagram, { kind: 'set_title', title: 'Changed' }).ok).toBe(false)
  })

  test('refuses unsupported newly supplied text and styles at typed authoring boundaries', () => {
    const diagram = quadrant()
    for (const label of ['%%[', 'Say "hi"', 'Delet%%{e(* +=[❤']) {
      expect(mutate(diagram, { kind: 'set_quadrant_label', quadrant: 1, label }).ok).toBe(false)
      expect(synthesizeFromGraph({ kind: 'quadrant', body: { ...diagram.body, quadrants: [label, undefined, undefined, undefined] } }).ok).toBe(false)
    }
    for (const style of [{ radius: 1.5 }, { color: '#ff08' }, { strokeColor: 'none' }, { strokeWidth: '1.5px' }, { extra: ['banana: split'] }]) {
      expect(synthesizeFromGraph({ kind: 'quadrant', body: { ...diagram.body, points: [{ label: 'A', x: 0.2, y: 0.8, style }] } }).ok).toBe(false)
    }
    for (const name of ['__proto__', 'a_b', 'title', 'a1title', 'x-axisFoo']) {
      const body = { ...diagram.body, classDefs: { [name]: { radius: 11 } } }
      expect(synthesizeFromGraph({ kind: 'quadrant', body }).ok).toBe(false)
      expect(mutate({ ...diagram, body }, { kind: 'set_title', title: 'Changed' }).ok).toBe(false)
    }
    for (const className of ['a-b', 'a--b', 'a-', 'a.b']) {
      const body = { ...diagram.body, points: [{ label: 'A', x: 0.2, y: 0.8, className }] }
      expect(synthesizeFromGraph({ kind: 'quadrant', body }).ok).toBe(false)
      expect(mutate({ ...diagram, body }, { kind: 'move_point', label: 'A', x: 0.3, y: 0.7 }).ok).toBe(false)
    }
  })

  const opaqueCases: Array<[string, string]> = [
    // Well-formed classDef/::: styling is STRUCTURED now (upstream #5173 is
    // modeled — see quadrant-style.test.ts); only MALFORMED styling falls
    // back to opaque, mirroring the legacy parser's loud error. Safe native
    // extensions also stay source-only when the strict writer cannot emit them.
    ['malformed classDef style', 'quadrantChart\n  classDef foo banana: "spl;it"\n  A: [0, 0]'],
    ['class assignment ::: after coords (invalid style tail)', 'quadrantChart\n  A: [0, 0] ::: foo'],
    ['missing brackets', 'quadrantChart\n  A: 0.5, 0.5'],
    ['header EXTRA suffix', 'quadrantChart EXTRA\n  A: [0, 0]'],
  ]
  for (const [name, src] of opaqueCases) {
    test(`${name} falls back to opaque and round-trips verbatim`, () => {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.body.kind).toBe('opaque')
      expect(asQuadrant(r.value)).toBeNull()
      expect(serializeMermaid(r.value).trimEnd()).toBe(src)
    })
  }

  test('universal accessibility stays structured and round-trips through the family serializer', () => {
    const src = 'quadrantChart\n  accTitle: Accessible\n  accDescr: Two-axis map\n  A: [0, 0]'
    const r = parseMermaid(src)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(asQuadrant(r.value)?.body).toMatchObject({
      accessibilityTitle: 'Accessible',
      accessibilityDescription: 'Two-axis map',
    })
    expect(parseMermaid(serializeMermaid(r.value))).toMatchObject({ ok: true, value: { body: { kind: 'quadrant' } } })
  })
})

describe('quadrant mutation ops', () => {
  test('set_title / clear title', () => {
    expect(apply(quadrant(), { kind: 'set_title', title: 'New' }).body.title).toBe('New')
    expect(apply(quadrant(), { kind: 'set_title', title: null }).body.title).toBeUndefined()
  })

  test('set_axis_labels sets, replaces far, and clears axes', () => {
    let d = apply(quadrant(), { kind: 'set_axis_labels', axis: 'x', near: 'A', far: 'B' })
    expect(d.body.xAxis).toEqual({ near: 'A', far: 'B' })
    d = apply(d, { kind: 'set_axis_labels', axis: 'x', near: 'Only' })
    expect(d.body.xAxis).toEqual({ near: 'Only' })
    d = apply(d, { kind: 'set_axis_labels', axis: 'y', near: null })
    expect(d.body.yAxis).toBeUndefined()
  })

  test('set_quadrant_label by 1..4 and clear', () => {
    let d = apply(quadrant(), { kind: 'set_quadrant_label', quadrant: 1, label: 'Top right' })
    expect(d.body.quadrants[0]).toBe('Top right')
    d = apply(d, { kind: 'set_quadrant_label', quadrant: 3, label: null })
    expect(d.body.quadrants[2]).toBeUndefined()
  })

  test('add_point / move_point / rename_point / remove_point', () => {
    let d = apply(quadrant(), { kind: 'add_point', label: 'Campaign C', x: 0.7, y: 0.2 })
    expect(d.body.points).toHaveLength(3)
    expect(d.canonicalSource).toContain('Campaign C: [0.7, 0.2]')
    d = apply(d, { kind: 'move_point', label: 'Campaign C', x: 0.1, y: 0.1 })
    expect(d.body.points.find(p => p.label === 'Campaign C')).toMatchObject({ x: 0.1, y: 0.1 })
    d = apply(d, { kind: 'rename_point', from: 'Campaign C', to: 'Campaign D' })
    expect(d.body.points.map(p => p.label)).toContain('Campaign D')
    d = apply(d, { kind: 'remove_point', label: 'Campaign D' })
    expect(d.body.points).toHaveLength(2)
  })

  test('error paths: not-found, duplicate, range, numbering, syntax-breaking labels', () => {
    const cases: Array<[QuadrantMutationOp, import('../agent/types.ts').MutationError['code']]> = [
      [{ kind: 'remove_point', label: 'Nope' }, 'POINT_NOT_FOUND'],
      [{ kind: 'move_point', label: 'Nope', x: 0, y: 0 }, 'POINT_NOT_FOUND'],
      [{ kind: 'rename_point', from: 'Nope', to: 'X' }, 'POINT_NOT_FOUND'],
      [{ kind: 'add_point', label: 'Campaign A', x: 0, y: 0 }, 'INVALID_OP'],
      [{ kind: 'rename_point', from: 'Campaign A', to: 'Campaign B' }, 'INVALID_OP'],
      [{ kind: 'add_point', label: 'X', x: 1.5, y: 0 }, 'INVALID_OP'],
      [{ kind: 'add_point', label: 'X', x: -0.1, y: 0 }, 'INVALID_OP'],
      [{ kind: 'add_point', label: 'has: colon', x: 0, y: 0 }, 'INVALID_OP'],
      [{ kind: 'add_point', label: 'has [bracket]', x: 0, y: 0 }, 'INVALID_OP'],
      [{ kind: 'set_quadrant_label', quadrant: 0, label: 'X' }, 'INVALID_OP'],
      [{ kind: 'set_quadrant_label', quadrant: 5, label: 'X' }, 'INVALID_OP'],
      [{ kind: 'set_axis_labels', axis: 'x', near: 'has --> arrow' }, 'INVALID_OP'],
    ]
    for (const [op, code] of cases) {
      const r = mutate(quadrant(), op)
      expect({ op: op.kind, ok: r.ok, code: r.ok ? null : r.error.code }).toEqual({ op: op.kind, ok: false, code })
    }
  })

  test('mutation does not alias the input diagram', () => {
    const d = quadrant()
    apply(d, { kind: 'move_point', label: 'Campaign A', x: 0, y: 0 })
    expect(d.body.points[0]).toMatchObject({ x: 0.3, y: 0.6 })
  })
})

describe('quadrant repeated point labels and refused coordinates', () => {
  // Mermaid draws a repeated label as another point. Each point keeps its own
  // identity (A, then A#2, ...), skipping a label the author wrote: here the
  // authored `A#2` keeps its name, so the second A is A#3.
  const REPEATED = 'quadrantChart\n  x-axis Low --> High\n  A: [0.5, 0.5]\n  A: [0.2, 0.9]\n  A#2: [0.8, 0.1]\n'

  test('a repeated label is another drawn, addressable point', async () => {
    const upstream = startUpstreamMermaid()
    try { expect(await upstream.accepts(REPEATED)).toBe(true) }
    finally { upstream.close() }
    const d = quadrant(REPEATED)
    expect(d.body.points.map(p => [p.label, p.x, p.y])).toEqual([['A', 0.5, 0.5], ['A', 0.2, 0.9], ['A#2', 0.8, 0.1]])
    expect(verifyMermaid(REPEATED)).toMatchObject({ ok: true, warnings: [] })
    expect(serializeMermaid(d)).toBe(REPEATED)

    const circles = [...renderMermaidSVG(REPEATED).matchAll(/<circle class="quadrant-point" data-label="([^"]*)" data-x="([^"]*)" data-y="([^"]*)"[^>]*data-id="([^"]*)"/g)]
      .map(([, label, x, y, id]) => ({ label, x, y, id }))
    expect(circles).toEqual([
      { label: 'A', x: '0.5', y: '0.5', id: 'point:A' },
      { label: 'A', x: '0.2', y: '0.9', id: 'point:A#3' },
      { label: 'A#2', x: '0.8', y: '0.1', id: 'point:A#2' },
    ])
    expect(renderMermaidASCII(REPEATED).match(/^● A: .*$/gm)).toEqual(['● A: [0.5, 0.5]', '● A: [0.2, 0.9]'])

    // Typed edits address the same identities the drawing carries.
    const moved = apply(d, { kind: 'move_point', label: 'A#3', x: 0.1, y: 0.1 })
    expect(moved.body.points.map(p => [p.label, p.x, p.y])).toEqual([['A', 0.5, 0.5], ['A', 0.1, 0.1], ['A#2', 0.8, 0.1]])
    expect(apply(d, { kind: 'remove_point', label: 'A' }).body.points.map(p => [p.label, p.x])).toEqual([['A', 0.2], ['A#2', 0.8]])
    expect(apply(d, { kind: 'rename_point', from: 'A#3', to: 'B' }).body.points.map(p => p.label)).toEqual(['A', 'B', 'A#2'])
  })

  // The point statement is modeled and Mermaid rejects these values too, so
  // the source does not parse: no "unmodeled syntax" fallback.
  test.each([
    ['out of range', 'A: [1.3, -0.2]', 'Quadrant point "A" coordinate "1.3" is out of range'],
    ['negative', 'A: [0.5, -0.1]', 'Quadrant point "A" coordinate "-0.1" is out of range'],
    ['non-numeric', 'A: [x, 0]', 'Quadrant point "A" has non-numeric coordinate "x"'],
  ])('a coordinate that is %s is a parse failure with its reason, not unmodeled syntax', (_name, statement, reason) => {
    const source = `quadrantChart\n  x-axis Low --> High\n  ${statement}`
    expect(parseMermaid(source)).toEqual({ ok: false, error: [{ code: 'PARSE_FAILED', message: expect.stringContaining(reason) }] })
    const warnings = verifyMermaid(source).warnings
    expect(warnings).toEqual([{ code: 'RENDER_FAILED', origin: 'source', reason: expect.stringContaining(reason) }])
  })
})

describe('quadrant verify + render', () => {
  test('verify passes on a healthy chart and serializes after the loop', () => {
    const d = apply(quadrant(), { kind: 'add_point', label: 'Campaign C', x: 0.5, y: 0.5 })
    const v = verifyMermaid(d)
    expect(v.ok).toBe(true)
    expect(v.warnings).toHaveLength(0)
    expect(serializeMermaid(d)).toContain('Campaign C: [0.5, 0.5]')
  })

  test('EMPTY_DIAGRAM fires on a header-only (opaque/empty) chart', () => {
    const v = verifyMermaid('quadrantChart')
    expect(v.warnings.map(w => w.code)).toContain('EMPTY_DIAGRAM')
    expect(v.ok).toBe(false)
  })

  test('LABEL_OVERFLOW fires on an over-cap title, axis, quadrant, and point label', () => {
    const long = 'X'.repeat(80)
    expect(verifyMermaid(quadrant(`quadrantChart\n  title ${long}\n  A: [0, 0]`))
      .warnings.find(w => w.code === 'LABEL_OVERFLOW')).toMatchObject({ target: 'title' })
    expect(verifyMermaid(quadrant(`quadrantChart\n  x-axis ${long}\n  A: [0, 0]`))
      .warnings.find(w => w.code === 'LABEL_OVERFLOW')).toBeDefined()
    expect(verifyMermaid(quadrant(`quadrantChart\n  quadrant-1 ${long}\n  A: [0, 0]`))
      .warnings.find(w => w.code === 'LABEL_OVERFLOW')).toBeDefined()
  })

  test('styled Mermaid-docs quadrant parses STRUCTURED, verifies clean, and renders', async () => {
    // Upstream #5173 point styling is modeled end to end now: the official
    // styled example narrows to a typed body (styles preserved as typed
    // fields), verifies with no UNSUPPORTED_SYNTAX, and renders the styles.
    const { renderMermaidSVG, renderMermaidASCII } = await import('../agent/index.ts')
    const src = `quadrantChart
  Campaign A: [0.9, 0.0] radius: 12
  Campaign B:::class1: [0.8, 0.1] color: #ff3300, radius: 10
  classDef class1 color: #109060
`
    const parsed = parseMermaid(src)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.body.kind).toBe('quadrant')
    const q = asQuadrant(parsed.value)!
    expect(q.body.points[0]).toMatchObject({ label: 'Campaign A', style: { radius: 12 } })
    expect(q.body.points[1]).toMatchObject({ label: 'Campaign B', className: 'class1', style: { color: '#ff3300', radius: 10 } })
    expect(q.body.classDefs).toEqual({ class1: { color: '#109060' } })
    // Canonical serialization normalizes style-entry order (radius first), so
    // the contract is round-trip STABILITY, not byte-verbatim of the input.
    const out = serializeMermaid(parsed.value)
    expect(out).toContain('Campaign B:::class1: [0.8, 0.1] radius: 10, color: #ff3300')
    const reparsed = parseMermaid(out)
    expect(reparsed.ok).toBe(true)
    if (reparsed.ok) {
      expect(reparsed.value.body).toEqual(parsed.value.body)
      expect(serializeMermaid(reparsed.value)).toBe(out)
    }
    const verify = verifyMermaid(parsed.value)
    expect(verify.ok).toBe(true)
    expect(verify.warnings.filter(w => w.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
    expect(renderMermaidSVG(parsed.value)).toContain('Campaign B')
    expect(renderMermaidASCII(parsed.value)).toContain('Campaign A')
  })

  test('mutated chart renders through the legacy renderer', async () => {
    const { renderMermaidSVG } = await import('../agent/index.ts')
    const d = apply(quadrant(), { kind: 'set_title', title: 'Rendered' })
    const svg = renderMermaidSVG(d)
    expect(svg).toContain('<svg')
    expect(svg).toContain('Rendered')
  })
})

describe('quadrant corpus round-trip (every testdata sample)', () => {
  // See agent-pie.test.ts for the canonical round-trip-stability contract.
  const TESTDATA = join(import.meta.dir, 'testdata')
  const samples: Array<[string, string]> = []
  for (const variant of ['ascii', 'unicode']) {
    const dir = join(TESTDATA, variant)
    for (const f of readdirSync(dir).filter(n => /^quadrant_/.test(n))) {
      const raw = readFileSync(join(dir, f), 'utf8')
      const src = raw.split(/^---$/m)[0]!.replace(/\n+$/, '\n')
      samples.push([`${variant}/${f}`, src])
    }
  }

  test('at least two quadrant samples are present', () => {
    expect(samples.length).toBeGreaterThanOrEqual(2)
  })

  for (const [name, src] of samples) {
    test(`${name}: parses structured, verifies, round-trips stably`, () => {
      const r = parseMermaid(src)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.body.kind).toBe('quadrant')
      const s1 = serializeMermaid(r.value)
      const r2 = parseMermaid(s1)
      expect(r2.ok).toBe(true)
      if (!r2.ok) return
      expect(serializeMermaid(r2.value)).toBe(s1)
      expect(r2.value.body).toEqual(r.value.body)
    })
  }
})

describe('quadrant round-trip property', () => {
  const labelArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,12}[A-Za-z0-9]$/)
  const axisArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,12}[A-Za-z0-9]$/)
  const coordArb = fc.oneof(
    fc.constantFrom(0, 1, 0.5, 0.25, 0.3, 0.6, 0.45, 0.23, 0.9, 0.1),
    fc.integer({ min: 0, max: 100 }).map(n => n / 100),
  )

  test('parse(serialize(parse(src))) is identity on generated charts', () => {
    fc.assert(
      fc.property(
        fc.option(axisArb, { nil: undefined }),
        fc.uniqueArray(fc.record({ label: labelArb, x: coordArb, y: coordArb }), {
          minLength: 1, maxLength: 5, selector: p => p.label,
        }),
        (title, points) => {
          const lines = ['quadrantChart']
          if (title) lines.push(`  title ${title}`)
          for (const p of points) lines.push(`  ${p.label}: [${p.x}, ${p.y}]`)
          const d = quadrant(lines.join('\n'))
          const expected = { title, points }
          const meaning = (diagram: QuadrantValidDiagram) => ({ title: diagram.body.title, points: diagram.body.points })
          expect(meaning(d)).toEqual(expected)
          const out = serializeMermaid(d)
          const d2 = quadrant(out)
          expect(meaning(d2)).toEqual(expected)
          expect(serializeMermaid(d2)).toBe(out)
        },
      ),
      fcParameters({ numRuns: 50 }),
    )
  })

  test('canonical coordinate format survives 0, 1, and decimals', () => {
    const d = quadrant('quadrantChart\n  a: [0, 1]\n  b: [0.25, 0.5]')
    const out = serializeMermaid(d)
    expect(out).toContain('a: [0, 1]')
    expect(out).toContain('b: [0.25, 0.5]')
    expect(quadrant(out).body.points.map(p => [p.x, p.y])).toEqual([[0, 1], [0.25, 0.5]])
  })
})
