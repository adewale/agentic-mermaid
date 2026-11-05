import type { InternalStyleFace } from '../scene/style-registry.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { diagramTitleBand, FLOWCHART_STYLE_DEFAULTS, positionDiagramTitle, resolveRenderStyle } from '../styles.ts'
import type { RenderOptions } from '../types.ts'
import { resolveArchitectureIcon } from '../architecture/icons.ts'
import { fallbackIconGlyph } from '../architecture/icon-layout.ts'
import { treeviewIconLabel, treeviewRows } from './hierarchy.ts'
import type { PositionedTreeview, TreeviewBody } from './types.ts'

export function layoutTreeviewDiagram(body: TreeviewBody, options: RenderOptions = {}, styleFace?: InternalStyleFace, title?: string, config: Record<string, unknown> = {}): PositionedTreeview {
  const style = resolveRenderStyle(options, FLOWCHART_STYLE_DEFAULTS, styleFace)
  const number = (key: string, fallback: number, min = 0) => (typeof config[key] === 'number' && Number.isFinite(config[key]) && config[key] >= min && config[key] <= 1000 ? (config[key] as number) : fallback)
  const padding = 20,
    paddingY = number('paddingY', styleFace?.node?.paddingY ?? 3),
    indent = number('rowIndent', Math.max(24, styleFace?.node?.paddingX ?? 24), 1)
  const band = diagramTitleBand(body.title ?? title, style)
  const measure = (label: string, weight = style.nodeLabelFontWeight) => preparePixelText(label, { fontSize: style.nodeLabelFontSize, fontWeight: weight, letterSpacing: style.nodeLetterSpacing, transform: style.nodeTextTransform, fontFamily: options.font, maxWidth: 360, display: 'literal' })
  const rows: PositionedTreeview['rows'] = [],
    guides: PositionedTreeview['guides'] = []
  let y = padding + (band?.height ?? 0),
    width = Math.max(100, (band?.width ?? 0) + padding * 2)
  for (const { node, depth } of treeviewRows(body.nodes)) {
    const label = measure(node.label + (node.nodeType === 'directory' ? '/' : ''), node.className === 'highlight' ? Math.max(600, style.nodeLabelFontWeight) : style.nodeLabelFontWeight)
    const description = node.description === undefined ? undefined : preparePixelText(node.description, { fontSize: styleFace?.text?.fontSize ?? style.nodeLabelFontSize, fontWeight: styleFace?.text?.fontWeight ?? Math.min(500, style.nodeLabelFontWeight), letterSpacing: styleFace?.text?.letterSpacing ?? style.nodeLetterSpacing, transform: styleFace?.text?.textTransform ?? style.nodeTextTransform, fontFamily: options.font, maxWidth: 360, display: 'literal' })
    const iconLabel = treeviewIconLabel(node.icon, node.nodeType, config.showIcons === true), bundled = node.icon ? resolveArchitectureIcon(node.icon) : null, size = Math.max(14, Math.min(24, style.nodeLabelFontSize + 2))
    const kind = node.icon === 'folder' || node.icon === 'directory' || (!node.icon && node.nodeType === 'directory') ? 'folder' : node.icon === 'file' || !node.icon ? 'file' : bundled ? 'bundled' : 'fallback'
    const iconGraphic: typeof rows[number]['iconGraphic'] = iconLabel ? { size, kind, filled: bundled !== null, path: bundled?.path ?? (kind === 'folder' ? 'M2 5H10L12 8H22V21H2Z' : kind === 'file' ? 'M5 2H14L19 7V22H5ZM14 2V8H19' : undefined) } : undefined
    const icon = iconGraphic?.kind === 'fallback' ? preparePixelText(fallbackIconGlyph(node.icon!), { fontSize: size * 0.62, fontWeight: 600, fontFamily: options.font, display: 'literal' }) : undefined
    const x = padding + depth * indent,
      labelX = x + (iconGraphic ? iconGraphic.size + 8 : 0)
    const descriptionX = description ? labelX + label.width + 18 : undefined
    const height = Math.max(label.height, description?.height ?? 0, iconGraphic?.size ?? 0) + paddingY * 2
    const rowWidth = (descriptionX ?? labelX) - x + (description?.width ?? label.width)
    rows.push({ node, depth, label, description, descriptionX, icon, iconGraphic, x, labelX, y, width: rowWidth, height })
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
