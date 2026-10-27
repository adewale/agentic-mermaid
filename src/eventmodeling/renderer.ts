import { sceneLowering, type DrawingFactory, type DrawingDocument } from '../scene/drawing.ts'
import type { RenderContext } from '../types.ts'
import type { PositionedEventModeling } from './layout.ts'
import { FLOWCHART_STYLE_DEFAULTS, resolveRenderStyle, diagramTitleFields } from '../styles.ts'
import { drawingDocument } from '../shared/scene-document.ts'
import { serializeMarkerResources, tipAnchoredArrow } from '../scene/marker-resources.ts'
import { createFillInkResolver } from '../color-resolver.ts'
const arrow = tipAnchoredArrow('eventmodeling-arrow', { width: 8, height: 8 }, 'end', { fill: 'var(--_line)' }, 'userSpaceOnUse')
export function lowerEventModelingDrawing<T>(marks: DrawingFactory<T>, { positioned: p, colors, resolved }: RenderContext<PositionedEventModeling>): DrawingDocument<T> {
  const style = resolveRenderStyle(resolved.renderOptions, FLOWCHART_STYLE_DEFAULTS, resolved.styleFace), parts: T[] = [], ink = createFillInkResolver(colors)
  const marker = style.edgeStrokeColor ? { ...arrow, paint: { ...arrow.paint, fill: style.edgeStrokeColor } } : arrow
  parts.push(marks.definitions({ id: 'defs', markerResources: [marker] }, `<defs>${serializeMarkerResources([marker])}</defs>`))
  if (p.title) parts.push(marks.text(diagramTitleFields(p.title, style)))
  const frame = (item: PositionedEventModeling['frames'][number]): T => {
    const owner = { id: item.frame.id, role: 'node' as const }, fill = style.nodeFillColor ?? 'var(--_node-fill)'
    return marks.group({ id: item.frame.id, role: 'node', open: '<g>', close: '</g>', children: [
      { node: marks.shape({ id: `box:${item.frame.id}`, role: 'node', identity: false, owner, geometry: { kind: 'rect', x: item.x, y: item.y, width: item.width, height: item.height, rx: style.cornerRadius ?? 4 }, paint: { fill, stroke: style.nodeBorderColor ?? 'var(--_node-stroke)', strokeWidth: String(style.nodeLineWidth) } }), indent: 2 },
      { node: marks.text({ id: `label:${item.frame.id}`, role: 'label', owner, text: item.block.text, block: item.block, x: item.x + item.width / 2, y: item.y + item.height / 2, fontSize: item.block.fontSize, fontWeight: item.block.fontWeight, anchor: 'middle', paint: { fill: style.nodeTextColor ?? ink('var(--_text)', fill) } }), indent: 2 },
    ] })
  }
  for (const lane of p.lanes) parts.push(marks.group({ id: `lane:${lane.id}`, role: 'group', open: '<g>', close: '</g>', children: [
    { node: marks.shape({ id: `lane-box:${lane.id}`, role: 'group', identity: false, owner: { id: `lane:${lane.id}`, role: 'group' }, geometry: { kind: 'rect', x: 8, y: lane.y, width: p.width - 16, height: lane.height, rx: style.groupCornerRadius }, paint: { fill: style.groupFillColor ?? 'none', stroke: style.groupBorderColor ?? 'var(--_line)', strokeWidth: String(style.groupLineWidth) } }), indent: 2 },
    { node: marks.text({ id: `lane-label:${lane.id}`, role: 'label', owner: { id: `lane:${lane.id}`, role: 'group' }, text: lane.block.text, block: lane.block, x: 20, y: lane.y + lane.height / 2, fontSize: lane.block.fontSize, fontWeight: lane.block.fontWeight, anchor: 'start', paint: { fill: style.groupTextColor ?? 'var(--_text)' } }), indent: 2 },
    ...p.frames.filter(item => item.lane === lane.id).map(item => ({ node: frame(item), indent: 2 })),
  ] }))
  // Cross-lane routes paint above lane surfaces. Their certified gutters keep
  // them clear of frame text while retaining the actual Scene parent tree.
  for (const edge of p.relations) parts.push(marks.connector({ id: edge.id, role: 'edge', geometry: { kind: 'polyline', points: edge.points }, lineStyle: 'solid', paint: { stroke: style.edgeStrokeColor ?? 'var(--_line)', strokeWidth: String(style.lineWidth) }, endpoints: { from: edge.from, to: edge.to }, relationship: { kind: edge.inferred ? 'inferred' : 'explicit', direction: 'forward' }, markers: { end: marker } }))
  return drawingDocument(marks, 'eventmodeling', p, colors, resolved.renderOptions.transparent ?? false, parts)
}
export const lowerEventModelingScene = sceneLowering<PositionedEventModeling>(lowerEventModelingDrawing)
