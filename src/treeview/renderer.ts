import { inkOnNodeFill } from '../color-resolver.ts'
import { escapeAttr } from '../multiline-utils.ts'
import { type DrawingDocument, type DrawingFactory, sceneLowering } from '../scene/drawing.ts'
import { hierarchyChildren } from '../shared/hierarchy-model.ts'
import { drawingDocument } from '../shared/scene-document.ts'
import { diagramTitleFields, FLOWCHART_STYLE_DEFAULTS, resolveRenderStyle } from '../styles.ts'
import type { RenderContext } from '../types.ts'
import type { PositionedTreeview } from './types.ts'

export function lowerTreeviewDrawing<T>(marks: DrawingFactory<T>, { positioned: chart, colors, resolved }: RenderContext<PositionedTreeview>): DrawingDocument<T> {
  const style = resolveRenderStyle(resolved.renderOptions, FLOWCHART_STYLE_DEFAULTS, resolved.styleFace)
  const parts: T[] = []
  if (chart.title) parts.push(marks.text(diagramTitleFields(chart.title, style)))
  for (const guide of chart.guides)
    parts.push(
      marks.connector({
        id: guide.id,
        role: 'edge',
        owner: { id: guide.to, role: 'node' },
        geometry: { kind: 'polyline', points: guide.points },
        lineStyle: 'solid',
        paint: { stroke: style.edgeStrokeColor ?? 'var(--_line)', strokeWidth: String(style.lineWidth) },
        endpoints: { from: guide.from, to: guide.to },
        relationship: { kind: 'parent-child', direction: 'forward' },
      }),
    )
  const contents = new Map<string, T[]>(),
    groups = new Map<string, T>()
  for (const row of chart.rows) {
    const owner = { id: row.node.id, role: 'node' as const },
      children: T[] = [],
      ink = inkOnNodeFill(undefined, colors, row.node.className === 'highlight' && style.nodeTextColor === undefined ? (style.nodeFillColor ?? 'var(--_node-fill)') : undefined)
    if (row.node.className === 'highlight')
      children.push(marks.shape({ id: `highlight:${row.node.id}`, identity: false, role: 'node', owner, geometry: { kind: 'rect', x: row.x - 3, y: row.y, width: row.width + 6, height: row.height, rx: style.cornerRadius ?? 3 }, paint: { fill: style.nodeFillColor ?? 'var(--_node-fill)', stroke: 'none' } }))
    if (row.icon) children.push(marks.text({ id: `icon:${row.node.id}`, role: 'icon', owner, text: row.icon.text, block: row.icon, x: row.x, y: row.y + row.height / 2, fontSize: row.icon.fontSize, fontWeight: row.icon.fontWeight, anchor: 'start', paint: { fill: ink(style.nodeTextColor ?? 'var(--_text)') } }))
    children.push(marks.text({ id: `label:${row.node.id}`, role: 'label', owner, text: row.label.text, block: row.label, x: row.labelX, y: row.y + row.height / 2, fontSize: row.label.fontSize, fontWeight: row.label.fontWeight, anchor: 'start', paint: { fill: ink(style.nodeTextColor ?? 'var(--_text)') } }))
    if (row.description)
      children.push(
        marks.text({
          id: `description:${row.node.id}`,
          role: 'label',
          owner,
          text: row.description.text,
          block: row.description,
          x: row.descriptionX!,
          y: row.y + row.height / 2,
          fontSize: row.description.fontSize,
          fontWeight: row.description.fontWeight,
          anchor: 'start',
          paint: { fill: ink(style.nodeTextColor ?? 'var(--_text-muted)') },
        }),
      )
    contents.set(row.node.id, children)
  }
  const children = hierarchyChildren(chart.body.nodes)
  for (const row of [...chart.rows].reverse()) {
    const nested = contents.get(row.node.id)!
    for (const child of children.get(row.node.id) ?? []) nested.push(groups.get(child.id)!)
    groups.set(row.node.id, marks.group({ id: row.node.id, role: 'node', open: `<g${row.node.parentId ? ` data-parent="${escapeAttr(row.node.parentId)}"` : ''}${row.node.className ? ` class="${escapeAttr(row.node.className)}"` : ''}>`, close: '</g>', children: nested.map(node => ({ node, indent: 2 })) }))
  }
  for (const node of children.get(undefined) ?? []) parts.push(groups.get(node.id)!)
  return drawingDocument(marks, 'treeview', chart, colors, resolved.renderOptions.transparent ?? false, parts)
}
export const lowerTreeviewScene = sceneLowering<PositionedTreeview>(lowerTreeviewDrawing)
