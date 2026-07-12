// ============================================================================
// Quadrant chart tests — parser unit, geometry, SVG integration, properties,
// and the agent surface (BUILD-11).
//
// The quadrant family models Mermaid quadrantChart syntax:
//   quadrantChart
//   title T
//   x-axis <left> --> <right>
//   y-axis <bottom> --> <top>
//   quadrant-1..4 <label>      (1=TR, 2=TL, 3=BL, 4=BR)
//   <Label>: [x, y]            x,y in [0,1]
//
// Faithfulness contract: malformed lines ERROR LOUDLY, never silently drop.
// ============================================================================

import { describe, it, expect } from 'bun:test'
import fc from 'fast-check'
import { parseQuadrantChart } from '../quadrant/parser.ts'
import { layoutQuadrantChart } from '../quadrant/layout.ts'
import { renderMermaidSVG, renderMermaidASCII } from '../index.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { parseMermaid } from '../agent/parse.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { asJourney, asArchitecture } from '../agent/types.ts'
import { measureTextWidth } from '../text-metrics.ts'

function parse(src: string) {
  return parseQuadrantChart(toMermaidLines(src))
}

const CLASSIC = `quadrantChart
    title Reach and engagement of campaigns
    x-axis Low Reach --> High Reach
    y-axis Low Engagement --> High Engagement
    quadrant-1 We should expand
    quadrant-2 Need to promote
    quadrant-3 Re-evaluate
    quadrant-4 May be improved
    Campaign A: [0.3, 0.6]
    Campaign B: [0.45, 0.23]
    Campaign C: [0.57, 0.69]
    Campaign D: [0.78, 0.34]`

// ---------------------------------------------------------------------------
// Parser — happy paths (table-driven, every statement type)
// ---------------------------------------------------------------------------

describe('quadrant parser — happy paths', () => {
  it('parses the classic campaign example fully', () => {
    const chart = parse(CLASSIC)
    expect(chart.title).toBe('Reach and engagement of campaigns')
    expect(chart.xAxis).toEqual({ near: 'Low Reach', far: 'High Reach' })
    expect(chart.yAxis).toEqual({ near: 'Low Engagement', far: 'High Engagement' })
    expect(chart.quadrants).toEqual([
      'We should expand', 'Need to promote', 'Re-evaluate', 'May be improved',
    ])
    expect(chart.points).toHaveLength(4)
    expect(chart.points[0]).toEqual({ label: 'Campaign A', x: 0.3, y: 0.6 })
  })

  it('x-axis with only the left label (far optional)', () => {
    const chart = parse('quadrantChart\n  x-axis Just Left')
    expect(chart.xAxis).toEqual({ near: 'Just Left' })
    expect(chart.xAxis!.far).toBeUndefined()
  })

  it('y-axis with only the bottom label (top optional)', () => {
    const chart = parse('quadrantChart\n  y-axis Just Bottom')
    expect(chart.yAxis).toEqual({ near: 'Just Bottom' })
  })

  it('boundary coordinates 0 and 1 are valid', () => {
    const chart = parse('quadrantChart\n  Origin: [0, 0]\n  Corner: [1, 1]')
    expect(chart.points).toEqual([
      { label: 'Origin', x: 0, y: 0 },
      { label: 'Corner', x: 1, y: 1 },
    ])
  })

  it('label with spaces and punctuation parses', () => {
    const chart = parse('quadrantChart\n  My Cool Point #1: [0.5, 0.5]')
    expect(chart.points[0]!.label).toBe('My Cool Point #1')
  })

  it('accepts Mermaid-docs point style metadata and classDef lines without blocking render', () => {
    const chart = parse(`quadrantChart
  Campaign A: [0.9, 0.0] radius: 12
  Campaign B:::class1: [0.8, 0.1] color: #ff3300, radius: 10
  Campaign C: [0.7, 0.2] radius: 25, color: #00ff33, stroke-color: #10f0f0
  Campaign D: [0.6, 0.3] radius: 15, stroke-color: #00ff0f, stroke-width: 5px ,color: #ff33f0
  classDef class1 color: #109060
`)
    expect(chart.points.map(p => p.label)).toEqual(['Campaign A', 'Campaign B', 'Campaign C', 'Campaign D'])
    expect(chart.points[1]).toMatchObject({ x: 0.8, y: 0.1 })
  })

  it('preserves point source order', () => {
    const chart = parse('quadrantChart\n  C: [0.1,0.1]\n  A: [0.2,0.2]\n  B: [0.3,0.3]')
    expect(chart.points.map(p => p.label)).toEqual(['C', 'A', 'B'])
  })
})

// ---------------------------------------------------------------------------
// Parser — sad paths (loud errors, never silent drops)
// ---------------------------------------------------------------------------

describe('quadrant parser — sad paths error loudly', () => {
  const bad: Array<{ name: string; src: string; match: RegExp }> = [
    { name: 'x coord > 1', src: 'quadrantChart\n  A: [1.5, 0.5]', match: /out of range/i },
    { name: 'y coord < 0', src: 'quadrantChart\n  A: [0.5, -0.2]', match: /out of range/i },
    { name: 'non-numeric coord', src: 'quadrantChart\n  A: [foo, 0.5]', match: /non-numeric/i },
    { name: 'missing brackets', src: 'quadrantChart\n  A: 0.5, 0.5', match: /Invalid quadrant point/i },
    { name: 'unclosed bracket', src: 'quadrantChart\n  A: [0.5, 0.5', match: /Invalid quadrant point/i },
    { name: 'wrong header', src: 'notquadrant\n  A: [0.5, 0.5]', match: /must start with "quadrantChart"/i },
    { name: 'unknown statement', src: 'quadrantChart\n  banana split', match: /Unrecognized quadrant chart line/i },
    // Unknown keys with SAFE values are upstream-legal (preserved verbatim,
    // inert in render — see quadrant-style.test.ts); only unsafe values err.
    { name: 'unknown point style metadata with unsafe value', src: 'quadrantChart\n  A: [0.5, 0.5] banana: "spl;it"', match: /style/i },
    { name: 'x-axis arrow but no far label', src: 'quadrantChart\n  x-axis Left -->', match: /no far label/i },
  ]

  for (const b of bad) {
    it(b.name, () => {
      expect(() => parse(b.src)).toThrow(b.match)
    })
  }

  it('duplicate point labels error loudly', () => {
    expect(() => parse('quadrantChart\n  A: [0.1, 0.1]\n  A: [0.9, 0.9]')).toThrow(/Duplicate/i)
  })

  it('a malformed point in the middle aborts the whole parse', () => {
    expect(() => parse('quadrantChart\n  A: [0.1,0.1]\n  B: [2,0.2]\n  C: [0.3,0.3]')).toThrow(/out of range/i)
  })
})

// ---------------------------------------------------------------------------
// Geometry — a point per quadrant lands in the right pixel region
// ---------------------------------------------------------------------------

describe('quadrant accessibility metadata', () => {
  it('preserves line and block directives through layout and renders resolvable escaped ARIA metadata', () => {
    const source = `quadrantChart
  accTitle: Safe <title>&
  accDescr {
    First line
    Second <tag>&
  }
  Point: [0.5, 0.5]`
    const parsed = parseQuadrantChart(toMermaidLines(source))
    expect(parsed.accessibility).toEqual({ title: 'Safe <title>&', description: 'First line\nSecond <tag>&' })
    expect(layoutQuadrantChart(parsed).accessibility).toEqual(parsed.accessibility)
    const svg = renderMermaidSVG(source)
    const titleId = /aria-labelledby="([^"]+)"/.exec(svg)?.[1]
    const descId = /aria-describedby="([^"]+)"/.exec(svg)?.[1]
    expect(titleId).toBeDefined()
    expect(descId).toBeDefined()
    expect(svg).toContain(`<title id="${titleId}">Safe &lt;title&gt;&amp;</title>`)
    expect(svg).toContain(`<desc id="${descId}">First line\nSecond &lt;tag&gt;&amp;</desc>`)
    expect(renderMermaidSVG(source)).toBe(svg)
  })
})

describe('quadrant geometry', () => {
  // Build a chart with one point dead-center of each quadrant region.
  const src = `quadrantChart
    Q1: [0.75, 0.75]
    Q2: [0.25, 0.75]
    Q3: [0.25, 0.25]
    Q4: [0.75, 0.25]`
  const positioned = layoutQuadrantChart(parse(src))
  const plot = positioned.plot
  const midX = plot.x + plot.size / 2
  const midY = plot.y + plot.size / 2
  const byLabel = (l: string) => positioned.points.find(p => p.label === l)!

  it('point [0.9, 0.9] lands in quadrant 1 (top-right) region', () => {
    const p = layoutQuadrantChart(parse('quadrantChart\n  P: [0.9, 0.9]')).points[0]!
    // top-right: cx beyond center-x, cy above center-y (smaller pixel y).
    expect(p.cx).toBeGreaterThan(midX)
    expect(p.cy).toBeLessThan(midY)
    // and inside the plot bounds
    expect(p.cx).toBeLessThanOrEqual(plot.x + plot.size)
    expect(p.cy).toBeGreaterThanOrEqual(plot.y)
  })

  it('Q1 (top-right): cx > midX and cy < midY', () => {
    const p = byLabel('Q1')
    expect(p.cx).toBeGreaterThan(midX)
    expect(p.cy).toBeLessThan(midY)
    expect(p.cx).toBeLessThanOrEqual(plot.x + plot.size)
  })

  it('Q2 (top-left): cx < midX and cy < midY', () => {
    const p = byLabel('Q2')
    expect(p.cx).toBeLessThan(midX)
    expect(p.cy).toBeLessThan(midY)
    expect(p.cx).toBeGreaterThanOrEqual(plot.x)
  })

  it('Q3 (bottom-left): cx < midX and cy > midY', () => {
    const p = byLabel('Q3')
    expect(p.cx).toBeLessThan(midX)
    expect(p.cy).toBeGreaterThan(midY)
    expect(p.cy).toBeLessThanOrEqual(plot.y + plot.size)
  })

  it('Q4 (bottom-right): cx > midX and cy > midY', () => {
    const p = byLabel('Q4')
    expect(p.cx).toBeGreaterThan(midX)
    expect(p.cy).toBeGreaterThan(midY)
    expect(p.cy).toBeLessThanOrEqual(plot.y + plot.size)
  })

  it('long axis labels wrap within their half-plot budgets without overprinting', () => {
    const nearX = 'Low reach for early discovery experiments and interviews across regions'
    const farX = 'High reach for globally launched campaigns with sustained distribution'
    const nearY = 'Low engagement from passive evaluation without a committed owner'
    const farY = 'High engagement from active teams shipping verified outcomes every week'
    const source = `quadrantChart
      x-axis ${nearX} --> ${farX}
      y-axis ${nearY} --> ${farY}
      Candidate: [0.5, 0.5]`
    const parsed = parse(source)
    expect(parsed.xAxis).toEqual({ near: nearX, far: farX })
    expect(parsed.yAxis).toEqual({ near: nearY, far: farY })

    const chart = layoutQuadrantChart(parsed)
    const budget = chart.plot.size / 2 - 12
    expect(chart.axisLabels).toHaveLength(4)
    expect(chart.axisLabels.some(axis => axis.text.includes('\n'))).toBe(true)
    for (const axis of chart.axisLabels) {
      const lines = axis.text.split('\n')
      expect(lines.length).toBeLessThanOrEqual(2)
      const width = Math.max(...lines.map(line => measureTextWidth(line, axis.fontSize, 500)))
      expect(width).toBeLessThanOrEqual(budget + 0.01)
      if (axis.x >= chart.plot.x) {
        if (axis.anchor === 'start') expect(axis.x + width).toBeLessThan(chart.plot.x + chart.plot.size / 2)
        if (axis.anchor === 'end') expect(axis.x - width).toBeGreaterThan(chart.plot.x + chart.plot.size / 2)
      } else {
        if (axis.anchor === 'start') expect(axis.y - width).toBeGreaterThan(chart.plot.y + chart.plot.size / 2)
        if (axis.anchor === 'end') expect(axis.y + width).toBeLessThan(chart.plot.y + chart.plot.size / 2)
      }
    }
    const svg = renderMermaidSVG(source)
    expect(svg.match(/<tspan /g)?.length ?? 0).toBeGreaterThanOrEqual(4)
    expect(svg).toContain('class="quadrant-axis-label"')
  })

  it('region numbering: quadrant 1 sits top-right, 3 bottom-left', () => {
    const r1 = positioned.regions.find(r => r.number === 1)!
    const r3 = positioned.regions.find(r => r.number === 3)!
    expect(r1.x).toBeGreaterThanOrEqual(midX - 0.01)
    expect(r1.y).toBeLessThan(midY)
    expect(r3.x).toBeLessThan(midX)
    expect(r3.y).toBeGreaterThanOrEqual(midY - 0.01)
  })
})

// ---------------------------------------------------------------------------
// SVG integration
// ---------------------------------------------------------------------------

describe('quadrant SVG integration', () => {
  it('renders an <svg> with four quadrant rects, one circle per point, and labels', () => {
    const svg = renderMermaidSVG(CLASSIC)
    expect(svg).toContain('<svg')
    const rectCount = (svg.match(/class="quadrant-region"/g) ?? []).length
    expect(rectCount).toBe(4)
    const circleCount = (svg.match(/class="quadrant-point"/g) ?? []).length
    expect(circleCount).toBe(4)
    for (const label of ['Campaign A', 'We should expand', 'Low Reach', 'High Engagement']) {
      expect(svg).toContain(label)
    }
  })

  it('renders official point style/class metadata examples without throwing', () => {
    const styled = `quadrantChart
  title Reach and engagement of campaigns
  x-axis Low Reach --> High Reach
  y-axis Low Engagement --> High Engagement
  Campaign A: [0.9, 0.0] radius: 12
  Campaign B:::class1: [0.8, 0.1] color: #ff3300, radius: 10
  Campaign C: [0.7, 0.2] radius: 25, color: #00ff33, stroke-color: #10f0f0
  classDef class1 color: #109060
`
    const svg = renderMermaidSVG(styled)
    expect(svg).toContain('Campaign A')
    expect(svg).toContain('Campaign B')
    expect(renderMermaidASCII(styled)).toContain('Campaign C')
  })

  it('is deterministic — two renders are byte-identical', () => {
    expect(renderMermaidSVG(CLASSIC)).toBe(renderMermaidSVG(CLASSIC))
  })

  it('has no nondeterminism across many renders', () => {
    const first = renderMermaidSVG(CLASSIC)
    for (let i = 0; i < 5; i++) expect(renderMermaidSVG(CLASSIC)).toBe(first)
  })

  it('ASCII renders a bordered grid with point glyphs and a legend', () => {
    const out = renderMermaidASCII(CLASSIC, { useAscii: true, colorMode: 'none' })
    expect(out).toContain('+')
    expect(out).toContain('*')
    expect(out).toContain('Campaign A: [0.3, 0.6]')
    // unicode mode differs (box-drawing + ● glyph)
    const uni = renderMermaidASCII(CLASSIC, { useAscii: false, colorMode: 'none' })
    expect(uni).not.toBe(out)
    expect(uni).toContain('●')
  })
})

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('quadrant property tests', () => {
  const labelArb = fc.stringMatching(/^[A-Za-z0-9 ]{1,10}$/).map(s => s.trim()).filter(s => s.length > 0)
  const coordArb = fc.integer({ min: 0, max: 100 }).map(n => n / 100)
  const pointArb = fc.tuple(labelArb, coordArb, coordArb)
  const pointsArb = fc.array(pointArb, { minLength: 1, maxLength: 8 })

  it('every label appears once; rendered coords are in plot bounds; quadrant assignment matches math', () => {
    fc.assert(
      fc.property(pointsArb, (points) => {
        // De-dupe labels (parser rejects duplicates).
        const seen = new Set<string>()
        const unique = points.filter(([l]) => (seen.has(l) ? false : (seen.add(l), true)))
        const src = 'quadrantChart\n' + unique.map(([l, x, y]) => `  ${l}: [${x}, ${y}]`).join('\n')
        const chart = parseQuadrantChart(toMermaidLines(src))
        const positioned = layoutQuadrantChart(chart)
        const plot = positioned.plot
        const midX = plot.x + plot.size / 2
        const midY = plot.y + plot.size / 2

        expect(positioned.points).toHaveLength(unique.length)

        for (const pp of positioned.points) {
          // within plot bounds (small epsilon for rounding)
          expect(pp.cx).toBeGreaterThanOrEqual(plot.x - 0.01)
          expect(pp.cx).toBeLessThanOrEqual(plot.x + plot.size + 0.01)
          expect(pp.cy).toBeGreaterThanOrEqual(plot.y - 0.01)
          expect(pp.cy).toBeLessThanOrEqual(plot.y + plot.size + 0.01)

          // rendered quadrant matches mathematical quadrant (skip exact-center)
          if (pp.nx !== 0.5 && pp.ny !== 0.5) {
            const mathRight = pp.nx > 0.5
            const mathTop = pp.ny > 0.5
            const renderRight = pp.cx > midX
            const renderTop = pp.cy < midY
            expect(renderRight).toBe(mathRight)
            expect(renderTop).toBe(mathTop)
          }
        }

        const svg = renderMermaidSVG(src)
        for (const [label] of unique) {
          expect(svg).toContain(label)
        }
      }),
      { numRuns: 60 },
    )
  })
})

// ---------------------------------------------------------------------------
// Agent surface — opaque round-trip, narrowers null, capabilities, verify
// ---------------------------------------------------------------------------

describe('quadrant agent surface', () => {
  it('parses to a structured body of kind quadrant', () => {
    const p = parseMermaid(CLASSIC)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.value.kind).toBe('quadrant')
    // Promoted to structured-when-narrowed: the modeled subset parses to a
    // typed QuadrantBody (not opaque). See src/agent/quadrant-body.ts.
    expect(p.value.body.kind).toBe('quadrant')
  })

  it('asJourney and asArchitecture return null on a quadrant diagram', () => {
    const p = parseMermaid(CLASSIC)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(asJourney(p.value)).toBeNull()
    expect(asArchitecture(p.value)).toBeNull()
  })

  it('round-trips to stable canonical source through serialize', () => {
    // Structured bodies normalize to canonical (2-space) source, so the
    // contract is canonical round-trip STABILITY, not verbatim of the
    // 4-space-indented original.
    const p = parseMermaid(CLASSIC)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const s1 = serializeMermaid(p.value)
    const p2 = parseMermaid(s1)
    expect(p2.ok).toBe(true)
    if (!p2.ok) return
    expect(serializeMermaid(p2.value)).toBe(s1)
    expect(p2.value.body).toEqual(p.value.body)
  })

  it('verify extracts labels and fires LABEL_OVERFLOW on a long quadrant label', () => {
    const long = 'X'.repeat(80)
    const src = `quadrantChart\n  quadrant-1 ${long}\n  A: [0.5, 0.5]`
    const p = parseMermaid(src)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const v = verifyMermaid(p.value)
    const overflow = v.warnings.filter(w => w.code === 'LABEL_OVERFLOW')
    expect(overflow.length).toBeGreaterThan(0)
  })

  it('short labels do not trigger LABEL_OVERFLOW', () => {
    const p = parseMermaid(CLASSIC)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const v = verifyMermaid(p.value)
    expect(v.warnings.filter(w => w.code === 'LABEL_OVERFLOW')).toEqual([])
  })
})
