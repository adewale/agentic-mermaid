import { sanitizeDisplayLines } from '../shared/text-controls.ts';
import type { RenderContext, PositionedNode, PositionedGroup } from '../types.ts'
import type { PositionedC4Diagram } from './layout.ts'
import type { C4Boundary, C4Element } from './types.ts'
import type { MarkAttributes, SceneDoc, SceneNode, MarkPaint } from '../scene/ir.ts';
import * as marks from '../scene/marks.ts'
import { lowerGraphScene } from '../renderer.ts'
import { c4Appearance, effectiveC4Shape } from './config.ts'
import { resolveRenderStyle } from '../styles.ts'
import { toneOnFill, resolveInlineNodeTextColor } from '../color-resolver.ts'
import { isSafeActionHref } from '../output-security.ts'
import { topRoundedRectPath } from '../scene/svg-writer.ts'
import { resolveRoleStyle } from '../scene/style-registry.ts'
import type { SerializableShapeGeometry } from '../scene/svg-serialize.ts'
import { snapshotSvgEmissionRecipe, svgValue as v, type SvgAttribute, type SvgGeometryField, type SvgGroupEmission, type SvgValue } from '../scene/svg-emission.ts'
import { c4LabelRect } from './pixel-labels.ts'
import { c4SourceLine } from './projection.ts'

const PAINT_ATTRIBUTES: readonly SvgAttribute[] = [
  { name: 'fill', value: v.paint('fill') }, { name: 'stroke', value: v.paint('stroke') }, { name: 'stroke-width', value: v.paint('strokeWidth') },
  { name: 'stroke-dasharray', value: v.paint('strokeDasharray') }, { name: 'stroke-dashoffset', value: v.paint('strokeDashoffset') },
  { name: 'stroke-linecap', value: v.paint('strokeLinecap') }, { name: 'stroke-linejoin', value: v.paint('strokeLinejoin') },
  { name: 'stroke-miterlimit', value: v.paint('strokeMiterlimit') }, { name: 'vector-effect', value: v.paint('vectorEffect') },
  { name: 'paint-order', value: v.paint('paintOrder') }, { name: 'opacity', value: v.paint('opacity') },
]
const GEOMETRY_FIELDS: Record<SerializableShapeGeometry['kind'], readonly SvgGeometryField[]> = {
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'], circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'], polygon: ['points'], polyline: ['points'], path: ['d'],
}
const SHAPE_EMISSIONS = Object.fromEntries(Object.entries(GEOMETRY_FIELDS).map(([kind, fields]) => [kind,
  snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
    ...fields.map(name => ({ name, value: v.geometry(name), ...(kind === 'rect' && (name === 'rx' || name === 'ry') ? { fallback: 0 } : {}) })),
    ...PAINT_ATTRIBUTES,
  ] }),
])) as Record<SerializableShapeGeometry['kind'], ReturnType<typeof snapshotSvgEmissionRecipe>>
const LABEL_ATTRIBUTES: readonly SvgAttribute[] = [
  { name: 'text-anchor', value: v.text('anchor') }, { name: 'font-size', value: v.text('fontSize') },
  { name: 'font-weight', value: v.text('fontWeight') }, { name: 'letter-spacing', value: v.text('letterSpacing') }, { name: 'fill', value: v.paint('fill') },
]
const LABEL_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: LABEL_ATTRIBUTES })
function cardTextEmission(fontFamily?: string) {
  return { kind: 'text' as const, layout: 'multiline' as const, attributes: [
    LABEL_ATTRIBUTES[0]!, LABEL_ATTRIBUTES[4]!, ...LABEL_ATTRIBUTES.slice(1, 4),
    ...(fontFamily ? [{ name: 'font-family' as const, value: v.meta(fontFamily) }] : []),
  ] }
}
const HEADING_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [
  ...LABEL_ATTRIBUTES.slice(1, 4), LABEL_ATTRIBUTES[0]!, LABEL_ATTRIBUTES[4]!,
] })
const LEGEND_EMISSION = snapshotSvgEmissionRecipe({ kind: 'group', attributes: [{ name: 'class', value: v.meta('c4-legend') }] }) as SvgGroupEmission

/** C4 cards and frames are typed Scene shapes. Shared graph lowering supplies
 * native routed connectors, marker resources, edge labels and title chrome. */
export function lowerC4Scene(ctx: RenderContext<PositionedC4Diagram>): SceneDoc {
  const positioned = ctx.positioned, { body, config, identities } = positioned
  const base = lowerGraphScene(ctx), style = resolveRenderStyle(ctx.resolved.renderOptions, undefined, ctx.resolved.styleFace)
  const link = (value: string | undefined): SvgAttribute[] => value && ctx.resolved.renderOptions.security !== 'strict' && isSafeActionHref(value) ? [
    { name: 'data-href', value: v.meta(value), before: '  ' }, { name: 'role', value: v.meta('link') }, { name: 'tabindex', value: v.meta(0) },
  ] : []
  const id = (owner: string, feature: string) => identities.generated(`c4:${owner}:${feature}`, ['c4', owner, feature])
  const shape = (owner: string, feature: string, geometry: SerializableShapeGeometry, paint: MarkPaint, group = false) => marks.shape({ id: id(owner, feature), role: group ? 'group' : 'node', geometry, paint }, SHAPE_EMISSIONS[geometry.kind])
  const metadata = (item: C4Element | C4Boundary): SvgAttribute[] => [
    { name: 'data-id', value: v.meta(item.id) }, { name: 'data-c4-kind', value: v.meta(item.kind) }, { name: 'data-c4-macro', value: v.meta(item.macro) },
    ...(item.parentId ? [{ name: 'data-parent-id' as const, value: v.meta(item.parentId) }] : []),
    ...(item.tags.length ? [{ name: 'data-tags' as const, value: v.meta(JSON.stringify(item.tags)) }] : []),
    ...link(item.effectiveLink ?? item.link),
    ...(item.sprite ? [{ name: 'data-sprite' as const, value: v.meta(item.sprite) }] : []),
    ...(c4SourceLine(body, item.statementId) !== undefined ? [{ name: 'data-source-line' as const, value: v.meta(c4SourceLine(body, item.statementId)!) }] : []),
    ...('external' in item ? [
      { name: 'data-external' as const, value: v.meta(item.external) }, { name: 'data-c4-shape' as const, value: v.meta(item.shape) },
      { name: 'data-effective-c4-shape' as const, value: v.meta(effectiveC4Shape(item)) },
    ] : [{ name: 'data-alignment' as const, value: v.meta(item.alignment ?? 'center') }]),
  ]
  const card = (item: C4Element, node: PositionedNode): SceneNode => {
    const { x, y, width, height } = node, appearance = c4Appearance(item, config), renderedShape = effectiveC4Shape(item)
    const fill = appearance.fill ?? style.nodeFillColor ?? 'var(--_node-fill)', stroke = appearance.stroke ?? style.nodeBorderColor ?? 'var(--_node-stroke)', color = appearance.text ?? resolveInlineNodeTextColor(appearance.fill ? { fill: appearance.fill } : undefined, style.nodeTextColor ?? toneOnFill('var(--_text)', fill, ctx.colors)), lineWidth = String(style.nodeLineWidth)
    const paint: MarkPaint = { fill, stroke, strokeWidth: lineWidth, ...(appearance.dashed ? { strokeDasharray: '5 3' } : {}) }
    const children: Array<{ node: SceneNode; indent: number }> = [], add = (mark: SceneNode) => children.push({ node: mark, indent: 2 })
    if (renderedShape === 'database') {
      const ry = 8, d = `M ${x} ${y + ry} A ${width / 2} ${ry} 0 0 1 ${x + width} ${y + ry} L ${x + width} ${y + height - ry} A ${width / 2} ${ry} 0 0 1 ${x} ${y + height - ry} Z`
      add(shape(item.id, 'surface', { kind: 'path', d }, paint))
      add(shape(item.id, 'database-rim', { kind: 'ellipse', cx: x + width / 2, cy: y + ry, rx: width / 2, ry }, { fill: 'none', stroke, strokeWidth: '1' }))
    } else {
      add(shape(item.id, 'surface', { kind: 'rect', x, y, width, height, rx: style.cornerRadius ?? 0, ry: style.cornerRadius ?? 0 }, paint))
      if (renderedShape === 'queue') for (const [index, lx] of [x + 8, x + width - 8].entries()) add(shape(item.id, `queue-end:${index}`, { kind: 'line', x1: lx, y1: y, x2: lx, y2: y + height }, { stroke, strokeWidth: '1' }))
      if (renderedShape === 'person') {
        // The 38px figure band and label form one measured content block.
        // Config padding alone can disagree with a style's node padding.
        const cx = x + width / 2, labelTop = y + height / 2 + 19 - node.labelBlock!.height / 2, cy = labelTop - 31
        const figurePaint = { fill: color, stroke: color, strokeWidth: '1' }
        add(shape(item.id, 'person-head', { kind: 'circle', cx, cy, r: 7 }, figurePaint))
        const d = `M ${cx - 16} ${cy + 26} Q ${cx - 16} ${cy + 11} ${cx} ${cy + 11} Q ${cx + 16} ${cy + 11} ${cx + 16} ${cy + 26} Z`
        add(shape(item.id, 'person-shoulders', { kind: 'path', d }, figurePaint))
      }
    }
    const block = node.labelBlock!, cx = x + width / 2, cy = y + height / 2 + (renderedShape === 'person' ? 19 : renderedShape === 'database' ? 4 : 0)
    add(marks.text({ id: id(item.id, 'text'), role: 'label', text: block.text, block, x: cx, y: cy, fontSize: block.fontSize, fontWeight: block.fontWeight, letterSpacing: block.letterSpacing, anchor: 'middle', paint: { fill: color } }, cardTextEmission(appearance.fontFamily)))
    return marks.group({ id: id(item.id, 'card'), role: 'node', emission: { kind: 'group', attributes: [{ name: 'class', value: v.meta(`node c4-${item.kind}`) }, ...metadata(item)] }, children, channels: { category: `${item.external ? 'external-' : ''}${item.kind}`, ...(item.tags.length ? { status: item.tags.join(',') } : {}) } })
  }
  const byBoundary = new Map(body.boundaries.map(item => [item.id, item]))
  const frame = (group: PositionedGroup): SceneNode => {
    const item = byBoundary.get(group.id)!, appearance = c4Appearance(item, config), { x, y, width, height } = group
    const stroke = appearance.stroke ?? style.groupBorderColor ?? 'var(--_node-stroke)', fill = appearance.fill ?? style.groupFillColor ?? 'var(--_group-fill)', headerFill = appearance.fill ?? style.groupHeaderFillColor ?? 'var(--_group-hdr)', color = appearance.text ?? resolveInlineNodeTextColor(appearance.fill ? { fill: appearance.fill } : undefined, style.groupTextColor ?? toneOnFill('var(--_text-sec)', headerFill, ctx.colors)), headerHeight = group.headerHeight ?? 36
    const children: Array<{ node: SceneNode; indent: number }> = [], add = (mark: SceneNode) => children.push({ node: mark, indent: 2 })
    const dash = item.style.lineStyle === 'solid' ? undefined : item.style.lineStyle === 'dotted' ? '1 3' : item.style.lineStyle === 'dashed' ? '5 3' : item.kind === 'deployment' ? undefined : '6 4'
    add(shape(item.id, 'boundary-frame', { kind: 'rect', x, y, width, height, rx: style.groupCornerRadius, ry: style.groupCornerRadius }, { fill, stroke, strokeWidth: String(style.groupLineWidth), ...(dash ? { strokeDasharray: dash } : {}) }, true))
    const band = topRoundedRectPath(x, y, width, headerHeight, style.groupCornerRadius)
    const bandGeometry = { kind: 'path', d: band } as const, bandPaint = { fill: headerFill, stroke, strokeWidth: String(style.groupLineWidth) }
    add(marks.shape({ id: id(item.id, 'boundary-band'), role: 'group-header', geometry: bandGeometry, paint: bandPaint }, SHAPE_EMISSIONS.path))
    const block = group.labelBlock!, anchor = item.alignment === 'left' ? 'start' : item.alignment === 'right' ? 'end' : 'middle', cx = item.alignment === 'left' ? x + config.padding : item.alignment === 'right' ? x + width - config.padding : x + width / 2, cy = y + headerHeight / 2
    const fontFamily = appearance.fontFamily ?? style.groupFont
    add(marks.text({ id: id(item.id, 'boundary-text'), role: 'group-header', text: block.text, block, x: cx, y: cy, fontSize: block.fontSize, fontWeight: block.fontWeight, letterSpacing: block.letterSpacing, anchor, paint: { fill: color } }, cardTextEmission(fontFamily)))
    for (const child of group.children) add(frame(child))
    return marks.group({ id: id(item.id, 'frame'), role: 'group', emission: { kind: 'group', attributes: [{ name: 'class', value: v.meta('cluster c4-boundary') }, ...metadata(item)] }, children, channels: { category: item.kind } })
  }
  // Preserve the common root/resources/title/routes, replacing generic graph
  // surfaces with C4-owned typed primitives and explicit semantic metadata.
  const genericNodeIds = new Set(positioned.nodes.map(node => `node:${node.id}`)), genericGroupIds = new Set(positioned.groups.map(group => `group:${group.id}`))
  const relationshipById = new Map(body.relationships.map(item => [item.id, item]))
  const parts = base.parts.filter(part => !genericNodeIds.has(part.id) && !genericGroupIds.has(part.id) && part.role !== 'edge-label').map(part => {
    if (part.kind !== 'connector') return part
    const item = relationshipById.get(part.identity?.id ?? '')
    if (!item) return part
    const stroke = item.style.lineStyle === 'dotted' ? { ...part.stroke, dash: { array: '1 3' } } : part.stroke
    const href = ctx.resolved.renderOptions.security === 'strict' ? undefined : item.effectiveLink ?? item.link
    const { markers } = part, label = part.labels[0]
    const attributes: MarkAttributes = {
      className: 'edge',
      data: {
        style: part.lineStyle, 'arrow-start': String(!!markers.start), 'arrow-end': String(!!markers.end),
        ...(markers.start ? { 'marker-start': markers.start.shape } : {}),
        ...(markers.end ? { 'marker-end': markers.end.shape } : {}),
        ...(label ? { label: sanitizeDisplayLines(label.text) } : {}),
        'c4-macro': item.macro, 'authored-from': item.from, 'authored-to': item.to, order: String(item.order),
        ...(item.index !== undefined ? { index: item.index } : {}),
        ...(item.tags.length ? { tags: JSON.stringify(item.tags) } : {}),
        ...(href && isSafeActionHref(href) ? { href } : {}),
      },
      ...(href && isSafeActionHref(href) ? { tabIndex: 0 as const } : {}),
    }
    const fields: marks.ConnectorFields = { id: id(item.id, 'relationship'), role: 'edge', identity: part.identity, geometry: part.route.geometry, paint: { stroke: stroke.color, strokeWidth: String(stroke.width) }, lineStyle: part.lineStyle, endpoints: part.endpoints, relationship: { ...part.relationship, kind: `c4-${item.macro}` }, route: part.route, stroke, markers: part.markers, hit: part.hit, labels: part.labels.map(label => ({ ...label, visual: { kind: 'companion', markId: id(item.id, 'label-text') }, ...(item.style.textColor ? { paint: { ...label.paint, fill: item.style.textColor } } : {}) })), channels: { category: 'relationship', ...(item.tags.length ? { status: item.tags.join(',') } : {}) }, attributes }
    const geometryAttributes = GEOMETRY_FIELDS[part.route.geometry.kind].map(name => ({ name, value: v.geometry(name) }))
    const blend: SvgValue = { source: 'style', declarations: [{ property: 'mix-blend-mode', value: v.connector('mixBlendMode') }] }
    return marks.connector(fields, { kind: 'primitive', attributes: [
      { name: 'class', value: v.meta('edge') }, { name: 'data-style', value: v.connector('lineStyle') },
      { name: 'data-arrow-start', value: v.connector('hasMarkerStart') }, { name: 'data-arrow-end', value: v.connector('hasMarkerEnd') },
      ...(part.markers.start ? [{ name: 'data-marker-start' as const, value: v.connector('markerStartShape') }] : []),
      ...(part.markers.end ? [{ name: 'data-marker-end' as const, value: v.connector('markerEndShape') }] : []),
      ...(part.labels[0] ? [{ name: 'data-label' as const, value: { source: 'connectorLabel' as const, index: 0 }, display: true }] : []),
      { name: 'data-c4-macro', value: v.meta(item.macro) }, { name: 'data-authored-from', value: v.meta(item.from) }, { name: 'data-authored-to', value: v.meta(item.to) },
      { name: 'data-order', value: v.meta(item.order) }, ...(item.index === undefined ? [] : [{ name: 'data-index' as const, value: v.meta(item.index) }]),
      ...(item.tags.length ? [{ name: 'data-tags' as const, value: v.meta(JSON.stringify(item.tags)) }] : []),
      ...(href && isSafeActionHref(href) ? [{ name: 'data-href' as const, value: v.meta(href) }, { name: 'tabindex' as const, value: v.meta(0) }] : []),
      ...geometryAttributes, ...PAINT_ATTRIBUTES, { name: 'pathLength', value: v.connector('pathLength') },
      ...(stroke.mixBlendMode ? [{ name: 'style' as const, value: blend }] : []),
    ] })
  })
  const firstRoute = parts.findIndex(part => part.kind === 'connector')
  parts.splice(firstRoute < 0 ? Math.max(0, parts.length - 1) : firstRoute, 0, ...positioned.groups.map(frame))
  const labels = positioned.edges.flatMap(edge => {
    if (!edge.label || !edge.labelBlock || !edge.labelPosition) return []
    const item = relationshipById.get(edge.id!)!, block = edge.labelBlock, { x, y } = edge.labelPosition, color = item.style.textColor ?? item.style.fontColor ?? style.edgeTextColor ?? 'var(--_text-sec)'
    const halo = c4LabelRect(edge)!, haloGeometry = { kind: 'rect', ...halo, rx: 3, ry: 3 } as const, haloPaint = { fill: 'var(--bg)', stroke: 'var(--_inner-stroke)', strokeWidth: '1' }
    return [marks.group({ id: id(item.id, 'relationship-label'), role: 'edge-label', emission: { kind: 'group', attributes: [
      { name: 'class', value: v.meta('edge-label') }, { name: 'data-id', value: v.meta(id(item.id, 'label')) }, { name: 'data-role', value: v.identity('role') },
      { name: 'data-edge-id', value: v.meta(item.id) }, { name: 'data-from', value: v.meta(item.source) }, { name: 'data-to', value: v.meta(item.target) },
    ] }, children: [
      { indent: 2, node: marks.shape({ id: id(item.id, 'label-halo'), role: 'chrome', geometry: haloGeometry, paint: haloPaint }, SHAPE_EMISSIONS.rect) },
      { indent: 2, node: marks.text({ id: id(item.id, 'label-text'), role: 'label', text: block.text, block, x, y, fontSize: block.fontSize, fontWeight: block.fontWeight, letterSpacing: block.letterSpacing, anchor: 'middle', paint: { fill: color }, pageFill: item.style.textColor ?? item.style.fontColor ?? toneOnFill('var(--_text-sec)', 'var(--bg)', ctx.colors) }, LABEL_EMISSION) },
    ] })]
  })
  parts.splice(parts.length - 1, 0, ...labels, ...positioned.nodes.map(node => card(body.elements.find(item => item.id === node.id)!, node)))
  if (positioned.legend) {
    const legend = positioned.legend, children: Array<{ node: SceneNode; indent: number }> = []
    const legendStyle = resolveRoleStyle(ctx.resolved.styleFace, 'legend', {}, { includeFallback: false })
    const textColor = legendStyle?.textColor ?? 'var(--_text)'
    const headingBlock = legend.heading, headingX = legend.x + 12, headingY = legend.y + 8 + headingBlock.height / 2
    const heading = marks.text({ id: id('legend', 'heading'), role: 'legend', text: headingBlock.text, block: headingBlock, x: headingX, y: headingY, fontSize: headingBlock.fontSize, fontWeight: headingBlock.fontWeight, letterSpacing: headingBlock.letterSpacing, anchor: 'start', paint: { fill: textColor } }, HEADING_EMISSION)
    children.push({ node: heading, indent: 2 })
    let y = legend.y + 20 + headingBlock.height
    for (const entry of legend.entries) {
      const { block } = entry, x = legend.x + 38, cy = y + block.height / 2
      const color = entry.style.borderColor ?? entry.style.lineColor ?? legendStyle?.strokeColor ?? legendStyle?.borderColor ?? style.nodeBorderColor ?? 'var(--_line)'
      const fill = entry.style.bgColor ?? legendStyle?.fillColor ?? style.nodeFillColor ?? 'var(--_node-fill)', lineWidth = String(legendStyle?.lineWidth ?? 1)
      const dash = entry.style.lineStyle === 'dotted' ? '1 3' : entry.style.lineStyle === 'dashed' || entry.external ? '5 3' : undefined
      const paint = { fill, stroke: color, strokeWidth: lineWidth, ...(dash ? { strokeDasharray: dash } : {}) }
      const sx = legend.x + 10, sw = 18, sh = block.height
      const swatch = (feature: string, geometry: SerializableShapeGeometry) => children.push({ indent: 2, node: marks.shape({ id: id(entry.id, feature), role: 'legend', geometry, paint }, SHAPE_EMISSIONS[geometry.kind]) })
      if (entry.kind === 'relationship') swatch('legend-swatch', { kind: 'line', x1: sx, y1: cy, x2: sx + sw, y2: cy })
      else if (entry.shape === 'database') {
        const ry = Math.min(3, sh / 4), d = `M ${sx} ${y + ry} A 9 ${ry} 0 0 1 ${sx + sw} ${y + ry} L ${sx + sw} ${y + sh - ry} A 9 ${ry} 0 0 1 ${sx} ${y + sh - ry} Z`
        swatch('legend-swatch', { kind: 'path', d })
        swatch('legend-rim', { kind: 'ellipse', cx: sx + 9, cy: y + ry, rx: 9, ry })
      } else if (entry.shape === 'person') {
        const r = Math.min(3, sh / 5), cx = sx + 9
        swatch('legend-head', { kind: 'circle', cx, cy: y + r, r })
        const d = `M ${sx + 3} ${y + sh} Q ${sx + 3} ${y + r * 2.5} ${cx} ${y + r * 2.5} Q ${sx + 15} ${y + r * 2.5} ${sx + 15} ${y + sh} Z`
        swatch('legend-swatch', { kind: 'path', d })
      } else {
        swatch('legend-swatch', { kind: 'rect', x: sx, y, width: sw, height: sh })
        if (entry.shape === 'queue') for (const [index, px] of [sx + 3, sx + 15].entries()) swatch(`legend-end:${index}`, { kind: 'line', x1: px, y1: y, x2: px, y2: y + sh })
      }
      // Legend labels sit on the page; node/tag font colors describe the
      // colored card, while the legend role owns its own text ink.
      const ink = textColor
      children.push({ indent: 2, node: marks.text({ id: id(entry.id, 'legend-text'), role: 'legend', text: block.text, block, x, y: cy, fontSize: block.fontSize, fontWeight: block.fontWeight, letterSpacing: block.letterSpacing, anchor: 'start', paint: { fill: ink } }, LABEL_EMISSION) })
      y += block.height + 10
    }
    parts.splice(parts.length - 1, 0, marks.group({ id: id('legend', 'container'), role: 'legend', emission: LEGEND_EMISSION, children }))
  }
  return { ...base, family: 'c4', parts }
}
