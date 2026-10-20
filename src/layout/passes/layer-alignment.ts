import type { Direction, PositionedEdge, PositionedNode } from '../../types.ts'
import { DEFAULTS } from '../geometry.ts'

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
 */
export function alignLayerNodes(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  direction: Direction
): void {
  if (nodes.length === 0) return

  const isHorizontal = direction === 'LR' || direction === 'RL'

  // Build set of directly-connected node pairs.
  // Nodes connected by an edge must not be merged into the same layer.
  const connectedPairs = new Set<string>()
  for (const edge of edges) {
    connectedPairs.add(`${edge.source}:${edge.target}`)
    connectedPairs.add(`${edge.target}:${edge.source}`)
  }

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

  // Build node lookup for edge adjustment
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  // Adjust edge endpoints to match shifted node positions
  for (const edge of edges) {
    if (edge.points.length < 2) continue

    const srcDelta = deltas.get(edge.source)
    const tgtDelta = deltas.get(edge.target)

    if (srcDelta != null) {
      // Shift first point and any subsequent points in the initial vertical/horizontal run
      const first = edge.points[0]!
      if (isHorizontal) {
        first.x += srcDelta
        // Shift second point if it's part of a straight vertical exit
        if (edge.points.length > 1 && edge.points[1]!.x === first.x - srcDelta) {
          edge.points[1]!.x += srcDelta
        }
      } else {
        first.y += srcDelta
        if (edge.points.length > 1 && edge.points[1]!.y === first.y - srcDelta) {
          edge.points[1]!.y += srcDelta
        }
      }
    }

    if (tgtDelta != null) {
      const last = edge.points[edge.points.length - 1]!
      if (isHorizontal) {
        last.x += tgtDelta
        if (edge.points.length > 1) {
          const prev = edge.points[edge.points.length - 2]!
          if (prev.x === last.x - tgtDelta) prev.x += tgtDelta
        }
      } else {
        last.y += tgtDelta
        if (edge.points.length > 1) {
          const prev = edge.points[edge.points.length - 2]!
          if (prev.y === last.y - tgtDelta) prev.y += tgtDelta
        }
      }
    }
  }
}
