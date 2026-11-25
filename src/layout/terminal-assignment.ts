// One owner for terminal sharing. Several route producers may land edge ends
// on one point of a node's outline, where one painted shaft and glyph then
// stands for every edge ending there. Whether two ends may meet that way is
// decided here, once per roster, by one rule; route producers, repair passes
// and the final rubric all read that decision rather than carrying their own
// predicate.

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
}

/** Record the sharing decision for every end of `edges`. */
export function assignTerminals(edges: readonly PositionedEdge[]): TerminalAssignment {
  const authored = new Map<number, PositionedEdge>()
  for (const edge of edges) if (edge.edgeIndex !== undefined && !authored.has(edge.edgeIndex)) authored.set(edge.edgeIndex, edge)
  const resolve = (edge: PositionedEdge): PositionedEdge => edge.edgeIndex === undefined ? edge : authored.get(edge.edgeIndex) ?? edge
  return {
    shares(a, b, end) {
      if (end === 'end' ? a.target !== b.target : a.source !== b.source) return false
      const ra = resolve(a), rb = resolve(b)
      return ra === rb || mayMerge(ra, rb, end)
    },
  }
}

const recorded = new WeakMap<readonly PositionedEdge[], { size: number; assignment: TerminalAssignment }>()

/** The assignment recorded for `edges`, assigned on first read. Every layout
 * consumer of one roster reads this one decision. */
export function terminalAssignment(edges: readonly PositionedEdge[]): TerminalAssignment {
  const entry = recorded.get(edges)
  if (entry && entry.size === edges.length) return entry.assignment
  const assignment = assignTerminals(edges)
  recorded.set(edges, { size: edges.length, assignment })
  return assignment
}
