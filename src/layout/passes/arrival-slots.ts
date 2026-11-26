// Producers that aim several arrivals at one canonical point of a target
// (rank-distance reconnection, port-lane centering) seat them through here.
// Arrivals meeting at one point that may not all share one arrowhead take the
// slots the terminal assignment plans along the entry face; the producer only
// picks, among the planned orders, the one its moved routes cross least.
// Nothing repairs a misleading merge later: the rubric's indistinct-occurrence
// check fails certification instead.

import type { Point, PositionedEdge, PositionedNode } from '../../types.ts'
import { countEdgeCrossings, onShapeOutline } from '../../layout-rubric.ts'
import { clipEdgeToShape } from '../../shape-clipping.ts'
import type { ArrivalSlot, TerminalAssignment } from '../terminal-assignment.ts'

const FACE_MARGIN = 5
const EPS = 0.5

const near = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS

/** Seat the arrivals of `edges` that meet `placed` routes at one point of a
 * target. Every visible arrival ending there joins the plan, placed or not. */
export function seatMeetingArrivals(nodes: readonly PositionedNode[], edges: readonly PositionedEdge[], placed: readonly PositionedEdge[], terminals: TerminalAssignment): void {
  const nodeMap = new Map(nodes.map(node => [node.id, node]))
  const arrives = (edge: PositionedEdge) => edge.style !== 'invisible' && edge.source !== edge.target && edge.points.length >= 2
  const meetings: { group: PositionedEdge[]; along: 'x' | 'y' }[] = [], met = new Set<PositionedEdge>()
  for (const edge of placed) {
    if (!arrives(edge) || met.has(edge)) continue
    const end = edge.points.at(-1)!
    // The face runs across the terminal run; slots move along it. So a
    // meeting plans only among arrivals whose terminal runs share one axis:
    // one arriving along the other axis enters another face, and plans with
    // the arrivals that share its axis.
    const meeting = edges.filter(other => other.target === edge.target && arrives(other) && near(other.points.at(-1)!, end))
    for (const other of meeting) met.add(other)
    for (const along of ['x', 'y'] as const) {
      const group = meeting.filter(other => faceAxis(other) === along)
      if (group.length) meetings.push({ group, along })
    }
  }
  for (const { group, along } of meetings) {
    const node = nodeMap.get(group[0]!.target)
    if (!node || group.length < 2) continue
    const end = group[0]!.points.at(-1)!
    const lo = node[along] + FACE_MARGIN, hi = node[along] + (along === 'x' ? node.width : node.height) - FACE_MARGIN
    const plans = terminals.arrivalSlots(group, { port: end[along], reach: Math.min(end[along] - lo, hi - end[along]), approach: edge => edge.points[0]![along] })
    if (plans.length < 2 && plans[0]?.every(slot => slot.offset === 0)) continue
    const involved = new Set(group.map(edge => edges.indexOf(edge)))
    const saved = group.map(edge => ({ edge, points: edge.points, labelPosition: edge.labelPosition }))
    const restore = () => { for (const entry of saved) { entry.edge.points = entry.points; entry.edge.labelPosition = entry.labelPosition } }
    let best: { plan: ArrivalSlot[]; crossings: number } | undefined
    for (const plan of plans) {
      seat(plan, node, along)
      const crossings = countEdgeCrossings(edges, involved)
      if (!best || crossings < best.crossings) best = { plan, crossings }
      restore()
    }
    if (best) seat(best.plan, node, along)
  }
}

/** The axis of the face a route's terminal run enters: `x` across a
 * vertical run, `y` across a horizontal one, none across a slanted one. */
function faceAxis(edge: PositionedEdge): 'x' | 'y' | undefined {
  const end = edge.points.at(-1)!, before = edge.points.at(-2)!
  if (Math.abs(before.x - end.x) < 1e-9) return 'x'
  return Math.abs(before.y - end.y) < 1e-9 ? 'y' : undefined
}

function seat(plan: readonly ArrivalSlot[], node: PositionedNode, along: 'x' | 'y'): void {
  for (const { members, offset } of plan) if (offset !== 0) for (const edge of members) slideTerminalRun(edge, node, along, offset)
}

/** Move an orthogonal route's terminal run `offset` along its entry face,
 * stretching the segment before it (a straight route gains a midpoint
 * dogleg), and keep the moved end on the painted outline. A caption seated
 * on the moved run rides with it. */
function slideTerminalRun(edge: PositionedEdge, node: PositionedNode, along: 'x' | 'y', offset: number): void {
  const points = edge.points, end = points.at(-1)!
  const across: 'x' | 'y' = along === 'x' ? 'y' : 'x'
  const at = (acrossValue: number, alongValue: number): Point => across === 'x' ? { x: acrossValue, y: alongValue } : { x: alongValue, y: acrossValue }
  let first = points.length - 1
  while (first > 0 && points[first - 1]![along] === end[along]) first--
  if (first > 0 && points[first - 1]![across] !== points[first]![across]) return
  const middle = (points[0]![across] + end[across]) / 2
  let moved = first === 0
    ? [points[0]!, at(middle, end[along]), at(middle, end[along] + offset), at(end[across], end[along] + offset)]
    : points.map((point, index) => index >= first ? { ...point, [along]: point[along] + offset } : point)
  if (!onShapeOutline(node, moved.at(-1)!)) {
    // A curved or slanted face: run on toward the centre and clip there.
    const centre = node[across] + (across === 'x' ? node.width : node.height) / 2
    moved = clipEdgeToShape([...moved.slice(0, -1), { ...moved.at(-1)!, [across]: centre }], node, false)
    if (!onShapeOutline(node, moved.at(-1)!)) return
  }
  const label = edge.labelPosition
  if (label && first > 0 && points.slice(first).some((point, index, run) => index > 0 && between(label, run[index - 1]!, point))) {
    edge.labelPosition = { ...label, [along]: label[along] + offset }
  }
  edge.points = moved
}

const between = (p: Point, a: Point, b: Point) =>
  p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS
