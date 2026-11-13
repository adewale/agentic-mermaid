import { sceneLowering, type DrawingFactory, type DrawingDocument } from '../scene/drawing.ts'
import type { RenderContext, PositionedNode, PositionedGroup } from '../types.ts'
import type { PositionedC4Diagram } from './layout.ts'
import type { C4Boundary, C4Element } from './types.ts'
import type { Geometry, MarkAttributes, MarkPaint } from '../scene/ir.ts'
import * as typedMarks from '../scene/marks.ts'
import { lowerGraphDrawing } from '../renderer.ts'
import { escapeAttr } from '../multiline-utils.ts'
import { c4Appearance, effectiveC4Shape } from './config.ts'
import { resolveRenderStyle } from '../styles.ts'
import { toneOnFill, resolveInlineNodeTextColor } from '../color-resolver.ts'
import { isSafeActionHref } from '../output-security.ts'
import { topRoundedRectPath } from '../scene/svg-writer.ts'
import { resolveRoleStyle } from '../scene/style-registry.ts'
import { sanitizeDisplayLines } from '../shared/text-controls.ts'
import { c4LabelRect } from './pixel-labels.ts'
import { c4SourceLine } from './projection.ts'

/** C4 cards and frames are typed Scene shapes. Shared graph lowering supplies
 * native routed connectors, marker resources, edge labels and title chrome. */
export function lowerC4Drawing<T>(marks: DrawingFactory<T>, ctx: RenderContext<PositionedC4Diagram>): DrawingDocument<T> {
  const positioned = ctx.positioned, { body, config, identities } = positioned
  const style = resolveRenderStyle(ctx.resolved.renderOptions, undefined, ctx.resolved.styleFace)
  const link = (value: string | undefined): string => value && ctx.resolved.renderOptions.security !== 'strict' && isSafeActionHref(value) ? ` data-href="${escapeAttr(value)}" role="link" tabindex="0"` : ''
  const id = (owner: string, feature: string) => identities.generated(`c4:${owner}:${feature}`, ['c4', owner, feature])
  const shape = (owner: string, feature: string, geometry: Geometry, paint: MarkPaint, group = false) => marks.shape({ id: id(owner, feature), role: group ? 'group' : 'node', geometry, paint })
  const metadata = (item: C4Element | C4Boundary) => [
    `data-id="${escapeAttr(item.id)}"`, `data-c4-kind="${escapeAttr(item.kind)}"`, `data-c4-macro="${escapeAttr(item.macro)}"`,
    ...(item.parentId ? [`data-parent-id="${escapeAttr(item.parentId)}"`] : []),
    ...(item.tags.length ? [`data-tags="${escapeAttr(JSON.stringify(item.tags))}"`] : []),
    ...(link(item.effectiveLink ?? item.link) ? [link(item.effectiveLink ?? item.link)] : []),
    ...(item.sprite ? [`data-sprite="${escapeAttr(item.sprite)}"`] : []),
    ...(c4SourceLine(body, item.statementId) !== undefined ? [`data-source-line="${c4SourceLine(body, item.statementId)}"`] : []),
    ...('external' in item ? [`data-external="${item.external}"`, `data-c4-shape="${item.shape}"`, `data-effective-c4-shape="${effectiveC4Shape(item)}"`] : [`data-alignment="${item.alignment ?? 'center'}"`]),
  ].join(' ')
  const card = (item: C4Element, node: PositionedNode): T => {
    const { x, y, width, height } = node, appearance = c4Appearance(item, config), renderedShape = effectiveC4Shape(item)
    const fill = appearance.fill ?? style.nodeFillColor ?? 'var(--_node-fill)', stroke = appearance.stroke ?? style.nodeBorderColor ?? 'var(--_node-stroke)', color = appearance.text ?? resolveInlineNodeTextColor(appearance.fill ? { fill: appearance.fill } : undefined, style.nodeTextColor ?? toneOnFill('var(--_text)', fill, ctx.colors)), lineWidth = String(style.nodeLineWidth)
    const paint: MarkPaint = { fill, stroke, strokeWidth: lineWidth, ...(appearance.dashed ? { strokeDasharray: '5 3' } : {}) }
    const children: Array<{ node: T; indent: number }> = [], add = (mark: T) => children.push({ node: mark, indent: 2 })
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
    // The block is measured in the appearance's font; the writer draws that face.
    add(marks.text({ id: id(item.id, 'text'), role: 'label', text: block.text, block, x: cx, y: cy, fontSize: block.fontSize, fontWeight: block.fontWeight, letterSpacing: block.letterSpacing, anchor: 'middle', paint: { fill: color } }))
    return marks.group({ id: id(item.id, 'card'), role: 'node', open: `<g class="node c4-${item.kind}" ${metadata(item)}>`, close: '</g>', children, channels: { category: `${item.external ? 'external-' : ''}${item.kind}`, ...(item.tags.length ? { status: item.tags.join(',') } : {}) } })
  }
  const byBoundary = new Map(body.boundaries.map(item => [item.id, item]))
  const frame = (group: PositionedGroup): T => {
    const item = byBoundary.get(group.id)!, appearance = c4Appearance(item, config), { x, y, width, height } = group
    const stroke = appearance.stroke ?? style.groupBorderColor ?? 'var(--_node-stroke)', fill = appearance.fill ?? style.groupFillColor ?? 'var(--_group-fill)', headerFill = appearance.fill ?? style.groupHeaderFillColor ?? 'var(--_group-hdr)', color = appearance.text ?? resolveInlineNodeTextColor(appearance.fill ? { fill: appearance.fill } : undefined, style.groupTextColor ?? toneOnFill('var(--_text-sec)', headerFill, ctx.colors)), headerHeight = group.headerHeight ?? 36
    const children: Array<{ node: T; indent: number }> = [], add = (mark: T) => children.push({ node: mark, indent: 2 })
    const dash = item.style.lineStyle === 'solid' ? undefined : item.style.lineStyle === 'dotted' ? '1 3' : item.style.lineStyle === 'dashed' ? '5 3' : item.kind === 'deployment' ? undefined : '6 4'
    add(shape(item.id, 'boundary-frame', { kind: 'rect', x, y, width, height, rx: style.groupCornerRadius, ry: style.groupCornerRadius }, { fill, stroke, strokeWidth: String(style.groupLineWidth), ...(dash ? { strokeDasharray: dash } : {}) }, true))
    const band = topRoundedRectPath(x, y, width, headerHeight, style.groupCornerRadius)
    const bandGeometry = { kind: 'path', d: band } as const, bandPaint = { fill: headerFill, stroke, strokeWidth: String(style.groupLineWidth) }
    add(marks.shape({ id: id(item.id, 'boundary-band'), role: 'group-header', geometry: bandGeometry, paint: bandPaint }))
    const block = group.labelBlock!, anchor = item.alignment === 'left' ? 'start' : item.alignment === 'right' ? 'end' : 'middle', cx = item.alignment === 'left' ? x + config.padding : item.alignment === 'right' ? x + width - config.padding : x + width / 2, cy = y + headerHeight / 2
    // The block is measured in the appearance's font, else the group font; the writer draws that face.
    add(marks.text({ id: id(item.id, 'boundary-text'), role: 'group-header', text: block.text, block, x: cx, y: cy, fontSize: block.fontSize, fontWeight: block.fontWeight, letterSpacing: block.letterSpacing, anchor, paint: { fill: color } }))
    for (const child of group.children) add(frame(child))
    return marks.group({ id: id(item.id, 'frame'), role: 'group', open: `<g class="cluster c4-boundary" ${metadata(item)}>`, close: '</g>', children, channels: { category: item.kind } })
  }
  // Preserve the common root/resources/title/routes, replacing generic graph
  // surfaces with C4-owned typed primitives and explicit semantic metadata.
  const relationshipById = new Map(body.relationships.map(item => [item.id, item]))
  const connector = (fields: typedMarks.ConnectorFields): T => {
    const part = typedMarks.connector(fields)
    const item = relationshipById.get(part.identity?.id ?? '')
    if (!item) return marks.connector(fields)
    const stroke = item.style.lineStyle === 'dotted' ? { ...part.stroke, dash: { array: '1 3' } } : part.stroke
    // Inspection hooks: the drawn style, arrow presence and markers, the
    // label, and the authored C4 source (macro, endpoints, order, index, tags
    // and a safe link). Identity and relationship come from typed fields.
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
    const replacement: typedMarks.ConnectorFields = { id: id(item.id, 'relationship'), role: 'edge', identity: part.identity, geometry: part.route.geometry, paint: { stroke: stroke.color, strokeWidth: String(stroke.width) }, lineStyle: part.lineStyle, endpoints: part.endpoints, relationship: { ...part.relationship, kind: `c4-${item.macro}` }, route: part.route, stroke, markers: part.markers, hit: part.hit, labels: part.labels.map(label => ({ ...label, visual: { kind: 'companion', markId: id(item.id, 'label-text') }, ...(item.style.textColor ? { paint: { ...label.paint, fill: item.style.textColor } } : {}) })), channels: { category: 'relationship', ...(item.tags.length ? { status: item.tags.join(',') } : {}) }, attributes }
    return marks.connector(replacement)
  }
  const base = lowerGraphDrawing({ ...marks, connector }, ctx, { surfaces: false, edgeLabels: false, beforeEdges: () => positioned.groups.map(frame) })
  const parts = base.parts
  const labels = positioned.edges.flatMap(edge => {
    if (!edge.label || !edge.labelBlock || !edge.labelPosition) return []
    const item = relationshipById.get(edge.id!)!, block = edge.labelBlock, { x, y } = edge.labelPosition, color = item.style.textColor ?? item.style.fontColor ?? style.edgeTextColor ?? 'var(--_text-sec)'
    const halo = c4LabelRect(edge)!, haloGeometry = { kind: 'rect', ...halo, rx: 3, ry: 3 } as const, haloPaint = { fill: 'var(--bg)', stroke: 'var(--_inner-stroke)', strokeWidth: '1' }
    return [marks.group({ id: id(item.id, 'relationship-label'), role: 'edge-label', open: `<g class="edge-label" data-id="${escapeAttr(id(item.id, 'label'))}" data-role="edge-label" data-edge-id="${escapeAttr(item.id)}" data-from="${escapeAttr(item.source)}" data-to="${escapeAttr(item.target)}">`, close: '</g>', children: [
      { indent: 2, node: marks.shape({ id: id(item.id, 'label-halo'), role: 'chrome', geometry: haloGeometry, paint: haloPaint }) },
      { indent: 2, node: marks.text({ id: id(item.id, 'label-text'), role: 'label', text: block.text, block, x, y, fontSize: block.fontSize, fontWeight: block.fontWeight, letterSpacing: block.letterSpacing, anchor: 'middle', paint: { fill: color }, pageFill: item.style.textColor ?? item.style.fontColor ?? toneOnFill('var(--_text-sec)', 'var(--bg)', ctx.colors) }) },
    ] })]
  })
  parts.splice(parts.length - 1, 0, ...labels, ...positioned.nodes.map(node => card(body.elements.find(item => item.id === node.id)!, node)))
  if (positioned.legend) {
    const legend = positioned.legend, children: Array<{ node: T; indent: number }> = []
    const legendStyle = resolveRoleStyle(ctx.resolved.styleFace, 'legend', {}, { includeFallback: false })
    const textColor = legendStyle?.textColor ?? 'var(--_text)'
    const headingBlock = legend.heading, headingX = legend.x + 12, headingY = legend.y + 8 + headingBlock.height / 2
    const heading = marks.text({ id: id('legend', 'heading'), role: 'legend', text: headingBlock.text, block: headingBlock, x: headingX, y: headingY, fontSize: headingBlock.fontSize, fontWeight: headingBlock.fontWeight, letterSpacing: headingBlock.letterSpacing, anchor: 'start', paint: { fill: textColor } })
    children.push({ node: heading, indent: 2 })
    let y = legend.y + 20 + headingBlock.height
    for (const entry of legend.entries) {
      const { block } = entry, x = legend.x + 38, cy = y + block.height / 2
      const color = entry.style.borderColor ?? entry.style.lineColor ?? legendStyle?.strokeColor ?? legendStyle?.borderColor ?? style.nodeBorderColor ?? 'var(--_line)'
      const fill = entry.style.bgColor ?? legendStyle?.fillColor ?? style.nodeFillColor ?? 'var(--_node-fill)', lineWidth = String(legendStyle?.lineWidth ?? 1)
      const dash = entry.style.lineStyle === 'dotted' ? '1 3' : entry.style.lineStyle === 'dashed' || entry.external ? '5 3' : undefined
      const paint = { fill, stroke: color, strokeWidth: lineWidth, ...(dash ? { strokeDasharray: dash } : {}) }
      const sx = legend.x + 10, sw = 18, sh = block.height
      const swatch = (feature: string, geometry: Geometry) => children.push({ indent: 2, node: marks.shape({ id: id(entry.id, feature), role: 'legend', geometry, paint }) })
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
      children.push({ indent: 2, node: marks.text({ id: id(entry.id, 'legend-text'), role: 'legend', text: block.text, block, x, y: cy, fontSize: block.fontSize, fontWeight: block.fontWeight, letterSpacing: block.letterSpacing, anchor: 'start', paint: { fill: ink } }) })
      y += block.height + 10
    }
    parts.splice(parts.length - 1, 0, marks.group({ id: id('legend', 'container'), role: 'legend', open: '<g class="c4-legend">', close: '</g>', children }))
  }
  return { ...base, family: 'c4', parts }
}

export const lowerC4Scene = sceneLowering<PositionedC4Diagram>(lowerC4Drawing)
