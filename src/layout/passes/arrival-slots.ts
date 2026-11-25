// One owner for arrival slots. Earlier passes may land several arrivals on one
// point of a target's outline; that single arrowhead may stand for them only
// when the terminal assignment lets them share it. Whichever pass produced a misleading merge, this owner gives every
// other class of arrivals its own slot on the same entry face, then proves the
// moved routes against the final contracts. A cluster with no proven slot is
// left as is, and certification reports it.

import type { Point, PositionedEdge, PositionedNode } from '../../types.ts'
import { countEdgeCrossings, onShapeOutline } from '../../layout-rubric.ts'
import { recertifyReroutedEdge } from '../../route-contracts.ts'
import { clipEdgeToShape } from '../../shape-clipping.ts'
import { indistinctOccurrencePairs, routeCandidateMarkerBlocker } from '../route-marker-clearance.ts'
import { terminalAssignment, type TerminalAssignment } from '../terminal-assignment.ts'
import { MAX_PREFERENCE_EDGES, MAX_PREFERENCE_NODES, type LabelMetricsStyle } from '../route-geometry.ts'
import { routeClearOfNodes } from './shared.ts'

// Preferred pitch first, then tighter slots for short faces, then wider ones.
const SLOT_OFFSETS = [14, -14, 10, -10, 7, -7, 21, -21, 28, -28]
const FACE_MARGIN = 5
const MIN_TERMINAL_RUN = 12
const EPS = 0.5

const near = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS

/** Translate the terminal run of an orthogonal route across its entry axis,
 * stretching the perpendicular segment before it. A route that is one straight
 * run gains a dogleg at its midpoint. Undefined for non-orthogonal terminals. */
export function shiftedArrival(points: readonly Point[], delta: number): Point[] | undefined {
  const n = points.length
  if (n < 2) return undefined
  const end = points[n - 1]!, before = points[n - 2]!
  const cross: 'x' | 'y' | undefined = Math.abs(before.x - end.x) < EPS ? 'x' : Math.abs(before.y - end.y) < EPS ? 'y' : undefined
  if (!cross) return undefined
  const main = cross === 'x' ? 'y' : 'x'
  let start = n - 1
  while (start > 0 && Math.abs(points[start - 1]![cross] - end[cross]) < EPS) start--
  if (start === 0) {
    const first = points[0]!, middle = (first[main] + end[main]) / 2
    const at = (mainValue: number, crossValue: number): Point => (main === 'x' ? { x: mainValue, y: crossValue } : { x: crossValue, y: mainValue })
    return [first, at(middle, first[cross]), at(middle, end[cross] + delta), at(end[main], end[cross] + delta)]
  }
  // The segment into the run must cross the entry axis orthogonally to stretch.
  if (Math.abs(points[start - 1]![main] - points[start]![main]) >= EPS) return undefined
  return points.map((point, index) => (index >= start ? { ...point, [cross]: point[cross] + delta } : point))
}

/** Partition a cluster into classes whose members may all share one arrowhead. */
function mergeClasses(cluster: readonly PositionedEdge[], terminals: TerminalAssignment): PositionedEdge[][] {
  const classes: PositionedEdge[][] = []
  for (const edge of cluster) {
    const home = classes.find(members => members.every(member => terminals.shares(member, edge, 'end')))
    if (home) home.push(edge)
    else classes.push([edge])
  }
  return classes
}

export function separateIndistinctArrivals(nodes: PositionedNode[], edges: PositionedEdge[], style: LabelMetricsStyle): void {
  if (nodes.length > MAX_PREFERENCE_NODES || edges.length > MAX_PREFERENCE_EDGES) return
  const pairs = indistinctOccurrencePairs(edges)
  if (pairs.length === 0) return
  const nodeMap = new Map(nodes.map(node => [node.id, node]))
  // Clusters: arrivals at one point of one target that contain a misleading pair.
  const clusters: PositionedEdge[][] = []
  for (const { a } of pairs) {
    const end = a.points.at(-1)!
    if (clusters.some(cluster => cluster[0]!.target === a.target && near(cluster[0]!.points.at(-1)!, end))) continue
    clusters.push(edges.filter(edge => edge.target === a.target && edge.style !== 'invisible' && edge.source !== edge.target
      && edge.points.length >= 2 && near(edge.points.at(-1)!, end)))
  }
  for (const cluster of clusters) {
    const target = nodeMap.get(cluster[0]!.target)
    if (!target) continue
    const classes = mergeClasses(cluster, terminalAssignment(edges))
    // Any one class may keep the shared point; the others need free slots.
    // Try each keeper in turn and keep the first complete placement.
    for (let keeper = 0; keeper < classes.length; keeper++) {
      const undo = snapshot(cluster)
      // Distinctness is a hard contract and crossings are soft: a class may
      // spend one crossing only when no crossing-free slot exists.
      const placed = classes.every((members, index) => index === keeper
        || [0, 1].some(allowance => SLOT_OFFSETS.some(delta => placeClass(members, delta, allowance, target, nodeMap, nodes, edges, style))))
      if (placed) break
      undo()
    }
  }
}

function snapshot(edges: readonly PositionedEdge[]): () => void {
  const saved = edges.map(edge => ({ edge, points: edge.points, labelPosition: edge.labelPosition, certificate: edge.routeCertificate }))
  return () => {
    for (const { edge, points, labelPosition, certificate } of saved) {
      edge.points = points
      edge.labelPosition = labelPosition
      edge.routeCertificate = certificate
    }
  }
}

function placeClass(members: readonly PositionedEdge[], delta: number, crossingAllowance: number, target: PositionedNode, nodeMap: ReadonlyMap<string, PositionedNode>, nodes: PositionedNode[], edges: PositionedEdge[], style: LabelMetricsStyle): boolean {
  const proposed = new Map<PositionedEdge, Point[]>()
  for (const edge of members) {
    let points = shiftedArrival(edge.points, delta)
    if (!points) return false
    const shifted = points.at(-1)!, previous = points.at(-2)!
    const face = Math.abs(previous.x - shifted.x) < EPS ? 'x' : 'y'
    const lo = target[face] + FACE_MARGIN, hi = target[face] + (face === 'x' ? target.width : target.height) - FACE_MARGIN
    if (shifted[face] < lo || shifted[face] > hi) return false
    if (!onShapeOutline(target, shifted)) {
      // A curved or slanted face: extend the run toward the centre and clip it
      // to the painted outline, keeping the entry axis.
      const main = face === 'x' ? 'y' : 'x'
      const centre = target[main] + (main === 'x' ? target.width : target.height) / 2
      points = clipEdgeToShape([...points.slice(0, -1), { ...shifted, [main]: centre }], target, false)
    }
    const end = points.at(-1)!
    if (!onShapeOutline(target, end)) return false
    if (Math.hypot(end.x - previous.x, end.y - previous.y) < MIN_TERMINAL_RUN) return false
    // The new slot must be free: no other arrival already ends there.
    if (edges.some(other => other.target === target.id && !members.includes(other) && other.points.length > 0 && near(other.points.at(-1)!, end))) return false
    if (!routeClearOfNodes(points, nodes, new Set([edge.source, edge.target]))) return false
    if (routeCandidateMarkerBlocker(edge, points, edges, style)) return false
    proposed.set(edge, points)
  }
  const involved = new Set(members.map(edge => edges.indexOf(edge)))
  const before = countEdgeCrossings(edges, involved)
  const candidate = edges.map(edge => (proposed.has(edge) ? { ...edge, points: proposed.get(edge)! } : edge))
  if (countEdgeCrossings(candidate, involved) > before + crossingAllowance) return false
  for (const [edge, points] of proposed) {
    const saved = edge.routeCertificate
    const old = edge.points
    edge.points = points
    // A caption seated on the moved terminal run rides with it.
    if (edge.labelPosition) {
      const moved = old.findIndex((point, index) => !near(point, points[index] ?? point))
      const runStart = moved < 0 ? old.length : moved
      const onRun = old.slice(Math.max(0, runStart - 1)).some((point, index, run) => index > 0 && between(edge.labelPosition!, run[index - 1]!, point))
      if (onRun) {
        const face = Math.abs(old.at(-2)!.x - old.at(-1)!.x) < EPS ? 'x' : 'y'
        edge.labelPosition = { ...edge.labelPosition, [face]: edge.labelPosition[face] + delta }
      }
    }
    recertifyReroutedEdge(edge, saved, nodeMap.get(edge.source), nodeMap.get(edge.target))
  }
  return true
}

const between = (p: Point, a: Point, b: Point) =>
  p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS
