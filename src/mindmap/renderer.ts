import type { RenderContext } from '../types.ts'
import type { PositionedMindmapDiagram, PositionedMindmapNode } from './types.ts'
import type { SceneDoc, SceneNode, Geometry } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { svgOpenTag, buildStyleBlock, buildShadowDefs, resolveColors } from '../theme.ts'
import { ensureContrast, isHexColor } from '../shared/color-math.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { semanticChildId, semanticRelationId } from '../scene/identity.ts'
import { escapeAttr, escapeXml, renderMultilineText } from '../multiline-utils.ts'

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
  const parts: SceneNode[] = [marks.prelude({
    id: 'prelude', width: diagram.width, height: diagram.height, colors,
    transparent, font, hasMonoFont: false,
  }, head.join('\n'))]
  const title = diagram.accessibilityTitle ?? diagram.nodes[0]?.label
  if (title) parts.push(marks.raw({ id: 'acc-title', role: 'chrome' }, `<title id="${titleId}">${escapeXml(title)}</title>`))
  if (diagram.accessibilityDescription) parts.push(marks.raw({ id: 'acc-desc', role: 'chrome' }, `<desc id="${descId}">${escapeXml(diagram.accessibilityDescription)}</desc>`))

  for (const edge of diagram.edges) {
    const semanticPoints = edge.points.map(point => ({ x: round(point.x), y: round(point.y) }))
    const points = semanticPoints.map(point => `${point.x},${point.y}`).join(' ')
    parts.push(marks.connector({
      id: semanticRelationId(edge.from, edge.to),
      role: 'edge',
      geometry: { kind: 'polyline', points: semanticPoints },
      lineStyle: 'solid',
      paint: { fill: 'none', stroke: 'var(--_line)', strokeWidth: '1.5' },
      channels: { importance: 1 },
    }, `<polyline class="mindmap-edge" data-from="${escapeAttr(edge.from)}" data-to="${escapeAttr(edge.to)}" points="${points}" fill="none" stroke="var(--_line)" stroke-width="1.5" />`))
  }
  for (const node of diagram.nodes) parts.push(renderNode(node, colors))
  parts.push(marks.raw({ id: 'svg-close', role: 'chrome' }, '</svg>'))
  return { family: 'mindmap', width: diagram.width, height: diagram.height, colors, parts }
}

function renderNode(node: PositionedMindmapNode, colors: RenderContext<PositionedMindmapDiagram>['colors']): SceneNode {
  const concretePalette = isHexColor(colors.bg) && isHexColor(colors.fg)
    && (colors.accent === undefined || isHexColor(colors.accent))
  const rootFill = concretePalette ? resolveColors(colors).arrow : 'var(--_arrow)'
  const fill = node.depth === 0 ? rootFill : 'var(--_node-fill)'
  const stroke = node.depth === 0 ? rootFill : 'var(--_node-stroke)'
  const textColor = node.depth === 0
    ? concretePalette ? ensureContrast(colors.bg, rootFill, 4.5, colors.fg) : 'var(--bg)'
    : 'var(--_text)'
  const shape = nodeGeometry(node)
  const shapeSvg = geometrySvg(shape, fill, stroke)
  const children: Array<{ node: SceneNode; indent: number }> = [
    { node: marks.shape({ id: semanticChildId(node.id, 'shape'), role: 'chrome', geometry: shape, paint: { fill, stroke, strokeWidth: '1.5' } }, shapeSvg), indent: 2 },
  ]
  if (node.icon) {
    children.push({ node: marks.text({
      id: semanticChildId(node.id, 'icon'), role: 'icon', text: node.icon, x: node.x + node.width / 2,
      y: node.y + 11, fontSize: 9, anchor: 'middle', paint: { fill: textColor },
    }, `<text class="mindmap-icon" x="${round(node.x + node.width / 2)}" y="${round(node.y + 11)}" text-anchor="middle" font-size="9" fill="${textColor}">${escapeXml(node.icon)}</text>`), indent: 2 })
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
    channels: { importance: Math.max(1, 5 - node.depth) },
    open: `<g class="mindmap-node depth-${node.depth}${customClasses}" data-id="${escapeAttr(node.id)}" data-label="${escapeAttr(node.label)}"${node.parentId ? ` data-parent-id="${escapeAttr(node.parentId)}"` : ''}>`,
    close: '</g>', children,
  })
}

function nodeGeometry(node: PositionedMindmapNode): Geometry {
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

function geometrySvg(geometry: Geometry, fill: string, stroke: string): string {
  const paint = `fill="${fill}" stroke="${stroke}" stroke-width="1.5"`
  if (geometry.kind === 'rect') return `<rect x="${round(geometry.x)}" y="${round(geometry.y)}" width="${round(geometry.width)}" height="${round(geometry.height)}" rx="${geometry.rx ?? 0}" ry="${geometry.ry ?? 0}" ${paint} />`
  if (geometry.kind === 'circle') return `<circle cx="${round(geometry.cx)}" cy="${round(geometry.cy)}" r="${round(geometry.r)}" ${paint} />`
  if (geometry.kind === 'ellipse') return `<ellipse cx="${round(geometry.cx)}" cy="${round(geometry.cy)}" rx="${round(geometry.rx)}" ry="${round(geometry.ry)}" ${paint} />`
  if (geometry.kind === 'polygon') return `<polygon points="${geometry.points.map(point => `${round(point.x)},${round(point.y)}`).join(' ')}" ${paint} />`
  return ''
}

function round(value: number): number { return Math.round(value * 1000) / 1000 }
