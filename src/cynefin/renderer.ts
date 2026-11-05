import { sceneLowering, type DrawingDocument, type DrawingFactory } from '../scene/drawing.ts'
import { drawingDocument } from '../shared/scene-document.ts'
import { diagramTitleFields, resolveRenderStyle } from '../styles.ts'
import { serializeMarkerResources, tipAnchoredArrow } from '../scene/marker-resources.ts'
import type { RenderContext } from '../types.ts'
import type { PositionedCynefin, CynefinPlacedLabel } from './types.ts'
export function lowerCynefinDrawing<T>(marks: DrawingFactory<T>, { positioned: chart, colors, resolved }: RenderContext<PositionedCynefin>): DrawingDocument<T> {
  const style = resolveRenderStyle(resolved.renderOptions, undefined, resolved.styleFace), parts: T[] = []
  const stroke = style.edgeStrokeColor ?? 'var(--_line)', ink = style.nodeTextColor ?? 'var(--_text)'
  const arrow = tipAnchoredArrow('cynefin-arrow', { width: 8, height: 8 }, 'end', { fill: stroke }, 'userSpaceOnUse')
  parts.push(marks.definitions({ id: 'defs', markerResources: [arrow] }, `<defs>${serializeMarkerResources([arrow])}</defs>`))
  if (chart.title) parts.push(marks.text(diagramTitleFields(chart.title, style)))
  const label = (item: CynefinPlacedLabel, owner: { id: string; role: 'node' | 'group' | 'edge' }) => marks.text({ id: `label:${item.id}`, role: 'label', owner, text: item.block.text, block: item.block, x: item.x, y: item.y, fontSize: item.block.fontSize, fontWeight: item.block.fontWeight, anchor: 'middle', paint: { fill: owner.role === 'edge' ? style.edgeTextColor ?? ink : owner.role === 'group' ? style.groupTextColor ?? ink : ink, stroke: 'var(--bg)', strokeWidth: '3', strokeLinejoin: 'round', paintOrder: 'stroke' } })
  for (const domain of chart.domains) {
    parts.push(marks.shape({ id: domain.name, role: 'group', geometry: { kind: 'rect', x: domain.x, y: domain.y, width: domain.width, height: domain.height, rx: style.groupCornerRadius }, paint: { fill: style.groupFillColor ?? 'var(--_group-fill)', stroke: style.groupBorderColor ?? 'var(--_node-stroke)', strokeWidth: String(style.groupLineWidth) } }))
    parts.push(label(domain.heading, { id: domain.name, role: 'group' }))
    for (const item of domain.items) parts.push(marks.group({ id: item.id, role: 'node', open: `<g data-parent="${domain.name}">`, close: '</g>', children: [{ node: label(item, { id: item.id, role: 'node' }), indent: 2 }] }))
  }
  for (const transition of chart.transitions) {
    parts.push(marks.connector({ id: transition.id, role: 'edge', geometry: { kind: 'polyline', points: transition.points }, lineStyle: 'solid', paint: { stroke, strokeWidth: String(style.lineWidth) }, endpoints: { from: transition.from, to: transition.to }, relationship: { kind: 'domain-transition', direction: 'forward' }, markers: { end: arrow } }))
    if (transition.label) parts.push(label(transition.label, { id: transition.id, role: 'edge' }))
  }
  return drawingDocument(marks, 'cynefin', chart, colors, resolved.renderOptions.transparent ?? false, parts)
}
export const lowerCynefinScene = sceneLowering<PositionedCynefin>(lowerCynefinDrawing)
