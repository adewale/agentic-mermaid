// Tests for the LayoutPass abstraction (docs/design/system/layout-pass-pipeline.md):
// the manifest's structural invariants + production runPipeline enforcement.
import { describe, expect, test } from 'bun:test'
import { complicatedFixtures, simpleFixtures } from '../../eval/visual-rubric/fixtures.ts'
import type { LayoutPass, PassContextBase } from '../layout/pass.ts'
import { assertTopologicalOrder, LayoutMetricBudgetError, LayoutPassContractError, runPipeline } from '../layout/pass.ts'
import { LAYOUT_PIPELINE, layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { assessLayout, countParallelRouteOverlaps, measureRubricMetrics } from '../layout-rubric.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { PositionedGraph } from '../types.ts'

describe('LAYOUT_PIPELINE manifest', () => {
  test('array order is a valid topological order of `after`', () => {
    expect(() => assertTopologicalOrder(LAYOUT_PIPELINE)).not.toThrow()
  })

  test('pass ids are unique', () => {
    const ids = LAYOUT_PIPELINE.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every `after` references an earlier pass', () => {
    const seen = new Set<string>()
    for (const p of LAYOUT_PIPELINE) {
      for (const dep of p.after) expect(seen.has(dep)).toBe(true)
      seen.add(p.id)
    }
  })

  test('exactly one pass freezes node geometry, and it is applyRouteContracts', () => {
    expect(LAYOUT_PIPELINE.filter(p => p.freezesNodes).map(p => p.id)).toEqual(['applyRouteContracts'])
  })

  test('only translate/edge passes run after the freeze (§3.2)', () => {
    const i = LAYOUT_PIPELINE.findIndex(p => p.freezesNodes)
    for (const p of LAYOUT_PIPELINE.slice(i + 1)) {
      expect(p.mutates.every(m => m === 'translate' || m === 'edges')).toBe(true)
    }
  })

  test('final route-contract closure runs after late label repair and before translation', () => {
    const ids = LAYOUT_PIPELINE.map(pass => pass.id)
    expect(ids.indexOf('separateEdgeLabelPills')).toBeLessThan(ids.indexOf('closeRouteContracts'))
    expect(ids.indexOf('closeRouteContracts')).toBeLessThan(ids.indexOf('translateGeometryToNonNegativeOrigin'))
  })

  test('the three symmetric passes are mutually unordered (spec §8 R1: order is empirically free)', () => {
    const trio = ['applySymmetricFanoutEmissions', 'applySymmetricParallelEdgeLanes', 'applyParallelDuplicateLanes']
    for (const id of trio) {
      const p = LAYOUT_PIPELINE.find(x => x.id === id)
      expect(p).toBeDefined()
      expect(p!.after.some(dep => trio.includes(dep))).toBe(false)
    }
  })

  test('mayChangeMetrics budgets are well-formed (improve-only | {worsenBy>0})', () => {
    for (const p of LAYOUT_PIPELINE) {
      for (const budget of Object.values(p.mayChangeMetrics ?? {})) {
        const ok = budget === 'improve-only' || (typeof budget === 'object' && typeof budget.worsenBy === 'number' && budget.worsenBy > 0)
        expect(ok).toBe(true)
      }
    }
  })
})

describe('declared pass budgets on actual native geometry', () => {
  test.each([
    ['default production options', {}],
    ['audit explicitly disabled', { checkLayoutPasses: false }],
    ['audit enabled', { checkLayoutPasses: true }],
  ] as const)('the public engine rejects actual detour bends before fallback: %s', (_name, options) => {
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
      layoutGraphSync(parseMermaid('flowchart LR\nA --> B'), options)
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

  test('reciprocal symmetry cannot displace already proven canonical ports', () => {
    const graph = parseMermaid('flowchart LR\nN2-->N3\nN4-->N0\nN2-.-N0\nN0-->N2\nN4-->N1')
    const positioned = layoutGraphSync(graph)
    expect(positioned.certification?.status).toBe('passed')
    expect(assessLayout(graph, positioned).metrics.portEndpointRate).toBeGreaterThanOrEqual(0.7)
    expect(assessLayout(graph, positioned).metrics.edgeCrossings).toBe(0)
  })

  test.each([...simpleFixtures(), ...complicatedFixtures()])('$id', fixture => {
    const positioned = layoutGraphSync(parseMermaid(fixture.source), { checkLayoutPasses: true })
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

  test('checkInvariants throws when a positions pass runs after the freeze', () => {
    const ctx: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    expect(() => runPipeline(ctx, [mkPass({ id: 'freeze', freezesNodes: true }), mkPass({ id: 'move', mutates: ['positions'], run: moveFirstNode })], { checkInvariants: true })).toThrow(/freeze/)
  })

  test('a whole-graph translate after the freeze is allowed', () => {
    const ctx: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    expect(() => runPipeline(ctx, [mkPass({ id: 'freeze', freezesNodes: true }), mkPass({ id: 'translate', mutates: ['translate'], run: moveFirstNode })], { checkInvariants: true })).not.toThrow()
  })

  test('checkInvariants throws when a post-freeze edge rewrite drops its certificate', () => {
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
        { checkInvariants: true },
      ),
    ).toThrow(/routeCertificate/)
  })

  test('checkInvariants allows a post-freeze edge rewrite that reissues a certificate', () => {
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
        { checkInvariants: true },
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
        { checkInvariants: true, measureMetrics: c => ({ bends: c.nodes[0]!.x }) },
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
    expect(() => runPipeline(ctx, [pass], { checkInvariants: true, measureMetrics: c => ({ portRate: c.nodes[0]!.x }) })).not.toThrow()
    expect(() => runPipeline(ctx, [pass], { checkInvariants: true })).toThrow(/no geometry measurement/)
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
    expect(() => runPipeline(make(), [pass(true)], { checkInvariants: true, measureMetrics })).not.toThrow()
    expect(() => runPipeline(make(), [pass(false)], { checkInvariants: true, measureMetrics })).toThrow(/straighten.*portRate/)
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
