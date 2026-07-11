import type { PositionedQuadrantChart, PositionedQuadrantPoint } from './types.ts'
import type { RenderContext } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { renderMultilineText, escapeXml } from '../multiline-utils.ts'
import { quadrantStyleDefaults } from './layout.ts'
import { applyTextTransform, resolveRenderStyle } from '../styles.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { tooltipMarkup, tooltipCss } from '../shared/svg-tooltip.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { hashId } from '../scene/seed.ts'

// ============================================================================
// Quadrant chart SVG renderer
//
// The chart is first lowered to a SceneGraph (SPEC §3.1): every visual mark
// becomes a scene node carrying semantic fields (role, geometry, paint,
// channels, stable id) plus its exact crisp serialization, built here from
// the same inputs. renderQuadrantSvg() is DefaultBackend serialization of
// that scene, so the default path stays byte-identical to the historical
// string renderer (corpus-gated by svg-equivalence.test.ts).
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
 * Lower a positioned quadrant chart to the SceneGraph IR. Mark order matches
 * the historical parts[] order exactly; DefaultBackend joins crisps with '\n'.
 */
export function lowerQuadrantScene(
  ctx: RenderContext<PositionedQuadrantChart>,
): SceneDoc {
  const { positioned: chart, colors, options } = ctx
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const interactive = options.interactive ?? false
  const style = resolveRenderStyle(options, quadrantStyleDefaults(chart.visual))
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
  const preludeSegments = [
    openQuadrantSvgTag(chart, colors, transparent, accessibility, namespace, titleId, descId),
  ]
  if (accessibility.title) preludeSegments.push(`<title id="${titleId}">${escapeXml(accessibility.title)}</title>`)
  if (accessibility.description) preludeSegments.push(`<desc id="${descId}">${escapeXml(accessibility.description)}</desc>`)
  preludeSegments.push(buildStyleBlock(font, false, colors.shadow, colors.embedFontImport))
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) preludeSegments.push(`<defs>${shadowDefs}</defs>`)
  preludeSegments.push(extraCss)
  parts.push(marks.prelude(
    {
      id: 'prelude',
      width: chart.width,
      height: chart.height,
      colors,
      transparent,
      font,
      hasMonoFont: false,
      extraCss,
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
      },
      `<rect class="quadrant-region" x="${region.x}" y="${region.y}" ` +
        `width="${region.width}" height="${region.height}" fill="${fill}" ` +
        `data-quadrant="${region.number}" />`,
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
    `<line class="quadrant-divider" x1="${midX}" y1="${plot.y}" x2="${midX}" y2="${plot.y + plot.size}" />`,
  ))
  parts.push(marks.shape(
    {
      id: 'divider:h',
      role: 'grid',
      geometry: { kind: 'line', x1: plot.x, y1: midY, x2: plot.x + plot.size, y2: midY },
      paint: dividerPaint,
    },
    `<line class="quadrant-divider" x1="${plot.x}" y1="${midY}" x2="${plot.x + plot.size}" y2="${midY}" />`,
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
    `<rect class="quadrant-border" x="${plot.x}" y="${plot.y}" width="${plot.size}" height="${plot.size}" fill="none" />`,
  ))

  // Quadrant labels.
  for (const region of chart.regions) {
    if (!region.label) continue
    const label = applyTextTransform(region.label, style.groupTextTransform)
    parts.push(marks.text(
      {
        id: `quadrant-label:${region.number}`,
        role: 'label',
        text: label,
        x: region.labelX,
        y: region.labelY,
        fontSize: style.groupHeaderFontSize,
        anchor: 'middle',
        paint: { fill: style.groupTextColor ?? 'var(--_text-sec)' },
        channels: { category: region.label },
      },
      renderMultilineText(
        label,
        region.labelX,
        region.labelY,
        style.groupHeaderFontSize,
        `class="quadrant-label" text-anchor="middle" dominant-baseline="middle" ` +
          `font-size="${style.groupHeaderFontSize}" font-weight="${style.groupHeaderFontWeight}"${letterAttr(style.groupLetterSpacing)}`,
      ),
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
        `<line class="quadrant-leader" x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" />`,
      ))
    }

    const overrides = pointStyleAttr(point)
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
      `<circle class="${escapeXml(classAttr)}" cx="${point.cx}" cy="${point.cy}" r="${point.radius}"${overrides} ` +
        `data-label="${escapeXml(point.label)}" data-x="${point.nx}" data-y="${point.ny}" />`,
    ))
    if (!point.labelHidden) {
      parts.push(marks.text(
        {
          id: `${pointId}:label`,
          role: 'label',
          text: point.label,
          x: point.labelX,
          y: point.labelY,
          fontSize: style.nodeLabelFontSize,
          anchor: point.labelAnchor,
          paint: { fill: style.nodeTextColor ?? 'var(--_text)' },
        },
        renderMultilineText(
          point.label,
          point.labelX,
          point.labelY,
          style.nodeLabelFontSize,
          `class="quadrant-point-label" text-anchor="${point.labelAnchor}" dominant-baseline="middle" ` +
            `font-size="${style.nodeLabelFontSize}" font-weight="${style.nodeLabelFontWeight}"${letterAttr(style.nodeLetterSpacing)}`,
        ),
      ))
    }

    if (interactive) {
      // Hover target + native title + tooltip: pure interaction chrome. The
      // tooltip carries the full label even when dense placement hid it.
      const tipText = `${point.label}: [${point.nx}, ${point.ny}]`
      pointOverlay.push(marks.raw({ id: `tooltip:${pointId}`, role: 'chrome' },
        `<g class="quadrant-point-group">` +
        `<circle cx="${point.cx}" cy="${point.cy}" r="${point.radius + 6}" fill="transparent"/>` +
        `<title>${escapeXml(tipText)}</title>` +
        tooltipMarkup('quadrant', point.cx, point.cy - point.radius, tipText) +
        `</g>`,
      ))
    }
  }
  parts.push(...pointOverlay)

  // Axis labels.
  for (const axis of chart.axisLabels) {
    const lines = axis.text.split('\n').map(line => applyTextTransform(line, style.edgeTextTransform))
    const label = lines.join('\n')
    // y-axis labels sit in the left gutter and are rotated upright.
    const isYAxis = axis.x < plot.x
    const transform = isYAxis ? ` transform="rotate(-90 ${axis.x} ${axis.y})"` : ''
    const textMarkup = lines.length === 1
      ? escapeXml(label)
      : lines.map((line, index) => `<tspan x="${axis.x}" dy="${index === 0 ? 0 : '1.1em'}">${escapeXml(line)}</tspan>`).join('')
    parts.push(marks.text(
      {
        id: `axis:${axis.text}`,
        role: 'axis',
        text: label,
        x: axis.x,
        y: axis.y,
        fontSize: axis.fontSize,
        anchor: axis.anchor,
        paint: { fill: style.edgeTextColor ?? 'var(--_text-muted)' },
      },
      `<text class="quadrant-axis-label" x="${axis.x}" y="${axis.y}" ` +
        `text-anchor="${axis.anchor}" font-size="${axis.fontSize}" font-weight="${style.edgeLabelFontWeight}"${letterAttr(style.edgeLetterSpacing)}${transform}>` +
        `${textMarkup}</text>`,
    ))
  }

  // Title.
  if (chart.title) {
    const title = applyTextTransform(chart.title.text, style.groupTextTransform)
    parts.push(marks.text(
      {
        id: 'title',
        role: 'title',
        text: title,
        x: chart.title.x,
        y: chart.title.y,
        fontSize: chart.title.fontSize,
        anchor: 'middle',
        paint: { fill: style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)' },
      },
      renderMultilineText(
        title,
        chart.title.x,
        chart.title.y,
        chart.title.fontSize,
        `class="quadrant-title" text-anchor="middle" dominant-baseline="middle" ` +
          `font-size="${chart.title.fontSize}" font-weight="${Math.max(style.groupHeaderFontWeight, 600)}"${letterAttr(style.groupLetterSpacing)}`,
      ),
    ))
  }

  parts.push(marks.raw({ id: 'svg-close', role: 'chrome' }, '</svg>'))

  return { family: 'quadrant', width: chart.width, height: chart.height, colors, parts }
}

/** Inline style attribute for a point's resolved fill/stroke overrides.
 *  A style attribute (not presentation attributes) so the per-point values
 *  win over the .quadrant-point stylesheet rules. Empty for unstyled points,
 *  keeping their markup byte-identical to the pre-styling renderer. */
function pointStyleAttr(point: PositionedQuadrantPoint): string {
  const decls: string[] = []
  if (point.fill !== undefined) decls.push(`fill:${point.fill}`)
  if (point.stroke !== undefined) decls.push(`stroke:${point.stroke}`)
  if (point.strokeWidth !== undefined) decls.push(`stroke-width:${point.strokeWidth}`)
  return decls.length > 0 ? ` style="${escapeXml(decls.join(';'))}"` : ''
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
  return `<style>
  .quadrant-region { stroke: none; }
  .quadrant-divider { stroke: ${style.edgeStrokeColor ?? 'var(--_line)'}; stroke-width: ${dividerWidth}; }
  .quadrant-border { stroke: ${style.groupBorderColor ?? style.nodeBorderColor ?? 'var(--_node-stroke)'}; stroke-width: ${borderWidth}; }
  .quadrant-label { fill: ${style.groupTextColor ?? 'var(--_text-sec)'}; }
  .quadrant-point { fill: ${style.nodeFillColor ?? 'var(--accent, var(--_arrow))'}; stroke: ${style.nodeBorderColor ?? 'var(--bg)'}; stroke-width: ${Math.max(1, style.nodeLineWidth)}; }
  .quadrant-point-label { fill: ${style.nodeTextColor ?? 'var(--_text)'}; }
  .quadrant-axis-label { fill: ${style.edgeTextColor ?? 'var(--_text-muted)'}; }
  .quadrant-title { fill: ${style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)'}; }${leaderRule}${tipRules}
</style>`
}

function letterAttr(value: number): string {
  return value !== 0 ? ` letter-spacing="${value}"` : ''
}
