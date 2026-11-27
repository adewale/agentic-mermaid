// Producers that aim several arrivals at one canonical point of a target
// (rank-distance reconnection, port-lane centering) seat them through here.
// Arrivals meeting at one point that may not all share one arrowhead take the
// slots the terminal assignment plans along the entry face; the producer only
// picks, among the planned orders, the one its moved routes cross least.
// Arrivals entering across perpendicular runs plan on different faces; when
// they still meet afterwards and may not share, each side slides half a slot.
// Nothing repairs a misleading merge later: the rubric's indistinct-occurrence
// check fails certification instead.

import type { Point, PositionedEdge, PositionedNode } from '../../types.ts'
import { countEdgeCrossings, onShapeOutline } from '../../layout-rubric.ts'
import { clipEdgeToShape } from '../../shape-clipping.ts'
import { captionRidesRun, shiftLabel } from '../route-values.ts'
import { ARRIVAL_SLOT_PITCH, MIN_ARRIVAL_SLOT_PITCH, type ArrivalSlot, type TerminalAssignment } from '../terminal-assignment.ts'

const FACE_MARGIN = 5
const EPS = 0.5

const near = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS

/** Seat the arrivals of `edges` that meet `placed` routes at one point of a
 * target. Every visible arrival ending there joins the plan, placed or not. */
export function seatMeetingArrivals(nodes: readonly PositionedNode[], edges: readonly PositionedEdge[], placed: readonly PositionedEdge[], terminals: TerminalAssignment): void {
  const nodeMap = new Map(nodes.map(node => [node.id, node]))
  const arrives = (edge: PositionedEdge) => edge.style !== 'invisible' && edge.source !== edge.target && edge.points.length >= 2
  const meetings: { meeting: PositionedEdge[]; end: Point }[] = [], met = new Set<PositionedEdge>()
  for (const edge of placed) {
    if (!arrives(edge) || met.has(edge)) continue
    const end = edge.points.at(-1)!
    const meeting = edges.filter(other => other.target === edge.target && arrives(other) && near(other.points.at(-1)!, end))
    for (const other of meeting) met.add(other)
    meetings.push({ meeting, end: { ...end } })
  }
  for (const { meeting, end } of meetings) {
    const node = nodeMap.get(meeting[0]!.target)
    if (!node) continue
    // The face runs across the terminal run; slots move along it. So a
    // meeting plans only among arrivals whose terminal runs share one axis:
    // one arriving along the other axis enters another face, and plans with
    // the arrivals that share its axis.
    for (const along of ['x', 'y'] as const) {
      const group = meeting.filter(other => faceAxis(other) === along)
      if (group.length >= 2) seatFace(group, along, node, edges, terminals)
    }
    separateCrossFaceArrivals(meeting, end, node, terminals)
  }
}

function seatFace(group: readonly PositionedEdge[], along: 'x' | 'y', node: PositionedNode, edges: readonly PositionedEdge[], terminals: TerminalAssignment): void {
  const end = group[0]!.points.at(-1)!
  const lo = node[along] + FACE_MARGIN, hi = node[along] + (along === 'x' ? node.width : node.height) - FACE_MARGIN
  const plans = terminals.arrivalSlots(group, { port: end[along], reach: Math.min(end[along] - lo, hi - end[along]), approach: edge => edge.points[0]![along] })
  if (plans.length < 2 && plans[0]?.every(slot => slot.offset === 0)) return
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

/** Arrivals still meeting at `end` once each face is seated, some entering
 * across a vertical run and some across a horizontal one, planned on
 * different faces and so never got apart. When any such pair may not share
 * the arrowhead, each side slides half a slot along its own face, away from
 * the side the other's terminal runs come from, so the two sides leave the
 * point apart and their terminal runs do not cross. A side that cannot move
 * that way (no room on the face, or the moved end would leave the outline)
 * tries the other way. */
function separateCrossFaceArrivals(meeting: readonly PositionedEdge[], end: Point, node: PositionedNode, terminals: TerminalAssignment): void {
  const still = meeting.filter(edge => near(edge.points.at(-1)!, end))
  const sides = { x: still.filter(edge => faceAxis(edge) === 'x'), y: still.filter(edge => faceAxis(edge) === 'y') }
  if (sides.x.every(a => sides.y.every(b => terminals.shares(a, b, 'end')))) return
  for (const along of ['x', 'y'] as const) {
    const lo = node[along] + FACE_MARGIN, hi = node[along] + (along === 'x' ? node.width : node.height) - FACE_MARGIN
    const others = sides[along === 'x' ? 'y' : 'x']
    const from = others.reduce((sum, edge) => sum + edge.points.at(-2)![along], 0) / others.length
    const away = from > end[along] ? -1 : 1
    for (const direction of [away, -away]) {
      const offset = direction * Math.min(ARRIVAL_SLOT_PITCH / 2, direction > 0 ? hi - end[along] : end[along] - lo)
      if (Math.abs(offset) < MIN_ARRIVAL_SLOT_PITCH / 2) continue
      const saved = sides[along].map(edge => ({ edge, points: edge.points, labelPosition: edge.labelPosition }))
      if (sides[along].every(edge => slideTerminalRun(edge, node, along, offset))) break
      for (const entry of saved) { entry.edge.points = entry.points; entry.edge.labelPosition = entry.labelPosition }
    }
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
 * dogleg), and keep the moved end on the painted outline. A caption riding
 * the moved run (captionRidesRun) moves with it. Reports whether the run
 * moved. */
function slideTerminalRun(edge: PositionedEdge, node: PositionedNode, along: 'x' | 'y', offset: number): boolean {
  const points = edge.points, end = points.at(-1)!
  const across: 'x' | 'y' = along === 'x' ? 'y' : 'x'
  const at = (acrossValue: number, alongValue: number): Point => across === 'x' ? { x: acrossValue, y: alongValue } : { x: alongValue, y: acrossValue }
  let first = points.length - 1
  while (first > 0 && points[first - 1]![along] === end[along]) first--
  if (first > 0 && points[first - 1]![across] !== points[first]![across]) return false
  const middle = (points[0]![across] + end[across]) / 2
  let moved = first === 0
    ? [points[0]!, at(middle, end[along]), at(middle, end[along] + offset), at(end[across], end[along] + offset)]
    : points.map((point, index) => index >= first ? { ...point, [along]: point[along] + offset } : point)
  if (!onShapeOutline(node, moved.at(-1)!)) {
    // A curved or slanted face: run on toward the centre and clip there.
    const centre = node[across] + (across === 'x' ? node.width : node.height) / 2
    moved = clipEdgeToShape([...moved.slice(0, -1), { ...moved.at(-1)!, [across]: centre }], node, false)
    if (!onShapeOutline(node, moved.at(-1)!)) return false
  }
  // The moved run: the collinear tail, or a straight route's half past its
  // new dogleg. A caption at the dogleg is on both halves and stays.
  const label = edge.labelPosition
  const rides = first === 0
    ? !!label && Math.abs(label[across] - middle) > EPS && captionRidesRun(edge, [points[0]!, at(middle, end[along]), end], 1, 2, along)
    : captionRidesRun(edge, points, first, points.length - 1, along)
  edge.points = moved
  if (rides) shiftLabel(edge, along, offset)
  return true
}
