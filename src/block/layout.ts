import { rerouteEdgesThroughNodes } from '../layout/passes/index.ts'
import { simplifyPolyline } from '../route-contracts.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { shapeCardinalPorts } from '../shape-outline.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { checkedAuthoredStyle, parseStyleProps } from '../shared/style-props.ts'
import { diagramTitleBand, positionDiagramTitle, resolveRenderStyle } from '../styles.ts'
import type { NodeShape, Point, PositionedEdge, PositionedNode, RenderOptions } from '../types.ts'
import { arrowMask, arrowSize } from './arrows.ts'
import { type Cell, layout as layoutGrid } from './grid.ts'
import { blockTextPlan } from './text.ts'
import type { Block, BlockBody, PositionedBlock, PositionedBlockDiagram } from './types.ts'

export const BLOCK_SHAPES: Record<string, NodeShape> = {
  na: 'rectangle',
  square: 'rectangle',
  round: 'rounded',
  circle: 'circle',
  rect_left_inv_arrow: 'asymmetric',
  diamond: 'diamond',
  hexagon: 'hexagon',
  stadium: 'stadium',
  subroutine: 'subroutine',
  cylinder: 'cylinder',
  doublecircle: 'doublecircle',
  lean_right: 'lean-r',
  lean_left: 'lean-l',
  trapezoid: 'trapezoid',
  inv_trapezoid: 'trapezoid-alt',
}
export function blockShapeNode(node: PositionedBlock): PositionedNode {
  return { id: node.id, label: node.block.label ?? node.id, shape: BLOCK_SHAPES[node.block.type ?? 'na'] ?? 'rectangle', x: node.x, y: node.y, width: node.width, height: node.height }
}
interface View extends Cell {
  block: Block
  parentId?: string
  label: ReturnType<typeof preparePixelText>
  style: Record<string, string>
}
export function layoutBlockDiagram(model: BlockBody, options: RenderOptions = {}, face?: Readonly<InternalStyleFace>, config: Record<string, unknown> = {}): PositionedBlockDiagram {
  const style = resolveRenderStyle(options, undefined, face),
    pad = options.padding ?? 32
  const edgeLabels = model.edges.map(edge => preparePixelText(blockTextPlan(edge.label ?? ''), { fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, maxWidth: 320, transform: style.edgeTextTransform, letterSpacing: style.edgeLetterSpacing }))
  const gap = Math.max(typeof config.padding === 'number' && config.padding >= 0 ? Math.min(config.padding, 200) : 20, ...edgeLabels.filter(b => b.text).map(b => b.width + 40))
  const classes = new Map(model.classDefs.map(d => [d.id, d])),
    views: View[] = []
  const make = (block: Block, parentId?: string): View => {
    const declarations = [...(classes.get('default')?.styles ?? []), ...(block.classes ?? []).flatMap(name => classes.get(name)?.styles ?? []), ...(block.styles ?? [])]
    const props = checkedAuthoredStyle(parseStyleProps(declarations.join(',')), `style ${block.id}`),
      fontSize = Number.parseFloat(props['font-size'] ?? '') || style.nodeLabelFontSize
    const authoredWeight = props['font-weight']?.trim().toLowerCase(),
      fontWeight = authoredWeight === undefined ? style.nodeLabelFontWeight : authoredWeight === 'normal' ? 400 : authoredWeight === 'bold' ? 700 : Number(authoredWeight)
    if (!Number.isFinite(fontWeight) || fontWeight < 1 || fontWeight > 1000) throw new Error(`style ${block.id}: font-weight must be normal, bold, or a number from 1 to 1000`)
    const label = preparePixelText(blockTextPlan(block.label ?? (block.type === 'composite' ? '' : block.id)), { fontSize, fontWeight, maxWidth: 320, transform: style.nodeTextTransform, letterSpacing: style.nodeLetterSpacing })
    let nw = Math.max(80, label.width + style.nodePaddingX * 2),
      nh = Math.max(44, label.height + style.nodePaddingY * 2)
    if (['diamond', 'hexagon', 'lean_right', 'lean_left', 'trapezoid', 'inv_trapezoid'].includes(block.type ?? '')) {
      nw += 48
      nh += 24
    }
    if (['circle', 'doublecircle'].includes(block.type ?? '')) nw = nh = Math.max(nw, nh)
    if (block.type === 'cylinder') nh += 24
    if (block.type === 'block_arrow') {
      const s = arrowSize(arrowMask(block.directions), label.width, label.height)
      nw = s.w
      nh = s.h
    }
    if (block.type === 'space') {
      nw = 40
      nh = 24
    }
    const head = block.type === 'composite' && label.text ? label.height + 16 : 0
    return { block, parentId, label, style: props, children: [], columns: block.columns ?? -1, span: block.widthInColumns ?? 1, space: block.type === 'space', head, nw: block === model.root ? 0 : nw, nh: block === model.root ? 0 : nh, col: 0, row: 0, cols: 0, heights: [], x: 0, y: 0, w: 0, h: 0 }
  }
  const root = make(model.root),
    pending = [root]
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i]!
    for (const block of p.block.children ?? []) {
      const v = make(block, p === root ? undefined : p.block.id)
      p.children.push(v)
      pending.push(v)
      views.push(v)
    }
    if (pending.length > 10000) throw new Error('Block diagram exceeds 10000 blocks')
  }
  const bounds = layoutGrid(root, gap),
    band = diagramTitleBand(model.title, style),
    width = Math.max(bounds.width + pad * 2, (band?.width ?? 0) + pad * 2),
    titleHeight = band?.height ?? 0
  const ox = pad + (width - pad * 2 - bounds.width) / 2,
    oy = pad + titleHeight
  const nodes: PositionedBlock[] = views.map(v => {
    let width = v.w,
      height = v.h
    if (['circle', 'doublecircle'].includes(v.block.type ?? '')) width = height = Math.min(v.w, v.h)
    return { id: v.block.id, block: v.block, parentId: v.parentId, x: v.x - width / 2 + ox, y: v.y - height / 2 + oy, width, height, label: v.label, style: v.style }
  })
  const byId = new Map(nodes.map(n => [n.id, n])),
    parallel = new Map<string, number>()
  const edges = model.edges.map((edge, index) => {
    const source = byId.get(edge.start!),
      target = byId.get(edge.end!)
    if (!source || !target) throw new Error(`Block edge ${edge.id} references undeclared endpoints`)
    const labelBlock = edgeLabels[index]!
    const key = `${edge.start}\0${edge.end}`,
      occurrence = parallel.get(key) ?? 0
    parallel.set(key, occurrence + 1)
    const s = shapeCardinalPorts(blockShapeNode(source)),
      t = shapeCardinalPorts(blockShapeNode(target))
    let points: Point[]
    const sc = { x: source.x + source.width / 2, y: source.y + source.height / 2 },
      tc = { x: target.x + target.width / 2, y: target.y + target.height / 2 }
    if (source === target) {
      const r = 28 + occurrence * 18
      points = [s.E, { x: s.E.x + r, y: s.E.y }, { x: s.E.x + r, y: source.y - r }, { x: s.N.x, y: source.y - r }, s.N]
    } else if (source.y + source.height <= target.y || target.y + target.height <= source.y) {
      const from = tc.y >= sc.y ? s.S : s.N,
        to = tc.y >= sc.y ? t.N : t.S,
        mid = (from.y + to.y) / 2 + occurrence * 4
      points = [from, { x: from.x, y: mid }, { x: to.x, y: mid }, to]
    } else if (Math.abs(tc.x - sc.x) >= Math.abs(tc.y - sc.y)) {
      const from = tc.x >= sc.x ? s.E : s.W,
        to = tc.x >= sc.x ? t.W : t.E,
        mid = (from.x + to.x) / 2 + occurrence * 12
      points = [from, { x: mid, y: from.y }, { x: mid, y: to.y }, to]
    } else {
      const from = tc.y >= sc.y ? s.S : s.N,
        to = tc.y >= sc.y ? t.N : t.S,
        mid = (from.y + to.y) / 2 + occurrence * 12
      points = [from, { x: from.x, y: mid }, { x: to.x, y: mid }, to]
    }
    const route: PositionedEdge = { id: edge.id, source: source.id, target: target.id, style: 'solid', hasArrowStart: false, hasArrowEnd: false, points: simplifyPolyline(points) }
    // Authored grid cells remain fixed. Shared shape-aware repair owns only the
    // connector interior, including skip links across an occupied grid cell.
    const obstacles = nodes.filter(n => n.block.type !== 'space' && (n.block.type !== 'composite' || n === source || n === target)).map(blockShapeNode)
    rerouteEdgesThroughNodes(obstacles, [route], { direction: source.y + source.height <= target.y || target.y + target.height <= source.y ? 'TB' : 'LR' })
    points = route.points
    let best = 0
    for (let i = 1; i < points.length - 1; i++) if (Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y) > Math.hypot(points[best + 1]!.x - points[best]!.x, points[best + 1]!.y - points[best]!.y)) best = i
    const a = points[best]!,
      b = points[best + 1]!,
      labelPosition = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    return { ...edge, points, labelBlock, labelPosition }
  })
  const minX = Math.min(pad, ...edges.flatMap(e => e.points.map(q => q.x))),
    minY = Math.min(pad + titleHeight, ...edges.flatMap(e => e.points.map(q => q.y))),
    dx = Math.max(0, pad - minX),
    dy = Math.max(0, pad + titleHeight - minY)
  if (dx || dy) {
    for (const n of nodes) {
      n.x += dx
      n.y += dy
    }
    for (const e of edges) {
      for (const q of e.points) {
        q.x += dx
        q.y += dy
      }
      e.labelPosition.x += dx
      e.labelPosition.y += dy
    }
  }
  let height = bounds.height + pad * 2 + titleHeight + dy,
    finalWidth = width + dx
  for (const e of edges)
    for (const q of e.points) {
      height = Math.max(height, q.y + pad)
      finalWidth = Math.max(finalWidth, q.x + pad)
    }
  return { model, width: finalWidth, height, nodes, edges, style, ...(band ? { title: positionDiagramTitle(band, finalWidth, pad) } : {}) }
}
