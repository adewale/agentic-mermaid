import { sceneLowering, type DrawingFactory, type DrawingDocument } from '../scene/drawing.ts'
import type { Geometry } from '../scene/ir.ts';
import type { RenderContext } from '../types.ts'
import { resolveRenderStyle, diagramTitleFields } from '../styles.ts'
import type { PositionedMindmapDiagram, PositionedMindmapNode } from './types.ts'
import { MINDMAP_BANG_INNER_RADIUS_RATIO } from './geometry.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'

import { pathArtwork } from '../scene/artwork.ts'
import { iconFallbackToken } from '../shared/icon-fallback.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { resolveColors } from '../theme.ts'
import { ensureContrast, isHexColor, mixHex } from '../shared/color-math.ts'
import { buildAccessibilityAttrs } from '../shared/svg-a11y.ts'
import { semanticChildId, semanticRelationId } from '../scene/identity.ts'
import { snapshotSvgEmissionRecipe, svgValue as v, type SvgAttribute, type SvgGeometryField, type SvgGroupEmission, type SvgPrimitiveEmission } from '../scene/svg-emission.ts'
import { resolveMindmapIcon } from './icons.ts'
import { categoricalPalette } from '../shared/categorical-palette.ts'
import { projectConnectorPath } from '../scene/connector-geometry.ts'

const FONT_SIZE = 13

function shapeEmission(fields: readonly SvgGeometryField[]) {
  return snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
    ...fields.map(name => ({ name, value: v.geometry(name), format: 'round3' as const })),
    { name: 'fill', value: v.paint('fill') }, { name: 'stroke', value: v.paint('stroke') }, { name: 'stroke-width', value: v.paint('strokeWidth') },
  ] })
}
const SHAPE_EMISSIONS = {
  circle: shapeEmission(['cx', 'cy', 'r']), ellipse: shapeEmission(['cx', 'cy', 'rx', 'ry']),
  polygon: shapeEmission(['points']), rect: shapeEmission(['x', 'y', 'width', 'height', 'rx', 'ry']),
}
const EDGE_EMISSION = snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
  { name: 'class', value: v.meta('mindmap-edge') }, { name: 'data-from', value: v.identity('from') }, { name: 'data-to', value: v.identity('to') },
  { name: 'data-branch-index', value: v.channel('category') }, { name: 'd', value: v.geometry('d') },
  { name: 'fill', value: v.paint('fill') }, { name: 'stroke', value: v.paint('stroke') }, { name: 'stroke-width', value: v.paint('strokeWidth') },
  { name: 'stroke-linecap', value: v.connector('lineCap') },
] })
const ICON_PATH_EMISSION = snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [{ name: 'd', value: v.geometry('d') }] }) as SvgPrimitiveEmission
const LABEL_EMISSION = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [
  { name: 'text-anchor', value: v.text('anchor') }, { name: 'font-size', value: v.text('fontSize') },
  { name: 'font-weight', value: v.text('fontWeight') }, { name: 'letter-spacing', value: v.text('letterSpacing') }, { name: 'fill', value: v.paint('fill') },
] })

export function renderMindmapSvg(ctx: RenderContext<PositionedMindmapDiagram>): string {
  return DefaultBackend.render(lowerMindmapScene(ctx), { seed: 0 })
}

export function lowerMindmapDrawing<T>(marks: DrawingFactory<T>, ctx: RenderContext<PositionedMindmapDiagram>): DrawingDocument<T> {
  const { positioned: diagram, colors, resolved } = ctx
  const options = resolved.renderOptions
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
  const branchByNode = mindmapBranchIndices(diagram)
  const branchCount = new Set(branchByNode.values()).size
  const accent = isHexColor(colors.accent ?? '') ? colors.accent! : '#3b82f6'
  const bg = isHexColor(colors.bg) ? colors.bg : '#ffffff'
  const branchPalette = categoricalPalette(
    branchCount,
    branchCount <= 6
      ? { accent, bg }
      : { accent: colors.accent ?? accent, bg: colors.bg },
  )
  const branchPaint = (nodeId: string): string => {
    const index = branchByNode.get(nodeId) ?? 0
    return branchPalette[index] ?? accent
  }
  const parts: T[] = [marks.documentOpen({
    id: 'prelude', width: diagram.width, height: diagram.height, colors,
    transparent, font, hasMonoFont: false,
  }, { kind: 'prelude', width: diagram.width, height: diagram.height, colors, transparent, font, hasMonoFont: false,
    attributes: Object.entries(attrs).filter((entry): entry is [string, string] => entry[1] !== undefined).map(([name, value]) => ({ name: name as SvgAttribute['name'], value: v.meta(value) })),
    children: [{ kind: 'sharedStyle' }, ...(colors.shadow ? [{ kind: 'shadow' as const, colors, wrap: true }] : [])],
  })]
  const title = diagram.accessibilityTitle ?? diagram.nodes[0]?.label
  if (title) parts.push(marks.documentText({ id: 'acc-title', element: 'title', domId: titleId, text: title }))
  if (diagram.accessibilityDescription) parts.push(marks.documentText({ id: 'acc-desc', element: 'description', domId: descId, text: diagram.accessibilityDescription }))
  // The diagram's frontmatter title, in the band layout reserved above.
  if (diagram.title) parts.push(marks.text(diagramTitleFields(diagram.title, resolveRenderStyle(options, undefined, resolved.styleFace))))

  for (const edge of diagram.edges) {
    const stroke = branchPaint(edge.to)
    const [start, control1, control2, end] = edge.points
    if (!start || !control1 || !control2 || !end) {
      throw new Error(`Mindmap edge "${edge.from}" -> "${edge.to}" requires four cubic control points`)
    }
    const projection = projectConnectorPath(edge.d, start, [{
      kind: 'cubic', control1, control2, end,
    }])
    parts.push(marks.connector({
      id: semanticRelationId(edge.from, edge.to),
      role: 'edge',
      geometry: projection.geometry,
      lineStyle: 'solid',
      paint: { fill: 'none', stroke, strokeWidth: '2.5' },
      endpoints: { from: edge.from, to: edge.to },
      relationship: { kind: 'mindmap-branch', direction: 'forward' },
      route: {
        ownership: 'layout',
        contours: projection.contours,
      },
      stroke: { lineCap: 'round' },
      channels: { importance: 1, category: String(branchByNode.get(edge.to) ?? 0) },
      attributes: { className: 'mindmap-edge', data: { 'branch-index': String(branchByNode.get(edge.to) ?? 0) } },
    }, EDGE_EMISSION))
  }
  for (const node of diagram.nodes) parts.push(renderNode(marks, node, colors, branchByNode.get(node.id), branchPaint(node.id)))
  parts.push(marks.documentClose())
  return { family: 'mindmap', width: diagram.width, height: diagram.height, colors, transparent, parts }
}

function renderNode<T>(
  marks: DrawingFactory<T>,
  node: PositionedMindmapNode,
  colors: RenderContext<PositionedMindmapDiagram>['colors'],
  branchIndex: number | undefined,
  branchColor: string,
): T {
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
  const children: Array<{ node: T; indent: number }> = [
    { node: marks.shape({ id: semanticChildId(node.id, 'shape'), role: 'chrome', geometry: shape, paint: { fill, stroke, strokeWidth: '1.5' } }, SHAPE_EMISSIONS[shape.kind as keyof typeof SHAPE_EMISSIONS]), indent: 2 },
  ]
  if (node.icon) {
    const glyph = resolveMindmapIcon(node.icon)
    if (glyph) {
      const size = 14
      const x = node.x + node.width / 2 - size / 2
      const y = node.y + 4
      const scale = size / 24
      children.push({ node: marks.pathArtwork({ id: semanticChildId(node.id, 'icon'), paths: glyph.paths,
        owner: { id: node.id, role: 'node' },
        emission: { kind: 'group', attributes: [
          { name: 'class', value: v.meta('mindmap-icon-glyph') }, { name: 'data-icon', value: v.meta(node.icon) }, { name: 'data-icon-source', value: v.meta(glyph.source) },
          { name: 'transform', value: { source: 'transform', form: 'translate-scale-space' } },
          { name: 'fill', value: v.meta(textColor) }, { name: 'stroke', value: v.meta(textColor) }, { name: 'stroke-width', value: v.meta('0.8') },
        ] } as SvgGroupEmission,
        pathEmission: ICON_PATH_EMISSION,
        transform: { kind: 'matrix', a: round(scale), b: 0, c: 0, d: round(scale), e: round(x), f: round(y) },
        paint: { fill: textColor, stroke: textColor, strokeWidth: '0.8' },
      }), indent: 2 })
    } else {
      const token = iconFallbackToken(node.icon)
      children.push({ node: marks.text({
        id: semanticChildId(node.id, 'icon'), role: 'icon', owner: { id: node.id, role: 'node' }, text: token,
        block: node.iconFallbackBlock, x: node.x + node.width / 2,
        y: node.y + 12, fontSize: 9, anchor: 'middle', paint: { fill: textColor }, baselineShift: 0,
        attributes: { className: 'mindmap-icon-fallback', data: { icon: node.icon } },
      }, { kind: 'text', layout: 'direct', attributes: [
        { name: 'class', value: v.meta('mindmap-icon-fallback') }, { name: 'data-icon', value: v.meta(node.icon) },
        { name: 'x', value: v.text('x'), format: 'round3' }, { name: 'y', value: v.text('y'), format: 'round3' },
        { name: 'text-anchor', value: v.text('anchor') }, { name: 'font-size', value: v.text('fontSize') }, { name: 'fill', value: v.paint('fill') },
      ] }), indent: 2 })
    }
  }
  const labelY = node.y + node.height / 2 + (node.icon ? 5 : 0)
  const fontSize = node.labelBlock?.fontSize ?? FONT_SIZE
  const fontWeight = node.labelBlock?.fontWeight ?? 500
  const letterSpacing = node.labelBlock?.letterSpacing ?? 0
  children.push({ node: marks.text({
    id: semanticChildId(node.id, 'label'), role: 'label', text: node.label, block: node.labelBlock,
    x: node.x + node.width / 2, y: labelY, fontSize, fontWeight, letterSpacing,
    anchor: 'middle', paint: { fill: textColor },
  }, LABEL_EMISSION), indent: 2 })
  return marks.group({
    id: node.id,
    role: 'node',
    channels: { importance: Math.max(1, 5 - node.depth), ...(branchIndex === undefined ? {} : { category: String(branchIndex) }) },
    emission: { kind: 'group', attributes: [
      { name: 'class', value: v.meta(`mindmap-node depth-${node.depth}${node.className ? ` ${node.className}` : ''}`) },
      { name: 'data-id', value: v.identity('id') }, { name: 'data-label', value: v.meta(node.label), display: true },
      ...(branchIndex === undefined ? [] : [{ name: 'data-branch-index' as const, value: v.channel('category') }]),
      ...(node.parentId ? [{ name: 'data-parent-id' as const, value: v.meta(node.parentId) }] : []),
    ] }, children,
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
      const radiusX = (index % 2 === 0 ? width / 2 : width * MINDMAP_BANG_INNER_RADIUS_RATIO)
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

export const lowerMindmapScene = sceneLowering<PositionedMindmapDiagram>(lowerMindmapDrawing)
