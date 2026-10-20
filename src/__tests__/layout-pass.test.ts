// Tests for the LayoutPass abstraction (docs/design/system/route-contracts.md §8):
// production runPipeline enforcement and the geometry its passes produce.
import { describe, expect, test } from 'bun:test'
import { complicatedFixtures, simpleFixtures } from '../../eval/visual-rubric/fixtures.ts'
import type { LayoutPass, PassContextBase } from '../layout/pass.ts'
import * as passContract from '../layout/pass.ts'
const { LayoutMetricBudgetError, LayoutPassContractError, runPipeline } = passContract
import { LAYOUT_PIPELINE, layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import * as rubric from '../layout-rubric.ts'
const { assessLayout, countOpposingRouteOverlaps, countParallelRouteOverlaps, hardViolations, measureRubricMetrics, onShapeOutline } = rubric
import { resolveRenderStyle } from '../styles.ts'
import { labelRect } from '../route-contracts.ts'
import * as routeContracts from '../route-contracts.ts'
import { applySymmetricParallelEdgeLanes } from '../layout/passes/index.ts'
import { graphEdgeTextBlock } from '../graph-text.ts'
import { createTextMeasurementExecution, withTextMeasurementExecution } from '../text-measurement-profile.ts'
import type { PositionedEdge, PositionedGraph, PositionedNode } from '../types.ts'

describe('declared pass budgets on actual native geometry', () => {
  test.each([
    ['through-node straight route', 'flowchart RL\nN6((a longer label goes here))\nN2 ---> N0\nN6 ===>|warnings| N0\nN1 ----> N6'],
    ['two-point diagonals', 'flowchart TD\nA["done"] -->|done| B["b"]\nA --> B\nA --> B\nB --> C'],
    ['detached feedback endpoint', 'flowchart TD\nS0["warnings"] --> H["hub"]\nS1["ok"] --> H\nS2["same word ok"] --> H\nS3["a longer label goes here"] --> H\nH --> T["out"]\nT --> S3'],
  ])('route certification may repair an infeasible early route: %s', (_name, source) => {
    const graph = parseMermaid(source)
    const pass = LAYOUT_PIPELINE.find(candidate => candidate.id === 'applyRouteContracts')!, run = pass.run
    const repairs: Array<{ bundled: boolean; placement: unknown; improved: boolean }> = []
    pass.run = context => {
      const measure = () => measureRubricMetrics(graph, { nodes: context.nodes, edges: context.edges, groups: context.groups, width: 0, height: 0 }, ['hard', 'endpointApproaches'], context.style)
      const before = measure()
      run(context)
      const after = measure()
      repairs.push({
        bundled: context.mergeEdges,
        placement: context.elkResult,
        improved: after.hard! < before.hard! || after.endpointApproaches! < before.endpointApproaches!,
      })
    }
    try {
      const positioned = layoutGraphSync(graph)
      expect(positioned.edges).toHaveLength(graph.edges.length)
      expect(hardViolations(assessLayout(graph, positioned))).toEqual([])
      // These feasible fixtures need at most two placement strategies, followed
      // by one unbundled proposal on the selected placement. Every producer must
      // independently repair its route before its completed geometry is scored.
      const bundled = repairs.filter(repair => repair.bundled)
      const unbundled = repairs.filter(repair => !repair.bundled)
      expect(bundled.length).toBeGreaterThanOrEqual(1)
      expect(bundled.length).toBeLessThanOrEqual(2)
      expect(unbundled.length).toBeLessThanOrEqual(1)
      expect(repairs.every(repair => repair.improved)).toBe(true)
      for (const repair of unbundled) {
        expect(bundled.some(previous => previous.placement === repair.placement)).toBe(true)
        expect(repairs.at(-1)).toBe(repair)
      }
    } finally { pass.run = run }
  })

  test('canonical contacts cannot yield without a measured higher-priority repair', () => {
    const pass = LAYOUT_PIPELINE.find(candidate => candidate.id === 'applyRouteContracts')!, run = pass.run
    let calls = 0, failure: unknown
    pass.run = context => {
      calls++; run(context)
      context.edges[0]!.points = context.edges[0]!.points.map(point => ({ x: point.x, y: point.y + 3 }))
    }
    try { layoutGraphSync(parseMermaid('flowchart LR\nA-->B')) } catch (error) { failure = error } finally { pass.run = run }
    expect(failure).toBeInstanceOf(LayoutMetricBudgetError)
    expect(failure).toMatchObject({ pass: 'applyRouteContracts', metric: 'portRate', before: 1, after: 0, allowance: 0 })
    expect(calls).toBe(1)
  })

  test('outward slanted-corner contact differs from a tangent or interior shaft', () => {
    const source: PositionedNode = { id: 'A', label: '', shape: 'lean-r', x: 0, y: 0, width: 100, height: 40 }
    const edge: PositionedEdge = { source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: true, points: [{ x: 100, y: 0 }, { x: 120, y: 0 }] }
    expect(routeContracts.invalidEndpointApproaches(edge, source)).toBe(0)
    expect(routeContracts.invalidEndpointApproaches({ ...edge, points: [{ x: 50, y: 0 }, { x: 120, y: 0 }] }, source)).toBe(1)
    expect(routeContracts.invalidEndpointApproaches({ ...edge, points: [{ x: 100, y: 0 }, { x: 80, y: 0 }] }, source)).toBe(1)
  })

  test('opposing shared ink excludes fan trunks, endpoint contacts and ordinary crossings', () => {
    const edge: PositionedEdge = { source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }
    const paired = (points: PositionedEdge['points']) => countOpposingRouteOverlaps([edge, { ...edge, source: 'C', target: 'D', points }])
    expect(paired([{ x: 8, y: 0 }, { x: 2, y: 0 }])).toBe(1)
    expect(paired([{ x: 2, y: 0 }, { x: 8, y: 0 }])).toBe(0)
    expect(paired([{ x: 20, y: 0 }, { x: 10, y: 0 }])).toBe(0)
    expect(paired([{ x: 5, y: -5 }, { x: 5, y: 5 }])).toBe(0)
  })
  test('the engine rejects actual detour bends before fallback without audit options', () => {
    const pass = LAYOUT_PIPELINE.find(candidate => candidate.id === 'alignLayerNodes')!
    const run = pass.run
    let producerCalls = 0
    pass.run = context => {
      producerCalls++
      run(context)
      const edge = context.edges[0]!
      const start = edge.points[0]!, end = edge.points.at(-1)!
      edge.points = [
        start,
        { x: start.x + 8, y: start.y },
        { x: start.x + 8, y: start.y + 12 },
        { x: end.x - 8, y: start.y + 12 },
        { x: end.x - 8, y: end.y },
        end,
      ]
    }
    let failure: unknown
    try {
      layoutGraphSync(parseMermaid('flowchart LR\nA --> B'))
    } catch (error) {
      failure = error
    } finally {
      pass.run = run
    }
    expect(failure).toBeInstanceOf(LayoutMetricBudgetError)
    expect(failure).toMatchObject({ pass: 'alignLayerNodes', metric: 'bends', before: 0, after: 4, allowance: 0 })
    expect(producerCalls).toBe(1)
  })

  test('a late edge pass moving a frozen node is a production contract failure, not a fallback candidate', () => {
    const pass = LAYOUT_PIPELINE.find(candidate => candidate.id === 'repairLabelsOffOwnRoute')!
    const run = pass.run
    let calls = 0, failure: unknown
    pass.run = context => { calls++; run(context); context.nodes[0]!.x += 9 }
    try {
      layoutGraphSync(parseMermaid('flowchart LR\nA --> B'))
    } catch (error) {
      failure = error
    } finally {
      pass.run = run
    }
    expect(failure).toBeInstanceOf(LayoutPassContractError)
    expect(failure).toMatchObject({ pass: 'repairLabelsOffOwnRoute', contract: 'freeze' })
    expect(calls).toBe(1)
  })

  test('separating already distinct parallel routes cannot buy a crossing merely to remove bends', () => {
    const graph = parseMermaid('flowchart TD\nN2-->N0\nN1-->N2\nN0-->N1\nN2-->N0\nN0-->N1')
    const positioned = layoutGraphSync(graph)
    expect(positioned.edges).toHaveLength(5)
    const pair = positioned.edges.filter(edge => edge.source === 'N2' && edge.target === 'N0')
    expect(pair[0]!.points).not.toEqual(pair[1]!.points)
    expect(assessLayout(graph, positioned).metrics.edgeCrossings).toBe(0)
  })

  test('labeled parallel lanes retain a crossing-free feedback route and both labels', () => {
    const graph = parseMermaid('flowchart LR\nN2-.-|note 0|N0\nN0-.-N1\nN2-.-|note 5|N0\nN1-.-N2')
    const positioned = layoutGraphSync(graph)
    expect(positioned.certification?.status).toBe('passed')
    expect(positioned.edges).toHaveLength(4)
    const pair = positioned.edges.filter(edge => edge.source === 'N2' && edge.target === 'N0')
    expect(pair.map(edge => edge.label)).toEqual(['note 0', 'note 5'])
    expect(pair[0]!.points).not.toEqual(pair[1]!.points)
    for (const edge of pair) {
      expect(edge.labelPosition).toBeDefined()
      expect(edge.labelBlock).toBeDefined()
    }
    for (const edge of positioned.edges) {
      expect(onShapeOutline(positioned.nodes.find(node => node.id === edge.source)!, edge.points[0]!)).toBe(true)
      expect(onShapeOutline(positioned.nodes.find(node => node.id === edge.target)!, edge.points.at(-1)!)).toBe(true)
    }
    const { metrics } = assessLayout(graph, positioned)
    expect(metrics.edgeCrossings).toBe(0)
    expect(metrics.labelOffRoute).toBe(0)
    const boxes = pair.map(edge => labelRect(edge, resolveRenderStyle())!)
    for (const box of boxes) {
      for (const node of positioned.nodes) {
        const overlapWidth = Math.min(box.x + box.w, node.x + node.width) - Math.max(box.x, node.x)
        const overlapHeight = Math.min(box.y + box.h, node.y + node.height) - Math.max(box.y, node.y)
        expect(overlapWidth > 0 && overlapHeight > 0).toBe(false)
      }
    }
    const [first, second] = boxes
    expect(Math.min(first!.x + first!.w, second!.x + second!.w) <= Math.max(first!.x, second!.x)
      || Math.min(first!.y + first!.h, second!.y + second!.h) <= Math.max(first!.y, second!.y)).toBe(true)
    expect(countParallelRouteOverlaps(pair)).toBe(0)
  })

  test.each([true, false])('parallel label lanes reserve transformed, tracked text width (retained: %s)', retained => {
    const graph = parseMermaid('flowchart TB\nA-->|straße|B\nA-->|straße|B')
    const style = resolveRenderStyle({ styleFace: { edge: { textTransform: 'uppercase', letterSpacing: 6 } } })
    const block = retained
      ? withTextMeasurementExecution(createTextMeasurementExecution({
        id: 'test:retained-lane-labels', version: '1.0.0', measure: ({ text }) => text.length * 20,
      }, 'Inter'), () => graphEdgeTextBlock('straße', style))
      : graphEdgeTextBlock('straße', style)
    const nodes: PositionedNode[] = [
      { id: 'A', label: 'A', shape: 'rectangle', x: 200, y: 0, width: 100, height: 40 },
      { id: 'B', label: 'B', shape: 'rectangle', x: 200, y: 400, width: 100, height: 40 },
    ]
    const edges: PositionedEdge[] = graph.edges.map((edge, edgeIndex) => ({
      ...edge, edgeIndex, labelBlock: retained ? block : undefined,
      points: [{ x: 225 + edgeIndex * 50, y: 40 }, { x: 225 + edgeIndex * 50, y: 400 }],
    }))
    applySymmetricParallelEdgeLanes(nodes, edges, [], graph, new Set(), style)
    expect(block.text).toBe('STRASSE')
    expect(edges[0]!.labelPosition!.x + (block.width + 16) / 2).toBeLessThanOrEqual(200 - 18)
    expect(edges[1]!.labelPosition!.x - (block.width + 16) / 2).toBeGreaterThanOrEqual(300 + 18)
    if (retained) for (const edge of edges) expect(edge.labelBlock).toBe(block)
  })

  test('one crossing may resolve one actual collapsed duplicate route, without losing either authored edge', () => {
    const graph = parseMermaid('flowchart LR\nN0-->N1\nN0-->N1\nN0-->N2')
    const positioned = layoutGraphSync(graph)
    expect(positioned.edges).toHaveLength(3)
    const pair = positioned.edges.filter(edge => edge.source === 'N0' && edge.target === 'N1')
    expect(pair[0]!.points).not.toEqual(pair[1]!.points)
    expect(countParallelRouteOverlaps(pair)).toBe(0)
    expect(assessLayout(graph, positioned).metrics.edgeCrossings).toBe(1)
  })

  test('a target bucket cannot separate one pair by collapsing another parallel pair', () => {
    const graph = parseMermaid('flowchart BT\nN0-.-N2\nN1-->N2\nN1-->N2\nN0-->N2')
    const positioned = layoutGraphSync(graph)
    expect(positioned.certification?.status).toBe('passed')
    expect(positioned.edges).toHaveLength(4)
    expect(countParallelRouteOverlaps(positioned.edges)).toBe(0)
  })

  test('port-lane centering retains prior geometry when it would lose contacts without simpler routes', () => {
    const pass = LAYOUT_PIPELINE.find(candidate => candidate.id === 'alignPortLanes')!, run = pass.run
    const rates: number[] = []
    pass.run = context => {
      run(context)
      rates.push(measureRubricMetrics(context.graph, { nodes: context.nodes, edges: context.edges, groups: context.groups, width: 0, height: 0 }, ['portRate'], context.style).portRate!)
    }
    try {
      const positioned = layoutGraphSync(parseMermaid('flowchart LR\nN2-->N3\nN1-->N2\nN0-->N3\nN0-->N2'))
      expect(positioned.certification?.status).toBe('passed')
      expect(rates).toEqual([0.25])
    } finally { pass.run = run }
  })

  test('canonical contacts can yield when route certification repairs an actual diagonal', () => {
    const graph = parseMermaid('flowchart BT\nN0-->N3\nN3-->N2\nN0-->N2\nN1-->N3\nN0-->N2')
    const positioned = layoutGraphSync(graph)
    expect(positioned.certification?.status).toBe('passed')
    expect(assessLayout(graph, positioned).metrics.diagonalSegments).toBe(0)
  })

  test('an invisible layout edge changing ports cannot degrade the visible-route budget', () => {
    const graph = parseMermaid('flowchart BT\nN0-->N3\nN3~~~N2\nN0-->N2\nN1-->N3\nN0-.-N2')
    const positioned = layoutGraphSync(graph)
    expect(positioned.certification?.status).toBe('passed')
    expect(positioned.edges.find(edge => edge.style === 'invisible')?.points).toHaveLength(2)
  })

  test('canonical contacts may yield to separating actual opposing shared ink', () => {
    const graph = parseMermaid('flowchart LR\nN2-->N3\nN4-->N0\nN2-.-N0\nN0-->N2\nN4-->N1')
    const pass = LAYOUT_PIPELINE.find(candidate => candidate.id === 'applyRouteContracts')!, run = pass.run
    const overlaps: number[] = []
    pass.run = context => { overlaps.push(countOpposingRouteOverlaps(context.edges)); run(context); overlaps.push(countOpposingRouteOverlaps(context.edges)) }
    try {
      const positioned = layoutGraphSync(graph)
      expect(positioned.certification?.status).toBe('passed')
      expect(overlaps).toEqual([1, 0])
      expect(countOpposingRouteOverlaps(positioned.edges)).toBe(0)
      expect(assessLayout(graph, positioned).metrics.portEndpointRate).toBeGreaterThanOrEqual(0.6)
      expect(assessLayout(graph, positioned).metrics.edgeCrossings).toBe(0)
    } finally { pass.run = run }
  })

  test.each([...simpleFixtures(), ...complicatedFixtures()])('$id', fixture => {
    const positioned = layoutGraphSync(parseMermaid(fixture.source))
    expect(positioned.certification?.status).toBe('passed')
  })
})

describe('runPipeline invariant enforcement', () => {
  interface TestCtx extends PassContextBase {
    log: string[]
    edges?: Array<{ points: Array<{ x: number; y: number }>; labelPosition?: { x: number; y: number }; routeCertificate?: unknown }>
  }
  const mkPass = (over: Partial<LayoutPass<TestCtx>> & { id: string }): LayoutPass<TestCtx> => ({
    doc: '',
    after: [],
    mutates: ['edges'],
    determinism: 'in-place',
    run: c => {
      c.log.push(over.id)
    },
    ...over,
  })
  const moveFirstNode = (c: TestCtx) => {
    const n = c.nodes[0]
    if (n) n.x = 9
  }

  test('runs passes in array order and honors enabled()', () => {
    const ctx: TestCtx = { frozen: false, nodes: [], log: [] }
    runPipeline(ctx, [mkPass({ id: 'a' }), mkPass({ id: 'b', enabled: () => false }), mkPass({ id: 'c' })])
    expect(ctx.log).toEqual(['a', 'c'])
  })

  test('production ordering rejects an out-of-order `after`', () => {
    const ctx: TestCtx = { frozen: false, nodes: [], log: [] }
    expect(() => runPipeline(ctx, [mkPass({ id: 'b', after: ['a'] }), mkPass({ id: 'a' })])).toThrow(/must run after/)
  })

  test('a positions pass moving a frozen node always fails', () => {
    const ctx: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    expect(() => runPipeline(ctx, [mkPass({ id: 'freeze', freezesNodes: true }), mkPass({ id: 'move', mutates: ['positions'], run: moveFirstNode })])).toThrow(/freeze/)
  })

  test('a whole-graph translate after the freeze is allowed', () => {
    const ctx: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    expect(() => runPipeline(ctx, [mkPass({ id: 'freeze', freezesNodes: true }), mkPass({ id: 'translate', mutates: ['translate'], run: moveFirstNode })])).not.toThrow()
  })

  test('a post-freeze edge rewrite dropping its certificate always fails', () => {
    const ctx: TestCtx = {
      frozen: false,
      nodes: [],
      edges: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
          routeCertificate: { invariant: 'straight' },
        },
      ],
      log: [],
    }
    expect(() =>
      runPipeline(
        ctx,
        [
          mkPass({ id: 'freeze', freezesNodes: true }),
          mkPass({
            id: 'bad-edge-rewrite',
            mutates: ['edges'],
            run: c => {
              c.edges![0]!.points = [
                { x: 0, y: 0 },
                { x: 5, y: 5 },
                { x: 10, y: 0 },
              ]
              c.edges![0]!.routeCertificate = undefined
            },
          }),
        ],
      ),
    ).toThrow(/routeCertificate/)
  })

  test('a post-freeze edge rewrite reissuing its certificate is allowed', () => {
    const ctx: TestCtx = {
      frozen: false,
      nodes: [],
      edges: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
          routeCertificate: { invariant: 'straight' },
        },
      ],
      log: [],
    }
    expect(() =>
      runPipeline(
        ctx,
        [
          mkPass({ id: 'freeze', freezesNodes: true }),
          mkPass({
            id: 'good-edge-rewrite',
            mutates: ['edges'],
            run: c => {
              c.edges![0]!.points = [
                { x: 0, y: 0 },
                { x: 5, y: 5 },
                { x: 10, y: 0 },
              ]
              c.edges![0]!.routeCertificate = { invariant: 'explained-detour' }
            },
          }),
        ],
      ),
    ).not.toThrow()
  })

  test('production rejects node movement even from a pass declaring only edge effects', () => {
    const ctx: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    expect(() => runPipeline(ctx, [mkPass({ id: 'freeze', freezesNodes: true }), mkPass({ id: 'move', mutates: ['edges'], run: moveFirstNode })])).toThrow(/freeze/)
  })

  test('declaring translate does not permit non-uniform node movement', () => {
    const ctx: TestCtx = { frozen: true, nodes: [{ x: 0, y: 0, width: 1, height: 1 }, { x: 10, y: 0, width: 1, height: 1 }], log: [] }
    expect(() => runPipeline(ctx, [mkPass({ id: 'false-translate', mutates: ['translate'], run: moveFirstNode })])).toThrow(/uniform translation/)
  })

  test('a translation must move retained groups, routes and labels with the nodes', () => {
    const ctx: TestCtx = {
      frozen: true, log: [], nodes: [{ x: 0, y: 0, width: 1, height: 1 }],
      groups: [{ id: 'parent', x: -2, y: -2, width: 5, height: 5 }],
      edges: [{ points: [{ x: 1, y: 0 }, { x: 10, y: 0 }], labelPosition: { x: 5, y: 0 }, routeCertificate: {} }],
    }
    expect(() => runPipeline(ctx, [mkPass({ id: 'leaves-group-behind', mutates: ['translate'], run: moveFirstNode })])).toThrow(/uniform translation/)
    ctx.nodes[0]!.x = 0
    expect(() => runPipeline(ctx, [mkPass({ id: 'complete-translate', mutates: ['translate'], run: c => {
      c.nodes[0]!.x += 9
      c.groups![0]!.x += 9
      for (const point of c.edges![0]!.points) point.x += 9
      c.edges![0]!.labelPosition!.x += 9
    } })])).not.toThrow()
  })

  test('an existing certificate is stale after a post-freeze route rewrite', () => {
    const ctx: TestCtx = { frozen: true, nodes: [], log: [], edges: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], routeCertificate: { invariant: 'straight' } }] }
    expect(() => runPipeline(ctx, [mkPass({ id: 'stale-certificate', run: c => { c.edges![0]!.points.splice(1, 0, { x: 5, y: 5 }) } })])).toThrow(/re-issuing routeCertificate/)
  })

  test('onAfterPass fires only for passes that actually ran', () => {
    const ctx: TestCtx = { frozen: false, nodes: [], log: [] }
    const fired: string[] = []
    runPipeline(ctx, [mkPass({ id: 'a' }), mkPass({ id: 'skip', enabled: () => false }), mkPass({ id: 'b' })], {
      onAfterPass: p => {
        fired.push(p.id)
      },
    })
    expect(fired).toEqual(['a', 'b'])
  })

  test('a geometry pass cannot silently exceed its bend allowance', () => {
    const ctx: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    expect(() =>
      runPipeline(
        ctx,
        [
          mkPass({
            id: 'reroute',
            mayChangeMetrics: { bends: { worsenBy: 2 } },
            run: moveFirstNode,
          }),
        ],
        { measureMetrics: c => ({ bends: c.nodes[0]!.x }) },
      ),
    ).toThrow(/reroute.*bends.*allowance 2/)
  })

  test('rate improvements are allowed and a missing measurement fails closed', () => {
    const ctx: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    const pass = mkPass({
      id: 'attach',
      mayChangeMetrics: { portRate: 'improve-only' },
      run: c => {
        c.nodes[0]!.x = 1
      },
    })
    expect(() => runPipeline(ctx, [pass], { measureMetrics: c => ({ portRate: c.nodes[0]!.x }) })).not.toThrow()
    expect(() => runPipeline(ctx, [pass])).toThrow(/no geometry measurement/)
  })

  test('ports may yield to fewer bends only when the higher-priority metric improves', () => {
    const make = (): TestCtx => ({ frozen: false, nodes: [{ x: 1, y: 2, width: 1, height: 1 }], log: [] })
    const measureMetrics = (c: TestCtx) => ({ portRate: c.nodes[0]!.x, bends: c.nodes[0]!.y })
    const pass = (removeBends: boolean) =>
      mkPass({
        id: 'straighten',
        mayChangeMetrics: { portRate: { worsenBy: 1, whenImproves: 'bends' } },
        run: c => {
          c.nodes[0]!.x = 0
          if (removeBends) c.nodes[0]!.y = 0
        },
      })
    expect(() => runPipeline(make(), [pass(true)], { measureMetrics })).not.toThrow()
    expect(() => runPipeline(make(), [pass(false)], { measureMetrics })).toThrow(/straighten.*portRate/)
  })

  test('each extra crossing needs a separately repaired parallel overlap, rather than bend reduction', () => {
    const make = (): TestCtx => ({ frozen: false, nodes: [{ x: 0, y: 2, width: 5, height: 1 }], log: [] })
    const measureMetrics = (context: TestCtx) => ({ crossings: context.nodes[0]!.x, parallelOverlaps: context.nodes[0]!.y, bends: context.nodes[0]!.width })
    const pass = (crossings: number, overlaps: number) => mkPass({ id: 'separate', mayChangeMetrics: { crossings: { worsenBy: 1, whenImproves: 'parallelOverlaps', perImprovement: true } }, run: c => { c.nodes[0]!.x = crossings; c.nodes[0]!.y = overlaps; c.nodes[0]!.width = 0 } })
    expect(() => runPipeline(make(), [pass(2, 0)], { measureMetrics })).not.toThrow()
    expect(() => runPipeline(make(), [pass(2, 1)], { measureMetrics })).toThrow(/crossings.*allowance 1/)
    expect(() => runPipeline(make(), [pass(1, 2)], { measureMetrics })).toThrow(/crossings.*allowance 0/)
  })
})

describe('requested production budget metrics', () => {
  test('parallel ambiguity measures shared route spans rather than nearby endpoints', () => {
    const graph = parseMermaid('flowchart LR\nA-->B\nA-->B')
    const close = graph.edges.map((edge, index) => ({ ...edge, points: [{ x: 0, y: index }, { x: 20, y: index }] }))
    expect(countParallelRouteOverlaps(close)).toBe(0)
    close[0]!.points = [{ x: 0, y: -10 }, { x: 5, y: -10 }, { x: 5, y: 0 }, { x: 15, y: 0 }, { x: 15, y: -10 }, { x: 20, y: -10 }]
    close[1]!.points = [{ x: 0, y: 10 }, { x: 5, y: 10 }, { x: 5, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 10 }, { x: 20, y: 10 }]
    expect(countParallelRouteOverlaps(close)).toBe(1)
  })
  test('early bend measurement does not run later endpoint, label or collision certification', () => {
    const graph = parseMermaid('flowchart LR\nA --> B')
    const positioned: PositionedGraph = { width: 0, height: 0, groups: [], nodes: [{ ...graph.nodes.get('A')!, x: 0, y: 0, width: 10, height: 10 }], edges: [{ ...graph.edges[0]!, points: [] }] }
    expect(measureRubricMetrics(graph, positioned, ['bends', 'straight'], resolveRenderStyle({}))).toEqual({ bends: 0, straight: 0 })
  })

  test('crossing measurement counts proper intersections once, excluding endpoints and an edge crossing itself', () => {
    const graph = parseMermaid('flowchart LR\nA-->B\nC-->D\nE-->F')
    const positioned: PositionedGraph = { width: 100, height: 100, nodes: [], groups: [], edges: [
      { ...graph.edges[0]!, points: [{ x: 0, y: 5 }, { x: 10, y: 5 }] },
      { ...graph.edges[1]!, points: [{ x: 5, y: 0 }, { x: 5, y: 10 }] },
      { ...graph.edges[2]!, points: [{ x: 20, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 0 }] },
    ] }
    expect(measureRubricMetrics(graph, positioned, ['crossings'], resolveRenderStyle({}))).toEqual({ crossings: 1 })
    positioned.edges.push({ ...graph.edges[0]!, points: [{ x: 10, y: 5 }, { x: 15, y: 0 }] })
    expect(measureRubricMetrics(graph, positioned, ['crossings'], resolveRenderStyle({}))).toEqual({ crossings: 1 })
  })
})
