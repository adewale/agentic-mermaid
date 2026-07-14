import type {
  RadarChart,
  PositionedRadarChart,
  PositionedRadarRing,
  PositionedRadarAxis,
  PositionedRadarCurve,
  PositionedRadarTickLabel,
  PositionedRadarLegendItem,
} from './types.ts'
import type { RenderOptions } from '../types.ts'
import type { RadarVisualConfig } from './config.ts'
import { measureTextWidth } from '../text-metrics.ts'
import { wrapLabelToWidth } from '../shared/label-wrap.ts'
import { resolveRenderStyle, STROKE_WIDTHS } from '../styles.ts'
import type { RenderStyleDefaults } from '../styles.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { radarValueRatio, resolveRadarScale } from './scale.ts'
import { MAX_RADAR_AXES } from './parser.ts'

// ============================================================================
// Radar chart layout engine
//
// Places N equi-angular spokes from a center (axis 0 at 12 o'clock, clockwise),
// concentric graticule rings, one closed area per curve, vertex dots, radial
// axis labels, an optional ring-value scale, and a legend column. Values map to
// a radius in [min,max]; `axisScaleFactor` scales only the drawn spoke length
// (not the rings or data), matching upstream.
//
// `graticule circle` → circular rings + a smooth closed Catmull-Rom curve
// (tension `curveTension`, default 0.17, matching upstream `closedRoundCurve`).
// `graticule polygon` → polygonal rings + straight polygon curves.
//
// Label discipline borrows the whole-repo "union of lessons" (see
// docs/design/system/cross-family-aesthetics.md):
//   • budget-driven, lossless wrap compression (timeline / quadrant)
//   • radial clearance + pairwise de-collision of axis labels (ER)
//   • leader lines to relocated labels (quadrant)
//   • knockout boxes behind ring value labels (flowchart)
//   • wrapped legend labels with reserved row height (gantt rowAdvance)
// The canvas then grows to contain every final label box (gitgraph/sequence),
// so nothing clips at any label length.
//
// All coordinates are direct pixel positions — the renderer never recomputes
// geometry. Deterministic: no randomness, no clock.
// ============================================================================

const R = {
  radius: 120,
  margin: 22,
  titleFontSize: 18,
  titleGap: 16,
  axisFontSize: 12.5,
  /** Gap between the axis-label ring and the measured label box. */
  axisLabelPad: 8,
  /** Max width one axis label may occupy before wrapping to a second line. */
  axisLabelMaxWidth: 96,
  /** Tightest wrap width the compression pass may fall to before ellipsizing. */
  axisLabelMinWidth: 58,
  /** Clearance between the outer ring/dot and the nearest axis-label edge. */
  labelClearGap: 7,
  /** A label relocated past this radial push (px) earns a leader line. */
  leaderMinPush: 9,
  legendFontSize: 13,
  /** Max width a legend label may occupy before wrapping. */
  legendLabelMaxWidth: 168,
  legendSwatch: 14,
  legendGap: 30,
  legendRowGap: 9,
  legendSwatchToText: 8,
  ringLabelFontSize: 9.5,
  /** Padding inside a ring-value knockout box (x each side / y each side). */
  tickBoxPadX: 4,
  tickBoxPadY: 3,
  dotRadius: 3,
  curveStrokeWidth: 2.2,
} as const

/** Style defaults shared by layout AND renderer so measured text matches
 *  drawn text. Explicit RenderOptions style faces still win. */
export function radarStyleDefaults(visual: RadarVisualConfig = {}): RenderStyleDefaults {
  return {
    nodeLabelFontSize: visual.legendFontSize ?? R.legendFontSize, // legend text
    edgeLabelFontSize: visual.axisLabelFontSize ?? R.axisFontSize, // axis labels
    groupHeaderFontSize: visual.titleFontSize ?? R.titleFontSize, // title
    nodeLabelFontWeight: 500,
    edgeLabelFontWeight: 500,
    groupHeaderFontWeight: 600,
    nodePaddingX: 0,
    nodePaddingY: 0,
    nodeLineWidth: visual.curveStrokeWidth ?? R.curveStrokeWidth,
    edgeLineWidth: visual.axisStrokeWidth ?? 1,
    groupCornerRadius: 0,
    groupPaddingX: 0,
    groupPaddingY: 0,
    groupLineWidth: STROKE_WIDTHS.outerBox,
  }
}

function round(n: number): number { return Math.round(n * 100) / 100 }
function clamp(n: number, min: number, max: number): number { return Math.min(Math.max(n, min), max) }

/** Axis i of n. Angle 0 = 12 o'clock; positive = clockwise (pie convention). */
function axisAngle(i: number, n: number): number { return (2 * Math.PI * i) / n }
function polar(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
  return { x: cx + r * Math.sin(angle), y: cy - r * Math.cos(angle) }
}

interface Box { left: number; right: number; top: number; bottom: number }
function boxesOverlap(a: Box, b: Box, pad = 0): boolean {
  return a.left < b.right + pad && b.left < a.right + pad && a.top < b.bottom + pad && b.top < a.bottom + pad
}

/**
 * Closed curve `d` through `pts`. `graticule polygon` → straight polygon;
 * `graticule circle` → smooth closed Catmull-Rom (tension `t`), the exact
 * conversion upstream's `closedRoundCurve` uses (interpolates THROUGH each
 * vertex, so the dot markers sit on the curve). Family-local path construction
 * — the pie-slice-path analogue — not a shared primitive.
 */
function curvePath(pts: Array<{ x: number; y: number }>, smooth: boolean, t: number): string {
  if (pts.length === 0) return ''
  if (!smooth || pts.length < 3) {
    return 'M ' + pts.map(p => `${round(p.x)} ${round(p.y)}`).join(' L ') + ' Z'
  }
  const n = pts.length
  let d = `M ${round(pts[0]!.x)} ${round(pts[0]!.y)}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!, p1 = pts[i]!, p2 = pts[(i + 1) % n]!, p3 = pts[(i + 2) % n]!
    const c1x = p1.x + (p2.x - p0.x) * t, c1y = p1.y + (p2.y - p0.y) * t
    const c2x = p2.x - (p3.x - p1.x) * t, c2y = p2.y - (p3.y - p1.y) * t
    d += ` C ${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(p2.x)} ${round(p2.y)}`
  }
  return d + ' Z'
}

/**
 * Lay out a parsed radar chart into pixel space.
 * Throws on a degenerate scale (max ≤ min) rather than emitting NaN geometry.
 */
export function layoutRadarChart(
  chart: RadarChart,
  options: RenderOptions = {},
  visual: RadarVisualConfig = {},
  styleFace?: InternalStyleFace,
): PositionedRadarChart {
  const style = resolveRenderStyle(options, radarStyleDefaults(visual), styleFace)
  const n = chart.axes.length
  if (n > MAX_RADAR_AXES) throw new Error(`Radar charts support at most ${MAX_RADAR_AXES} axes.`)

  // Radius from config (min(width,height)/2 minus label gutter) or default.
  let radius: number = R.radius
  if (visual.width !== undefined || visual.height !== undefined) {
    const w = visual.width ?? visual.height ?? R.radius * 2
    const h = visual.height ?? visual.width ?? R.radius * 2
    radius = clamp(Math.min(w, h) / 2 - 56, 40, 400)
  }
  const axisScale = visual.axisScaleFactor ?? 1
  const labelFactor = visual.axisLabelFactor ?? 1.05
  const tension = visual.curveTension ?? 0.17
  const smooth = chart.graticule === 'circle' && tension > 0

  const scaleDomain = resolveRadarScale(chart)
  const { min, max } = scaleDomain
  const scale = (value: number): number => radius * radarValueRatio(value, scaleDomain)

  const axisFont = style.edgeLabelFontSize
  const axisWeight = style.edgeLabelFontWeight
  const axisLineH = axisFont * 1.3
  const titleFont = style.groupHeaderFontSize
  const titleWeight = style.groupHeaderFontWeight

  // --- Axis labels: budget-driven, lossless wrap compression ----------------
  // Wrap at the default cap, then (timeline discipline) shrink the cap in
  // bounded steps while the widest wrapped label still exceeds a budget derived
  // from the plot radius, so a couple of very long labels can't blow the gutter.
  const labelBudget = Math.max(R.axisLabelMinWidth, Math.min(R.axisLabelMaxWidth, radius * 1.05))
  const wrapAt = (cap: number): string[][] =>
    chart.axes.map(a => wrapLabelToWidth(a.label, cap, axisFont, axisWeight).split('\n'))
  const widest = (wrapped: string[][]): number =>
    Math.max(0, ...wrapped.flat().map(line => measureTextWidth(line, axisFont, axisWeight)))
  let wrapCap: number = R.axisLabelMaxWidth
  let wrappedAxes = wrapAt(wrapCap)
  for (let pass = 0; pass < 8 && widest(wrappedAxes) > labelBudget && wrapCap > R.axisLabelMinWidth; pass++) {
    wrapCap = Math.max(R.axisLabelMinWidth, wrapCap - 12)
    wrappedAxes = wrapAt(wrapCap)
  }
  const axisLabelW = wrappedAxes.map(lines => Math.max(0, ...lines.map(line => measureTextWidth(line, axisFont, axisWeight))))
  const axisBlockH = wrappedAxes.map(lines => lines.length * axisLineH)

  // Outermost drawn data radius per axis — labels must clear the dot on it.
  const dataMaxR = new Array<number>(n).fill(0)
  for (const curve of chart.curves) {
    if (curve.values.length !== n) continue
    curve.values.forEach((v, i) => { dataMaxR[i] = Math.max(dataMaxR[i]!, scale(v)) })
  }

  // --- Axis-label placement (center-relative), de-collision + leaders -------
  // Overlaps are translation-invariant, so we resolve them around the origin,
  // then size gutters from the final boxes and place absolutely.
  const baseR = radius * 1.05 + R.axisLabelPad
  // Valid configured factors begin above the default and remain observable
  // even when mandatory ring/text clearance determines the base position.
  const configuredLabelPush = visual.axisLabelFactor === undefined ? 0 : radius * (labelFactor - 1.05)
  const anchors: Array<'start' | 'middle' | 'end'> = chart.axes.map((_a, i) => {
    const h = Math.sin(axisAngle(i, n))
    return h > 0.3 ? 'start' : h < -0.3 ? 'end' : 'middle'
  })
  // Initial radial push: clear the outer ring + its dot + half the label block,
  // so a multi-line label (esp. straight-down) never overlaps the silhouette.
  const ringClear = Math.max(radius, radius * axisScale, ...dataMaxR) + R.dotRadius + R.labelClearGap
  const offset = new Array<number>(n).fill(0).map((_v, i) =>
    Math.max(0, ringClear + axisBlockH[i]! / 2 - baseR) + configuredLabelPush)
  const collided = new Array<boolean>(n).fill(false)
  const relBox = (i: number): Box & { rx: number; ry: number } => {
    const ang = axisAngle(i, n)
    const r = baseR + offset[i]!
    const rx = r * Math.sin(ang)
    const ry = -r * Math.cos(ang)
    const w = axisLabelW[i]!
    const left = anchors[i] === 'start' ? rx : anchors[i] === 'end' ? rx - w : rx - w / 2
    return { left, right: left + w, top: ry - axisBlockH[i]! / 2, bottom: ry + axisBlockH[i]! / 2, rx, ry }
  }
  // Deterministic radial admission: place axes in source order and, only when
  // needed, exponentially move the current label beyond every already-admitted
  // box. Unlike a fixed relaxation pass, every returned pair is proven clear.
  // MAX_RADAR_AXES makes the pair checks a hard-bounded resource cost.
  const admitted: number[] = []
  for (let i = 0; i < n; i++) {
    const initialOffset = offset[i]!
    const overlapsAdmitted = (): boolean => admitted.some(other => boxesOverlap(relBox(i), relBox(other), 2))
    if (overlapsAdmitted()) {
      collided[i] = true
      let extra = 6
      let placed = false
      for (let attempt = 0; attempt < 48; attempt++) {
        offset[i] = initialOffset + extra
        if (!overlapsAdmitted()) { placed = true; break }
        extra *= 2
      }
      if (!placed) throw new Error('Radar axis labels could not be placed within finite layout bounds.')
    }
    admitted.push(i)
  }

  // --- Legend: wrap labels to a budget, reserve per-row height (gantt) ------
  const legendFont = style.nodeLabelFontSize
  const legendWeight = style.nodeLabelFontWeight
  const legendLineH = legendFont * 1.25
  const wantLegend = chart.showLegend && chart.curves.length > 0
  const legendSwatch = visual.legendBoxSize ?? R.legendSwatch
  // Wrap budget scales with the legend type size, so a larger accessible font
  // still expands the canvas (it wraps wider, not just taller).
  const legendWrapWidth = legendFont * (R.legendLabelMaxWidth / R.legendFontSize)
  const legendLines = wantLegend
    ? chart.curves.map(c => wrapLabelToWidth(c.label, legendWrapWidth, legendFont, legendWeight).split('\n'))
    : []
  const legendRowHeights = legendLines.map(lines => Math.max(legendSwatch, lines.length * legendLineH))
  const legendTextWidth = Math.max(0, ...legendLines.flat().map(line => measureTextWidth(line, legendFont, legendWeight)))
  const legendWidth = wantLegend ? legendSwatch + R.legendSwatchToText + legendTextWidth : 0
  const legendHeight = wantLegend
    ? legendRowHeights.reduce((s, h) => s + h, 0) + Math.max(0, chart.curves.length - 1) * R.legendRowGap
    : 0

  // --- Canvas: grow to contain every final label box -----------------------
  const marginL = visual.marginLeft ?? R.margin
  const marginR = visual.marginRight ?? R.margin
  const marginT = visual.marginTop ?? R.margin
  const marginB = visual.marginBottom ?? R.margin
  const reach = radius * Math.max(1, axisScale)
  let extL = reach, extR = reach, extT = reach, extB = reach
  for (let i = 0; i < n; i++) {
    const box = relBox(i)
    extL = Math.max(extL, -box.left)
    extR = Math.max(extR, box.right)
    extT = Math.max(extT, -box.top)
    extB = Math.max(extB, box.bottom)
  }
  if (wantLegend) { extT = Math.max(extT, legendHeight / 2); extB = Math.max(extB, legendHeight / 2) }
  // Respect a configured frame: a Mermaid `width`/`height` is reserved as real
  // canvas (centered on the plot) rather than collapsed to the label-tight box.
  if (visual.width) { const half = visual.width / 2; extL = Math.max(extL, half); extR = Math.max(extR, half) }
  if (visual.height) { const half = visual.height / 2; extT = Math.max(extT, half); extB = Math.max(extB, half) }

  const titleHeight = chart.title ? titleFont + R.titleGap : 0
  const legendColW = wantLegend ? R.legendGap + legendWidth : 0
  const baseWidth = marginL + extL + extR + legendColW + marginR
  const baseCx = marginL + extL
  const titleWidth = chart.title ? measureTextWidth(chart.title, titleFont, titleWeight) : 0
  const titleLeftExtra = Math.max(0, titleWidth / 2 - baseCx)
  const titleRightExtra = Math.max(0, baseCx + titleWidth / 2 - baseWidth)
  const width = baseWidth + titleLeftExtra + titleRightExtra
  const height = marginT + titleHeight + extT + extB + marginB
  const cx = baseCx + titleLeftExtra
  const cy = marginT + titleHeight + extT

  // Rings.
  const rings: PositionedRadarRing[] = []
  for (let k = 1; n > 0 && k <= chart.ticks; k++) {
    const rr = (radius * k) / chart.ticks
    const value = min + ((max - min) * k) / chart.ticks
    const points = chart.graticule === 'polygon'
      ? chart.axes.map((_a, i) => { const p = polar(cx, cy, rr, axisAngle(i, n)); return { x: round(p.x), y: round(p.y) } })
      : []
    rings.push({ r: round(rr), value: round(value), points, emphasized: k === chart.ticks })
  }

  // Spokes + axis labels (absolute; offsets/leaders from the de-collision pass).
  const axes: PositionedRadarAxis[] = chart.axes.map((axis, i) => {
    const angle = axisAngle(i, n)
    const spoke = polar(cx, cy, radius * axisScale, angle)
    const r = baseR + offset[i]!
    const label = polar(cx, cy, r, angle)
    const leader = collided[i] || offset[i]! > R.leaderMinPush
      ? (() => {
          const from = polar(cx, cy, Math.max(radius, radius * axisScale) + 1, angle)
          const to = polar(cx, cy, r - axisBlockH[i]! / 2 - 2, angle)
          return { x1: round(from.x), y1: round(from.y), x2: round(to.x), y2: round(to.y) }
        })()
      : undefined
    return {
      id: axis.id,
      label: axis.label,
      x: round(spoke.x),
      y: round(spoke.y),
      labelX: round(label.x),
      labelY: round(label.y),
      anchor: anchors[i]!,
      lines: wrappedAxes[i]!,
      labelWidth: round(axisLabelW[i]!),
      leader,
    }
  })

  // Curves.
  const curves: PositionedRadarCurve[] = chart.curves.map((curve, index) => {
    const drawable = curve.values.length === n
    const vertices = drawable
      ? curve.values.map((v, i) => { const p = polar(cx, cy, scale(v), axisAngle(i, n)); return { x: round(p.x), y: round(p.y) } })
      : []
    return {
      id: curve.id,
      label: curve.label,
      colorIndex: index,
      areaPath: drawable ? curvePath(vertices, smooth, tension) : '',
      vertices,
      arityMismatch: !drawable,
    }
  })

  // Ring value labels (Agentic extension) — along the gap ray between axis 0
  // and axis 1 so they never sit on a spoke; each carries a knockout box.
  const tickLabels: PositionedRadarTickLabel[] = []
  if (visual.tickLabels && n > 0) {
    const gapAngle = axisAngle(0, n) + Math.PI / n
    // Admit outside-in so the scale endpoint survives when dense tick counts
    // cannot fit. Each accepted knockout box is disjoint from every other.
    for (const ring of [...rings].reverse()) {
      const p = polar(cx, cy, ring.r, gapAngle)
      const text = formatTick(ring.value)
      const w = measureTextWidth(text, R.ringLabelFontSize, 500) + R.tickBoxPadX * 2
      const h = R.ringLabelFontSize + R.tickBoxPadY * 2
      const candidate = { text, x: round(p.x), y: round(p.y), w: round(w), h: round(h) }
      const box: Box = { left: candidate.x - candidate.w / 2, right: candidate.x + candidate.w / 2, top: candidate.y - candidate.h / 2, bottom: candidate.y + candidate.h / 2 }
      const collides = tickLabels.some(t => boxesOverlap(box, {
        left: t.x - t.w / 2, right: t.x + t.w / 2,
        top: t.y - t.h / 2, bottom: t.y + t.h / 2,
      }, 1))
      if (!collides) tickLabels.unshift(candidate)
    }
  }

  // Legend rows (vertical, right of the plot, centered on the plot) with
  // per-row reserved height for wrapped labels.
  const legend: PositionedRadarLegendItem[] = []
  if (wantLegend) {
    const legendX = titleLeftExtra + marginL + extL + extR + R.legendGap
    let rowTop = cy - legendHeight / 2
    chart.curves.forEach((curve, index) => {
      const rowH = legendRowHeights[index]!
      legend.push({
        label: curve.label,
        lines: legendLines[index]!,
        colorIndex: index,
        x: round(legendX),
        y: round(rowTop + (rowH - legendSwatch) / 2),
        swatchSize: legendSwatch,
        textX: round(legendX + legendSwatch + R.legendSwatchToText),
        textY: round(rowTop + rowH / 2),
      })
      rowTop += rowH + R.legendRowGap
    })
  }

  return {
    width: round(width),
    height: round(height),
    cx: round(cx),
    cy: round(cy),
    radius: round(radius),
    title: chart.title
      ? { text: chart.title, x: round(cx), y: round(marginT + titleFont / 2), fontSize: titleFont }
      : undefined,
    accessibility: chart.accessibility ? { ...chart.accessibility } : undefined,
    rings,
    axes,
    curves,
    tickLabels,
    legend,
    polygonGraticule: chart.graticule === 'polygon',
    typography: {
      axisFontSize: axisFont,
      axisFontWeight: axisWeight,
      legendFontSize: legendFont,
      legendFontWeight: legendWeight,
      titleFontSize: titleFont,
      titleFontWeight: titleWeight,
      tickFontSize: R.ringLabelFontSize,
      tickFontWeight: axisWeight,
    },
    visual,
  }
}

function formatTick(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

/** Historical layout constants (defaults; config overrides via
 *  radarStyleDefaults / layoutRadarChart). Exported for tests. */
export const RADAR_METRICS = {
  radius: R.radius,
  axisFontSize: R.axisFontSize,
  titleFontSize: R.titleFontSize,
  legendFontSize: R.legendFontSize,
  dotRadius: R.dotRadius,
} as const

/** Label-discipline constants exported for tests. */
export const RADAR_LABEL_METRICS = {
  axisLabelMaxWidth: R.axisLabelMaxWidth,
  axisLabelMinWidth: R.axisLabelMinWidth,
  legendLabelMaxWidth: R.legendLabelMaxWidth,
  leaderMinPush: R.leaderMinPush,
  tickBoxPadX: R.tickBoxPadX,
  tickBoxPadY: R.tickBoxPadY,
} as const
