// Tests for the LayoutPass abstraction (docs/design/system/layout-pass-pipeline.md):
// the manifest's structural invariants + runPipeline's debug-mode enforcement.
import { describe, expect, test } from 'bun:test'
import { complicatedFixtures, simpleFixtures } from '../../eval/visual-rubric/fixtures.ts'
import type { LayoutPass, PassContextBase } from '../layout/pass.ts'
import { assertTopologicalOrder, LayoutMetricBudgetError, runPipeline } from '../layout/pass.ts'
import { LAYOUT_PIPELINE, layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'

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
  test('the public engine rejects an actual routing pass that adds detour bends before trying a fallback', () => {
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
      layoutGraphSync(parseMermaid('flowchart LR\nA --> B'), { checkLayoutPasses: true })
    } catch (error) {
      failure = error
    } finally {
      pass.run = run
    }
    expect(failure).toBeInstanceOf(LayoutMetricBudgetError)
    expect(failure).toMatchObject({ pass: 'alignLayerNodes', metric: 'bends', before: 0, after: 4, allowance: 0 })
    expect(producerCalls).toBe(1)
  })

  test.each([...simpleFixtures(), ...complicatedFixtures()])('$id', fixture => {
    const positioned = layoutGraphSync(parseMermaid(fixture.source), { checkLayoutPasses: true })
    expect(positioned.certification?.status).toBe('passed')
  })
})

describe('runPipeline invariant enforcement', () => {
  interface TestCtx extends PassContextBase {
    log: string[]
    edges?: Array<{ points: Array<{ x: number; y: number }>; routeCertificate?: unknown }>
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

  test('checkInvariants throws on an out-of-order `after`', () => {
    const ctx: TestCtx = { frozen: false, nodes: [], log: [] }
    expect(() => runPipeline(ctx, [mkPass({ id: 'b', after: ['a'] }), mkPass({ id: 'a' })], { checkInvariants: true })).toThrow(/must run after/)
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

  test('production mode (no opts) does NOT enforce invariants', () => {
    const ctx: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    expect(() => runPipeline(ctx, [mkPass({ id: 'freeze', freezesNodes: true }), mkPass({ id: 'move', mutates: ['positions'], run: moveFirstNode })])).not.toThrow()
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
})
