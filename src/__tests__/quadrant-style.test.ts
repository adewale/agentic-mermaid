// ============================================================================
// Quadrant per-point styling + classDef — upstream contract (merged
// mermaid-js/mermaid#5173, documented at mermaid.js.org/syntax/quadrantChart):
//
//   Direct styles on a point:   `Label: [x, y] radius: 12, color: #ff3300,
//                                stroke-color: #10f0f0, stroke-width: 5px`
//   Class definition:           `classDef class1 color: #109060`
//   Class application:          `Label:::class1: [x, y]`
//   Precedence:                 direct styles > class styles > theme defaults.
//
// Before this feature the parser validated and DISCARDED the styles, and any
// `:::`/classDef knocked the agent body opaque. Now styles flow parser →
// layout (one resolution site, src/quadrant/point-style.ts) → renderer, and
// the agent body models them as typed, mutable content.
// ============================================================================

import { describe, it, expect } from 'bun:test'
import { parseQuadrantChart } from '../quadrant/parser.ts'
import { layoutQuadrantChart } from '../quadrant/layout.ts'
import { resolvePointVisual } from '../quadrant/point-style.ts'
import { renderMermaidSVG } from '../index.ts'
import { toMermaidLines, normalizeMermaidSource } from '../mermaid-source.ts'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { asQuadrant } from '../agent/types.ts'

function parse(src: string) {
  return parseQuadrantChart(toMermaidLines(src))
}

// The official upstream docs example (also eval corpus/quadrant/2).
const STYLED = `quadrantChart
  title Reach and engagement of campaigns
  x-axis Low Reach --> High Reach
  y-axis Low Engagement --> High Engagement
  quadrant-1 We should expand
  quadrant-2 Need to promote
  quadrant-3 Re-evaluate
  quadrant-4 May be improved
  Campaign A: [0.9, 0.0] radius: 12
  Campaign B:::class1: [0.8, 0.1] color: #ff3300, radius: 10
  Campaign C: [0.7, 0.2] radius: 25, color: #00ff33, stroke-color: #10f0f0
  Campaign D: [0.6, 0.3] radius: 15, stroke-color: #00ff0f, stroke-width: 5px ,color: #ff33f0
  Campaign E:::class2: [0.5, 0.4]
  Campaign F:::class3: [0.4, 0.5] color: #0000ff
  classDef class1 color: #109060
  classDef class2 color: #908342, radius : 10, stroke-color: #310085, stroke-width: 10px
  classDef class3 color: #f00fff, radius : 10
`

// ---------------------------------------------------------------------------
// Parser — styles and classes are modeled, not discarded
// ---------------------------------------------------------------------------

describe('quadrant parser models point styles and classDefs', () => {
  const chart = parse(STYLED)

  it('keeps commas inside functional colors while splitting top-level entries', () => {
    const chart = parse(`quadrantChart
  RGB: [0.2, 0.8] color: rgb(255, 0, 0), radius: 10, stroke-color: hsl(120, 100%, 50%)
  classDef mixed color: color-mix(in srgb, red 20%, blue)
  Mixed:::mixed: [0.8, 0.2]`)
    expect(chart.points[0]!.style).toMatchObject({ color: 'rgb(255, 0, 0)', radius: 10, strokeColor: 'hsl(120, 100%, 50%)' })
    expect(chart.classDefs.mixed!.color).toBe('color-mix(in srgb, red 20%, blue)')
    const svg = renderMermaidSVG(`quadrantChart
  RGB: [0.2, 0.8] color: rgb(255, 0, 0), radius: 10`)
    expect(svg).toContain('fill:rgb(255, 0, 0)')
  })

  it('rejects unbalanced color functions loudly', () => {
    expect(() => parse('quadrantChart\n  Broken: [0.2, 0.8] color: rgb(1, 2, 3')).toThrow('unbalanced parentheses')
  })

  it('parses direct point styles into typed fields', () => {
    const byLabel = (l: string) => chart.points.find(p => p.label === l)!
    expect(byLabel('Campaign A').style).toEqual({ radius: 12 })
    expect(byLabel('Campaign B').style).toEqual({ color: '#ff3300', radius: 10 })
    expect(byLabel('Campaign C').style).toEqual({ radius: 25, color: '#00ff33', strokeColor: '#10f0f0' })
    expect(byLabel('Campaign D').style).toEqual({ radius: 15, strokeColor: '#00ff0f', strokeWidth: '5px', color: '#ff33f0' })
    expect(byLabel('Campaign E').style).toBeUndefined()
  })

  it('parses ::: class assignments into className', () => {
    const byLabel = (l: string) => chart.points.find(p => p.label === l)!
    expect(byLabel('Campaign B').className).toBe('class1')
    expect(byLabel('Campaign E').className).toBe('class2')
    expect(byLabel('Campaign F').className).toBe('class3')
    expect(byLabel('Campaign A').className).toBeUndefined()
  })

  it('parses classDef lines into the classDefs table (space before colon tolerated)', () => {
    expect(chart.classDefs['class1']).toEqual({ color: '#109060' })
    expect(chart.classDefs['class2']).toEqual({ color: '#908342', radius: 10, strokeColor: '#310085', strokeWidth: '10px' })
    expect(chart.classDefs['class3']).toEqual({ color: '#f00fff', radius: 10 })
  })

  it('keeps the loud-error contract for malformed style metadata', () => {
    // Known keys validate their values; any value with style=""-unsafe
    // characters errors. Unknown keys with SAFE values are upstream-legal
    // and preserved (see the bench-parity suite below), so they no longer
    // throw here.
    expect(() => parse('quadrantChart\n  A: [0.5, 0.5] radius: big')).toThrow(/radius/i)
    expect(() => parse('quadrantChart\n  A: [0.5, 0.5] banana: "spl;it"')).toThrow(/style/i)
    expect(() => parse('quadrantChart\n  A: [0.5, 0.5] color: "x;{}"')).toThrow(/color|style/i)
  })
})

// ---------------------------------------------------------------------------
// Resolution — ONE place, precedence direct > class > default
// ---------------------------------------------------------------------------

describe('quadrant point style resolution', () => {
  const chart = parse(STYLED)
  const defaults = { radius: 6 }

  it('direct styles win over class styles which win over defaults', () => {
    const b = chart.points.find(p => p.label === 'Campaign B')!
    const rb = resolvePointVisual(b, chart.classDefs, defaults)
    expect(rb.fill).toBe('#ff3300') // direct beats classDef class1 color #109060
    expect(rb.radius).toBe(10)

    const f = chart.points.find(p => p.label === 'Campaign F')!
    const rf = resolvePointVisual(f, chart.classDefs, defaults)
    expect(rf.fill).toBe('#0000ff')  // direct color
    expect(rf.radius).toBe(10)       // class radius fills the gap

    const e = chart.points.find(p => p.label === 'Campaign E')!
    const re = resolvePointVisual(e, chart.classDefs, defaults)
    expect(re).toMatchObject({ fill: '#908342', radius: 10, stroke: '#310085', strokeWidth: '10px' })
  })

  it('a point referencing an unknown class resolves to defaults (upstream parity)', () => {
    const chart2 = parse('quadrantChart\n  P:::ghost: [0.5, 0.5]')
    const r = resolvePointVisual(chart2.points[0]!, chart2.classDefs, defaults)
    expect(r.radius).toBe(6)
    expect(r.fill).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Layout — resolved radius drives geometry
// ---------------------------------------------------------------------------

describe('quadrant layout consumes resolved point styles', () => {
  it('positioned radius follows direct/class radius', () => {
    const positioned = layoutQuadrantChart(parse(STYLED))
    const byLabel = (l: string) => positioned.points.find(p => p.label === l)!
    expect(byLabel('Campaign A').radius).toBe(12)
    expect(byLabel('Campaign C').radius).toBe(25)
    expect(byLabel('Campaign E').radius).toBe(10)
  })

  it('unstyled points keep the default radius', () => {
    const positioned = layoutQuadrantChart(parse('quadrantChart\n  P: [0.5, 0.5]'))
    expect(positioned.points[0]!.radius).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// SVG — the rendered attributes match the resolution (invariant gate)
// ---------------------------------------------------------------------------

function circleFor(svg: string, label: string): string {
  const m = svg.match(new RegExp(`<circle[^>]*data-label="${label}"[^>]*/>`))
  expect(m).not.toBeNull()
  return m![0]!
}

describe('quadrant SVG renders point styles', () => {
  const svg = renderMermaidSVG(STYLED)

  it('direct styles reach the circle (fill / radius / stroke)', () => {
    const c = circleFor(svg, 'Campaign C')
    expect(c).toContain('r="25"')
    expect(c).toContain('fill:#00ff33')
    expect(c).toContain('stroke:#10f0f0')
    const d = circleFor(svg, 'Campaign D')
    expect(d).toContain('stroke-width:5px')
  })

  it('a styled point rendered attributes match its classDef', () => {
    const e = circleFor(svg, 'Campaign E')
    expect(e).toContain('r="10"')
    expect(e).toContain('fill:#908342')
    expect(e).toContain('stroke:#310085')
    expect(e).toContain('stroke-width:10px')
  })

  it('class names are emitted as CSS classes so external stylesheets can target them', () => {
    expect(circleFor(svg, 'Campaign B')).toContain('class="quadrant-point class1"')
  })

  it('unstyled points keep the plain themed markup (no style attribute)', () => {
    const plain = renderMermaidSVG('quadrantChart\n  P: [0.5, 0.5]')
    const c = circleFor(plain, 'P')
    expect(c).not.toContain('style=')
    expect(c).toContain('class="quadrant-point"')
  })

  it('is deterministic', () => {
    expect(renderMermaidSVG(STYLED)).toBe(svg)
  })
})

// ---------------------------------------------------------------------------
// Agent surface — styled charts are STRUCTURED, mutable, and round-trip
// ---------------------------------------------------------------------------

describe('quadrant agent body models styles structurally', () => {
  it('the upstream styled example parses to a structured quadrant body', () => {
    const p = parseMermaid(STYLED)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.value.body.kind).toBe('quadrant')
    const q = asQuadrant(p.value)!
    expect(q.body.points.find(pt => pt.label === 'Campaign B')).toMatchObject({
      className: 'class1', style: { color: '#ff3300', radius: 10 },
    })
    expect(q.body.classDefs?.['class2']).toEqual({ color: '#908342', radius: 10, strokeColor: '#310085', strokeWidth: '10px' })
  })

  it('serializes canonically and re-parses identically (structured + legacy differential)', () => {
    const p = parseMermaid(STYLED)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const out = serializeMermaid(p.value)
    const p2 = parseMermaid(out)
    expect(p2.ok).toBe(true)
    if (!p2.ok) return
    expect(p2.value.body).toEqual(p.value.body)
    expect(serializeMermaid(p2.value)).toBe(out)
    // Differential: the legacy renderer parser reads the canonical output the
    // same way (P3: a succeeding serialize must round-trip through render-parse).
    const legacy = parseQuadrantChart(normalizeMermaidSource(out).lines)
    const q = asQuadrant(p.value)!
    expect(legacy.points.map(pt => ({ label: pt.label, className: pt.className, style: pt.style })))
      .toEqual(q.body.points.map(pt => ({ label: pt.label, className: pt.className, style: pt.style })))
    expect(legacy.classDefs).toEqual(q.body.classDefs ?? {})
  })

  it('mutation ops preserve classes and styles on untouched fields', () => {
    const p = parseMermaid(STYLED)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const q = asQuadrant(p.value)!
    const moved = mutate(q, { kind: 'move_point', label: 'Campaign B', x: 0.1, y: 0.9 })
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(moved.value.body.points.find(pt => pt.label === 'Campaign B')).toMatchObject({
      x: 0.1, y: 0.9, className: 'class1', style: { color: '#ff3300', radius: 10 },
    })
    const renamed = mutate(moved.value, { kind: 'rename_point', from: 'Campaign B', to: 'Campaign Z' })
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(renamed.value.body.points.find(pt => pt.label === 'Campaign Z')).toMatchObject({
      className: 'class1', style: { color: '#ff3300', radius: 10 },
    })
    expect(renamed.value.canonicalSource).toContain('Campaign Z:::class1:')
  })

  it('verifies clean: no UNSUPPORTED_SYNTAX for modeled styling', () => {
    const p = parseMermaid(STYLED)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const v = verifyMermaid(p.value)
    expect(v.ok).toBe(true)
    expect(v.warnings.filter(w => w.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
  })

  it('malformed style tails still fall back to opaque (loud render error preserved)', () => {
    const p = parseMermaid('quadrantChart\n  A: [0, 0] ::: foo')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.value.body.kind).toBe('opaque')
    // A value with characters unsafe for a style="" attribute stays malformed.
    const bad = parseMermaid('quadrantChart\n  A: [0, 0] banana: "spl;it"')
    expect(bad.ok).toBe(true)
    if (!bad.ok) return
    expect(bad.value.body.kind).toBe('opaque')
  })
})

// Upstream's jison grammar accepts ANY `key: value` style entry and applies
// only the four point properties — its own parser suite pins `classDef
// constructor fill:#ff0000` as valid input. Unknown-but-safe entries are
// therefore preserved verbatim (lossless round-trip), inert in render
// (upstream behavior), and named by a Tier-3 diagnostic (P4: documented
// limitation ⇒ runtime warning). `constructor`/`__proto__` are legal class
// names per CLASS_NAME_RE, so the classDef table must not leak or pollute
// Object.prototype.
describe('unknown style properties and hostile class names (upstream bench parity)', () => {
  const UPSTREAM = 'quadrantChart\n    classDef constructor fill:#ff0000\n    Microsoft:::constructor: [0.75, 0.75]'

  it('upstream constructor-classname source parses structured and verifies ok', () => {
    const p = parseMermaid(UPSTREAM)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.value.body.kind).toBe('quadrant')
    const v = verifyMermaid(p.value)
    expect(v.ok).toBe(true)
    const inert = v.warnings.filter(w => w.code === 'UNSUPPORTED_SYNTAX' && w.syntax === 'quadrant_style_property')
    expect(inert.length).toBe(1)
    expect((inert[0] as { message: string }).message).toContain('"fill"')
  })

  it('unknown properties survive serialize → re-parse verbatim (lossless)', () => {
    const p = parseMermaid(UPSTREAM)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const s = serializeMermaid(p.value)
    expect(s).toContain('fill: #ff0000')
    const rp = parseMermaid(s)
    expect(rp.ok).toBe(true)
    if (!rp.ok) return
    expect(rp.value.body.kind).toBe('quadrant')
    expect(serializeMermaid(rp.value)).toBe(s)
  })

  it('unknown properties are inert in render (never reach the style attribute)', () => {
    const svg = renderMermaidSVG(UPSTREAM)
    expect(svg).toContain('Microsoft')
    expect(svg).not.toContain('#ff0000')
  })

  it('classDef named __proto__ does not pollute Object.prototype and still applies', () => {
    const chart = parseQuadrantChart(toMermaidLines('quadrantChart\n  classDef __proto__ radius: 11\n  A:::__proto__: [0.5, 0.5]'))
    expect(({} as { radius?: number }).radius).toBeUndefined()
    const visual = resolvePointVisual(chart.points[0]!, chart.classDefs, { radius: 5 })
    expect(visual.radius).toBe(11)
  })

  it('className constructor with no classDef resolves to defaults, not Object.prototype', () => {
    const chart = parseQuadrantChart(toMermaidLines('quadrantChart\n  A:::constructor: [0.5, 0.5]'))
    const visual = resolvePointVisual(chart.points[0]!, chart.classDefs, { radius: 5 })
    expect(visual).toEqual({ radius: 5 })
  })

  it('well-formed unknown entries on a point stay structured with the style preserved', () => {
    const p = parseMermaid('quadrantChart\n  A: [0.2, 0.2] banana: split')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.value.body.kind).toBe('quadrant')
    expect(serializeMermaid(p.value)).toContain('banana: split')
  })
})
