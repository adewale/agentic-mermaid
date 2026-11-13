import { sceneLowering, type DrawingFactory, type DrawingDocument } from '../scene/drawing.ts'
import type { PositionedIshikawa } from './types.ts'
import type { RenderContext } from '../types.ts'
import type { SceneNode } from '../scene/ir.ts'
import { FLOWCHART_STYLE_DEFAULTS, resolveRenderStyle, diagramTitleFields } from '../styles.ts'
import { drawingDocument } from '../shared/scene-document.ts'
import { serializeMarkerResources, tipAnchoredArrow } from '../scene/marker-resources.ts'
import { createFillInkResolver } from '../color-resolver.ts'

const arrow = tipAnchoredArrow('ishikawa-arrow', { width: 8, height: 8 }, 'end', { fill: 'var(--_line)' }, 'userSpaceOnUse')

export function lowerIshikawaDrawing<T>(marks: DrawingFactory<T>, { positioned: diagram, colors, resolved }: RenderContext<PositionedIshikawa>): DrawingDocument<T> {
  const style = resolveRenderStyle(resolved.renderOptions, FLOWCHART_STYLE_DEFAULTS, resolved.styleFace)
  const inkOnFill = createFillInkResolver(colors)
  const marker = style.edgeStrokeColor ? { ...arrow, paint: { ...arrow.paint, fill: style.edgeStrokeColor } } : arrow
  const parts: T[] = []
  parts.push(marks.definitions({ id: 'defs', markerResources: [marker] }, `<defs>${serializeMarkerResources([marker])}</defs>`))
  if (diagram.title) parts.push(marks.text(diagramTitleFields(diagram.title, style)))
  const effect = diagram.nodes.find(item => item.depth === 0)
  if (diagram.spine.length)
    parts.push(
      marks.connector({
        id: 'spine', role: 'rail', geometry: { kind: 'polyline', points: diagram.spine }, lineStyle: 'solid',
        paint: { stroke: style.edgeStrokeColor ?? 'var(--_line)', strokeWidth: String(style.lineWidth) },
        ...(effect ? { endpoints: { to: effect.node.id, end: { owner: { id: effect.node.id, role: 'node' as const }, point: diagram.spine.at(-1)! } } } : {}),
        relationship: { kind: 'effect-spine', direction: 'forward' }, markers: { end: marker },
      }),
    )
  for (const branch of diagram.branches)
    parts.push(
      marks.connector({
        id: branch.id,
        role: 'edge',
        geometry: { kind: 'polyline', points: branch.points },
        lineStyle: 'solid',
        paint: { stroke: style.edgeStrokeColor ?? 'var(--_line)', strokeWidth: String(style.lineWidth) },
        endpoints: { from: branch.from, to: branch.to },
        relationship: { kind: 'cause', direction: 'forward' },
      }),
    )
  for (const item of diagram.nodes) {
    const owner = { id: item.node.id, role: 'node' as const }
    const children: T[] = []
    const fill = style.nodeFillColor ?? 'var(--_node-fill)'
    const ink = style.nodeTextColor ?? (item.depth <= 1 ? inkOnFill('var(--_text)', fill) : 'var(--_text)')
    if (item.depth <= 1)
      children.push(
        marks.shape({
          id: `box:${item.node.id}`,
          role: 'node',
          identity: false,
          owner,
          geometry: { kind: 'rect', x: item.x, y: item.y, width: item.width, height: item.height, rx: style.cornerRadius ?? (item.depth === 0 ? 8 : 3) },
          paint: { fill: style.nodeFillColor ?? 'var(--_node-fill)', stroke: style.nodeBorderColor ?? 'var(--_node-stroke)', strokeWidth: String(style.nodeLineWidth) },
        }),
      )
    children.push(marks.text({ id: `label:${item.node.id}`, role: 'label', owner, text: item.block.text, block: item.block, x: item.x + item.width / 2, y: item.y + item.height / 2, fontSize: item.block.fontSize, fontWeight: item.block.fontWeight, anchor: 'middle', paint: { fill: ink } }))
    parts.push(marks.group({ id: item.node.id, role: 'node', open: '<g>', close: '</g>', children: children.map(node => ({ node, indent: 2 })) }))
  }
  return drawingDocument(marks, 'ishikawa', diagram, colors, resolved.renderOptions.transparent ?? false, parts)
}

export const lowerIshikawaScene = sceneLowering<PositionedIshikawa>(lowerIshikawaDrawing)
