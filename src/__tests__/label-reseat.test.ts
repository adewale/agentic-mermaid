// A caption still crossed by a foreign shaft once routes are final moves along
// its own route to a clear seat, and never onto another caption or a terminal.

import { expect, test } from 'bun:test'
import { reseatConflictedLabels } from '../layout/passes/label-reseat.ts'
import { measureLabelConflicts } from '../layout/label-conflicts.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { PositionedEdge, PositionedNode } from '../types.ts'

const style = resolveRenderStyle({})
const node = (id: string, x: number, y: number): PositionedNode => ({ id, label: id, shape: 'rectangle', x, y, width: 40, height: 40 })
const edge = (source: string, target: string, points: [number, number][], extra: Partial<PositionedEdge> = {}): PositionedEdge =>
  ({ source, target, style: 'solid', hasArrowStart: false, hasArrowEnd: true, points: points.map(([x, y]) => ({ x, y })), ...extra }) as PositionedEdge

// A labelled L-shaped route: its first (vertical) run lies beside a foreign
// shaft, its second (horizontal) run is clear.
function scene(extraEdges: PositionedEdge[] = []) {
  const nodes = [node('A', 0, 0), node('B', 400, 300), node('C', 70, 0), node('D', 70, 360)]
  const labelled = edge('A', 'B', [[20, 40], [20, 320], [400, 320]], { label: 'handoff', labelPosition: { x: 20, y: 120 } })
  const foreign = edge('C', 'D', [[90, 40], [90, 360]].map(([x, y]) => [x - 62, y]) as [number, number][])
  return { nodes, edges: [labelled, foreign, ...extraEdges] }
}

test('a crossed caption moves to the nearest clear seat on its own route', () => {
  const graph = scene()
  expect(measureLabelConflicts(graph, style).labelEdge).toBeGreaterThan(0)
  reseatConflictedLabels(graph.nodes, graph.edges, style)
  expect(measureLabelConflicts(graph, style).total).toBe(0)
  const seat = graph.edges[0]!.labelPosition!
  // On the clear horizontal run, away from both terminals.
  expect(seat.y).toBe(320)
  expect(seat.x).toBeGreaterThan(20 + 16)
  expect(seat.x).toBeLessThan(400 - 16)
})

test('a caption never trades shaft conflicts for an overlap with another caption', () => {
  // Two shafts cross the current seat; every seat on the clear run lies under
  // another caption (which the labelled route also passes under). Moving would
  // lower the total, but text over text reads worse than a shaft under a pill.
  const second = edge('C', 'D', [[12, 40], [12, 360]])
  const blocker = edge('C', 'B', [[100, 500], [380, 500]], { label: 'x'.repeat(60), labelPosition: { x: 240, y: 320 } })
  const graph = scene([second, blocker])
  const before = measureLabelConflicts(graph, style, new Set([0]))
  expect(before).toMatchObject({ labelLabel: 0, labelEdge: 3 })
  reseatConflictedLabels(graph.nodes, graph.edges, style)
  expect(graph.edges[0]!.labelPosition).toEqual({ x: 20, y: 120 })
  expect(measureLabelConflicts(graph, style).labelLabel).toBe(0)
})
