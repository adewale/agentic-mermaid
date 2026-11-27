// Producers that aim several arrivals at one canonical point of a target
// (rank-distance reconnection, port-lane centering) seat them through here,
// and a producer that also starts several routes at one canonical point of a
// source (rank-distance reconnection) seats those departures the same way.
// Ends meeting at one point that may not all share one terminal take the
// slots the terminal assignment plans along the face; the producer only
// picks, among the planned orders, the one its moved routes cross least.
// Ends crossing the outline along perpendicular runs plan on different faces;
// when they still meet afterwards and may not share, each side slides half a
// slot. Nothing repairs a misleading merge later: the rubric's
// indistinct-occurrence check fails certification instead.

import type { Point, PositionedEdge, PositionedNode } from '../../types.ts'
import { countEdgeCrossings, onShapeOutline } from '../../layout-rubric.ts'
import { clipEdgeToShape } from '../../shape-clipping.ts'
import { captionRidesRun, shiftLabel } from '../route-values.ts'
import { ARRIVAL_SLOT_PITCH, MIN_ARRIVAL_SLOT_PITCH, type TerminalEnd, type TerminalSlot, type TerminalAssignment } from '../terminal-assignment.ts'

const FACE_MARGIN = 5
const EPS = 0.5

const near = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS

/** A route read from its `end` terminal: the terminal last, so one rule seats
 * arrivals and departures. */
const fromFar = (points: readonly Point[], end: TerminalEnd): readonly Point[] => end === 'end' ? points : points.toReversed()
const terminalPoint = (edge: PositionedEdge, end: TerminalEnd): Point => end === 'end' ? edge.points.at(-1)! : edge.points[0]!

/** Seat the arrivals of `edges` that meet `placed` routes at one point of a
 * target. Every visible arrival ending there joins the plan, placed or not. */
export function seatMeetingArrivals(nodes: readonly PositionedNode[], edges: readonly PositionedEdge[], placed: readonly PositionedEdge[], terminals: TerminalAssignment): void {
  seatMeetingTerminals(nodes, edges, placed, terminals, 'end')
}

/** Seat the departures of `edges` that leave `placed` routes' source at one
 * point, by the same plan arrivals take. */
export function seatMeetingDepartures(nodes: readonly PositionedNode[], edges: readonly PositionedEdge[], placed: readonly PositionedEdge[], terminals: TerminalAssignment): void {
  seatMeetingTerminals(nodes, edges, placed, terminals, 'start')
}

function seatMeetingTerminals(nodes: readonly PositionedNode[], edges: readonly PositionedEdge[], placed: readonly PositionedEdge[], terminals: TerminalAssignment, end: TerminalEnd): void {
  const nodeMap = new Map(nodes.map(node => [node.id, node]))
  const owner = (edge: PositionedEdge) => end === 'end' ? edge.target : edge.source
  const counts = (edge: PositionedEdge) => edge.style !== 'invisible' && edge.source !== edge.target && edge.points.length >= 2
  const meetings: { meeting: PositionedEdge[]; at: Point }[] = [], met = new Set<PositionedEdge>()
  for (const edge of placed) {
    if (!counts(edge) || met.has(edge)) continue
    const at = terminalPoint(edge, end)
    const meeting = edges.filter(other => owner(other) === owner(edge) && counts(other) && near(terminalPoint(other, end), at))
    for (const other of meeting) met.add(other)
    meetings.push({ meeting, at: { ...at } })
  }
  for (const { meeting, at } of meetings) {
    const node = nodeMap.get(owner(meeting[0]!))
    if (!node) continue
    // The face runs across the terminal run; slots move along it. So a
    // meeting plans only among ends whose terminal runs share one axis: one
    // crossing the outline along the other axis is on another face, and
    // plans with the ends that share its axis.
    for (const along of ['x', 'y'] as const) {
      const group = meeting.filter(other => faceAxis(other, end) === along)
      if (group.length >= 2) seatFace(group, along, node, edges, terminals, end)
    }
    separateCrossFaceEnds(meeting, at, node, terminals, end)
  }
}

function seatFace(group: readonly PositionedEdge[], along: 'x' | 'y', node: PositionedNode, edges: readonly PositionedEdge[], terminals: TerminalAssignment, end: TerminalEnd): void {
  const at = terminalPoint(group[0]!, end)
  const lo = node[along] + FACE_MARGIN, hi = node[along] + (along === 'x' ? node.width : node.height) - FACE_MARGIN
  const plans = terminals.terminalSlots(group, { port: at[along], reach: Math.min(at[along] - lo, hi - at[along]), approach: edge => terminalPoint(edge, end === 'end' ? 'start' : 'end')[along] }, end)
  if (plans.length < 2 && plans[0]?.every(slot => slot.offset === 0)) return
  const involved = new Set(group.map(edge => edges.indexOf(edge)))
  const saved = group.map(edge => ({ edge, points: edge.points, labelPosition: edge.labelPosition }))
  const restore = () => { for (const entry of saved) { entry.edge.points = entry.points; entry.edge.labelPosition = entry.labelPosition } }
  let best: { plan: TerminalSlot[]; crossings: number } | undefined
  for (const plan of plans) {
    seat(plan, node, along, end)
    const crossings = countEdgeCrossings(edges, involved)
    if (!best || crossings < best.crossings) best = { plan, crossings }
    restore()
  }
  if (best) seat(best.plan, node, along, end)
}

/** Ends still meeting at `at` once each face is seated, some crossing the
 * outline along a vertical run and some along a horizontal one, planned on
 * different faces and so never got apart. When any such pair may not share
 * the terminal, each side slides half a slot along its own face, away from
 * the side the other's terminal runs come from, so the two sides meet the
 * point apart and their terminal runs do not cross. A side that cannot move
 * that way (no room on the face, or the moved end would leave the outline)
 * tries the other way. */
function separateCrossFaceEnds(meeting: readonly PositionedEdge[], at: Point, node: PositionedNode, terminals: TerminalAssignment, end: TerminalEnd): void {
  const still = meeting.filter(edge => near(terminalPoint(edge, end), at))
  const sides = { x: still.filter(edge => faceAxis(edge, end) === 'x'), y: still.filter(edge => faceAxis(edge, end) === 'y') }
  if (sides.x.every(a => sides.y.every(b => terminals.shares(a, b, end)))) return
  for (const along of ['x', 'y'] as const) {
    const lo = node[along] + FACE_MARGIN, hi = node[along] + (along === 'x' ? node.width : node.height) - FACE_MARGIN
    const others = sides[along === 'x' ? 'y' : 'x']
    const from = others.reduce((sum, edge) => sum + fromFar(edge.points, end).at(-2)![along], 0) / others.length
    const away = from > at[along] ? -1 : 1
    for (const direction of [away, -away]) {
      // An end already within the face margin has no room that way.
      const room = Math.max(0, direction > 0 ? hi - at[along] : at[along] - lo)
      const offset = direction * Math.min(ARRIVAL_SLOT_PITCH / 2, room)
      if (Math.abs(offset) < MIN_ARRIVAL_SLOT_PITCH / 2) continue
      const saved = sides[along].map(edge => ({ edge, points: edge.points, labelPosition: edge.labelPosition }))
      if (sides[along].every(edge => slideTerminalRun(edge, node, along, offset, end))) break
      for (const entry of saved) { entry.edge.points = entry.points; entry.edge.labelPosition = entry.labelPosition }
    }
  }
}

/** The axis of the face a route's `end` terminal run crosses: `x` along a
 * vertical run, `y` along a horizontal one, none along a slanted one. */
function faceAxis(edge: PositionedEdge, end: TerminalEnd): 'x' | 'y' | undefined {
  const points = fromFar(edge.points, end)
  const at = points.at(-1)!, before = points.at(-2)!
  if (Math.abs(before.x - at.x) < 1e-9) return 'x'
  return Math.abs(before.y - at.y) < 1e-9 ? 'y' : undefined
}

function seat(plan: readonly TerminalSlot[], node: PositionedNode, along: 'x' | 'y', end: TerminalEnd): void {
  for (const { members, offset } of plan) if (offset !== 0) for (const edge of members) slideTerminalRun(edge, node, along, offset, end)
}

/** Move an orthogonal route's `end` terminal run `offset` along its face,
 * stretching the segment before it (a straight route gains a midpoint
 * dogleg), and keep the moved end on the painted outline. A caption riding
 * the moved run (captionRidesRun) moves with it. Reports whether the run
 * moved. */
function slideTerminalRun(edge: PositionedEdge, node: PositionedNode, along: 'x' | 'y', offset: number, end: TerminalEnd = 'end'): boolean {
  const points = fromFar(edge.points, end), tip = points.at(-1)!
  const across: 'x' | 'y' = along === 'x' ? 'y' : 'x'
  const at = (acrossValue: number, alongValue: number): Point => across === 'x' ? { x: acrossValue, y: alongValue } : { x: alongValue, y: acrossValue }
  let first = points.length - 1
  while (first > 0 && points[first - 1]![along] === tip[along]) first--
  if (first > 0 && points[first - 1]![across] !== points[first]![across]) return false
  const middle = (points[0]![across] + tip[across]) / 2
  let moved = first === 0
    ? [points[0]!, at(middle, tip[along]), at(middle, tip[along] + offset), at(tip[across], tip[along] + offset)]
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
    ? !!label && Math.abs(label[across] - middle) > EPS && captionRidesRun(edge, [points[0]!, at(middle, tip[along]), tip], 1, 2, along)
    : captionRidesRun(edge, points, first, points.length - 1, along)
  edge.points = end === 'end' ? moved : moved.toReversed()
  if (rides) shiftLabel(edge, along, offset)
  return true
}
