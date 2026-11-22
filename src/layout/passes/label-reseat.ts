// Last chance for a caption that still collides. ELK reserves every caption's
// space, but later route passes can run a sibling or duplicate shaft through
// its padded pill. A caption still in conflict once routes are final may move
// to another seat on its own route: the clearest one, nearest to where it sat.
// Only the caption moves; routes, markers and other captions stay put.

import type { Point, PositionedEdge, PositionedNode } from '../../types.ts'
import { labelRect } from '../../shared/edge-label-geometry.ts'
import { measureLabelConflicts } from '../label-conflicts.ts'
import type { LabelMetricsStyle } from '../route-geometry.ts'

const SEAT_STEP = 8
/** Work bound: only conflicted captions search, each over at most this many seats. */
const MAX_SEATS = 256
/** Keep the pill off both terminals, where markers and port stubs sit. */
const END_CLEARANCE = 16

function seatsAlong(points: readonly Point[]): Point[] {
  const seats: Point[] = []
  const total = points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y), 0)
  let walked = 0
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!, b = points[index]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    // Captions seat on orthogonal runs only, as the settler does.
    if (length > 0 && (Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5)) {
      for (let at = 0; at <= length; at += SEAT_STEP) {
        const along = walked + at
        if (along < END_CLEARANCE || total - along < END_CLEARANCE) continue
        seats.push({ x: a.x + (b.x - a.x) * at / length, y: a.y + (b.y - a.y) * at / length })
      }
    }
    walked += length
  }
  return seats
}

export function reseatConflictedLabels(nodes: PositionedNode[], edges: PositionedEdge[], style: LabelMetricsStyle): void {
  const graph = { nodes, edges }
  for (const [index, edge] of edges.entries()) {
    if (!edge.label || !edge.labelPosition || edge.style === 'invisible' || edge.source === edge.target) continue
    const involved = new Set([index])
    const current = measureLabelConflicts(graph, style, involved)
    if (current.total === 0) continue
    const original = edge.labelPosition
    const ends = edges.flatMap(other => (other.points.length ? [other.points[0]!, other.points.at(-1)!] : []))
    let best: { seat: Point; conflicts: number; distance: number } | undefined
    for (const seat of seatsAlong(edge.points).slice(0, MAX_SEATS)) {
      edge.labelPosition = seat
      const rect = labelRect(edge, style)
      // A caption over any terminal would cover an arrowhead or a port stub.
      if (!rect || ends.some(point => point.x > rect.x && point.x < rect.x + rect.w && point.y > rect.y && point.y < rect.y + rect.h)) continue
      const counts = measureLabelConflicts(graph, style, involved)
      // Text over text or over a node reads worse than a shaft under a pill:
      // a new seat may never add either, only remove shaft conflicts.
      if (counts.labelLabel > current.labelLabel || counts.labelNode > current.labelNode) continue
      const distance = Math.hypot(seat.x - original.x, seat.y - original.y)
      if (!best || counts.total < best.conflicts || (counts.total === best.conflicts && distance < best.distance)) best = { seat, conflicts: counts.total, distance }
    }
    edge.labelPosition = best && best.conflicts < current.total ? best.seat : original
  }
}
