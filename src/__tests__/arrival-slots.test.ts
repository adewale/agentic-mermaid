// Arrivals meeting at one point of a target that may not share an arrowhead
// are seated along their entry face. The face runs across each arrival's own
// terminal run: an arrival entering along the other axis is never slid along
// a face it does not enter. Tested at the pass: no public layout is known to
// land a vertical and a horizontal arrival on one point (a 3000-graph
// edge-distinctness finder run produced none), but the pass must not assume
// they share an axis.

import { expect, test } from 'bun:test'
import { seatMeetingArrivals } from '../layout/passes/arrival-slots.ts'
import { assignTerminals } from '../layout/terminal-assignment.ts'
import { onShapeOutline } from '../layout-rubric.ts'
import type { PositionedEdge, PositionedNode } from '../types.ts'

test('a vertical and a horizontal arrival at one point keep their own terminal axes', () => {
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
})
