import { blockMarkers, blockMarkerTerminal } from './markers.ts'
import { rerouteEdgesThroughNodes } from '../layout/passes/obstacle-routing.ts'
import { findLabelSlot, simplifyPolyline } from '../route-contracts.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { pointOnRoutingBoundary, shapeCardinalPorts } from '../shape-outline.ts'
import { assertBlockDiagramWork } from '../shared/diagram-limits.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { checkedAuthoredStyle, parseStyleProps } from '../shared/style-props.ts'
import { diagramTitleBand, positionDiagramTitle, resolveRenderStyle } from '../styles.ts'
import type { NodeShape, Point, PositionedEdge, PositionedNode, RenderOptions } from '../types.ts'
import { arrowMask, arrowSize, blockArrowPoints } from './arrows.ts'
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
  assertBlockDiagramWork(model)
  const style = resolveRenderStyle(options, undefined, face),
    pad = options.padding ?? 32
  const edgeLabels = model.edges.map(edge => preparePixelText(blockTextPlan(edge.label ?? ''), { fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, maxWidth: 320, transform: style.edgeTextTransform, letterSpacing: style.edgeLetterSpacing }))
  let terminalLead = 0
  for (const edge of model.edges) terminalLead = Math.max(terminalLead,
    blockMarkerTerminal(blockMarkers[`${edge.arrowTypeStart}:start`]?.id, style.lineWidth, 'start'),
    blockMarkerTerminal(blockMarkers[`${edge.arrowTypeEnd}:end`]?.id, style.lineWidth, 'end'))
  const gap = Math.max(terminalLead ? 2 * (terminalLead + style.edgeBendRadius) : 0, typeof config.padding === 'number' && config.padding >= 0 ? Math.min(config.padding, 200) : 20, ...edgeLabels.filter(b => b.text).map(b => b.width + 40))
  const classes = new Map(model.classDefs.map(d => [d.id, d])),
    views: View[] = []
  const make = (block: Block, parentId?: string): View => {
    const composite = block.type === 'composite'
    const declarations = [...(classes.get('default')?.styles ?? []), ...(block.classes ?? []).flatMap(name => classes.get(name)?.styles ?? []), ...(block.styles ?? [])]
    const props = checkedAuthoredStyle(parseStyleProps(declarations.join(',')), `style ${block.id}`),
      fontSize = Number.parseFloat(props['font-size'] ?? '') || (composite ? style.groupHeaderFontSize : style.nodeLabelFontSize)
    const authoredWeight = props['font-weight']?.trim().toLowerCase(),
      fontWeight = authoredWeight === undefined ? (composite ? style.groupHeaderFontWeight : style.nodeLabelFontWeight) : authoredWeight === 'normal' ? 400 : authoredWeight === 'bold' ? 700 : Number(authoredWeight)
    if (!Number.isFinite(fontWeight) || fontWeight < 1 || fontWeight > 1000) throw new Error(`style ${block.id}: font-weight must be normal, bold, or a number from 1 to 1000`)
    const label = preparePixelText(blockTextPlan(block.label ?? (composite ? '' : block.id)), {
      fontSize,
      fontWeight,
      maxWidth: 320,
      transform: composite ? style.groupTextTransform : style.nodeTextTransform,
      letterSpacing: composite ? style.groupLetterSpacing : style.nodeLetterSpacing,
      fontFamily: composite ? (style.groupFont ?? options.font) : options.font,
    })
    let nw = Math.max(80, label.width + (composite ? style.groupLabelPaddingX : style.nodePaddingX) * 2),
      nh = Math.max(44, label.height + (composite ? style.groupPaddingY : style.nodePaddingY) * 2)
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
    return {
      block,
      parentId,
      label,
      style: props,
      children: [],
      columns: block.columns ?? -1,
      span: block.widthInColumns ?? 1,
      space: block.type === 'space',
      head,
      insetX: face?.group?.paddingX,
      insetY: face?.group?.paddingY,
      nw: block === model.root ? 0 : nw,
      nh: block === model.root ? 0 : nh,
      col: 0,
      row: 0,
      cols: 0,
      heights: [],
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    }
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
    shapeNodes = nodes.filter(node => node.block.type !== 'space').map(blockShapeNode),
    ports = new Map(shapeNodes.map(node => [node.id, shapeCardinalPorts(node)])),
    arrowBoundaries = new Map(
      nodes.filter(node => node.block.type === 'block_arrow').map(node => [node.id, { kind: 'polygon' as const, points: blockArrowPoints(arrowMask(node.block.directions), node.width, node.height).map(point => ({ x: point.x + node.x + node.width / 2, y: point.y + node.y + node.height / 2 })) }]),
    ),
    ordinaryObstacles = shapeNodes.filter(node => byId.get(node.id)!.block.type !== 'composite'),
    pairs = new Map<string, number[]>()
  const pairKey = (edge: Block) => (edge.start! < edge.end! ? `${edge.start}\0${edge.end}` : `${edge.end}\0${edge.start}`)
  model.edges.forEach((edge, index) => {
    const key = pairKey(edge),
      siblings = pairs.get(key) ?? []
    siblings.push(index)
    pairs.set(key, siblings)
  })
  const pairSlots = new Map<number, { slot: number; count: number; width: number; height: number }>()
  for (const siblings of pairs.values()) {
    const width = Math.max(...siblings.map(index => edgeLabels[index]!.width)),
      height = Math.max(...siblings.map(index => edgeLabels[index]!.height))
    siblings.forEach((index, slot) => pairSlots.set(index, { slot, count: siblings.length, width, height }))
  }
  const incomingContacts = new Set<string>(), outgoingContacts = new Set<string>()
  const contactKey = (id: string, point: Point) => `${id}\0${point.x}\0${point.y}`
  const edges = model.edges.map((edge, index) => {
    const source = byId.get(edge.start!),
      target = byId.get(edge.end!)
    if (!source || !target) throw new Error(`Block edge ${edge.id} references undeclared endpoints`)
    const labelBlock = edgeLabels[index]!
    const { slot: occurrence, count, width: labelWidth, height: labelHeight } = pairSlots.get(index)!,
      lane = occurrence - (count - 1) / 2,
      s = ports.get(source.id) ?? shapeCardinalPorts(blockShapeNode(source)),
      t = ports.get(target.id) ?? shapeCardinalPorts(blockShapeNode(target))
    let points: Point[]
    const sc = { x: source.x + source.width / 2, y: source.y + source.height / 2 },
      tc = { x: target.x + target.width / 2, y: target.y + target.height / 2 }
    let horizontal = Math.abs(tc.x - sc.x) >= Math.abs(tc.y - sc.y)
    const horizontalPorts = [tc.x >= sc.x ? s.E : s.W, tc.x >= sc.x ? t.W : t.E] as const,
      verticalPorts = [tc.y >= sc.y ? s.S : s.N, tc.y >= sc.y ? t.N : t.S] as const,
      opposing = (contacts: readonly Point[]) => incomingContacts.has(contactKey(source.id, contacts[0]!)) || outgoingContacts.has(contactKey(target.id, contacts[1]!))
    // Keep an arriving and departing route from counterflowing through one
    // physical contact when the other axis has a free pair of ports.
    if (count === 1 && source !== target && opposing(horizontal ? horizontalPorts : verticalPorts) && !opposing(horizontal ? verticalPorts : horizontalPorts)) horizontal = !horizontal
    if (source === target) {
      const r = 28 + occurrence * (Math.max(labelWidth, labelHeight) + 24)
      points = [s.E, { x: s.E.x + r, y: s.E.y }, { x: s.E.x + r, y: source.y - r }, { x: s.N.x, y: source.y - r }, s.N]
    } else if (count > 1 && lane !== 0) {
      // Reciprocal and duplicate links share one allocation. Outer corridors
      // keep labels readable without changing the author's grid or shapes.
      const separation = (horizontal ? labelHeight : labelWidth) + 24
      if (horizontal) {
        const y = lane < 0 ? Math.min(source.y, target.y) + lane * separation : Math.max(source.y + source.height, target.y + target.height) + lane * separation
        const from = lane < 0 ? s.N : s.S,
          to = lane < 0 ? t.N : t.S
        points = [from, { x: from.x, y }, { x: to.x, y }, to]
      } else {
        const x = lane < 0 ? Math.min(source.x, target.x) + lane * separation : Math.max(source.x + source.width, target.x + target.width) + lane * separation
        const from = lane < 0 ? s.W : s.E,
          to = lane < 0 ? t.W : t.E
        points = [from, { x, y: from.y }, { x, y: to.y }, to]
      }
    } else if (horizontal) {
      // Diagonal cells still use their nearer cardinal faces. Preferring a
      // vertical port merely because rows are disjoint can make an input share
      // the opposite direction of an outgoing edge at the same contact.
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
    outgoingContacts.add(contactKey(source.id, points[0]!))
    incomingContacts.add(contactKey(target.id, points.at(-1)!))
    const route: PositionedEdge = { id: edge.id, source: source.id, target: target.id, style: 'solid', hasArrowStart: edge.arrowTypeStart !== 'none', hasArrowEnd: edge.arrowTypeEnd !== 'none', points: simplifyPolyline(points.map(point => ({ ...point }))) }
    // Authored grid cells remain fixed. Shared shape-aware repair owns only the
    // connector interior, including skip links across an occupied grid cell.
    const obstacles = source.block.type === 'composite' || target.block.type === 'composite' ? shapeNodes.filter(node => byId.get(node.id)!.block.type !== 'composite' || node.id === source.id || node.id === target.id) : ordinaryObstacles
    rerouteEdgesThroughNodes(obstacles, [route], { direction: horizontal ? 'LR' : 'TB' })
    points = route.points
    // Conservative box repair owns the corridor. Pull only an arrow's final
    // terminal run onto its painted polygon; the run stays axis-aligned and
    // extends inside its own envelope, so foreign-obstacle clearance is kept.
    for (const [node, at, adjacent] of [
      [source, 0, 1],
      [target, points.length - 1, points.length - 2],
    ] as const) {
      const boundary = arrowBoundaries.get(node.id)
      if (!boundary) continue
      const point = points[at]!,
        next = points[adjacent]!,
        dx = next.x - point.x,
        dy = next.y - point.y,
        horizontal = Math.abs(dx) > Math.abs(dy),
        side = horizontal ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N',
        contact = pointOnRoutingBoundary(boundary, side, horizontal ? point.y : point.x)
      if (contact) points[at] = contact
    }
    let best = 0
    for (let i = 1; i < points.length - 1; i++) if (Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y) > Math.hypot(points[best + 1]!.x - points[best]!.x, points[best + 1]!.y - points[best]!.y)) best = i
    const a = points[best]!,
      b = points[best + 1]!,
      labelPosition = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    return { ...edge, points, labelBlock, labelPosition }
  })
  // Reuse the graph route allocator's bounded on-route label candidates. Its
  // final clearance protects actual opaque halos, nearby cards and terminal
  // markers; the longest segment alone can put text over a neighboring input.
  if (edges.some(edge => edge.label)) {
    const labelRoutes: PositionedEdge[] = edges.map(edge => ({ ...edge, source: edge.start!, target: edge.end!, style: 'solid', hasArrowStart: false, hasArrowEnd: false }))
    for (let index = 0; index < edges.length; index++) {
      const edge = edges[index]!, route = labelRoutes[index]!
      if (!edge.label) continue
      const segments = edge.points.slice(1).map((end, index) => ({ start: edge.points[index]!, end }))
        .sort((a, b) => Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y) - Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y))
      for (const { start, end } of segments) {
        const position = findLabelSlot(route, start, end, { nodes: ordinaryObstacles, edges: labelRoutes, axis: { main: 'x', cross: 'y', sign: 1 }, style, finalLabelClearance: true })
        if (!position) continue
        edge.labelPosition = route.labelPosition = position
        break
      }
    }
  }
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
