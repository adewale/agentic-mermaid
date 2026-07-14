// ============================================================================
// Pie family elevation — on-slice percentage labels (upstream parity since
// 2020, mermaid-js/mermaid#1027), donut mode + legend position (upstream
// v11.16.0, PR #7760), pie config/themeVariables wire-or-warn, and the
// hue-spread palette at high slice counts.
//
// Upstream contract verified against mermaid.js.org/syntax/pie.html,
// packages/mermaid/src/diagrams/pie/pieRenderer.ts and config.schema.yaml:
//   - on-slice text: ((value/sum)*100).toFixed(0) + '%', placed at the arc
//     centroid of a zero-thickness arc at radius * textPosition (default 0.75)
//   - slices whose label would read "0%" carry no on-slice label (upstream
//     drops sub-1% slices entirely; we keep the wedge and only suppress the
//     label — divergence documented in docs/design/families/pie.md)
//   - pie config: textPosition (0..1), donutHole (0..0.9, invalid → 0),
//     legendPosition (top|bottom|left|right|center, default right),
//     highlightSlice (wired: static non-geometric emphasis — Option D)
//   - theme variables: pie1..pie12 fills (honored in SOURCE order — upstream
//     itself broke this, #5314), pieStrokeColor/pieStrokeWidth/pieOpacity on
//     slices, pieOuterStrokeWidth/pieOuterStrokeColor as the outer circle,
//     pieSectionTextSize/pieSectionTextColor on the on-slice labels
//
// These tests are the invariant gates that accompany the pie golden updates
// (P5: snapshots pin; invariants judge).
// ============================================================================

import { describe, it, expect } from 'bun:test'
import fc from 'fast-check'
import { parsePieChart } from '../pie/parser.ts'
import { layoutPieChart, formatPiePercent } from '../pie/layout.ts'
import type { PositionedPieChart } from '../pie/types.ts'
import { resolvePieVisualConfig, DEFAULT_PIE_VISUAL_CONFIG } from '../pie/config.ts'
import type { PieVisualConfig } from '../pie/config.ts'
import { pieSliceColors } from '../pie/palette.ts'
import { hexToHsl } from '../xychart/colors.ts'
import { wcagContrastRatio } from '../shared/color-math.ts'
import { renderMermaidSVG, renderMermaidASCII } from '../index.ts'
import { parseMermaid } from '../agent/parse.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { measureTextWidth } from '../text-metrics.ts'
import { toMermaidLines } from '../mermaid-source.ts'

const LEGEND_FONT = { size: 13, weight: 500 }
const LEGEND_LINE_HEIGHT = LEGEND_FONT.size * 1.3

function layout(src: string, visual?: Partial<PieVisualConfig>): PositionedPieChart {
  return layoutPieChart(
    parsePieChart(toMermaidLines(src)),
    {},
    { ...DEFAULT_PIE_VISUAL_CONFIG, paletteOverrides: [], ...visual },
  )
}

/** The pie-15 probe fixture: many slices, long labels, sub-0.1% tails. */
const PIE15 = [
  'pie showData title Operational budget by team',
  '  "Infrastructure engineering" : 30',
  '  "Data platform" : 25',
  '  "Security & compliance" : 18',
  '  "Customer support tooling" : 12',
  '  "Mobile apps" : 9',
  '  "Web frontend" : 7',
  '  "Internal tools" : 5',
  '  "Machine learning research" : 4',
  '  "Developer productivity" : 3',
  '  "Quality assurance" : 2',
  '  "Site reliability" : 2',
  '  "Design systems" : 1',
  '  "Documentation" : 1',
  '  "Partnerships" : 0.5',
  '  "Miscellaneous" : 0.5',
].join('\n')

// ---------------------------------------------------------------------------
// Percentage formatting — one formatter per surface, both in ONE place
// ---------------------------------------------------------------------------

describe('pie percent formatting', () => {
  it('legend percent floors nonzero fractions at 0.1% — never "(0.0%)"', () => {
    expect(formatPiePercent(1 / 2501)).toBe('0.1%')
    expect(formatPiePercent(0.0001)).toBe('0.1%')
  })

  it('legend percent keeps zero at 0.0% and normal rounding elsewhere', () => {
    expect(formatPiePercent(0)).toBe('0.0%')
    expect(formatPiePercent(0.7942386831)).toBe('79.4%')
    expect(formatPiePercent(1)).toBe('100.0%')
  })

  it('a nonzero tiny slice renders "(0.1%)" in the SVG legend, not "(0.0%)"', () => {
    const svg = renderMermaidSVG('pie\n  "Big" : 2500\n  "Tiny" : 1')
    expect(svg).toContain('(0.1%)')
    expect(svg).not.toContain('(0.0%)')
  })
})

// ---------------------------------------------------------------------------
// On-slice percentage labels (upstream #1027 parity)
// ---------------------------------------------------------------------------

describe('pie on-slice percentage labels', () => {
  const BASIC = 'pie title Pets adopted by volunteers\n  "Dogs" : 386\n  "Cats" : 85\n  "Rats" : 15'

  it('renders integer percentages only when they fit their wedge chord', () => {
    const svg = renderMermaidSVG(BASIC)
    for (const pct of ['79%', '17%']) expect(svg).toContain(`>${pct}<`)
    expect(svg).not.toContain('>3%<')
    expect((svg.match(/class="pie-slice-label"/g) ?? []).length).toBe(2)
  })

  it('places labels at radius * textPosition along the slice mid-angle (default 0.75)', () => {
    const p = layout('pie\n  "A" : 1\n  "B" : 1')
    const a = p.slices[0]!.pctLabel!
    // First slice spans 0..π, mid-angle π/2 → straight right of center.
    expect(a.x).toBeCloseTo(p.cx + p.radius * 0.75, 1)
    expect(a.y).toBeCloseTo(p.cy, 1)
  })

  it('honors textPosition from the visual config (layout-level)', () => {
    const p = layout('pie\n  "A" : 1\n  "B" : 1', { textPosition: 0.5 })
    expect(p.slices[0]!.pctLabel!.x).toBeCloseTo(p.cx + p.radius * 0.5, 1)
  })

  it('honors textPosition from an init directive end to end', () => {
    const src = (tp: number) =>
      `%%{init: {"pie": {"textPosition": ${tp}}}}%%\npie\n  "A" : 1\n  "B" : 1`
    const at = (svg: string): number => {
      const m = /<text x="([\d.]+)" y="[\d.]+"[^>]*class="pie-slice-label"/.exec(svg)
      expect(m).not.toBeNull()
      return Number(m![1])
    }
    const near = at(renderMermaidSVG(src(0.3)))
    const far = at(renderMermaidSVG(src(0.9)))
    expect(far).toBeGreaterThan(near + 20)
  })

  it('suppresses a percentage that cannot fit its wedge chord without dropping data', () => {
    const p = layout('pie\n  "Tiny" : 1\n  "Large" : 99')
    expect(p.slices[0]!.pctLabel).toBeUndefined()
    expect(p.slices[1]!.pctLabel?.text).toBe('99%')
    expect(p.slices).toHaveLength(2)
    expect(p.legend).toHaveLength(2)
  })

  it('suppresses the on-slice label for slices that would read "0%", keeps the wedge + legend row', () => {
    const svg = renderMermaidSVG('pie\n  "Big" : 2499\n  "Tiny" : 1')
    // Both wedges render; only the big slice is labeled on-slice.
    expect((svg.match(/class="pie-slice"/g) ?? []).length).toBe(2)
    expect((svg.match(/class="pie-slice-label"/g) ?? []).length).toBe(1)
    expect(svg).toContain('>100%<')
    expect(svg).toContain('Tiny')
  })

  it('property: emitted slice labels never overlap and never leave the canvas', () => {
    const valueArb = fc.oneof(
      fc.integer({ min: 1, max: 1000 }),
      fc.constantFrom(0.5, 1, 2, 500, 999),
    )
    fc.assert(
      fc.property(
        fc.array(valueArb, { minLength: 1, maxLength: 15 }),
        (values) => {
          const src = 'pie\n' + values.map((v, i) => `  "s${i}" : ${v}`).join('\n')
          const p = layout(src)
          const boxes = p.slices
            .filter(s => s.pctLabel)
            .map(s => {
              const l = s.pctLabel!
              const w = measureTextWidth(l.text, l.fontSize, 500)
              const h = l.fontSize * 1.1
              return { x0: l.x - w / 2, y0: l.y - h / 2, x1: l.x + w / 2, y1: l.y + h / 2 }
            })
          // Never off-canvas.
          for (const b of boxes) {
            expect(b.x0).toBeGreaterThanOrEqual(0)
            expect(b.y0).toBeGreaterThanOrEqual(0)
            expect(b.x1).toBeLessThanOrEqual(p.width)
            expect(b.y1).toBeLessThanOrEqual(p.height)
          }
          // Never overlapping (auditor tolerance: 1.5px interpenetration).
          for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
              const w = Math.min(boxes[i]!.x1, boxes[j]!.x1) - Math.max(boxes[i]!.x0, boxes[j]!.x0)
              const h = Math.min(boxes[i]!.y1, boxes[j]!.y1) - Math.max(boxes[i]!.y0, boxes[j]!.y0)
              expect(w <= 1.5 || h <= 1.5).toBe(true)
            }
          }
          // The policy must not degenerate to "suppress everything": a
          // dominant slice always carries its label.
          const total = values.reduce((s, v) => s + v, 0)
          const maxIdx = values.indexOf(Math.max(...values))
          if (values[maxIdx]! / total >= 1 / 3) {
            expect(p.slices[maxIdx]!.pctLabel).toBeDefined()
          }
        },
      ),
      { numRuns: 80 },
    )
  })
})

// ---------------------------------------------------------------------------
// Donut mode (upstream v11.16.0, config `pie.donutHole`)
// ---------------------------------------------------------------------------

describe('pie donut mode', () => {
  it('resolves donutHole from config with the upstream clamp ((0, 0.9] else 0)', () => {
    expect(resolvePieVisualConfig({ pie: { donutHole: 0.5 } }).donutHole).toBe(0.5)
    expect(resolvePieVisualConfig({ pie: { donutHole: 0.95 } }).donutHole).toBe(0)
    expect(resolvePieVisualConfig({ pie: { donutHole: -0.2 } }).donutHole).toBe(0)
    expect(resolvePieVisualConfig({ pie: { donutHole: 'x' } }).donutHole).toBe(0)
    expect(resolvePieVisualConfig({}).donutHole).toBe(0)
  })

  it('lays out annular wedges: innerRadius = donutHole * radius, no center vertex', () => {
    const p = layout('pie\n  "A" : 2\n  "B" : 1', { donutHole: 0.5 })
    expect(p.innerRadius).toBeCloseTo(p.radius * 0.5, 3)
    for (const s of p.slices) {
      expect(s.path).not.toContain(`L ${p.cx} ${p.cy}`)
      // Annular wedge = outer arc + inner arc.
      expect((s.path.match(/A /g) ?? []).length).toBe(2)
    }
  })

  it('renders a ring for a single-slice donut (two subpaths)', () => {
    const p = layout('pie\n  "Only" : 5', { donutHole: 0.4 })
    expect((p.slices[0]!.path.match(/M /g) ?? []).length).toBe(2)
  })

  it('honors donutHole from an init directive end to end', () => {
    const svg = renderMermaidSVG('%%{init: {"pie": {"donutHole": 0.6}}}%%\npie\n  "A" : 2\n  "B" : 1')
    const paths = [...svg.matchAll(/<path class="pie-slice" d="([^"]+)"/g)].map(m => m[1]!)
    expect(paths.length).toBe(2)
    for (const d of paths) expect((d.match(/A /g) ?? []).length).toBe(2)
  })

  it('keeps on-slice labels in donut mode (upstream keeps textPosition placement)', () => {
    const p = layout('pie\n  "A" : 2\n  "B" : 1', { donutHole: 0.3 })
    expect(p.slices[0]!.pctLabel).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Legend position (upstream v11.16.0, config `pie.legendPosition`)
// ---------------------------------------------------------------------------

/** Bounding boxes of every rendered legend row (swatch + measured text). */
function legendBoxes(p: PositionedPieChart) {
  return p.legend.map(item => {
    // Pre-elevation layouts carry no `lines`; recompose what the renderer
    // draws (label lines, value/percent riding on the last line).
    const fallback = `${item.label}${p.showData ? ` [${item.value}]` : ''} (${formatPiePercent(item.fraction)})`.split('\n')
    const lines = item.lines ?? fallback
    const textW = Math.max(...lines.map(l => measureTextWidth(l, LEGEND_FONT.size, LEGEND_FONT.weight)))
    const textH = lines.length * LEGEND_LINE_HEIGHT
    return {
      x0: item.x,
      y0: Math.min(item.y, item.textY - textH / 2),
      x1: item.textX + textW,
      y1: Math.max(item.y + item.swatchSize, item.textY + textH / 2),
    }
  })
}

describe('pie legend position', () => {
  it('resolves legendPosition with the upstream enum and default', () => {
    expect(resolvePieVisualConfig({}).legendPosition).toBe('right')
    expect(resolvePieVisualConfig({ pie: { legendPosition: 'left' } }).legendPosition).toBe('left')
    expect(resolvePieVisualConfig({ pie: { legendPosition: 'sideways' } }).legendPosition).toBe('right')
  })

  it('left: legend column sits fully left of the circle', () => {
    const p = layout(PIE15, { legendPosition: 'left' })
    for (const b of legendBoxes(p)) expect(b.x1).toBeLessThanOrEqual(p.cx - p.radius + 0.01)
  })

  it('top: legend block sits fully above the circle', () => {
    const p = layout(PIE15, { legendPosition: 'top' })
    for (const b of legendBoxes(p)) expect(b.y1).toBeLessThanOrEqual(p.cy - p.radius + 0.01)
  })

  it('bottom: legend block sits fully below the circle', () => {
    const p = layout(PIE15, { legendPosition: 'bottom' })
    for (const b of legendBoxes(p)) expect(b.y0).toBeGreaterThanOrEqual(p.cy + p.radius - 0.01)
  })

  it('center: legend block is centered on the circle center (donut-hole pairing)', () => {
    const p = layout('pie\n  "A" : 1\n  "B" : 1', { legendPosition: 'center', donutHole: 0.8 })
    const boxes = legendBoxes(p)
    const x0 = Math.min(...boxes.map(b => b.x0))
    const x1 = Math.max(...boxes.map(b => b.x1))
    const y0 = Math.min(...boxes.map(b => b.y0))
    const y1 = Math.max(...boxes.map(b => b.y1))
    expect((x0 + x1) / 2).toBeCloseTo(p.cx, 0)
    expect((y0 + y1) / 2).toBeCloseTo(p.cy, 0)
  })

  it('invariant: no legend row clips the canvas in ANY position (pie-15 probe)', () => {
    for (const pos of ['top', 'bottom', 'left', 'right', 'center'] as const) {
      const p = layout(PIE15, { legendPosition: pos })
      for (const b of legendBoxes(p)) {
        expect(b.x0).toBeGreaterThanOrEqual(0)
        expect(b.y0).toBeGreaterThanOrEqual(0)
        expect(b.x1).toBeLessThanOrEqual(p.width + 0.01)
        expect(b.y1).toBeLessThanOrEqual(p.height + 0.01)
      }
      // The circle itself stays on-canvas too.
      expect(p.cx - p.radius).toBeGreaterThanOrEqual(0)
      expect(p.cy - p.radius).toBeGreaterThanOrEqual(0)
      expect(p.cx + p.radius).toBeLessThanOrEqual(p.width)
      expect(p.cy + p.radius).toBeLessThanOrEqual(p.height)
    }
  })

  it('honors legendPosition from frontmatter end to end', () => {
    const src = '---\nconfig:\n  pie:\n    legendPosition: left\n---\npie\n  "A" : 1\n  "B" : 1'
    const svg = renderMermaidSVG(src)
    const swatchX = Number(/<rect class="pie-legend-swatch" x="([\d.]+)"/.exec(svg)![1])
    const sliceD = /<path class="pie-slice" d="M ([\d.]+)/.exec(svg)!
    expect(swatchX).toBeLessThan(Number(sliceD[1]))
  })
})

// ---------------------------------------------------------------------------
// <br/> legend rows (multiline labels must not collide — pie-br probe)
// ---------------------------------------------------------------------------

describe('pie multiline legend rows', () => {
  it('rows with <br/> labels get taller rows instead of overprinting neighbors', () => {
    const p = layout('pie\n  "Alpha<br/>very long second line of text" : 30\n  "Beta" : 20\n  "Gamma<br/>row" : 10')
    const boxes = legendBoxes(p)
    for (let i = 0; i + 1 < boxes.length; i++) {
      expect(boxes[i]!.y1).toBeLessThanOrEqual(boxes[i + 1]!.y0 + 0.01)
    }
  })

  it('measures multiline rows by their longest LINE, not the concatenated string', () => {
    const oneLine = layout('pie\n  "aaaaaaaaaaaa" : 1')
    const twoLine = layout('pie\n  "aaaaaaaaaaaa<br/>bb" : 1')
    // The two-line label's longest line is the same as the one-line label
    // (percent rides on the last, shorter line), so the canvas must not be
    // wider than the single-line chart's canvas plus rounding slack.
    expect(twoLine.width).toBeLessThanOrEqual(oneLine.width + 1)
  })
})

// ---------------------------------------------------------------------------
// highlightSlice — Option D: non-geometric emphasis (foreground border on the
// target + dimmed siblings), never a geometry change. Perception research
// (Skau & Kosara 2016, "Arcs, Angles, or Areas") shows arc length/area are the
// cues people actually read, and that changing a slice's radius or exploding it
// degrades reading — so emphasis must leave geometry exact. These gates fail if
// the old scale()-about-fill-box behaviour (or any future grow-radius/translate
// emphasis) returns.
// ---------------------------------------------------------------------------

describe('pie highlightSlice — Option D non-geometric emphasis', () => {
  const donut = (hl: string | null) => `---
config:
  pie:${hl ? `\n    highlightSlice: ${hl}` : ''}
    donutHole: 0.2
  themeVariables:
    pieOuterStrokeWidth: "5px"
---
pie showData
  title Key elements in Product X
  "Calcium" : 42.96
  "Potassium" : 50.05
  "Magnesium" : 10.01
  "Iron" : 5`

  const slicePaths = (svg: string): string[] =>
    [...svg.matchAll(/<path class="pie-slice[^"]*" d="([^"]*)"/g)].map(m => m[1]!)

  it('leaves every slice path byte-identical whether or not a slice is highlighted', () => {
    const plain = renderMermaidSVG(donut(null), { embedFontImport: false })
    const highlighted = renderMermaidSVG(donut('Potassium'), { embedFontImport: false })
    // Geometry is the encoding people read (arc length/area); emphasis must not touch it.
    expect(slicePaths(highlighted)).toEqual(slicePaths(plain))
    expect(slicePaths(highlighted).length).toBe(4)
  })

  it('never emits a CSS transform on slices (guards the old scale-about-fill-box bug)', () => {
    const svg = renderMermaidSVG(donut('Potassium'), { embedFontImport: false })
    expect(svg).not.toContain('scale(1.05)')
    expect(svg).not.toContain('transform-box')
    expect(svg).not.toContain('transform-origin')
  })

  it('emphasises the target with a foreground border and dims the rest', () => {
    const svg = renderMermaidSVG(donut('Potassium'), { embedFontImport: false })
    // heavier foreground border on the highlighted slice (shape cue, not colour-only);
    // the `var(--fg)` origin is resolved to a concrete theme colour at render time.
    expect(svg).toMatch(/\.pie-slice\.highlighted \{ stroke: [^;]+; stroke-width: 2\.5; \}/)
    // a dim tier applied to the non-highlighted slices
    expect(svg).toMatch(/class="pie-slice pie-dim"/)
    // the highlighted legend row is bold; dimmed rows carry the pie-dim class
    expect(svg).toMatch(/class="pie-legend-text" [^>]*font-weight="700"/)
    expect(svg).toMatch(/class="pie-legend-text pie-dim"/)
  })

  it('dims nothing when the highlight target matches no slice', () => {
    const svg = renderMermaidSVG(donut('Nonexistent'), { embedFontImport: false })
    expect(svg).not.toMatch(/class="[^"]*pie-dim/)
    expect(svg).not.toContain('class="pie-slice highlighted"')
  })
})

// ---------------------------------------------------------------------------
// Config wire-or-warn (plan §Pie item 1; INEFFECTIVE_CONFIG reuse, no new code)
// ---------------------------------------------------------------------------

describe('pie config wire-or-warn', () => {
  it('clamps textPosition to [0,1] with upstream default 0.75', () => {
    expect(resolvePieVisualConfig({}).textPosition).toBe(0.75)
    expect(resolvePieVisualConfig({ pie: { textPosition: 0.4 } }).textPosition).toBe(0.4)
    expect(resolvePieVisualConfig({ pie: { textPosition: 1.4 } }).textPosition).toBe(0.75)
    expect(resolvePieVisualConfig({ pie: { textPosition: -1 } }).textPosition).toBe(0.75)
  })

  it('unwired pie config fields carry INEFFECTIVE_CONFIG; wired fields stay silent', () => {
    const parsed = parseMermaid('%%{init: {"pie": {"highlightSlice": "hover", "textPosition": 0.5, "donutHole": 0.3, "unknownField": true}}}%%\npie\n  "A" : 1')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const verify = verifyMermaid(parsed.value)
    expect(verify.ok).toBe(true)
    const fields = verify.warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG').map(w => (w as { field: string }).field)
    expect(fields).toEqual(['pie.unknownField'])
    expect(renderMermaidSVG('%%{init: {"pie": {"highlightSlice": "A"}}}%%\npie\n  "A" : 1')).toContain('class="pie-slice highlighted"')
  })

  it('documented pie text, palette, and stroke variables are wired and stay silent', () => {
    const parsed = parseMermaid('%%{init: {"themeVariables": {"pieTitleTextSize": "30px", "pie1": "#ff0000", "pieStrokeColor": "#000000"}}}%%\npie\n  "A" : 1')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const verify = verifyMermaid(parsed.value)
    const fields = verify.warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG').map(w => (w as { field: string }).field)
    expect(fields).toEqual([])
    expect(renderMermaidSVG('%%{init: {"themeVariables": {"pieTitleTextSize": "30px"}}}%%\npie title T\n  "A" : 1')).toContain('font-size="30"')
  })

  it('a config-free pie stays lint-free', () => {
    const parsed = parseMermaid('pie\n  "A" : 1\n  "B" : 2')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(verifyMermaid(parsed.value).warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// pie1..pie12 theme variables — honored in SOURCE order (fixes upstream #5314)
// ---------------------------------------------------------------------------

describe('pie color injection defenses', () => {
  const chart = 'pie\n  "A" : 1\n  "B" : 2'
  const renderWith = (field: string, value: string) => renderMermaidSVG(
    `%%{init: ${JSON.stringify({ themeVariables: { [field]: value } })}}%%\n${chart}`,
  )

  it('rejects attribute and stylesheet escape payloads on every color sink', () => {
    const payloads = ['red" onmouseover="alert(1)', '</style><script>alert(1)</script><style>', 'url(https://example.invalid/x)', 'red;stroke:black', 'red{fill:black}']
    for (const field of ['pie1', 'pieStrokeColor', 'pieOuterStrokeColor', 'pieSectionTextColor']) {
      for (const payload of payloads) {
        const svg = renderWith(field, payload)
        expect(svg).not.toContain('onmouseover=')
        expect(svg).not.toContain('<script>')
        expect(svg).not.toContain('example.invalid')
        expect(svg).not.toContain(payload)
      }
    }
  })

  it('keeps explicitly supported concrete and functional colors', () => {
    for (const color of ['#abc', '#112233', 'rebeccapurple', 'rgb(1, 2, 3)', 'hsl(120 100% 50% / 0.5)', 'color-mix(in srgb, red 20%, blue)']) {
      expect(resolvePieVisualConfig({ themeVariables: { pie1: color } }).paletteOverrides[0]).toBe(color)
    }
  })
})

describe('pie1..pie12 theme variables', () => {
  const THEMED = [
    '---',
    'config:',
    '  themeVariables:',
    '    pie1: "#111111"',
    '    pie2: "#222222"',
    '    pie3: "#333333"',
    '---',
    'pie',
    '  "Small" : 10',
    '  "Large" : 90',
    '  "Medium" : 50',
  ].join('\n')

  it('assigns pieN to the Nth slice in SOURCE order, not value order', () => {
    const svg = renderMermaidSVG(THEMED)
    const fills = [...svg.matchAll(/<path class="pie-slice"[^>]*fill="([^"]+)"/g)].map(m => m[1])
    expect(fills).toEqual(['#111111', '#222222', '#333333'])
  })

  it('legend swatches use the same source-order fills', () => {
    const svg = renderMermaidSVG(THEMED)
    const fills = [...svg.matchAll(/<rect class="pie-legend-swatch"[^>]*fill="([^"]+)"/g)].map(m => m[1])
    expect(fills).toEqual(['#111111', '#222222', '#333333'])
  })

  it('cycles pieN past twelve slices (slice 13 gets pie1)', () => {
    const entries = Array.from({ length: 13 }, (_u, i) => `  "s${i}" : 1`).join('\n')
    const svg = renderMermaidSVG(`%%{init: {"themeVariables": {"pie1": "#123123"}}}%%\npie\n${entries}`)
    const fills = [...svg.matchAll(/<path class="pie-slice"[^>]*fill="([^"]+)"/g)].map(m => m[1])
    expect(fills[0]).toBe('#123123')
    expect(fills[12]).toBe('#123123')
  })
})

// ---------------------------------------------------------------------------
// Stroke / opacity / outer-circle theme variables
// ---------------------------------------------------------------------------

describe('pie stroke and opacity theme variables', () => {
  it('applies pieStrokeColor / pieStrokeWidth / pieOpacity to slices', () => {
    const svg = renderMermaidSVG('%%{init: {"themeVariables": {"pieStrokeColor": "#123456", "pieStrokeWidth": "3px", "pieOpacity": 0.7}}}%%\npie\n  "A" : 1\n  "B" : 2')
    const rule = /\.pie-slice \{[^}]*\}/.exec(svg)?.[0] ?? ''
    expect(rule).toContain('stroke: #123456')
    expect(rule).toContain('stroke-width: 3')
    expect(rule).toContain('opacity: 0.7')
  })

  it('slices carry no opacity unless pieOpacity is set (crisp default keeps goldens)', () => {
    const rule = /\.pie-slice \{[^}]*\}/.exec(renderMermaidSVG('pie\n  "A" : 1'))?.[0] ?? ''
    expect(rule).not.toContain('opacity')
  })

  it('draws the outer circle only when pieOuterStroke* is configured', () => {
    const plain = renderMermaidSVG('pie\n  "A" : 1\n  "B" : 2')
    expect(plain).not.toContain('pie-outer-circle')
    const svg = renderMermaidSVG('%%{init: {"themeVariables": {"pieOuterStrokeWidth": "3px", "pieOuterStrokeColor": "#654321"}}}%%\npie\n  "A" : 1\n  "B" : 2')
    const m = /<circle class="pie-outer-circle"[^>]*r="([\d.]+)"/.exec(svg)
    expect(m).not.toBeNull()
    // Upstream geometry: r = radius + outerStrokeWidth / 2.
    expect(Number(m![1])).toBeCloseTo(95 + 3 / 2, 1)
    expect(svg).toContain('#654321')
  })

  it('applies pieSectionTextSize / pieSectionTextColor to on-slice labels', () => {
    const svg = renderMermaidSVG('%%{init: {"themeVariables": {"pieSectionTextSize": "17px", "pieSectionTextColor": "#0000aa"}}}%%\npie\n  "A" : 1\n  "B" : 2')
    const label = /<text[^>]*class="pie-slice-label"[^>]*>/.exec(svg)?.[0] ?? ''
    expect(label).toContain('font-size="17"')
    expect(svg).toContain('#0000aa')
  })
})

// ---------------------------------------------------------------------------
// Hue-spread palette at high slice counts (plan §Pie item 4)
// ---------------------------------------------------------------------------

describe('pie high-count palette', () => {
  const distinguishable = (a: string, b: string): boolean => {
    const contrast = wcagContrastRatio(a, b)
    if (contrast !== null && contrast >= 1.1) return true
    const ha = hexToHsl(a)[0]
    const hb = hexToHsl(b)[0]
    const sep = Math.min(Math.abs(ha - hb), 360 - Math.abs(ha - hb))
    return sep >= 25
  }

  it('15 slices on the default light theme are pairwise distinguishable', () => {
    const cols = pieSliceColors(15, { accent: '#3b82f6', bg: '#ffffff' })
    expect(new Set(cols).size).toBe(15)
    for (let i = 0; i < cols.length; i++) {
      for (let j = i + 1; j < cols.length; j++) {
        if (!distinguishable(cols[i]!, cols[j]!)) {
          throw new Error(`palette degenerates: ${i}:${cols[i]} vs ${j}:${cols[j]}`)
        }
      }
    }
  })

  it('every high-count color, including slice zero, keeps a visibility floor vs the background', () => {
    for (const bg of ['#ffffff', '#1a1b26']) {
      const equal = pieSliceColors(15, { accent: bg, bg })
      for (const c of equal) expect(wcagContrastRatio(c, bg)!).toBeGreaterThanOrEqual(1.25)
    }
  })

  it('small charts keep the existing same-family ladder (golden stability)', () => {
    const cols = pieSliceColors(3, { accent: '#3b82f6', bg: '#ffffff' })
    expect(cols[0]).toBe('#3b82f6')
    expect(cols[1]).toBe('#0d5ba5')
  })

  it('is deterministic', () => {
    expect(pieSliceColors(15, { accent: '#3b82f6', bg: '#ffffff' }))
      .toEqual(pieSliceColors(15, { accent: '#3b82f6', bg: '#ffffff' }))
  })

  it('pie1..pie12 overrides win over the derived palette at matching indices', () => {
    const overrides: Array<string | undefined> = []
    overrides[1] = '#abcdef'
    const cols = pieSliceColors(4, { accent: '#3b82f6', bg: '#ffffff', overrides })
    expect(cols[1]).toBe('#abcdef')
    expect(cols[0]).toBe('#3b82f6')
  })

  it('the SVG renderer uses the hue-spread palette at high counts (no near-identical wedges)', () => {
    const entries = Array.from({ length: 15 }, (_u, i) => `  "slice ${i}" : ${i + 1}`).join('\n')
    const svg = renderMermaidSVG(`pie\n${entries}`)
    const fills = [...svg.matchAll(/<path class="pie-slice"[^>]*fill="([^"]+)"/g)].map(m => m[1]!)
    expect(fills.length).toBe(15)
    for (let i = 0; i < fills.length; i++) {
      for (let j = i + 1; j < fills.length; j++) {
        if (!distinguishable(fills[i]!, fills[j]!)) {
          throw new Error(`rendered palette degenerates: ${i}:${fills[i]} vs ${j}:${fills[j]}`)
        }
      }
    }
  })

  it('the ASCII renderer shares the same palette (cross-format consistency)', () => {
    const entries = Array.from({ length: 15 }, (_u, i) => `  "slice ${i}" : ${i + 1}`).join('\n')
    const out = renderMermaidASCII(`pie\n${entries}`, { useAscii: true, colorMode: 'truecolor' })
    const seen = [...out.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g)]
      .map(m => '#' + [m[1], m[2], m[3]].map(v => Number(v).toString(16).padStart(2, '0')).join(''))
    const uniq = [...new Set(seen)]
    expect(uniq.length).toBe(15)
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        if (!distinguishable(uniq[i]!, uniq[j]!)) {
          throw new Error(`ascii palette degenerates: ${uniq[i]} vs ${uniq[j]}`)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Interactive tooltips (shared machinery with xychart)
// ---------------------------------------------------------------------------

describe('pie interactive tooltips', () => {
  const SRC = 'pie showData\n  "Dogs" : 386\n  "Cats" : 85\n  "Rats" : 15'

  it('interactive: true adds a hover group + <title> + tooltip per slice', () => {
    const svg = renderMermaidSVG(SRC, { interactive: true })
    expect((svg.match(/class="pie-slice-group"/g) ?? []).length).toBe(3)
    expect((svg.match(/<title>/g) ?? []).length).toBe(3)
    expect(svg).toContain('.pie-tip')
    expect(svg).toContain('Dogs: 386 (79.4%)')
  })

  it('stays inert by default (no tooltip chrome in non-interactive output)', () => {
    const svg = renderMermaidSVG(SRC)
    expect(svg).not.toContain('pie-slice-group')
    expect(svg).not.toContain('<title>')
    expect(svg).not.toContain('.pie-tip')
  })
})
