import type { PositionedTreemap } from './types.ts'
import type { RenderContext } from '../types.ts'
import { FLOWCHART_STYLE_DEFAULTS, resolveRenderStyle, diagramTitleMark } from '../styles.ts'
import { categoricalPalette } from '../shared/categorical-palette.ts'
import { inkOnNodeFill } from '../color-resolver.ts'
import { sceneDocument } from '../shared/scene-document.ts'
import type { SceneNode } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { escapeAttr } from '../multiline-utils.ts'

export function lowerTreemapScene({ positioned: chart, colors, resolved }: RenderContext<PositionedTreemap>) {
  const style = resolveRenderStyle(resolved.renderOptions, { ...FLOWCHART_STYLE_DEFAULTS, nodeLabelFontSize: chart.config.labelFontSize }, resolved.styleFace)
  const palette = categoricalPalette(chart.body.nodes.filter(node => !node.parentId).length, { accent: colors.accent, bg: colors.bg })
  const parts: SceneNode[] = []
  const contents = new Map<string, SceneNode[]>()
  const total = chart.cells.filter(cell => !cell.node.parentId).reduce((sum, cell) => sum + cell.total, 0)
  if (chart.title) parts.push(diagramTitleMark(chart.title, style))
  for (const cell of chart.cells) {
    const authored = cell.node.className ? chart.body.classDefs[cell.node.className] : undefined
    const fill = authored?.fill ?? style.nodeFillColor ?? palette[cell.category] ?? 'var(--_node-fill)'
    // Categorical fills need their own contrast adaptation; a Style's text
    // color was chosen for its own fill. Explicit authored ink still wins.
    const preferredInk = style.nodeTextColor ?? 'var(--_text)'
    const ink = authored?.color ?? (authored?.fill || !style.nodeFillColor ? inkOnNodeFill({ fill }, colors, fill)(preferredInk) : (style.nodeTextColor ?? inkOnNodeFill(undefined, colors, fill)('var(--_text)')))
    const owner = { id: cell.node.id, role: cell.node.value === undefined ? ('group' as const) : ('node' as const) }
    const children: SceneNode[] = []
    if (cell.width > 0 && cell.height > 0)
      children.push(
        marks.shape({
          id: `cell:${cell.node.id}`,
          role: 'bar',
          owner,
          geometry: { kind: 'rect', x: cell.x, y: cell.y, width: cell.width, height: cell.height },
          paint: { fill, stroke: authored?.stroke ?? style.nodeBorderColor ?? 'var(--bg)', strokeWidth: authored?.['stroke-width'] ?? String(chart.config.borderWidth) },
          channels: { value: total > 0 ? cell.total / total : 0, category: String(cell.category) },
        }),
      )
    if (cell.label) children.push(marks.text({ id: `label:${cell.node.id}`, role: 'label', owner, text: cell.label.text, block: cell.label, x: cell.x + cell.width / 2, y: cell.labelY!, fontSize: cell.label.fontSize, fontWeight: cell.label.fontWeight, anchor: 'middle', paint: { fill: ink } }))
    if (cell.valueLabel) children.push(marks.text({ id: `value:${cell.node.id}`, role: 'label', owner, text: cell.valueLabel.text, block: cell.valueLabel, x: cell.x + cell.width / 2, y: cell.valueY!, fontSize: cell.valueLabel.fontSize, fontWeight: cell.valueLabel.fontWeight, anchor: 'middle', paint: { fill: ink } }))
    contents.set(cell.node.id, children)
  }
  // Actual Scene containment follows the authored hierarchy. Quantitative
  // rectangles and their measured text remain owned by that section or leaf.
  const groups = new Map<string, SceneNode>()
  for (const cell of [...chart.cells].reverse()) {
    const children = contents.get(cell.node.id)!
    for (const child of chart.body.nodes.filter(node => node.parentId === cell.node.id)) {
      const group = groups.get(child.id)
      if (group) children.push(group)
    }
    groups.set(cell.node.id, marks.group({ id: cell.node.id, role: cell.node.value === undefined ? 'group' : 'node', open: `<g${cell.node.parentId ? ` data-parent="${escapeAttr(cell.node.parentId)}"` : ''}>`, close: '</g>', children: children.map(node => ({ node, indent: 2 })) }))
  }
  for (const cell of chart.cells) if (!cell.node.parentId) parts.push(groups.get(cell.node.id)!)
  return sceneDocument('treemap', chart, colors, resolved.renderOptions.transparent ?? false, parts)
}
