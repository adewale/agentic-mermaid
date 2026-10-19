import type { PositionedQuadrantChart, PositionedQuadrantPoint } from './types.ts'
import type { RenderContext } from '../types.ts'
import { quadrantStyleDefaults } from './layout.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { tooltipArtwork, tooltipCss } from '../shared/svg-tooltip.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { hashId } from '../scene/seed.ts'
import { snapshotSvgEmissionRecipe, svgValue as v, type SvgAttribute, type SvgEmissionRecipe, type SvgGeometryField } from '../scene/svg-emission.ts'

function primitive(className: string | undefined, geometry: readonly SvgGeometryField[], extra: readonly SvgAttribute[] = [], close: ' />' | '/>' = ' />'): SvgEmissionRecipe {
  return snapshotSvgEmissionRecipe({ kind: 'primitive', close, attributes: [
    ...(className ? [{ name: 'class' as const, value: v.meta(className) }] : []),
    ...geometry.map(name => ({ name, value: v.geometry(name) })), ...extra,
  ] })
}
const RECT_FIELDS = ['x', 'y', 'width', 'height'] as const
const LINE_FIELDS = ['x1', 'y1', 'x2', 'y2'] as const
const DIVIDER_EMISSION = primitive('quadrant-divider', LINE_FIELDS)
const BORDER_EMISSION = primitive('quadrant-border', RECT_FIELDS, [{ name: 'fill', value: v.paint('fill') }])
const LEADER_EMISSION = primitive('quadrant-leader', LINE_FIELDS)
const HIT_EMISSION = primitive(undefined, ['cx', 'cy', 'r'], [{ name: 'fill', value: v.paint('fill') }], '/>')
const HOVER_EMISSION = snapshotSvgEmissionRecipe({ kind: 'group', attributes: [{ name: 'class', value: v.meta('quadrant-point-group') }] })

function textAttributes(className: string, baseline = true): SvgAttribute[] {
  return [
    { name: 'class', value: v.meta(className) }, { name: 'text-anchor', value: v.text('anchor') },
    ...(baseline ? [{ name: 'dominant-baseline' as const, value: v.meta('middle') }] : []),
    { name: 'font-size', value: v.text('fontSize') }, { name: 'font-weight', value: v.text('fontWeight') },
    { name: 'letter-spacing', value: v.text('letterSpacing'), omit: 'zero' },
  ]
}
const LABEL_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: textAttributes('quadrant-label') })
const POINT_TEXT_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [
  ...textAttributes('quadrant-point-label'), { name: 'stroke', value: v.paint('stroke') },
  { name: 'stroke-width', value: v.paint('strokeWidth') }, { name: 'stroke-linejoin', value: v.paint('strokeLinejoin') },
  { name: 'paint-order', value: v.paint('paintOrder') },
] })
const AXIS_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [
  ...textAttributes('quadrant-axis-label', false), { name: 'transform', value: v.transform() },
] })
const TITLE_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: textAttributes('quadrant-title') })

// ============================================================================
// Quadrant chart SVG renderer
//
// The chart is first lowered to a SceneGraph (SPEC §3.1): every visual mark
// becomes a scene node carrying semantic fields (role, geometry, paint,
// channels, stable id). renderQuadrantSvg() uses DefaultBackend serialization of that scene.
//
// Visual language:
//   - a square plot area split into four quadrant background rectangles with
//     subtle theme-derived fills (color-mix from --accent + --bg)
//   - quadrant labels centered in each region
//   - x-axis labels on the bottom edge, y-axis labels (rotated) on the left
//   - points as accent circles with labels; per-point styles/classDefs
//     (upstream #5173: radius/color/stroke-color/stroke-width) resolved by
//     the layout flow into fill/stroke/radius here — the renderer never
//     re-resolves styles
//   - leader lines from a point to a far-placed label on dense charts
//   - optional hover tooltips (`interactive`, shared with xychart)
//   - an optional title centered above the plot
//
// Deterministic: no Math.random / Date.now. All geometry comes from layout.
// ============================================================================

/**
 * Render a positioned quadrant chart as an SVG string.
 */
export function renderQuadrantSvg(
  ctx: RenderContext<PositionedQuadrantChart>,
): string {
  return DefaultBackend.render(lowerQuadrantScene(ctx), { seed: 0 })
}

/**
 * Lower a positioned quadrant chart to the SceneGraph IR in canonical mark order.
 */
export function lowerQuadrantScene(
  ctx: RenderContext<PositionedQuadrantChart>,
): SceneDoc {
  const { positioned: chart, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const interactive = options.interactive ?? false
  const style = resolveRenderStyle(options, quadrantStyleDefaults(chart.visual), resolved.styleFace)
  const hasLeaders = chart.points.some(p => p.leader)
  const parts: SceneNode[] = []
  const accessibility = {
    title: chart.accessibility?.title ?? chart.title?.text,
    description: chart.accessibility?.description,
  }
  const namespace = `quadrant-${hashId(
    chart.width,
    chart.height,
    accessibility.title ?? '',
    accessibility.description ?? '',
    ...chart.points.flatMap(point => [point.label, point.nx, point.ny]),
  )}`
  const titleId = `${namespace}-title`
  const descId = `${namespace}-desc`

  // Document shell: SVG root with CSS variables + shared style block +
  // optional shadow defs + the quadrant CSS, joined exactly as the string
  // renderer pushed them. The shadow filter is derived purely from `colors`
  // (a prelude parameter), so it belongs to the shell a styled backend
  // re-derives rather than a standalone defs mark.
  const extraCss = quadrantStyles(chart, style, { leaders: hasLeaders, interactive })
  const rootAttributes = { id: namespace, ...buildAccessibilityAttrs(accessibility.title, accessibility.description, titleId, descId, 'quadrant chart') }
  parts.push(marks.documentOpen(
    { id: 'prelude', width: chart.width, height: chart.height, colors, transparent, font, hasMonoFont: false, extraCss },
    { kind: 'prelude', width: chart.width, height: chart.height, colors, transparent, font, hasMonoFont: false,
      ...(chart.visual.useMaxWidth ? { widthAttribute: '100%', heightAttribute: '100%', extraStyle: `max-width:${chart.width}px` } : {}),
      attributes: Object.entries(rootAttributes).map(([name, value]) => ({ name: name as SvgAttribute['name'], value: v.meta(value) })),
      children: [
        ...(accessibility.title ? [{ kind: 'documentText' as const, element: 'title' as const, domId: titleId, text: accessibility.title }] : []),
        ...(accessibility.description ? [{ kind: 'documentText' as const, element: 'desc' as const, domId: descId, text: accessibility.description }] : []),
        { kind: 'sharedStyle' }, ...(colors.shadow ? [{ kind: 'shadow' as const, colors, wrap: true }] : []),
        { kind: 'stylesheet', css: extraCss },
      ],
    },
  ))

  const { plot } = chart
  const half = plot.size / 2
  const dividerWidth = chart.visual.quadrantInternalBorderStrokeWidth ?? style.lineWidth
  const borderWidth = chart.visual.quadrantExternalBorderStrokeWidth ?? style.groupLineWidth

  // Quadrant background rectangles.
  for (const region of chart.regions) {
    const fill = quadrantFill(region.number, style)
    parts.push(marks.shape(
      {
        id: `plate:${region.number}`,
        role: 'plate',
        geometry: { kind: 'rect', x: region.x, y: region.y, width: region.width, height: region.height },
        paint: { fill, stroke: 'none' },
        channels: region.label ? { category: region.label } : undefined,
      },
      { kind: 'primitive', attributes: [
        { name: 'class', value: v.meta('quadrant-region') }, ...RECT_FIELDS.map(name => ({ name, value: v.geometry(name) })),
        { name: 'fill', value: v.paint('fill') }, { name: 'data-quadrant', value: v.meta(region.number) },
      ] },
    ))
  }

  // Internal divider lines.
  const midX = plot.x + half
  const midY = plot.y + half
  const dividerPaint = {
    stroke: style.edgeStrokeColor ?? 'var(--_line)',
    strokeWidth: String(dividerWidth),
  }
  parts.push(marks.shape(
    {
      id: 'divider:v',
      role: 'grid',
      geometry: { kind: 'line', x1: midX, y1: plot.y, x2: midX, y2: plot.y + plot.size },
      paint: dividerPaint,
    },
    DIVIDER_EMISSION,
  ))
  parts.push(marks.shape(
    {
      id: 'divider:h',
      role: 'grid',
      geometry: { kind: 'line', x1: plot.x, y1: midY, x2: plot.x + plot.size, y2: midY },
      paint: dividerPaint,
    },
    DIVIDER_EMISSION,
  ))

  // External border.
  parts.push(marks.shape(
    {
      id: 'border',
      role: 'chrome',
      geometry: { kind: 'rect', x: plot.x, y: plot.y, width: plot.size, height: plot.size },
      paint: {
        fill: 'none',
        stroke: style.groupBorderColor ?? style.nodeBorderColor ?? 'var(--_node-stroke)',
        strokeWidth: String(borderWidth),
      },
    },
    BORDER_EMISSION,
  ))

  // Quadrant labels.
  for (const region of chart.regions) {
    if (!region.label) continue
    const label = region.labelBlock?.text ?? region.label
    parts.push(marks.text(
      {
        id: `quadrant-label:${region.number}`,
        role: 'label',
        text: label,
        x: region.labelX,
        y: region.labelY,
        fontSize: style.groupHeaderFontSize,
        fontWeight: style.groupHeaderFontWeight, letterSpacing: style.groupLetterSpacing,
        block: region.labelBlock,
        anchor: 'middle',
        paint: { fill: style.groupTextColor ?? 'var(--_text-sec)' },
        channels: { category: region.label },
      },
      LABEL_EMISSION,
    ))
  }

  // Points. Interaction chrome (hover targets + tooltips) is collected into
  // an overlay appended after all data marks, mirroring the xychart pattern.
  const pointOverlay: SceneNode[] = []
  const pointOccurrences = new Map<string, number>()
  for (const point of chart.points) {
    const occurrence = pointOccurrences.get(point.label) ?? 0
    pointOccurrences.set(point.label, occurrence + 1)
    const pointId = occurrence === 0 ? `point:${point.label}` : `point:${point.label}#${occurrence}`
    // Leader line first so it paints under its circle and label.
    if (point.leader) {
      const l = point.leader
      parts.push(marks.shape(
        {
          id: `leader:${point.label}`,
          role: 'chrome',
          geometry: { kind: 'line', x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 },
          paint: { stroke: style.edgeStrokeColor ?? 'var(--_line)', strokeWidth: '1' },
        },
        LEADER_EMISSION,
      ))
    }

    const classAttr = point.className ? `quadrant-point ${point.className}` : 'quadrant-point'
    parts.push(marks.shape(
      {
        id: pointId,
        role: 'point',
        geometry: { kind: 'circle', cx: point.cx, cy: point.cy, r: point.radius },
        paint: {
          fill: point.fill ?? style.nodeFillColor ?? 'var(--accent, var(--_arrow))',
          stroke: point.stroke ?? style.nodeBorderColor ?? 'var(--bg)',
          strokeWidth: point.strokeWidth ?? String(Math.max(1, style.nodeLineWidth)),
        },
      },
      { kind: 'primitive', attributes: [
        { name: 'class', value: v.meta(classAttr), escape: 'xml' },
        ...(['cx', 'cy', 'r'] as const).map(name => ({ name, value: v.geometry(name) })),
        ...pointStyleAttributes(point),
        { name: 'data-label', value: v.meta(point.label), escape: 'xml' },
        { name: 'data-x', value: v.meta(point.nx) }, { name: 'data-y', value: v.meta(point.ny) },
      ] },
    ))
    if (!point.labelHidden) {
      // A point may sit on a divider, the border, or a leader: the label's
      // halo, in the surface beneath it, keeps those lines out of its glyphs.
      const halo = labelSurface(point, chart, style)
      parts.push(marks.text(
        {
          id: `${pointId}:label`,
          role: 'label',
          text: point.label,
          x: point.labelX,
          y: point.labelY,
          fontSize: style.nodeLabelFontSize,
          fontWeight: style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing,
          block: point.labelBlock,
          anchor: point.labelAnchor,
          paint: { fill: style.nodeTextColor ?? 'var(--_text)', stroke: halo, strokeWidth: String(POINT_LABEL_HALO_WIDTH), strokeLinejoin: 'round', paintOrder: 'stroke' },
        },
        POINT_TEXT_EMISSION,
      ))
    }

    if (interactive) {
      // Hover target + native title + tooltip: pure interaction chrome. The
      // tooltip carries the full label even when dense placement hid it.
      const tipText = `${point.label}: [${point.nx}, ${point.ny}]`
      const owner = { id: pointId, role: 'point' as const }
      pointOverlay.push(marks.group({ id: `tooltip:${pointId}`, role: 'chrome', owner,
        emission: HOVER_EMISSION, join: '', children: [
          { indent: 0, node: marks.shape({ id: `${pointId}:hit`, role: 'chrome', owner,
            geometry: { kind: 'circle', cx: point.cx, cy: point.cy, r: point.radius + 6 }, paint: { fill: 'transparent' },
          }, HIT_EMISSION) },
          { indent: 0, node: marks.documentContent({ id: `${pointId}:title`, role: 'chrome', nonPaint: 'interaction-metadata' }, { kind: 'documentText', element: 'title', text: tipText }) },
          { indent: 0, node: tooltipArtwork('quadrant', point.tooltip, `${pointId}:tooltip`, owner) },
        ],
      }))
    }
  }
  parts.push(...pointOverlay)

  // Axis labels.
  for (const axis of chart.axisLabels) {
    const lines = axis.text.split('\n')
    const label = lines.join('\n')
    // y-axis labels sit in the left gutter and are rotated upright.
    const isYAxis = axis.x < plot.x
    const rotation = isYAxis ? { kind: 'rotate' as const, angle: -90, cx: axis.x, cy: axis.y } : undefined
    const lineHeight = axis.block?.lineHeight ?? axis.fontSize * 1.3
    const labelY = axis.y + (lines.length - 1) * lineHeight / 2 - axis.fontSize * 0.35
    parts.push(marks.text(
      {
        id: `axis:${axis.text}`,
        role: 'axis',
        text: label,
        x: axis.x,
        y: labelY,
        fontSize: axis.fontSize,
        fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing,
        block: axis.block,
        anchor: axis.anchor,
        paint: { fill: style.edgeTextColor ?? 'var(--_text-muted)' },
        transform: rotation,
      },
      AXIS_EMISSION,
    ))
  }

  // Title.
  if (chart.title) {
    const title = chart.title.text
    parts.push(marks.text(
      {
        id: 'title',
        role: 'title',
        text: title,
        x: chart.title.x,
        y: chart.title.y,
        fontSize: chart.title.fontSize,
        fontWeight: Math.max(style.groupHeaderFontWeight, 600), letterSpacing: style.groupLetterSpacing,
        block: chart.title.block,
        anchor: 'middle',
        paint: { fill: style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)' },
      },
      TITLE_EMISSION,
    ))
  }

  parts.push(marks.documentClose())

  return { family: 'quadrant', width: chart.width, height: chart.height, colors, transparent, parts }
}

/** Inline style attribute for a point's resolved fill/stroke overrides.
 *  A style attribute (not presentation attributes) so the per-point values
 *  win over the .quadrant-point stylesheet rules. Empty for unstyled points,
 *  keeping their markup byte-identical to the pre-styling renderer. */
function pointStyleAttributes(point: PositionedQuadrantPoint): SvgAttribute[] {
  const declarations: Array<{ property: 'fill' | 'stroke' | 'stroke-width'; value: ReturnType<typeof v.paint> }> = []
  if (point.fill !== undefined) declarations.push({ property: 'fill', value: v.paint('fill') })
  if (point.stroke !== undefined) declarations.push({ property: 'stroke', value: v.paint('stroke') })
  if (point.strokeWidth !== undefined) declarations.push({ property: 'stroke-width', value: v.paint('strokeWidth') })
  return declarations.length ? [{ name: 'style', escape: 'xml', value: { source: 'style', declarations } }] : []
}

/** Stroke width of the surface-colored outline drawn under point labels. */
const POINT_LABEL_HALO_WIDTH = 3

/** The surface under a point label's center: its quadrant's fill, or the page
 *  when the label sits outside the plot. */
function labelSurface(point: PositionedQuadrantPoint, chart: PositionedQuadrantChart, style: ResolvedRenderStyle): string {
  const box = point.labelBox
  const x = box ? (box.x0 + box.x1) / 2 : point.labelX
  const y = box ? (box.y0 + box.y1) / 2 : point.labelY
  const region = chart.regions.find(region => x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height)
  return region ? quadrantFill(region.number, style) : 'var(--bg)'
}

/**
 * Per-quadrant background fill, derived from render-time theme variables.
 * Quadrants alternate two subtle accent tints so all four regions are visible.
 */
function quadrantFill(number: 1 | 2 | 3 | 4, style: ResolvedRenderStyle): string {
  const accentPct = number === 1 || number === 3 ? 10 : 5
  if (style.groupFillColor) {
    const groupPct = number === 1 || number === 3 ? 88 : 76
    return `color-mix(in srgb, ${style.groupFillColor} ${groupPct}%, var(--bg))`
  }
  return `color-mix(in srgb, var(--accent, var(--_arrow)) ${accentPct}%, var(--bg))`
}

function quadrantStyles(
  chart: PositionedQuadrantChart,
  style: ResolvedRenderStyle,
  opts: { leaders: boolean; interactive: boolean },
): string {
  const dividerWidth = chart.visual.quadrantInternalBorderStrokeWidth ?? style.lineWidth
  const borderWidth = chart.visual.quadrantExternalBorderStrokeWidth ?? style.groupLineWidth
  const leaderRule = opts.leaders
    ? `\n  .quadrant-leader { stroke: ${style.edgeStrokeColor ?? 'var(--_line)'}; stroke-width: 1; }`
    : ''
  const tipRules = opts.interactive ? tooltipCss('quadrant', ['quadrant-point-group']) : ''
  return `
  .quadrant-region { stroke: none; }
  .quadrant-divider { stroke: ${style.edgeStrokeColor ?? 'var(--_line)'}; stroke-width: ${dividerWidth}; }
  .quadrant-border { stroke: ${style.groupBorderColor ?? style.nodeBorderColor ?? 'var(--_node-stroke)'}; stroke-width: ${borderWidth}; }
  .quadrant-label { fill: ${style.groupTextColor ?? 'var(--_text-sec)'}; }
  .quadrant-point { fill: ${style.nodeFillColor ?? 'var(--accent, var(--_arrow))'}; stroke: ${style.nodeBorderColor ?? 'var(--bg)'}; stroke-width: ${Math.max(1, style.nodeLineWidth)}; }
  .quadrant-point-label { fill: ${style.nodeTextColor ?? 'var(--_text)'}; }
  .quadrant-axis-label { fill: ${style.edgeTextColor ?? 'var(--_text-muted)'}; }
  .quadrant-title { fill: ${style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)'}; }${leaderRule}${tipRules}
`
}
