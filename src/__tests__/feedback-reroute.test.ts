// A feedback (or reciprocal) edge that returns past its target can cut through an
// unrelated node sitting BESIDE the target — the return segment crosses that
// node's cross-band. rerouteEdgesThroughNodes' bracket previously only tried
// lanes just outside the WHOLE obstacle band, so when a node also sat on the far
// side (e.g. a disconnected component to the left) both band-edge lanes were
// blocked and the through-node route was kept. The bracket now also tries lanes
// just past EACH obstacle's edges, so the clear GAP lane between the target and
// its neighbour is found. These cases are HARD-clean with the fix and show
// `edgeThroughNode` without it (bracketOverBand can find no clear band-edge lane).
import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { assessLayout, hardViolations } from '../layout-rubric.ts'
import { applyRouteContracts, closeRouteContracts, findRouteHitches } from '../route-contracts.ts'
import { graphEdgeMarkerPaintRegions } from '../graph-connectors.ts'
import { routeCandidateMarkerBlocker, routeCandidateMarkersClear } from '../layout/route-marker-clearance.ts'
import { laneContextFor, repairRectLikeEndpointOverflow, tryStraighten } from '../layout/route-lanes.ts'
import type { Point, PositionedEdge, PositionedNode } from '../types.ts'

const cases: [string, string][] = [
  // Shrunk fuzz repro: N1<->N8 reciprocal (feedback N8->N1) with the unrelated
  // component N2->N0 sitting beside N1, and N3->N5 on the far side.
  ['multi-component reciprocal (BT)', 'flowchart BT\n  N3 ---->|warnings| N5\n  N1 --> N8\n  N2 --->|a longer label goes here| N0\n  N8 -->|errors| N1'],
  ['same, LR', 'flowchart LR\n  N3 ---->|warnings| N5\n  N1 --> N8\n  N2 --->|a longer label goes here| N0\n  N8 -->|errors| N1'],
  ['same, TD', 'flowchart TD\n  N3 ---->|warnings| N5\n  N1 --> N8\n  N2 --->|a longer label goes here| N0\n  N8 -->|errors| N1'],
]

describe('feedback reroute: a feedback that returns past its target clears a node beside it', () => {
  for (const [name, src] of cases) {
    test(`${name}: no edgeThroughNode`, () => {
      const g = parseMermaid(src)
      const p = layoutGraphSync(g)
      expect(p.nodes.map(node => node.id).sort()).toEqual([...g.nodes.keys()].sort())
      expect(p.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(g.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
      const etn = hardViolations(assessLayout(g, p)).filter(v => v.metric === 'edgeThroughNode')
      expect(etn).toEqual([])
    })
  }
})

const markerStyle = { edgeLabelFontSize: 12, edgeLabelFontWeight: 400, lineWidth: 1, edgeBendRadius: 0 }
const marked = (source: string, target: string, points: Point[], start = false, end = true): PositionedEdge => ({ source, target, points, style: 'solid', hasArrowStart: start, hasArrowEnd: end })

for (const direction of ['RL', 'LR', 'BT', 'TB'] as const) {
  test(`optional ${direction} target centering retains separately allocated fan-in marker seats`, () => {
    const graph = parseMermaid(`flowchart ${direction}\nn5[[S]]\nn1[T]\nn7[U]\nn5 --> n1\nn5 --> n1\nn7 --> n1`)
    const nodes: PositionedNode[] = [
      { id: 'n1', label: 'T', x: 328.002, y: 119.55, width: 95.302, height: 36.9, shape: 'rectangle' },
      { id: 'n5', label: 'S', x: 1332.088, y: 164.75, width: 99.748, height: 36.9, shape: 'subroutine' },
      { id: 'n7', label: 'U', x: 1578.33, y: 191.05, width: 99.748, height: 36.9, shape: 'rectangle' },
    ]
    const edges = [
      marked('n5', 'n1', [{ x: 1332.088, y: 170.9 }, { x: 1314.088, y: 170.9 }, { x: 1314.088, y: 133.7 }, { x: 423.304, y: 133.7 }]),
      marked('n5', 'n1', [{ x: 1332.088, y: 178.9 }, { x: 441.304, y: 178.9 }, { x: 441.304, y: 142.3 }, { x: 423.304, y: 142.3 }]),
      marked('n7', 'n1', [{ x: 1578.33, y: 197.2 }, { x: 1566.33, y: 197.2 }, { x: 1566.33, y: 125.7 }, { x: 423.304, y: 125.7 }]),
    ]
    edges.forEach((edge, index) => { edge.edgeIndex = index })
    const reflect = direction === 'LR' || direction === 'TB', transpose = direction === 'BT' || direction === 'TB'
    const project = (point: Point): Point => {
      const x = reflect ? 2000 - point.x : point.x
      return transpose ? { x: point.y, y: x } : { x, y: point.y }
    }
    for (const node of nodes) {
      const origin = project({ x: reflect ? node.x + node.width : node.x, y: node.y })
      node.x = origin.x; node.y = origin.y
      if (transpose) [node.width, node.height] = [node.height, node.width]
    }
    for (const edge of edges) edge.points = edge.points.map(project)
    const boxes = () => edges.map(edge => graphEdgeMarkerPaintRegions(edge, markerStyle)[0]!.bounds!)
    const clear = () => {
      const ink = boxes()
      for (let i = 0; i < ink.length; i++) for (let j = i + 1; j < ink.length; j++) {
        const a = ink[i]!, b = ink[j]!
        expect(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0).toBe(true)
      }
    }
    clear()
    const beforeNodes = structuredClone(nodes), identities = edges.map(edge => [edge.source, edge.target])
    const positioned = { width: 2000, height: 2000, nodes, edges, groups: [] }
    applyRouteContracts(positioned, graph, new Set(), markerStyle, { preserveSelfLoops: true, preserveLabels: true, preserveStraightRoutes: true })
    clear()
    closeRouteContracts(positioned, graph, markerStyle)
    clear()
    expect(nodes).toEqual(beforeNodes)
    expect(edges.map(edge => [edge.source, edge.target])).toEqual(identities)
    expect(hardViolations(assessLayout(graph, positioned))).toEqual([])
    expect(findRouteHitches(positioned, graph, markerStyle)).toEqual([])
  })
}

test('optional straightening preserves a source marker beside an unchanged incoming peer', () => {
  const nodes: PositionedNode[] = [
    { id: 'A', label: 'A', x: 40, y: 0, width: 60, height: 40, shape: 'rectangle' },
    { id: 'B', label: 'B', x: 200, y: 0, width: 60, height: 40, shape: 'rectangle' },
    { id: 'P', label: 'P', x: 0, y: 100, width: 60, height: 40, shape: 'rectangle' },
  ]
  const edge = marked('A', 'B', [{ x: 100, y: 12 }, { x: 200, y: 12 }], true, false)
  const peer = marked('P', 'A', [{ x: 60, y: 120 }, { x: 120, y: 120 }, { x: 120, y: 24.3 }, { x: 100, y: 24.3 }])
  const { ctx } = laneContextFor(nodes, [edge, peer], 'LR', markerStyle)
  tryStraighten(edge, nodes[0]!, nodes[1]!, ctx)
  expect(edge.points[0]!.y).toBe(12)
})

test('marker candidates check their staged opposite head and fresh peer geometry without rechecking inherited issues', () => {
  const loop = marked('S', 'S', [{ x: 100, y: 20 }, { x: 120, y: 20 }, { x: 120, y: 40 }, { x: 100, y: 40 }], true, true)
  const colliding = [{ x: 100, y: 35.7 }, { x: 120, y: 35.7 }, { x: 120, y: 40 }, { x: 100, y: 40 }]
  expect(routeCandidateMarkersClear(loop, colliding, [loop], markerStyle)).toBe(false)
  expect(routeCandidateMarkerBlocker(loop, colliding, [loop], markerStyle)?.id).toContain('opposite-marker:')
  const peer = marked('P', 'S', [{ x: 200, y: 42 }, { x: 100, y: 42 }])
  const safe = [{ x: 100, y: 10 }, { x: 120, y: 10 }, { x: 120, y: 40 }, { x: 100, y: 40 }]
  expect(routeCandidateMarkersClear(loop, safe, [loop, peer], markerStyle)).toBe(true)
  peer.points = [{ x: 200, y: 14.3 }, { x: 100, y: 14.3 }]
  expect(routeCandidateMarkersClear(loop, safe, [loop, peer], markerStyle)).toBe(false)
  expect(routeCandidateMarkersClear(loop, [], [loop], markerStyle)).toBe(false)
})

test('marker candidates retain actual width and orientation instead of comparing anchors alone', () => {
  const edge = marked('A', 'T', [{ x: 200, y: 10 }, { x: 100, y: 10 }])
  const peer = marked('B', 'T', [{ x: 200, y: 26 }, { x: 100, y: 26 }])
  const route = [{ x: 200, y: 20 }, { x: 100, y: 20 }]
  expect(routeCandidateMarkersClear(edge, route, [edge, peer], markerStyle)).toBe(true)
  expect(routeCandidateMarkersClear(edge, route, [edge, peer], { ...markerStyle, lineWidth: 2 })).toBe(false)
  expect(routeCandidateMarkersClear(edge, route, [edge, peer], { ...markerStyle, lineWidth: Number.NaN })).toBe(false)
  const vertical = marked('A', 'T', [{ x: 100, y: 0 }, { x: 100, y: 20 }])
  peer.points = [{ x: 200, y: 24.3 }, { x: 100, y: 24.3 }]
  expect(routeCandidateMarkersClear(vertical, route, [vertical, peer], markerStyle)).toBe(false)
})

test('exact convergent glyph repaint retains all other peer checks and never admits a different pose or paint', () => {
  const edge = marked('A', 'T', [{ x: 200, y: 10 }, { x: 100, y: 10 }])
  const peer = marked('B', 'T', [{ x: 180, y: 20 }, { x: 100, y: 20 }])
  const route = [{ x: 200, y: 20 }, { x: 100, y: 20 }]
  expect(routeCandidateMarkersClear(edge, route, [edge, peer], markerStyle)).toBe(true)
  const third = marked('C', 'T', [{ x: 200, y: 24.3 }, { x: 100, y: 24.3 }])
  expect(routeCandidateMarkersClear(edge, route, [edge, peer, third], markerStyle)).toBe(false)
  peer.inlineStyle = { stroke: '#f00' }
  expect(routeCandidateMarkersClear(edge, route, [edge, peer], markerStyle)).toBe(false)
  peer.inlineStyle = undefined
  peer.target = 'other-node'
  expect(routeCandidateMarkersClear(edge, route, [edge, peer], markerStyle)).toBe(false)
})

test('an unsafe required outline repair retains an honestly invalid contact instead of publishing a false success', () => {
  const graph = parseMermaid('flowchart LR\nA --> B\nP --> B')
  const nodes: PositionedNode[] = [
    { id: 'A', label: '', x: 0, y: 40, width: 20, height: 40, shape: 'rectangle' },
    { id: 'B', label: '', x: 60, y: 20, width: 30, height: 40, shape: 'rectangle' },
    { id: 'P', label: '', x: 40, y: 120, width: 50, height: 40, shape: 'rectangle' },
  ]
  const edge = marked('A', 'B', [{ x: 20, y: 60 }, { x: 40, y: 60 }, { x: 40, y: 80 }, { x: 60, y: 80 }])
  const peer = marked('P', 'B', [{ x: 64.3, y: 120 }, { x: 64.3, y: 60 }])
  const edges = [edge, peer]
  edges.forEach((value, index) => { value.edgeIndex = index })
  const before = structuredClone(edge.points)
  const { ctx } = laneContextFor(nodes, edges, 'LR', markerStyle)
  repairRectLikeEndpointOverflow(edge, nodes[1]!, false, ctx)
  expect(edge.points).toEqual(before)
  expect(edge.routeCertificate?.directLaneClear).not.toBe(true)
  expect(hardViolations(assessLayout(graph, { width: 500, height: 500, nodes, edges, groups: [] })).some(finding => finding.metric === 'offOutlineEndpoints')).toBe(true)
})

test('final tiny-tail collapse cannot rotate a marker into a live peer or certify its retained tangent', () => {
  const graph = parseMermaid('flowchart LR\nA --> B\nP --> B')
  const nodes: PositionedNode[] = [
    { id: 'A', label: '', x: 0, y: 39, width: 20, height: 3, shape: 'rectangle' },
    { id: 'B', label: '', x: 60, y: 20, width: 30, height: 40, shape: 'rectangle' },
    { id: 'P', label: '', x: 0, y: 42.8, width: 20, height: 3, shape: 'rectangle' },
  ]
  const edge = marked('A', 'B', [{ x: 20, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 40.5 }])
  edge.edgeIndex = 0
  edge.routeCertificate = { edgeIndex: 0, routeClass: 'primary-forward', invariant: 'explained-detour', bendCount: 1, directLaneClear: false }
  const peer = marked('P', 'B', [{ x: 20, y: 44.3 }, { x: 60, y: 44.3 }])
  peer.edgeIndex = 1
  const edges = [edge, peer], before = structuredClone(edge.points)
  closeRouteContracts({ nodes, edges, groups: [] }, graph, markerStyle)
  expect(edge.points).toEqual(before)
  expect(edge.routeCertificate.directLaneClear).toBe(false)
  expect(hardViolations(assessLayout(graph, { width: 500, height: 500, nodes, edges, groups: [] })).some(finding => finding.metric === 'endpointApproaches')).toBe(true)
})

test('a marker-blocked straight candidate reports the actual peer attachment instead of an unexplained empty blocker list', () => {
  const nodes: PositionedNode[] = [
    { id: 'A', label: '', x: 40, y: 0, width: 60, height: 40, shape: 'rectangle' },
    { id: 'B', label: '', x: 200, y: 0, width: 60, height: 40, shape: 'rectangle' },
  ]
  const edge = marked('A', 'B', [{ x: 100, y: 4 }, { x: 130, y: 4 }, { x: 130, y: 36 }, { x: 200, y: 36 }], true, true)
  edge.edgeIndex = 0
  const peers: PositionedEdge[] = []
  for (const y of [8, 16, 24, 32]) peers.push(marked(`PA${y}`, 'A', [{ x: 120, y }, { x: 100, y }]))
  for (const y of [8, 16, 24, 32]) peers.push(marked(`PB${y}`, 'B', [{ x: 180, y }, { x: 200, y }]))
  peers.forEach((peer, index) => { peer.edgeIndex = index + 1 })
  const { ctx } = laneContextFor(nodes, [edge, ...peers], 'LR', markerStyle)
  const before = structuredClone(edge.points)
  const result = tryStraighten(edge, nodes[0]!, nodes[1]!, ctx)
  expect(result.applied).toBe(false)
  expect(result.blockers).toContainEqual({ kind: 'port', id: 'peer-marker:PA16->A[2]:end' })
  expect(edge.points).toEqual(before)
})
