// A caption still crossed by a foreign shaft once routes are final moves along
// its own route to a clear seat, and never onto another caption or a terminal.

import { expect, test } from 'bun:test'
import { layoutMermaidWithReceipt, measureQuality } from '../agent/index.ts'
import { reseatConflictedLabels } from '../layout/passes/label-reseat.ts'
import { measureLabelConflicts } from '../layout/label-conflicts.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { PositionedEdge, PositionedNode } from '../types.ts'

const style = resolveRenderStyle({})
const node = (id: string, x: number, y: number): PositionedNode => ({ id, label: id, shape: 'rectangle', x, y, width: 40, height: 40 })
const edge = (source: string, target: string, points: [number, number][], extra: Partial<PositionedEdge> = {}): PositionedEdge =>
  ({ source, target, style: 'solid', hasArrowStart: false, hasArrowEnd: true, points: points.map(([x, y]) => ({ x, y })), ...extra }) as PositionedEdge

// Duplicate thick and plain arrivals run a sibling shaft through one caption's
// first seat; once routes are final it must find a clear seat on its own route.
const CROWDED = `flowchart BT
  N0(["validate input"])
  N1[/"warnings"/]
  N2[(ok)]
  N3(["same word ok"])
  N4[/"a longer label goes here"/]
  N0 -->|validate input| N1
  N0 ===>|warnings| N2
  N0 ---> N2
  N1 ----> N2
  N1 -->|a longer label goes here| N3
  N2 ===>|x| N3
  N2 ---> N3
  N2 ----> N4
  N3 --> N4
  N3 ===>|retry| N0
  N3 --->|validate input| N0
  N4 ----> N0`

test('a crossed caption moves to a clear seat on its own route', () => {
  const { layout } = layoutMermaidWithReceipt(CROWDED)
  expect(measureQuality(layout).labelConflicts).toMatchObject({ total: 0 })
  // The caption a sibling arrival crossed now sits on one of its own runs.
  const { label, path } = layout.edges.find(edge => edge.from === 'N3' && edge.to === 'N0' && edge.label?.text === 'validate input')!
  const onRun = path.slice(1).some(([x, y], index) => {
    const [px, py] = path[index]!
    return (Math.abs(px - x) < 0.5 && Math.abs(label!.x - x) < 0.5 && (label!.y - py) * (label!.y - y) <= 0)
      || (Math.abs(py - y) < 0.5 && Math.abs(label!.y - y) < 0.5 && (label!.x - px) * (label!.x - x) <= 0)
  })
  expect(onRun).toBe(true)
})

// Constructed scene for the seat rule no public input is known to reach.
// A labelled L-shaped route: its first (vertical) run lies beside a foreign
// shaft, its second (horizontal) run is clear.
function scene(extraEdges: PositionedEdge[] = []) {
  const nodes = [node('A', 0, 0), node('B', 400, 300), node('C', 70, 0), node('D', 70, 360)]
  const labelled = edge('A', 'B', [[20, 40], [20, 320], [400, 320]], { label: 'handoff', labelPosition: { x: 20, y: 120 } })
  const foreign = edge('C', 'D', [[28, 40], [28, 360]])
  return { nodes, edges: [labelled, foreign, ...extraEdges] }
}

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
