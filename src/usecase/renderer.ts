import { inkOnNodeFill } from '../color-resolver.ts'
import { escapeAttr } from '../multiline-utils.ts'
import { type DrawingDocument, type DrawingFactory, sceneLowering } from '../scene/drawing.ts'
import type { Geometry, MarkerDescriptor } from '../scene/ir.ts'
import { serializeMarkerResources, tipAnchoredArrow } from '../scene/marker-resources.ts'
import { LABEL_PILL_PADDING, labelHaloExtension } from '../shared/edge-label-geometry.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { drawingDocument } from '../shared/scene-document.ts'
import { diagramTitleFields, resolveRenderStyle } from '../styles.ts'
import type { PositionedGroup, RenderContext } from '../types.ts'
import type { PositionedUsecase } from './types.ts'

export function lowerUsecaseDrawing<T>(marks: DrawingFactory<T>, { positioned: chart, colors, resolved }: RenderContext<PositionedUsecase>): DrawingDocument<T> {
  const style = resolveRenderStyle(resolved.renderOptions, undefined, resolved.styleFace),
    body = chart.body,
    parts: T[] = []
  const ink = style.nodeTextColor ?? 'var(--_text)',
    line = style.edgeStrokeColor ?? 'var(--_line)'
  const arrow = tipAnchoredArrow('usecase-arrow', { width: 8, height: 6 }, 'end', { fill: line }, 'userSpaceOnUse')
  const open = tipAnchoredArrow('usecase-dependency', { width: 9, height: 7 }, 'end', { fill: 'none', stroke: line, strokeWidth: '1' }, 'userSpaceOnUse')
  const triangle = { ...tipAnchoredArrow('usecase-generalization', { width: 11, height: 10 }, 'end', { fill: 'var(--bg)', stroke: line, strokeWidth: '1' }, 'userSpaceOnUse'), shape: 'triangle' as const }
  const reverse = tipAnchoredArrow('usecase-back-arrow', { width: 8, height: 6 }, 'start', { fill: line }, 'userSpaceOnUse')
  const circle: MarkerDescriptor = { id: 'usecase-circle', shape: 'circle', size: { width: 8, height: 8 }, ref: { x: 4, y: 4 }, orient: 'auto', units: 'userSpaceOnUse', geometry: { kind: 'circle', cx: 4, cy: 4, r: 3 }, paint: { fill: 'var(--bg)', stroke: line, strokeWidth: '1' } }
  const cross: MarkerDescriptor = { id: 'usecase-cross', shape: 'cross', size: { width: 8, height: 8 }, ref: { x: 4, y: 4 }, orient: 'auto', units: 'userSpaceOnUse', geometry: { kind: 'path', d: 'M1 1L7 7M7 1L1 7' }, paint: { fill: 'none', stroke: line, strokeWidth: '1' } }
  const markers = [arrow, reverse, open, triangle, circle, cross]
  parts.push(marks.definitions({ id: 'defs', markerResources: markers }, `<defs>${serializeMarkerResources(markers)}</defs>`))
  if (chart.title) parts.push(marks.text(diagramTitleFields(chart.title, style)))
  const nodesById = new Map(body.nodes.map(node => [node.id, node])),
    notesById = new Map(body.notes.map(note => [note.id, note]))
  const nodeMarks = new Map<string, T>()
  for (const placed of chart.nodes) {
    const node = nodesById.get(placed.id),
      note = notesById.get(placed.id),
      owner = { id: placed.id, role: 'node' as const },
      inner: T[] = []
    const { x, y, width, height } = placed,
      stroke = placed.inlineStyle?.stroke ?? style.nodeBorderColor ?? 'var(--_node-stroke)',
      fill = placed.inlineStyle?.fill ?? style.nodeFillColor ?? 'var(--_node-fill)',
      color = node?.kind === 'actor' ? (placed.inlineStyle?.color ?? ink) : inkOnNodeFill(placed.inlineStyle, colors, style.nodeTextColor === undefined ? fill : undefined)(ink)
    let geometry: Geometry
    if (node?.kind === 'actor') {
      const cx = x + width / 2,
        glyph = chart.actors.get(node.id)!
      geometry = glyph.geometry
      inner.push(marks.shape({ id: `actor:${node.id}`, identity: false, role: 'node', owner, geometry, paint: { fill: node.type === 'hollow' ? 'var(--bg)' : fill, stroke, strokeWidth: String(style.nodeLineWidth) }, channels: { category: 'actor', ...(node.business ? { emphasis: true } : {}) } }))
      if (node.icon) {
        const icon = preparePixelText(`[${node.icon}]`, { fontSize: Math.min(10, style.nodeLabelFontSize), fontWeight: style.nodeLabelFontWeight, display: 'literal' })
        inner.push(marks.text({ id: `icon:${node.id}`, role: 'label', owner, text: icon.text, block: icon, x: cx, y: y + height - 8, fontSize: icon.fontSize, fontWeight: icon.fontWeight, anchor: 'middle', paint: { fill: color } }))
      }
    } else {
      geometry = node?.kind === 'usecase' && node.shape === 'ellipse' ? { kind: 'ellipse', cx: x + width / 2, cy: y + height / 2, rx: width / 2, ry: height / 2 } : { kind: 'rect', x, y, width, height, rx: note ? Math.min(2, style.cornerRadius ?? 2) : style.cornerRadius }
      inner.push(marks.shape({ id: `shape:${placed.id}`, identity: false, role: 'node', owner, geometry, paint: { fill, stroke, strokeWidth: String(style.nodeLineWidth) }, channels: { category: node ? 'usecase' : note ? 'note' : 'data', ...(node?.business ? { emphasis: true } : {}) } }))
    }
    const block = placed.labelBlock!
    inner.push(marks.text({ id: `label:${placed.id}`, role: 'label', owner, text: block.text, block, x: x + width / 2, y: node?.kind === 'actor' ? y + height - block.height / 2 - (node.icon ? 24 : 8) : y + height / 2, fontSize: block.fontSize, fontWeight: block.fontWeight, anchor: 'middle', paint: { fill: color } }))
    nodeMarks.set(placed.id, marks.group({ id: placed.id, role: 'node', open: `<g${node?.parentId ? ` data-parent="${escapeAttr(node.parentId)}"` : ''}>`, close: '</g>', children: inner.map(node => ({ node, indent: 2 })), channels: { category: node?.kind ?? (note ? 'note' : 'data') } }))
  }
  const boundaryById = new Map(body.boundaries.map(boundary => [boundary.id, boundary]))
  const frame = (group: PositionedGroup): T => {
    const boundary = boundaryById.get(group.id)!,
      owner = { id: group.id, role: 'group' as const },
      children: T[] = [],
      header = group.headerHeight ?? 30
    children.push(
      marks.shape({
        id: `frame:${group.id}`,
        identity: false,
        role: 'group',
        owner,
        geometry: { kind: 'rect', x: group.x, y: group.y, width: group.width, height: group.height, rx: style.groupCornerRadius },
        paint: { fill: group.inlineStyle?.fill ?? style.groupFillColor ?? 'var(--_group-fill)', stroke: group.inlineStyle?.stroke ?? style.groupBorderColor ?? 'var(--_node-stroke)', strokeWidth: String(style.groupLineWidth) },
      }),
    )
    if (boundary.type === 'package')
      children.push(marks.shape({ id: `tab:${group.id}`, identity: false, role: 'group', owner, geometry: { kind: 'rect', x: group.x, y: group.y, width: Math.min(group.width / 3, 60), height: 8 }, paint: { fill: 'var(--_group-fill)', stroke: 'var(--_node-stroke)', strokeWidth: String(style.groupLineWidth) } }))
    if (group.labelBlock)
      children.push(
        marks.text({
          id: `label:${group.id}`,
          role: 'label',
          owner,
          text: group.labelBlock.text,
          block: group.labelBlock,
          x: group.x + group.width / 2,
          y: group.y + header / 2,
          fontSize: group.labelBlock.fontSize,
          fontWeight: group.labelBlock.fontWeight,
          anchor: 'middle',
          paint: { fill: style.groupTextColor ?? ink },
        }),
      )
    for (const member of group.nodeIds ?? boundary.members) {
      const mark = nodeMarks.get(member)
      if (mark) children.push(mark)
    }
    return marks.group({ id: group.id, role: 'group', open: '<g>', close: '</g>', children: children.map(node => ({ node, indent: 2 })) })
  }
  for (const group of chart.groups) parts.push(frame(group))
  const edgesById = new Map(body.relationships.map(edge => [edge.id, edge]))
  for (const edge of chart.edges) {
    const relation = edgesById.get(edge.id!),
      owner = { id: edge.id!, role: 'edge' as const },
      actorAttachments = chart.actorAttachments.get(edge.id!),
      marker = relation?.type === 'generalization' ? triangle : relation?.type === 'include' || relation?.type === 'extend' ? open : arrow
    const start = edge.hasArrowStart ? (edge.startMarker === 'circle' ? circle : edge.startMarker === 'cross' ? cross : reverse) : undefined
    const end = edge.hasArrowEnd ? (edge.endMarker === 'circle' ? circle : edge.endMarker === 'cross' ? cross : marker) : undefined
    parts.push(
      marks.connector({
        id: edge.id!,
        role: 'edge',
        geometry: { kind: 'polyline', points: edge.points },
        lineStyle: edge.style === 'dotted' ? 'dashed' : 'solid',
        paint: { stroke: edge.inlineStyle?.stroke ?? line, strokeWidth: edge.inlineStyle?.['stroke-width'] ?? String(style.lineWidth) },
        endpoints: { from: edge.source, to: edge.target,
          ...Object.fromEntries((['start', 'end'] as const).flatMap(end => {
            const attachment = actorAttachments?.[end]
            return attachment ? [[end, { owner: { id: attachment.ownerId, role: 'node' }, portId: attachment.portId, point: attachment.point }]] : []
          })),
        },
        relationship: { kind: relation?.type ?? 'note-attachment', direction: start ? 'reverse' : end ? 'forward' : 'undirected' },
        markers: { ...(start ? { start } : {}), ...(end ? { end } : {}) },
      }),
    )
    if (edge.labelBlock && edge.labelPosition) {
      const padding = LABEL_PILL_PADDING + labelHaloExtension(edge, style.lineWidth),
        block = edge.labelBlock,
        position = edge.labelPosition
      parts.push(
        marks.shape({
          id: `label:${edge.id}:halo`,
          role: 'chrome',
          owner,
          geometry: { kind: 'rect', x: position.x - block.width / 2 - padding, y: position.y - block.height / 2 - padding, width: block.width + padding * 2, height: block.height + padding * 2, rx: 4 },
          paint: { fill: 'var(--bg)', stroke: 'none' },
          attributes: { className: 'edge-label-halo' },
        }),
      )
      parts.push(marks.text({ id: `label:${edge.id}`, role: 'label', owner, text: edge.labelBlock.text, block: edge.labelBlock, x: edge.labelPosition.x, y: edge.labelPosition.y, fontSize: edge.labelBlock.fontSize, fontWeight: edge.labelBlock.fontWeight, anchor: 'middle', paint: { fill: style.edgeTextColor ?? ink } }))
    }
  }
  const parentIds = new Set(body.nodes.filter(node => node.parentId).map(node => node.id))
  for (const [id, mark] of nodeMarks) if (!parentIds.has(id)) parts.push(mark)
  return drawingDocument(marks, 'usecase', chart, colors, resolved.renderOptions.transparent ?? false, parts)
}
export const lowerUsecaseScene = sceneLowering<PositionedUsecase>(lowerUsecaseDrawing)
