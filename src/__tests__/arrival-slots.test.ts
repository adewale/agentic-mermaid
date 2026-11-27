// Arrivals meeting at one point of a target that may not share an arrowhead
// are seated along their entry face. The face runs across each arrival's own
// terminal run: an arrival entering along the other axis is never slid along
// a face it does not enter, and a vertical and a horizontal arrival that may
// not share still leave the point apart. Tested at the pass: no public layout
// is known to land a vertical and a horizontal arrival on one point (a
// 3000-graph edge-distinctness finder run produced none), but the pass must
// not assume they share an axis.

import { expect, test } from 'bun:test'
import { seatMeetingArrivals } from '../layout/passes/arrival-slots.ts'
import { collapseTinyBundledHitches } from '../layout/passes/obstacle-routing.ts'
import { ARRIVAL_SLOT_PITCH, assignTerminals } from '../layout/terminal-assignment.ts'
import { countEdgeCrossings, onShapeOutline } from '../layout-rubric.ts'
import { indistinctOccurrencePairs } from '../layout/route-marker-clearance.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PositionedEdge, PositionedNode } from '../types.ts'

test('a vertical and a horizontal arrival at one point keep their own terminal axes and separate', () => {
  // A circle's 45-degree point is reachable straight down and straight left.
  const node: PositionedNode = { id: 'T', label: 'T', shape: 'circle', x: 0, y: 0, width: 100, height: 100 }
  const point = { x: 50 + 50 * Math.SQRT1_2, y: 50 - 50 * Math.SQRT1_2 }
  const arrival = (source: string, from: { x: number; y: number }, style: PositionedEdge['style']): PositionedEdge =>
    ({ source, target: 'T', style, hasArrowStart: false, hasArrowEnd: true, points: [from, { ...point }] })
  // Different strokes may not share one arrowhead.
  const down = arrival('A', { x: point.x, y: -100 }, 'solid'), left = arrival('B', { x: 200, y: point.y }, 'dotted')
  const edges = [down, left]
  seatMeetingArrivals([node], edges, edges, assignTerminals(edges))
  for (const edge of edges) {
    const points = edge.points
    for (let i = 1; i < points.length; i++) expect(Math.abs(points[i]!.x - points[i - 1]!.x) < 1e-6 || Math.abs(points[i]!.y - points[i - 1]!.y) < 1e-6).toBe(true)
    expect(onShapeOutline(node, points.at(-1)!)).toBe(true)
  }
  expect(down.points.at(-1)!.x).toBeCloseTo(down.points.at(-2)!.x, 6)
  expect(left.points.at(-1)!.y).toBeCloseTo(left.points.at(-2)!.y, 6)
  // Neither shares the other's arrowhead, and their terminal runs do not cross.
  expect(indistinctOccurrencePairs(edges)).toEqual([])
  const [dx, dy] = [down.points.at(-1)!, left.points.at(-1)!]
  expect(Math.hypot(dx.x - dy.x, dx.y - dy.y)).toBeGreaterThan(6)
  expect(countEdgeCrossings(edges)).toBe(0)
})

// An end within the face margin has no room toward that edge of the face:
// the side slides half a slot the other way, not a sliver back past the end.
test('a perpendicular side with no room toward the face edge slides half a slot the other way', () => {
  const node: PositionedNode = { id: 'T', label: 'T', shape: 'rectangle', x: 0, y: 0, width: 100, height: 60 }
  const point = { x: 98, y: 0 }
  // From above, and along the top face from the left; different strokes.
  const down: PositionedEdge = { source: 'A', target: 'T', style: 'solid', hasArrowStart: false, hasArrowEnd: true, points: [{ x: 98, y: -100 }, { ...point }] }
  const along: PositionedEdge = { source: 'B', target: 'T', style: 'dotted', hasArrowStart: false, hasArrowEnd: true, points: [{ x: -100, y: 0 }, { ...point }] }
  const edges = [down, along]
  seatMeetingArrivals([node], edges, edges, assignTerminals(edges))
  expect(down.points.at(-1)).toEqual({ x: 98 - ARRIVAL_SLOT_PITCH / 2, y: 0 })
  expect(indistinctOccurrencePairs(edges)).toEqual([])
})

// Departures that may not share a start terminal take slots by the same plan.
// Two labelled feedback edges painted differently (thick `retry`, thin
// `validate input`) were rebuilt from one point of their source's side and
// ran together until they split to their own lanes.
test('rebuilt departures that may not share one start terminal leave apart', () => {
  const positioned = layoutGraphSync(parseMermaid(readFileSync(join(import.meta.dir, '../../eval/layout-compare/fixtures/coincident-thick-arrivals.mmd'), 'utf8')))
  const feedback = positioned.edges.filter(edge => edge.source === 'N3' && edge.target === 'N0')
  expect(feedback.map(edge => [edge.style, edge.label])).toEqual([['thick', 'retry'], ['solid', 'validate input']])
  const [a, b] = feedback.map(edge => [edge.points[0]!, edge.points[1]!] as const)
  // The two first runs share no point, and in particular no stretch of shaft.
  const along = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) =>
    Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) < 1e-6
      && Math.min(p.x, q.x) - 1e-6 <= r.x && r.x <= Math.max(p.x, q.x) + 1e-6 && Math.min(p.y, q.y) - 1e-6 <= r.y && r.y <= Math.max(p.y, q.y) + 1e-6
  expect([along(a![0], a![1], b![0]), along(a![0], a![1], b![1]), along(b![0], b![1], a![0]), along(b![0], b![1], a![1])]).toEqual([false, false, false, false])
})

// The assignment reads a staged copy as the roster entry with its edge index.
// A roster entry replaced by a new object is judged as it now is, even when
// the roster keeps its length.
test('the terminal assignment judges a replaced roster entry as it now is', () => {
  const arrival = (source: string, edgeIndex: number, style: PositionedEdge['style']): PositionedEdge =>
    ({ source, target: 'T', style, hasArrowStart: false, hasArrowEnd: true, points: [{ x: 0, y: 0 }, { x: 0, y: 10 }], edgeIndex })
  const roster = [arrival('A', 0, 'solid'), arrival('B', 1, 'solid')]
  const terminals = assignTerminals(roster)
  expect(terminals.shares(roster[0]!, roster[1]!, 'end')).toBe(true)
  roster[1] = arrival('B', 1, 'dotted')
  expect(terminals.shares(roster[0]!, { ...roster[1]!, points: [] }, 'end')).toBe(false)
})

// Straightening a bundled member's sub-perceptual hitch slides its arrival by
// the hitch's height along the face (lukilabs/beautiful-mermaid#52: 1.7px off
// the arrowhead its trunk shared). Beside another end of the target it keeps
// the hitch; alone on the face it is straightened.
test.each([true, false])('a tiny bundled hitch beside another arrival is kept (neighbour=%s)', neighbour => {
  const box = (id: string, x: number, y: number): PositionedNode => ({ id, label: id, shape: 'rectangle', x, y, width: 60, height: 40 })
  const nodes = [box('A', 0, 8.3), box('B', 0, 60), box('T', 100, 10)]
  const hitched: PositionedEdge = { source: 'A', target: 'T', style: 'solid', hasArrowStart: false, hasArrowEnd: true, points: [{ x: 60, y: 28.3 }, { x: 80, y: 28.3 }, { x: 80, y: 30 }, { x: 100, y: 30 }] }
  const other: PositionedEdge = { source: 'B', target: 'T', style: 'solid', hasArrowStart: false, hasArrowEnd: true, points: [{ x: 60, y: 80 }, { x: 80, y: 80 }, { x: 80, y: 30 }, { x: 100, y: 30 }] }
  const edges = neighbour ? [hitched, other] : [hitched]
  collapseTinyBundledHitches(nodes, edges, new Set(edges))
  expect(hitched.points).toEqual(neighbour ? [{ x: 60, y: 28.3 }, { x: 80, y: 28.3 }, { x: 80, y: 30 }, { x: 100, y: 30 }] : [{ x: 60, y: 28.3 }, { x: 100, y: 28.3 }])
})
