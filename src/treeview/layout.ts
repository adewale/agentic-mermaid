import type { InternalStyleFace } from '../scene/style-registry.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { diagramTitleBand, FLOWCHART_STYLE_DEFAULTS, positionDiagramTitle, resolveRenderStyle } from '../styles.ts'
import type { RenderOptions } from '../types.ts'
import { treeviewIconLabel, treeviewRows } from './hierarchy.ts'
import type { PositionedTreeview, TreeviewBody } from './types.ts'

export function layoutTreeviewDiagram(body: TreeviewBody, options: RenderOptions = {}, styleFace?: InternalStyleFace, title?: string, config: Record<string, unknown> = {}): PositionedTreeview {
  const style = resolveRenderStyle(options, FLOWCHART_STYLE_DEFAULTS, styleFace)
  const number = (key: string, fallback: number, min = 0) => (typeof config[key] === 'number' && Number.isFinite(config[key]) && config[key] >= min && config[key] <= 1000 ? (config[key] as number) : fallback)
  const padding = 20,
    paddingY = number('paddingY', 3),
    indent = number('rowIndent', 24, 1)
  const band = diagramTitleBand(body.title ?? title, style)
  const measure = (label: string, weight = style.nodeLabelFontWeight) => preparePixelText(label, { fontSize: style.nodeLabelFontSize, fontWeight: weight, letterSpacing: style.nodeLetterSpacing, transform: style.nodeTextTransform, fontFamily: options.font, maxWidth: 360, display: 'literal' })
  const rows: PositionedTreeview['rows'] = [],
    guides: PositionedTreeview['guides'] = []
  let y = padding + (band?.height ?? 0),
    width = Math.max(100, (band?.width ?? 0) + padding * 2)
  for (const { node, depth } of treeviewRows(body.nodes)) {
    const label = measure(node.label + (node.nodeType === 'directory' ? '/' : ''), node.className === 'highlight' ? Math.max(600, style.nodeLabelFontWeight) : style.nodeLabelFontWeight)
    const description = node.description === undefined ? undefined : measure(node.description)
    const iconLabel = treeviewIconLabel(node.icon, node.nodeType, config.showIcons === true),
      icon = iconLabel ? measure(iconLabel) : undefined
    const x = padding + depth * indent,
      labelX = x + (icon ? icon.width + 6 : 0)
    const descriptionX = description ? labelX + label.width + 18 : undefined
    const height = Math.max(label.height, description?.height ?? 0, icon?.height ?? 0) + paddingY * 2
    const rowWidth = (descriptionX ?? labelX) - x + (description?.width ?? label.width)
    rows.push({ node, depth, label, description, descriptionX, icon, x, labelX, y, width: rowWidth, height })
    width = Math.max(width, x + rowWidth + padding)
    y += height
  }
  const byId = new Map(rows.map(row => [row.node.id, row]))
  for (const row of rows) {
    const parent = row.node.parentId ? byId.get(row.node.parentId) : undefined
    if (!parent) continue
    const guideX = row.x - indent + 7
    guides.push({
      id: `branch:${row.node.id}`,
      from: parent.node.id,
      to: row.node.id,
      points: [
        { x: guideX, y: parent.y + parent.height },
        { x: guideX, y: row.y + row.height / 2 },
        { x: row.x - 4, y: row.y + row.height / 2 },
      ],
    })
  }
  return { width: Math.ceil(width), height: Math.ceil(Math.max(60, y + padding)), body, rows, guides, options, ...(band ? { title: positionDiagramTitle(band, width, padding) } : {}) }
}
