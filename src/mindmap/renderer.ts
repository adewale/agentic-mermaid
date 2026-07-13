import type { RenderContext } from '../types.ts'
import type { PositionedMindmapDiagram, PositionedMindmapNode } from './types.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import { serializeGeometryShape, type SerializableShapeGeometry } from '../scene/svg-serialize.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs, resolveColors } from '../theme.ts'
import { ensureContrast, isHexColor, mixHex } from '../shared/color-math.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { semanticChildId, semanticRelationId } from '../scene/identity.ts'
import { escapeAttr, escapeXml, renderMultilineText } from '../multiline-utils.ts'
import { resolveMindmapIcon } from './icons.ts'
import { getSeriesColor } from '../xychart/colors.ts'

const FONT_SIZE = 13

export function renderMindmapSvg(ctx: RenderContext<PositionedMindmapDiagram>): string {
  return DefaultBackend.render(lowerMindmapScene(ctx), { seed: 0 })
}

export function lowerMindmapScene(ctx: RenderContext<PositionedMindmapDiagram>): SceneDoc {
  const { positioned: diagram, colors, options } = ctx
  const font = colors.font ?? 'Inter'
  const transparent = options.transparent ?? false
  const titleId = 'mindmap-title'
  const descId = 'mindmap-desc'
  const attrs = buildAccessibilityAttrs(
    diagram.accessibilityTitle ?? diagram.nodes[0]?.label,
    diagram.accessibilityDescription,
    titleId,
    descId,
    'mindmap',
  )
  const head = [
    svgOpenTag(diagram.width, diagram.height, colors, transparent, { attrs }),
    buildStyleBlock(font, false, colors.shadow, colors.embedFontImport),
  ]
  const shadow = buildShadowDefs(colors)
  if (shadow) head.push(`<defs>${shadow}</defs>`)
  const branchByNode = mindmapBranchIndices(diagram)
  const branchPaint = (nodeId: string): string => {
    const index = branchByNode.get(nodeId) ?? 0
    const accent = isHexColor(colors.accent ?? '') ? colors.accent! : '#3b82f6'
    const bg = isHexColor(colors.bg) ? colors.bg : '#ffffff'
    return getSeriesColor(index, accent, bg)
  }
  const parts: SceneNode[] = [marks.prelude({
    id: 'prelude', width: diagram.width, height: diagram.height, colors,
    transparent, font, hasMonoFont: false,
  }, head.join('\n'))]
  const title = diagram.accessibilityTitle ?? diagram.nodes[0]?.label
  if (title) parts.push(marks.documentText({ id: 'acc-title', element: 'title', domId: titleId, text: title }))
  if (diagram.accessibilityDescription) parts.push(marks.documentText({ id: 'acc-desc', element: 'description', domId: descId, text: diagram.accessibilityDescription }))

  for (const edge of diagram.edges) {
    const stroke = branchPaint(edge.to)
    parts.push(marks.connector({
      id: semanticRelationId(edge.from, edge.to),
      role: 'edge',
      geometry: { kind: 'path', d: edge.d, points: edge.points },
      lineStyle: 'solid',
      paint: { fill: 'none', stroke, strokeWidth: '2.5' },
      endpoints: { from: edge.from, to: edge.to },
      relationship: { kind: 'mindmap-branch', direction: 'forward' },
      route: { ownership: 'layout' },
      stroke: { lineCap: 'round' },
      projectAccessibilityToSvg: true,
      channels: { importance: 1, category: String(branchByNode.get(edge.to) ?? 0) },
    }, `<path class="mindmap-edge" data-from="${escapeAttr(edge.from)}" data-to="${escapeAttr(edge.to)}" data-branch-index="${branchByNode.get(edge.to) ?? 0}" d="${edge.d}" fill="none" stroke="${escapeAttr(stroke)}" stroke-width="2.5" stroke-linecap="round" />`))
  }
  for (const node of diagram.nodes) parts.push(renderNode(node, colors, branchByNode.get(node.id), branchPaint(node.id)))
  parts.push(marks.documentClose())
  return { family: 'mindmap', width: diagram.width, height: diagram.height, colors, parts }
}

function renderNode(
  node: PositionedMindmapNode,
  colors: RenderContext<PositionedMindmapDiagram>['colors'],
  branchIndex: number | undefined,
  branchColor: string,
): SceneNode {
  const concretePalette = isHexColor(colors.bg) && isHexColor(colors.fg)
    && (colors.accent === undefined || isHexColor(colors.accent))
  const rootFill = concretePalette ? resolveColors(colors).arrow : 'var(--_arrow)'
  const branchFill = concretePalette
    ? mixHex(branchColor, colors.bg, node.depth === 1 ? 30 : node.depth === 2 ? 20 : 13)
    : 'var(--_node-fill)'
  const fill = node.depth === 0 ? rootFill : branchFill
  const stroke = node.depth === 0 ? rootFill : branchColor
  const textColor = node.depth === 0
    ? concretePalette ? ensureContrast(colors.bg, rootFill, 4.5, colors.fg) : 'var(--bg)'
    : concretePalette ? ensureContrast(colors.fg, branchFill, 4.5) : 'var(--_text)'
  const shape = nodeGeometry(node)
  const shapeSvg = serializeGeometryShape(shape, { fill, stroke, strokeWidth: '1.5' })
  const children: Array<{ node: SceneNode; indent: number }> = [
    { node: marks.shape({ id: semanticChildId(node.id, 'shape'), role: 'chrome', geometry: shape, paint: { fill, stroke, strokeWidth: '1.5' } }, shapeSvg), indent: 2 },
  ]
  if (node.icon) {
    const glyph = resolveMindmapIcon(node.icon)
    if (glyph) {
      const size = 14
      const x = node.x + node.width / 2 - size / 2
      const y = node.y + 4
      const scale = size / 24
      const paths = glyph.paths.map(path => `<path d="${path}" />`).join('')
      children.push({ node: marks.raw({ id: semanticChildId(node.id, 'icon'), role: 'icon' },
        `<g class="mindmap-icon-glyph" data-icon="${escapeAttr(node.icon)}" data-icon-source="${escapeAttr(glyph.source)}" transform="translate(${round(x)} ${round(y)}) scale(${round(scale)})" fill="${textColor}" stroke="${textColor}" stroke-width="0.8">${paths}</g>`), indent: 2 })
    } else {
      const token = node.icon.split(/[:\s/-]+/).filter(Boolean).at(-1)?.slice(0, 2).toUpperCase() || '?'
      children.push({ node: marks.text({
        id: semanticChildId(node.id, 'icon'), role: 'icon', text: token, x: node.x + node.width / 2,
        y: node.y + 12, fontSize: 9, anchor: 'middle', paint: { fill: textColor },
      }, `<text class="mindmap-icon-fallback" data-icon="${escapeAttr(node.icon)}" x="${round(node.x + node.width / 2)}" y="${round(node.y + 12)}" text-anchor="middle" font-size="9" fill="${textColor}">${escapeXml(token)}</text>`), indent: 2 })
    }
  }
  const labelY = node.y + node.height / 2 + (node.icon ? 5 : 0)
  children.push({ node: marks.text({
    id: semanticChildId(node.id, 'label'), role: 'label', text: node.label,
    x: node.x + node.width / 2, y: labelY, fontSize: FONT_SIZE,
    anchor: 'middle', paint: { fill: textColor },
  }, renderMultilineText(node.label, node.x + node.width / 2, labelY, FONT_SIZE,
    `text-anchor="middle" font-size="${FONT_SIZE}" font-weight="500" fill="${textColor}"`)), indent: 2 })
  const customClasses = node.className ? ` ${escapeAttr(node.className)}` : ''
  return marks.group({
    id: node.id,
    role: 'node',
    channels: { importance: Math.max(1, 5 - node.depth), ...(branchIndex === undefined ? {} : { category: String(branchIndex) }) },
    open: `<g class="mindmap-node depth-${node.depth}${customClasses}" data-id="${escapeAttr(node.id)}" data-label="${escapeAttr(node.label)}"${branchIndex === undefined ? '' : ` data-branch-index="${branchIndex}"`}${node.parentId ? ` data-parent-id="${escapeAttr(node.parentId)}"` : ''}>`,
    close: '</g>', children,
  })
}

function nodeGeometry(node: PositionedMindmapNode): SerializableShapeGeometry {
  const { x, y, width, height } = node
  const point = (pointX: number, pointY: number) => ({ x: round(pointX), y: round(pointY) })
  if (node.shape === 'circle') return { kind: 'circle', cx: round(x + width / 2), cy: round(y + height / 2), r: round(Math.min(width, height) / 2) }
  if (node.shape === 'cloud') return { kind: 'ellipse', cx: round(x + width / 2), cy: round(y + height / 2), rx: round(width / 2), ry: round(height / 2) }
  if (node.shape === 'hexagon') return { kind: 'polygon', points: [
    point(x + 12, y), point(x + width - 12, y), point(x + width, y + height / 2),
    point(x + width - 12, y + height), point(x + 12, y + height), point(x, y + height / 2),
  ] }
  if (node.shape === 'bang') {
    const points: Array<{ x: number; y: number }> = []
    for (let index = 0; index < 12; index++) {
      const angle = -Math.PI / 2 + index * Math.PI / 6
      const radiusX = (index % 2 === 0 ? width / 2 : width * 0.38)
      const radiusY = (index % 2 === 0 ? height / 2 : height * 0.38)
      points.push(point(x + width / 2 + Math.cos(angle) * radiusX, y + height / 2 + Math.sin(angle) * radiusY))
    }
    return { kind: 'polygon', points }
  }
  return {
    kind: 'rect', x: round(x), y: round(y), width: round(width), height: round(height),
    rx: node.shape === 'rect' ? 0 : node.shape === 'rounded' ? 10 : 16,
    ry: node.shape === 'rect' ? 0 : node.shape === 'rounded' ? 10 : 16,
  }
}

function mindmapBranchIndices(diagram: PositionedMindmapDiagram): Map<string, number> {
  const branchByNode = new Map<string, number>()
  const root = diagram.nodes.find(node => node.depth === 0)
  if (!root) return branchByNode
  let next = 0
  for (const node of [...diagram.nodes].sort((a, b) => a.depth - b.depth)) {
    if (node.depth === 0) continue
    if (node.parentId === root.id) branchByNode.set(node.id, next++)
    else if (node.parentId && branchByNode.has(node.parentId)) branchByNode.set(node.id, branchByNode.get(node.parentId)!)
  }
  return branchByNode
}

function round(value: number): number { return Math.round(value * 1000) / 1000 }
