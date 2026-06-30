// Shared geometry kernel for the layout pipeline
// (docs/design/system/layout-pass-pipeline.md §4 step 2 / OQ-D1).
//
// Leaf module: depends only on core types, so the relocated post-ELK passes in
// ./passes/* can import these helpers WITHOUT importing layout-engine.ts — which
// is what keeps the dependency one-directional (layout-engine -> passes -> geometry)
// and free of import cycles.
import type { Direction, MermaidSubgraph, Point, PositionedGroup, PositionedNode } from '../types.ts'

export const DEFAULTS = {
  font: 'Inter',
  padding: 40,
  nodeSpacing: 28,
  layerSpacing: 48,
  mergeEdges: true,
  thoroughness: 3,
} as const

export function flattenGroupBounds(groups: PositionedGroup[]): Array<{ x: number; y: number; right: number; bottom: number }> {
  const bounds: Array<{ x: number; y: number; right: number; bottom: number }> = []
  for (const g of groups) {
    bounds.push({ x: g.x, y: g.y, right: g.x + g.width, bottom: g.y + g.height })
    bounds.push(...flattenGroupBounds(g.children))
  }
  return bounds
}

export function polylineLength(points: Point[]): number {
  let totalLength = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x
    const dy = points[i]!.y - points[i - 1]!.y
    totalLength += Math.sqrt(dx * dx + dy * dy)
  }
  return totalLength
}

export function pointAtPathDistance(points: Point[], distance: number): { point: Point; segmentIndex: number; pathDistance: number } {
  if (points.length === 0) return { point: { x: 0, y: 0 }, segmentIndex: 0, pathDistance: 0 }
  if (points.length === 1) return { point: points[0]!, segmentIndex: 0, pathDistance: 0 }

  const target = Math.max(0, Math.min(polylineLength(points), distance))
  let remaining = target
  let walked = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x
    const dy = points[i]!.y - points[i - 1]!.y
    const segLen = Math.sqrt(dx * dx + dy * dy)
    if (segLen === 0) continue
    if (remaining <= segLen) {
      const t = remaining / segLen
      return {
        point: {
          x: points[i - 1]!.x + t * dx,
          y: points[i - 1]!.y + t * dy,
        },
        segmentIndex: i,
        pathDistance: walked + remaining,
      }
    }
    remaining -= segLen
    walked += segLen
  }

  return { point: points[points.length - 1]!, segmentIndex: points.length - 1, pathDistance: walked }
}

/**
 * Calculate the midpoint along a polyline path.
 * Walks the path to find the point at half the total length.
 */
export function calculatePathMidpoint(points: Point[]): Point {
  return pointAtPathDistance(points, polylineLength(points) / 2).point
}

export function layoutFlow(direction: Direction): {
  isHorizontal: boolean
  main: 'x' | 'y'
  cross: 'x' | 'y'
  sign: 1 | -1
  sourceSide: 'N' | 'E' | 'S' | 'W'
  targetSide: 'N' | 'E' | 'S' | 'W'
} {
  if (direction === 'LR') return { isHorizontal: true, main: 'x', cross: 'y', sign: 1, sourceSide: 'E', targetSide: 'W' }
  if (direction === 'RL') return { isHorizontal: true, main: 'x', cross: 'y', sign: -1, sourceSide: 'W', targetSide: 'E' }
  if (direction === 'BT') return { isHorizontal: false, main: 'y', cross: 'x', sign: -1, sourceSide: 'N', targetSide: 'S' }
  return { isHorizontal: false, main: 'y', cross: 'x', sign: 1, sourceSide: 'S', targetSide: 'N' }
}

export function positionedNodeCenter(node: PositionedNode): Point {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 }
}

export function nodeMainStart(node: PositionedNode, direction: Direction): number {
  const f = layoutFlow(direction)
  return node[f.main]
}

export function nodeCrossStart(node: PositionedNode, direction: Direction): number {
  const f = layoutFlow(direction)
  return node[f.cross]
}

export function nodeCrossSize(node: PositionedNode, direction: Direction): number {
  return layoutFlow(direction).isHorizontal ? node.height : node.width
}

export function nodeMainSize(node: PositionedNode, direction: Direction): number {
  return layoutFlow(direction).isHorizontal ? node.width : node.height
}

export function nodeCrossCenter(node: PositionedNode, direction: Direction): number {
  return nodeCrossStart(node, direction) + nodeCrossSize(node, direction) / 2
}

export function nodeMainCenter(node: PositionedNode, direction: Direction): number {
  return nodeMainStart(node, direction) + nodeMainSize(node, direction) / 2
}

export function rectsOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }, pad = 0): boolean {
  return a.x < b.x + b.width + pad && a.x + a.width + pad > b.x && a.y < b.y + b.height + pad && a.y + a.height + pad > b.y
}

/** Margin routing info for cross-hierarchy edges */
export interface MarginInfo {
  leftX: number
  rightX: number
}

/** Find a subgraph by ID in a nested structure */
export function findSubgraph(subgraphs: MermaidSubgraph[], id: string): MermaidSubgraph | undefined {
  for (const sg of subgraphs) {
    if (sg.id === id) return sg
    const found = findSubgraph(sg.children, id)
    if (found) return found
  }
  return undefined
}

type LayoutDebugEnv = {
  APL_DEBUG?: string
  APL_NO_CENTER?: string
  APL_NO_FACET?: string
  APL_NO_SVERTEX?: string
  // Disable the alignLabeledSourcePort pass (a labelled single-edge source is
  // left exiting off its mid-port, as it was before that pass). For before/after
  // evidence and bisecting, matching the other APL_NO_* pass switches.
  APL_NO_LABELED_SOURCE_PORT?: string
  // Label-decoupling (opt-in, validated): when set, edge labels are NOT handed
  // to ELK, so a label cannot displace its target node off the edge's port lane
  // (the sym A->B mid-port fix). Default is off — ELK still reserves a label
  // cell — until the bent-duplicate-label route-contract regression is resolved.
  // See the layout-engine label-injection sites and the decoupling write-up.
  APL_DECOUPLE_LABELS?: string
  // DISABLE co-ranking of a mixed-label fan-in (default ON). When a fan-in hub
  // has sibling edges where some are labeled and some are not, the labeled edge
  // reserves an extra label-dummy rank so its source lands one rank EARLIER
  // than the unlabeled sibling's source — an asymmetric fan-in the centering
  // can't square up. By default each unlabeled sibling edge gets a layout-only
  // balancing label (a single space, sized to the widest labeled sibling) so
  // ELK reserves the SAME dummy rank and every source co-ranks;
  // centerPeerBarycenters then drops its labeled-edge exclusion for that
  // now-co-ranked hub so it can center on the squared-up peers, and the spokes
  // converge as symmetric doglegs (marked bundle-owned, so the bend is treated
  // as justified — see route-contracts findRouteHitches and the layout-rubric
  // justified-bend exemption). The balancing label is never rendered — readback
  // keys off the Mermaid edge's own label, which stays undefined. Set this to
  // restore the pre-co-rank base geometry (so before/after stays bisectable);
  // matches the other APL_NO_* pass switches. See the layout-engine
  // label-injection sites and centerPeerBarycenters.
  APL_NO_CORANK_FANIN?: string
}

export function layoutEnvFlag(name: keyof LayoutDebugEnv): boolean {
  const env = (globalThis as typeof globalThis & { process?: { env?: LayoutDebugEnv } }).process?.env
  const value = env?.[name]
  return value === '1' || value === 'true'
}

export function layoutDebug(...args: unknown[]): void {
  if (layoutEnvFlag('APL_DEBUG')) console.error(...args)
}
