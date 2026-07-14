import type { PositionedRadarChart } from './types.ts'
import type { RenderContext } from '../types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs } from '../theme.ts'
import { escapeXml } from '../multiline-utils.ts'
import { radarStyleDefaults } from './layout.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import { pieSliceColors } from '../pie/palette.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { hashId } from '../scene/seed.ts'

// ============================================================================
// Radar chart SVG renderer
//
// The chart is first lowered to a SceneGraph (SPEC §3.1): every visual mark
// becomes a scene node carrying semantic fields (role, geometry, paint,
// channels, stable id) plus its exact crisp serialization, built here from the
// same inputs. renderRadarSvg() is DefaultBackend serialization of that scene.
//
// Reuse-only mark roles (no new SceneRole / scene-substrate changes):
//   graticule rings + spokes → 'grid' (crisp scaffold, never sketched)
//   curve fill area          → 'pie-slice' (an existing filled chart-data role
//                              already in SKETCH_SHAPE_ROLES, so it inherits the
//                              hand-drawn/wash fill treatment under styled looks)
//   vertex dots              → 'point'
//   axis + ring labels       → 'axis'   legend → 'legend'   title → 'title'
//
// Per-curve colors come from the shared chart palette (pieSliceColors), so a
// single radar renders correctly across every built-in Palette (the renderer
// re-derives fills from RenderContext.colors) and matches pie/xychart identity.
//
// Deterministic: no Math.random / Date.now. All geometry comes from layout.
// ============================================================================

export function renderRadarSvg(ctx: RenderContext<PositionedRadarChart>): string {
  return DefaultBackend.render(lowerRadarScene(ctx), { seed: 0 })
}

export function lowerRadarScene(ctx: RenderContext<PositionedRadarChart>): SceneDoc {
  const { positioned: chart, colors, resolved } = ctx
  const options = resolved.renderOptions
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const style = resolveRenderStyle(options, radarStyleDefaults(chart.visual), resolved.styleFace)
  const parts: SceneNode[] = []

  const fills = pieSliceColors(chart.curves.length, {
    accent: colors.accent,
    bg: colors.bg,
    overrides: chart.visual.paletteOverrides,
  })
  const curveOpacity = chart.visual.curveOpacity ?? 0.5
  const axisColor = chart.visual.axisColor ?? style.edgeStrokeColor ?? 'var(--_line)'
  const graticuleColor = chart.visual.graticuleColor ?? style.edgeStrokeColor ?? 'var(--_line)'
  const axisStrokeWidth = chart.visual.axisStrokeWidth ?? 1
  const graticuleStrokeWidth = chart.visual.graticuleStrokeWidth ?? 1
  const graticuleOpacity = chart.visual.graticuleOpacity ?? 0.7
  const axisTextColor = style.edgeTextColor ?? 'var(--_text-muted)'
  const titleColor = chart.visual.titleColor ?? style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)'
  const dotStroke = style.nodeBorderColor ?? 'var(--bg)'

  const accessibility = {
    title: chart.accessibility?.title ?? chart.title?.text ?? 'Radar chart',
    description: chart.accessibility?.description,
  }
  const duplicateAxisIds = repeatedValues(chart.axes.map(axis => axis.id))
  const duplicateCurveIds = repeatedValues(chart.curves.map(curve => curve.id))
  const namespaceParts: Array<string | number> = [chart.width, chart.height, accessibility.title ?? '']
  for (const axis of chart.axes) namespaceParts.push(axis.id)
  for (const curve of chart.curves) namespaceParts.push(curve.label)
  // Passing one joined string is byte-equivalent to hashId(...namespaceParts)
  // without an input-sized JavaScript argument list.
  const namespace = `radar-${hashId(namespaceParts.join('|'))}`
  const titleId = `${namespace}-title`
  const descId = `${namespace}-desc`

  // Document shell.
  const extraCss = radarStyles(
    style, axisColor, graticuleColor, axisTextColor, titleColor, dotStroke,
    axisStrokeWidth, graticuleStrokeWidth, graticuleOpacity, curveOpacity,
  )
  const preludeSegments = [
    openRadarSvgTag(chart, colors, transparent, accessibility, namespace, titleId, descId),
  ]
  if (accessibility.title) preludeSegments.push(`<title id="${titleId}">${escapeXml(accessibility.title)}</title>`)
  if (accessibility.description) preludeSegments.push(`<desc id="${descId}">${escapeXml(accessibility.description)}</desc>`)
  preludeSegments.push(buildStyleBlock(font, false, colors.shadow, colors.embedFontImport))
  const shadowDefs = buildShadowDefs(colors)
  if (shadowDefs) preludeSegments.push(`<defs>${shadowDefs}</defs>`)
  preludeSegments.push(extraCss)
  parts.push(marks.prelude(
    { id: 'prelude', width: chart.width, height: chart.height, colors, transparent, font, hasMonoFont: false, extraCss },
    preludeSegments.join('\n'),
  ))

  // Graticule rings (back-most).
  for (let k = 0; k < chart.rings.length; k++) {
    const ring = chart.rings[k]!
    const cls = `radar-ring${ring.emphasized ? ' radar-ring-outer' : ''}`
    if (chart.polygonGraticule) {
      const pts = ring.points.map(p => `${p.x},${p.y}`).join(' ')
      parts.push(marks.shape(
        {
          id: `ring:${k}`,
          role: 'grid',
          geometry: { kind: 'polygon', points: ring.points },
          paint: { fill: 'none', stroke: graticuleColor, strokeWidth: String(ring.emphasized ? graticuleStrokeWidth * 1.4 : graticuleStrokeWidth) },
        },
        `<polygon class="${cls}" points="${pts}" fill="none" />`,
      ))
    } else {
      parts.push(marks.shape(
        {
          id: `ring:${k}`,
          role: 'grid',
          geometry: { kind: 'circle', cx: chart.cx, cy: chart.cy, r: ring.r },
          paint: { fill: 'none', stroke: graticuleColor, strokeWidth: String(ring.emphasized ? graticuleStrokeWidth * 1.4 : graticuleStrokeWidth) },
        },
        `<circle class="${cls}" cx="${chart.cx}" cy="${chart.cy}" r="${ring.r}" fill="none" />`,
      ))
    }
  }

  // Spokes.
  for (const [axisIndex, axis] of chart.axes.entries()) {
    const identity = occurrenceIdentity(axis.id, axisIndex, duplicateAxisIds)
    parts.push(marks.shape(
      {
        id: `spoke:${identity}`,
        role: 'grid',
        geometry: { kind: 'line', x1: chart.cx, y1: chart.cy, x2: axis.x, y2: axis.y },
        paint: { stroke: axisColor, strokeWidth: String(axisStrokeWidth) },
      },
      `<line class="radar-axis-line" x1="${chart.cx}" y1="${chart.cy}" x2="${axis.x}" y2="${axis.y}" />`,
    ))
  }

  // Curve areas (reuse the pie-slice filled-data role so styled looks sketch
  // them). Drawn back-to-front in source order; a value-count mismatch draws
  // nothing but still legends (upstream parity).
  for (const [curveIndex, curve] of chart.curves.entries()) {
    if (curve.arityMismatch || curve.vertices.length === 0) continue
    const identity = occurrenceIdentity(curve.id, curveIndex, duplicateCurveIds)
    const fill = fills[curve.colorIndex]!
    if (chart.polygonGraticule) {
      const pts = curve.vertices.map(p => `${p.x},${p.y}`).join(' ')
      parts.push(marks.shape(
        {
          id: `curve:${identity}`,
          role: 'pie-slice',
          geometry: { kind: 'polygon', points: curve.vertices },
          paint: { fill, stroke: fill, strokeWidth: String(style.nodeLineWidth), opacity: String(curveOpacity) },
          channels: { category: curve.label },
        },
        `<polygon class="radar-area" points="${pts}" fill="${escapeXml(fill)}" stroke="${escapeXml(fill)}" ` +
          `fill-opacity="${curveOpacity}" data-curve="${escapeXml(curve.label)}" />`,
      ))
    } else {
      parts.push(marks.shape(
        {
          id: `curve:${identity}`,
          role: 'pie-slice',
          geometry: { kind: 'path', d: curve.areaPath },
          paint: { fill, stroke: fill, strokeWidth: String(style.nodeLineWidth), opacity: String(curveOpacity) },
          channels: { category: curve.label },
        },
        `<path class="radar-area" d="${curve.areaPath}" fill="${escapeXml(fill)}" stroke="${escapeXml(fill)}" ` +
          `fill-opacity="${curveOpacity}" data-curve="${escapeXml(curve.label)}" />`,
      ))
    }
  }

  // Vertex dots on top of the areas.
  for (const [curveIndex, curve] of chart.curves.entries()) {
    if (curve.arityMismatch) continue
    const identity = occurrenceIdentity(curve.id, curveIndex, duplicateCurveIds)
    const fill = fills[curve.colorIndex]!
    curve.vertices.forEach((v, vi) => {
      parts.push(marks.shape(
        {
          id: `dot:${identity}:${vi}`,
          role: 'point',
          geometry: { kind: 'circle', cx: v.x, cy: v.y, r: 3 },
          paint: { fill, stroke: dotStroke, strokeWidth: '1.2' },
          channels: { category: curve.label },
        },
        `<circle class="radar-dot" cx="${v.x}" cy="${v.y}" r="3" fill="${escapeXml(fill)}" />`,
      ))
    })
  }

  // Ring value labels (Agentic extension).
  for (let i = 0; i < chart.tickLabels.length; i++) {
    const t = chart.tickLabels[i]!
    parts.push(marks.text(
      {
        id: `tick:${i}`,
        role: 'axis',
        text: t.text,
        x: t.x,
        y: t.y,
        fontSize: 9.5,
        anchor: 'middle',
        paint: { fill: axisTextColor },
      },
      `<text class="radar-tick-label" x="${t.x}" y="${t.y}" text-anchor="middle" dominant-baseline="middle" font-size="9.5">${escapeXml(t.text)}</text>`,
    ))
  }

  // Axis labels (wrapped, radial, outside the outer ring).
  for (const [axisIndex, axis] of chart.axes.entries()) {
    const identity = occurrenceIdentity(axis.id, axisIndex, duplicateAxisIds)
    const lines = axis.lines
    const shift = -(lines.length - 1) * 0.6
    const tspans = lines
      .map((line, li) => `<tspan x="${axis.labelX}" dy="${li === 0 ? `${shift}em` : '1.2em'}">${escapeXml(line)}</tspan>`)
      .join('')
    parts.push(marks.text(
      {
        id: `axis-label:${identity}`,
        role: 'axis',
        text: lines.join('\n'),
        x: axis.labelX,
        y: axis.labelY,
        fontSize: style.edgeLabelFontSize,
        anchor: axis.anchor,
        paint: { fill: axisTextColor },
      },
      `<text class="radar-axis-label" x="${axis.labelX}" y="${axis.labelY}" text-anchor="${axis.anchor}" ` +
        `dominant-baseline="middle" font-size="${style.edgeLabelFontSize}" font-weight="${style.edgeLabelFontWeight}">${tspans}</text>`,
    ))
  }

  // Legend.
  for (const item of chart.legend) {
    const fill = fills[item.colorIndex]!
    parts.push(marks.shape(
      {
        id: `legend-swatch:${item.colorIndex}`,
        role: 'legend',
        geometry: { kind: 'rect', x: item.x, y: item.y, width: item.swatchSize, height: item.swatchSize, rx: 2, ry: 2 },
        paint: { fill, stroke: style.nodeBorderColor ?? 'var(--_node-stroke)', strokeWidth: '1' },
        channels: { category: item.label },
      },
      `<rect class="radar-legend-swatch" x="${item.x}" y="${item.y}" width="${item.swatchSize}" height="${item.swatchSize}" rx="2" ry="2" fill="${escapeXml(fill)}" />`,
    ))
    parts.push(marks.text(
      {
        id: `legend-label:${item.colorIndex}`,
        role: 'legend',
        text: item.label,
        x: item.textX,
        y: item.textY,
        fontSize: style.nodeLabelFontSize,
        anchor: 'start',
        paint: { fill: style.nodeTextColor ?? 'var(--_text)' },
      },
      `<text class="radar-legend-text" x="${item.textX}" y="${item.textY}" text-anchor="start" dominant-baseline="middle" ` +
        `font-size="${style.nodeLabelFontSize}" font-weight="${style.nodeLabelFontWeight}">${escapeXml(item.label)}</text>`,
    ))
  }

  // Title.
  if (chart.title) {
    parts.push(marks.text(
      {
        id: 'title',
        role: 'title',
        text: chart.title.text,
        x: chart.title.x,
        y: chart.title.y,
        fontSize: chart.title.fontSize,
        anchor: 'middle',
        paint: { fill: titleColor },
      },
      `<text class="radar-title" x="${chart.title.x}" y="${chart.title.y}" text-anchor="middle" dominant-baseline="middle" ` +
        `font-size="${chart.title.fontSize}" font-weight="${Math.max(style.groupHeaderFontWeight, 600)}">${escapeXml(chart.title.text)}</text>`,
    ))
  }

  parts.push(marks.documentClose())

  return { family: 'radar', width: chart.width, height: chart.height, colors, parts }
}

function openRadarSvgTag(
  chart: PositionedRadarChart,
  colors: DiagramColors,
  transparent: boolean,
  accessibility: { title?: string; description?: string },
  namespace: string,
  titleId: string,
  descId: string,
): string {
  const overrides = chart.visual.useMaxWidth
    ? { width: '100%', height: '100%', style: `max-width:${chart.width}px` }
    : {}
  return svgOpenTag(chart.width, chart.height, colors, transparent, {
    ...overrides,
    attrs: {
      id: namespace,
      'aria-roledescription': 'radar chart',
      ...buildAccessibilityAttrs(accessibility.title, accessibility.description, titleId, descId, 'radar chart'),
    },
  })
}

function repeatedValues(values: readonly string[]): ReadonlySet<string> {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return new Set([...counts].filter(([, count]) => count > 1).map(([value]) => value))
}

function occurrenceIdentity(value: string, index: number, repeated: ReadonlySet<string>): string {
  return repeated.has(value) ? `${value}#${index}` : value
}

function radarStyles(
  style: ResolvedRenderStyle,
  axisColor: string,
  graticuleColor: string,
  axisTextColor: string,
  titleColor: string,
  dotStroke: string,
  axisStrokeWidth: number,
  graticuleStrokeWidth: number,
  graticuleOpacity: number,
  curveOpacity: number,
): string {
  return `<style>
  .radar-ring { stroke: ${graticuleColor}; stroke-width: ${graticuleStrokeWidth}; stroke-opacity: ${graticuleOpacity}; fill: none; }
  .radar-ring-outer { stroke-width: ${graticuleStrokeWidth * 1.4}; stroke-opacity: 1; }
  .radar-axis-line { stroke: ${axisColor}; stroke-width: ${axisStrokeWidth}; }
  .radar-area { stroke-width: ${style.nodeLineWidth}; fill-opacity: ${curveOpacity}; stroke-linejoin: round; }
  .radar-dot { stroke: ${dotStroke}; stroke-width: 1.2; }
  .radar-axis-label { fill: ${axisTextColor}; }
  .radar-tick-label { fill: ${axisTextColor}; opacity: 0.85; }
  .radar-legend-swatch { stroke: ${style.nodeBorderColor ?? 'var(--_node-stroke)'}; stroke-width: 1; }
  .radar-legend-text { fill: ${style.nodeTextColor ?? 'var(--_text)'}; }
  .radar-title { fill: ${titleColor}; }
</style>`
}
