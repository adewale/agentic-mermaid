import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { bendCount } from '../layout/route-geometry.ts'
import { buildRoutePortHints, layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { applyRouteContracts, auditRouteContracts, classifyRoutes, closeRouteContracts, diamondFacetPorts, directLaneBlockers, findLabelSlot, findRouteHitches, laneContextFor, straightLaneFor, recertifyReroutedEdge, shapePorts, simplifyPolyline, repairLabelsOffOwnRoute, repairLabelsOnSharedTrunks, separateEdgeLabelPills } from '../route-contracts.ts'
import { assessLayout, countEdgeCrossings, countOpposingRouteOverlaps, countParallelRouteOverlaps, hardViolations, measureRubricMetrics, onShapeOutline, segmentThroughShape } from '../layout-rubric.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { layoutMermaid, parseRegisteredMermaid as agentParse, verifyMermaid } from '../agent/index.ts'
import type { AnyPort, Point, PositionedEdge, PositionedGraph, PositionedGroup, PositionedNode } from '../types.ts'
import { EDGE_FORMS, renderEdgeLine } from './helpers/edge-vocabulary.ts'
import { gen } from '../../eval/overlap-audit/generators.ts'
import { renderMermaidSVG, renderMermaidSVGWithReceipt } from '../index.ts'
import { labelRect } from '../route-contracts.ts'
import { resolveRenderStyle } from '../styles.ts'
import { graphEdgeMarkerPaintRegions, graphEdgePathProjection } from '../graph-connectors.ts'
import { formatSvgNumericAttribute } from '../shared/svg-number.ts'
import { measureLabelConflicts } from '../layout/label-conflicts.ts'
import { createTextMeasurementExecution, withTextMeasurementExecution } from '../text-measurement-profile.ts'
import { connector, shape } from '../scene/marks.ts'
import { certifyScenePaint } from '../scene/paint-certification.ts'
import { rerouteEdgesThroughNodes } from '../layout/passes/obstacle-routing.ts'
import { alignLabeledSourcePort, alignPortLanes } from '../layout/passes/port-lanes.ts'
import { trimOccludedShapeEndpoint } from '../shape-clipping.ts'
import { labelSeatPaintContext } from '../layout/graph-paint-support.ts'
import { decodedSvgAttributeValue, scanSvgStartTags } from '../svg-structure.ts'

describe('outward exact endpoint approaches', () => {
  it.each((['LR', 'RL', 'TD', 'BT'] as const).flatMap(direction => [false, true].map(labelled => [direction, labelled] as const)))('keeps feedback approaches outward through optional alignment in %s layouts (labels: %s)', (direction, labelled) => {
    const source = `flowchart ${direction}\nN0[n0]\nN1[n1]\nN2([n2])\nN3((n3))\nN2 -->${labelled ? '|forward|' : ''} N1\nN1 <==>${labelled ? '|back and forward|' : ''} N2\nN0 --> N2\nN2 --> N3\nN0 --> N2`
    const graph = parseMermaid(source), positioned = layoutGraphSync(graph)
    expect(positioned.certification?.status).toBe('passed')
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.style, edge.hasArrowStart, edge.hasArrowEnd])).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.style, edge.hasArrowStart, edge.hasArrowEnd]))
    expect(hardViolations(assessLayout(graph, positioned))).toEqual([])
    expect(auditRouteContracts(positioned, graph)).toEqual([])
    expect(countOpposingRouteOverlaps(positioned.edges)).toBe(0)
    expect(verifyMermaid(source).ok).toBe(true)
    expect(renderMermaidSVG(source)).toContain('<svg')
  })
  const source = 'flowchart LR\nsubgraph S\nA\nend\nA o-- kept label --o B'
  const rotate = (point: Point, turns: number): Point => {
    let { x, y } = point
    for (let i = 0; i < turns; i++) [x, y] = [500 - y, x]
    return { x, y }
  }
  const rotateNode = (node: PositionedNode, turns: number): PositionedNode => {
    const a = rotate(node, turns), b = rotate({ x: node.x + node.width, y: node.y + node.height }, turns)
    return { ...node, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
  }
  for (const turns of [0, 1, 2, 3]) for (const reversed of [false, true]) {
    it(`trims a hidden multi-segment ${reversed ? 'target' : 'source'} prefix at rotation ${turns}`, () => {
      const graph = parseMermaid(source), authored = graph.edges[0]!
      const nodes: PositionedNode[] = [
        { ...graph.nodes.get('A')!, x: 100, y: 100, width: 100, height: 100 },
        { ...graph.nodes.get('B')!, x: 300, y: 100, width: 40, height: 40 },
      ].map(node => rotateNode(node, turns))
      const points = [[200, 150], [180, 150], [180, 120], [180, 60], [320, 60], [320, 100]].map(([x, y]) => rotate({ x: x!, y: y! }, turns))
      const expected = [[180, 100], [180, 60], [320, 60], [320, 100]].map(([x, y]) => rotate({ x: x!, y: y! }, turns))
      const edge: PositionedEdge = { ...authored, id: 'authored-edge', edgeIndex: 0, points,
        labelPosition: rotate({ x: 250, y: 60 }, turns) }
      if (reversed) {
        ;[edge.source, edge.target] = [edge.target, edge.source]
        points.reverse(); expected.reverse()
        ;[graph.edges[0]!.source, graph.edges[0]!.target] = [graph.edges[0]!.target, graph.edges[0]!.source]
      }
      const before = { source: edge.source, target: edge.target, id: edge.id, label: edge.label,
        hasArrowStart: edge.hasArrowStart, hasArrowEnd: edge.hasArrowEnd, startMarker: edge.startMarker, endMarker: edge.endMarker }
      applyRouteContracts({ nodes, edges: [edge], groups: [] }, graph, new Set(), resolveRenderStyle())
      expect(edge.points).toEqual(expected)
      expect({ source: edge.source, target: edge.target, id: edge.id, label: edge.label,
        hasArrowStart: edge.hasArrowStart, hasArrowEnd: edge.hasArrowEnd, startMarker: edge.startMarker, endMarker: edge.endMarker }).toEqual(before)
      expect(edge.edgeIndex).toBe(0)
      expect(edge.labelPosition).toEqual(rotate({ x: 250, y: 60 }, turns))
      const endpoint = reversed ? edge.points.at(-1)! : edge.points[0]!
      const adjacent = reversed ? edge.points.at(-2)! : edge.points[1]!
      const node = nodes[0]!
      // Independent rectangle half-plane: the first visible shaft points out
      // of the actual face; a coordinate on the opposite face is insufficient.
      const dx = adjacent.x - endpoint.x, dy = adjacent.y - endpoint.y
      expect(endpoint.x === node.x && dx < 0 || endpoint.x === node.x + node.width && dx > 0 ||
        endpoint.y === node.y && dy < 0 || endpoint.y === node.y + node.height && dy > 0).toBe(true)
      expect(assessLayout(graph, { nodes, edges: [edge], groups: [], width: 500, height: 500 }).metrics.endpointApproaches).toBe(0)
    })
  }

  it.each(['source', 'target'] as const)('rejects a residual tangent %s instead of certifying its boundary coordinate', endpoint => {
    const graph = parseMermaid('flowchart LR\nA --> B')
    const nodes: PositionedNode[] = [
      { ...graph.nodes.get('A')!, x: 0, y: 0, width: 100, height: 100 },
      { ...graph.nodes.get('B')!, x: 200, y: 0, width: 100, height: 100 },
    ]
    const edge: PositionedEdge = { ...graph.edges[0]!, edgeIndex: 0, points: endpoint === 'source'
      ? [{ x: 50, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]
      : [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 250, y: 0 }] }
    const result = assessLayout(graph, { nodes, edges: [edge], groups: [], width: 400, height: 200 })
    expect(result.metrics.offOutlineEndpoints).toBe(0)
    expect(result.metrics.endpointApproaches).toBeGreaterThan(0)
    expect(hardViolations(result).some(failure => failure.metric === 'endpointApproaches')).toBe(true)
  })

  it('preserves a valid exterior self-loop and its return', () => {
    const graph = parseMermaid('flowchart LR\nA --> A'), nodes: PositionedNode[] = [
      { ...graph.nodes.get('A')!, x: 100, y: 100, width: 100, height: 100 },
    ]
    const edge: PositionedEdge = { ...graph.edges[0]!, edgeIndex: 0,
      points: [{ x: 200, y: 140 }, { x: 240, y: 140 }, { x: 240, y: 160 }, { x: 200, y: 160 }] }
    const points = structuredClone(edge.points)
    edge.points = trimOccludedShapeEndpoint(edge.points, nodes[0]!, true)
    edge.points = trimOccludedShapeEndpoint(edge.points, nodes[0]!, false)
    expect(edge.points).toEqual(points)
    const result = assessLayout(graph, { nodes, edges: [edge], groups: [], width: 300, height: 300 })
    expect(result.metrics.endpointApproaches).toBe(0)
  })

  it('feedback shortening retains a smooth source normal instead of replacing its exterior stub with a tangent', () => {
    const source = 'flowchart LR\nA[ok]\nB[ok]\nC[ok]\nD[warnings]\nE([process the input])\nA-->B\nB-->C\nA-->D\nC-->E\nB-->|yes|C\nE-->|no|A'
    const graph = parseMermaid(source), positioned = layoutGraphSync(graph)
    const edge = positioned.edges.find(edge => edge.source === 'E' && edge.target === 'A')!
    const owner = positioned.nodes.find(node => node.id === 'E')!
    const p = edge.points[0]!, q = edge.points.find(point => point.x !== p.x || point.y !== p.y)!
    // Independent capsule normal: use its circular cap center or straight
    // body's centerline, rather than the production approach predicate.
    const cx = owner.x + owner.width / 2, cy = owner.y + owner.height / 2
    const core = (owner.width - owner.height) / 2
    const capX = Math.max(cx - core, Math.min(cx + core, p.x))
    expect((p.x - capX) * (q.x - p.x) + (p.y - cy) * (q.y - p.y)).toBeGreaterThan(0)
    expect(edge.label).toBe('no')
    expect(edge.edgeIndex).toBe(5)
    expect(edge.hasArrowEnd).toBe(true)
    expect(hardViolations(assessLayout(graph, positioned))).toEqual([])
  })
})


it('keeps route clearance live when trusted label measurement moves an obstacle', () => {
  const graph = parseMermaid('flowchart TD\nA[start]\nB[end]\nC[obstacle]\nA-->|yes|B\nB-->|retry|A\nA-->B\nC-->B')
  const nodes: PositionedNode[] = [
    { id: 'A', label: 'A', shape: 'rectangle', x: 20, y: 40, width: 80, height: 40 },
    { id: 'B', label: 'B', shape: 'rectangle', x: 80, y: 360, width: 80, height: 40 },
    { id: 'C', label: 'C', shape: 'rectangle', x: 0, y: 200, width: 80, height: 40 },
    ...Array.from({ length: 48 }, (_, j) => ({ id: `extra${j}`, label: 'extra', shape: 'rectangle' as const,
      x: -512 + j * 24, y: 100 + j % 7 * 35, width: 12 + j % 4 * 13, height: 20 + j % 5 * 11 })),
  ]
  const routes = [
    [[40, 80], [40, 140], [100, 140], [100, 360]],
    [[100, 340], [100, 280], [-60, 280], [-60, 80]],
    [[40, 80], [40, 140], [100, 140], [100, 360]],
    [[160, 240], [160, 300], [100, 300], [100, 360]],
  ]
  const edges = graph.edges.map((edge, i) => ({ ...edge, edgeIndex: i, points: routes[i]!.map(([x, y]) => ({ x: x!, y: y! })),
    ...(edge.label ? { labelPosition: { x: i === 1 ? -60 : 100, y: 220 } } : {}) }))
  const obstacle = nodes[11]!
  const execution = createTextMeasurementExecution({ id: 'test:live-route-obstacle', version: '1.0.0', measure: () => {
    obstacle.x = 40
    obstacle.y = 200
    return 24
  } }, 'Inter')
  withTextMeasurementExecution(execution, () => applyRouteContracts({ nodes, edges, groups: [] }, graph, new Set(), resolveRenderStyle()))
  expect([obstacle.x, obstacle.y]).toEqual([40, 200])
  const route = edges[3]!.points
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!, b = route[i]!
    const verticalConflict = a.x === b.x && a.x > obstacle.x - 4 && a.x < obstacle.x + obstacle.width + 4 &&
      Math.min(Math.max(a.y, b.y), obstacle.y + obstacle.height + 4) > Math.max(Math.min(a.y, b.y), obstacle.y - 4)
    const horizontalConflict = a.y === b.y && a.y > obstacle.y - 4 && a.y < obstacle.y + obstacle.height + 4 &&
      Math.min(Math.max(a.x, b.x), obstacle.x + obstacle.width + 4) > Math.max(Math.min(a.x, b.x), obstacle.x - 4)
    expect(verticalConflict || horizontalConflict).toBe(false)
  }
})

it('keeps later fan-out repairs clear of a peer route moved earlier in the same pass', () => {
  // Reduced from actual post-solver mesh geometry. The unrelated first repair
  // probes the fan-out routes before either sibling changes its channel.
  const graph = parseMermaid('flowchart TD\nU-->V\nA-->B\nA-->C')
  const node = (id: string, x: number, y: number, width = 60): PositionedNode =>
    ({ id, label: id, shape: 'rectangle', x, y, width, height: 37 })
  const nodes = [node('A', 743, 851), node('U', 195, 476), node('V', 367, 712),
    node('B', 809, 1032, 64), node('C', 901, 1032, 64)]
  const routes = [
    [[247, 513], [247, 537], [375, 537], [375, 712]],
    [[787, 888], [787, 912], [841, 912], [841, 1032]],
    [[795, 888], [795, 906], [933, 906], [933, 1032]],
  ]
  const edges: PositionedEdge[] = graph.edges.map((edge, edgeIndex) => ({ ...edge, edgeIndex,
    points: routes[edgeIndex]!.map(([x, y]) => ({ x: x!, y: y! })) }))
  const style = resolveRenderStyle()
  applyRouteContracts({ nodes, edges, groups: [] }, graph, new Set(), style,
    { preserveSelfLoops: true, preserveLabels: true, preserveStraightRoutes: true })
  const later = edges[2]!, start = later.points[0]!, turn = later.points[1]!
  expect(turn.y - start.y).toBeGreaterThan(16)
  // Re-prove the returned first leg in a fresh borrowed context: it must not
  // share a channel with the earlier sibling's newly settled vertical leg.
  const { ctx } = laneContextFor(nodes, edges, 'TD', style)
  expect(directLaneBlockers(later, start.x, start.y + 8, turn.y - 8, ctx)).toEqual([])
  expect(edges.map(edge => [edge.source, edge.target])).toEqual([['U', 'V'], ['A', 'B'], ['A', 'C']])
})

describe('route proposal crossing consistency', () => {
  it.each([
    ...[0.02425, 0.035, 0.3].flatMap(intrusion => ['rectangle', 'subroutine', 'fr-rect', 'subproc', 'lin-rect', 'div-rect', 'win-pane'].flatMap(shape => ['route proposal', 'final safety net'].map(phase => ({ intrusion, phase, shape, side: 'left' })))),
    ...[0.1, 0.386].flatMap(intrusion => ['cylinder', 'cyl'].flatMap(shape => ['left', 'right'].flatMap(side => ['route proposal', 'final safety net'].map(phase => ({ intrusion, phase, shape, side }))))),
  ])('repairs an unrelated $shape $side intrusion in $phase at $intrusion pixels', ({ intrusion, phase, shape: cardShape, side }) => {
    const node = (id: string, x: number, y: number, width: number, height: number): PositionedNode =>
      ({ id, label: id, shape: 'rectangle', x, y, width, height })
    const nodes = [node('A', 0, 0, 20, 20), node('B', 400, 100, 20, 20),
      node('C', 200 - intrusion, 40, 20, 20), node('D', -20, 60, 20, 20),
      node('E', 198, 60, 1, 20), node('F', 201, 60, 1, 20), node('G', 500, 60, 20, 20)]
    const cardDeclaration = cardShape === 'rectangle' ? 'C' : cardShape === 'subroutine' ? 'C[[C]]' : cardShape === 'cylinder' ? 'C[(C)]' : `C@{ shape: ${cardShape}, label: "C" }`
    const graph = parseMermaid(`flowchart ${side === 'right' ? 'RL' : 'LR'}\nA-->B\nD-->E\nF-->G\n${cardDeclaration}`)
    const parsedCard = graph.nodes.get('C')!
    nodes[2]!.shape = parsedCard.shape
    if (parsedCard.semanticShape) nodes[2]!.semanticShape = parsedCard.semanticShape
    // The two neighboring shafts leave a narrow clear channel. The existing
    // route uses it but enters C's real fill; a safe Z adds one legal crossing.
    const paths = [
      [[20, 10], [200, 10], [200, 110], [400, 110]],
      [[0, 70], [198, 70]], [[202, 70], [500, 70]],
    ]
    if (side === 'right') for (const node of nodes) node.x = 400 - node.x - node.width
    const edges: PositionedEdge[] = graph.edges.map((edge, index) => ({ ...edge, edgeIndex: index,
      points: paths[index]!.map(([x, y]) => ({ x: side === 'right' ? 400 - x! : x!, y: y! })) }))
    const edge = edges[0]!, card = nodes[2]!, contacts = [edge.points[0], edge.points.at(-1)]
    // Restate the cylinder's actual body and caps independently of routing.
    // The rectangular decorations retain their complete opaque fill.
    const finalPaint = () => certifyScenePaint({ family: 'flowchart', width: 550, height: 150,
      transparent: false, colors: { bg: '#fff', fg: '#111' }, parts: [
        connector({ id: 'A->B', role: 'edge', lineStyle: 'solid', endpoints: { from: 'A', to: 'B' },
          geometry: { kind: 'polyline', points: edge.points }, paint: { stroke: '#111', strokeWidth: '1' } }),
        shape({ id: 'C', role: 'node', geometry: card.shape === 'cylinder' ? { kind: 'compound', children: [
          { kind: 'rect', x: card.x, y: card.y + 7, width: card.width, height: card.height - 14 },
          { kind: 'ellipse', cx: card.x + card.width / 2, cy: card.y + 7, rx: card.width / 2, ry: 7 },
          { kind: 'ellipse', cx: card.x + card.width / 2, cy: card.y + card.height - 7, rx: card.width / 2, ry: 7 },
        ] } : cardShape === 'subroutine' ? { kind: 'compound', children: [
          { kind: 'rect', x: card.x, y: card.y, width: card.width, height: card.height },
          { kind: 'line', x1: card.x + 8, y1: card.y, x2: card.x + 8, y2: card.y + card.height },
          { kind: 'line', x1: card.x + card.width - 8, y1: card.y, x2: card.x + card.width - 8, y2: card.y + card.height },
        ] } : { kind: 'rect', x: card.x, y: card.y, width: card.width, height: card.height }, paint: { fill: '#fff' } }),
      ] })
    expect(finalPaint().issues).toContainEqual(expect.objectContaining({ code: 'CONNECTOR_CARD_CROSSING', id: 'A->B', by: 'C' }))
    expect(countEdgeCrossings(edges)).toBe(0)
    if (phase === 'route proposal') applyRouteContracts({ nodes, edges, groups: [] }, graph, new Set(), resolveRenderStyle())
    else rerouteEdgesThroughNodes(nodes, edges, graph)
    expect(finalPaint().status).toBe('passed')
    expect([edge.points[0], edge.points.at(-1)]).toEqual(contacts)
    expect(edges.map(value => [value.source, value.target])).toEqual([['A', 'B'], ['D', 'E'], ['F', 'G']])
    expect(countEdgeCrossings(edges)).toBeGreaterThan(0)
  })

  it.each([0.1, 0.386].flatMap(intrusion => ['left', 'right'].flatMap(side => ['horizontal', 'vertical'].flatMap(axis => ([undefined, 'cyl'] as const).map(semanticShape => ({ intrusion, side, axis, semanticShape }))))))('detects a $axis classic cylinder core shaft at its $side side ($intrusion px, $semanticShape)', ({ intrusion, side, axis, semanticShape }) => {
    const graph = parseMermaid('flowchart LR\nA-->B')
    const card: PositionedNode = { id: 'C', label: 'C', shape: 'cylinder', semanticShape, x: 100, y: 100, width: 40, height: 40 }
    const x = side === 'left' ? 100 + intrusion : 140 - intrusion
    const points = axis === 'vertical' ? [{ x, y: 110 }, { x, y: 130 }]
      : [{ x: side === 'left' ? 90 : 150, y: 120 }, { x, y: 120 }]
    const edge: PositionedEdge = { ...graph.edges[0]!, edgeIndex: 0, points }
    expect(segmentThroughShape(points[0]!, points[1]!, card)).toBe(true)
    expect(auditRouteContracts({ nodes: [card], edges: [edge], groups: [] }, graph)).toContainEqual(
      expect.objectContaining({ code: 'ROUTE_STALE_AFTER_NODE_MOVE', node: 'C' }))
  })

  it.each([
    ...[
    { name: 'left body boundary', points: [{ x: 100, y: 110 }, { x: 100, y: 130 }] },
    { name: 'right body boundary', points: [{ x: 140, y: 110 }, { x: 140, y: 130 }] },
    { name: 'fractional-width right body boundary', width: 100.1, points: [{ x: 200.1, y: 110 }, { x: 200.1, y: 130 }] },
    { name: 'left horizontal boundary', points: [{ x: 90, y: 120 }, { x: 100, y: 120 }] },
    { name: 'right horizontal boundary', points: [{ x: 150, y: 120 }, { x: 140, y: 120 }] },
    { name: 'empty top cap corner', points: [{ x: 100.1, y: 100.1 }, { x: 100.2, y: 100.1 }] },
    { name: 'empty bottom cap corner', points: [{ x: 139.9, y: 139.9 }, { x: 139.8, y: 139.9 }] },
  ].flatMap(control => ([undefined, 'cyl'] as const).map(semanticShape => ({ width: 40, ...control, semanticShape }))),
  ])('retains $name admission for $semanticShape', ({ points, semanticShape, width }) => {
    const graph = parseMermaid('flowchart LR\nA-->B')
    const card: PositionedNode = { id: 'C', label: 'C', shape: 'cylinder', semanticShape, x: 100, y: 100, width, height: 40 }
    const edge: PositionedEdge = { ...graph.edges[0]!, edgeIndex: 0, points }
    expect(segmentThroughShape(points[0]!, points[1]!, card)).toBe(false)
    expect(auditRouteContracts({ nodes: [card], edges: [edge], groups: [] }, graph).some(
      finding => finding.code === 'ROUTE_STALE_AFTER_NODE_MOVE' && finding.node === 'C')).toBe(false)
  })

  it.each(['LR', 'TB', 'BT'] as const)('uses live group headers in %s lane prediction, production and hitch closure', direction => {
    const horizontal = direction === 'LR', ancestor = direction === 'BT'
    const graph = parseMermaid(ancestor ? 'flowchart BT\nsubgraph G\nA\nC\nend\nA-->B' : `flowchart ${direction}\nA-->B\nsubgraph G\nC\nend`)
    const node = (id: string, x: number, y: number): PositionedNode => ({ id, label: id, shape: 'rectangle', x, y, width: 20, height: 20 })
    const source = horizontal ? node('A', 0, 100) : node('A', 110, ancestor ? 150 : 0)
    const target = horizontal ? node('B', 300, 100) : node('B', 110, ancestor ? 0 : 300)
    const child = horizontal ? node('C', 120, 150) : node('C', 140, 150)
    const group: PositionedGroup = { id: 'G', label: 'G', x: 100, y: 100, width: 80, height: ancestor ? 120 : 80, headerHeight: 28, children: [], nodeIds: ancestor ? ['A', 'C'] : ['C'] }
    const pairs = horizontal ? [[20, 110], [80, 110], [80, 90], [280, 90], [280, 110], [300, 110]]
      : ancestor ? [[120, 150], [120, 140], [90, 140], [90, 30], [120, 30], [120, 20]]
        : [[120, 20], [120, 80], [90, 80], [90, 280], [120, 280], [120, 300]]
    const edge: PositionedEdge = { ...graph.edges[0]!, edgeIndex: 0, points: pairs.map(([x, y]) => ({ x: x!, y: y! })) }
    const nodes = [source, target, child], groups = [group], edges = [edge], style = resolveRenderStyle()
    const positioned = { nodes, groups, edges }, original = structuredClone(edge.points)
    const { ctx, axis } = laneContextFor(nodes, edges, direction, style, groups)
    const lane = horizontal ? 110 : 120, high = ancestor ? 150 : 300
    const blocked = () => directLaneBlockers(edge, lane, 20, high, ctx, axis)
    expect(blocked()).toContainEqual({ kind: 'group-header', id: 'G' })
    expect(straightLaneFor(edge, source, target, ctx, axis)).toBeNull()
    // Exact exterior contact and a lane on the header boundary stay legal.
    expect(directLaneBlockers(edge, horizontal ? group.y : group.x, 20, high, ctx, axis)).toEqual([])
    expect(directLaneBlockers(edge, lane, 80, 100, ctx, axis)).toEqual([])
    if (!ancestor) {
      const dx = horizontal ? 0 : 300, dy = horizontal ? 100 : 0
      group.x += dx; group.y += dy; child.x += dx; child.y += dy
      expect(straightLaneFor(edge, source, target, ctx, axis)).toBe(lane)
      group.x -= dx; group.y -= dy; child.x -= dx; child.y -= dy
      expect(straightLaneFor(edge, source, target, ctx, axis)).toBeNull()
    }
    group.headerHeight = 0
    expect(blocked()).toEqual([])
    group.headerHeight = 28; group.concurrencyRegion = true
    expect(blocked()).toEqual([])
    delete group.concurrencyRegion
    // A headerless concurrency parent cannot exempt a nested child's band.
    groups.splice(0, 1, { id: 'Parent', label: 'Parent', x: 0, y: 0, width: 500, height: 400, headerHeight: 100, concurrencyRegion: true, children: [group] })
    expect(blocked()).toContainEqual({ kind: 'group-header', id: 'G' })
    groups.splice(0, 1, group)
    delete group.headerHeight
    expect(blocked()).toContainEqual({ kind: 'group-header', id: 'G' })
    group.headerHeight = 28
    applyRouteContracts(positioned, graph, new Set(), style)
    closeRouteContracts(positioned, graph, style)
    expect(edge.points).toEqual(original)
    expect(findRouteHitches(positioned, graph, style)).toEqual([])
    expect([edge.source, edge.target, edge.hasArrowStart, edge.hasArrowEnd, edge.endMarker]).toEqual(['A', 'B', false, true, 'arrow'])
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1]!, b = edge.points[i]!
      const enters = Math.max(a.x, b.x) > 100 && Math.min(a.x, b.x) < 180
        && Math.max(a.y, b.y) > 100 && Math.min(a.y, b.y) < 128
      expect(enters).toBe(false)
    }
  })

  it('keeps settled reciprocal labels as obstacles in the final closure and its auditor', () => {
    const graph = parseMermaid('flowchart RL\nA --> B\nB -->|feedback| A')
    const nodes: PositionedNode[] = [
      { id: 'A', label: 'A', shape: 'rectangle', x: 400, y: 180, width: 120, height: 60 },
      { id: 'B', label: 'B', shape: 'rectangle', x: 100, y: 180, width: 120, height: 60 },
    ]
    const edges: PositionedEdge[] = [
      { ...graph.edges[0]!, edgeIndex: 0, points: [{ x: 400, y: 190 }, { x: 380, y: 190 }, { x: 380, y: 160 }, { x: 240, y: 160 }, { x: 240, y: 195 }, { x: 220, y: 195 }],
        routeCertificate: { edgeIndex: 0, routeClass: 'primary-forward', invariant: 'explained-detour', bendCount: 4, directLaneClear: false } },
      { ...graph.edges[1]!, edgeIndex: 1, points: [{ x: 220, y: 220 }, { x: 400, y: 220 }], labelPosition: { x: 310, y: 220 },
        routeCertificate: { edgeIndex: 1, routeClass: 'feedback', invariant: 'straight', bendCount: 0, directLaneClear: true } },
    ]
    const positioned = { nodes, edges, groups: [] }, style = resolveRenderStyle()
    expect(measureLabelConflicts(positioned, style).total).toBe(0)
    const label = structuredClone(edges[1]!.labelPosition)
    closeRouteContracts(positioned, graph, style)
    expect(edges[1]!.labelPosition).toEqual(label)
    expect(measureLabelConflicts(positioned, style).total).toBe(0)
    expect(findRouteHitches(positioned, graph, style)).toEqual([])
  })
  it.each([false, true])('does not add a crossing when the other route is subdivided=%s', subdivided => {
    const node = (id: string, x: number, y: number, width: number, height: number): PositionedNode =>
      ({ id, label: id, shape: 'rectangle', x, y, width, height })
    const nodes = [node('A', 0, 0, 20, 100), node('B', 200, 0, 20, 100), node('C', 140, 10, 20, 20), node('D', 140, 70, 20, 20)]
    const edge = (source: string, target: string, points: Point[], edgeIndex: number): PositionedEdge =>
      ({ source, target, points, edgeIndex, style: 'solid', hasArrowStart: false, hasArrowEnd: true })
    const edges = [
      edge('A', 'B', [{ x: 20, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 90 }, { x: 200, y: 90 }], 0),
      edge('C', 'D', [{ x: 150, y: 30 }, ...(subdivided ? [{ x: 150, y: 50 }] : []), { x: 150, y: 70 }], 1),
    ]
    expect(countEdgeCrossings(edges)).toBe(0)
    applyRouteContracts({ nodes, edges, groups: [] }, parseMermaid('flowchart LR\nA-->B\nC-->D'), new Set(), resolveRenderStyle())
    expect(countEdgeCrossings(edges)).toBe(0)
    expect(edges.map(e => [e.source, e.target])).toEqual([['A', 'B'], ['C', 'D']])
  })
})

describe('colliding duplicate labels', () => {
  it.each([4, 5, 13, 29])('keeps both authored labels visible when neither can clear alone: case %s', index => {
    const source = gen.flowchart!(index), graph = parseMermaid(source), positioned = layoutGraphSync(graph)
    const labels = positioned.edges.filter(edge => edge.label)
    expect(labels.map(edge => edge.label)).toEqual(graph.edges.filter(edge => edge.label).map(edge => edge.label))
    expect(() => renderMermaidSVG(source)).not.toThrow()
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i]!, b = labels[j]!
      if (a.source !== b.source || a.target !== b.target) continue
      const ra = labelRect(a, resolveRenderStyle())!, rb = labelRect(b, resolveRenderStyle())!
      // These fixtures paint four-pixel halos beyond the measured pills.
      const width = Math.min(ra.x + ra.w + 4, rb.x + rb.w + 4) - Math.max(ra.x - 4, rb.x - 4)
      const height = Math.min(ra.y + ra.h + 4, rb.y + rb.h + 4) - Math.max(ra.y - 4, rb.y - 4)
      expect(width > 0.5 && height > 0.5).toBe(false)
    }
  })
})

describe('label candidate endpoint clearance', () => {
  it.each(['off-route', 'shared-trunk', 'marker'] as const)('keeps nested group headers clear during %s label repair', operation => {
    const edge: PositionedEdge = { source: 'A', target: 'B', style: 'solid', hasArrowStart: false,
      hasArrowEnd: operation === 'marker', label: 'handoff',
      labelPosition: operation === 'off-route' ? { x: 100, y: 250 } : { x: 200, y: operation === 'marker' ? 143 : 85 },
      points: [{ x: 0, y: 20 }, { x: 200, y: 20 }, { x: 200, y: 150 }] }
    const foreign: PositionedEdge = { source: 'C', target: 'D', style: 'solid', hasArrowStart: false, hasArrowEnd: false,
      points: [{ x: 200, y: 60 }, { x: 200, y: 110 }] }
    const header: PositionedGroup = { id: 'Inner', label: 'Protected title', x: 0, y: 0, width: 240, height: 200, headerHeight: 40, children: [] }
    const positioned = { nodes: [], edges: operation === 'shared-trunk' ? [edge, foreign] : [edge],
      groups: [{ id: 'Outer', label: '', x: -50, y: -50, width: 340, height: 300, headerHeight: 0, children: [header] }] }
    const graph = parseMermaid('flowchart TD\nA -->|handoff| B\nC --> D'), style = resolveRenderStyle()
    const before = structuredClone(edge)
    if (operation === 'off-route') repairLabelsOffOwnRoute(positioned, graph, style)
    else if (operation === 'shared-trunk') repairLabelsOnSharedTrunks(positioned, graph, style)
    else separateEdgeLabelPills(positioned, graph, style, { preserveRouteClearance: true })
    expect(edge.labelPosition).not.toEqual(before.labelPosition)
    const pill = labelRect(edge, style)!, halo = 4
    expect(pill.x - halo < header.x + header.width && pill.x + pill.w + halo > header.x
      && pill.y - halo < header.y + header.headerHeight! && pill.y + pill.h + halo > header.y).toBe(false)
    expect(edge.points).toEqual(before.points)
    expect([edge.source, edge.target, edge.label]).toEqual(['A', 'B', 'handoff'])
  })

  it.each(['BT', 'TD'])('keeps duplicate terminal occurrences visible after shared-trunk label repair in %s', direction => {
    const source = [`flowchart ${direction}`, 'A[(Node 2-3)]', 'B{Node 2-5}', 'C(Node 2-0)', 'D((Node 2-7))',
      'A -->|edge 4 xxxxxxx| B', 'D -->|another long label xxxxxxxxxxxxx| B', 'A --> C', 'B --> C', 'A --> B', 'D --> B'].join('\n')
    const rendered = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'elk', fallback: 'none' } })
    const tags = scanSvgStartTags(rendered.svg).map(tag => ({ name: tag.name, attrs: Object.fromEntries(tag.attributes.map(attr => [attr.name, attr.value])) }))
    const connectors = tags.filter(tag => tag.attrs.class?.split(/\s+/).includes('edge'))
    expect(connectors.map(tag => [tag.attrs['data-from'], tag.attrs['data-to']])).toEqual([
      ['A', 'B'], ['D', 'B'], ['A', 'C'], ['B', 'C'], ['A', 'B'], ['D', 'B'],
    ])
    expect(new Set(connectors.map(tag => tag.attrs['data-id'])).size).toBe(6)
    for (const tag of connectors) {
      expect(tag.attrs['data-arrow-end']).toBe('true')
      expect(tag.attrs['marker-end']).toMatch(/^url\(#.+\)$/)
    }
    expect(tags.filter(tag => tag.attrs.class === 'edge-label').map(tag => tag.attrs['data-label'])).toEqual(['edge 4 xxxxxxx', 'another long label xxxxxxxxxxxxx'])
    expect(rendered.receipt.layoutCertification?.issues.filter(issue => issue.code === 'MARKER_OCCLUDED')).toEqual([])
    // An impossible private slot may retain the original shared-trunk label;
    // preserving the arrows does not establish full private-label ownership.
    expect(rendered.receipt.layoutCertification?.status).not.toBe('failed')
  })

  it('keeps an off-route label when both nearest return slots overlap its own target', () => {
    const edge: PositionedEdge = { source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: false,
      label: 'long terminal label', labelPosition: { x: 280, y: 0 }, points: [{ x: 200, y: 100 }, { x: 280, y: 100 }] }
    const nodes: PositionedNode[] = [{ id: 'B', label: 'B', shape: 'rectangle', x: 280, y: 80, width: 80, height: 40 }]
    const before = structuredClone(edge)
    repairLabelsOffOwnRoute({ nodes, edges: [edge], groups: [] }, parseMermaid('flowchart LR\nA-->|long terminal label|B'), resolveRenderStyle())
    expect(edge).toEqual(before)
  })

  it('keeps marker reservations live when later trusted label measurement replaces a peer route', () => {
    const edge = (label: string, y: number): PositionedEdge => ({ source: `${label}-from`, target: `${label}-to`,
      style: 'solid', hasArrowStart: false, hasArrowEnd: false, label, labelPosition: { x: 75, y: y - 100 },
      points: [{ x: -25, y }, { x: 175, y }] })
    const first = edge('first', 110), second = edge('second', 210)
    const protectedEdge: PositionedEdge = { source: 'protected-from', target: 'protected-to', style: 'solid',
      hasArrowStart: false, hasArrowEnd: true, points: [{ x: 500, y: 170 }, { x: 500, y: 210 }] }
    const style = resolveRenderStyle()
    let moved = false, pill!: NonNullable<ReturnType<typeof labelRect>>
    const execution = createTextMeasurementExecution({ id: 'test:live-label-marker', version: '1.0.0', measure: ({ text }) => {
      if (text.includes('second')) { moved = true; protectedEdge.points = [{ x: 75, y: 170 }, { x: 75, y: 210 }] }
      return 24
    } }, 'Inter')
    withTextMeasurementExecution(execution, () => {
      repairLabelsOffOwnRoute({ nodes: [], edges: [first, second, protectedEdge], groups: [] }, parseMermaid('flowchart LR\nA-->B'), style)
      pill = labelRect(second, style)!
    })
    const marker = graphEdgeMarkerPaintRegions(protectedEdge, style)[0]!.bounds!
    expect(moved).toBe(true)
    expect(pill.x - 4 < marker.x1 && pill.x + pill.w + 4 > marker.x0 && pill.y - 4 < marker.y1 && pill.y + pill.h + 4 > marker.y0).toBe(false)
    expect(second.labelPosition!.y).toBe(210)
  })

  it('preserves clear foreign shafts while moving a label away from a terminal marker', () => {
    const nodes: PositionedNode[] = [
      { id: 'A', label: 'A', shape: 'rectangle', x: 0, y: 0, width: 80, height: 40 },
      { id: 'C', label: 'C', shape: 'rectangle', x: 0, y: 200, width: 80, height: 40 },
      { id: 'B', label: 'B', shape: 'rectangle', x: 180, y: 280, width: 80, height: 40 },
    ]
    const labeled: PositionedEdge = { source: 'A', target: 'C', style: 'solid', hasArrowStart: false, hasArrowEnd: true,
      label: 'handoff', labelPosition: { x: 40, y: 181 }, points: [{ x: 40, y: 40 }, { x: 40, y: 200 }] }
    const foreign: PositionedEdge = { source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: true,
      points: [{ x: 80, y: 20 }, { x: 220, y: 20 }, { x: 220, y: 120 }, { x: -40, y: 120 }, { x: -40, y: 240 }, { x: 220, y: 240 }, { x: 220, y: 280 }] }
    const positioned = { nodes, groups: [], edges: [labeled, foreign] }, style = resolveRenderStyle()
    const marker = graphEdgeMarkerPaintRegions(labeled, style)[0]!.bounds!
    const coversMarker = (): boolean => {
      const pill = labelRect(labeled, style)!
      return pill.x - 4 < marker.x1 && pill.x + pill.w + 4 > marker.x0 && pill.y - 4 < marker.y1 && pill.y + pill.h + 4 > marker.y0
    }
    expect(coversMarker()).toBe(true)
    expect(measureLabelConflicts(positioned, style).labelEdge).toBe(0)
    separateEdgeLabelPills(positioned, parseMermaid('flowchart TD\nA -->|handoff| C\nA --> B'), style, { preserveRouteClearance: true })
    expect(coversMarker()).toBe(false)
    expect(measureLabelConflicts(positioned, style).total).toBe(0)
    expect(labeled.labelPosition!.x).toBe(40)
  })

  for (const marker of ['arrow', 'circle', 'cross'] as const) for (const endpoint of ['start', 'end'] as const) {
    it.each(['default', 'scaled', 'fixed'] as const)(`${marker} ${endpoint}: preserves neighboring marker ink with %s stroke units`, units => {
      const labeled: PositionedEdge[] = [100, 110].map((y, i) => ({
        id: `label-${i}`, source: `source-${i}`, target: `target-${i}`, style: 'solid', label: `${i ? 'b' : 'a'} label`,
        labelPosition: { x: 150, y }, hasArrowStart: false, hasArrowEnd: false, points: [{ x: 0, y }, { x: 300, y }],
      }))
      // Without the terminal reservation, the second label moves to x=74.3832
      // and its opaque halo covers this real arrow/circle/cross resource.
      const protectedEdge: PositionedEdge = {
        id: 'protected', source: 'from', target: 'to', style: 'solid',
        hasArrowStart: endpoint === 'start', hasArrowEnd: endpoint === 'end', startMarker: marker, endMarker: marker,
        points: endpoint === 'start' ? [{ x: 75, y: 110 }, { x: 75, y: 250 }] : [{ x: 75, y: -30 }, { x: 75, y: 110 }],
        ...(units === 'fixed' ? { inlineStyle: { 'stroke-width': '9', stroke: '#123456' } } : {}),
      }
      const style = { ...resolveRenderStyle(), lineWidth: units === 'scaled' ? 4 : 1 }
      separateEdgeLabelPills({ nodes: [], groups: [], edges: [...labeled, protectedEdge] }, parseMermaid('flowchart LR\nA-->B'), style)
      const protectedInk = graphEdgeMarkerPaintRegions(protectedEdge, style)[0]!.bounds!
      expect(labeled[1]!.labelPosition).not.toEqual({ x: 150, y: 110 })
      for (const edge of labeled) {
        const pill = labelRect(edge, style)!, halo = Math.max(4, style.lineWidth * 2)
        expect(pill.x - halo < protectedInk.x1 && pill.x + pill.w + halo > protectedInk.x0 && pill.y - halo < protectedInk.y1 && pill.y + pill.h + halo > protectedInk.y0).toBe(false)
        // Close parallel carriers have no clear centred seat. Retain contact
        // with the owned shaft while proving the foreign shaft stays visible.
        expect(Math.abs(edge.labelPosition!.y - edge.points[0]!.y)).toBeLessThanOrEqual(pill.h / 2 + halo)
        for (const other of labeled) if (other !== edge) {
          const y = other.points[0]!.y, radius = style.lineWidth / 2
          expect(pill.y + pill.h + halo < y - radius || pill.y - halo > y + radius).toBe(true)
        }
      }
      const offRoute: PositionedEdge = { ...labeled[1]!, labelPosition: { x: 75, y: -100 },
        points: [{ x: -25, y: 110 }, { x: 175, y: 110 }] }
      repairLabelsOffOwnRoute({ nodes: [], groups: [], edges: [offRoute, protectedEdge] }, parseMermaid('flowchart LR\nA-->B'), style)
      const pill = labelRect(offRoute, style)!, halo = Math.max(4, style.lineWidth * 2)
      expect(pill.x - halo < protectedInk.x1 && pill.x + pill.w + halo > protectedInk.x0 && pill.y - halo < protectedInk.y1 && pill.y + pill.h + halo > protectedInk.y0).toBe(false)
      expect(offRoute.labelPosition!.y).toBe(110)
    })
  }
})

/** The MFA/login regression from issue #25 — every dogleg here had a clear direct lane. */
const MFA_SOURCE = `flowchart LR
  A[User] --> B[Login Page]
  B --> C{Valid Credentials?}
  C -- No --> B
  C -- Yes --> D{MFA Enabled?}
  D -- No --> G[Create Session]
  D -- Yes --> E[Enter MFA Code]
  E --> F{Code Valid?}
  F -- No --> E
  F -- Yes --> G`

function layoutEdges(source: string): PositionedEdge[] {
  const graph = parseMermaid(source), positioned = layoutGraphSync(graph)
  expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
  expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
  return positioned.edges
}

function findEdge(edges: PositionedEdge[], from: string, to: string, label?: string): PositionedEdge {
  const e = edges.find(e => e.source === from && e.target === to && (label === undefined || e.label === label))
  if (!e) throw new Error(`edge ${from}->${to} not found`)
  return e
}

function legalPorts(node: PositionedNode): Partial<Record<AnyPort, Point>> {
  return node.shape === 'diamond'
    ? { ...shapePorts(node), ...diamondFacetPorts(node) }
    : shapePorts(node)
}

function expectSourceEndpointAtNamedPort(edge: PositionedEdge, source: PositionedNode): void {
  const port = edge.routeCertificate?.sourcePort
  if (!port) throw new Error(`${edge.source}->${edge.target} emitted from a non-port source endpoint`)
  const expected = legalPorts(source)[port]
  if (!expected) throw new Error(`${edge.source}->${edge.target} reported invalid source port ${port}`)
  const actual = edge.points[0]!
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(0.5)
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(0.5)
}

function expectTargetEndpointAtNamedPort(edge: PositionedEdge, target: PositionedNode): void {
  const port = edge.routeCertificate?.targetPort
  if (!port) throw new Error(`${edge.source}->${edge.target} entered a non-port target endpoint`)
  const expected = legalPorts(target)[port]
  if (!expected) throw new Error(`${edge.source}->${edge.target} reported invalid target port ${port}`)
  const actual = edge.points[edge.points.length - 1]!
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(0.5)
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(0.5)
}

function isStraightHorizontal(e: PositionedEdge): boolean {
  return e.points.length === 2 && Math.abs(e.points[0]!.y - e.points[1]!.y) < 0.01
}

describe('route contracts — MFA/login regression (issue #25 acceptance criterion 1)', () => {
  const edges = layoutEdges(MFA_SOURCE)

  it.each([
    ['A', 'B'],
    ['B', 'C'],
    ['C', 'D'],
    ['D', 'E'],
    ['E', 'F'],
  ])('primary-forward %s -> %s is a straight horizontal lane', (from, to) => {
    const e = findEdge(edges, from, to)
    expect(isStraightHorizontal(e)).toBe(true)
  })

  it('labeled feedback routes around through the outer channel with its label ON the loop', () => {
    // ELK's feedbackEdges routing (issue #25 §10) sends the retry edges
    // around the nodes; the inline label rides the loop as a layout citizen
    // with reserved space (dot's virtual-node doctrine) — never a pill
    // floating beside a lane it does not belong to.
    const positioned = layoutGraphSync(parseMermaid(MFA_SOURCE))
    const nodeMap = new Map(positioned.nodes.map(n => [n.id, n]))
    for (const [from, to] of [['C', 'B'], ['F', 'E']] as const) {
      const back = findEdge(positioned.edges, from, to)
      expect(back.points.length).toBeGreaterThan(2)
      expect(back.routeCertificate?.invariant).toBe('outer-feedback')
      // The loop reaches an outer channel: beyond both endpoint nodes' band.
      const band = Math.max(
        nodeMap.get(from)!.y + nodeMap.get(from)!.height,
        nodeMap.get(to)!.y + nodeMap.get(to)!.height,
      )
      expect(Math.max(...back.points.map(pt => pt.y))).toBeGreaterThan(band)
      // The label sits ON one of its own segments (unambiguous association).
      const lp = back.labelPosition!
      const onOwnRoute = (() => {
        for (let i = 1; i < back.points.length; i++) {
          const a = back.points[i - 1]!, b = back.points[i]!
          const xLo = Math.min(a.x, b.x) - 1, xHi = Math.max(a.x, b.x) + 1
          const yLo = Math.min(a.y, b.y) - 16, yHi = Math.max(a.y, b.y) + 16
          if (lp.x >= xLo && lp.x <= xHi && lp.y >= yLo && lp.y <= yHi) return true
        }
        return false
      })()
      expect(onOwnRoute).toBe(true)
    }
  })

  it('unlabeled reciprocal pairs straighten into two parallel lanes', () => {
    const pair = layoutEdges('flowchart LR\n  A --> B\n  B --> A')
    const fwd = findEdge(pair, 'A', 'B')
    const back = findEdge(pair, 'B', 'A')
    expect(isStraightHorizontal(fwd)).toBe(true)
    expect(isStraightHorizontal(back)).toBe(true)
    expect(back.points[0]!.x).toBeGreaterThan(back.points[1]!.x) // runs against the flow
    expect(Math.abs(back.points[0]!.y - fwd.points[0]!.y)).toBeGreaterThanOrEqual(4)
  })

  it('D --No--> G retains a detour', () => {
    const e = findEdge(edges, 'D', 'G', 'No')
    expect(e.points.length).toBeGreaterThan(2)
  })

  it('no edge contains consecutive duplicate points', () => {
    for (const e of edges) {
      for (let i = 1; i < e.points.length; i++) {
        const a = e.points[i - 1]!, b = e.points[i]!
        expect(Math.abs(a.x - b.x) > 0.01 || Math.abs(a.y - b.y) > 0.01).toBe(true)
      }
    }
  })

  it('straightened diamond endpoints land on the diamond polygon, not the bbox corner', () => {
    // B -> C terminates on C (a diamond). On the straight lane the endpoint must
    // satisfy the diamond edge equation |dx|/halfW + |dy|/halfH ≈ 1.
    const positioned = layoutGraphSync(parseMermaid(MFA_SOURCE))
    const c = positioned.nodes.find(n => n.id === 'C')!
    const e = findEdge(positioned.edges, 'B', 'C')
    const end = e.points[e.points.length - 1]!
    const cx = c.x + c.width / 2
    const cy = c.y + c.height / 2
    const lhs = Math.abs(end.x - cx) / (c.width / 2) + Math.abs(end.y - cy) / (c.height / 2)
    expect(Math.abs(lhs - 1)).toBeLessThan(0.02)
  })

  it('straightened labeled edges carry their label onto the new lane', () => {
    const e = findEdge(edges, 'D', 'E', 'Yes')
    expect(isStraightHorizontal(e)).toBe(true)
    expect(e.labelPosition).toBeDefined()
    // Label sits on the straight segment (same y, x within the segment range).
    expect(Math.abs(e.labelPosition!.y - e.points[0]!.y)).toBeLessThan(0.01)
    expect(e.labelPosition!.x).toBeGreaterThan(e.points[0]!.x)
    expect(e.labelPosition!.x).toBeLessThan(e.points[1]!.x)
  })
})

describe('route contracts — blocked lane (issue #25 acceptance criterion 4)', () => {
  it('a blocker node covering the direct lane prevents straightening and is named in the certificate', () => {
    // X is tall enough to cover every candidate lane between A and B, and the
    // labels keep the fan-out away from the trunk bundler. A -> B must keep
    // its detour and certify exactly why.
    const edges = layoutEdges(`flowchart LR
      A[Start] -- first --> X[Blocker<br>tall<br>taller<br>tallest]
      A -- skip --> B[End]
      X -- onward --> B`)
    const e = findEdge(edges, 'A', 'B')
    expect(e.points.length).toBeGreaterThan(2)
    expect(e.routeCertificate?.invariant).toBe('explained-detour')
    expect(e.routeCertificate?.directLaneClear).toBe(false)
    const blockerIds = (e.routeCertificate?.directLaneBlockedBy ?? []).map(b => b.id)
    expect(blockerIds).toContain('X')
  })
})

describe('route contracts — determinism', () => {
  it('repeated layouts produce byte-identical routes', () => {
    const a = JSON.stringify(layoutEdges(MFA_SOURCE).map(e => e.points))
    const b = JSON.stringify(layoutEdges(MFA_SOURCE).map(e => e.points))
    expect(a).toBe(b)
  })
})

describe('classifyRoutes', () => {
  it('classifies primary, feedback, and self-loop edges by author order', () => {
    const graph = parseMermaid(`flowchart LR
      A --> B
      B --> A
      B --> B
      B --> C`)
    expect(classifyRoutes(graph)).toEqual(['primary-forward', 'feedback', 'self-loop', 'primary-forward'])
  })

  it('a reciprocal pair gives the lane to the author-first edge', () => {
    const graph = parseMermaid('flowchart LR\n  B --> C\n  C --> B')
    expect(classifyRoutes(graph)).toEqual(['primary-forward', 'feedback'])
  })

  it('edges to a subgraph id are container edges', () => {
    const graph = parseMermaid(`flowchart TD
      Start --> Pipeline
      subgraph Pipeline
        Fetch --> Parse
      end`)
    const classes = classifyRoutes(graph)
    expect(classes[0]).toBe('container')
    expect(classes[1]).toBe('primary-forward')
  })

  it('edges spanning subgraph scopes are cross-hierarchy', () => {
    const graph = parseMermaid(`flowchart TD
      subgraph G1
        A
      end
      subgraph G2
        B
      end
      A --> B`)
    expect(classifyRoutes(graph)[0]).toBe('cross-hierarchy')
  })

  it('longer cycles mark only the closing edge as feedback', () => {
    const graph = parseMermaid('flowchart TD\n  A --> B\n  B --> C\n  C --> A')
    expect(classifyRoutes(graph)).toEqual(['primary-forward', 'primary-forward', 'feedback'])
  })
})

describe('emitted route certificate bends', () => {
  it('ignores writer-equivalent arithmetic elbows while keeping real small turns and retained contacts', () => {
    const points = [{ x: 385.978, y: 723.293 }, { x: 273.978, y: 723.293 }, { x: 273.978, y: 723.2930000000001 }, { x: 161.978, y: 723.2930000000001 }]
    const before = structuredClone(points)
    expect(bendCount(points)).toBe(0)
    expect(bendCount(points.map(p => ({ x: p.x + 40, y: p.y + 40 })))).toBe(0)
    expect(bendCount([{ x: 0, y: 0 }, { x: .0001, y: 0 }, { x: .0001, y: .0001 }])).toBe(1)
    expect(points).toEqual(before)
  })
})

describe('simplifyPolyline', () => {
  it('removes consecutive duplicates', () => {
    expect(simplifyPolyline([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0 }, { x: 9, y: 0 }]))
      .toEqual([{ x: 0, y: 0 }, { x: 9, y: 0 }])
  })

  it.each([1, 0.01, 0.001, 0.0001])('removes collinear midpoints but keeps real bends at scale %s', scale => {
    const bent = [{ x: 0, y: 0 }, { x: 4 * scale, y: 0 }, { x: 8 * scale, y: 0 }, { x: 8 * scale, y: 6 * scale }]
    expect(simplifyPolyline(bent)).toEqual([{ x: 0, y: 0 }, { x: 8 * scale, y: 0 }, { x: 8 * scale, y: 6 * scale }])
  })

  it('preserves a distinct final endpoint within the duplicate tolerance', () => {
    expect(simplifyPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10.005, y: 0 }]))
      .toEqual([{ x: 0, y: 0 }, { x: 10.005, y: 0 }])
  })

  it('leaves two-point lines untouched', () => {
    const line = [{ x: 1, y: 2 }, { x: 3, y: 4 }]
    expect(simplifyPolyline(line)).toEqual(line)
  })

  it('keeps genuine small bends (only sub-epsilon noise is removed)', () => {
    const smallBend = [{ x: 0, y: 0 }, { x: 5, y: 2 }, { x: 10, y: 0 }]
    expect(simplifyPolyline(smallBend)).toEqual(smallBend)
    // Points 0.005 apart count as duplicates.
    expect(simplifyPolyline([{ x: 0, y: 0 }, { x: 0.005, y: 0.005 }, { x: 10, y: 0 }]))
      .toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }])
  })

  // Properties over random polylines (small integer coords so collinear runs and
  // duplicates occur often). simplifyPolyline is a pure normalizer, so it has
  // strong invariants: it never grows the line, preserves the endpoints, leaves
  // no removable point behind (idempotent), and emits no consecutive duplicates.
  it('is an idempotent, endpoint-preserving, non-growing normalizer', () => {
    const EPS = 1e-6
    const ptArb = fc.record({ x: fc.integer({ min: -8, max: 8 }), y: fc.integer({ min: -8, max: 8 }) })
    fc.assert(
      fc.property(fc.array(ptArb, { maxLength: 12 }), points => {
        const out = simplifyPolyline(points)
        // never grows
        if (out.length > points.length) return false
        // endpoints preserved (value-equal) when there is anything to preserve
        if (points.length > 0) {
          if (out[0]!.x !== points[0]!.x || out[0]!.y !== points[0]!.y) return false
          const pe = points[points.length - 1]!, oe = out[out.length - 1]!
          if (oe.x !== pe.x || oe.y !== pe.y) return false
        }
        // no consecutive duplicates remain in a real polyline. The one exception
        // is a fully-degenerate collapse: a spike [p, q, p] (start == end) reduces
        // to the 2-point [p, p]. So the invariant is scoped to outputs of length
        // >= 3 (verified: 0 such dups over 20k random inputs).
        if (out.length >= 3) {
          for (let i = 1; i < out.length; i++) {
            if (Math.abs(out[i]!.x - out[i - 1]!.x) < EPS && Math.abs(out[i]!.y - out[i - 1]!.y) < EPS) return false
          }
        }
        // idempotent: a second pass changes nothing
        return JSON.stringify(simplifyPolyline(out)) === JSON.stringify(out)
      }),
      fcParameters({ numRuns: 500 }),
    )
  })
})

describe('certificates', () => {
  it('every positioned edge carries a certificate', () => {
    const positioned = layoutGraphSync(parseMermaid(MFA_SOURCE))
    expect(positioned.edges).toHaveLength(9)
    for (const e of positioned.edges) {
      expect(e.routeCertificate).toBeDefined()
      expect(e.routeCertificate!.edgeIndex).toBeGreaterThanOrEqual(0)
    }
  })

  it('feedback retry edges certify as outer-channel feedback routes (acceptance criterion 2)', () => {
    const positioned = layoutGraphSync(parseMermaid(MFA_SOURCE))
    for (const [from, to] of [['C', 'B'], ['F', 'E']] as const) {
      const e = findEdge(positioned.edges, from, to)
      expect(e.routeCertificate?.routeClass).toBe('feedback')
      // Labeled: no parallel lane can host the pill on-lane, so the route
      // keeps ELK's around-the-nodes loop, certified with the blockers that
      // ruled the parallel lanes out.
      expect(e.routeCertificate?.invariant).toBe('outer-feedback')
      expect(e.routeCertificate?.directLaneClear).toBe(false)
      expect(e.routeCertificate?.directLaneBlockedBy?.length).toBeGreaterThan(0)
    }
  })

  it('a feedback edge whose parallel lanes are all blocked keeps its outer loop and names the blockers', () => {
    // C -> A in a TD chain must route around B; B blocks the span-center lanes
    // but ELK's outer channel is clear, so this one straightens. Block that
    // channel too by flanking B with siblings on both sides.
    const positioned = layoutGraphSync(parseMermaid(`flowchart TD
      A --> L[Left sibling]
      A --> B
      A --> R[Right sibling]
      B --> C
      C --> A`))
    const e = findEdge(positioned.edges, 'C', 'A')
    // The flanking siblings block every parallel lane, so the route keeps its
    // certified loop through the outer channel instead of straightening.
    expect(e.points.length).toBeGreaterThan(2)
    expect(e.routeCertificate).toMatchObject({ routeClass: 'feedback', invariant: 'outer-feedback', directLaneClear: false })
    expect(e.routeCertificate?.directLaneBlockedBy).toContainEqual({ kind: 'span', id: 'C->A' })
  })

  it('straight forward lanes certify as straight (natively or by proof)', () => {
    const positioned = layoutGraphSync(parseMermaid(MFA_SOURCE))
    const e = findEdge(positioned.edges, 'B', 'C')
    expect(e.routeCertificate?.invariant).toBe('straight')
    // With feedback routed around, ELK often produces this lane straight
    // natively — then there is nothing to straighten and no proof is needed.
    if (e.routeCertificate?.straightened) {
      expect(e.routeCertificate?.directLaneClear).toBe(true)
    } else {
      expect(e.routeCertificate?.bendCount).toBe(0)
    }
  })

  it('debug certificates expose dynamic port side, ordered slot, and semantic role', () => {
    const positioned = layoutGraphSync(parseMermaid('flowchart LR\n  A --> B\n  A --> C'))
    const ab = findEdge(positioned.edges, 'A', 'B')
    const ac = findEdge(positioned.edges, 'A', 'C')
    expect(ab.routeCertificate?.sourcePortAssignment).toEqual({
      side: 'E', slotIndex: 0, slotCount: 2, role: 'flow-source',
    })
    expect(ac.routeCertificate?.sourcePortAssignment).toEqual({
      side: 'E', slotIndex: 1, slotCount: 2, role: 'flow-source',
    })
    expect(ab.routeCertificate?.targetPortAssignment).toMatchObject({
      side: 'W', slotIndex: 0, slotCount: 1, role: 'flow-target', port: 'W',
    })
  })

  it('pre-layout port hints apply per independent primary edge, not whole-graph all-or-nothing', () => {
    const graph = parseMermaid('flowchart LR\n  A --> B\n  C --> D\n  D --> D')
    const hints = buildRoutePortHints(graph, new Set())
    expect(hints.byEndpoint.get('0:source')).toMatchObject({ nodeId: 'A', side: 'E' })
    expect(hints.byEndpoint.get('0:target')).toMatchObject({ nodeId: 'B', side: 'W' })
    expect(hints.byEndpoint.has('1:source')).toBe(false)
    expect(hints.relaxations).toContainEqual({ edgeIndex: 2, routeClass: 'self-loop', reason: 'self-loop' })
  })

  it('pre-layout port hints include eligible unlabeled feedback with flipped sides', () => {
    const graph = parseMermaid('flowchart LR\n  A --> B\n  B --> A')
    const hints = buildRoutePortHints(graph, new Set())
    expect(hints.byEndpoint.has('0:source')).toBe(false)
    expect(hints.byEndpoint.get('1:source')).toMatchObject({ nodeId: 'B', side: 'W', routeClass: 'feedback', constraint: 'FIXED_SIDE' })
    expect(hints.byEndpoint.get('1:target')).toMatchObject({ nodeId: 'A', side: 'E', routeClass: 'feedback', constraint: 'FIXED_SIDE' })
    expect(hints.relaxations).toContainEqual({ edgeIndex: 0, routeClass: 'primary-forward', reason: 'unsafe-non-primary-incident' })
    expect(hints.relaxations.some(r => r.edgeIndex === 1)).toBe(false)
  })

  it('pre-layout feedback port hints relax when a labeled reciprocal primary owns the lane', () => {
    const graph = parseMermaid('flowchart LR\n  A -->|go| B\n  B --> A')
    const hints = buildRoutePortHints(graph, new Set())
    expect(hints.byEndpoint.has('1:source')).toBe(false)
    expect(hints.byEndpoint.has('1:target')).toBe(false)
    expect(hints.relaxations).toContainEqual({ edgeIndex: 1, routeClass: 'feedback', reason: 'labeled-reciprocal-primary' })
  })

  it('pre-layout feedback port hints keep duplicate returns fixed-side while preserving deterministic slots', () => {
    const graph = parseMermaid('flowchart LR\n  A --> B\n  B --> A\n  B --> A')
    const hints = buildRoutePortHints(graph, new Set())
    expect(hints.byEndpoint.get('1:source')).toMatchObject({ nodeId: 'B', side: 'W', routeClass: 'feedback', constraint: 'FIXED_SIDE', slotIndex: 0 })
    expect(hints.byEndpoint.get('2:source')).toMatchObject({ nodeId: 'B', side: 'W', routeClass: 'feedback', constraint: 'FIXED_SIDE', slotIndex: 1 })
    expect(hints.byEndpoint.get('1:target')).toMatchObject({ nodeId: 'A', side: 'E', routeClass: 'feedback', constraint: 'FIXED_SIDE', slotIndex: 0 })
    expect(hints.byEndpoint.get('2:target')).toMatchObject({ nodeId: 'A', side: 'E', routeClass: 'feedback', constraint: 'FIXED_SIDE', slotIndex: 1 })
  })

  it('pre-layout port hints upgrade only planner-owned primary duplicate faces to fixed order', () => {
    const graph = parseMermaid('flowchart LR\n  A --> C\n  A --> C\n  B --> C')
    const hints = buildRoutePortHints(graph, new Set())
    expect(hints.byEndpoint.get('0:source')).toMatchObject({ nodeId: 'A', side: 'E', constraint: 'FIXED_ORDER', orderReason: 'primary-duplicate-face', slotIndex: 0 })
    expect(hints.byEndpoint.get('1:source')).toMatchObject({ nodeId: 'A', side: 'E', constraint: 'FIXED_ORDER', orderReason: 'primary-duplicate-face', slotIndex: 1 })
    expect(hints.byEndpoint.get('0:target')).toMatchObject({ nodeId: 'C', side: 'W', constraint: 'FIXED_ORDER', orderReason: 'primary-duplicate-face', slotIndex: 0 })
    expect(hints.byEndpoint.get('1:target')).toMatchObject({ nodeId: 'C', side: 'W', constraint: 'FIXED_ORDER', orderReason: 'primary-duplicate-face', slotIndex: 1 })
    expect(hints.byEndpoint.get('2:target')).toMatchObject({ nodeId: 'C', side: 'W', constraint: 'FIXED_ORDER', orderReason: 'primary-duplicate-face', slotIndex: 2 })
    expect(hints.byEndpoint.get('2:source')).toMatchObject({ nodeId: 'B', side: 'E', constraint: 'FIXED_SIDE', slotIndex: 0 })
  })

  it('pre-layout port hints expose relaxation diagnostics for unsupported route classes', () => {
    const graph = parseMermaid('flowchart TD\n  Start --> Box\n  subgraph Box\n    Work\n  end')
    const hints = buildRoutePortHints(graph, new Set(['Box']))
    expect(hints.byEndpoint.has('0:source')).toBe(false)
    expect(hints.relaxations).toContainEqual({ edgeIndex: 0, routeClass: 'container', reason: 'subgraph-endpoint' })
  })

  it('pre-layout port hints skip nodes inside direction-override subgraphs', () => {
    const graph = parseMermaid('flowchart TD\n  subgraph Inner\n    direction LR\n    A --> B\n  end\n  C --> D')
    const hints = buildRoutePortHints(graph, new Set())
    expect(hints.byEndpoint.has('0:source')).toBe(false)
    expect(hints.byEndpoint.has('0:target')).toBe(false)
    expect(hints.byEndpoint.get('1:source')).toMatchObject({ nodeId: 'C', side: 'S' })
  })

  it('feedback endpoints get flipped-side semantic roles without changing sourcePort/targetPort', () => {
    const positioned = layoutGraphSync(parseMermaid('flowchart LR\n  A --> B\n  B --> A'))
    const fwd = findEdge(positioned.edges, 'A', 'B')
    const back = findEdge(positioned.edges, 'B', 'A')
    expect(fwd.routeCertificate?.sourcePortAssignment).toMatchObject({ side: 'E', role: 'flow-source' })
    expect(fwd.routeCertificate?.targetPortAssignment).toMatchObject({ side: 'W', role: 'flow-target' })
    expect(back.routeCertificate?.sourcePortAssignment).toMatchObject({ side: 'W', role: 'feedback-source' })
    expect(back.routeCertificate?.targetPortAssignment).toMatchObject({ side: 'E', role: 'feedback-target' })
    expect(back.routeCertificate?.sourcePort).toBeUndefined()
    expect(back.routeCertificate?.targetPort).toBeUndefined()
  })
})

describe('ROUTE_HITCH tripwire (issue #25 acceptance criterion 3)', () => {
  it('the default pipeline emits no ROUTE_HITCH for the MFA regression', () => {
    const result = verifyMermaid(MFA_SOURCE)
    expect(result.ok).toBe(true)
    expect(result.layout.edges).toHaveLength(9)
    expect(result.warnings.filter(w => w.code === 'ROUTE_HITCH')).toEqual([])
  })

  it('fires when geometry is mutated after certification (stale-pass detector)', () => {
    const graph = parseMermaid(MFA_SOURCE)
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    const e = findEdge(positioned.edges, 'B', 'C')
    // Simulate a later pass re-introducing a dogleg without recertifying.
    const [a, b] = e.points as [{ x: number; y: number }, { x: number; y: number }]
    e.points = [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: a.y + 10 }, { x: b.x, y: a.y + 10 }]
    const hitches = findRouteHitches(positioned, graph)
    expect(hitches.some(h => h.edge === 'B->C')).toBe(true)
    expect(hitches.find(h => h.edge === 'B->C')!.deviationPx).toBe(10)
  })

  it('validation never mutates the layout it inspects', () => {
    const graph = parseMermaid(MFA_SOURCE)
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    findEdge(positioned.edges, 'B', 'C').points = [
      { x: 100, y: 100 }, { x: 150, y: 100 }, { x: 150, y: 110 }, { x: 200, y: 110 },
    ]
    const before = JSON.stringify(positioned.edges.map(e => e.points))
    findRouteHitches(positioned, graph)
    expect(JSON.stringify(positioned.edges.map(e => e.points))).toBe(before)
  })
})

describe('bundle exemptions belong to constructed routes (#265)', () => {
  it('a caller-provided membership set cannot certify an unrelated dogleg as a bundle', () => {
    const graph = parseMermaid('flowchart LR\nA --> B'), positioned = layoutGraphSync(graph), edge = positioned.edges[0]!
    const [a, b] = edge.points as [Point, Point]
    edge.points = [a, { x: a.x + 16, y: a.y }, { x: a.x + 16, y: a.y + 12 }, { x: b.x - 16, y: a.y + 12 }, { x: b.x - 16, y: b.y }, b]
    applyRouteContracts(positioned, graph, new Set([edge]), resolveRenderStyle())
    expect(edge.points).toHaveLength(2)
    expect(edge.routeCertificate?.invariant).toBe('straight')
  })

  it.each(['LR', 'RL', 'TD', 'BT'] as const)('%s: an editable certificate cannot hide a lone four-bend hitch', direction => {
    const graph = parseMermaid(`flowchart ${direction}\nA[Start] --> B[Done]`)
    const positioned = layoutGraphSync(graph), edge = positioned.edges[0]!
    const a = edge.points[0]!, b = edge.points.at(-1)!
    const horizontal = direction === 'LR' || direction === 'RL'
    const first = horizontal ? a.x + (b.x - a.x) / 3 : a.y + (b.y - a.y) / 3
    const second = horizontal ? a.x + (b.x - a.x) * 2 / 3 : a.y + (b.y - a.y) * 2 / 3
    edge.points = horizontal
      ? [a, { x: first, y: a.y }, { x: first, y: a.y + 12 }, { x: second, y: a.y + 12 }, { x: second, y: b.y }, b]
      : [a, { x: a.x, y: first }, { x: a.x + 12, y: first }, { x: a.x + 12, y: second }, { x: b.x, y: second }, b]
    const { straightened: _straightened, ...saved } = edge.routeCertificate!
    edge.routeCertificate = { ...saved, invariant: 'bundle', bendCount: 4 }
    expect(findRouteHitches(positioned, graph)).toContainEqual(expect.objectContaining({ edge: 'A->B' }))
    const assessment = assessLayout(graph, positioned)
    expect(hardViolations(assessment)).toContainEqual(expect.objectContaining({ metric: 'hitches' }))
    expect(assessment.metrics.totalBends).toBe(4)
    expect(measureRubricMetrics(graph, positioned, ['bends'], resolveRenderStyle(), new Set([edge])).bends).toBe(4)
  })

  it.each([
    ['shared fan-out', 'A --> B\nA --> C'],
    ['shared fan-in', 'A --> C\nB --> C'],
    ['separated parallel lanes', 'A --> B\nA --> B'],
  ])('%s: whole-graph translation preserves justified bends', (_name, body) => {
    const graph = parseMermaid(`flowchart LR\n${body}`), positioned = layoutGraphSync(graph)
    expect(positioned.edges.some(edge => edge.routeCertificate?.invariant === 'bundle')).toBe(true)
    for (const node of positioned.nodes) { node.x += 13; node.y += 17 }
    for (const edge of positioned.edges) for (const point of edge.points) { point.x += 13; point.y += 17 }
    expect(assessLayout(graph, positioned).metrics.totalBends).toBe(0)
    expect(findRouteHitches(positioned, graph)).toEqual([])
  })

  it('a copied bundle certificate cannot grant ownership to a different route', () => {
    const bundle = layoutGraphSync(parseMermaid('flowchart LR\nA --> B\nA --> B'))
    const graph = parseMermaid('flowchart LR\nA --> B'), positioned = layoutGraphSync(graph), edge = positioned.edges[0]!
    const [a, b] = edge.points as [Point, Point]
    edge.points = [a, { x: a.x + 16, y: a.y }, { x: a.x + 16, y: a.y + 12 }, { x: b.x - 16, y: a.y + 12 }, { x: b.x - 16, y: b.y }, b]
    const { straightened: _straightened, ...copied } = bundle.edges[0]!.routeCertificate!
    edge.routeCertificate = { ...copied, invariant: 'bundle', edgeIndex: edge.edgeIndex!, bendCount: 4 }
    expect(findRouteHitches(positioned, graph)).toContainEqual(expect.objectContaining({ edge: 'A->B' }))
  })

  it('reissuing a certificate cannot inherit a bundle exemption after changing its lane', () => {
    const graph = parseMermaid('flowchart LR\nA --> B\nA --> C'), positioned = layoutGraphSync(graph)
    const edge = positioned.edges.find(edge => edge.points.length > 2)!, saved = edge.routeCertificate!
    expect(saved.invariant).toBe('bundle')
    for (let i = 1; i < edge.points.length - 1; i++) edge.points[i]!.x += 6
    expect(assessLayout(graph, positioned).metrics.totalBends).toBeGreaterThan(0)
    recertifyReroutedEdge(edge, saved, positioned.nodes.find(node => node.id === edge.source), positioned.nodes.find(node => node.id === edge.target))
    expect(edge.routeCertificate?.invariant).toBe('explained-detour')
  })
})

describe('route contracts — RL and BT directions (mutation-survivor harvest)', () => {
  it('RL: the forward lane straightens against the reversed axis; labeled feedback loops outside', () => {
    const edges = layoutEdges(`flowchart RL
      A[User] --> B[Login Page]
      B --> C{Valid?}
      C -- No --> B`)
    const e = findEdge(edges, 'B', 'C')
    expect(isStraightHorizontal(e)).toBe(true)
    expect(e.points[0]!.x).toBeGreaterThan(e.points[1]!.x) // forward flow runs right-to-left
    // Horizontal flows loop the labelled feedback edge around the outside
    // (like LR); vertical flows take a straight parallel lane instead (BT below).
    const back = findEdge(edges, 'C', 'B')
    expect({ invariant: back.routeCertificate?.invariant, points: back.points.length }).toEqual({ invariant: 'outer-feedback', points: 4 })
  })

  it('BT: the forward lane straightens as a vertical lane; labeled feedback takes a straight parallel back-lane', () => {
    const edges = layoutEdges(`flowchart BT
      A[User] --> B[Login Page]
      B --> C{Valid?}
      C -- No --> B`)
    const e = findEdge(edges, 'B', 'C')
    expect(e.points.length).toBe(2)
    expect(Math.abs(e.points[0]!.x - e.points[1]!.x)).toBeLessThan(0.01)
    expect(e.points[0]!.y).toBeGreaterThan(e.points[1]!.y) // forward flow runs bottom-to-top
    // Unlike RL, a vertical flow puts the labelled feedback edge on its own
    // straight lane beside the forward edge (as TD does), not around the outside.
    const back = findEdge(edges, 'C', 'B')
    expect({ invariant: back.routeCertificate?.invariant, points: back.points.length }).toEqual({ invariant: 'straight', points: 2 })
    expect(Math.abs(back.points[0]!.x - e.points[0]!.x)).toBeGreaterThan(1) // a distinct lane, not the forward one
    expect(back.points[0]!.y).toBeLessThan(back.points[1]!.y) // feedback runs top-to-bottom
  })
})

describe('route contracts — feedback channel lanes', () => {
  it.each(['TD', 'RL', 'BT', 'LR'].flatMap((direction, turns) =>
    ['clear', 'node', 'crossing'].map(blocker => ({ direction, turns, blocker })),
  ))('identifies the return channel before its farther target stub in $direction with $blocker clearance', ({ direction, turns, blocker }) => {
    const graph = parseMermaid(`flowchart ${direction}\nA --> B\nB --> C\nC -->|return| A${blocker === 'node' ? '\nN' : blocker === 'crossing' ? '\nD --- E' : ''}`)
    const rotate = (point: Point): Point => {
      let { x, y } = point
      for (let i = 0; i < turns; i++) [x, y] = [500 - y, x]
      return { x, y }
    }
    const node = (id: string, x: number, y: number, width = 40, height = 40): PositionedNode => {
      const a = rotate({ x, y }), b = rotate({ x: x + width, y: y + height })
      return { ...graph.nodes.get(id)!, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
    }
    const nodes = [node('A', 300, 0), node('B', 300, 100), node('C', 100, 200)]
    if (blocker === 'node') nodes.push(node('N', 90, 210, 10, 20))
    if (blocker === 'crossing') nodes.push(node('D', 88, 206, 4, 4), node('E', 88, 230, 4, 4))
    const routes = [
      [[320, 40], [320, 100]],
      [[320, 140], [320, 180], [120, 180], [120, 200]],
      [[120, 240], [120, 260], [80, 260], [80, -20], [320, -20], [320, 0]],
      ...(blocker === 'crossing' ? [[[90, 210], [90, 230]]] : []),
    ]
    const edges: PositionedEdge[] = routes.map((points, edgeIndex) => ({ ...graph.edges[edgeIndex]!, edgeIndex,
      points: points.map(([x, y]) => rotate({ x: x!, y: y! })),
      ...(edgeIndex === 2 ? { labelPosition: rotate({ x: 80, y: 100 }) } : {}),
    }))
    const back = edges[2]!, before = structuredClone(back.points)
    const positioned = { nodes, edges, groups: [], width: 600, height: 600 }, style = resolveRenderStyle()
    expect(countEdgeCrossings(edges)).toBe(0)
    applyRouteContracts(positioned, graph, new Set(), style)
    if (blocker === 'clear') {
      // The existing x=80 return lane is retained; only its needless endpoint
      // excursions disappear. The x=320 terminal stub is not that lane.
      expect(back.points).toEqual([[100, 220], [80, 220], [80, 20], [300, 20]].map(([x, y]) => rotate({ x: x!, y: y! })))
    } else if (blocker === 'node') {
      // The shortcut may shorten the clear tail, but cannot cut through N.
      expect(back.points[0]).toEqual(before[0])
      expect(back.points[1]).toEqual(before[1])
    } else {
      // A perpendicular shaft is not a node obstacle: the independent
      // crossing check must reject the otherwise clear shortcut atomically.
      expect(back.points).toEqual(before)
    }
    expect(back.labelPosition).toEqual(rotate({ x: 80, y: 100 }))
    expect([back.source, back.target, back.label, back.hasArrowEnd]).toEqual(['C', 'A', 'return', true])
    expect(countEdgeCrossings(edges)).toBe(0)
    expect(assessLayout(graph, positioned).metrics.endpointApproaches).toBe(0)
    expect(assessLayout(graph, positioned).metrics.edgeThroughNode).toBe(0)
  })

  it.each([
    ...['TD', 'RL', 'BT', 'LR'].flatMap((direction, turns) => ['head', 'tail'].map(side => ({ direction, turns, side, gap: -20, nodeWidth: '0.75', edgeWidth: '1', changed: false, fromStyle: false }))),
    ...[
      { gap: 0, nodeWidth: '8', edgeWidth: '1', changed: false },
      { gap: 0.1, nodeWidth: '0.75', edgeWidth: '1', changed: false },
      { gap: 5, nodeWidth: '20', edgeWidth: '1', changed: false },
      { gap: 5, nodeWidth: '20', edgeWidth: '1', changed: false, fromStyle: true },
      { gap: 30, nodeWidth: 'var(--outline)', edgeWidth: '1', changed: false },
      { gap: 30, nodeWidth: '0.75', edgeWidth: 'var(--shaft)', changed: false },
      { gap: 50, nodeWidth: '20', edgeWidth: '1', changed: true },
    ].map(row => ({ fromStyle: false, ...row, direction: 'TD', turns: 0, side: 'head' })),
  ])('keeps noncontact $side segments clear of the other endpoint in $direction (gap=$gap, node=$nodeWidth, shaft=$edgeWidth, style=$fromStyle)', ({ direction, turns, side, gap, nodeWidth, edgeWidth, changed, fromStyle }) => {
    const tail = side === 'tail'
    const graph = parseMermaid(`flowchart ${direction}\nA --> B\nB --> C\nC -->|return| A${tail ? '\nN\nM' : ''}`)
    const rotate = (point: Point): Point => {
      let { x, y } = point
      for (let i = 0; i < turns; i++) [x, y] = [500 - y, x]
      return { x, y }
    }
    const node = (id: string, x: number, y: number, width = 40, height = 40): PositionedNode => {
      const a = rotate({ x, y }), b = rotate({ x: x + width, y: y + height })
      return { ...graph.nodes.get(id)!, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
    }
    const nodes = tail
      ? [node('A', 300, 220), node('B', 800, 100), node('C', 170, 200, 40, 200), node('N', 110, 295, 10, 10), node('M', 110, 395, 10, 10)]
      : [node('A', 170, 200), node('B', 800, 100), node('C', 300, 180 - gap)]
    if (!fromStyle) nodes[0]!.inlineStyle = { stroke: '#000', 'stroke-width': nodeWidth }
    const points = (tail
      ? [[190, 400], [190, 420], [700, 420], [700, 520], [80, 520], [80, 160], [320, 160], [320, 220]]
      : [[320, 220 - gap], [320, 260], [80, 260], [80, -20], [700, -20], [700, 100], [190, 100], [190, 200]]
    ).map(([x, y]) => rotate({ x: x!, y: y! }))
    const edge: PositionedEdge = { ...graph.edges[2]!, edgeIndex: 2, points, labelPosition: rotate({ x: 80, y: tail ? 200 : 100 }), inlineStyle: { stroke: '#f00', 'stroke-width': edgeWidth } }
    const before = structuredClone(edge)
    // Both rectangles are genuine endpoint bodies. Their open interiors are
    // independently clear before repair, including every nonterminal leg.
    const enters = (route: readonly Point[], body: PositionedNode): boolean => route.slice(1).some((b, index) => {
      const a = route[index]!
      return Math.min(a.x, b.x) < body.x + body.width && Math.max(a.x, b.x) > body.x
        && Math.min(a.y, b.y) < body.y + body.height && Math.max(a.y, b.y) > body.y
    })
    expect(enters(points, nodes[0]!)).toBe(false)
    expect(enters(points, nodes[2]!)).toBe(false)
    const style = resolveRenderStyle()
    if (fromStyle) style.nodeLineWidth = Number(nodeWidth)
    applyRouteContracts({ nodes, edges: [edge], groups: [] }, graph, new Set(), style)
    if (changed) expect(edge.points).not.toEqual(before.points)
    else expect(edge).toMatchObject({ points: before.points, labelPosition: before.labelPosition })
    expect(enters(edge.points, nodes[0]!)).toBe(false)
    expect(enters(edge.points, nodes[2]!)).toBe(false)
    expect([edge.source, edge.target, edge.label, edge.hasArrowEnd]).toEqual(['C', 'A', 'return', true])
  })

  it('TD cycle: C -> A loops through the outer channel and enters A from outside the column', () => {
    const positioned = layoutGraphSync(parseMermaid('flowchart TD\n  A --> B\n  B --> C\n  C --> A'))
    const e = findEdge(positioned.edges, 'C', 'A')
    const a = positioned.nodes.find(n => n.id === 'A')!
    const b = positioned.nodes.find(n => n.id === 'B')!
    if (e.points.length === 2) {
      // Collapsed onto a provably clear parallel back-lane.
      expect(Math.abs(e.points[0]!.x - e.points[1]!.x)).toBeLessThan(0.01)
      const laneX = e.points[0]!.x
      expect(laneX > b.x + b.width + 4 - 0.01 || laneX < b.x - 4 + 0.01).toBe(true)
    } else {
      // Outer-channel loop: certified, clear of B, terminating on A's border.
      expect(e.routeCertificate?.invariant).toBe('outer-feedback')
      const maxX = Math.max(...e.points.map(pt => pt.x))
      expect(maxX).toBeGreaterThan(b.x + b.width)
      const end = e.points[e.points.length - 1]!
      const onBorder = onShapeOutline(a, end)
      expect(onBorder).toBe(true)
    }
  })
})

describe('bundle contract — trunks never pass through nodes', () => {
  function crossesRect(edges: PositionedEdge[], nodes: Array<{ id: string; x: number; y: number; width: number; height: number }>): string[] {
    const hits: string[] = []
    for (const e of edges) {
      for (const n of nodes) {
        if (n.id === e.source || n.id === e.target) continue
        for (let i = 1; i < e.points.length; i++) {
          const a = e.points[i - 1]!, b = e.points[i]!
          const xLo = Math.min(a.x, b.x), xHi = Math.max(a.x, b.x)
          const yLo = Math.min(a.y, b.y), yHi = Math.max(a.y, b.y)
          if (xHi > n.x + 0.5 && xLo < n.x + n.width - 0.5 && yHi > n.y + 0.5 && yLo < n.y + n.height - 0.5) {
            hits.push(`${e.source}->${e.target} through ${n.id}`)
            break
          }
        }
      }
    }
    return hits
  }

  it('an unlabeled fan-out skip-edge no longer routes through the intermediate node', () => {
    const positioned = layoutGraphSync(parseMermaid(`flowchart LR
      A[Start] --> X[Blocker<br>tall<br>taller<br>tallest]
      A --> B[End]
      X --> B`))
    expect(crossesRect(positioned.edges, positioned.nodes)).toEqual([])
    // The skip edge must certify why it cannot be straight.
    const skip = findEdge(positioned.edges, 'A', 'B')
    expect(skip.routeCertificate?.invariant).toBe('explained-detour')
    expect((skip.routeCertificate?.directLaneBlockedBy ?? []).map(b => b.id)).toContain('X')
  })

  it('a clean small unlabeled fan-out uses symmetric emissions, not an accidental shared point', () => {
    const positioned = layoutGraphSync(parseMermaid('flowchart LR\n  A --> B\n  A --> C'))
    const b = findEdge(positioned.edges, 'A', 'B')
    const c = findEdge(positioned.edges, 'A', 'C')
    expect(b.routeCertificate?.invariant).toBe('bundle')
    expect(c.routeCertificate?.invariant).toBe('bundle')
    expect(JSON.stringify(b.points[0])).not.toEqual(JSON.stringify(c.points[0]))
    const a = positioned.nodes.find(n => n.id === 'A')!
    const center = a.y + a.height / 2
    expect(Math.abs(Math.abs(b.points[0]!.y - center) - Math.abs(c.points[0]!.y - center))).toBeLessThanOrEqual(0.75)
    expect(crossesRect(positioned.edges, positioned.nodes)).toEqual([])
  })

  it('a high-degree rectangle fan-out keeps one clean trunk instead of forming a box', () => {
    const positioned = layoutGraphSync(parseMermaid('flowchart TD\n  A --> B\n  A --> C\n  A --> D\n  A --> E'))
    expect(positioned.edges.map(edge => [edge.source, edge.target]).sort()).toEqual([['A', 'B'], ['A', 'C'], ['A', 'D'], ['A', 'E']])
    const starts = positioned.edges.map(e => JSON.stringify(e.points[0]))
    const trunks = positioned.edges.map(e => JSON.stringify(e.points[1]))
    expect(new Set(starts).size).toBe(1)
    expect(new Set(trunks).size).toBe(1)
    expect(crossesRect(positioned.edges, positioned.nodes)).toEqual([])
  })

  it('clear bundled fan-out branches do not keep tiny visual hitches', () => {
    const positioned = layoutGraphSync(parseMermaid(`flowchart LR
  A[main] --> B[develop]
  B --> C[feature/auth]
  B --> D[feature/ui]
  C --> E{PR Review}
  D --> E
  E -->|approved| B
  B --> F[release/1.0]
  F --> G{Tests?}
  G -->|pass| A
  G -->|fail| F`))
    const branch = findEdge(positioned.edges, 'B', 'D')
    expect(branch.routeCertificate?.invariant).toBe('bundle')
    expect(branch.points.length).toBe(2)
    expect(Math.abs(branch.points[0]!.y - branch.points[1]!.y)).toBeLessThanOrEqual(0.75)
  })
})

describe('directLaneBlockers (unit)', () => {
  const axis = { main: 'x', cross: 'y', sign: 1 } as const
  const style = { edgeLabelFontSize: 12, edgeLabelFontWeight: 400 }
  const node = (id: string, x: number, y: number, w: number, h: number) =>
    ({ id, label: id, shape: 'rectangle' as const, x, y, width: w, height: h })
  const edge = (source: string, target: string, points: Array<{ x: number; y: number }>, extra: object = {}): PositionedEdge =>
    ({ source, target, style: 'solid', hasArrowStart: false, hasArrowEnd: true, points, ...extra }) as PositionedEdge
  const probe = edge('A', 'B', [{ x: 0, y: 50 }, { x: 100, y: 50 }])
  const ctx = (over: Partial<{ nodes: unknown[]; edges: unknown[] }> = {}) =>
    ({ nodes: [], edges: [], axis, style, ...over }) as Parameters<typeof directLaneBlockers>[4]

  it('reports every distinct blocker in discovery order for certificate evidence', () => {
    const labeled = { ...probe, label: 'this label cannot fit on the short lane' }
    const other = edge('P', 'Q', [{ x: 20, y: 50 }, { x: 80, y: 50 }], {
      label: 'No', labelPosition: { x: 50, y: 50 },
    })
    expect(directLaneBlockers(labeled, 50, 0, 100, ctx({
      nodes: [node('X', 20, 40, 20, 20), node('Y', 60, 40, 20, 20)],
      edges: [other, { ...other }],
    }))).toEqual([
      { kind: 'node', id: 'X' },
      { kind: 'node', id: 'Y' },
      { kind: 'label', id: 'P->Q' },
      { kind: 'channel', id: 'P->Q' },
      { kind: 'label', id: 'A->B' },
    ])
  })

  it('a node straddling the lane blocks; the same node beyond the 4px clearance does not', () => {
    const blockedBy = (ny: number) =>
      directLaneBlockers(probe, 50, 0, 100, ctx({ nodes: [node('X', 40, ny, 20, 20)] }))
    expect(blockedBy(40)).toEqual([{ kind: 'node', id: 'X' }]) // node spans y 40..60, lane y=50
    expect(blockedBy(53)).toEqual([{ kind: 'node', id: 'X' }]) // top edge at 53: 53 - 4 < 50 still blocks
    expect(blockedBy(55)).toEqual([])                          // top edge at 55: 55 - 4 >= 50 clears
    expect(blockedBy(27)).toEqual([{ kind: 'node', id: 'X' }]) // bottom edge at 47: 47 + 4 > 50 still blocks
    expect(blockedBy(25)).toEqual([])                          // bottom edge at 45: 45 + 4 < 50 clears
  })

  it('a node outside the main-axis range never blocks', () => {
    const blockers = directLaneBlockers(probe, 50, 0, 100, ctx({ nodes: [node('X', 200, 40, 20, 20)] }))
    expect(blockers).toEqual([])
  })

  it("another edge's label blocks the lane within its rendered pill (text + 8px padding) plus clearance", () => {
    const m = measureMultilineText('No', 12, 400)
    const pillHalfH = m.height / 2 + 8
    const pillHalfW = m.width / 2 + 8
    const other = (lx: number, ly: number) =>
      edge('P', 'Q', [{ x: 300, y: 200 }, { x: 320, y: 200 }], { label: 'No', labelPosition: { x: lx, y: ly } })
    const at = (lx: number, ly: number) =>
      directLaneBlockers(probe, 50, 0, 100, ctx({ edges: [other(lx, ly)] }))
    expect(at(50, 50)).toEqual([{ kind: 'label', id: 'P->Q' }])
    // Cross-axis boundary: pill edge just inside / outside the 4px clearance.
    expect(at(50, 50 + pillHalfH + 4 - 0.5)).toEqual([{ kind: 'label', id: 'P->Q' }])
    expect(at(50, 50 + pillHalfH + 4 + 0.5)).toEqual([])
    // Main-axis boundary: pill fully past the lane end plus clearance.
    expect(at(100 + pillHalfW + 4 + 0.5, 50)).toEqual([])
  })

  it('a collinear parallel segment within 4px is a channel conflict; a perpendicular crossing is not', () => {
    const parallel = edge('P', 'Q', [{ x: 20, y: 53 }, { x: 80, y: 53 }])
    expect(directLaneBlockers(probe, 50, 0, 100, ctx({ edges: [parallel] })))
      .toEqual([{ kind: 'channel', id: 'P->Q' }])
    const farParallel = edge('P', 'Q', [{ x: 20, y: 55 }, { x: 80, y: 55 }])
    expect(directLaneBlockers(probe, 50, 0, 100, ctx({ edges: [farParallel] }))).toEqual([])
    const crossing = edge('P', 'Q', [{ x: 50, y: 0 }, { x: 50, y: 100 }])
    expect(directLaneBlockers(probe, 50, 0, 100, ctx({ edges: [crossing] }))).toEqual([])
    const parallelOutsideRange = edge('P', 'Q', [{ x: 150, y: 50 }, { x: 250, y: 50 }])
    expect(directLaneBlockers(probe, 50, 0, 100, ctx({ edges: [parallelOutsideRange] }))).toEqual([])
  })

  it('an edge never blocks its own lane, even via a positional copy (same edgeIndex)', () => {
    const original = edge('A', 'B', [{ x: 0, y: 50 }, { x: 100, y: 50 }], { edgeIndex: 7 })
    const copy = { ...original, points: original.points.map(p => ({ ...p })) }
    expect(directLaneBlockers(copy, 50, 0, 100, ctx({ edges: [original] }))).toEqual([])
  })

  it("the edge's own label needs lane capacity: pill width + 8px clearance", () => {
    const m = measureMultilineText('quite a long edge label', 12, 400)
    const pillW = m.width + 16
    const labeled = edge('A', 'B', [{ x: 0, y: 50 }, { x: 100, y: 50 }], { label: 'quite a long edge label' })
    expect(directLaneBlockers(labeled, 50, 0, pillW + 8 - 1, ctx()))
      .toEqual([{ kind: 'label', id: 'A->B' }])
    expect(directLaneBlockers(labeled, 50, 0, pillW + 8 + 1, ctx())).toEqual([])
  })

  describe('vertical axis (TD): same proofs with main/cross swapped', () => {
    const vAxis = { main: 'y', cross: 'x', sign: 1 } as const
    const vProbe = edge('A', 'B', [{ x: 50, y: 0 }, { x: 50, y: 100 }])
    const vCtx = (over: Partial<{ nodes: unknown[]; edges: unknown[] }> = {}) =>
      ({ nodes: [], edges: [], axis: vAxis, style, ...over }) as Parameters<typeof directLaneBlockers>[4]

    it('node clearance boundaries use width on the cross axis and height on the main axis', () => {
      // Non-square node: w=20 (cross), h=40 (main). Lane x=50 over y 0..100.
      const blockedBy = (nx: number) =>
        directLaneBlockers(vProbe, 50, 0, 100, vCtx({ nodes: [node('X', nx, 30, 20, 40)] }))
      expect(blockedBy(40)).toEqual([{ kind: 'node', id: 'X' }]) // spans x 40..60
      expect(blockedBy(53)).toEqual([{ kind: 'node', id: 'X' }]) // left edge 53 - 4 < 50
      expect(blockedBy(55)).toEqual([])                          // left edge 55 - 4 >= 50
      expect(blockedBy(27)).toEqual([{ kind: 'node', id: 'X' }]) // right edge 47 + 4 > 50
      expect(blockedBy(25)).toEqual([])
      // Main-axis range honors height: node at y 110..150 is past the lane end (100 + 4).
      expect(directLaneBlockers(vProbe, 50, 0, 100, vCtx({ nodes: [node('X', 45, 110, 20, 40)] }))).toEqual([])
      expect(directLaneBlockers(vProbe, 50, 0, 100, vCtx({ nodes: [node('X', 45, 102, 20, 40)] })))
        .toEqual([{ kind: 'node', id: 'X' }])
    })

    it('label pills swap width/height between axes', () => {
      const m = measureMultilineText('No', 12, 400)
      const pillHalfW = m.width / 2 + 8
      const pillHalfH = m.height / 2 + 8
      const other = (lx: number, ly: number) =>
        edge('P', 'Q', [{ x: 300, y: 200 }, { x: 300, y: 220 }], { label: 'No', labelPosition: { x: lx, y: ly } })
      const at = (lx: number, ly: number) =>
        directLaneBlockers(vProbe, 50, 0, 100, vCtx({ edges: [other(lx, ly)] }))
      expect(at(50, 50)).toEqual([{ kind: 'label', id: 'P->Q' }])
      // Cross axis is x: boundary at pill w/2 + 4.
      expect(at(50 + pillHalfW + 4 - 0.5, 50)).toEqual([{ kind: 'label', id: 'P->Q' }])
      expect(at(50 + pillHalfW + 4 + 0.5, 50)).toEqual([])
      // Main axis is y: boundary at pill h/2 + 4 past the lane end.
      expect(at(50, 100 + pillHalfH + 4 + 0.5)).toEqual([])
      expect(at(50, 100 + pillHalfH + 4 - 0.5)).toEqual([{ kind: 'label', id: 'P->Q' }])
    })

    it('channel conflicts are vertical segments here; horizontal crossings are fine', () => {
      const parallel = edge('P', 'Q', [{ x: 53, y: 20 }, { x: 53, y: 80 }])
      expect(directLaneBlockers(vProbe, 50, 0, 100, vCtx({ edges: [parallel] })))
        .toEqual([{ kind: 'channel', id: 'P->Q' }])
      const crossing = edge('P', 'Q', [{ x: 0, y: 50 }, { x: 100, y: 50 }])
      expect(directLaneBlockers(vProbe, 50, 0, 100, vCtx({ edges: [crossing] }))).toEqual([])
    })

    it('own-label capacity uses pill height on a vertical lane', () => {
      const m = measureMultilineText('No', 12, 400)
      const pillH = m.height + 16
      const labeled = edge('A', 'B', [{ x: 50, y: 0 }, { x: 50, y: 100 }], { label: 'No' })
      expect(directLaneBlockers(labeled, 50, 0, pillH + 8 - 1, vCtx()))
        .toEqual([{ kind: 'label', id: 'A->B' }])
      expect(directLaneBlockers(labeled, 50, 0, pillH + 8 + 1, vCtx())).toEqual([])
    })
  })
})

describe('straightenable shape whitelist', () => {
  it('subroutine nodes straighten like rectangles', () => {
    const edges = layoutEdges(`flowchart LR
      A[[User]] --> B[[Login Page]]
      B --> A`)
    expect(isStraightHorizontal(findEdge(edges, 'A', 'B'))).toBe(true)
    expect(isStraightHorizontal(findEdge(edges, 'B', 'A'))).toBe(true)
  })

  it('service nodes (architecture-projected graphs) straighten like rectangles', () => {
    // The flowchart parser never emits 'service'; architecture graphs do, and
    // they route through the same layoutGraphSync. Build the graph directly.
    const graph = parseMermaid('flowchart LR\n  A[Gateway] --> B[Auth]\n  B --> A')
    for (const node of graph.nodes.values()) node.shape = 'service'
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    expect(isStraightHorizontal(findEdge(positioned.edges, 'A', 'B'))).toBe(true)
    expect(isStraightHorizontal(findEdge(positioned.edges, 'B', 'A'))).toBe(true)
  })

  it('non-straightenable shapes (cloud: a curved-path routing envelope) keep their routes and certify unverified-shape', () => {
    // Circles used to be the example here; they now have exact boundary ports
    // (see "circles join the straightenable set…"). Curved v11 path shapes such
    // as cloud still route against a conservative envelope, which carries no
    // attachment proof, so the straightener must leave them alone.
    const edges = layoutEdges(`flowchart LR
      A@{ shape: cloud, label: "User" } --> B@{ shape: cloud, label: "Login" }
      B --> A`)
    const fwd = findEdge(edges, 'A', 'B')
    expect(fwd.routeCertificate).toMatchObject({ invariant: 'unverified-shape' })
    expect(fwd.routeCertificate?.straightened).toBeUndefined()
    expect(fwd.routeCertificate?.sourcePort).toBeUndefined()
  })
})

describe('validation ignores non-staircase routes', () => {
  it('a diagonal post-certification mutation is not reported as a hitch', () => {
    const graph = parseMermaid(MFA_SOURCE)
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    const e = findEdge(positioned.edges, 'B', 'C')
    const [a, b] = e.points as [{ x: number; y: number }, { x: number; y: number }]
    // Diagonal middle segment: not orthogonal routing, so not a "hitch" —
    // it is a different kind of corruption that EDGE rendering would surface.
    e.points = [a, { x: (a.x + b.x) / 2, y: a.y + 15 }, b]
    expect(findRouteHitches(positioned, graph).filter(h => h.edge === 'B->C')).toEqual([])
  })
})

describe('duplicate parallel edges (fast-check counterexample, pinned)', () => {
  const DUP_SOURCE = 'flowchart TD\n  N2 --> N0\n  N1 --> N2\n  N0 --> N1\n  N2 --> N0\n  N0 --> N1'

  it('duplicate edges between one pair never collapse onto a single overlapping path', () => {
    const positioned = layoutGraphSync(parseMermaid(DUP_SOURCE))
    const dups = positioned.edges.filter(e => e.source === 'N2' && e.target === 'N0')
    expect(dups.length).toBe(2)
    expect(JSON.stringify(dups[0]!.points)).not.toBe(JSON.stringify(dups[1]!.points))
  })

  it('no unexplained hitch survives when duplicates unblock each other mid-pass', () => {
    const graph = parseMermaid(DUP_SOURCE)
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    expect(findRouteHitches(positioned, graph)).toEqual([])
  })

  // Issue #62: a hub-centering slide rigidly translated the straight, 2-point
  // duplicate edges that fed the hub, dragging their SOURCE endpoints off the
  // source node's side. Surfaced by the outline oracle in layout-rubric.test.ts.
  //
  // Asserts every edge endpoint lands on its node's rendered outline. The
  // ISSUE_62_REPRO case is the regression guard — it fails on the pre-fix code
  // (the N2->N3 source floats ~32px below N2). The remaining cases are the
  // simplest expressions of the same feature (a multigraph: >1 edge on one
  // directed pair); they passed before the fix too, so they document the
  // contract and guard against future regressions rather than this one.
  const ISSUE_62_REPRO = `flowchart LR
  N0[n0]
  N1[n1]
  N2[n2]
  N3[(n3)]
  N4[n4]
  N4 --> N0
  N0 -- go --> N4
  N2 --> N3
  N2 --> N3
  N4 --> N3`
  const outlineCases: Record<string, string> = {
    // The simplest possible multigraph: two edges, one directed pair.
    'simplest pair — two A-->B edges (LR)': 'flowchart LR\n  A --> B\n  A --> B',
    'simplest pair — two A-->B edges (TD)': 'flowchart TD\n  A --> B\n  A --> B',
    'three parallel A-->B edges (LR)': 'flowchart LR\n  A --> B\n  A --> B\n  A --> B',
    'labeled parallel pair (distinct labels)': 'flowchart LR\n  A -- yes --> B\n  A -- no --> B',
    'duplicate feeder into a shared hub': 'flowchart LR\n  A --> C\n  A --> C\n  B --> C',
    'issue #62 repro (regression guard)': ISSUE_62_REPRO,
  }
  for (const [name, source] of Object.entries(outlineCases)) {
    it(`keeps both endpoints on the node outline — ${name}`, () => {
      const graph = parseMermaid(source)
      const positioned = layoutGraphSync(graph)
      expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
      expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
      const nodeMap = new Map(positioned.nodes.map(n => [n.id, n]))
      for (const e of positioned.edges) {
        for (const [id, pt] of [
          [e.source, e.points[0]!],
          [e.target, e.points[e.points.length - 1]!],
        ] as const) {
          const node = nodeMap.get(id)
          if (!node) continue
          expect({ edge: `${e.source}->${e.target}#${e.edgeIndex}`, anchor: id, on: onShapeOutline(node, pt) })
            .toEqual({ edge: `${e.source}->${e.target}#${e.edgeIndex}`, anchor: id, on: true })
        }
      }
    })
  }

  // The parallel-lane contract (yFiles ParallelEdgeRouter / OGDF Kandinsky):
  // duplicate same-direction edges render as evenly-separated parallel lanes,
  // not a cramped near-overlapping bundle. Pre-enhancement the endpoints sat
  // ~7px apart; the lanes now spread to a readable separation that fits the
  // node side. The minimum here (>= 11px) fails on the pre-enhancement routing.
  const MIN_LANE_SEP = 11
  // Feedback (back-edge) duplicates enter the hub's flow-EXIT face and were
  // owned by neither lane pass, so ELK left them ~6px apart. The face-aware
  // distribution now spreads them too. `src`/`tgt` name the duplicated pair.
  const laneCases: Array<{ name: string; source: string; cross: 'x' | 'y'; count: number; src?: string; tgt?: string }> = [
    { name: 'two A-->B (LR)', source: 'flowchart LR\n  A --> B\n  A --> B', cross: 'y', count: 2 },
    { name: 'three A-->B (LR)', source: 'flowchart LR\n  A --> B\n  A --> B\n  A --> B', cross: 'y', count: 3 },
    { name: 'two A-->B (TD)', source: 'flowchart TD\n  A --> B\n  A --> B', cross: 'x', count: 2 },
    { name: 'feedback pair B-->A (LR)', source: 'flowchart LR\n  A --> B\n  B --> A\n  B --> A', cross: 'y', count: 2, src: 'B', tgt: 'A' },
    { name: 'feedback pair B-->A (TD)', source: 'flowchart TD\n  A --> B\n  B --> A\n  B --> A', cross: 'x', count: 2, src: 'B', tgt: 'A' },
  ]
  for (const { name, source, cross, count, src = 'A', tgt = 'B' } of laneCases) {
    it(`routes duplicate edges as separated parallel lanes — ${name}`, () => {
      const graph = parseMermaid(source)
      const positioned = layoutGraphSync(graph)
      expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
      expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
      const dups = positioned.edges
        .filter(e => e.source === src && e.target === tgt)
        .sort((a, b) => (a.edgeIndex ?? 0) - (b.edgeIndex ?? 0))
      expect(dups.length).toBe(count)
      const srcCross = dups.map(e => e.points[0]![cross])
      const tgtCross = dups.map(e => e.points[e.points.length - 1]![cross])
      for (let i = 1; i < dups.length; i++) {
        expect(Math.abs(srcCross[i]! - srcCross[i - 1]!)).toBeGreaterThanOrEqual(MIN_LANE_SEP)
        expect(Math.abs(tgtCross[i]! - tgtCross[i - 1]!)).toBeGreaterThanOrEqual(MIN_LANE_SEP)
      }
      // Distinct polylines — no two duplicates collapse onto one path.
      const paths = new Set(dups.map(e => JSON.stringify(e.points)))
      expect(paths.size).toBe(count)
    })
  }

  // Mixed fan-in contract: a hub that receives a duplicate pair AND other
  // feeders must distribute the WHOLE entry face, not just the pair. Before the
  // target-centric distribution, the pair-only pass left two defects here:
  //   - silent data loss: when the hub had other feeders the pass bailed and
  //     ELK's overlap stood, so the duplicates rendered as one indistinguishable
  //     line ('duplicate feeder into a shared hub' measured 0px apart);
  //   - crowding/crossing: a third distinct feeder landed inside the separated
  //     duplicate band and crossed through it (issue #62 repro: ~7px + 1 cross).
  // Both assert every incoming endpoint is separated and that entry order
  // matches source order (no crossing). Pure distinct fan-in is excluded — it
  // stays a clean merge via the barycenter pass (issue #26 WS3), asserted last.
  const mixedFanInCases: Array<{ name: string; source: string; hub: string }> = [
    { name: 'duplicate feeder into a shared hub', source: 'flowchart LR\n  A --> C\n  A --> C\n  B --> C', hub: 'C' },
    {
      name: 'issue #62 repro (duplicate pair + distinct feeder)',
      source: ISSUE_62_REPRO,
      hub: 'N3',
    },
  ]
  for (const { name, source, hub } of mixedFanInCases) {
    it(`distributes a mixed fan-in without collapse or crossing — ${name}`, () => {
      const graph = parseMermaid(source)
      const positioned = layoutGraphSync(graph)
      expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
      expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
      const nodeMap = new Map(positioned.nodes.map(n => [n.id, n]))
      const incoming = positioned.edges.filter(e => e.target === hub)
      expect(incoming.length).toBeGreaterThanOrEqual(3)

      // No silent collapse: every pair of entry endpoints is readably apart.
      const ends = incoming.map(e => e.points[e.points.length - 1]!)
      for (let i = 0; i < ends.length; i++) {
        for (let j = i + 1; j < ends.length; j++) {
          expect(Math.hypot(ends[i]!.x - ends[j]!.x, ends[i]!.y - ends[j]!.y))
            .toBeGreaterThanOrEqual(MIN_LANE_SEP)
        }
      }
      // No crossing: order of entry endpoints (top→bottom) matches the order of
      // their sources (top→bottom), with duplicate siblings tie-broken by index.
      const srcCenter = (id: string) => {
        const n = nodeMap.get(id)!
        return n.y + n.height / 2
      }
      const bySource = [...incoming].sort((a, b) =>
        srcCenter(a.source) - srcCenter(b.source) || (a.edgeIndex ?? 0) - (b.edgeIndex ?? 0))
      const byEntry = [...incoming].sort((a, b) =>
        a.points[a.points.length - 1]!.y - b.points[b.points.length - 1]!.y)
      expect(byEntry.map(e => `${e.source}#${e.edgeIndex}`))
        .toEqual(bySource.map(e => `${e.source}#${e.edgeIndex}`))
    })
  }

  it('leaves pure distinct fan-in as a clean merge (issue #26 WS3 untouched)', () => {
    const positioned = layoutGraphSync(parseMermaid('flowchart LR\n  A --> C\n  B --> C\n  D --> C'))
    const ends = positioned.edges.filter(e => e.target === 'C').map(e => e.points[e.points.length - 1]!)
    expect(ends.length).toBe(3)
    // With no duplicate present the distribution stays out; the feeders merge to
    // a single coincident entry port rather than fanning across the hub side.
    const maxSep = Math.max(...ends.flatMap((p, i) => ends.slice(i + 1).map(q => Math.hypot(p.x - q.x, p.y - q.y))))
    expect(maxSep).toBeLessThan(1)
  })

  const mixedDuplicateCases = [
    { name: 'fan-out', source: [
      'flowchart TD',
      '  A["ok"]', '  B["ok"]', '  C["ok"]', '  D["ok"]', '  E{"rendered"}', '  F["ok"]', '  G["ok"]',
      '  A --> B', '  A --> C', '  A --> D', '  A --> E', '  E --> F', '  A --> G', '  E -->|no| F',
    ].join('\n'), from: 'E', to: 'F' },
    { name: 'feedback loop', source: [
      'flowchart TD', 'A["ok"]', 'B{"rendered"}', 'C["ok"]', 'D["ok"]', 'E{"ok"}',
      'A --> B', 'A --> C', 'B --> D', 'C --> E', 'B -->|retry| A', 'B -->|no| D',
    ].join('\n'), from: 'B', to: 'D' },
  ]
  for (const direction of ['TD', 'BT', 'LR', 'RL']) it.each(mixedDuplicateCases)(`separates mixed labeled and unlabeled duplicate lanes before route certification: ${direction} $name`, ({ source, from, to }) => {
    const graph = parseMermaid(source.replace('flowchart TD', `flowchart ${direction}`))
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    const dups = positioned.edges
      .filter(e => e.source === from && e.target === to)
      .sort((a, b) => (a.edgeIndex ?? 0) - (b.edgeIndex ?? 0))
    expect(dups.length).toBe(2)
    expect(JSON.stringify(dups[0]!.points)).not.toBe(JSON.stringify(dups[1]!.points))
    expect(countParallelRouteOverlaps(dups)).toBe(0)
    for (const edge of dups) {
      expect(onShapeOutline(positioned.nodes.find(node => node.id === from)!, edge.points[0]!)).toBe(true)
      expect(onShapeOutline(positioned.nodes.find(node => node.id === to)!, edge.points.at(-1)!)).toBe(true)
    }
    expect(auditRouteContracts(positioned, graph).filter(f => f.code === 'ROUTE_LABEL_ON_SHARED_TRUNK')).toEqual([])
    expect(assessLayout(graph, positioned).metrics.labelConflicts).toBe(0)
    const tags = scanSvgStartTags(renderMermaidSVG(source.replace('flowchart TD', `flowchart ${direction}`), { embedFontImport: false }))
    const labelledShaft = tags.find(tag => tag.name === 'polyline' && decodedSvgAttributeValue(tag, 'data-from') === from && decodedSvgAttributeValue(tag, 'data-to') === to && decodedSvgAttributeValue(tag, 'data-label') === 'no')!
    // Safe placement can leave a private straight lane or a proved detour;
    // neither needs the exemption reserved for a constructed bundle.
    const writtenPoints = decodedSvgAttributeValue(labelledShaft, 'points')!.split(' ')
    expect(dups.find(e => e.label)?.routeCertificate?.invariant).toBe(writtenPoints.length === 2 ? 'straight' : 'explained-detour')
    const owner = tags.findIndex(tag => tag.name === 'g' && decodedSvgAttributeValue(tag, 'class') === 'edge-label' && decodedSvgAttributeValue(tag, 'data-from') === from && decodedSvgAttributeValue(tag, 'data-to') === to)
    expect(owner).toBeGreaterThanOrEqual(0)
    const halo = tags[owner + 1]!
    expect(decodedSvgAttributeValue(halo, 'class')).toBe('edge-label-halo')
    const x = Number(decodedSvgAttributeValue(halo, 'x')), y = Number(decodedSvgAttributeValue(halo, 'y'))
    const right = x + Number(decodedSvgAttributeValue(halo, 'width')), bottom = y + Number(decodedSvgAttributeValue(halo, 'height'))
    const shaft = tags.find(tag => tag.name === 'polyline' && decodedSvgAttributeValue(tag, 'data-from') === from && decodedSvgAttributeValue(tag, 'data-to') === to && decodedSvgAttributeValue(tag, 'data-label') === undefined)!
    const points = decodedSvgAttributeValue(shaft, 'points')!.split(' ').map(point => point.split(',').map(Number))
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1]!, [bx, by] = points[i]!
      const covered = ax === bx
        ? ax! > x && ax! < right && Math.max(ay!, by!) > y && Math.min(ay!, by!) < bottom
        : ay! > y && ay! < bottom && Math.max(ax!, bx!) > x && Math.min(ax!, bx!) < right
      expect(covered).toBe(false)
    }
  })

  it.each(['LR', 'RL'])('a multiline mixed-pair label does not expand into a neighbouring node: %s', direction => {
    const source = `flowchart ${direction}\nA["a"]\nB{"rendered"}\nC["c"]\nD["d"]\nE{"e"}\nA --> B\nA --> C\nB --> D\nB -->|first<br/>second<br/>third| D\nC --> E`
    const positioned = layoutGraphSync(parseMermaid(source))
    const tags = scanSvgStartTags(renderMermaidSVG(source, { embedFontImport: false }))
    const halo = tags.find(tag => decodedSvgAttributeValue(tag, 'class') === 'edge-label-halo')!
    const x = Number(decodedSvgAttributeValue(halo, 'x')), y = Number(decodedSvgAttributeValue(halo, 'y'))
    const right = x + Number(decodedSvgAttributeValue(halo, 'width')), bottom = y + Number(decodedSvgAttributeValue(halo, 'height'))
    const node = positioned.nodes.find(node => node.id === 'E')!
    expect(Math.min(right, node.x + node.width) > Math.max(x, node.x) && Math.min(bottom, node.y + node.height) > Math.max(y, node.y)).toBe(false)
    expect(countParallelRouteOverlaps(positioned.edges)).toBe(0)
  })

  // When a duplicate pair feeds a hub that is cross-axis OFFSET from the source
  // (the lanes bend across the flow), the riser columns must nest so the lanes
  // do not cross mid-path. The earlier staggered-by-index columns put the upper
  // lane's riser nearer, so the lower lane's exit run cut across it. This guards
  // the *path*, not just endpoint order, which the mixed-fan-in test covers.
  const properSegmentsCross = (p: Point[], q: Point[]): boolean => {
    const o = (a: Point, b: Point, c: Point) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
    const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
    for (let i = 0; i < p.length - 1; i++) {
      for (let j = 0; j < q.length - 1; j++) {
        const [a, b, c, d] = [p[i]!, p[i + 1]!, q[j]!, q[j + 1]!]
        if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) continue
        if (o(c, d, a) !== o(c, d, b) && o(a, b, c) !== o(a, b, d)) return true
      }
    }
    return false
  }
  const offsetHubCases: Record<string, { source: string; hub: string }> = {
    'issue #62 repro (N2 above N3)': { source: ISSUE_62_REPRO, hub: 'N3' },
    'shared hub, duplicate above hub': { source: 'flowchart LR\n  A[a] --> C[c]\n  A --> C\n  B[b] --> C', hub: 'C' },
  }
  for (const [name, { source, hub }] of Object.entries(offsetHubCases)) {
    it(`nests offset duplicate lanes without crossing mid-path — ${name}`, () => {
      const graph = parseMermaid(source)
      const positioned = layoutGraphSync(graph)
      expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
      expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
      const incoming = positioned.edges.filter(e => e.target === hub)
      for (let i = 0; i < incoming.length; i++) {
        for (let j = i + 1; j < incoming.length; j++) {
          expect({ pair: `${incoming[i]!.source}#${incoming[i]!.edgeIndex}×${incoming[j]!.source}#${incoming[j]!.edgeIndex}`, cross: properSegmentsCross(incoming[i]!.points, incoming[j]!.points) })
            .toEqual({ pair: `${incoming[i]!.source}#${incoming[i]!.edgeIndex}×${incoming[j]!.source}#${incoming[j]!.edgeIndex}`, cross: false })
        }
      }
    })
  }
})

describe('straightened certificate finality (fast-check counterexample, pinned)', () => {
  it('does not expose straightened on a final detour', () => {
    // Exercise the default candidate's late detour. Preference exploration
    // can select a different candidate with a valid straight route instead.
    const positioned = layoutGraphSync(parseMermaid(`flowchart BT
  N1 -- No --> N4
  N4 -- yes --> N1
  N4 --> N3
  N0 -- on error --> N2
  N0 --> N2
  N4 --> N2
  N2 -- yes --> N0
  N1 -- No --> N2
  N3 -- on error --> N0`), { compareRoutePreferences: false })
    const e = positioned.edges.find(e => e.source === 'N0' && e.target === 'N2' && e.label === undefined)!
    expect(e.points.length).toBeGreaterThan(2)
    expect(e.routeCertificate?.invariant).toBe('explained-detour')
    expect(e.routeCertificate?.straightened).toBeUndefined()
  })
})

describe('findLabelSlot (unit)', () => {
  const axis = { main: 'x', cross: 'y', sign: 1 } as const
  const style = { edgeLabelFontSize: 12, edgeLabelFontWeight: 400 }
  const m = measureMultilineText('No', 12, 400)
  const pillW = m.width + 16
  const mkEdge = (over: object = {}): PositionedEdge =>
    ({ source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: true, points: [], edgeIndex: 0, ...over }) as PositionedEdge
  const ctx = (over: Partial<{ nodes: unknown[]; edges: unknown[] }> = {}) =>
    ({ nodes: [], edges: [], axis, style, ...over }) as Parameters<typeof findLabelSlot>[3]
  const start = { x: 0, y: 50 }
  const end = { x: 400, y: 50 }

  it('unlabeled edges get the midpoint without obstacle checks', () => {
    expect(findLabelSlot(mkEdge(), start, end, ctx())).toEqual({ x: 200, y: 50 })
  })

  it('a clear lane hosts the label at the midpoint', () => {
    expect(findLabelSlot(mkEdge({ label: 'No' }), start, end, ctx())).toEqual({ x: 200, y: 50 })
  })

  it("a pill at the midpoint staggers the label to the 1/3 slot", () => {
    const blocker = mkEdge({
      source: 'P', target: 'Q', edgeIndex: 1, label: 'No', labelPosition: { x: 200, y: 50 },
      points: [{ x: 500, y: 500 }, { x: 520, y: 500 }],
    })
    const slot = findLabelSlot(mkEdge({ label: 'No' }), start, end, ctx({ edges: [blocker] }))
    expect(slot!.x).toBeCloseTo(400 / 3, 6)
    expect(slot!.y).toBe(50)
  })

  it("another edge's segment through the midpoint forces a stagger; pill-vs-pill respects the exact boundary", () => {
    const crossing = mkEdge({
      source: 'P', target: 'Q', edgeIndex: 1,
      points: [{ x: 200, y: 0 }, { x: 200, y: 100 }],
    })
    const staggered = findLabelSlot(mkEdge({ label: 'No' }), start, end, ctx({ edges: [crossing] }))
    expect(staggered!.x).toBeCloseTo(400 / 3, 6)
    // Pills just inside / outside the 2px padding boundary around the midpoint slot.
    const pillAt = (cx: number) => mkEdge({
      source: 'P', target: 'Q', edgeIndex: 1, label: 'No', labelPosition: { x: cx, y: 50 },
      points: [{ x: 500, y: 500 }, { x: 520, y: 500 }],
    })
    expect(findLabelSlot(mkEdge({ label: 'No' }), start, end, ctx({ edges: [pillAt(200 + pillW + 2 + 0.5)] })))
      .toEqual({ x: 200, y: 50 })
    const bumped = findLabelSlot(mkEdge({ label: 'No' }), start, end, ctx({ edges: [pillAt(200 + pillW + 2 - 0.5)] }))
    expect(bumped!.x).toBeCloseTo(400 / 3, 6)
  })

  it('a node covering the whole lane leaves no slot', () => {
    const wall = { id: 'W', label: 'W', shape: 'rectangle' as const, x: -10, y: 20, width: 420, height: 60 }
    expect(findLabelSlot(mkEdge({ label: 'No' }), start, end, ctx({ nodes: [wall] }))).toBeNull()
  })

  it("the edge's own endpoint is an obstacle: its label moves to the first slot leaving line beside it", () => {
    // A covers the midpoint; the 1/3 and 2/3 pills would sit under 2px from it.
    const a = { id: 'A', label: 'A', shape: 'rectangle' as const, x: 150, y: 20, width: 100, height: 60 }
    expect(findLabelSlot(mkEdge({ label: 'No' }), start, end, ctx({ nodes: [a] }))).toEqual({ x: 100, y: 50 })
  })

  it('the arrowhead end keeps its marker and line clear of the label as well', () => {
    // A 60px lane leaves the midpoint pill about 14px from each endpoint:
    // room for the 4px halo and some line, but not for the 8px arrowhead too.
    const a = { id: 'A', label: 'A', shape: 'rectangle' as const, x: -50, y: 20, width: 50, height: 60 }
    const b = { id: 'B', label: 'B', shape: 'rectangle' as const, x: 60, y: 20, width: 50, height: 60 }
    const lane = (edge: PositionedEdge) => findLabelSlot(edge, { x: 0, y: 50 }, { x: 60, y: 50 }, ctx({ nodes: [a, b] }))
    expect((60 - pillW) / 2).toBeGreaterThan(4 + 4)
    expect((60 - pillW) / 2).toBeLessThan(4 + 8 + 4)
    expect(lane(mkEdge({ label: 'No', hasArrowEnd: false }))).toEqual({ x: 30, y: 50 })
    // The marked end pushes the pill toward the source, leaving each side
    // its halo and line, and the arrowhead its own length as well.
    const seat = lane(mkEdge({ label: 'No' }))!
    expect(seat.y).toBe(50)
    expect(seat.x - pillW / 2).toBeGreaterThanOrEqual(4 + 4)
    expect(60 - (seat.x + pillW / 2)).toBeGreaterThanOrEqual(4 + 8 + 4)
    // A lane too short for both clearances has no seat at all.
    expect(findLabelSlot(mkEdge({ label: 'No' }), { x: 0, y: 50 }, { x: 50, y: 50 },
      ctx({ nodes: [a, { ...b, x: 50 }] }))).toBeNull()
  })

  it('keeps the whole pill on a lane that ends at a bend', () => {
    // The lane leaves A and turns at its far end; C blocks its middle. The
    // seat just past C would hang its pill over the bend of a 100px lane.
    const a = { id: 'A', label: 'A', shape: 'rectangle' as const, x: -50, y: 20, width: 50, height: 60 }
    const c = { id: 'C', label: 'C', shape: 'rectangle' as const, x: 30, y: 20, width: 40, height: 60 }
    const lane = (bend: number) => findLabelSlot(mkEdge({ label: 'No' }), start, { x: bend, y: 50 }, ctx({ nodes: [a, c] }))
    expect(70 + 2 + pillW).toBeGreaterThan(100)
    expect(lane(100)).toBeNull()
    const seat = lane(120)!
    expect(seat.y).toBe(50)
    expect(seat.x - pillW / 2).toBeGreaterThanOrEqual(70 + 2)
    expect(seat.x + pillW / 2).toBeLessThanOrEqual(120)
  })
})

describe('primary-over-feedback priority (unit)', () => {
  const axis = { main: 'x', cross: 'y', sign: 1 } as const
  const style = { edgeLabelFontSize: 12, edgeLabelFontWeight: 400 }
  const mkEdge = (source: string, target: string, edgeIndex: number, over: object = {}): PositionedEdge =>
    ({ source, target, style: 'solid', hasArrowStart: false, hasArrowEnd: true, points: [{ x: 500, y: 500 }, { x: 520, y: 500 }], edgeIndex, ...over }) as PositionedEdge
  const labelOnLane = { label: 'No', labelPosition: { x: 50, y: 50 } }

  it("a primary lane proof ignores its reciprocal feedback partner's label, and only that label", () => {
    const primary = mkEdge('A', 'B', 0, { points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] })
    const partner = mkEdge('B', 'A', 1, labelOnLane)
    const stranger = mkEdge('C', 'D', 2, labelOnLane)
    const prove = (others: PositionedEdge[], classes: Array<'primary-forward' | 'feedback'>) =>
      directLaneBlockers(primary, 50, 0, 100,
        { nodes: [], edges: others, axis, style, classes } as Parameters<typeof directLaneBlockers>[4])
    expect(prove([partner], ['primary-forward', 'feedback'])).toEqual([])
    // A non-reciprocal feedback edge's label still blocks.
    expect(prove([stranger], ['primary-forward', 'feedback', 'feedback'])).toEqual([{ kind: 'label', id: 'C->D' }])
    // Without class information there is no exemption.
    expect(prove([partner], undefined as never)).toEqual([{ kind: 'label', id: 'B->A' }])
  })

  it("a feedback lane proof never ignores the primary partner's label", () => {
    const feedback = mkEdge('B', 'A', 1, { points: [{ x: 100, y: 50 }, { x: 0, y: 50 }] })
    const primary = mkEdge('A', 'B', 0, labelOnLane)
    const blockers = directLaneBlockers(feedback, 50, 0, 100,
      { nodes: [], edges: [primary], axis, style, classes: ['primary-forward', 'feedback'] } as Parameters<typeof directLaneBlockers>[4])
    expect(blockers).toEqual([{ kind: 'label', id: 'A->B' }])
  })
})

describe('ROUTE_HITCH tripwire covers feedback lanes', () => {
  it('a dogleg injected into a straightened back-edge is reported', () => {
    const graph = parseMermaid('flowchart LR\n  A --> B\n  B --> A')
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    const back = findEdge(positioned.edges, 'B', 'A')
    expect(back.points.length).toBe(2)
    const [a, b] = back.points as [{ x: number; y: number }, { x: number; y: number }]
    back.points = [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: a.y + 10 }, { x: b.x, y: a.y + 10 }]
    const hitches = findRouteHitches(positioned, graph)
    expect(hitches.some(h => h.edge === 'B->A')).toBe(true)
    expect(hitches.find(h => h.edge === 'B->A')!.deviationPx).toBe(10)
  })
})

describe('container edges anchor on container borders (issue #25 §11.5)', () => {
  const NESTED_DIRECTION_SOURCE = `flowchart LR
  subgraph TOP
    direction TB
    subgraph B1
        direction RL
        i1 -->f1
    end
    subgraph B2
        direction BT
        i2 -->f2
    end
  end
  A --> TOP --> B
  B1 --> B2`

  function flatGroups(groups: PositionedGraph['groups'], out: PositionedGraph['groups'] = []): PositionedGraph['groups'] {
    for (const g of groups) { out.push(g); flatGroups(g.children, out) }
    return out
  }

  it('a container-to-container edge under direction overrides runs border to border, not in the margin', () => {
    // Before this repair the edge floated at the diagram margin, attached to
    // neither container (caught by the ROUTE_CONTAINER_MISANCHOR tripwire).
    const positioned = layoutGraphSync(parseMermaid(NESTED_DIRECTION_SOURCE))
    const e = findEdge(positioned.edges, 'B1', 'B2')
    const groups = flatGroups(positioned.groups)
    const b1 = groups.find(g => g.id === 'B1')!
    const b2 = groups.find(g => g.id === 'B2')!
    const start = e.points[0]!
    const end = e.points[e.points.length - 1]!
    // Start on B1's bottom border, end on B2's top border, one straight lane.
    expect(Math.abs(start.y - (b1.y + b1.height))).toBeLessThan(1)
    expect(start.x).toBeGreaterThan(b1.x)
    expect(start.x).toBeLessThan(b1.x + b1.width)
    expect(Math.abs(end.y - b2.y)).toBeLessThan(1)
    expect(end.x).toBeGreaterThan(b2.x)
    expect(end.x).toBeLessThan(b2.x + b2.width)
    expect(e.points.length).toBe(2)
  })

  it('the route audit is silent across the MFA and container fixtures', () => {
    for (const src of [MFA_SOURCE, NESTED_DIRECTION_SOURCE]) {
      const graph = parseMermaid(src)
      const positioned = layoutGraphSync(graph)
      expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
      expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
      expect(auditRouteContracts(positioned, graph)).toEqual([])
    }
  })
})

describe('layoutMermaid debug exposure (issue #25 acceptance criterion 8, open question 1)', () => {
  it('layoutMermaid(d, { debug: true }) attaches a route certificate to every edge', () => {
    const r = agentParse(MFA_SOURCE)
    if (!r.ok) throw new Error('parse failed')
    const layout = layoutMermaid(r.value, { debug: true })
    expect(layout.edges.length).toBeGreaterThan(0)
    for (const e of layout.edges) {
      expect(e.route).toBeDefined()
      expect(['primary-forward', 'feedback', 'self-loop', 'container', 'cross-hierarchy']).toContain(e.route!.routeClass)
    }
    // Default output stays certificate-free (schema-stable).
    const plain = layoutMermaid(r.value)
    expect(plain.edges.every(e => e.route === undefined)).toBe(true)
  })
})

describe('route audit tripwires fire on post-certification corruption', () => {
  it('skips certified edges with fewer than 2 points instead of throwing', () => {
    for (const points of [[], [{ x: 10, y: 20 }]] as const) {
      const graph = parseMermaid('flowchart LR\n  A --> B')
      const positioned = layoutGraphSync(graph)
      expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
      expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
      const e = findEdge(positioned.edges, 'A', 'B')
      e.points = [...points]
      expect(auditRouteContracts(positioned, graph)).toEqual([])
    }
  })

  it('ROUTE_UNEXPLAINED_BEND: a diagonal segment on a certified edge', () => {
    const graph = parseMermaid(MFA_SOURCE)
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    const e = findEdge(positioned.edges, 'B', 'C')
    const [a, b] = e.points as [{ x: number; y: number }, { x: number; y: number }]
    e.points = [a, { x: (a.x + b.x) / 2, y: a.y + 30 }, b]
    expect(auditRouteContracts(positioned, graph).map(f => f.code)).toContain('ROUTE_UNEXPLAINED_BEND')
  })

  it('ROUTE_STALE_AFTER_NODE_MOVE: a node moved without rerouting its edges', () => {
    const graph = parseMermaid(MFA_SOURCE)
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    const a = positioned.nodes.find(n => n.id === 'A')!
    a.y += 200 // node moves; its edge endpoints do not
    const findings = auditRouteContracts(positioned, graph)
    expect(findings.some(f => f.code === 'ROUTE_STALE_AFTER_NODE_MOVE' && 'node' in f && f.node === 'A')).toBe(true)
  })

  it('ROUTE_STALE_AFTER_NODE_MOVE: a non-incident node moved onto a certified route', () => {
    const graph = parseMermaid('flowchart LR\n  A --> B\n  C')
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    const e = findEdge(positioned.edges, 'A', 'B')
    const c = positioned.nodes.find(n => n.id === 'C')!
    c.x = (e.points[0]!.x + e.points[1]!.x) / 2 - c.width / 2
    c.y = e.points[0]!.y - c.height / 2
    const findings = auditRouteContracts(positioned, graph)
    expect(findings.some(f => f.code === 'ROUTE_STALE_AFTER_NODE_MOVE' && 'node' in f && f.node === 'C')).toBe(true)
  })

  it('ROUTE_SHAPE_MISANCHOR: an endpoint pulled inside a diamond', () => {
    const graph = parseMermaid(MFA_SOURCE)
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    const e = findEdge(positioned.edges, 'B', 'C')
    const end = e.points[e.points.length - 1]!
    const c = positioned.nodes.find(n => n.id === 'C')!
    e.points = [e.points[0]!, { x: c.x + c.width / 2, y: end.y }] // deep inside the diamond
    expect(auditRouteContracts(positioned, graph).map(f => f.code)).toContain('ROUTE_SHAPE_MISANCHOR')
  })

  it('ROUTE_CONTAINER_MISANCHOR: a container edge detached from its border', () => {
    const graph = parseMermaid(`flowchart TD
      Start --> Pipeline
      subgraph Pipeline
        Fetch --> Parse
      end`)
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    const e = findEdge(positioned.edges, 'Start', 'Pipeline')
    const end = e.points[e.points.length - 1]!
    e.points = [...e.points.slice(0, -1), { x: end.x + 50, y: end.y + 50 }]
    expect(auditRouteContracts(positioned, graph).map(f => f.code)).toContain('ROUTE_CONTAINER_MISANCHOR')
  })

  it("ROUTE_LABEL_ON_SHARED_TRUNK: a label pill parked on another edge's collinear segment", () => {
    const graph = parseMermaid(MFA_SOURCE)
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    const yes = findEdge(positioned.edges, 'D', 'E', 'Yes')
    const ef = findEdge(positioned.edges, 'E', 'F')
    // Move D->E's pill onto E->F's lane and make D->E share that lane segment.
    const seg = ef.points[0]!
    yes.labelPosition = { x: (ef.points[0]!.x + ef.points[1]!.x) / 2, y: seg.y }
    yes.points = [{ x: ef.points[0]!.x, y: seg.y }, { x: ef.points[1]!.x, y: seg.y }]
    const findings = auditRouteContracts(positioned, graph)
    expect(findings.some(f => f.code === 'ROUTE_LABEL_ON_SHARED_TRUNK')).toBe(true)
  })
})

describe('route audit — boundary harvest', () => {
  it('shared-trunk detection works for vertical trunks and respects the collinearity clearance', () => {
    const graph = parseMermaid('flowchart TD\n  A -- down --> B\n  C --> D')
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    const labeled = findEdge(positioned.edges, 'A', 'B')
    const other = findEdge(positioned.edges, 'C', 'D')
    // Both edges share a vertical line under the pill: flagged.
    labeled.points = [{ x: 100, y: 0 }, { x: 100, y: 200 }]
    labeled.labelPosition = { x: 100, y: 100 }
    other.points = [{ x: 102, y: 50 }, { x: 102, y: 150 }]
    expect(auditRouteContracts(positioned, graph).map(f => f.code)).toContain('ROUTE_LABEL_ON_SHARED_TRUNK')
    // Beyond the 4px collinearity clearance: parallel but distinct lanes — not shared.
    other.points = [{ x: 105, y: 50 }, { x: 105, y: 150 }]
    expect(auditRouteContracts(positioned, graph).filter(f => f.code === 'ROUTE_LABEL_ON_SHARED_TRUNK')).toEqual([])
    // Outside the pill on the main axis: collinear but elsewhere — not shared.
    const m = measureMultilineText('down', 12, 400)
    const pillBottom = 100 + (m.height + 16) / 2
    other.points = [{ x: 100, y: pillBottom + 1 }, { x: 100, y: pillBottom + 60 }]
    expect(auditRouteContracts(positioned, graph).filter(f => f.code === 'ROUTE_LABEL_ON_SHARED_TRUNK')).toEqual([])
  })

  it('stale vs shape-misanchor boundary: ±2px detachment separates the two codes', () => {
    const graph = parseMermaid('flowchart LR\n  A --> B')
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    const e = findEdge(positioned.edges, 'A', 'B')
    const b = positioned.nodes.find(n => n.id === 'B')!
    const startOnA = e.points[0]!
    // 1.5px short of B's border: still "attached" (within 2px) but off the
    // perimeter beyond 1px tolerance -> shape misanchor, not stale.
    e.points = [startOnA, { x: b.x - 1.5, y: b.y + b.height / 2 }]
    let codes = auditRouteContracts(positioned, graph).map(f => f.code)
    expect(codes).toContain('ROUTE_SHAPE_MISANCHOR')
    expect(codes).not.toContain('ROUTE_STALE_AFTER_NODE_MOVE')
    // 3px short: detached entirely -> stale.
    e.points = [startOnA, { x: b.x - 3, y: b.y + b.height / 2 }]
    codes = auditRouteContracts(positioned, graph).map(f => f.code)
    expect(codes).toContain('ROUTE_STALE_AFTER_NODE_MOVE')
    expect(codes).not.toContain('ROUTE_SHAPE_MISANCHOR')
    // Exactly on the border: silent.
    e.points = [startOnA, { x: b.x, y: b.y + b.height / 2 }]
    expect(auditRouteContracts(positioned, graph)).toEqual([])
  })

  it('container perimeter tolerance: 0.5px off is fine, 1.5px off fires', () => {
    const graph = parseMermaid('flowchart TD\n  Start --> Pipeline\n  subgraph Pipeline\n    F --> P\n  end')
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    const e = findEdge(positioned.edges, 'Start', 'Pipeline')
    const end = e.points[e.points.length - 1]!
    e.points = [...e.points.slice(0, -1), { x: end.x, y: end.y - 0.5 }]
    expect(auditRouteContracts(positioned, graph).filter(f => f.code === 'ROUTE_CONTAINER_MISANCHOR')).toEqual([])
    e.points = [...e.points.slice(0, -1), { x: end.x, y: end.y - 1.5 }]
    expect(auditRouteContracts(positioned, graph).map(f => f.code)).toContain('ROUTE_CONTAINER_MISANCHOR')
  })
})

describe('container repair — axis selection harvest', () => {
  function flat(groups: PositionedGraph['groups'], out: PositionedGraph['groups'] = []): PositionedGraph['groups'] {
    for (const g of groups) { out.push(g); flat(g.children, out) }
    return out
  }

  it('side-by-side containers route onto a horizontal lane', () => {
    const positioned = layoutGraphSync(parseMermaid(`flowchart TD
  subgraph TOP
    direction LR
    subgraph B1
        direction TB
        i1 --> f1
    end
    subgraph B2
        direction TB
        i2 --> f2
    end
  end
  A --> TOP --> B
  B1 --> B2`))
    const e = findEdge(positioned.edges, 'B1', 'B2')
    const groups = flat(positioned.groups)
    const b1 = groups.find(g => g.id === 'B1')!
    const b2 = groups.find(g => g.id === 'B2')!
    expect(e.points.length).toBe(2)
    const [s, end] = e.points as [{ x: number; y: number }, { x: number; y: number }]
    // Horizontal border-to-border lane: B1's right border to B2's left border.
    expect(Math.abs(s.y - end.y)).toBeLessThan(0.01)
    expect(Math.abs(s.x - (b1.x + b1.width))).toBeLessThan(1)
    expect(Math.abs(end.x - b2.x)).toBeLessThan(1)
    expect(s.y).toBeGreaterThan(b1.y)
    expect(s.y).toBeLessThan(b1.y + b1.height)
    expect(e.routeCertificate?.invariant).toBe('container-attach')
    expect(auditRouteContracts(positioned, parseMermaid(`flowchart TD
  subgraph TOP
    direction LR
    subgraph B1
        direction TB
        i1 --> f1
    end
    subgraph B2
        direction TB
        i2 --> f2
    end
  end
  A --> TOP --> B
  B1 --> B2`))).toEqual([])
  })

  it('a circle-to-container relationship retains its attachment certificate', () => {
    const graph = parseMermaid(`flowchart TD
      S((Start)) --> Pipeline
      subgraph Pipeline
        F --> P
      end`)
    // Must not throw, and the edge still certifies as container-attach.
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    const e = findEdge(positioned.edges, 'S', 'Pipeline')
    expect(e.routeCertificate?.invariant).toBe('container-attach')
  })
})

describe('repairs never increase edge crossings', () => {
  it('the feedback fan-out fixture has no proper edge crossings', () => {
    // stateDiagram corpus regression: collapsing Moving -> Still onto a
    // vertical back-lane would cross the Still fan-out trunk — a crossing
    // ELK's loop avoided. The crossing guard must refuse the collapse.
    const positioned = layoutGraphSync(parseMermaid(`flowchart TD
      S0((start)) --> Still
      Still --> S1((end))
      Still --> Moving
      Moving --> Still
      Moving --> Crash`))
    const edges = positioned.edges
    expect(edges.map(edge => [edge.source, edge.target]).sort()).toEqual([['S0', 'Still'], ['Still', 'S1'], ['Still', 'Moving'], ['Moving', 'Still'], ['Moving', 'Crash']].sort())
    function segInt(a: {x:number;y:number}, b: {x:number;y:number}, c: {x:number;y:number}, d: {x:number;y:number}): boolean {
      const det = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x)
      if (Math.abs(det) < 1e-9) return false
      const t2 = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / det
      const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / det
      return t2 > 0.001 && t2 < 0.999 && u > 0.001 && u < 0.999
    }
    let crossings = 0
    for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
      for (let s = 1; s < edges[i]!.points.length; s++) for (let q = 1; q < edges[j]!.points.length; q++) {
        if (segInt(edges[i]!.points[s-1]!, edges[i]!.points[s]!, edges[j]!.points[q-1]!, edges[j]!.points[q]!)) crossings++
      }
    }
    expect(crossings).toBe(0)
  })
})

describe('semantic ports — N/E/S/W at bbox side midpoints (issue #26 WS3)', () => {
  it('shapePorts derives cardinal ports from each painted outline', () => {
    const node = { id: 'X', label: 'X', shape: 'diamond' as const, x: 100, y: 50, width: 80, height: 40 }
    for (const shape of ['diamond', 'rectangle', 'circle', 'stadium', 'hexagon', 'cylinder'] as const) {
      const ports = shapePorts({ ...node, shape })
      expect(ports.N).toEqual({ x: 140, y: 50 })
      expect(ports.E).toEqual({ x: shape === 'circle' ? 160 : 180, y: 70 })
      expect(ports.S).toEqual({ x: 140, y: 90 })
      expect(ports.W).toEqual({ x: shape === 'circle' ? 120 : 100, y: 70 })
    }
  })

  const positioned = layoutGraphSync(parseMermaid(MFA_SOURCE))
  const nodeMap = new Map(positioned.nodes.map(n => [n.id, n]))
  const center = (id: string) => {
    const n = nodeMap.get(id)!
    return { cx: n.x + n.width / 2, cy: n.y + n.height / 2, bottom: n.y + n.height, left: n.x }
  }

  it('the retry loop exits the decision diamond at its exact South vertex', () => {
    for (const [from] of [['C'], ['F']] as const) {
      const back = findEdge(positioned.edges, from, from === 'C' ? 'B' : 'E')
      const { cx, bottom } = center(from)
      expect(Math.abs(back.points[0]!.x - cx)).toBeLessThan(0.5)
      expect(Math.abs(back.points[0]!.y - bottom)).toBeLessThan(0.5)
      expect(back.routeCertificate?.sourcePort).toBe('S')
    }
  })

  it('the retry loop enters its target at the exact South side midpoint', () => {
    for (const [from, to] of [['C', 'B'], ['F', 'E']] as const) {
      const back = findEdge(positioned.edges, from, to)
      const { cx, bottom } = center(to)
      const end = back.points[back.points.length - 1]!
      expect(Math.abs(end.x - cx)).toBeLessThan(0.5)
      expect(Math.abs(end.y - bottom)).toBeLessThan(0.5)
      expect(back.routeCertificate?.targetPort).toBe('S')
    }
  })

  it('F -> G enters Create Session at its exact West midpoint (and emits from F\'s vertex)', () => {
    const e = findEdge(positioned.edges, 'F', 'G')
    const { left, cy } = center('G')
    const end = e.points[e.points.length - 1]!
    expect(Math.abs(end.x - left)).toBeLessThan(0.5)
    expect(Math.abs(end.y - cy)).toBeLessThan(0.5)
    expect(e.routeCertificate?.targetPort).toBe('W')
    expect(e.routeCertificate?.sourcePort).toBe('E')
    expect(e.points.length).toBeLessThanOrEqual(4)
  })

  it('aligned chains run port to port: B -> C from East midpoint to the West vertex', () => {
    const e = findEdge(positioned.edges, 'B', 'C')
    expect(e.routeCertificate?.sourcePort).toBe('E')
    expect(e.routeCertificate?.targetPort).toBe('W')
    expectSourceEndpointAtNamedPort(e, positioned.nodes.find(node => node.id === 'B')!)
    expectTargetEndpointAtNamedPort(e, positioned.nodes.find(node => node.id === 'C')!)
  })

  it('circles join the straightenable set via their exact boundary ports', () => {
    // Previously unverified-shape: circle endpoints sat wherever ELK left
    // them on the bbox. The port model gives circles four exact boundary
    // points (the inscribed circle touches the bbox side midpoints).
    const pair = layoutGraphSync(parseMermaid('flowchart LR\n  A((One)) --> B((Two))\n  B --> A'))
    const fwd = findEdge(pair.edges, 'A', 'B')
    const a = pair.nodes.find(n => n.id === 'A')!
    if (isStraightHorizontal(fwd)) {
      expect(Math.abs(fwd.points[0]!.x - (a.x + a.width))).toBeLessThan(0.5)
      expect(Math.abs(fwd.points[0]!.y - (a.y + a.height / 2))).toBeLessThan(0.5)
      expect(fwd.routeCertificate?.sourcePort).toBe('E')
    } else {
      throw new Error('aligned circle pair should produce a straight port-to-port lane')
    }
  })
})

describe('port ranking — sharp bits win when a side carries one line (issue #26 WS3 costs)', () => {
  // Misalign the diamond from its target by fan-in: T receives a second
  // edge from X, pulling T's center off Q's centerline, so the lane through
  // Q's vertex and the lane through T's midpoint genuinely differ.
  const single = (dir: string) => `flowchart ${dir}
  Q{Decide} -- go --> T[Target]
  X[Side input] --> T`

  it.each([
    ['LR', 'E'],
    ['RL', 'W'],
    ['TD', 'S'],
    ['BT', 'N'],
  ] as const)('%s: one line out of the diamond emits from its exact %s vertex', (dir, side) => {
    const positioned = layoutGraphSync(parseMermaid(single(dir)))
    const e = findEdge(positioned.edges, 'Q', 'T')
    // Straight when the vertex lane is clear; otherwise a single deliberate
    // Z from the vertex into the target's port — never a floating facet exit.
    expect(e.routeCertificate?.sourcePort).toBe(side)
    expect(e.points.length).toBeLessThanOrEqual(4)
    expect(e.routeCertificate?.targetPort).toBeDefined()
  })

  it("a blocked vertex emit hooks into the target's facing cross-side port (1 bend, not a 2-bend Z)", () => {
    // Direct geometry, bypassing the placement repair: the target sits fully
    // below the vertex lane (its span cannot host a straight emit), no
    // sibling holds the entry port, and nothing blocks the facing N port.
    // This is the hook's residual domain once port-lane alignment exists:
    // geometries where the slide was vetoed (occlusion, labels, a sibling
    // straight edge) but the facing entry is clear.
    const graph = parseMermaid('flowchart LR\n  Q{Decide} --> T[Target]')
    const positioned = {
      nodes: [
        { id: 'Q', label: 'Decide', shape: 'diamond', x: 40, y: 40, width: 100, height: 100 },
        { id: 'T', label: 'Target', shape: 'rectangle', x: 300, y: 120, width: 80, height: 36 },
      ] as PositionedNode[],
      edges: [{
        source: 'Q', target: 'T',
        points: [{ x: 140, y: 90 }, { x: 220, y: 90 }, { x: 220, y: 138 }, { x: 300, y: 138 }],
      }] as PositionedEdge[],
      groups: [] as PositionedGroup[],
    }
    applyRouteContracts(positioned, graph, new Set(), { edgeLabelFontSize: 11, edgeLabelFontWeight: 400 })
    const e = positioned.edges[0]!
    expect(e.points.length).toBe(3)
    expect(e.routeCertificate?.sourcePort).toBe('E')
    expect(e.routeCertificate?.targetPort).toBe('N')
    expect(e.points[e.points.length - 1]).toEqual({ x: 340, y: 120 })
  })

  it.each(['LR', 'RL'] as const)(
    '%s: port-lane alignment makes the labeled main branch vertex-to-port straight; the side input converges at the same port',
    dir => {
      const positioned = layoutGraphSync(parseMermaid(single(dir)))
      const t = positioned.nodes.find(n => n.id === 'T')!
      const entry = dir === 'LR' ? ('W' as const) : ('E' as const)
      // The placement repair (Rüegg et al.: straightness through ports)
      // slides Target onto the diamond's vertex lane: the labeled primary
      // branch runs straight, vertex to exact port — rule 1 with 0 bends.
      const q = findEdge(positioned.edges, 'Q', 'T')
      expect(q.points.length).toBe(2)
      expect(q.routeCertificate?.sourcePort).toBe(dir === 'LR' ? 'E' : 'W')
      expect(q.routeCertificate?.targetPort).toBe(entry)
      // The side input converges into the SAME exact entry port (fan-in
      // merge; the port-seeking Z upgrade fires because its raw entry was
      // off-port after the slide).
      const x = findEdge(positioned.edges, 'X', 'T')
      const port = { x: dir === 'LR' ? t.x : t.x + t.width, y: t.y + t.height / 2 }
      const last = x.points[x.points.length - 1]!
      expect(Math.abs(last.x - port.x)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(last.y - port.y)).toBeLessThanOrEqual(0.5)
      expect(x.routeCertificate?.targetPort).toBe(entry)
    },
  )

  it.each([
    ['circles', '((One))', '((Hub))', '((Two))'],
    ['stadiums', '([One])', '([Hub])', '([Two])'],
    ['hexagons', '{{One}}', '{{Hub}}', '{{Two}}'],
    ['cylinders', '[(One)]', '[(Hub)]', '[(Two)]'],
  ] as const)(
    'PORT_EXACT shapes: an unlabeled equal-rank peer fan-in merges SYMMETRICALLY at the exact port',
    (_name, a, t, b) => {
      // Active fan-in centering snaps the hub T to the exact cross-axis
      // barycenter of its two unlabeled peer sources, so both edges leave
      // their source E port and converge — mirror-symmetric — at T's single
      // exact W port (port-exact preserved; the two equal bent lines replace
      // the old one-straight/one-Z asymmetry).
      const positioned = layoutGraphSync(parseMermaid(
        `flowchart LR\n  A${a} --> T${t}\n  B${b} --> T`))
      const at = findEdge(positioned.edges, 'A', 'T')
      const bt = findEdge(positioned.edges, 'B', 'T')
      for (const e of [at, bt]) {
        expect(e.routeCertificate?.sourcePort).toBe('E')
        expect(e.routeCertificate?.targetPort).toBe('W')
      }
      // Both edges enter through the same exact W port (fan-in merge).
      const lastA = at.points[at.points.length - 1]!
      const lastB = bt.points[bt.points.length - 1]!
      expect(Math.abs(lastA.x - lastB.x)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(lastA.y - lastB.y)).toBeLessThanOrEqual(0.5)
      // The hub is centered: the shared W port sits at the barycenter of the
      // two source centers → the two edges are vertical mirror images.
      const A = positioned.nodes.find(n => n.id === 'A')!
      const B = positioned.nodes.find(n => n.id === 'B')!
      const bary = ((A.y + A.height / 2) + (B.y + B.height / 2)) / 2
      expect(Math.abs(lastA.y - bary)).toBeLessThanOrEqual(1.5)
    },
  )

  // A physically admitted single-column peer fan-in is mirror-symmetric.
  // Larger fans may retain ELK's stagger: snapping a source onto or beyond
  // its first bend would consume/reverse a valid outward shaft. Preserving
  // that route takes precedence over cosmetic alignment; staggered fans
  // still owe complete, crossing-free, hard-clean geometry.
  it.each([
    ['rectangles', '[One]', '[Hub]', '[Src]'],
    ['stadiums', '([One])', '([Hub])', '([Src])'],
    ['hexagons', '{{One}}', '{{Hub}}', '{{Src}}'],
    ['cylinders', '[(One)]', '[(Hub)]', '[(Src)]'],
    // Curved/pointed shapes clip endpoints to the outline, not the bbox, so
    // they carry a small mirror floor that grows with N; tolerances below
    // absorb it (circle <=2.1px, diamond <=3.2px at N=8).
    ['circles', '((One))', '((Hub))', '((Src))'],
    ['diamonds', '{One}', '{Hub}', '{Src}'],
  ] as const)(
    'peer fan-in preserves outward routes and mirrors admitted single columns for %s',
    (name, _a, t, srcTpl) => {
      const curved = name === 'circles' || name === 'diamonds'
      // Floor for curved/pointed shapes when perfectly centered (outline
      // clipping): hub stays on barycenter, edge endpoints carry a residual.
      const hubTol = curved ? 1.0 : 0.5
      const mirrorTol = curved ? 3.2 : 0.5
      for (let n = 3; n <= 8; n++) {
        const open = srcTpl.slice(0, srcTpl.indexOf('Src'))
        const close = srcTpl.slice(srcTpl.indexOf('Src') + 3)
        const tOpen = t.slice(0, t.indexOf('Hub'))
        const tClose = t.slice(t.indexOf('Hub') + 3)
        const lines = ['flowchart LR']
        for (let i = 0; i < n; i++) lines.push(`  A${i}${open}S${i}${close} --> T${tOpen}Hub${tClose}`)
        const graph = parseMermaid(lines.join('\n')), positioned = layoutGraphSync(graph)
        const nodeMap = new Map(positioned.nodes.map(nd => [nd.id, nd]))
        const hub = nodeMap.get('T')!
        const sources = Array.from({ length: n }, (_, i) => nodeMap.get(`A${i}`)!)
        const cols = new Set(sources.map(s => Math.round(s.x)))
        const incoming = positioned.edges.filter(e => e.target === 'T')
        expect(incoming.length).toBe(n)
        const assessment = assessLayout(graph, positioned)
        expect(hardViolations(assessment)).toEqual([])
        expect(assessment.metrics.endpointApproaches).toBe(0)
        expect(assessment.metrics.edgeCrossings).toBe(0)
        // The small three-source control admits alignment for every shape;
        // this keeps its exact ports and mirror geometry explicitly pinned.
        if (n === 3) expect(cols.size).toBe(1)
        if (cols.size !== 1) continue

        // (1) Hub centered on the cross-axis barycenter of its sources.
        const bary = sources.reduce((a, s) => a + s.y + s.height / 2, 0) / n
        expect(Math.abs((hub.y + hub.height / 2) - bary)).toBeLessThanOrEqual(hubTol)

        // (2) Both endpoints of every incoming edge land on the SAME exact
        //     W port — all incoming arrowheads coincide (fan-in merge).
        const entries = incoming.map(e => e.points[e.points.length - 1]!)
        for (const p of entries) {
          expect(Math.abs(p.x - entries[0]!.x)).toBeLessThanOrEqual(0.5)
          expect(Math.abs(p.y - entries[0]!.y)).toBeLessThanOrEqual(0.5)
        }
        // The shared port sits on the hub centerline (the barycenter).
        expect(Math.abs(entries[0]!.y - bary)).toBeLessThanOrEqual(hubTol + 1.5)

        // (3) Incoming edges are mirror-paired about the hub centerline:
        //     the k-th source from the top and the k-th from the bottom leave
        //     equidistant from the barycenter.
        const startYs = incoming.map(e => e.points[0]!.y).sort((p, q) => p - q)
        for (let k = 0; k < Math.floor(n / 2); k++) {
          const dTop = Math.abs(startYs[k]! - bary)
          const dBot = Math.abs(startYs[n - 1 - k]! - bary)
          expect(Math.abs(dTop - dBot)).toBeLessThanOrEqual(mirrorTol)
        }
      }
    },
  )

  it('port-lane alignment includes diamonds: K becomes vertex-to-vertex straight', () => {
    const positioned = layoutGraphSync(parseMermaid(
      'flowchart LR\n  Q1{First} -- go --> Q2{Second}\n  X[Side input] --> Q2'))
    // Pre-extension Q1's emit landed on Q2's facet, off the vertex. Sliding
    // Q2 onto Q1's vertex lane makes the labeled main branch EXACT
    // vertex-to-vertex. X cannot also align (the 'go' label pill blocks its
    // slide — proof-gated), so it keeps its legal floating facet straight.
    const q = findEdge(positioned.edges, 'Q1', 'Q2')
    expect(q.points.length).toBe(2)
    expect(q.routeCertificate?.sourcePort).toBe('E')
    expect(q.routeCertificate?.targetPort).toBe('W')
    expect(findEdge(positioned.edges, 'X', 'Q2').points.length).toBe(2)
  })

  it('a feedback out-edge does not veto vertex alignment (R: yes-branch runs straight)', () => {
    // B has TWO out-edges, but "no, retry" is FEEDBACK — it leaves via the
    // outer channel and never occupies the E facet. Only forward out-edges
    // count against the vertex's capacity, so Process aligns onto the main
    // lane and the yes-branch runs straight, vertex to exact port.
    const positioned = layoutGraphSync(parseMermaid(
      'flowchart LR\n  A[Request] --> B{Valid?}\n  B -- no, retry --> A\n  B -- yes --> C[Process]'))
    const yes = findEdge(positioned.edges, 'B', 'C')
    expect(yes.points.length).toBe(2)
    expect(yes.routeCertificate?.sourcePort).toBe('E')
    expect(yes.routeCertificate?.targetPort).toBe('W')
    const b = positioned.nodes.find(n => n.id === 'B')!
    const c = positioned.nodes.find(n => n.id === 'C')!
    expect(Math.abs((b.y + b.height / 2) - (c.y + c.height / 2))).toBeLessThanOrEqual(0.5)
  })

  it('two lines out of one diamond side spread symmetrically (no line hogs the vertex)', () => {
    for (const dir of ['LR', 'TD'] as const) {
      const positioned = layoutGraphSync(parseMermaid(`flowchart ${dir}
  Q{Decide} -- a --> P[One]
  Q -- b --> R[Two]`))
      const a = findEdge(positioned.edges, 'Q', 'P')
      const b = findEdge(positioned.edges, 'Q', 'R')
      // Distinct exits; the shared side is spread, not stacked on the vertex.
      expect(JSON.stringify(a.points[0])).not.toBe(JSON.stringify(b.points[0]))
      expect(a.points.length).toBeLessThanOrEqual(4)
      expect(b.points.length).toBeLessThanOrEqual(4)
      const cross = dir === 'LR' ? 'y' as const : 'x' as const
      const q = positioned.nodes.find(n => n.id === 'Q')!
      const center = q[cross] + (cross === 'y' ? q.height : q.width) / 2
      expect(Math.abs(Math.abs(a.points[0]![cross] - center) - Math.abs(b.points[0]![cross] - center))).toBeLessThanOrEqual(0.75)
    }
    // A facet proposal replaces its aligned staircase entirely. Translating
    // that discarded staircase would cut the diamond, but neither actual
    // replacement enters it: its east boundary is x=60 at y=20 and y=60.
    const graph = parseMermaid('flowchart LR\nQ{Decide} --> P[One]\nQ --> R[Two]')
    const nodes: PositionedNode[] = [
      { id: 'Q', label: 'Decide', shape: 'diamond', x: 0, y: 0, width: 80, height: 80 },
      { id: 'P', label: 'One', shape: 'rectangle', x: 160, y: 120, width: 20, height: 10 },
      { id: 'R', label: 'Two', shape: 'rectangle', x: 160, y: 180, width: 20, height: 10 },
    ]
    const edges = graph.edges.map((edge, i) => ({ ...edge, points: [{ x: 40, y: 80 }, { x: 40, y: i === 0 ? 125 : 185 }, { x: 160, y: i === 0 ? 125 : 185 }] }))
    alignPortLanes(nodes, edges, [], 'LR', resolveRenderStyle())
    expect(edges.map(edge => edge.points)).toEqual([
      [{ x: 60, y: 20 }, { x: 160, y: 20 }],
      [{ x: 60, y: 60 }, { x: 160, y: 60 }],
    ])
  })

  it.each(['TD', 'LR', 'BT', 'RL'] as const)('keeps two private captioned diamond routes to the same target in %s', direction => {
    const turns = ['TD', 'LR', 'BT', 'RL'].indexOf(direction)
    const rotate = ({ x, y }: Point): Point => {
      for (let turn = 0; turn < turns; turn++) [x, y] = [y, -x]
      return { x, y }
    }
    const nodes: PositionedNode[] = [
      { id: 'Q', label: 'Decision', shape: 'diamond' as const, x: 0, y: 0, width: 160, height: 160 },
      { id: 'T', label: 'Destination', shape: 'rectangle' as const, x: 30, y: 300, width: 100, height: 40 },
    ].map(node => {
      const a = rotate(node), b = rotate({ x: node.x + node.width, y: node.y + node.height })
      return { ...node, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
    })
    // Independently authored outline contacts: the diamond's lower facets
    // contain (40,120)/(120,120), and the target's top is y300. Each caption
    // has its own vertical shaft, separated by 80px before any optional move.
    const routes = [
      [{ x: 40, y: 120 }, { x: 40, y: 220 }, { x: 55, y: 220 }, { x: 55, y: 300 }],
      [{ x: 120, y: 120 }, { x: 120, y: 220 }, { x: 105, y: 220 }, { x: 105, y: 300 }],
    ].map(points => points.map(rotate))
    const captions = [{ x: 40, y: 200 }, { x: 120, y: 200 }].map(rotate)
    const edges: PositionedEdge[] = routes.map((points, index) => ({
      id: index === 0 ? 'first-route' : 'second-route', edgeIndex: index,
      source: 'Q', target: 'T', label: index === 0 ? 'first' : 'second',
      style: 'solid', hasArrowStart: false, hasArrowEnd: true,
      points: points.map(point => ({ ...point })), labelPosition: { ...captions[index]! },
    }))
    const beforeNodes = structuredClone(nodes)
    alignPortLanes(nodes, edges, [], direction, resolveRenderStyle())
    expect(edges.map(edge => edge.labelPosition)).toEqual(captions)
    expect(nodes).toEqual(beforeNodes)
    expect(edges.map(edge => edge.points)).toEqual(routes)
    expect(edges.map(edge => [edge.id, edge.edgeIndex, edge.source, edge.target, edge.label])).toEqual([
      ['first-route', 0, 'Q', 'T', 'first'], ['second-route', 1, 'Q', 'T', 'second'],
    ])
  })

  it('a TD decision fork/rejoin exits the diamond through lower facet ports before honoring target lanes', () => {
    const positioned = layoutGraphSync(parseMermaid(`flowchart TD
  A[Start] --> B{Decision?}
  B -->|Yes| C[Do the thing]
  B -->|No| D[Skip it]
  C --> E[End]
  D --> E`))
    const yes = findEdge(positioned.edges, 'B', 'C', 'Yes')
    const no = findEdge(positioned.edges, 'B', 'D', 'No')
    const decision = positioned.nodes.find(n => n.id === 'B')!
    const center = decision.x + decision.width / 2

    expect(yes.routeCertificate?.sourcePort).toBe('SW')
    expect(no.routeCertificate?.sourcePort).toBe('SE')
    expect(yes.points[0]!.x).toBeLessThan(center)
    expect(no.points[0]!.x).toBeGreaterThan(center)
    expect(yes.points[0]!.y).toBeCloseTo(no.points[0]!.y, 3)
  })

  it('a TD decision fork/rejoin connects every line through named endpoint ports', () => {
    const positioned = layoutGraphSync(parseMermaid(`flowchart TD
  A[Start] --> B{Decision?}
  B -->|Yes| C[Do the thing]
  B -->|No| D[Skip it]
  C --> E[End]
  D --> E`))
    expect(positioned.edges).toHaveLength(5)
    const nodes = new Map(positioned.nodes.map(node => [node.id, node]))
    for (const edge of positioned.edges) {
      expectSourceEndpointAtNamedPort(edge, nodes.get(edge.source)!)
      expectTargetEndpointAtNamedPort(edge, nodes.get(edge.target)!)
    }
  })

  it('issue #42: grouped TD decision branches expose named lower diamond facet ports', () => {
    const graph = parseMermaid(`flowchart TD
  subgraph product [Product Loop]
    A[Capture request] --> B{Ready?}
    B -->|yes| C[Ship]
    B -.->|needs work| D[Refine]
  end`)
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    const yes = findEdge(positioned.edges, 'B', 'C', 'yes')
    const retry = findEdge(positioned.edges, 'B', 'D', 'needs work')
    expect(findEdge(positioned.edges, 'A', 'B').routeCertificate?.sourcePort).toBe('S')
    expect(findEdge(positioned.edges, 'A', 'B').routeCertificate?.targetPort).toBe('N')
    expect(yes.routeCertificate?.sourcePort).toBe('SW')
    expect(retry.routeCertificate?.sourcePort).toBe('SE')
    expect(yes.routeCertificate?.targetPort).toBe('N')
    expect(retry.routeCertificate?.targetPort).toBe('N')
    expect(yes.routeCertificate?.invariant).toBe('bundle')
    expect(retry.routeCertificate?.invariant).toBe('bundle')
    expect(auditRouteContracts(positioned, graph)).toEqual([])
  })

  it('bi-directional pairs render as TWO EQUAL parallel lines, symmetric about the centerline', () => {
    for (const dir of ['LR', 'TD'] as const) {
      for (const shapes of [['{One}', '{Two}'], ['[One]', '[Two]']]) {
        const isDiamond = shapes[0] === '{One}'
        const positioned = layoutGraphSync(parseMermaid(
          `flowchart ${dir}\n  Q${shapes[0]} --> R${shapes[1]}\n  R --> Q`))
        const fwd = findEdge(positioned.edges, 'Q', 'R')
        const back = findEdge(positioned.edges, 'R', 'Q')
        expect(fwd.points.length).toBe(2)
        expect(back.points.length).toBe(2)
        const cross = dir === 'LR' ? 'y' as const : 'x' as const
        const main = dir === 'LR' ? 'x' as const : 'y' as const
        const q = positioned.nodes.find(n => n.id === 'Q')!
        const center = q[cross] + (cross === 'y' ? q.height : q.width) / 2
        // Symmetric about the centerline: equal distance, opposite sides.
        // Diamond-diamond pairs (G) part at the NEAREST facet-mids: each line
        // emits from its OWN source diamond's facet-mid (offset = size/4), so
        // the two-sided symmetry holds up to the diamonds' size difference
        // (heights vary slightly with the inscribed label). Rect-like pairs
        // keep the exact center ± SEP/2 symmetry.
        const symTol = isDiamond ? 1.5 : 0.5
        expect(Math.abs(Math.abs(fwd.points[0]![cross] - center) - Math.abs(back.points[0]![cross] - center))).toBeLessThan(symTol)
        // ...on opposite sides, separated enough for the arrowheads...
        expect(Math.abs(fwd.points[0]![cross] - back.points[0]![cross])).toBeGreaterThanOrEqual(8)
        // ...and equal in length (diamond facets shorten the line by their
        // size/4 distance from the vertex, equal for the symmetric pair).
        const len = (e: typeof fwd) => Math.abs(e.points[1]![main] - e.points[0]![main])
        expect(Math.abs(len(fwd) - len(back))).toBeLessThan(isDiamond ? 1.5 : 0.5)
        if (isDiamond) {
          // Diamond-diamond: source ends land on facet-mids (NE/SW for LR,
          // rotated per direction); never on a vertex (the lines run BETWEEN
          // the diamonds, not through a point).
          expect(['NE', 'SE', 'SW', 'NW']).toContain(fwd.routeCertificate?.sourcePort ?? '')
          expect(['NE', 'SE', 'SW', 'NW']).toContain(back.routeCertificate?.sourcePort ?? '')
        }
      }
    }
  })

  // The vertex a chained diamond emits from, and the one it enters, per flow
  // direction: the leading and trailing vertices, never a facet midpoint.
  it.each([
    ['LR', 'E', 'W'],
    ['RL', 'W', 'E'],
    ['TD', 'S', 'N'],
    ['BT', 'N', 'S'],
  ] as const)('%s: a chain of diamonds runs vertex to vertex', (dir, sourcePort, targetPort) => {
    const positioned = layoutGraphSync(parseMermaid(`flowchart ${dir}\n  Q1{One} --> Q2{Two} --> Q3{Three}`))
    for (const [from, to] of [['Q1', 'Q2'], ['Q2', 'Q3']] as const) {
      const e = findEdge(positioned.edges, from, to)
      expect({ edge: `${from}->${to}`, points: e.points.length, sourcePort: e.routeCertificate?.sourcePort, targetPort: e.routeCertificate?.targetPort })
        .toEqual({ edge: `${from}->${to}`, points: 2, sourcePort, targetPort })
    }
  })

  it('diamond-to-diamond with misaligned centers: the source vertex wins (lines emit from points)', () => {
    // Fan-in pulls Q2 off Q1's centerline; both vertices cannot be on one
    // straight lane, and the emit rule prefers the source's sharp bit.
    const positioned = layoutGraphSync(parseMermaid(`flowchart LR
  Q1{First} -- go --> Q2{Second}
  X[Side input] --> Q2`))
    const e = findEdge(positioned.edges, 'Q1', 'Q2')
    expect(e.routeCertificate?.sourcePort).toBe('E')
    expect(e.points.length).toBeLessThanOrEqual(4)
  })
})

describe('route contracts — properties', () => {
  // Pinned seed: unpinned runs made the certificate-completeness property a
  // random CI flake (~1 run in 7; issue #83). This is the exact seed whose
  // generated counterexample exposed #83 — with the fix it passes, so the old
  // counterexample class is now a permanent deterministic regression check.
  // Pin at each assertion instead of mutating process-global configuration,
  // so the regression seed stays exact without touching the preload's global
  // seed that every other suite relies on (fc-seed-policy.test.ts).
  const ROUTE_CONTRACT_SEED = -1377631277

  const flowchartArb = fc
    .record({
      nodeCount: fc.integer({ min: 3, max: 7 }),
      edgePicks: fc.array(
        // The 4th element samples the wider edge-syntax vocabulary (issue #37):
        // every line style, direction, and marker reaches the route contracts.
        fc.tuple(fc.nat(6), fc.nat(6), fc.constantFrom('', '', '', 'yes', 'No', 'on error'), fc.nat(EDGE_FORMS.length - 1)),
        { minLength: 2, maxLength: 10 },
      ),
      direction: fc.constantFrom('LR', 'TD', 'RL', 'BT'),
    })
    .map(({ nodeCount, edgePicks, direction }) => {
      const names = Array.from({ length: nodeCount }, (_, i) => `N${i}`)
      const lines = edgePicks
        .map(([a, b, label, form]) => [names[a % nodeCount]!, names[b % nodeCount]!, label, form] as const)
        .filter(([a, b]) => a !== b)
        .map(([a, b, label, form]) => `  ${renderEdgeLine(a, b, EDGE_FORMS[form]!, label)}`)
      if (lines.length === 0) lines.push(`  ${names[0]} --> ${names[1]}`)
      return `flowchart ${direction}\n${lines.join('\n')}`
    })

  function layout(source: string): { graph: ReturnType<typeof parseMermaid>; positioned: PositionedGraph } {
    const graph = parseMermaid(source)
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    return { graph, positioned }
  }

  it('every edge gets a certificate and no unexplained hitch survives the pipeline', () => {
    fc.assert(
      fc.property(flowchartArb, source => {
        const { graph, positioned } = layout(source)
        for (const e of positioned.edges) {
          if (e.routeCertificate === undefined) return false
        }
        return findRouteHitches(positioned, graph).length === 0
      }),
      fcParameters({ numRuns: 60, seed: ROUTE_CONTRACT_SEED }),
    )
  })

  it('straightened routes are two-point, axis-aligned, and end on the node bbox boundary', () => {
    fc.assert(
      fc.property(flowchartArb, source => {
        const { positioned } = layout(source)
        const nodeMap = new Map(positioned.nodes.map(n => [n.id, n]))
        for (const e of positioned.edges) {
          if (!e.routeCertificate?.straightened) continue
          if (e.points.length !== 2) return false
          const [a, b] = e.points as [{ x: number; y: number }, { x: number; y: number }]
          if (Math.abs(a.x - b.x) > 0.01 && Math.abs(a.y - b.y) > 0.01) return false
          for (const [p, id] of [[a, e.source], [b, e.target]] as const) {
            const n = nodeMap.get(id)!
            const onX = Math.abs(p.x - n.x) < 0.01 || Math.abs(p.x - (n.x + n.width)) < 0.01
            const onY = Math.abs(p.y - n.y) < 0.01 || Math.abs(p.y - (n.y + n.height)) < 0.01
            const inside = p.x >= n.x - 0.01 && p.x <= n.x + n.width + 0.01 &&
              p.y >= n.y - 0.01 && p.y <= n.y + n.height + 0.01
            if (!(inside && (onX || onY))) return false
          }
        }
        return true
      }),
      fcParameters({ numRuns: 60, seed: ROUTE_CONTRACT_SEED }),
    )
  })

  it('layout output is deterministic across repeated runs', () => {
    fc.assert(
      fc.property(flowchartArb, source => {
        const a = JSON.stringify(layoutGraphSync(parseMermaid(source)).edges.map(e => [e.points, e.routeCertificate]))
        const b = JSON.stringify(layoutGraphSync(parseMermaid(source)).edges.map(e => [e.points, e.routeCertificate]))
        return a === b
      }),
      fcParameters({ numRuns: 30, seed: ROUTE_CONTRACT_SEED }),
    )
  })
})

describe('DECISION_BRANCH_UNLABELED lint (ISO 5807 10.3.1.2 / ANSI X3.5 4.10.2)', () => {
  it('fires once per unlabeled branch of a multi-exit decision', () => {
    const { warnings } = verifyMermaid('flowchart LR\n  Q{Decide} -- yes --> A[Go]\n  Q --> B[Stop]')
    const hits = warnings.filter(w => w.code === 'DECISION_BRANCH_UNLABELED')
    expect(hits).toEqual([{ code: 'DECISION_BRANCH_UNLABELED', node: 'Q', edge: 'Q->B#0' }])
  })

  it('stays silent for fully labeled decisions, single exits, and non-diamonds', () => {
    for (const src of [
      'flowchart LR\n  Q{Decide} -- yes --> A[Go]\n  Q -- no --> B[Stop]',
      'flowchart LR\n  Q{Decide} --> A[Only]',
      'flowchart LR\n  Q[Box] --> A[One]\n  Q --> B[Two]',
    ]) {
      expect(verifyMermaid(src).warnings.filter(w => w.code === 'DECISION_BRANCH_UNLABELED')).toEqual([])
    }
  })
})

describe('node repairs retain terminal axes around measured headers', () => {
const repair = rerouteEdgesThroughNodes
const cross=(a:any,b:any,box:any)=>a.x===b.x?a.x>box.x&&a.x<box.x+box.width&&Math.max(a.y,b.y)>box.y&&Math.min(a.y,b.y)<box.y+box.height:a.y===b.y&&a.y>box.y&&a.y<box.y+box.height&&Math.max(a.x,b.x)>box.x&&Math.min(a.x,b.x)<box.x+box.width
const clear=(path:any[],box:any)=>path.slice(1).every((b,i)=>!cross(path[i],b,box))
const sameRay=(port:any,old:any,next:any)=>old.x===port.x&&next.x===port.x&&Math.sign(old.y-port.y)===Math.sign(next.y-port.y)||old.y===port.y&&next.y===port.y&&Math.sign(old.x-port.x)===Math.sign(next.x-port.x)
for(const transpose of[false,true])for(const mirror of[false,true])for(const reverse of[false,true])it(`terminal ray and live header: transpose=${transpose}, mirror=${mirror}, reverse=${reverse}`,()=>{
 const p=(x:number,y:number)=>{if(mirror)x=500-x;return transpose?{x:y,y:x}:{x,y}}
 const box=(id:string,x:number,y:number,w:number,h:number)=>{const a=p(x,y),b=p(x+w,y+h);return{id,label:id,shape:'rectangle' as const,x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)}}
 const nodes=[box('S',220,40,40,40),box('T',80,330,100,40),box('B',240,330,110,40)]
 const bands=[box('outer-header',50,120,330,28),box('nested-header',65,285,300,28)]
 const groups=bands.map((b,i)=>({...b,headerHeight:b.height,height:i===0?1:b.height,children:[]})) // Retained band may extend beyond the frame.
 let points=[[240,80],[240,110],[400,110],[400,350],[180,350]].map(([x,y])=>p(x!,y!));if(reverse)points=points.toReversed()
 const edge={source:reverse?'T':'S',target:reverse?'S':'T',style:'solid' as const,hasArrowStart:false,hasArrowEnd:true,endMarker:'arrow' as const,edgeIndex:0,points}
 const old=structuredClone(points);let work=0
 repair(nodes,[edge],{direction:transpose?(reverse?'RL':'LR'):(reverse?'BT':'TB')},(n:number)=>work+=n,groups)
 expect(edge.points[0]).toEqual(old[0]);expect(edge.points.at(-1)).toEqual(old.at(-1));expect(sameRay(old[0],old[1],edge.points[1])).toBe(true);expect(sameRay(old.at(-1),old.at(-2),edge.points.at(-2))).toBe(true)
 for(const b of[...nodes,...bands])expect(clear(edge.points,b)).toBe(true)
 expect(edge.hasArrowEnd).toBe(true);expect(edge.endMarker).toBe('arrow');expect(work).toBeGreaterThan(0)
 const duplicate=structuredClone({...edge,points:old});repair(nodes,[duplicate],{direction:transpose?(reverse?'RL':'LR'):(reverse?'BT':'TB')},()=>{},groups);expect(duplicate.points).toEqual(edge.points)
})
for(const headerCase of ['remote', 'none', 'zero-width'] as const)it('new terminal detour cannot traverse its own endpoint body / '+headerCase,()=>{
 const nodes=[{id:'S',label:'S',shape:'rectangle' as const,x:25,y:20,width:10,height:10},{id:'T',label:'T',shape:'rectangle' as const,x:50,y:35,width:10,height:10},{id:'B',label:'B',shape:'rectangle' as const,x:15,y:35,width:5,height:10}]
 const points=[[35,25],[45,25],[45,0],[10,0],[10,40],[50,40]].map(([x,y])=>({x:x!,y:y!})),old=structuredClone(points)
 const edge={source:'S',target:'T',style:'solid' as const,hasArrowStart:false,hasArrowEnd:true,points}
 const group={id:'remote',label:'remote',x:0,y:-20,width:100,height:10,headerHeight:10,children:[]}
 repair(nodes,[edge],{direction:'LR'},()=>{},headerCase==='none'?[]:headerCase==='zero-width'?[{...group,width:0,headerHeight:undefined}]:[group])
 for(const n of nodes)expect(clear(edge.points,n)).toBe(true)
 expect(sameRay(old[0],old[1],edge.points[1])).toBe(true);expect(sameRay(old.at(-1),old.at(-2),edge.points.at(-2))).toBe(true)
})
it('new terminal detour never changes a simple route into selfcontact',()=>{
 const nodes=[{id:'S',label:'S',shape:'rectangle' as const,x:-10,y:-5,width:10,height:10},{id:'T',label:'T',shape:'rectangle' as const,x:100,y:5,width:10,height:10},{id:'B',label:'B',shape:'rectangle' as const,x:50,y:5,width:10,height:10}]
 const points=[[0,0],[30,0],[30,-20],[-20,-20],[-20,10],[100,10]].map(([x,y])=>({x:x!,y:y!})),old=structuredClone(points)
 const edge={source:'S',target:'T',style:'solid' as const,hasArrowStart:false,hasArrowEnd:true,points}
 const groups=[{id:'G1',label:'G1',x:11,y:-4,width:2,height:3,headerHeight:3,children:[]},{id:'G2',label:'G2',x:11,y:1,width:2,height:36,headerHeight:36,children:[]}]
 repair(nodes,[edge],{direction:'LR'},()=>{},groups)
 // Independent exact integer-cell walk catches crossings, overlaps and touches.
 const visited=new Set([`${edge.points[0]!.x},${edge.points[0]!.y}`]);let repeated=false
 for(let i=1;i<edge.points.length;i++){const a=edge.points[i-1]!,b=edge.points[i]!,dx=Math.sign(b.x-a.x),dy=Math.sign(b.y-a.y);expect(dx===0||dy===0).toBe(true);let x=a.x,y=a.y;while(x!==b.x||y!==b.y){x+=dx;y+=dy;const key=`${x},${y}`;if(visited.has(key))repeated=true;visited.add(key)}}
 expect(repeated).toBe(false)
 // Both bounded replacement lanes are obstructed; keep the original failure.
 expect(edge.points).toEqual(old);expect(edge.hasArrowEnd).toBe(true)
})
it('website Cloud source retains all authored nodes, groups, markers and clear literal bands',async()=>{
 const source="graph TD\n  subgraph Cloud\n    subgraph us-east [US East Region]\n      A[Web Server] --> B[App Server]\n    end\n    subgraph us-west [US West Region]\n      C[Web Server] --> D[App Server]\n    end\n  end\n  E[Load Balancer] --> A\n  E --> C"
 const result=renderMermaidSVGWithReceipt(source,{idPrefix:'cloud-owner-'})
 expect(result.receipt.layoutCertification?.status).toBe('passed')
 const tags=[...result.svg.matchAll(/<polyline\b[^>]*data-from="([^"]+)"[^>]*data-to="([^"]+)"[^>]*>/g)]
 expect(tags.map(m=>`${m[1]}->${m[2]}`).sort()).toEqual(['A->B','C->D','E->A','E->C']);expect(tags.every(m=>m[0].includes('marker-end='))).toBe(true)
 for(const id of['A','B','C','D','E'])expect(result.svg).toContain(`data-id="${id}"`)
 expect(result.svg).toContain('data-id="us-east" data-region="subgraph" data-label="US East Region" data-parent-id="Cloud"');expect(result.svg).toContain('data-id="us-west" data-region="subgraph" data-label="US West Region" data-parent-id="Cloud"')
 // Literal measured default headers: independent coordinate oracle, not routing helper.
 const headers=[...result.svg.matchAll(/<g\b[^>]*data-region="subgraph"[^>]*>\s*<rect\b[^>]*>\s*<path\b[^>]*d="([^"]+)"/g)]
 expect(headers).toHaveLength(3)
 const bands=headers.map(m=>{const n=m[1]!.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)!.map(Number);expect(n).toHaveLength(5);expect(n[3]!-n[1]!).toBe(28);return{x:n[0]!,y:n[1]!,width:n[2]!-n[0]!,height:n[3]!-n[1]!}})
 for(const m of tags){const pts=/points="([^"]+)"/.exec(m[0])![1]!.split(/\s+/).map(s=>{const[x,y]=s.split(',').map(Number);return{x,y}});for(const b of bands)expect(clear(pts,b)).toBe(true)}
})

})

describe('port-lane reserved-header admission', () => {
  const n = (id: string, x: number, y: number, width = 40, height = 30): PositionedNode => ({ id, label: id, shape: 'rectangle', x, y, width, height })
  const e = (source: string, target: string, points: Point[]): PositionedEdge => ({ source, target, points, style: 'solid', hasArrowStart: false, hasArrowEnd: true })
  const g = (x: number, y: number, width: number, height: number, headerHeight = height): PositionedGroup => ({ id: 'G', label: 'G', x, y, width, height, headerHeight, children: [] })
  const stairs = () => ({ nodes: [n('S', 0, 100), n('T', 100, 0)], edges: [e('S', 'T', [{ x: 40, y: 115 }, { x: 70, y: 115 }, { x: 70, y: 15 }, { x: 100, y: 15 }])] })

  for (const width of ['20', '20px', '1em', 'var(--edge-width)']) it(`does not slide a card into an unchanged foreign ${width} shaft`, () => {
    const { nodes, edges } = stairs()
    nodes.push(n('U', 134, 40, 30, 20), n('V', 134, 170, 30, 20))
    edges.push({ ...e('U', 'V', [{ x: 149, y: 60 }, { x: 149, y: 170 }]), inlineStyle: { 'stroke-width': width } })
    const before = structuredClone({ nodes, edges })
    // Candidate T is x100..140/y100..130. The x149 centreline clears it,
    // but a 20px shaft reaches x139; relative/CSS widths cannot prove a gap.
    alignPortLanes(nodes, edges, [], 'LR', resolveRenderStyle())
    expect({ nodes, edges }).toEqual(before)
  })

  it('keeps the same slide when the authored foreign shaft has a real ink gap', () => {
    const { nodes, edges } = stairs()
    nodes.push(n('U', 134, 40, 30, 20), n('V', 134, 170, 30, 20))
    edges.push({ ...e('U', 'V', [{ x: 149, y: 60 }, { x: 149, y: 170 }]), inlineStyle: { 'stroke-width': '16' } })
    alignPortLanes(nodes, edges, [], 'LR', resolveRenderStyle())
    expect(nodes[1]!.y).toBe(100)
    expect(edges[1]!.points).toEqual([{ x: 149, y: 60 }, { x: 149, y: 170 }])
  })

  for (const width of ['20', '2']) it(`${width === '20' ? 'refuses' : 'admits'} the changed shaft beside a live header using its painted width`, () => {
    const { nodes, edges } = stairs()
    edges[0]!.inlineStyle = { 'stroke-width': width }
    const before = structuredClone({ nodes, edges })
    // Only the rewritten terminal run reaches x85..90 at y115. Its 20px
    // ink enters y124; the narrow control and both node bodies stay clear.
    alignPortLanes(nodes, edges, [g(85, 124, 5, 5)], 'LR', resolveRenderStyle())
    if (width === '20') expect({ nodes, edges }).toEqual(before)
    else expect(nodes[1]!.y).toBe(100)
  })

  for (const width of ['20', '2']) it(`${width === '20' ? 'refuses' : 'admits'} a rewritten shaft beside a foreign card`, () => {
    const { nodes, edges } = stairs()
    nodes.push(n('Foreign', 85, 124, 5, 5))
    edges[0]!.inlineStyle = { 'stroke-width': width }
    const before = structuredClone({ nodes, edges })
    alignPortLanes(nodes, edges, [], 'LR', resolveRenderStyle())
    if (width === '20') expect({ nodes, edges }).toEqual(before)
    else expect(nodes[1]!.y).toBe(100)
  })

  for (const marked of [true, false]) it(`${marked ? 'refuses the endpoint marker' : 'admits the unmarked shaft'} beside the same foreign card`, () => {
    const { nodes, edges } = stairs()
    nodes.push(n('Foreign', 91, 119.2, 0.7, 0.5))
    edges[0]!.inlineStyle = { 'stroke-width': '1' }
    edges[0]!.hasArrowEnd = marked
    const before = structuredClone({ nodes, edges })
    // The fixed custom-width arrow's back corner is (92,119), with a
    // 0.375px round stroke. The shaft and old arrow at y15 are clear.
    alignPortLanes(nodes, edges, [], 'LR', resolveRenderStyle())
    if (marked) expect({ nodes, edges }).toEqual(before)
    else expect(nodes[1]!.y).toBe(100)
  })

  for (const width of ['20', '16']) it(`${width === '20' ? 'refuses' : 'keeps'} the labelled-source slide beside a foreign painted shaft`, () => {
    const graph = parseMermaid('flowchart LR\nS -->|go| T\nU --> V')
    const nodes = [n('S', 0, 0, 40, 100), n('T', 120, 80), n('U', -70, 144, 20, 20), n('V', 80, 144, 20, 20)]
    const edges = [{ ...e('S', 'T', [{ x: 40, y: 95 }, { x: 120, y: 95 }]), label: 'go', labelPosition: { x: 80, y: 95 } },
      { ...e('U', 'V', [{ x: -50, y: 154 }, { x: 80, y: 154 }]), inlineStyle: { 'stroke-width': width } }]
    const before = structuredClone({ nodes, edges })
    // Recentring S on y95 puts its bottom at145. The y154 centreline
    // clears the moved body, while the 20px shaft reaches y144.
    alignLabeledSourcePort(nodes, edges, [], graph, 'LR', resolveRenderStyle())
    if (width === '20') expect({ nodes, edges }).toEqual(before)
    else {
      expect(nodes[0]!.y).toBe(45)
      expect(edges[0]!.labelPosition).toEqual({ x: 80, y: 95 })
    }
  })

  it('retains the clear compound detour from chained hubs 355 instead of sweeping its terminal run through G', () => {
    // Literal saved pre-alignPortLanes SEPARATE geometry, not a producer call.
    const nodes = [n('H2', 236.34675, 216.89999999999998, 85.66899999999998, 36.900000000000006), n('Z', 535.3045, 40, 64.17999999999999, 36.900000000000006)]
    const edges = [e('H2', 'Z', [{ x: 279.18125, y: 216.89999999999998 }, { x: 279.18125, y: 168.89999999999998 }, { x: 557.3945, y: 168.89999999999998 }, { x: 567.3945, y: 168.89999999999998 }, { x: 567.3945, y: 76.9 }])]
    const before = structuredClone({ nodes, edges })
    alignPortLanes(nodes, edges, [g(40, 124.89999999999998, 517.3945, 653.324, 28)], 'BT', resolveRenderStyle())
    expect(nodes).toEqual(before.nodes)
    expect(edges).toEqual(before.edges)
  })

  it('rejects a moved node footprint entering a header even when its new shaft stays outside the band', () => {
    const { nodes, edges } = stairs(), before = structuredClone({ nodes, edges })
    alignPortLanes(nodes, edges, [g(110, 120, 20, 5)], 'LR', resolveRenderStyle())
    expect(nodes).toEqual(before.nodes)
    expect(edges).toEqual(before.edges)
  })

  for (const child of [false, true]) it(`rejects a stretched incident hop through a ${child ? 'nested' : 'direct'} header`, () => {
    const { nodes, edges } = stairs()
    nodes.push(n('U', 300, 55))
    edges.push(e('T', 'U', [{ x: 140, y: 15 }, { x: 160, y: 15 }, { x: 160, y: 70 }, { x: 300, y: 70 }]))
    const band = g(150, 85, 20, 10)
    // The far endpoint belongs to a separate zero-header region and cannot
    // travel with T; the actual stretched hop must still clear the band.
    const pin = { ...g(280, 40, 80, 80, 0), id: 'Pin' }
    const groups = child ? [{ ...g(500, 500, 20, 20, 0), children: [band] }, pin] : [band, pin]
    const before = structuredClone({ nodes, edges })
    alignPortLanes(nodes, edges, groups, 'LR', resolveRenderStyle())
    expect(nodes).toEqual(before.nodes)
    expect(edges).toEqual(before.edges)
  })

  it('still performs the clear alignment with an unrelated live header', () => {
    const { nodes, edges } = stairs()
    alignPortLanes(nodes, edges, [g(400, 400, 40, 28)], 'LR', resolveRenderStyle())
    expect(nodes.find(node => node.id === 'T')!.y).toBe(100)
    expect(edges[0]!.points.at(-1)).toEqual({ x: 100, y: 115 })
  })

  for (const kind of ['zero-width', 'zero-height', 'concurrency'] as const) it(`retains the legal ${kind} header control`, () => {
    const { nodes, edges } = stairs()
    const band = kind === 'zero-width' ? g(110, 100, 0, 30) : kind === 'zero-height' ? g(110, 100, 20, 0)
      : { ...g(110, 100, 20, 30), concurrencyRegion: true as const }
    alignPortLanes(nodes, edges, [band], 'LR', resolveRenderStyle())
    expect(nodes.find(node => node.id === 'T')!.y).toBe(100)
    expect(edges[0]!.points.at(-1)).toEqual({ x: 100, y: 115 })
  })

  it('refuses raw exterior contact when the moved card border enters the header', () => {
    const { nodes, edges } = stairs(), before = structuredClone({ nodes, edges })
    // The former raw-box control touched at y130, but its 0.75px border
    // paints beyond that face and therefore is not an exterior ink contact.
    alignPortLanes(nodes, edges, [g(110, 130, 20, 5)], 'LR', resolveRenderStyle())
    expect({ nodes, edges }).toEqual(before)
  })

  for (const width of ['20', '0.75']) it(`${width === '20' ? 'refuses' : 'admits'} the same moved card beside a header using its border ink`, () => {
    const { nodes, edges } = stairs()
    nodes[1]!.inlineStyle = { 'stroke-width': width }
    const before = structuredClone({ nodes, edges })
    // The candidate raw bottom is130. Its thick border reaches140 and
    // enters the y135 header; the narrow-border control retains a real gap.
    alignPortLanes(nodes, edges, [g(110, 135, 20, 5)], 'LR', resolveRenderStyle())
    if (width === '20') expect({ nodes, edges }).toEqual(before)
    else expect(nodes[1]!.y).toBe(100)
  })

  it('does not turn an unchanged pre-existing bad edge into a veto of an unrelated clear move', () => {
    const { nodes, edges } = stairs()
    edges.push(e('outside-a', 'outside-b', [{ x: 410, y: 390 }, { x: 410, y: 450 }]))
    const old = structuredClone(edges[1])
    alignPortLanes(nodes, edges, [g(400, 400, 40, 28)], 'LR', resolveRenderStyle())
    expect(nodes.find(node => node.id === 'T')!.y).toBe(100)
    expect(edges[1]).toEqual(old)
  })
})

describe('port-lane foreign painted corridors', () => {
  it('retains a foreign cubic marker when serving collapses its raw horizontal tangent', () => {
    const x = 100.12345678912345, endX = 100.1234567891235
    const node = (id: string, x: number, y: number): PositionedNode => ({ id, label: id, shape: 'rectangle', x, y, width: 40, height: 40 })
    const nodes = [node('F', -100, 52), node('N', 102.5, 50), node('C', x - 20, -40), node('D', endX - 20, 100)]
    const edges: PositionedEdge[] = [
      { source: 'F', target: 'N', style: 'solid', hasArrowStart: false, hasArrowEnd: false, points: [{ x: -60, y: 72 }, { x: 80, y: 72 }, { x: 80, y: 70 }, { x: 102.5, y: 70 }] },
      { source: 'C', target: 'D', style: 'solid', hasArrowStart: false, hasArrowEnd: true, curve: 'basis', points: [{ x, y: 0 }, { x: endX, y: 100 }] },
    ]
    const groups: PositionedGroup[] = nodes.filter(n => n.id !== 'N').map(n => ({ id: `pin-${n.id}`, label: '', x: n.x - 1, y: n.y - 1, width: 42, height: 42, headerHeight: 0, children: [] }))
    const style = { ...resolveRenderStyle(), nodeLineWidth: .75, cornerRadius: 0, lineWidth: 1, edgeBendRadius: 0 }
    const before = structuredClone({ nodes, edges }), projection = graphEdgePathProjection(edges[1]!, style)!
    if (projection.geometry.kind !== 'path') throw new Error('expected cubic path')
    const written = formatSvgNumericAttribute('d', projection.geometry.d)
    const values = [...written.matchAll(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)].map(match => Number(match[0]))
    expect(values).toHaveLength(8)
    expect([values[0], values[2], values[4], values[6]]).toEqual(Array(4).fill(values[0]))
    alignPortLanes(nodes, edges, groups, 'LR', style)
    // The served cubic is vertical. This point lies inside its 8×5 arrow
    // triangle and inside the proposed card's bottom border at y=92.
    const witness = { x: 102.55, y: 92.1 }, moved = nodes[1]!
    expect(witness.y > 92 && witness.y < 100 && Math.abs(witness.x - values[6]!) < 2.5 * (100 - witness.y) / 8).toBe(true)
    expect(witness.x > moved.x && witness.x < moved.x + moved.width && Math.abs(witness.y - (moved.y + moved.height)) < .375).toBe(false)
    expect({ nodes, edges }).toEqual(before)
  })
  for (const transpose of [false, true]) for (const clear of [false, true]) it(`${transpose ? 'vertical' : 'horizontal'} slide preserves ${clear ? 'clear' : 'overlapping'} authored thick card borders`, () => {
    const nodes: PositionedNode[] = [
      { id: 'S', label: 'S', shape: 'rectangle', x: 0, y: 100, width: 40, height: 30 },
      { id: 'T', label: 'T', shape: 'rectangle', x: 100, y: 0, width: 40, height: 30, inlineStyle: { 'stroke-width': '12px' } },
      { id: 'U', label: 'U', shape: 'rectangle', x: clear ? 156 : 150, y: 105, width: 40, height: 30, inlineStyle: { 'stroke-width': '12px' } },
    ]
    const edges: PositionedEdge[] = [{ source: 'S', target: 'T', style: 'solid', hasArrowStart: false, hasArrowEnd: false, points: [{ x: 40, y: 115 }, { x: 70, y: 115 }, { x: 70, y: 15 }, { x: 100, y: 15 }] }]
    const pin: PositionedGroup = { id: 'pin', label: '', x: -1, y: 99, width: 42, height: 32, headerHeight: 0, children: [] }
    if (transpose) {
      for (const n of [...nodes, pin]) { [n.x, n.y] = [n.y, n.x]; [n.width, n.height] = [n.height, n.width] }
      for (const p of edges[0]!.points) [p.x, p.y] = [p.y, p.x]
    }
    const before = structuredClone({ nodes, edges })
    alignPortLanes(nodes, edges, [pin], transpose ? 'TD' : 'LR', resolveRenderStyle())
    const t = nodes[1]!, u = nodes[2]!
    // Rectangular12px outlines extend exactly6px beyond each side.
    expect(t.x - 6 < u.x + u.width + 6 && u.x - 6 < t.x + t.width + 6 && t.y - 6 < u.y + u.height + 6 && u.y - 6 < t.y + t.height + 6).toBe(false)
    if (clear) expect(transpose ? t.x : t.y).toBe(100)
    else expect({ nodes, edges }).toEqual(before)
  })
  for (const transpose of [false, true]) for (const clear of [false, true]) it(`${transpose ? 'vertical' : 'horizontal'} foreign shaft ${clear ? 'retains a safe alignment' : 'cannot be covered by a moved card'}`, () => {
    const node = (id: string, x: number, y: number): PositionedNode => ({ id, label: id, shape: 'rectangle', x, y, width: 40, height: 30 })
    const edge = (source: string, target: string, points: Point[]): PositionedEdge => ({ source, target, points, style: 'solid', hasArrowStart: false, hasArrowEnd: false })
    const lane = clear ? 136 : 130.2
    const nodes = [node('S', 0, 100), node('T', 100, 0), node('A', -100, lane - 15), node('B', 300, lane - 15)]
    const edges = [edge('S', 'T', [{ x: 40, y: 115 }, { x: 70, y: 115 }, { x: 70, y: 15 }, { x: 100, y: 15 }]), edge('A', 'B', [{ x: -60, y: lane }, { x: 300, y: lane }])]
    const pin: PositionedGroup = { id: 'pin', label: '', x: -1, y: 99, width: 42, height: 32, headerHeight: 0, children: [] }
    if (transpose) {
      for (const n of [...nodes, pin]) { [n.x, n.y] = [n.y, n.x]; [n.width, n.height] = [n.height, n.width] }
      for (const e of edges) for (const p of e.points) [p.x, p.y] = [p.y, p.x]
    }
    const before = structuredClone({ nodes, edges }), style = resolveRenderStyle()
    alignPortLanes(nodes, edges, [pin], transpose ? 'TD' : 'LR', style)
    const t = nodes[1]!, a = edges[1]!.points[0]!, b = edges[1]!.points[1]!, half = style.lineWidth / 2, border = style.nodeLineWidth / 2
    // Independent actual continuous shaft and card-border rectangles. The old
    // centerline test admits the .2px gap while both painted interiors overlap.
    const px = a.x === b.x ? half : 0, py = a.y === b.y ? half : 0
    const overlap = Math.min(Math.max(a.x, b.x) + px, t.x + t.width + border) > Math.max(Math.min(a.x, b.x) - px, t.x - border)
      && Math.min(Math.max(a.y, b.y) + py, t.y + t.height + border) > Math.max(Math.min(a.y, b.y) - py, t.y - border)
    expect(overlap).toBe(false)
    expect(edges[1]).toEqual(before.edges[1])
    if (clear) expect(transpose ? t.x : t.y).toBe(100)
    else expect({ nodes, edges }).toEqual(before)
  })
  for (const transpose of [false, true]) it(`retains a clear foreign circle marker during a ${transpose ? 'vertical' : 'horizontal'} slide`, () => {
    const nodes: PositionedNode[] = [
      { id: 'S', label: 'S', shape: 'rectangle', x: 0, y: 100, width: 40, height: 30 },
      { id: 'T', label: 'T', shape: 'rectangle', x: 100, y: 0, width: 40, height: 30 },
      { id: 'A', label: 'A', shape: 'rectangle', x: -100, y: 125.5, width: 40, height: 30 },
      { id: 'B', label: 'B', shape: 'rectangle', x: 120, y: 140, width: 40, height: 1 },
    ]
    const edges: PositionedEdge[] = [
      { source: 'S', target: 'T', style: 'solid', hasArrowStart: false, hasArrowEnd: false, points: [{ x: 40, y: 115 }, { x: 70, y: 115 }, { x: 70, y: 15 }, { x: 100, y: 15 }] },
      { source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: true, endMarker: 'circle', points: [{ x: -60, y: 140.5 }, { x: 120, y: 140.5 }] },
    ]
    const pin: PositionedGroup = { id: 'pin', label: '', x: -1, y: 99, width: 42, height: 32, headerHeight: 0, children: [] }
    if (transpose) {
      for (const n of [...nodes, pin]) { [n.x, n.y] = [n.y, n.x]; [n.width, n.height] = [n.height, n.width] }
      for (const e of edges) for (const p of e.points) [p.x, p.y] = [p.y, p.x]
    }
    const before = structuredClone({ nodes, edges })
    alignPortLanes(nodes, edges, [pin], transpose ? 'TD' : 'LR', resolveRenderStyle({ styleFace: { edge: { lineWidth: 3 } } }))
    // The canonical circle has radius9.75 and halfstroke1.5 at scale3.
    // This actual outline point would be hidden by T at its proposed seat,
    // although the foreign shaft and the endpoint B remain clear of T.
    const p = transpose ? { x: 129.5, y: 109.5 } : { x: 109.5, y: 129.5 }, t = nodes[1]!
    expect(p.x > t.x && p.x < t.x + t.width && p.y > t.y && p.y < t.y + t.height).toBe(false)
    expect({ nodes, edges }).toEqual(before)
  })
})

describe('container crossing repair reuses proven Z lanes', () => {
  const fixture = (labelled = false, peerX = 110) => {
    const graph = parseMermaid(`flowchart TD\nsubgraph one\nP\nend\nsubgraph two\nQ\nend\nU --> V\none -->${labelled ? '|keep|' : ''} two`)
    const positions: Record<string, [number, number, number, number]> = {
      P: [130, 40, 40, 20], Q: [20, 400, 40, 20], U: [peerX, 110, 40, 40], V: [peerX, 220, 40, 20],
    }
    const nodes = [...graph.nodes.values()].map(node => {
      const [x, y, width, height] = positions[node.id]!
      return { ...node, x, y, width, height }
    })
    const groups: PositionedGroup[] = [
      { id: 'one', label: 'one', x: 100, y: 0, width: 100, height: 100, headerHeight: 20, children: [], nodeIds: ['P'] },
      { id: 'two', label: 'two', x: 0, y: 360, width: 80, height: 100, headerHeight: 20, children: [], nodeIds: ['Q'] },
    ]
    const edges: PositionedEdge[] = [
      { ...graph.edges[0]!, edgeIndex: 0, points: [{ x: peerX + 20, y: 150 }, { x: peerX + 20, y: 220 }] },
      { ...graph.edges[1]!, edgeIndex: 1, points: [{ x: 100, y: 100 }, { x: 100, y: 190 }, { x: 160, y: 190 },
        { x: 160, y: 352 }, { x: 40, y: 352 }, { x: 40, y: 360 }], ...(labelled ? { labelPosition: { x: 160, y: 300 } } : {}) },
    ]
    return { graph, positioned: { width: 500, height: 500, nodes, edges, groups } }
  }
  it('a separated container with no common straight lane removes its crossing through a complete clear Z', () => {
    const { graph, positioned } = fixture(), before = structuredClone(graph)
    expect(countEdgeCrossings(positioned.edges)).toBe(1)
    applyRouteContracts(positioned, graph, new Set(), resolveRenderStyle({}))
    expect(countEdgeCrossings(positioned.edges)).toBe(0)
    expect(graph).toEqual(before)
    const edge = positioned.edges[1]!, points = edge.points
    expect(edge.routeCertificate).toMatchObject({ invariant: 'container-attach', bendCount: 2 })
    expect(edge.routeCertificate?.invariant === 'straight').toBe(false)
    expect(points[0]!.y).toBe(100)
    expect(points[1]!.y).toBeGreaterThan(points[0]!.y)
    expect(points.at(-1)!.y).toBe(360)
    expect(points.at(-2)!.y).toBeLessThan(points.at(-1)!.y)
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1]!, b = points[index]!
      expect(a.x === b.x || a.y === b.y).toBe(true)
      for (const box of [...positioned.nodes, ...positioned.groups.map(group => ({ ...group, height: group.headerHeight! }))]) {
        expect(Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width
          && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height).toBe(false)
      }
    }
  })
  it.each(['already clear', 'labelled'] as const)('preserves existing geometry for an %s container route', kind => {
    const { graph, positioned } = fixture(kind === 'labelled', kind === 'already clear' ? 20 : 110)
    const saved = structuredClone(positioned.edges[1]!.points), crossings = countEdgeCrossings(positioned.edges)
    applyRouteContracts(positioned, graph, new Set(), resolveRenderStyle({}))
    expect(positioned.edges[1]!.points).toEqual(saved)
    expect(countEdgeCrossings(positioned.edges)).toBe(crossings)
    expect(positioned.edges[1]!.label).toBe(kind === 'labelled' ? 'keep' : undefined)
  })
  it('the existing total-node quality bound leaves a large container route unchanged', () => {
    const { graph, positioned } = fixture()
    // Four leaves plus two frames start at six subjects;59 extra leaves make65.
    for (let index = 0; index < 59; index++) {
      const node = { id: `Extra${index}`, label: `Extra${index}`, shape: 'rectangle' as const }
      graph.nodes.set(node.id, node)
      positioned.nodes.push({ ...node, x: 500 + index * 40, y: 100, width: 20, height: 20 })
    }
    positioned.width = 3500
    const saved = structuredClone(positioned.edges[1]!.points)
    applyRouteContracts(positioned, graph, new Set(), resolveRenderStyle({}))
    expect(positioned.edges[1]!.points).toEqual(saved)
    expect(countEdgeCrossings(positioned.edges)).toBe(1)
  })
})

it('a crossing container Z cannot borrow a bbox-gap proof for a diamond facet inside that box', () => {
  const graph = parseMermaid('flowchart TD\nD{Diamond}\nsubgraph Target\nT\nend\nsubgraph Band\nend\nP --> Q\nD --> Target')
  const nodes: PositionedNode[] = [
    { id: 'D', label: 'Diamond', shape: 'diamond', x: 100, y: 0, width: 100, height: 100 },
    { id: 'T', label: 'T', shape: 'rectangle', x: 45, y: 160, width: 20, height: 20 },
    { id: 'P', label: 'P', shape: 'rectangle', x: 190, y: 190, width: 15, height: 20 },
    { id: 'Q', label: 'Q', shape: 'rectangle', x: 215, y: 190, width: 10, height: 20 },
  ]
  const groups: PositionedGroup[] = [
    { id: 'Target', label: 'Target', x: 40, y: 120, width: 40, height: 100, headerHeight: 20, children: [], nodeIds: ['T'] },
    { id: 'Band', label: 'Band', x: 100, y: 103, width: 100, height: 10, headerHeight: 10, children: [], nodeIds: [] },
  ]
  const points = [{ x: 175, y: 75 }, { x: 210, y: 75 }, { x: 210, y: 300 }, { x: 20, y: 300 },
    { x: 20, y: 100 }, { x: 60, y: 100 }, { x: 60, y: 120 }]
  const edges: PositionedEdge[] = [
    { ...graph.edges[0]!, edgeIndex: 0, points: [{ x: 205, y: 200 }, { x: 215, y: 200 }] },
    { ...graph.edges[1]!, edgeIndex: 1, points },
  ]
  const saved = structuredClone(points)
  expect(countEdgeCrossings(edges)).toBe(1)
  applyRouteContracts({ nodes, groups, edges }, graph, new Set(), resolveRenderStyle({}))
  // Independent exact diamond interior: |x-150| + |y-50| <50.
  for (let index = 1; index < edges[1]!.points.length; index++) {
    const a = edges[1]!.points[index - 1]!, b = edges[1]!.points[index]!, vertical = a.x === b.x
    const fixed = vertical ? a.x : a.y, center = vertical ? 150 : 50
    const radius = 50 - Math.abs(fixed - center), movingCenter = vertical ? 50 : 150
    expect(radius > 0 && Math.max(Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x), movingCenter - radius)
      < Math.min(Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x), movingCenter + radius)).toBe(false)
  }
  expect(edges[1]!.points).toEqual(saved)
})

describe('unresolved marker-label seats', () => {
  const style = { ...resolveRenderStyle(), edgeLabelFontSize: 11 }
  const graph = () => parseMermaid('flowchart TD\nA-->B\nC-->D')
  const clear = (edge: PositionedEdge, edges: PositionedEdge[]): boolean => {
    const pill = labelRect(edge, style)!, halo = 4
    return edges.every(peer => graphEdgeMarkerPaintRegions(peer, style).every(marker => {
      const b = marker.bounds!
      return !(pill.x - halo < b.x1 && pill.x + pill.w + halo > b.x0 && pill.y - halo < b.y1 && pill.y + pill.h + halo > b.y0)
    }))
  }
  for (const transpose of [false, true]) it.each(['2', '20', 'var(--unknown-width)'])('protects a foreign %s shaft during caption rescue (transpose=' + transpose + ')', width => {
    const point = (x: number, y: number): Point => transpose ? { x: y, y: x } : { x, y }
    const edge: PositionedEdge = { source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: false,
      label: 'handoff', labelPosition: point(150, 100), points: [point(0, 100), point(300, 100)] }
    const rail: PositionedEdge = { source: 'C', target: 'D', style: 'solid', hasArrowStart: false, hasArrowEnd: false,
      inlineStyle: { 'stroke-width': width }, points: [point(150, 0), point(150, 200)] }
    const positioned = { nodes: [], groups: [], edges: [edge, rail] }, before = structuredClone(positioned)
    separateEdgeLabelPills(positioned, graph(), style)
    if (width.startsWith('var(')) {
      expect(positioned).toEqual(before)
      return
    }
    expect(edge.labelPosition).not.toEqual(before.edges[0]!.labelPosition)
    const pill = labelRect(edge, style)!, halfStroke = Number(width) / 2
    const low = transpose ? pill.y - 4 : pill.x - 4
    const high = transpose ? pill.y + pill.h + 4 : pill.x + pill.w + 4
    expect(high < 150 - halfStroke || low > 150 + halfStroke).toBe(true)
    expect(positioned.edges.map(value => value.points)).toEqual(before.edges.map(value => value.points))
    expect(positioned.edges.map(value => [value.source, value.target, value.label])).toEqual(before.edges.map(value => [value.source, value.target, value.label]))
  })
  it.each([0, 1, 2, 3])('seats a short-loop caption without changing its route (quarter turns=%s)', turns => {
    const rotate = (p: Point): Point => { let {x,y}=p; for(let i=0;i<turns;i++)[x,y]=[-y,x]; return {x,y} }
    const edge: PositionedEdge = { source:'A',target:'A',style:'solid',hasArrowStart:false,hasArrowEnd:true,label:'repeat seal',
      points:[{x:130,y:100},{x:130,y:90},{x:170,y:90},{x:170,y:100}].map(rotate),labelPosition:rotate({x:150,y:77.85}) }
    const points=structuredClone(edge.points), before=structuredClone(edge.labelPosition)
    expect(clear(edge,[edge])).toBe(false)
    separateEdgeLabelPills({nodes:[],groups:[],edges:[edge]},graph(),style)
    expect(clear(edge,[edge])).toBe(true)
    expect(edge.labelPosition).not.toEqual(before)
    expect(edge.points).toEqual(points)
  })
  it('reseats a blocking caption jointly even without a current label-pair conflict', () => {
    const edge: PositionedEdge={source:'A',target:'B',style:'solid',hasArrowStart:false,hasArrowEnd:true,label:'inspect package',points:[{x:100,y:0},{x:100,y:122.9}],labelPosition:{x:100,y:102.41666666666667}}
    const peer: PositionedEdge={source:'C',target:'D',style:'solid',hasArrowStart:false,hasArrowEnd:false,label:'secondary validation café',points:[{x:-4.214625,y:24},{x:-4.214625,y:122.9}],labelPosition:{x:-4.214625,y:61.05}}
    const nodes: PositionedNode[]=[{id:'A',label:'A',shape:'rectangle',x:55,y:-48.9,width:88,height:48.9}]
    const positioned={nodes,groups:[],edges:[edge,peer]}, before=structuredClone(positioned)
    expect(clear(edge,positioned.edges)).toBe(false)
    separateEdgeLabelPills(positioned,graph(),style)
    expect(clear(edge,positioned.edges)).toBe(true)
    expect(peer.labelPosition).not.toEqual(before.edges[1]!.labelPosition)
    expect(positioned.nodes).toEqual(before.nodes)
    expect(positioned.edges.map(e=>e.points)).toEqual(before.edges.map(e=>e.points))
  })
})


describe('marker-label rescue refusal and custody', () => {
  const style={...resolveRenderStyle(),edgeLabelFontSize:11}, graph=parseMermaid('flowchart TD\nA-->A\nC-->D')
  const loop=():PositionedEdge=>({source:'A',target:'A',style:'solid',hasArrowStart:false,hasArrowEnd:true,label:'repeat seal',points:[{x:130,y:100},{x:130,y:90},{x:170,y:90},{x:170,y:100}],labelPosition:{x:150,y:77.85}})
  it.each(['unknown-ink','no-room','work-exhausted'] as const)('retains the complete original when rescue has %s',mode=>{
    const edge=loop(),edges=[edge]
    const nodes:PositionedNode[]=mode==='no-room'?[{id:'wall',label:'wall',shape:'rectangle',x:-1000,y:-1000,width:2000,height:2000}]:[]
    if(mode!=='no-room')edges.push({source:'C',target:'D',style:'solid',hasArrowStart:false,hasArrowEnd:mode==='unknown-ink',...(mode==='unknown-ink'?{inlineStyle:{'stroke-width':'var(--missing)'}}:{}),points:mode==='work-exhausted'?Array.from({length:2000},(_,i)=>({x:1000+i,y:1000})):[{x:1000,y:1000},{x:1100,y:1000}]})
    const positioned={nodes,groups:[],edges},before=structuredClone(positioned)
    separateEdgeLabelPills(positioned,graph,style)
    expect(positioned).toEqual(before)
  })
  it('retains an already clear legacy layout exactly',()=>{
    const edge:PositionedEdge={source:'C',target:'D',style:'solid',hasArrowStart:false,hasArrowEnd:true,label:'clear',points:[{x:0,y:0},{x:300,y:0}],labelPosition:{x:150,y:0}}
    const positioned={nodes:[],groups:[],edges:[edge]},before=structuredClone(positioned)
    separateEdgeLabelPills(positioned,graph,style)
    expect(positioned).toEqual(before)
  })
  it('keeps a foreign painted shaft and a node body protected',()=>{
    const edge=loop(),rail:PositionedEdge={source:'C',target:'D',style:'thick',hasArrowStart:false,hasArrowEnd:false,points:[{x:0,y:70},{x:300,y:70}]}
    const positioned={nodes:[{id:'A',label:'A',shape:'rectangle' as const,x:100,y:100,width:100,height:50}],groups:[],edges:[edge,rail]},before=structuredClone(edge.labelPosition)
    separateEdgeLabelPills(positioned,graph,style)
    const pill=labelRect(edge,style)!
    if(JSON.stringify(edge.labelPosition)!==JSON.stringify(before))expect(!(pill.y-4<71&&pill.y+pill.h+4>69)).toBe(true)
    expect(rail.points).toEqual([{x:0,y:70},{x:300,y:70}])
    expect(positioned.nodes[0]).toMatchObject({x:100,y:100,width:100,height:50})
  })
})


it('a hidden carrier still reserves its visible caption during marker-label rescue',()=>{
 const style=resolveRenderStyle(),edge:PositionedEdge={source:'A',target:'B',style:'solid',hasArrowStart:false,hasArrowEnd:false,label:'candidate',labelPosition:{x:0,y:0},points:[{x:-100,y:0},{x:100,y:0}]},peer:PositionedEdge={source:'C',target:'D',style:'invisible',hasArrowStart:false,hasArrowEnd:false,label:'protected visible caption',labelPosition:{x:0,y:100},points:[{x:-100,y:100},{x:100,y:100}]}
 const paint=labelSeatPaintContext([], [edge,peer], [],style,()=>true)!
 expect(paint.clear(edge,{x:0,y:100},new Map())).toBe(false)
 expect(paint.clear(edge,{x:0,y:50},new Map())).toBe(true)
})


it('withholds the new overhang rescue for a rounded subject without changing its legacy seat',()=>{
 const edge:PositionedEdge={source:'A',target:'A',style:'solid',hasArrowStart:false,hasArrowEnd:true,label:'repeat seal',points:[{x:130,y:100},{x:130,y:90},{x:170,y:90},{x:170,y:100}],labelPosition:{x:150,y:77.85}}
 const before=structuredClone(edge)
 separateEdgeLabelPills({nodes:[],groups:[],edges:[edge]},parseMermaid('flowchart TD\nA-->A'),{...resolveRenderStyle(),edgeLabelFontSize:11,edgeBendRadius:500})
 expect(edge).toEqual(before)
})


it('label rescue retains full thick header borders while admitting a separated seat',()=>{
 const style=resolveRenderStyle(),edge:PositionedEdge={source:'A',target:'B',style:'solid',hasArrowStart:false,hasArrowEnd:false,label:'caption',labelPosition:{x:150,y:100},points:[{x:100,y:100},{x:200,y:100}]}
 const header:PositionedGroup={id:'scope',label:'scope',x:0,y:0,width:500,height:200,headerHeight:28,children:[],inlineStyle:{'stroke-width':'12'}}
 const paint=labelSeatPaintContext([], [edge], [header],style,()=>true)!,half=labelRect(edge,style)!.h/2+4
 expect(paint.clear(edge,{x:150,y:34+half-.5},new Map())).toBe(false)
 expect(paint.clear(edge,{x:150,y:34+half+1},new Map())).toBe(true)
})


it('rounded header emission retains the generic join support when tiny arcs lose tangent agreement',()=>{
 const edge:PositionedEdge={source:'A',target:'B',style:'solid',hasArrowStart:false,hasArrowEnd:false,label:'caption',labelPosition:{x:150,y:150},points:[{x:100,y:150},{x:200,y:150}]}
 const header:PositionedGroup={id:'scope',label:'scope',x:100.1234567891,y:0,width:100,height:200,headerHeight:28,children:[],inlineStyle:{'stroke-width':'100'}}
 const style=resolveRenderStyle(),rounded=labelSeatPaintContext([], [edge], [header],{...style,groupCornerRadius:5.6001e-11},()=>true)!,sharp=labelSeatPaintContext([], [edge], [header],{...style,groupCornerRadius:0},()=>true)!
 expect(rounded.clear(edge,{x:150,y:150},new Map())).toBe(false)
 expect(sharp.clear(edge,{x:150,y:150},new Map())).toBe(true)
})

describe('private label-bearing route channels', () => {
  const cases = [
    ["duplicate routes with different labels", "flowchart RL\n  N8 ===>|retry| N0\n  N2 ----> N5\n  N1 --> N0\n  N7 ===>|same word ok| N10\n  N2 --->|a longer label goes here| N5\n  N1 ----> N4"],
    ["outer feedback corridor", "flowchart LR\n  N0 --> N1\n  N3 ===> N4\n  N1 ---->|same word ok| N2\n  N4 --> N5\n  N5 ===> N0\n  N2 --->|errors| N3\n  N5 ---->|q| N4"],
    ["normal stem beside a foreign label", "flowchart LR\n  N4 ---> N3\n  N2 -->|validate input| N1\n  N5 ===> N4\n  N0 ---> N5\n  N3 ---->|same word ok| N2\n  N4 -->|a longer label goes here| N5\n  N1 ===> N0"],
    ["tight retained target elbow", "flowchart TD\n  N0[/\"same word ok\"/]\n  N1((a longer label goes here))\n  N2([\"x\"])\n  N3[/\"errors\"/]\n  N4((q))\n  N5([\"done\"])\n  N6{retry}\n  N7((validate input))\n  N8([\"warnings\"])\n  N9{ok}\n  N10((same word ok))\n  N11([\"a longer label goes here\"])\n  N3 ----> N0\n  N4 --> N9\n  N1 ===>|x| N10\n  N2 --->|errors| N7\n  N11 ----> N8\n  N8 --> N5\n  N9 ===>|retry| N2\n  N6 --->|validate input| N3\n  N7 ----> N0\n  N4 --> N1\n  N1 ===>|same word ok| N10\n  N2 --->|a longer label goes here| N7"],
    ["coincident reciprocal labels", "flowchart LR\n  N0[(retry)]\n  N1([\"validate input\"])\n  N2[/\"warnings\"/]\n  N3[(ok)]\n  N4([\"same word ok\"])\n  N5[/\"a longer label goes here\"/]\n  N5 ===>|retry| N2\n  N2 --->|validate input| N5\n  N3 ----> N0\n  N0 --> N3\n  N3 ===>|same word ok| N0\n  N4 --->|a longer label goes here| N1\n  N1 ----> N4\n  N2 --> N5\n  N5 ===> N2"],
    ["coincident incoming thick arrow", "flowchart BT\n  N0([\"validate input\"])\n  N1[/\"warnings\"/]\n  N2[(ok)]\n  N3([\"same word ok\"])\n  N4[/\"a longer label goes here\"/]\n  N0 -->|validate input| N1\n  N0 ===>|warnings| N2\n  N0 ---> N2\n  N1 ----> N2\n  N1 -->|a longer label goes here| N3\n  N2 ===>|x| N3\n  N2 ---> N3\n  N2 ----> N4\n  N3 --> N4\n  N3 ===>|retry| N0\n  N3 --->|validate input| N0\n  N4 ----> N0"],
    ["mixed-width duplicate captions", "flowchart RL\n  N0[\"a longer label goes here\"]\n  N1{x}\n  N2{{errors}}\n  N3[\"q\"]\n  N4{done}\n  N5{{retry}}\n  N6[\"validate input\"]\n  N5 --->|a longer label goes here| N4\n  N6 ---->|x| N5\n  N0 --> N3\n  N5 ===> N4\n  N6 --->|done| N5\n  N4 ---->|retry| N3\n  N5 --> N4\n  N6 ===> N5\n  N4 --->|ok| N3\n  N5 ---->|same word ok| N4\n  N6 --> N2\n  N4 ===> N3\n  N5 --->|errors| N4"]
  ] as const

  it.each(cases.flatMap(([name, source]) => ['LR', 'RL', 'TD', 'BT'].map(direction => [name, direction, source.replace(/^flowchart [A-Z]+/, `flowchart ${direction}`)] as const)))('seats %s in %s without dropping route semantics', (_name, _direction, source) => {
    const graph = parseMermaid(source), positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.edgeIndex, edge.source, edge.target, edge.label, edge.hasArrowStart, edge.hasArrowEnd, edge.startMarker, edge.endMarker]))
      .toEqual(graph.edges.map((edge, i) => [i, edge.source, edge.target, edge.label, edge.hasArrowStart, edge.hasArrowEnd, edge.startMarker, edge.endMarker]))
    expect(auditRouteContracts(positioned, graph)).toEqual([])
    expect(hardViolations(assessLayout(graph, positioned))).toEqual([])
    for (const edge of positioned.edges) expect(edge.routeCertificate?.bendCount).toBe(bendCount(edge.points))
  })
})

it.each([0, 1, 2, 3].flatMap(turns => ([['end', 'solid', false], ['start', 'solid', false], ['start', 'thick', false], ['both', 'thick', false], ['start', 'thick', true]] as const).map(([marked, shaft, collinear]) => ({ turns, marked, shaft, collinear }))))('a private channel retains $marked $shaft arrow leads and clears foreign ink at rotation $turns (collinear=$collinear)', ({ turns, marked, shaft, collinear }) => {
  const direction = (['LR', 'TD', 'RL', 'BT'] as const)[turns]!
  const graph = parseMermaid(`flowchart ${direction}\nA -->|handoff| B\nA --> B\nC --> D\nX0\nX1\nX2\nX3\nX4`), style = resolveRenderStyle()
  // Typed routing retains authored endpoint identities with a source-only head.
  Object.assign(graph.edges[0]!, { style: shaft, hasArrowStart: marked !== 'end', hasArrowEnd: marked !== 'start' })
  const rotate = (point: Point): Point => {
    let { x, y } = point
    for (let i = 0; i < turns; i++) [x, y] = [-y, x]
    return { x, y }
  }
  const node = (id: string, x: number, y: number, width = 20, height = 20): PositionedNode => {
    const a = rotate({ x, y }), b = rotate({ x: x + width, y: y + height })
    return { ...graph.nodes.get(id)!, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
  }
  const nodes = [node('A', 0, 0), node('B', 220, 0), node('C', 170, 100), node('D', 60, 21.15), ...[40, 80, 120, 160, 200].map((x, i) => node(`X${i}`, x, -25, 15, 17))]
  const foreign = [[180, 100], [180, -60], [140, -60], [140, 20], [100, 20], [100, -60], [60, -60], [60, 20], [40, 20], [40, 100], [70, 100], [70, 41.15]].map(([x, y]) => rotate({ x: x!, y: y! }))
  const edges: PositionedEdge[] = graph.edges.map((edge, edgeIndex) => ({ ...edge, edgeIndex, points: edgeIndex < 2 ? [rotate({ x: 20, y: 10 }), ...(collinear && edgeIndex === 0 ? [rotate({ x: 25, y: 10 })] : []), rotate({ x: 220, y: 10 })] : foreign,
    ...(edgeIndex === 0 ? { labelPosition: rotate({ x: 150, y: 10 }) } : {}) }))
  const before = structuredClone(edges), positioned = { nodes, edges, groups: [] }
  repairLabelsOnSharedTrunks(positioned, graph, style)
  expect(edges[2]).toEqual(before[2])
  expect(edges[0]!.points.length).toBeGreaterThan(2)
  for (const start of [true, false]) {
    if (!(start ? edges[0]!.hasArrowStart : edges[0]!.hasArrowEnd)) continue
    const path = edges[0]!.points, tip = start ? path[0]! : path.at(-1)!, turn = start ? path[1]! : path.at(-2)!
    expect(Math.hypot(turn.x - tip.x, turn.y - tip.y)).toBeGreaterThanOrEqual(8.375 * (shaft === 'thick' ? 2 : 1) + 4)
  }
  expect(edges[0]!.points[0]).toEqual(before[0]!.points[0])
  expect(edges[0]!.points.at(-1)).toEqual(before[0]!.points.at(-1))
  expect(auditRouteContracts(positioned, graph).filter(finding => finding.code === 'ROUTE_LABEL_ON_SHARED_TRUNK')).toEqual([])
  // Independent support for the served default arrow: triangle (67.5,49.15),
  // (70,41.15), (72.5,49.15), plus its 0.375px outline. The old proposal's
  // shaft through (70,47.15) crosses the triangle's filled interior.
  const a = rotate({ x: 67.125, y: 40.775 }), b = rotate({ x: 72.875, y: 49.525 })
  const marker = { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) }
  for (let i = 1; i < edges[0]!.points.length; i++) {
    const p = edges[0]!.points[i - 1]!, q = edges[0]!.points[i]!
    expect(Math.min(p.x, q.x) - .5 < marker.x1 && Math.max(p.x, q.x) + .5 > marker.x0
      && Math.min(p.y, q.y) - .5 < marker.y1 && Math.max(p.y, q.y) + .5 > marker.y0).toBe(false)
  }
})
