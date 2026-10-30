import type { Direction, Point, PositionedEdge, PositionedGroup, PositionedNode } from '../../types.ts'
import { DEFAULTS } from '../geometry.ts'
import { moveKeepsGroupContainment } from './shared.ts'
import { clipEdgeToShape, isOutwardShapeApproach } from '../../shape-clipping.ts'
import { trimBoundaryEndpointRuns } from '../../route-contracts.ts'

function outwardEndpoint(points: Point[], node: PositionedNode | undefined, start: boolean): boolean | undefined {
  if (!node) return undefined
  const index = start ? 0 : points.length - 1, step = start ? 1 : -1
  const endpoint = points[index]
  if (!endpoint) return false
  for (let next = index + step; next >= 0 && next < points.length; next += step) {
    const adjacent = points[next]!
    if (adjacent.x !== endpoint.x || adjacent.y !== endpoint.y) return isOutwardShapeApproach(node, endpoint, adjacent)
  }
  return false
}

/** ELK box contacts are trimmed and clipped later. Project that same order on
 * copies so a cosmetic snap cannot consume a repairable outward approach. */
function clippedEdge(edge: PositionedEdge, source?: PositionedNode, target?: PositionedNode): PositionedEdge {
  const projected = { ...edge, points: edge.points
    .filter((point, index) => index === 0 || point.x !== edge.points[index - 1]!.x || point.y !== edge.points[index - 1]!.y)
    .map(point => ({ ...point })) }
  trimBoundaryEndpointRuns(projected, source, target)
  if (source) projected.points = clipEdgeToShape(projected.points, source, true)
  if (target) projected.points = clipEdgeToShape(projected.points, target, false)
  return projected
}

/** Project the same endpoint adjustment for admission and commit. Retaining
 * zero-length points here matters: the next nonzero shaft may be a tangent. */
function shiftedEndpointPoints(points: Point[], horizontal: boolean, sourceDelta?: number, targetDelta?: number): Point[] {
  if (points.length < 2 || sourceDelta === undefined && targetDelta === undefined) return points
  const projected = points.map(point => ({ ...point }))
  const main = horizontal ? 'x' : 'y'
  for (const [delta, index, adjacent] of [[sourceDelta, 0, 1], [targetDelta, projected.length - 1, projected.length - 2]] as const) {
    if (delta === undefined) continue
    const point = projected[index]!, neighbor = projected[adjacent]!
    point[main] += delta
    if (neighbor[main] === point[main] - delta) neighbor[main] += delta
  }
  return projected
}

/**
 * ELK's orthogonal edge routing staggers nodes within the same layer to create
 * space for edge bends. This post-processing step groups nodes into layers and
 * snaps them to the same flow-axis coordinate (Y for TD/TB, X for LR/RL).
 *
 * Grouping uses proximity along the flow axis: within a layer, ELK's stagger
 * is always less than layerSpacing (bounded by edge routing channels), while
 * adjacent layers are separated by at least layerSpacing + nodeHeight.
 * A threshold of 0.75 * layerSpacing cleanly separates these cases.
 *
 * Directly connected nodes (sharing an edge) are never merged into the same
 * layer group as an additional safety check.
 *
 * Edge endpoints connected to shifted nodes are adjusted proportionally.
 * Intermediate bend points are left unchanged — edge bundling or clipping
 * will recalculate them afterwards.
 *
 * Group frames are not refitted here, so a layer whose snap would carry a
 * member outside a frame that holds it keeps ELK's stagger.
 */
export function alignLayerNodes(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  direction: Direction,
  groups: PositionedGroup[] = [],
): void {
  if (nodes.length === 0) return

  const isHorizontal = direction === 'LR' || direction === 'RL'

  // Build set of directly-connected node pairs.
  // Nodes connected by an edge must not be merged into the same layer.
  const connectedPairs = new Set<string>()
  const incident = new Map<string, PositionedEdge[]>()
  for (const edge of edges) {
    connectedPairs.add(`${edge.source}:${edge.target}`)
    connectedPairs.add(`${edge.target}:${edge.source}`)
    for (const id of new Set([edge.source, edge.target])) {
      const entries = incident.get(id) ?? []
      entries.push(edge)
      incident.set(id, entries)
    }
  }
  const nodeMap = new Map(nodes.map(node => [node.id, node]))

  // ELK's stagger creates small gaps between adjacent nodes in the same layer
  // (typically edgeEdge spacing = 12px per routing channel). Adjacent layers
  // are separated by at least layerSpacing (48px). We use single-linkage
  // clustering: a node joins the current layer if the gap from the previous
  // node (in sorted order) is within threshold, AND it has no direct edge to
  // any node already in the layer.
  const THRESHOLD = DEFAULTS.layerSpacing * 0.6

  // Sort nodes by flow-axis position
  const sorted = [...nodes].sort((a, b) =>
    isHorizontal ? a.x - b.x : a.y - b.y
  )

  const layers: PositionedNode[][] = []
  let currentLayer: PositionedNode[] = [sorted[0]!]

  for (let i = 1; i < sorted.length; i++) {
    const pos = isHorizontal ? sorted[i]!.x : sorted[i]!.y
    const prevPos = isHorizontal ? sorted[i - 1]!.x : sorted[i - 1]!.y
    // Single-linkage: compare with previous node, not layer start
    const gap = pos - prevPos
    // Check if this node is connected to any node already in the current layer
    const hasEdgeToLayer = currentLayer.some(n =>
      connectedPairs.has(`${n.id}:${sorted[i]!.id}`)
    )
    if (gap <= THRESHOLD && !hasEdgeToLayer) {
      currentLayer.push(sorted[i]!)
    } else {
      layers.push(currentLayer)
      currentLayer = [sorted[i]!]
    }
  }
  layers.push(currentLayer)

  // Snap each layer's nodes to the layer's center position
  const deltas = new Map<string, number>() // nodeId → shift amount

  // A snapped node must not land on an already-routed corridor: edges were
  // routed against the PRE-snap positions, and a node moved onto a foreign
  // edge's path would occlude it (issue #25 rule 9 — no node movement after
  // routing without rerouting). Alignment is cosmetic; occlusion is a hard
  // defect, so a layer whose snap would cause one keeps ELK's stagger.
  const snapOccludes = (node: PositionedNode, newPos: number): boolean => {
    const nx = isHorizontal ? newPos : node.x
    const ny = isHorizontal ? node.y : newPos
    for (const edge of edges) {
      if (edge.source === node.id || edge.target === node.id) continue
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1]!, b = edge.points[i]!
        const xLo = Math.min(a.x, b.x), xHi = Math.max(a.x, b.x)
        const yLo = Math.min(a.y, b.y), yHi = Math.max(a.y, b.y)
        if (xHi > nx + 0.5 && xLo < nx + node.width - 0.5 &&
          yHi > ny + 0.5 && yLo < ny + node.height - 0.5) {
          return true
        }
      }
    }
    return false
  }

  for (const layer of layers) {
    if (layer.length <= 1) continue

    const positions = layer.map(n => isHorizontal ? n.x : n.y)
    const min = Math.min(...positions)
    const max = Math.max(...positions)
    if (max - min <= 1) continue // Already aligned

    // Use the center of the range as the snap target
    const target = (min + max) / 2

    if (layer.some(node => {
      const oldPos = isHorizontal ? node.x : node.y
      return Math.abs(target - oldPos) > 0.5 && snapOccludes(node, target)
    })) continue

    const moves = new Map(layer.flatMap(node => {
      const delta = target - (isHorizontal ? node.x : node.y)
      return Math.abs(delta) > 0.5 ? [[node.id, delta] as const] : []
    }))
    const projectedNodes = new Map(layer.map(node => [node.id, {
      ...node, ...(isHorizontal ? { x: node.x + (moves.get(node.id) ?? 0) } : { y: node.y + (moves.get(node.id) ?? 0) }),
    }]))
    if (layer.some(node => !moveKeepsGroupContainment(node, projectedNodes.get(node.id)!, groups))) continue
    const checked = new Set<PositionedEdge>()
    let breaksApproach = false
    for (const id of moves.keys()) {
      for (const edge of incident.get(id) ?? []) {
        if (checked.has(edge) || edge.style === 'invisible') continue
        checked.add(edge)
        const before = { ...edge, points: shiftedEndpointPoints(edge.points, isHorizontal, deltas.get(edge.source), deltas.get(edge.target)) }
        const after = { ...edge, points: shiftedEndpointPoints(edge.points, isHorizontal,
          moves.get(edge.source) ?? deltas.get(edge.source), moves.get(edge.target) ?? deltas.get(edge.target)) }
        let clippedBefore: PositionedEdge | undefined, clippedAfter: PositionedEdge | undefined
        for (const start of [true, false]) {
          const endpoint = start ? edge.source : edge.target
          const node = nodeMap.get(endpoint), projected = projectedNodes.get(endpoint) ?? node
          let wasOutward = outwardEndpoint(before.points, node, start), remainsOutward: boolean | undefined
          if (wasOutward === true) remainsOutward = outwardEndpoint(after.points, projected, start)
          else {
            clippedBefore ??= clippedEdge(before, nodeMap.get(edge.source), nodeMap.get(edge.target))
            clippedAfter ??= clippedEdge(after, projectedNodes.get(edge.source) ?? nodeMap.get(edge.source), projectedNodes.get(edge.target) ?? nodeMap.get(edge.target))
            wasOutward = outwardEndpoint(clippedBefore.points, node, start)
            remainsOutward = outwardEndpoint(clippedAfter.points, projected, start)
          }
          if (wasOutward === true && remainsOutward !== true) breaksApproach = true
        }
      }
    }
    // Alignment is cosmetic. Preserve the complete layer and its existing
    // route when snapping would consume or reverse an outward terminal stub.
    if (breaksApproach) continue

    for (const node of layer) {
      const oldPos = isHorizontal ? node.x : node.y
      const delta = target - oldPos
      if (Math.abs(delta) > 0.5) {
        if (isHorizontal) {
          node.x = target
        } else {
          node.y = target
        }
        deltas.set(node.id, delta)
      }
    }
  }

  if (deltas.size === 0) return

  // Adjust edge endpoints to match shifted node positions
  for (const edge of edges) {
    edge.points = shiftedEndpointPoints(edge.points, isHorizontal, deltas.get(edge.source), deltas.get(edge.target))
  }
}
