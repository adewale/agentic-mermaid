import { sceneLowering, type DrawingFactory, type DrawingDocument } from '../scene/drawing.ts'
import type { PositionedQuadrantChart, PositionedQuadrantPoint } from './types.ts'
import type { RenderContext } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { escapeXml } from '../multiline-utils.ts'
import { quadrantStyleDefaults } from './layout.ts'
import { quadrantPointIds } from './parser.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { SceneNode } from '../scene/ir.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { drawTooltipArtwork, tooltipCss } from '../shared/svg-tooltip.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { hashId } from '../scene/seed.ts'

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
export function lowerQuadrantDrawing<T>(
  marks: DrawingFactory<T>,
  ctx: RenderContext<PositionedQuadrantChart>,
): DrawingDocument<T> {
  const { positioned: chart, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const interactive = options.interactive ?? false
  const style = resolveRenderStyle(options, quadrantStyleDefaults(chart.visual), resolved.styleFace)
  const parts: T[] = []
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
  // optional shadow defs + the tooltip CSS, joined exactly as the string
  // renderer pushed them. The shadow filter is derived purely from `colors`
  // (a prelude parameter), so it belongs to the shell a styled backend
  // re-derives rather than a standalone defs mark.
  const extraCss = quadrantStyles(interactive)
  const preludeSegments = [
    openQuadrantSvgTag(chart, colors, transparent, accessibility, namespace, titleId, descId),
  ]
  if (accessibility.title) preludeSegments.push(`<title id="${titleId}">${escapeXml(accessibility.title)}</title>`)
  if (accessibility.description) preludeSegments.push(`<desc id="${descId}">${escapeXml(accessibility.description)}</desc>`)
  preludeSegments.push(buildStyleBlock(font, false, colors.shadow, colors.embedFontImport))
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) preludeSegments.push(`<defs>${shadowDefs}</defs>`)
  if (extraCss) preludeSegments.push(extraCss)
  parts.push(marks.documentOpen(
    {
      id: 'prelude',
      width: chart.width,
      height: chart.height,
      colors,
      transparent,
      font,
      hasMonoFont: false,
      ...(extraCss ? { extraCss } : {}),
    },
    preludeSegments.join('\n'),
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
        attributes: { className: 'quadrant-region', data: { quadrant: String(region.number) } },
      },
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
      attributes: { className: 'quadrant-divider' },
    },
  ))
  parts.push(marks.shape(
    {
      id: 'divider:h',
      role: 'grid',
      geometry: { kind: 'line', x1: plot.x, y1: midY, x2: plot.x + plot.size, y2: midY },
      paint: dividerPaint,
      attributes: { className: 'quadrant-divider' },
    },
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
      attributes: { className: 'quadrant-border' },
    },
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
        fontWeight: style.groupHeaderFontWeight,
        letterSpacing: style.groupLetterSpacing,
        block: region.labelBlock,
        anchor: 'middle',
        dominantBaseline: 'middle',
        paint: { fill: style.groupTextColor ?? 'var(--_text-sec)' },
        channels: { category: region.label },
        attributes: { className: 'quadrant-label' },
      },
    ))
  }

  // Points. Interaction chrome (hover targets + tooltips) is collected into
  // an overlay appended after all data marks, mirroring the xychart pattern.
  const pointOverlay: T[] = []
  const pointIds = quadrantPointIds(chart.points.map(point => point.label))
  for (const [index, point] of chart.points.entries()) {
    const pointId = `point:${pointIds[index]!}`
    // Leader line first so it paints under its circle and label.
    if (point.leader) {
      const l = point.leader
      parts.push(marks.shape(
        {
          id: `leader:${pointIds[index]!}`,
          role: 'chrome',
          geometry: { kind: 'line', x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 },
          paint: { stroke: style.edgeStrokeColor ?? 'var(--_line)', strokeWidth: '1' },
          attributes: { className: 'quadrant-leader' },
        },
      ))
    }

    // Layout resolved per-point styles/classDefs into fill/stroke/radius; the
    // author's class name stays a CSS hook for external stylesheets.
    const className = point.className ? `quadrant-point ${point.className}` : 'quadrant-point'
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
        attributes: { className, data: { label: point.label, x: String(point.nx), y: String(point.ny) } },
      },
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
          fontWeight: style.nodeLabelFontWeight,
          letterSpacing: style.nodeLetterSpacing,
          block: point.labelBlock,
          anchor: point.labelAnchor,
          dominantBaseline: 'middle',
          paint: { fill: style.nodeTextColor ?? 'var(--_text)', stroke: halo, strokeWidth: String(POINT_LABEL_HALO_WIDTH), strokeLinejoin: 'round', paintOrder: 'stroke' },
          attributes: { className: 'quadrant-point-label' },
        },
      ))
    }

    if (interactive) {
      // Hover target + native title + tooltip: pure interaction chrome. The
      // tooltip carries the full label even when dense placement hid it.
      const tipText = `${point.label}: [${point.nx}, ${point.ny}]`
      const owner = { id: pointId, role: 'point' as const }
      pointOverlay.push(marks.group({ id: `tooltip:${pointId}`, role: 'chrome', owner,
        open: '<g class="quadrant-point-group">', close: '</g>', join: '', children: [
          { indent: 0, node: marks.shape({ id: `${pointId}:hit`, role: 'chrome', owner,
            geometry: { kind: 'circle', cx: point.cx, cy: point.cy, r: point.radius + 6 }, paint: { fill: 'transparent' },
          }) },
          { indent: 0, node: marks.documentContent({ id: `${pointId}:title`, role: 'chrome', nonPaint: 'interaction-metadata' }, `<title>${escapeXml(tipText)}</title>`) },
          { indent: 0, node: drawTooltipArtwork(marks, 'quadrant', point.tooltip, `${pointId}:tooltip`, owner) },
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
        fontWeight: style.edgeLabelFontWeight,
        letterSpacing: style.edgeLetterSpacing,
        block: axis.block,
        anchor: axis.anchor,
        paint: { fill: style.edgeTextColor ?? 'var(--_text-muted)' },
        transform: rotation,
        attributes: { className: 'quadrant-axis-label' },
      },
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
        fontWeight: Math.max(style.groupHeaderFontWeight, 600),
        letterSpacing: style.groupLetterSpacing,
        block: chart.title.block,
        anchor: 'middle',
        dominantBaseline: 'middle',
        paint: { fill: style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)' },
        attributes: { className: 'quadrant-title' },
      },
    ))
  }

  parts.push(marks.documentClose())

  return { family: 'quadrant', width: chart.width, height: chart.height, colors, transparent, parts }
}

function openQuadrantSvgTag(
  chart: PositionedQuadrantChart,
  colors: DiagramColors,
  transparent: boolean,
  accessibility: { title?: string; description?: string },
  namespace: string,
  titleId: string,
  descId: string,
): string {
  // Wired base-config useMaxWidth (upstream semantics, xychart parity): a
  // responsive root capped at the layout width. Absent/false keeps the
  // historical fixed pixel sizing.
  const overrides = chart.visual.useMaxWidth
    ? { width: '100%', height: '100%', style: `max-width:${chart.width}px` }
    : {}
  return svgOpenTag(chart.width, chart.height, colors, transparent, {
    ...overrides,
    attrs: {
      id: namespace,
      ...buildAccessibilityAttrs(accessibility.title, accessibility.description, titleId, descId, 'quadrant chart'),
    },
  })
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

/** Every visible mark is painted from its typed fields, so the stylesheet
 *  holds only the hover tooltip rules, and only an interactive chart has one. */
function quadrantStyles(interactive: boolean): string | undefined {
  return interactive ? `<style>${tooltipCss('quadrant', ['quadrant-point-group'])}\n</style>` : undefined
}

export const lowerQuadrantScene = sceneLowering<PositionedQuadrantChart>(lowerQuadrantDrawing)
