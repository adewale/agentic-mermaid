// The one seat rule: a caption sits on its own route, on the admitted seat
// with the fewest conflicts (text over text or a node before a foreign shaft
// under its pill), and every producer and the final settler rank seats by it.

import { expect, test } from 'bun:test'
import { layoutMermaidWithReceipt, measureQuality, verifyMermaid } from '../agent/index.ts'
import { routeSeats, seatLabel } from '../layout/label-seat.ts'
import { measureLabelConflicts } from '../layout/label-conflicts.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { PositionedEdge, PositionedNode } from '../types.ts'

const style = resolveRenderStyle({})
const node = (id: string, x: number, y: number): PositionedNode => ({ id, label: id, shape: 'rectangle', x, y, width: 40, height: 40 })
const edge = (source: string, target: string, points: [number, number][], extra: Partial<PositionedEdge> = {}): PositionedEdge =>
  ({ source, target, style: 'solid', hasArrowStart: false, hasArrowEnd: true, points: points.map(([x, y]) => ({ x, y })), ...extra }) as PositionedEdge

type Path = ReadonlyArray<readonly [number, number]>
const onOwnRun = (label: { x: number; y: number }, path: Path): boolean => path.slice(1).some(([x, y], index) => {
  const [px, py] = path[index]!
  return (Math.abs(px - x) < 0.5 && Math.abs(label.x - x) < 0.5 && (label.y - py) * (label.y - y) <= 0)
    || (Math.abs(py - y) < 0.5 && Math.abs(label.y - y) < 0.5 && (label.x - px) * (label.x - x) <= 0)
})

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
  const { label, path } = layout.edges.find(edge => edge.from === 'N3' && edge.to === 'N0' && edge.label?.text === 'validate input')!
  expect(onOwnRun(label!, path)).toBe(true)
})

// A seat the settler takes to part two pills is ranked by the same rule as
// every other seat. Before the rule was shared, three captions here parted
// onto seats that covered foreign shafts, and a later repair moved only some
// of them back.
test('parting pills never trades a pill overlap for a covered shaft', () => {
  const { layout } = layoutMermaidWithReceipt(`flowchart TD
n0[Node 156-0]
n1{Node 156-1}
n2(Node 156-2)
n3((Node 156-3))
n4[[Node 156-4]]
n5[(Node 156-5)]
n6[Node 156-6]
n7{Node 156-7}
n0 -->|edge 0 xxx| n5
n2 --> n7
n4 --> n0
n6 --> n0
n0 -->|edge 4 xxxxxxx| n7
n2 --> n1
n4 --> n2
n6 --> n5
n0 -->|edge 8 xxxxxxxxxxx| n6
n2 --> n5
n4 --> n7
n6 --> n0
n0 -->|edge 12 xxxxxxxxxxxxxxx| n5
n2 --> n1
n4 --> n5
n6 --> n1
n0 -->|edge 16 xxxxxxxxxxxxxxxxxxx| n5
n2 --> n0`)
  expect(measureQuality(layout).labelConflicts).toMatchObject({ total: 0 })
})

// A shared-trunk caption's own-run seat is ranked by the same rule, so it is
// no longer left on a run another edge shares.
test('a shared-trunk caption is seated off the shared run', () => {
  const { warnings } = verifyMermaid(`flowchart BT
n0[Node 42-0]
n1{Node 42-1}
n2(Node 42-2)
n3((Node 42-3))
n4[[Node 42-4]]
n5[(Node 42-5)]
n6[Node 42-6]
n7{Node 42-7}
n8(Node 42-8)
n9((Node 42-9))
n10[[Node 42-10]]
n8 -->|edge 0 xxx| n1
n8 --> n3
n6 --> n10
n4 --> n10
n8 -->|edge 4 xxxxxxx| n7
n5 --> n9
n10 --> n7
n1 --> n0
n1 -->|edge 8 xxxxxxxxxxx| n9
n6 --> n3
n0 --> n8
n2 --> n6
n6 -->|edge 12 xxxxxxxxxxxxxxx| n3
n6 --> n10
n5 --> n4
n7 --> n2
n1 -->|edge 16 xxxxxxxxxxxxxxxxxxx| n3
n4 --> n3
n3 --> n2
n10 --> n1
n3 -->|edge 20 xxxxxx| n7
n3 --> n9`)
  expect(warnings.filter(warning => warning.code === 'ROUTE_LABEL_ON_SHARED_TRUNK')).toEqual([])
})

// ELK reserves a caption's room beside the route it draws; a cross-hierarchy
// route joined after ELK can leave that room off the produced route. The
// producer seats the caption on its own route, nearest the reserved room.
test('a caption beside a joined cross-hierarchy route is seated on that route', () => {
  const { layout } = layoutMermaidWithReceipt('stateDiagram-v2\n  direction RL\n  state C1 {\n    [*] --> s0\n  }\n  C1 --> s0 : x\n  C1 --> C1 : x')
  const { label, path } = layout.edges.find(edge => edge.from === 'C1' && edge.to === 's0')!
  expect(onOwnRun(label!, path)).toBe(true)
})

// Constructed scene for the cost order no public input is known to reach.
// A labelled L-shaped route: its first (vertical) run lies beside two
// foreign shafts, its second (horizontal) run passes under another caption.
test('a caption never trades shaft conflicts for an overlap with another caption', () => {
  const nodes = [node('A', 0, 0), node('B', 400, 300), node('C', 70, 0), node('D', 70, 360)]
  const labelled = edge('A', 'B', [[20, 40], [20, 320], [400, 320]], { label: 'handoff', labelPosition: { x: 20, y: 120 } })
  const graph = { nodes, edges: [labelled, edge('C', 'D', [[28, 40], [28, 360]]), edge('C', 'D', [[12, 40], [12, 360]]),
    edge('C', 'B', [[100, 500], [380, 500]], { label: 'x'.repeat(60), labelPosition: { x: 240, y: 320 } })] }
  expect(measureLabelConflicts(graph, style, new Set([0]))).toMatchObject({ labelLabel: 0, labelEdge: 3 })
  // Every seat on the horizontal run lies under the long caption: moving
  // there would lower the total, but text over text reads worse.
  const seat = seatLabel(labelled, graph, style, [{ x: 20, y: 120 }, ...routeSeats(labelled.points).filter(point => point.y === 320)], () => true)
  expect(seat).toEqual({ x: 20, y: 120 })
  expect(measureLabelConflicts(graph, style).labelLabel).toBe(0)
})
