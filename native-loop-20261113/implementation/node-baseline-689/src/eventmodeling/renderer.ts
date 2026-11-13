import { sceneLowering, type DrawingFactory, type DrawingDocument } from '../scene/drawing.ts'
import { drawingDocument } from '../shared/scene-document.ts'
import { diagramTitleFields } from '../styles.ts'
import { serializeMarkerResources } from '../scene/marker-resources.ts'
import { createFillInkResolver } from '../color-resolver.ts'
import type { RenderContext } from '../types.ts'
import type { PositionedEventModeling } from './layout.ts'
import { eventModelingArrow as arrow } from './markers.ts'
function lowerEventModelingDrawing<T>(marks: DrawingFactory<T>, { positioned: diagram, colors, resolved }: RenderContext<PositionedEventModeling>): DrawingDocument<T> {
  const style = diagram.style
  const ink = createFillInkResolver(colors)
  const marker = style.edgeStrokeColor ? { ...arrow, paint: { ...arrow.paint, fill: style.edgeStrokeColor } } : arrow
  const parts: T[] = [marks.definitions({ id: 'defs', markerResources: [marker] }, `<defs>${serializeMarkerResources([marker])}</defs>`)]
  if (diagram.title) parts.push(marks.text(diagramTitleFields(diagram.title, style)))
  for (const lane of diagram.lanes) {
    const owner = { id: lane.id, role: 'group' as const }
    parts.push(
      marks.group({
        id: lane.id,
        role: 'group',
        open: '<g>',
        close: '</g>',
        children: [
          {
            node: marks.shape({
              id: `${lane.id}:surface`,
              role: 'group',
              identity: false,
              owner,
              geometry: { kind: 'rect', x: lane.x, y: lane.y, width: lane.width, height: lane.height, rx: style.groupCornerRadius },
              paint: { fill: style.groupFillColor ?? 'var(--_group-fill)', stroke: style.groupBorderColor ?? 'var(--_node-stroke)', strokeWidth: String(style.groupLineWidth) },
            }),
            indent: 2,
          },
          ...(style.groupHeaderFillColor ? [{ node: marks.shape({ id: `${lane.id}:header`, role: 'chrome', owner, geometry: { kind: 'rect' as const, x: lane.x, y: lane.y, width: diagram.laneWidth, height: lane.height, rx: style.groupCornerRadius }, paint: { fill: style.groupHeaderFillColor, stroke: 'none' } }), indent: 2 }] : []),
          { node: marks.text({ id: `${lane.id}:label`, role: 'label', owner, text: lane.block.text, block: lane.block, x: lane.x + style.groupLabelPaddingX, y: lane.y + lane.height / 2, anchor: 'start', fontSize: lane.block.fontSize, fontWeight: lane.block.fontWeight, letterSpacing: lane.block.letterSpacing, paint: { fill: style.groupTextColor ?? ink('var(--_text)', style.groupHeaderFillColor ?? style.groupFillColor ?? 'var(--_group-fill)') } }), indent: 2 },
        ],
      }),
    )
  }
  for (const edge of diagram.edges)
    parts.push(
      marks.connector({
        id: edge.id,
        role: 'edge',
        geometry: edge.projection?.geometry ?? { kind: 'polyline', points: edge.points },
        route: { ownership: 'layout', bendRadius: style.edgeBendRadius, ...(edge.projection ? { contours: edge.projection.contours } : {}) },
        lineStyle: 'solid',
        paint: { stroke: style.edgeStrokeColor ?? 'var(--_line)', strokeWidth: String(style.lineWidth) },
        endpoints: { from: edge.from, to: edge.to },
        relationship: { kind: edge.explicit ? 'explicit' : 'inferred', direction: 'forward' },
        markers: { end: marker },
      }),
    )
  for (const node of diagram.nodes) {
    const owner = { id: node.id, role: 'node' as const },
      fill = style.nodeFillColor ?? 'var(--_node-fill)'
    parts.push(
      marks.group({
        id: node.id,
        role: 'node',
        open: `<g data-parent="${node.lane}">`,
        close: '</g>',
        children: [
          {
            node: marks.shape({
              id: `${node.id}:surface`,
              role: 'node',
              identity: false,
              owner,
              geometry: { kind: 'rect', x: node.x, y: node.y, width: node.width, height: node.height, rx: style.cornerRadius ?? 5 },
              paint: { fill, stroke: style.nodeBorderColor ?? 'var(--_node-stroke)', strokeWidth: String(style.nodeLineWidth) },
            }),
            indent: 2,
          },
          {
            node: marks.text({
              id: `${node.id}:label`,
              role: 'label',
              owner,
              text: node.block.text,
              block: node.block,
              x: node.x + node.width / 2,
              y: node.y + node.height / 2,
              anchor: 'middle',
              fontSize: node.block.fontSize,
              fontWeight: node.block.fontWeight,
              letterSpacing: node.block.letterSpacing,
              paint: { fill: style.nodeTextColor ?? ink('var(--_text)', fill) },
            }),
            indent: 2,
          },
        ],
      }),
    )
  }
  return drawingDocument(marks, 'eventmodeling', diagram, colors, resolved.renderOptions.transparent ?? false, parts)
}
export const lowerEventModelingScene = sceneLowering<PositionedEventModeling>(lowerEventModelingDrawing)
