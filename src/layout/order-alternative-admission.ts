import type { PositionedGraph } from '../types.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import { countParallelRouteOverlaps } from '../layout-rubric.ts'
import { opposingRoutePartners } from '../shared/edge-overlaps.ts'
import { measureLabelConflicts } from './label-conflicts.ts'
import { opposingRoutesMislead, routeCandidateMarkerBlocker } from './route-marker-clearance.ts'

/** A certified Pareto improvement must also keep each authored occurrence
 * distinguishable. Compare pairs by occurrence, so removing an old ambiguity
 * cannot pay for concealing a different relationship. */
export function orderAlternativeInkClear(first: PositionedGraph, other: PositionedGraph, style: ResolvedRenderStyle, labelConflicts: number): boolean {
  const before = new Map(first.edges.map((edge, index) => [edge.edgeIndex ?? index, { edge, index }]))
  if (before.size !== first.edges.length || other.edges.length !== first.edges.length) return false
  const seen = new Set<number>()
  for (const [index, edge] of other.edges.entries()) {
    const identity = edge.edgeIndex ?? index, previous = before.get(identity)
    if (seen.has(identity) || !previous || previous.edge.source !== edge.source || previous.edge.target !== edge.target) return false
    seen.add(identity)
    const old = previous.edge
    if (routeCandidateMarkerBlocker(old, edge.points, other.edges, style, edge)) return false
    const oldPartners = new Set(opposingRoutePartners(old, first.edges.filter(peer => peer !== old)).map(peer => peer.edgeIndex ?? first.edges.indexOf(peer)))
    for (const peer of opposingRoutePartners(edge, other.edges.filter(peer => peer !== edge))) {
      if (!oldPartners.has(peer.edgeIndex ?? other.edges.indexOf(peer)) && opposingRoutesMislead(edge, peer, other.edges)) return false
    }
    for (let peerIndex = 0; peerIndex < index; peerIndex++) {
      const peer = other.edges[peerIndex]!
      if (peer.source !== edge.source || peer.target !== edge.target) continue
      const oldPeer = before.get(peer.edgeIndex ?? peerIndex)!.edge
      if (countParallelRouteOverlaps([edge, peer]) > countParallelRouteOverlaps([old, oldPeer])) return false
    }
    // Certification already measured the complete candidate. Zero conflicts
    // proves every occurrence clear; only a nonzero total needs attribution.
    if (labelConflicts > 0 && measureLabelConflicts(other, style, new Set([index])).total
      > measureLabelConflicts(first, style, new Set([previous.index])).total) return false
  }
  return true
}
