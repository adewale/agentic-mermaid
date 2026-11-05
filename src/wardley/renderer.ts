import { sceneLowering, type DrawingDocument, type DrawingFactory } from '../scene/drawing.ts'
import { drawingDocument } from '../shared/scene-document.ts'
import { diagramTitleFields, resolveRenderStyle } from '../styles.ts'
import { serializeMarkerResources, tipAnchoredArrow } from '../scene/marker-resources.ts'
import type { RenderContext } from '../types.ts'
import type { PositionedWardley, WardleyPlacedText } from './types.ts'

export function lowerWardleyDrawing<T>(marks: DrawingFactory<T>, { positioned: chart, colors, resolved }: RenderContext<PositionedWardley>): DrawingDocument<T> {
  const style = resolveRenderStyle(resolved.renderOptions, undefined, resolved.styleFace), parts: T[] = []
  const nodeStroke = style.nodeBorderColor ?? 'var(--_node-stroke)'
  const stroke = style.edgeStrokeColor ?? 'var(--_line)', ink = style.nodeTextColor ?? 'var(--_text)', fill = style.nodeFillColor ?? 'var(--_node-fill)'
  const arrow = tipAnchoredArrow('wardley-arrow', { width: 7, height: 7 }, 'end', { fill: stroke }, 'userSpaceOnUse')
  parts.push(marks.definitions({ id: 'defs', markerResources: [arrow] }, `<defs>${serializeMarkerResources([arrow])}</defs>`))
  if (chart.title) parts.push(marks.text(diagramTitleFields(chart.title, style)))
  const text = (item: WardleyPlacedText, owner?: { id: string; role: 'node' | 'edge' }) => marks.text({ id: `label:${item.id}`, role: 'label', ...(owner ? { owner } : {}), text: item.text, block: item.block, x: item.x, y: item.y, fontSize: item.block.fontSize, fontWeight: item.block.fontWeight, anchor: 'middle', paint: { fill: ink, stroke: 'var(--bg)', strokeWidth: '3', strokeLinejoin: 'round', paintOrder: 'stroke' } })
  const p = chart.plot
  parts.push(marks.connector({ id: 'axes', role: 'rail', geometry: { kind: 'polyline', points: [{ x: p.x, y: p.y }, { x: p.x, y: p.y + p.height }, { x: p.x + p.width, y: p.y + p.height }] }, lineStyle: 'solid', paint: { stroke, strokeWidth: String(style.lineWidth) } }))
  const stages = chart.body.axes.stages ?? ['Genesis', 'Custom built', 'Product', 'Commodity']
  for (let index = 0; index < stages.length - 1; index++) {
    const boundary = chart.body.axes.stageBoundaries?.[index] ?? (index + 1) / stages.length
    parts.push(marks.connector({ id: `stage-boundary:${index}`, role: 'rail', geometry: { kind: 'polyline', points: [{ x: p.x + boundary * p.width, y: p.y }, { x: p.x + boundary * p.width, y: p.y + p.height }] }, lineStyle: 'dashed', paint: { stroke: 'var(--_line)', strokeWidth: '1', opacity: '0.4' } }))
  }
  for (const pipeline of chart.pipelines) parts.push(marks.shape({ id: pipeline.id, role: 'group', geometry: { kind: 'rect', x: pipeline.x, y: pipeline.y, width: pipeline.width, height: pipeline.height, rx: 12 }, paint: { fill: 'none', stroke: style.groupBorderColor ?? 'var(--_node-stroke)', strokeWidth: String(style.groupLineWidth) } }))
  for (const edge of chart.edges) {
    parts.push(marks.connector({ id: edge.id, role: 'edge', geometry: { kind: 'polyline', points: edge.points }, lineStyle: edge.dashed ? 'dashed' : 'solid', paint: { stroke, strokeWidth: String(style.lineWidth) },
      endpoints: { from: edge.from, to: edge.to }, relationship: { kind: edge.trend ? 'evolution' : 'dependency', direction: edge.flow === 'backward' ? 'reverse' : edge.flow ?? 'undirected' },
      ...(edge.flow ? { markers: { ...(edge.flow === 'backward' || edge.flow === 'bidirectional' ? { start: arrow } : {}), ...(edge.flow === 'forward' || edge.flow === 'bidirectional' ? { end: arrow } : {}) } } : {}) }))
    if (edge.label) parts.push(text(edge.label, { id: edge.id, role: 'edge' }))
  }
  for (const item of chart.nodes) {
    const owner = { id: item.id, role: 'node' as const }
    const children: T[] = []
    children.push(marks.shape({ id: `${item.id}:mark`, identity: false, owner, role: 'node', geometry: item.node.isPipelineParent ? { kind: 'rect', x: item.x - 6, y: item.y - 6, width: 12, height: 12 } : { kind: 'circle', cx: item.x, cy: item.y, r: item.node.className === 'anchor' ? 7 : 5 }, paint: { fill: item.node.className === 'anchor' ? stroke : fill, stroke: nodeStroke, strokeWidth: String(style.nodeLineWidth) }, attributes: { data: { evolution: String(item.node.x), visibility: String(item.node.y), ...(item.node.sourceStrategy ? { strategy: item.node.sourceStrategy } : {}) } } }))
    if (item.node.inertia) children.push(marks.shape({ id: `${item.id}:inertia`, identity: false, role: 'node', owner, geometry: { kind: 'circle', cx: item.x, cy: item.y, r: 9 }, paint: { fill: 'none', stroke: nodeStroke, strokeWidth: String(style.nodeLineWidth) } }))
    children.push(text({ ...item, x: item.x + (item.node.labelOffsetX ?? 14), y: item.y + (item.node.labelOffsetY ?? -14) }, owner))
    parts.push(marks.group({ id: item.id, role: 'node', open: '<g>', close: '</g>', children: children.map(node => ({ node, indent: 2 })) }))
  }
  chart.labels.forEach(label => parts.push(text(label)))
  return drawingDocument(marks, 'wardley', chart, colors, resolved.renderOptions.transparent ?? false, parts)
}
export const lowerWardleyScene = sceneLowering<PositionedWardley>(lowerWardleyDrawing)
