import { describe, expect, test } from 'bun:test'
import { parseRadarChart } from '../radar/parser.ts'
import { layoutRadarChart, RADAR_METRICS, RADAR_LABEL_METRICS } from '../radar/layout.ts'
import { guardLabelInk } from '../radar/renderer.ts'
import type { PositionedRadarAxis, PositionedRadarChart } from '../radar/types.ts'
import { measureTextWidth } from '../text-metrics.ts'
import { contrastRatio, wcagCssContrastRatio } from '../shared/color-math.ts'
import { renderMermaidSVG } from '../agent/index.ts'

// ============================================================================
// The reverse-flow label disciplines applied to radar (see
// docs/design/system/cross-family-aesthetics.md): budget wrap-compression (R4),
// radial clearance + pairwise de-collision (R1), leader lines (R2), knockout
// tick boxes (R5), WCAG-AA ink (R6), wrapped legend rows (R3), and grow-the-
// canvas containment. Each test is a geometry/structure invariant that fails
// when the corresponding fix is reverted.
// ============================================================================

const lines = (src: string): string[] => src.split('\n').map(l => l.trim()).filter(Boolean)
const layout = (src: string, visual = {}): PositionedRadarChart =>
  layoutRadarChart(parseRadarChart(lines(src)), {}, visual)

const LINE_H = RADAR_METRICS.axisFontSize * 1.3
const FONT = RADAR_METRICS.axisFontSize
interface Box { left: number; right: number; top: number; bottom: number }
function axisBox(a: PositionedRadarAxis): Box {
  const w = a.labelWidth
  const h = a.lines.length * LINE_H
  const left = a.anchor === 'start' ? a.labelX : a.anchor === 'end' ? a.labelX - w : a.labelX - w / 2
  return { left, right: left + w, top: a.labelY - h / 2, bottom: a.labelY + h / 2 }
}
function overlaps(A: Box, B: Box, tol = 0.5): boolean {
  return A.left < B.right - tol && B.left < A.right - tol && A.top < B.bottom - tol && B.top < A.bottom - tol
}
function tickBox(t: PositionedRadarChart['tickLabels'][number]): Box {
  return { left: t.x - t.w / 2, right: t.x + t.w / 2, top: t.y - t.h / 2, bottom: t.y + t.h / 2 }
}

// A dataset whose bottom axis reaches the outer ring and whose labels are long.
const DEMO = `radar-beta
  title Model capability profile
  axis speed["Speed"], acc["Operational cost efficiency"], ctx["Context-window utilisation"]
  axis safety["Safety and alignment robustness"], lat["Latency"], tp["Throughput per dollar"]
  curve a["Model A, frontier release 2026"]{4, 3, 2, 4, 3, 5}
  curve b["Model B"]{3, 5, 4, 3, 5, 3}
  curve c["Model C baseline"]{2, 4, 3, 5, 4, 2}
  max 5`

// Twenty-four tight axes — naive placement overlaps (measured: 4 collisions);
// only the pairwise de-collision pass separates them.
const DENSE = `radar-beta
${Array.from({ length: 24 }, (_v, i) => `  axis a${i}["Metric ${i}"]`).join('\n')}
  curve x{${Array.from({ length: 24 }, () => '3').join(', ')}}
  max 5`

describe('radar label discipline — reverse-flow lessons', () => {
  test('R5 — admitted ring labels have disjoint knockout boxes painted before text', () => {
    const chart = layout(DEMO, { tickLabels: true })
    expect(chart.tickLabels.length).toBe(5)
    for (const t of chart.tickLabels) {
      expect(t.w).toBeGreaterThan(0)
      expect(t.h).toBeGreaterThan(0)
    }
    const svg = renderMermaidSVG(`---\nconfig:\n  radar:\n    tickLabels: true\n---\n${DEMO}`)
    expect((svg.match(/class="radar-tick-box"/g) ?? []).length).toBe(5)
    expect(svg.lastIndexOf('class="radar-tick-box"')).toBeLessThan(svg.indexOf('class="radar-tick-label"'))

    const dense = layout('radar-beta\n axis a, b, c, d\n curve x{1,2,3,4}\n ticks 64\n max 64', { tickLabels: true })
    expect(dense.tickLabels.length).toBeLessThan(64)
    expect(dense.tickLabels.at(-1)?.text).toBe('64')
    for (let i = 0; i < dense.tickLabels.length; i++) {
      for (let j = i + 1; j < dense.tickLabels.length; j++) {
        expect(overlaps(tickBox(dense.tickLabels[i]!), tickBox(dense.tickLabels[j]!))).toBe(false)
      }
    }
  })

  test('R6 — guardLabelInk certifies composited ink and falls back from unresolved CSS', () => {
    const guarded = guardLabelInk('#9a9a9a', '#ffffff', '#111111')
    expect(guarded).not.toBe('#9a9a9a')
    expect(contrastRatio(guarded, '#ffffff')!).toBeGreaterThanOrEqual(4.5)
    // An already-AA color is preserved; uncertainty and translucent low
    // contrast are never treated as proof of AA.
    expect(guardLabelInk('#111111', '#ffffff', '#000000')).toBe('#111111')
    expect(guardLabelInk('var(--_text)', '#ffffff', '#000000')).toBe('#000000')
    const alphaGuarded = guardLabelInk('rgba(0,0,0,0.1)', '#ffffff', '#111111')
    expect(wcagCssContrastRatio(alphaGuarded, '#ffffff')!).toBeGreaterThanOrEqual(4.5)

    const svg = renderMermaidSVG(DEMO)
    const defaultInk = svg.match(/\.radar-axis-label \{ fill: ([^;]+); \}/)?.[1]
    expect(defaultInk).toBeDefined()
    expect(defaultInk).not.toBe('var(--_line)')
    expect(wcagCssContrastRatio(defaultInk!, '#ffffff')!).toBeGreaterThanOrEqual(4.5)
  })

  test('R4 — long axis labels wrap to a width budget (and stay within the cap)', () => {
    const chart = layout(DEMO)
    const acc = chart.axes.find(a => a.id === 'acc')!
    expect(acc.lines.length).toBeGreaterThanOrEqual(2)
    for (const a of chart.axes) {
      for (const line of a.lines) {
        expect(measureTextWidth(line, FONT, 500)).toBeLessThanOrEqual(RADAR_LABEL_METRICS.axisLabelMaxWidth + 0.5)
      }
    }
  })

  test('R4 — hard-wrapped tokens retain every authored grapheme and accessible label', () => {
    const authored = 'OperationalCostEfficiency'
    const source = `radar-beta\n axis a["${authored}"], b, c, d\n curve x{1,2,3,4}\n max 5`
    const axis = layout(source).axes[0]!
    const reconstructed = axis.lines
      .map((line, index) => index < axis.lines.length - 1 && line.endsWith('-') ? line.slice(0, -1) : line)
      .join('')
    expect(reconstructed).toBe(authored)
    expect(axis.label).toBe(authored)
    expect(renderMermaidSVG(source)).toContain(`aria-label="${authored}"`)
  })

  test('R1 (clearance) — the straight-down axis label clears the outer ring + dot', () => {
    const chart = layout(DEMO)
    const bottom = chart.axes[3]! // n=6, index 3 → 180° (bottom); curve c reaches max here
    const box = axisBox(bottom)
    // Nearest label edge sits at least a dot-radius below the outer ring.
    expect(box.top - chart.cy).toBeGreaterThanOrEqual(chart.radius + RADAR_METRICS.dotRadius)
  })

  test('R1 (de-collision) — no two axis-label boxes overlap, including the maximum axis count', () => {
    const maxAxes = `radar-beta\n${Array.from({ length: 256 }, (_v, i) => ` axis a${i}["Metric ${i}"]`).join('\n')}\n max 5`
    for (const chart of [layout(DEMO), layout(DENSE), layout(maxAxes)]) {
      const boxes = chart.axes.map(axisBox)
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false)
        }
      }
    }
  })

  test('R2 — relocated labels get a leader line with finite endpoints', () => {
    const chart = layout(DEMO)
    const leaders = chart.axes.filter(a => a.leader)
    expect(leaders.length).toBeGreaterThan(0)
    for (const a of leaders) {
      const l = a.leader!
      for (const v of [l.x1, l.y1, l.x2, l.y2]) expect(Number.isFinite(v)).toBe(true)
    }
    const svg = renderMermaidSVG(DEMO)
    expect(svg).toContain('class="radar-leader"')
  })

  test('R3 — legend labels wrap and rows are reserved without overlap', () => {
    const chart = layout(DEMO)
    const longItem = chart.legend.find(i => i.label.startsWith('Model A'))!
    expect(longItem.lines.length).toBeGreaterThanOrEqual(2)
    // Rows are laid out top-to-bottom; the union of the swatch and measured
    // multi-line text box never overlaps the following row.
    const sorted = [...chart.legend].sort((a, b) => a.y - b.y)
    const rowBox = (item: typeof sorted[number]): Box => {
      const textHeight = item.lines.length * chart.typography.legendFontSize * 1.2
      return {
        left: Math.min(item.x, item.textX),
        right: Math.max(item.x + item.swatchSize, item.textX),
        top: Math.min(item.y, item.textY - textHeight / 2),
        bottom: Math.max(item.y + item.swatchSize, item.textY + textHeight / 2),
      }
    }
    for (let i = 1; i < sorted.length; i++) {
      expect(overlaps(rowBox(sorted[i - 1]!), rowBox(sorted[i]!))).toBe(false)
    }
  })

  test('grow-the-canvas — every axis-label box stays inside the canvas bounds', () => {
    for (const chart of [layout(DEMO), layout(DENSE)]) {
      for (const a of chart.axes) {
        const b = axisBox(a)
        expect(b.left).toBeGreaterThanOrEqual(-0.5)
        expect(b.top).toBeGreaterThanOrEqual(-0.5)
        expect(b.right).toBeLessThanOrEqual(chart.width + 0.5)
        expect(b.bottom).toBeLessThanOrEqual(chart.height + 0.5)
      }
    }
  })

  test('determinism — identical input yields byte-identical geometry', () => {
    expect(JSON.stringify(layout(DEMO, { tickLabels: true })))
      .toBe(JSON.stringify(layout(DEMO, { tickLabels: true })))
  })
})
