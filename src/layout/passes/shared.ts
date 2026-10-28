import type { DiamondFacet, Direction, Point, PositionedEdge, PositionedGroup, PositionedNode } from '../../types.ts'
import { diamondFacetPorts, labelRect, shapePorts, simplifyPolyline } from '../../route-contracts.ts'
import type { LabelMetricsStyle } from '../../route-contracts.ts'
import { layoutFlow, nodeCrossSize, nodeCrossStart, nodeMainStart, positionedNodeCenter, rectsOverlap } from '../geometry.ts'

export function positionedEdgeForwardish(edge: PositionedEdge, nodeMap: Map<string, PositionedNode>, direction: Direction): boolean {
  if (edge.source === edge.target) return false
  const source = nodeMap.get(edge.source)
  const target = nodeMap.get(edge.target)
  if (!source || !target) return false
  const f = layoutFlow(direction)
  const s = positionedNodeCenter(source)
  const t = positionedNodeCenter(target)
  return ((f.isHorizontal ? t.x - s.x : t.y - s.y) * f.sign) > 8
}

export function sameFlowLayer(group: PositionedNode[], direction: Direction, tolerance = 18): boolean {
  if (group.length < 2) return false
  const values = group.map(n => nodeMainStart(n, direction))
  return Math.max(...values) - Math.min(...values) <= tolerance
}

export function packFlowLayerCrossAxis(nodes: PositionedNode[], direction: Direction): void {
  const f = layoutFlow(direction)
  const layers: PositionedNode[][] = []
  const tolerance = 18
  const ordered = [...nodes].sort((a, b) => nodeMainStart(a, direction) - nodeMainStart(b, direction) || nodeCrossStart(a, direction) - nodeCrossStart(b, direction))
  for (const node of ordered) {
    const main = nodeMainStart(node, direction)
    let layer = layers.find(existing => Math.abs(nodeMainStart(existing[0]!, direction) - main) <= tolerance)
    if (!layer) { layer = []; layers.push(layer) }
    layer.push(node)
  }

  const gap = 24
  for (const layer of layers) {
    const byCross = [...layer].sort((a, b) => nodeCrossStart(a, direction) - nodeCrossStart(b, direction))
    let cursor = nodeCrossStart(byCross[0]!, direction)
    for (const node of byCross) {
      const start = nodeCrossStart(node, direction)
      if (start < cursor) {
        const delta = cursor - start
        if (f.isHorizontal) node.y += delta
        else node.x += delta
      }
      cursor = nodeCrossStart(node, direction) + nodeCrossSize(node, direction) + gap
    }
  }
}

export function nodeInsideGroups(node: PositionedNode, groups: PositionedGroup[]): boolean {
  const visit = (items: PositionedGroup[]): boolean => items.some(group =>
    (node.x >= group.x - 0.5 && node.y >= group.y - 0.5 &&
      node.x + node.width <= group.x + group.width + 0.5 &&
      node.y + node.height <= group.y + group.height + 0.5) || visit(group.children))
  return visit(groups)
}

export function flattenPositionedGroups(groups: PositionedGroup[], out: PositionedGroup[] = []): PositionedGroup[] {
  for (const group of groups) {
    out.push(group)
    flattenPositionedGroups(group.children, out)
  }
  return out
}

export function rectInsideGroup(rect: { x: number; y: number; width: number; height: number }, group: PositionedGroup): boolean {
  return rect.x >= group.x - 0.5 &&
    rect.y >= group.y - 0.5 &&
    rect.x + rect.width <= group.x + group.width + 0.5 &&
    rect.y + rect.height <= group.y + group.height + 0.5
}

export function expandGroupsForMainShift(
  groups: PositionedGroup[],
  rects: Array<{ x: number; y: number; width: number; height: number }>,
  direction: Direction,
  delta: number,
): void {
  if (delta <= 0) return
  const f = layoutFlow(direction)
  const expanded = new Set<PositionedGroup>()
  for (const group of flattenPositionedGroups(groups)) {
    if (expanded.has(group) || !rects.some(rect => rectInsideGroup(rect, group))) continue
    expanded.add(group)
    if (f.isHorizontal) {
      if (f.sign > 0) group.width += delta
      else {
        group.x -= delta
        group.width += delta
      }
    } else if (f.sign > 0) group.height += delta
    else {
      group.y -= delta
      group.height += delta
    }
  }
}

export function connectionPort(node: PositionedNode, side: 'N' | 'E' | 'S' | 'W' | DiamondFacet): Point {
  if (node.shape === 'diamond' && (side === 'NE' || side === 'SE' || side === 'SW' || side === 'NW')) return diamondFacetPorts(node)[side]
  return shapePorts(node)[side as 'N' | 'E' | 'S' | 'W']
}

export function sourceEmissionPort(source: PositionedNode, direction: Direction, index: number, count: number): Point {
  if (source.shape === 'diamond') {
    const portSets: Partial<Record<Direction, Array<'N' | 'E' | 'S' | 'W' | DiamondFacet>>> = count === 2
      ? { LR: ['NE', 'SE'], RL: ['NW', 'SW'], BT: ['NW', 'NE'], TD: ['SW', 'SE'], TB: ['SW', 'SE'] }
      : count === 3
        ? { LR: ['NE', 'E', 'SE'], RL: ['NW', 'W', 'SW'], BT: ['NW', 'N', 'NE'], TD: ['SW', 'S', 'SE'], TB: ['SW', 'S', 'SE'] }
        : {}
    const port = portSets[direction]?.[index]
    if (port) return connectionPort(source, port)
  }
  const f = layoutFlow(direction)
  const t = (index + 1) / (count + 1)
  if (f.isHorizontal) return { x: f.sourceSide === 'E' ? source.x + source.width : source.x, y: source.y + source.height * t }
  return { x: source.x + source.width * t, y: f.sourceSide === 'S' ? source.y + source.height : source.y }
}

export function targetFlowPort(target: PositionedNode, direction: Direction): Point {
  return shapePorts(target)[layoutFlow(direction).targetSide]
}

export function symmetricOffsets(count: number, spacing: number): number[] {
  return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * spacing)
}

/** A dogleg's elbow sits midway along the main-axis gap unless the hook at
 * `to` needs more of it: then it leaves that hook, provided the `from` side
 * keeps its own. A gap too short for both hooks stays midway. */
export function hookedElbow(from: number, to: number, fromHook: number, toHook: number): number {
  const gap = Math.abs(to - from)
  if (gap / 2 >= toHook || gap < fromHook + toHook) return from + (to - from) / 2
  return to - Math.sign(to - from) * toHook
}

export function doglegBetween(source: Point, target: Point, direction: Direction, elbow: number): Point[] {
  const f = layoutFlow(direction)
  return f.isHorizontal
    ? simplifyPolyline([source, { x: elbow, y: source.y }, { x: elbow, y: target.y }, target])
    : simplifyPolyline([source, { x: source.x, y: elbow }, { x: target.x, y: elbow }, target])
}

export function segmentClearOfNodes(a: Point, b: Point, nodes: PositionedNode[], exclude: ReadonlySet<string>, clearance = 1, chargeWork?: (operations: number) => void): boolean {
  const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x)
  const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y)
  for (const node of nodes) {
    chargeWork?.(1)
    if (exclude.has(node.id)) continue
    const nx1 = node.x - clearance, nx2 = node.x + node.width + clearance
    const ny1 = node.y - clearance, ny2 = node.y + node.height + clearance
    if (Math.abs(a.x - b.x) < 0.01) {
      if (a.x >= nx1 && a.x <= nx2 && y1 < ny2 && y2 > ny1) return false
    } else if (Math.abs(a.y - b.y) < 0.01) {
      if (a.y >= ny1 && a.y <= ny2 && x1 < nx2 && x2 > nx1) return false
    }
  }
  return true
}

export function routeClearOfNodes(points: Point[], nodes: PositionedNode[], exclude: ReadonlySet<string>, chargeWork?: (operations: number) => void): boolean {
  for (let i = 1; i < points.length; i++) {
    if (!segmentClearOfNodes(points[i - 1]!, points[i]!, nodes, exclude, 1, chargeWork)) return false
  }
  return true
}

export function shiftTerminalRunCross(edge: PositionedEdge, direction: Direction, fromEnd: boolean, delta: number): void {
  if (edge.points.length === 0) return
  const f = layoutFlow(direction)
  const idx = fromEnd ? edge.points.length - 1 : 0
  const step = fromEnd ? -1 : 1
  const ref = edge.points[idx]![f.cross]
  let mainLo = Infinity
  let mainHi = -Infinity
  for (let i = idx; i >= 0 && i < edge.points.length; i += step) {
    if (Math.abs(edge.points[i]![f.cross] - ref) > 0.5) break
    mainLo = Math.min(mainLo, edge.points[i]![f.main])
    mainHi = Math.max(mainHi, edge.points[i]![f.main])
    edge.points[i]![f.cross] += delta
  }
  if (edge.labelPosition &&
    Math.abs(edge.labelPosition[f.cross] - ref) <= 12 &&
    edge.labelPosition[f.main] >= mainLo - 0.5 &&
    edge.labelPosition[f.main] <= mainHi + 0.5) {
    edge.labelPosition[f.cross] += delta
  }
}

export function shiftNodeSetCross(
  movedIds: ReadonlySet<string>,
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  direction: Direction,
  delta: number,
): void {
  const f = layoutFlow(direction)
  for (const node of nodes) {
    if (!movedIds.has(node.id)) continue
    node[f.cross] += delta
  }
  for (const edge of edges) {
    const srcMoved = movedIds.has(edge.source)
    const tgtMoved = movedIds.has(edge.target)
    if (srcMoved && tgtMoved) {
      for (const point of edge.points) point[f.cross] += delta
      if (edge.labelPosition) edge.labelPosition[f.cross] += delta
    } else if (tgtMoved) {
      shiftTerminalRunCross(edge, direction, true, delta)
    } else if (srcMoved) {
      shiftTerminalRunCross(edge, direction, false, delta)
    }
  }
}

export function crossShiftSafe(
  movedIds: ReadonlySet<string>,
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  direction: Direction,
  delta: number,
  style: LabelMetricsStyle,
): boolean {
  const f = layoutFlow(direction)
  const moved = nodes.filter(node => movedIds.has(node.id))
  const shifted = new Map(moved.map(node => [node.id, {
    x: f.isHorizontal ? node.x : node.x + delta,
    y: f.isHorizontal ? node.y + delta : node.y,
    width: node.width,
    height: node.height,
  }]))
  for (const box of shifted.values()) {
    if (box.x < 0 || box.y < 0) return false
  }
  for (let i = 0; i < moved.length; i++) {
    const a = shifted.get(moved[i]!.id)!
    for (let j = i + 1; j < moved.length; j++) {
      if (rectsOverlap(a, shifted.get(moved[j]!.id)!, 8)) return false
    }
    for (const other of nodes) {
      if (movedIds.has(other.id)) continue
      if (rectsOverlap(a, other, 8)) return false
    }
  }
  for (const node of moved) {
    const box = shifted.get(node.id)!
    for (const edge of edges) {
      if (movedIds.has(edge.source) || movedIds.has(edge.target)) continue
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1]!, b = edge.points[i]!
        if (Math.max(a.x, b.x) > box.x + 0.5 && Math.min(a.x, b.x) < box.x + box.width - 0.5 &&
          Math.max(a.y, b.y) > box.y + 0.5 && Math.min(a.y, b.y) < box.y + box.height - 0.5) return false
      }
      const rect = labelRect(edge, style)
      if (rect && rectsOverlap(box, { x: rect.x, y: rect.y, width: rect.w, height: rect.h }, 8)) return false
    }
  }
  return true
}
