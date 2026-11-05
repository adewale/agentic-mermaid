import { type DrawingFactory, type DrawingDocument, sceneLowering } from '../scene/drawing.ts'
import { drawingDocument } from '../shared/scene-document.ts'
import { diagramTitleFields, resolveRenderStyle, FLOWCHART_STYLE_DEFAULTS } from '../styles.ts'
import type { RenderContext } from '../types.ts'
import type { PositionedVenn } from './types.ts'

export function lowerVennDrawing<T>(marks: DrawingFactory<T>, { positioned: chart, colors, resolved }: RenderContext<PositionedVenn>): DrawingDocument<T> {
  const style = resolveRenderStyle(resolved.renderOptions, FLOWCHART_STYLE_DEFAULTS, resolved.styleFace),
    parts: T[] = []
  const authored = (targets: string[]): Record<string, string> => Object.assign({}, ...chart.body.styles.filter(style => style.targets.length === targets.length && style.targets.every(id => targets.includes(id))).map(style => style.styles))
  const subjects = new Map<string, T[]>()
  const append = (id: string, part: T) => {
    const children = subjects.get(id) ?? []
    children.push(part)
    subjects.set(id, children)
  }
  if (chart.title) parts.push(marks.text(diagramTitleFields(chart.title, style)))
  for (const circle of chart.circles) {
    const paint = authored([circle.id])
    append(
      circle.id,
      marks.shape({
        id: `circle:${circle.id}`,
        identity: false,
        role: 'node',
        owner: { id: circle.id, role: 'node' },
        geometry: { kind: 'circle', cx: circle.x, cy: circle.y, r: circle.r },
        paint: { fill: paint.fill ?? style.nodeFillColor ?? 'var(--_accent)', fillOpacity: paint['fill-opacity'] ?? '0.16', stroke: paint.stroke ?? style.nodeBorderColor ?? 'var(--_node-stroke)', strokeWidth: paint['stroke-width'] ?? String(style.nodeLineWidth) },
      }),
    )
  }
  for (const region of chart.regions) {
    const paint = authored(region.sets)
    subjects.set(region.id, [])
    if (region.path && (paint.fill || paint.stroke))
      append(
        region.id,
        marks.shape({
          id: `region:${region.id}`,
          identity: false,
          owner: { id: region.id, role: 'node' },
          role: 'bar',
          geometry: { kind: 'path', d: region.path },
          paint: { fill: paint.fill ?? 'none', fillOpacity: paint['fill-opacity'] ?? '0.22', stroke: paint.stroke ?? 'none', strokeWidth: paint['stroke-width'] ?? String(style.lineWidth) },
          channels: { category: region.id },
        }),
      )
  }
  for (const label of chart.labels) {
    const target = chart.body.textNodes.some(node => node.id === label.ownerId) ? [label.ownerId] : label.sets
    const paint = authored(target)
    append(
      label.ownerId,
      marks.text({ id: label.id, role: 'label', text: label.block.text, block: label.block, x: label.x, y: label.y, fontSize: label.block.fontSize, fontWeight: label.block.fontWeight, anchor: 'middle', paint: { fill: paint.color ?? style.nodeTextColor ?? 'var(--_text)', stroke: 'var(--bg)', strokeWidth: '4', strokeLinejoin: 'round', paintOrder: 'stroke' }, owner: { id: label.ownerId, role: 'node' } }),
    )
  }
  for (const [id, children] of subjects) parts.push(marks.group({ id, role: 'node', open: '<g>', close: '</g>', children: children.map(node => ({ node, indent: 2 })) }))
  return drawingDocument(marks, 'venn', chart, colors, resolved.renderOptions.transparent ?? false, parts)
}
export const lowerVennScene = sceneLowering<PositionedVenn>(lowerVennDrawing)
