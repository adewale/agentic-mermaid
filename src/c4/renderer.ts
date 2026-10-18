import type { RenderContext, PositionedNode, PositionedGroup } from '../types.ts'
import type { PositionedC4Diagram } from './layout.ts'
import type { C4Boundary, C4Element } from './types.ts'
import type { SceneDoc, SceneNode, Geometry, MarkPaint } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { lowerGraphScene } from '../renderer.ts'
import { escapeAttr, renderMultilineText } from '../multiline-utils.ts'
import { c4Appearance, effectiveC4Shape } from './config.ts'
import { resolveRenderStyle } from '../styles.ts'
import { toneOnFill, resolveInlineNodeTextColor } from '../color-resolver.ts'
import { isSafeActionHref } from '../output-security.ts'
import { topRoundedRectPath } from '../svg-paths.ts'
import { sceneNodeSerialization } from '../scene/serialization.ts'
import { c4SourceLine } from './projection.ts'

/** C4 cards and frames are typed Scene shapes. Shared graph lowering supplies
 * native routed connectors, marker resources, edge labels and title chrome. */
export function lowerC4Scene(ctx: RenderContext<PositionedC4Diagram>): SceneDoc {
  const positioned = ctx.positioned, { body, config, identities } = positioned
  const base = lowerGraphScene(ctx), style = resolveRenderStyle(ctx.resolved.renderOptions, undefined, ctx.resolved.styleFace)
  const link = (value: string | undefined, relationship = false): string => value && ctx.resolved.renderOptions.security !== 'strict' && isSafeActionHref(value) ? ` data-href="${escapeAttr(value)}"${relationship ? '' : ' role="link"'} tabindex="0"` : ''
  const id = (owner: string, feature: string) => identities.generated(`c4:${owner}:${feature}`, ['c4', owner, feature])
  const shape = (owner: string, feature: string, geometry: Geometry, paint: MarkPaint, svg: string, group = false) => marks.shape({ id: id(owner, feature), role: group ? 'group' : 'node', geometry, paint }, svg)
  const metadata = (item: C4Element | C4Boundary) => [
    `data-id="${escapeAttr(item.id)}"`, `data-c4-kind="${escapeAttr(item.kind)}"`, `data-c4-macro="${escapeAttr(item.macro)}"`,
    ...(item.parentId ? [`data-parent-id="${escapeAttr(item.parentId)}"`] : []),
    ...(item.tags.length ? [`data-tags="${escapeAttr(JSON.stringify(item.tags))}"`] : []),
    ...(link(item.effectiveLink ?? item.link) ? [link(item.effectiveLink ?? item.link)] : []),
    ...(item.sprite ? [`data-sprite="${escapeAttr(item.sprite)}"`] : []),
    ...(c4SourceLine(body, item.statementId) !== undefined ? [`data-source-line="${c4SourceLine(body, item.statementId)}"`] : []),
    ...('external' in item ? [`data-external="${item.external}"`, `data-c4-shape="${item.shape}"`, `data-effective-c4-shape="${effectiveC4Shape(item)}"`] : [`data-alignment="${item.alignment ?? 'center'}"`]),
  ].join(' ')
  const card = (item: C4Element, node: PositionedNode): SceneNode => {
    const { x, y, width, height } = node, appearance = c4Appearance(item, config), renderedShape = effectiveC4Shape(item)
    const fill = appearance.fill ?? style.nodeFillColor ?? 'var(--_node-fill)', stroke = appearance.stroke ?? style.nodeBorderColor ?? 'var(--_node-stroke)', color = appearance.text ?? resolveInlineNodeTextColor(appearance.fill ? { fill: appearance.fill } : undefined, style.nodeTextColor ?? toneOnFill('var(--_text)', fill, ctx.colors)), lineWidth = String(style.nodeLineWidth)
    const paint: MarkPaint = { fill, stroke, strokeWidth: lineWidth, ...(appearance.dashed ? { strokeDasharray: '5 3' } : {}) }
    const attrs = `fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${lineWidth}"${appearance.dashed ? ' stroke-dasharray="5 3"' : ''}`
    const children: Array<{ node: SceneNode; indent: number }> = [], add = (mark: SceneNode) => children.push({ node: mark, indent: 2 })
    if (renderedShape === 'database') {
      const ry = 8, d = `M ${x} ${y + ry} A ${width / 2} ${ry} 0 0 1 ${x + width} ${y + ry} L ${x + width} ${y + height - ry} A ${width / 2} ${ry} 0 0 1 ${x} ${y + height - ry} Z`
      add(shape(item.id, 'surface', { kind: 'path', d }, paint, `<path d="${d}" ${attrs}/>`))
      add(shape(item.id, 'database-rim', { kind: 'ellipse', cx: x + width / 2, cy: y + ry, rx: width / 2, ry }, { fill: 'none', stroke, strokeWidth: '1' }, `<ellipse cx="${x + width / 2}" cy="${y + ry}" rx="${width / 2}" ry="${ry}" fill="none" stroke="${escapeAttr(stroke)}" stroke-width="1"/>`))
    } else {
      add(shape(item.id, 'surface', { kind: 'rect', x, y, width, height, rx: style.cornerRadius ?? 0, ry: style.cornerRadius ?? 0 }, paint, `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${style.cornerRadius ?? 0}" ry="${style.cornerRadius ?? 0}" ${attrs}/>`))
      if (renderedShape === 'queue') for (const [index, lx] of [x + 8, x + width - 8].entries()) add(shape(item.id, `queue-end:${index}`, { kind: 'line', x1: lx, y1: y, x2: lx, y2: y + height }, { stroke, strokeWidth: '1' }, `<line x1="${lx}" y1="${y}" x2="${lx}" y2="${y + height}" stroke="${escapeAttr(stroke)}" stroke-width="1"/>`))
      if (renderedShape === 'person') {
        // The 38px figure band and label form one measured content block.
        // Config padding alone can disagree with a style's node padding.
        const cx = x + width / 2, labelTop = y + height / 2 + 19 - node.labelBlock!.height / 2, cy = labelTop - 31
        const figurePaint = { fill: color, stroke: color, strokeWidth: '1' }, figureAttrs = `fill="${escapeAttr(color)}" stroke="${escapeAttr(color)}" stroke-width="1"`
        add(shape(item.id, 'person-head', { kind: 'circle', cx, cy, r: 7 }, figurePaint, `<circle cx="${cx}" cy="${cy}" r="7" ${figureAttrs}/>`))
        const d = `M ${cx - 16} ${cy + 26} Q ${cx - 16} ${cy + 11} ${cx} ${cy + 11} Q ${cx + 16} ${cy + 11} ${cx + 16} ${cy + 26} Z`
        add(shape(item.id, 'person-shoulders', { kind: 'path', d }, figurePaint, `<path d="${d}" ${figureAttrs}/>`))
      }
    }
    const block = node.labelBlock!, cx = x + width / 2, cy = y + height / 2 + (renderedShape === 'person' ? 19 : renderedShape === 'database' ? 4 : 0)
    const fontFamily = appearance.fontFamily ? ` font-family="${escapeAttr(appearance.fontFamily)}"` : ''
    add(marks.text({ id: id(item.id, 'text'), role: 'label', text: block.text, block, x: cx, y: cy, fontSize: block.fontSize, fontWeight: block.fontWeight, letterSpacing: block.letterSpacing, anchor: 'middle', paint: { fill: color } }, renderMultilineText(block, cx, cy, block.fontSize, `text-anchor="middle" fill="${escapeAttr(color)}" font-size="${block.fontSize}" font-weight="${block.fontWeight}" letter-spacing="${block.letterSpacing}"${fontFamily}`)))
    return marks.group({ id: id(item.id, 'card'), role: 'node', open: `<g class="node c4-${item.kind}" ${metadata(item)}>`, close: '</g>', children, channels: { category: `${item.external ? 'external-' : ''}${item.kind}`, ...(item.tags.length ? { status: item.tags.join(',') } : {}) } })
  }
  const byBoundary = new Map(body.boundaries.map(item => [item.id, item]))
  const frame = (group: PositionedGroup): SceneNode => {
    const item = byBoundary.get(group.id)!, appearance = c4Appearance(item, config), { x, y, width, height } = group
    const stroke = appearance.stroke ?? style.groupBorderColor ?? 'var(--_node-stroke)', fill = appearance.fill ?? style.groupFillColor ?? 'var(--_group-fill)', headerFill = appearance.fill ?? style.groupHeaderFillColor ?? 'var(--_group-hdr)', color = appearance.text ?? resolveInlineNodeTextColor(appearance.fill ? { fill: appearance.fill } : undefined, style.groupTextColor ?? toneOnFill('var(--_text-sec)', headerFill, ctx.colors)), headerHeight = group.headerHeight ?? 36
    const children: Array<{ node: SceneNode; indent: number }> = [], add = (mark: SceneNode) => children.push({ node: mark, indent: 2 })
    const dash = item.style.lineStyle === 'solid' ? undefined : item.style.lineStyle === 'dotted' ? '1 3' : item.style.lineStyle === 'dashed' ? '5 3' : item.kind === 'deployment' ? undefined : '6 4'
    add(shape(item.id, 'boundary-frame', { kind: 'rect', x, y, width, height, rx: style.groupCornerRadius, ry: style.groupCornerRadius }, { fill, stroke, strokeWidth: String(style.groupLineWidth), ...(dash ? { strokeDasharray: dash } : {}) }, `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${style.groupCornerRadius}" ry="${style.groupCornerRadius}" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${style.groupLineWidth}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`, true))
    const band = topRoundedRectPath(x, y, width, headerHeight, style.groupCornerRadius)
    add(marks.shape({ id: id(item.id, 'boundary-band'), role: 'group-header', geometry: { kind: 'path', d: band }, paint: { fill: headerFill, stroke, strokeWidth: String(style.groupLineWidth) } }, `<path d="${band}" fill="${escapeAttr(headerFill)}" stroke="${escapeAttr(stroke)}" stroke-width="${style.groupLineWidth}"/>`))
    const block = group.labelBlock!, anchor = item.alignment === 'left' ? 'start' : item.alignment === 'right' ? 'end' : 'middle', cx = item.alignment === 'left' ? x + config.padding : item.alignment === 'right' ? x + width - config.padding : x + width / 2, cy = y + headerHeight / 2
    add(marks.text({ id: id(item.id, 'boundary-text'), role: 'group-header', text: block.text, block, x: cx, y: cy, fontSize: block.fontSize, fontWeight: block.fontWeight, letterSpacing: block.letterSpacing, anchor, paint: { fill: color } }, renderMultilineText(block, cx, cy, block.fontSize, `text-anchor="${anchor}" fill="${escapeAttr(color)}" font-size="${block.fontSize}" font-weight="${block.fontWeight}" letter-spacing="${block.letterSpacing}"${appearance.fontFamily ? ` font-family="${escapeAttr(appearance.fontFamily)}"` : ''}`)))
    for (const child of group.children) add(frame(child))
    return marks.group({ id: id(item.id, 'frame'), role: 'group', open: `<g class="cluster c4-boundary" ${metadata(item)}>`, close: '</g>', children, channels: { category: item.kind } })
  }
  // Preserve the common root/resources/title/routes, replacing generic graph
  // surfaces with C4-owned typed primitives and explicit semantic metadata.
  const genericNodeIds = new Set(positioned.nodes.map(node => `node:${node.id}`)), genericGroupIds = new Set(positioned.groups.map(group => `group:${group.id}`))
  const relationshipById = new Map(body.relationships.map(item => [item.id, item]))
  const parts = base.parts.filter(part => !genericNodeIds.has(part.id) && !genericGroupIds.has(part.id) && part.role !== 'edge-label').map(part => {
    if (part.kind !== 'connector') return part
    const item = relationshipById.get(part.identity?.id ?? '')
    if (!item) return part
    const metadata = `data-c4-macro="${escapeAttr(item.macro)}" data-authored-from="${escapeAttr(item.from)}" data-authored-to="${escapeAttr(item.to)}" data-order="${item.order}"${item.index === undefined ? '' : ` data-index="${escapeAttr(item.index)}"`}${item.tags.length ? ` data-tags="${escapeAttr(JSON.stringify(item.tags))}"` : ''}${link(item.effectiveLink ?? item.link, true)}`
    const stroke = item.style.lineStyle === 'dotted' ? { ...part.stroke, dash: { array: '1 3' } } : part.stroke
    return marks.connector({ id: id(item.id, 'relationship'), role: 'edge', identity: part.identity, geometry: part.route.geometry, paint: { stroke: stroke.color, strokeWidth: String(stroke.width) }, lineStyle: part.lineStyle, endpoints: part.endpoints, relationship: { ...part.relationship, kind: `c4-${item.macro}` }, route: part.route, stroke, markers: part.markers, hit: part.hit, labels: part.labels.map(label => ({ ...label, visual: { kind: 'companion', markId: id(item.id, 'label-text') }, ...(item.style.textColor ? { paint: { ...label.paint, fill: item.style.textColor } } : {}) })), channels: { category: 'relationship', ...(item.tags.length ? { status: item.tags.join(',') } : {}) } }, sceneNodeSerialization(part).replace(/stroke-dasharray="[^"]*"/, `stroke-dasharray="${item.style.lineStyle === 'dotted' ? '1 3' : '4 4'}"`).replace(/^<(path|polyline)\b/, `<$1 ${metadata}`).replace('data-relationship="flowchart-edge"', `data-relationship="c4-${escapeAttr(item.macro)}"`))
  })
  const firstRoute = parts.findIndex(part => part.kind === 'connector')
  parts.splice(firstRoute < 0 ? Math.max(0, parts.length - 1) : firstRoute, 0, ...positioned.groups.map(frame))
  const labels = positioned.edges.flatMap(edge => {
    if (!edge.label || !edge.labelBlock || !edge.labelPosition) return []
    const item = relationshipById.get(edge.id!)!, block = edge.labelBlock, { x, y } = edge.labelPosition, color = item.style.textColor ?? item.style.fontColor ?? style.edgeTextColor ?? 'var(--_text-sec)'
    const width = block.width + 20, height = block.height + 16
    return [marks.group({ id: id(item.id, 'relationship-label'), role: 'edge-label', open: `<g class="edge-label" data-id="${escapeAttr(id(item.id, 'label'))}" data-edge-id="${escapeAttr(item.id)}" data-from="${escapeAttr(item.source)}" data-to="${escapeAttr(item.target)}">`, close: '</g>', children: [
      { indent: 2, node: marks.shape({ id: id(item.id, 'label-halo'), role: 'chrome', geometry: { kind: 'rect', x: x - width / 2, y: y - height / 2, width, height, rx: 3, ry: 3 }, paint: { fill: 'var(--bg)', stroke: 'var(--_inner-stroke)', strokeWidth: '1' } }, `<rect x="${x - width / 2}" y="${y - height / 2}" width="${width}" height="${height}" rx="3" ry="3" fill="var(--bg)" stroke="var(--_inner-stroke)" stroke-width="1"/>`) },
      { indent: 2, node: marks.text({ id: id(item.id, 'label-text'), role: 'label', text: block.text, block, x, y, fontSize: block.fontSize, fontWeight: block.fontWeight, letterSpacing: block.letterSpacing, anchor: 'middle', paint: { fill: color }, pageFill: item.style.textColor ?? item.style.fontColor ?? toneOnFill('var(--_text-sec)', 'var(--bg)', ctx.colors) }, renderMultilineText(block, x, y, block.fontSize, `text-anchor="middle" font-size="${block.fontSize}" font-weight="${block.fontWeight}" letter-spacing="${block.letterSpacing}" fill="${escapeAttr(color)}"`)) },
    ] })]
  })
  parts.splice(parts.length - 1, 0, ...labels, ...positioned.nodes.map(node => card(body.elements.find(item => item.id === node.id)!, node)))
  if (positioned.legend) {
    const legend = positioned.legend, children: Array<{ node: SceneNode; indent: number }> = []
    let y = legend.y + 20
    const heading = marks.text({ id: id('legend', 'heading'), role: 'legend', text: 'Legend', x: legend.x + 12, y, fontSize: 13, fontWeight: 600, anchor: 'start', paint: { fill: 'var(--_text)' } }, `<text x="${legend.x + 12}" y="${y}" font-size="13" font-weight="600" text-anchor="start" fill="var(--_text)">Legend</text>`)
    children.push({ node: heading, indent: 2 }); y += 20
    for (const entry of legend.entries) {
      const { block } = entry, x = legend.x + 38, cy = y + block.height / 2
      const color = entry.style.borderColor ?? entry.style.lineColor ?? 'var(--_line)', fill = entry.style.bgColor ?? 'var(--_node-fill)'
      const geometry: Geometry = entry.kind === 'relationship' ? { kind: 'line', x1: legend.x + 10, y1: cy, x2: legend.x + 28, y2: cy } : { kind: 'rect', x: legend.x + 10, y, width: 18, height: block.height }
      children.push({ indent: 2, node: marks.shape({ id: id(entry.id, 'legend-swatch'), role: 'legend', geometry, paint: { fill, stroke: color, strokeWidth: '1' } }, entry.kind === 'relationship' ? `<line x1="${legend.x + 10}" y1="${cy}" x2="${legend.x + 28}" y2="${cy}" fill="${escapeAttr(fill)}" stroke="${escapeAttr(color)}" stroke-width="1"/>` : `<rect x="${legend.x + 10}" y="${y}" width="18" height="${block.height}" fill="${escapeAttr(fill)}" stroke="${escapeAttr(color)}" stroke-width="1"/>`) })
      children.push({ indent: 2, node: marks.text({ id: id(entry.id, 'legend-text'), role: 'legend', text: block.text, block, x, y: cy, fontSize: block.fontSize, fontWeight: block.fontWeight, anchor: 'start', paint: { fill: 'var(--_text)' } }, renderMultilineText(block, x, cy, block.fontSize, `text-anchor="start" font-size="${block.fontSize}" font-weight="${block.fontWeight}" fill="var(--_text)"`)) })
      y += block.height + 10
    }
    parts.splice(parts.length - 1, 0, marks.group({ id: id('legend', 'container'), role: 'legend', open: '<g class="c4-legend">', close: '</g>', children }))
  }
  return { ...base, family: 'c4', parts }
}
