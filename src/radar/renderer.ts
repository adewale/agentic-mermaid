import type { PositionedRadarChart } from './types.ts'
import type { RenderContext } from '../types.ts'
import { radarStyleDefaults } from './layout.ts'
import { resolveRenderStyle } from '../styles.ts'
import { pieSliceColors } from '../pie/palette.ts'
import { wcagCssContrastRatio } from '../shared/color-math.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { hashId } from '../scene/seed.ts'
import { resolveRoleStyle } from '../scene/style-registry.ts'
import { snapshotSvgEmissionRecipe, svgValue as v, type SvgAttribute, type SvgEmissionRecipe, type SvgGeometryField } from '../scene/svg-emission.ts'
import type { MarkPaint } from '../scene/ir.ts'

const PAINT_ATTRIBUTES: readonly SvgAttribute[] = [
  { name: 'fill', value: v.paint('fill') }, { name: 'stroke', value: v.paint('stroke') }, { name: 'stroke-width', value: v.paint('strokeWidth') },
  { name: 'stroke-dasharray', value: v.paint('strokeDasharray') }, { name: 'stroke-linecap', value: v.paint('strokeLinecap') },
  { name: 'stroke-linejoin', value: v.paint('strokeLinejoin') }, { name: 'opacity', value: v.paint('opacity') },
  { name: 'fill-opacity', value: v.paint('fillOpacity') }, { name: 'stroke-opacity', value: v.paint('strokeOpacity') },
]
function primitive(className: string, geometry: readonly SvgGeometryField[], extra: readonly SvgAttribute[] = []): SvgEmissionRecipe {
  return snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
    { name: 'class', value: v.meta(className) }, ...geometry.map(name => ({ name, value: v.geometry(name) })), ...extra,
    ...PAINT_ATTRIBUTES.filter(attribute => !extra.some(other => other.name === attribute.name)),
  ] })
}

function paintStyle(properties: readonly (readonly ['fill' | 'stroke' | 'stroke-width', keyof MarkPaint])[]): SvgAttribute {
  return { name: 'style', escape: 'xml', value: { source: 'style', declarations: properties.map(([property, field]) => ({ property, value: v.paint(field) })) } }
}

const RING_EMISSIONS = [false, true].map(emphasized => ({
  polygon: primitive(`radar-ring${emphasized ? ' radar-ring-outer' : ''}`, ['points'], [{ name: 'fill', value: v.paint('fill') }]),
  circle: primitive(`radar-ring${emphasized ? ' radar-ring-outer' : ''}`, ['cx', 'cy', 'r'], [{ name: 'fill', value: v.paint('fill') }]),
}))
const SPOKE_EMISSION = primitive('radar-axis-line', ['x1', 'y1', 'x2', 'y2'])
const LEADER_EMISSION = primitive('radar-leader', ['x1', 'y1', 'x2', 'y2'])
const TICK_BOX_EMISSION = primitive('radar-tick-box', ['x', 'y', 'width', 'height', 'rx', 'ry'])
const PAINT_STYLE = paintStyle([['fill', 'fill'], ['stroke', 'stroke'], ['stroke-width', 'strokeWidth']])
const AREA_EMISSIONS = [false, true].map(inline => ({
  polygon: primitive('radar-area', ['points'], [
    { name: 'fill', value: v.paint('fill'), escape: 'xml' }, { name: 'stroke', value: v.paint('stroke'), escape: 'xml' },
    ...(inline ? [paintStyle([['stroke-width', 'strokeWidth']])] : []),
    { name: 'fill-opacity', value: v.paint('fillOpacity') }, { name: 'data-curve', value: v.channel('category') },
  ]),
  path: primitive('radar-area', ['d'], [
    { name: 'fill', value: v.paint('fill'), escape: 'xml' }, { name: 'stroke', value: v.paint('stroke'), escape: 'xml' },
    ...(inline ? [paintStyle([['stroke-width', 'strokeWidth']])] : []),
    { name: 'fill-opacity', value: v.paint('fillOpacity') }, { name: 'data-curve', value: v.channel('category') },
  ]),
}))
const DOT_EMISSIONS = [false, true].map(inline => primitive('radar-dot', ['cx', 'cy', 'r'], [
  { name: 'fill', value: v.paint('fill'), escape: 'xml' }, ...(inline ? [PAINT_STYLE] : []),
]))
const SWATCH_EMISSIONS = [false, true].map(inline => primitive('radar-legend-swatch', ['x', 'y', 'width', 'height', 'rx', 'ry'], [
  { name: 'fill', value: v.paint('fill'), escape: 'xml' }, ...(inline ? [PAINT_STYLE] : []), { name: 'fill-opacity', value: v.paint('fillOpacity') },
]))

function textAttributes(className: string, leading: readonly SvgAttribute[] = []): SvgAttribute[] {
  return [
    { name: 'class', value: v.meta(className) }, ...leading,
    { name: 'text-anchor', value: v.text('anchor') }, { name: 'dominant-baseline', value: v.meta('middle') },
    { name: 'font-size', value: v.text('fontSize') }, { name: 'font-weight', value: v.text('fontWeight') }, { name: 'fill', value: v.paint('fill') },
    { name: 'letter-spacing', value: v.text('letterSpacing'), omit: 'zero' },
  ]
}
const TICK_TEXT_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'direct', attributes: textAttributes('radar-tick-label', [
  { name: 'x', value: v.text('x') }, { name: 'y', value: v.text('y') },
]) })
const AXIS_TEXT_ATTRIBUTES = textAttributes('radar-axis-label', [{ name: 'aria-label', value: v.text('source') }])
const AXIS_TEXT_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', baselineShift: 0, attributes: AXIS_TEXT_ATTRIBUTES })
const LEGEND_TEXT_EMISSIONS = [false, true].map(inline => snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', baselineShift: 0, attributes: [
  ...textAttributes('radar-legend-text'), ...(inline ? [paintStyle([['fill', 'fill']])] : []),
] }))
const TITLE_TEXT_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', baselineShift: 0, attributes: textAttributes('radar-title') })

// ============================================================================
// Radar chart SVG renderer
//
// The chart is first lowered to a SceneGraph (SPEC §3.1): every visual mark
// becomes a scene node carrying semantic fields (role, geometry, paint,
// channels, stable id) and private typed presentation choices.
// renderRadarSvg() is DefaultBackend serialization of that scene.
//
// Reuse-only mark roles (no new SceneRole / scene-substrate changes):
//   graticule rings + spokes → 'grid' (crisp scaffold, never sketched)
//   curve fill area          → 'pie-slice' (an existing filled chart-data role
//                              already in SKETCH_SHAPE_ROLES, so it inherits the
//                              hand-drawn/wash fill treatment under styled looks)
//   vertex dots              → 'point'
//   label leaders + tick box → 'grid' / 'chrome' (crisp furniture)
//   axis + ring labels       → 'axis'   legend → 'legend'   title → 'title'
//
// Per-curve colors come from the shared chart palette (pieSliceColors), so a
// single radar renders correctly across every built-in Palette (the renderer
// re-derives fills from RenderContext.colors) and matches pie/xychart identity.
//
// Derived label ink is contrast-guarded (journey discipline), while an
// explicitly authored radar.axisColor remains authoritative and verify reports
// low contrast without repainting it. Ring-value labels sit on a page-colored
// knockout box so their derived default reads over the silhouettes.
//
// Deterministic: no Math.random / Date.now. All geometry comes from layout.
// ============================================================================

/** WCAG-AA (4.5:1) guard for internally derived label ink after alpha
 *  compositing. Authored colors bypass this helper and are diagnosed by verify
 *  instead of being repainted. Unresolved CSS is uncertainty rather than proof,
 *  so derived ink falls back to the best certifiable page color. */
export function guardLabelInk(candidate: string, background: string, fallback: string): string {
  const candidateRatio = wcagCssContrastRatio(candidate, background)
  if (candidateRatio !== null && candidateRatio >= 4.5) return candidate

  const choices = [fallback, '#000000', '#ffffff']
    .map(color => ({ color, ratio: wcagCssContrastRatio(color, background) }))
    .filter((choice): choice is { color: string; ratio: number } => choice.ratio !== null)
    .sort((a, b) => b.ratio - a.ratio)
  const best = choices[0]
  return best && best.ratio >= 4.5 ? best.color : fallback
}

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
  const titleColor = chart.visual.titleColor ?? style.groupTextColor ?? style.nodeTextColor ?? 'var(--_text)'
  const dotStroke = style.nodeBorderColor ?? 'var(--bg)'
  // Mermaid parity and authored-style precedence: an explicit radar.axisColor
  // colors both spokes and labels exactly as authored. Only the internally
  // derived default is contrast-guarded; verify diagnoses a measurable authored
  // contrast failure without silently changing the requested paint.
  const axisTextColor = chart.visual.axisColor
    ?? guardLabelInk(style.edgeTextColor ?? colors.fg, colors.bg, colors.fg)
  const tickTextColor = guardLabelInk(style.edgeTextColor ?? colors.fg, colors.bg, colors.fg)

  const accessibility = {
    title: chart.accessibility?.title ?? chart.title?.text ?? 'Radar chart',
    description: chart.accessibility?.description,
  }
  const axisIdentities = occurrenceIdentities(chart.axes.map(axis => axis.id))
  const curveIdentities = occurrenceIdentities(chart.curves.map(curve => curve.id))
  const namespaceParts: Array<string | number> = [chart.width, chart.height, accessibility.title ?? '']
  for (const axis of chart.axes) namespaceParts.push(axis.id)
  for (const curve of chart.curves) namespaceParts.push(curve.label)
  // Passing one joined string is byte-equivalent to hashId(...namespaceParts)
  // without an input-sized JavaScript argument list.
  const namespace = `radar-${hashId(namespaceParts.join('|'))}`
  const titleId = `${namespace}-title`
  const descId = `${namespace}-desc`

  // Document shell.
  const rootAttributes = { id: namespace, 'aria-roledescription': 'radar chart', ...buildAccessibilityAttrs(accessibility.title, accessibility.description, titleId, descId, 'radar chart') }
  parts.push(marks.documentOpen(
    { id: 'prelude', width: chart.width, height: chart.height, colors, transparent, font, hasMonoFont: false },
    { kind: 'prelude', width: chart.width, height: chart.height, colors, transparent, font, hasMonoFont: false,
      ...(chart.visual.useMaxWidth ? { widthAttribute: '100%', heightAttribute: '100%', extraStyle: `max-width:${chart.width}px` } : {}),
      attributes: Object.entries(rootAttributes).map(([name, value]) => ({ name: name as SvgAttribute['name'], value: v.meta(value) })),
      children: [
        ...(accessibility.title ? [{ kind: 'documentText' as const, element: 'title' as const, domId: titleId, text: accessibility.title }] : []),
        ...(accessibility.description ? [{ kind: 'documentText' as const, element: 'desc' as const, domId: descId, text: accessibility.description }] : []),
        { kind: 'sharedStyle' }, ...(colors.shadow ? [{ kind: 'shadow' as const, colors, wrap: true }] : []),
      ],
    },
  ))

  // Graticule rings (back-most).
  for (let k = 0; k < chart.rings.length; k++) {
    const ring = chart.rings[k]!
    const emission = RING_EMISSIONS[ring.emphasized ? 1 : 0]!
    if (chart.polygonGraticule) {
      parts.push(marks.shape(
        {
          id: `ring:${k}`,
          role: 'grid',
          geometry: { kind: 'polygon', points: ring.points },
          paint: { fill: 'none', stroke: graticuleColor, strokeWidth: String(ring.emphasized ? outerRingStrokeWidth(graticuleStrokeWidth) : graticuleStrokeWidth) ,strokeOpacity: String(graticuleOpacity),},

          attributes: { className: `radar-ring${ring.emphasized ? ' radar-ring-outer' : ''}` },
        },
        emission.polygon,
      ))
    } else {
      parts.push(marks.shape(
        {
          id: `ring:${k}`,
          role: 'grid',
          geometry: { kind: 'circle', cx: chart.cx, cy: chart.cy, r: ring.r },
          paint: { fill: 'none', stroke: graticuleColor, strokeWidth: String(ring.emphasized ? outerRingStrokeWidth(graticuleStrokeWidth) : graticuleStrokeWidth) ,strokeOpacity: String(graticuleOpacity),},

          attributes: { className: `radar-ring${ring.emphasized ? ' radar-ring-outer' : ''}` },
        },
        emission.circle,
      ))
    }
  }

  // Spokes.
  for (const [axisIndex, axis] of chart.axes.entries()) {
    const identity = axisIdentities[axisIndex]!
    parts.push(marks.shape(
      {
        id: `spoke:${identity}`,
        role: 'grid',
        geometry: { kind: 'line', x1: chart.cx, y1: chart.cy, x2: axis.x, y2: axis.y },
        paint: { stroke: axisColor, strokeWidth: String(axisStrokeWidth) },
        attributes: { className: 'radar-axis-line' },
      },
      SPOKE_EMISSION,
    ))
  }

  // Curve areas (reuse the pie-slice filled-data role so styled looks sketch
  // them). Drawn back-to-front in source order; a value-count mismatch draws
  // nothing but still legends (upstream parity).
  for (const [curveIndex, curve] of chart.curves.entries()) {
    if (curve.arityMismatch || curve.vertices.length === 0) continue
    const identity = curveIdentities[curveIndex]!
    const channels = { category: curve.label }
    const roleStyle = resolveRoleStyle(resolved.styleFace, 'pie-slice', channels, { includeFallback: false })
    // Mermaid-authored cScaleN paint remains authoritative. Semantic policy is
    // a default beneath it, never a post-resolution repaint.
    const authoredFill = chart.visual.paletteOverrides?.[curve.colorIndex]
    const fill = authoredFill ?? roleStyle?.fillColor ?? fills[curve.colorIndex]!
    const stroke = authoredFill ?? roleStyle?.strokeColor ?? roleStyle?.borderColor ?? fill
    const strokeWidth = roleStyle?.lineWidth ?? style.nodeLineWidth
    const attributes = { className: 'radar-area', data: { curve: curve.label } }
    const emission = AREA_EMISSIONS[roleStyle?.lineWidth !== undefined ? 1 : 0]!
    if (chart.polygonGraticule) {
      parts.push(marks.shape(
        {
          id: `curve:${identity}`,
          role: 'pie-slice',
          geometry: { kind: 'polygon', points: curve.vertices },
          paint: { fill, stroke, strokeWidth: String(strokeWidth), fillOpacity: String(curveOpacity), strokeLinejoin: 'round' },
          channels,

          attributes,
        },
        emission.polygon,
      ))
    } else {
      parts.push(marks.shape(
        {
          id: `curve:${identity}`,
          role: 'pie-slice',
          geometry: { kind: 'path', d: curve.areaPath },
          paint: { fill, stroke, strokeWidth: String(strokeWidth), fillOpacity: String(curveOpacity), strokeLinejoin: 'round' },
          channels,

          attributes,
        },
        emission.path,
      ))
    }
  }

  // Vertex dots on top of the areas.
  for (const [curveIndex, curve] of chart.curves.entries()) {
    if (curve.arityMismatch) continue
    const identity = curveIdentities[curveIndex]!
    const channels = { category: curve.label }
    const roleStyle = resolveRoleStyle(resolved.styleFace, 'point', channels, { includeFallback: false })
    const authoredFill = chart.visual.paletteOverrides?.[curve.colorIndex]
    const fill = authoredFill ?? roleStyle?.fillColor ?? fills[curve.colorIndex]!
    const stroke = roleStyle?.strokeColor ?? roleStyle?.borderColor ?? dotStroke
    const strokeWidth = roleStyle?.lineWidth ?? 1.2
    curve.vertices.forEach((v, vi) => {
      parts.push(marks.shape(
        {
          id: `dot:${identity}:${vi}`,
          role: 'point',
          geometry: { kind: 'circle', cx: v.x, cy: v.y, r: 3 },
          paint: { fill, stroke, strokeWidth: String(strokeWidth) },
          channels,
          attributes: { className: 'radar-dot' },
        },
        DOT_EMISSIONS[roleStyle ? 1 : 0]!,
      ))
    })
  }

  // Leader lines to relocated axis labels (quadrant discipline; crisp/quiet).
  for (const [axisIndex, axis] of chart.axes.entries()) {
    if (!axis.leader) continue
    const identity = axisIdentities[axisIndex]!
    const l = axis.leader
    parts.push(marks.shape(
      {
        id: `leader:${identity}`,
        role: 'grid',
        geometry: { kind: 'line', x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 },
        paint: { stroke: graticuleColor, strokeOpacity: '0.5', strokeWidth: '1' },
        attributes: { className: 'radar-leader' },
      },
      LEADER_EMISSION,
    ))
  }

  // Ring value labels (Agentic extension): a page-colored knockout box + value,
  // so the number reads over the rings and translucent silhouettes.
  for (let i = 0; i < chart.tickLabels.length; i++) {
    const t = chart.tickLabels[i]!
    const bx = round2(t.x - t.w / 2)
    const by = round2(t.y - t.h / 2)
    parts.push(marks.shape(
      {
        id: `tick-box:${i}`,
        role: 'grid',
        geometry: { kind: 'rect', x: bx, y: by, width: t.w, height: t.h, rx: 4, ry: 4 },
        paint: { fill: 'var(--bg)', stroke: graticuleColor, strokeOpacity: '0.35', strokeWidth: '0.75' },
        attributes: { className: 'radar-tick-box' },
      },
      TICK_BOX_EMISSION,
    ))
  }
  // Paint all text after all knockout boxes. Layout already admits disjoint
  // boxes; this order is a final safeguard against any future geometry drift.
  for (let i = 0; i < chart.tickLabels.length; i++) {
    const t = chart.tickLabels[i]!
    parts.push(marks.text(
      {
        id: `tick:${i}`,
        role: 'axis',
        text: t.text,
        x: t.x,
        y: t.y,
        fontSize: chart.typography.tickFontSize,
        fontWeight: chart.typography.tickFontWeight,
        letterSpacing: style.edgeLetterSpacing,
        block: t.block,
        display: 'literal',
        anchor: 'middle',
        dominantBaseline: 'middle',
        baselineShift: 0,
        paint: { fill: tickTextColor },
        attributes: { className: 'radar-tick-label' },
      },
      TICK_TEXT_EMISSION,
    ))
  }

  // Axis labels (wrapped, radial, outside the outer ring).
  for (const [axisIndex, axis] of chart.axes.entries()) {
    const identity = axisIdentities[axisIndex]!
    const lines = axis.lines
    parts.push(marks.text(
      {
        id: `axis-label:${identity}`,
        role: 'axis',
        text: lines.join('\n'),
        x: axis.labelX,
        y: axis.labelY,
        fontSize: chart.typography.axisFontSize,
        fontWeight: chart.typography.axisFontWeight,
        letterSpacing: style.edgeLetterSpacing,
        display: axis.block ? axis.block.prepared.display : 'literal',
        block: axis.block,
        anchor: axis.anchor,
        dominantBaseline: 'middle',
        baselineShift: 0,
        paint: { fill: axisTextColor },
        attributes: { className: 'radar-axis-label', ariaLabel: axis.label },
      },
      axis.block ? AXIS_TEXT_EMISSION : { kind: 'text', layout: 'multiline', baselineShift: 0, attributes: AXIS_TEXT_ATTRIBUTES.map(attribute => attribute.name === 'aria-label' ? { ...attribute, value: v.meta(axis.label) } : attribute) },
    ))
  }

  // Legend (wrapped labels, reserved row height).
  for (const item of chart.legend) {
    const channels = { category: item.label }
    const roleStyle = resolveRoleStyle(resolved.styleFace, 'legend', channels, { includeFallback: false })
    const authoredFill = chart.visual.paletteOverrides?.[item.colorIndex]
    const fill = authoredFill ?? roleStyle?.fillColor ?? fills[item.colorIndex]!
    const stroke = roleStyle?.strokeColor ?? roleStyle?.borderColor ?? style.nodeBorderColor ?? 'var(--_node-stroke)'
    const strokeWidth = roleStyle?.lineWidth ?? 1
    parts.push(marks.shape(
      {
        id: `legend-swatch:${item.colorIndex}`,
        role: 'legend',
        geometry: { kind: 'rect', x: item.x, y: item.y, width: item.swatchSize, height: item.swatchSize, rx: 2, ry: 2 },
        paint: { fill, fillOpacity: String(curveOpacity), stroke, strokeWidth: String(strokeWidth) },
        channels,
        attributes: { className: 'radar-legend-swatch' },
      },
      SWATCH_EMISSIONS[roleStyle ? 1 : 0]!,
    ))
    parts.push(marks.text(
      {
        id: `legend-label:${item.colorIndex}`,
        role: 'legend',
        text: item.lines.join('\n'),
        x: item.textX,
        y: item.textY,
        fontSize: chart.typography.legendFontSize,
        fontWeight: chart.typography.legendFontWeight,
        letterSpacing: style.nodeLetterSpacing,
        display: item.block ? item.block.prepared.display : 'literal',
        block: item.block,
        anchor: 'start',
        dominantBaseline: 'middle',
        baselineShift: 0,
        paint: { fill: roleStyle?.textColor ?? style.nodeTextColor ?? 'var(--_text)' },
        attributes: { className: 'radar-legend-text' },
      },
      LEGEND_TEXT_EMISSIONS[roleStyle?.textColor ? 1 : 0]!,
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
        fontWeight: chart.typography.titleFontWeight,
        letterSpacing: style.groupLetterSpacing,
        display: chart.title.block ? chart.title.block.prepared.display : 'literal',
        block: chart.title.block,
        anchor: 'middle',
        dominantBaseline: 'middle',
        baselineShift: 0,
        paint: { fill: titleColor },
        attributes: { className: 'radar-title' },
      },
      TITLE_TEXT_EMISSION,
    ))
  }

  parts.push(marks.documentClose())

  return { family: 'radar', width: chart.width, height: chart.height, colors, transparent, parts }
}

function round2(n: number): number { return Math.round(n * 100) / 100 }

/** The emphasized outer ring is 1.4x the graticule stroke, rounded so a
 *  configured width never prints a float artefact (1.5 x 1.4 = 2.0999999999999996). */
function outerRingStrokeWidth(graticuleStrokeWidth: number): number { return round2(graticuleStrokeWidth * 1.4) }

function occurrenceIdentities(values: readonly string[]): string[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  const seen = new Map<string, number>()
  return values.map(value => {
    if ((counts.get(value) ?? 0) <= 1) return value
    const occurrence = seen.get(value) ?? 0
    seen.set(value, occurrence + 1)
    return `${value}#${occurrence}`
  })
}
