// One owner for terminal sharing. Several route producers may land edge ends
// on one point of a node's outline, where one painted shaft and glyph then
// stands for every edge ending there. Whether two ends may meet that way is
// decided here, once per roster, by one rule; route producers, repair passes
// and the final rubric all read that decision rather than carrying their own
// predicate.
//
// The assignment also plans where arrivals that may not share a port sit on
// its face: their order along it and their offsets (`arrivalSlots`). The
// producers that aim several arrivals at one canonical point and then needed
// a later pass to pull them apart (rank-distance reconnection, port-lane
// centering) seat them by that plan when they build the routes. Producers
// that choose a port by their own proof keep doing so, and read only the
// sharing rule: route contracts' straight-lane, Z and side-entry proofs (a
// port held against the route leaves the lanes one pair separation beside
// it), the duplicate-lane planner (it separates whole repeated routes, not
// terminals), and the co-ranked fan-in owner (it spreads its spokes
// symmetrically about the hub's port). The rubric's indistinct-occurrence
// check is the safety net: a layout that lands arrivals on an arrowhead this
// rule forbids fails certification.

import type { PositionedEdge } from '../types.ts'

export type TerminalEnd = 'start' | 'end'

/** Two edges draw the same shaft: identical stroke, curve, animation, inline
 * style and authored classes. One shared shaft paints over any difference. */
export function paintsAlike(a: PositionedEdge, b: PositionedEdge): boolean {
  if (a.style !== b.style || a.curve !== b.curve || a.animate !== b.animate || a.animation !== b.animation) return false
  const styleA = a.inlineStyle ?? {}, styleB = b.inlineStyle ?? {}
  for (const key in styleA) if (!(key in styleB) || styleB[key] !== styleA[key]) return false
  for (const key in styleB) if (!(key in styleA)) return false
  const classesA = a.classNames ?? [], classesB = b.classNames ?? []
  if (classesA.length !== classesB.length) return false
  for (let index = 0; index < classesA.length; index++) if (classesA[index] !== classesB[index]) return false
  return true
}

const marker = (edge: PositionedEdge, end: TerminalEnd): string | undefined =>
  end === 'end' ? (edge.hasArrowEnd ? edge.endMarker ?? 'arrow' : undefined) : (edge.hasArrowStart ? edge.startMarker ?? 'arrow' : undefined)

/** The share/merge rule. One terminal's shaft and glyph stand for each end
 * merged into it, so the ends must be different relationships (a repeated
 * occurrence stays countable), paint identically, carry the same glyph, and at
 * most one of them may be named. */
function mayMerge(a: PositionedEdge, b: PositionedEdge, end: TerminalEnd): boolean {
  if (a.label && b.label) return false
  if (end === 'end' ? a.source === b.source : a.target === b.target) return false
  return marker(a, end) === marker(b, end) && paintsAlike(a, b)
}

/** The recorded sharing decision for one roster. A staged copy of an edge
 * (`{ ...edge, points }`, or one stripped of its label for a lane proof) is
 * read as the roster edge with the same `edgeIndex`, so every consumer judges
 * the authored end, never a transient view of it. */
export interface TerminalAssignment {
  /** Whether `a` and `b` end at one node at `end` and may share that terminal. */
  shares(a: PositionedEdge, b: PositionedEdge, end: TerminalEnd): boolean
  /** Slot plans on one entry face for arrivals that would otherwise meet at
   * its port, most preferred first: see `planArrivalSlots`. */
  arrivalSlots(arrivals: readonly PositionedEdge[], face: ArrivalFace): ArrivalSlot[][]
}

/** An entry face, measured along the face: the port's coordinate, how far
 * a slot may sit from it, and where each arrival approaches from. */
export interface ArrivalFace {
  port: number
  reach: number
  approach: (edge: PositionedEdge) => number
}

/** Ends that share one terminal, `offset` from the face's port along it. */
export interface ArrivalSlot { members: PositionedEdge[]; offset: number }

const SLOT_PITCH = 14
const MIN_SLOT_PITCH = 6

/** Arrivals that may not all share one arrowhead each get a slot of their
 * own along the face. Sets of mutually shareable arrivals are ordered by
 * where they approach from, so their terminal runs nest without crossing.
 * One set keeps the port: preferably the largest, then the one approaching
 * nearest it. The plans list every keeper in that preference, each in
 * approach order and then mirrored, so a producer that can measure the
 * routes it is building may pick the plan that crosses least. Plans whose
 * slots do not fit the face are left out. */
function planArrivalSlots(shares: (a: PositionedEdge, b: PositionedEdge) => boolean, arrivals: readonly PositionedEdge[], face: ArrivalFace): ArrivalSlot[][] {
  const ordered = [...arrivals].sort((a, b) => face.approach(a) - face.approach(b))
  const sets: PositionedEdge[][] = []
  for (const edge of ordered) {
    const home = sets.find(members => members.every(member => shares(member, edge)))
    if (home) home.push(edge)
    else sets.push([edge])
  }
  if (sets.length < 2) return [sets.map(members => ({ members, offset: 0 }))]
  const mean = (members: readonly PositionedEdge[]) => members.reduce((sum, edge) => sum + face.approach(edge), 0) / members.length
  sets.sort((a, b) => mean(a) - mean(b))
  const keepers = sets.map((_, index) => index).sort((a, b) => sets[b]!.length - sets[a]!.length
    || Math.abs(mean(sets[a]!) - face.port) - Math.abs(mean(sets[b]!) - face.port) || a - b)
  // Of a keeper's two orders, the one moving each set toward where it comes
  // from goes first.
  const drift = (plan: ArrivalSlot[]) => plan.reduce((sum, slot) => sum + slot.members.reduce((total, edge) => total + Math.abs(face.approach(edge) - face.port - slot.offset), 0), 0)
  const plans: ArrivalSlot[][] = []
  for (const keeper of keepers) {
    const steps = Math.max(keeper, sets.length - 1 - keeper)
    const pitch = Math.min(SLOT_PITCH, face.reach / steps)
    if (pitch < MIN_SLOT_PITCH) continue
    const orders = [1, -1].map(direction => sets.map((members, index) => ({ members, offset: direction * (index - keeper) * pitch })))
    plans.push(...orders.sort((a, b) => drift(a) - drift(b)))
  }
  return plans
}

/** Record the sharing decision for every end of `edges`. The roster is read
 * when first queried, so a layout can create its assignment before
 * extraction fills the roster. */
export function assignTerminals(edges: readonly PositionedEdge[]): TerminalAssignment {
  const authored = new Map<number, PositionedEdge>()
  let indexed = -1
  const resolve = (edge: PositionedEdge): PositionedEdge => {
    if (edge.edgeIndex === undefined) return edge
    if (indexed !== edges.length) {
      authored.clear()
      for (const member of edges) if (member.edgeIndex !== undefined && !authored.has(member.edgeIndex)) authored.set(member.edgeIndex, member)
      indexed = edges.length
    }
    return authored.get(edge.edgeIndex) ?? edge
  }
  return {
    shares(a, b, end) {
      if (end === 'end' ? a.target !== b.target : a.source !== b.source) return false
      const ra = resolve(a), rb = resolve(b)
      return ra === rb || mayMerge(ra, rb, end)
    },
    arrivalSlots(arrivals, face) {
      return planArrivalSlots((a, b) => this.shares(a, b, 'end'), arrivals, face)
    },
  }
}

const recorded = new WeakMap<readonly PositionedEdge[], TerminalAssignment>()

/** The assignment recorded for `edges`. The graph pipeline records one on its
 * pass context and hands it to its passes; shared helpers that only see a
 * roster (lane proofs, marker clearance, the rubric) read the same record. */
export function terminalAssignment(edges: readonly PositionedEdge[]): TerminalAssignment {
  let assignment = recorded.get(edges)
  if (!assignment) recorded.set(edges, assignment = assignTerminals(edges))
  return assignment
}
