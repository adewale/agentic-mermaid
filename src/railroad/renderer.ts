import { inkOnNodeFill } from '../color-resolver.ts'
import { drawingDocument } from '../shared/scene-document.ts'
import { sceneLowering, type DrawingDocument, type DrawingFactory } from '../scene/drawing.ts'
import { diagramTitleFields, resolveRenderStyle } from '../styles.ts'
import type { RenderContext } from '../types.ts'
import type { PositionedRailroad } from './layout.ts'

export function lowerRailroadDrawing<T>(marks: DrawingFactory<T>, { positioned: chart, colors, resolved }: RenderContext<PositionedRailroad>): DrawingDocument<T> {
  const style = resolveRenderStyle(resolved.renderOptions, undefined, resolved.styleFace), parts: T[] = []
  const nodeFill = style.nodeFillColor ?? 'var(--_node-fill)',
    text = style.nodeTextColor ?? 'var(--_text)',
    nodeInk = inkOnNodeFill(undefined, colors, style.nodeTextColor === undefined ? nodeFill : undefined)(text)
  const tracksByRule = new Map<string, PositionedRailroad['tracks']>(), labelsByRule = new Map<string, PositionedRailroad['labels']>()
  for (const track of chart.tracks) { const siblings = tracksByRule.get(track.ruleId) ?? []; siblings.push(track); tracksByRule.set(track.ruleId, siblings) }
  for (const label of chart.labels) { const siblings = labelsByRule.get(label.ruleId) ?? []; siblings.push(label); labelsByRule.set(label.ruleId, siblings) }
  if (chart.title) parts.push(marks.text(diagramTitleFields(chart.title, style)))
  for (const rule of chart.rules) {
    const children: T[] = []
    children.push(marks.text({ id: `label:${rule.id}`, role: 'label', owner: { id: rule.id, role: 'group' }, text: rule.name.text, block: rule.name,
      x: rule.x, y: rule.y + rule.name.height / 2, fontSize: rule.name.fontSize, fontWeight: rule.name.fontWeight, anchor: 'start', paint: { fill: 'var(--_text)' } }))
    for (const track of tracksByRule.get(rule.id) ?? []) children.push(marks.connector({ id: track.id, role: 'edge', owner: { id: rule.id, role: 'group' },
      geometry: { kind: 'polyline', points: track.points }, lineStyle: 'solid', paint: { stroke: style.edgeStrokeColor ?? 'var(--_line)', strokeWidth: String(style.lineWidth) } }))
    for (const label of labelsByRule.get(rule.id) ?? []) {
      if (label.kind !== 'annotation') children.push(marks.shape({ id: label.id, role: 'node', owner: { id: rule.id, role: 'group' },
        geometry: { kind: 'rect', x: label.x, y: label.y, width: label.width, height: label.height, rx: label.kind === 'terminal' ? label.height / 2 : 3 },
        paint: { fill: nodeFill, stroke: style.nodeBorderColor ?? 'var(--_node-stroke)', strokeWidth: String(style.nodeLineWidth) } }))
      children.push(marks.text({ id: `label:${label.id}`, role: 'label', owner: { id: label.kind === 'annotation' ? rule.id : label.id, role: label.kind === 'annotation' ? 'group' : 'node' }, text: label.block.text, block: label.block,
        x: label.x + label.width / 2, y: label.y + label.height / 2, fontSize: label.block.fontSize, fontWeight: label.block.fontWeight, anchor: 'middle', paint: { fill: label.kind === 'annotation' ? text : nodeInk } }))
    }
    parts.push(marks.group({ id: rule.id, role: 'group', open: '<g>', close: '</g>', children: children.map(node => ({ node, indent: 2 })) }))
  }
  return drawingDocument(marks, 'railroad', chart, colors, resolved.renderOptions.transparent ?? false, parts)
}
export const lowerRailroadScene = sceneLowering<PositionedRailroad>(lowerRailroadDrawing)
