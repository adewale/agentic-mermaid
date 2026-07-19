// Tests for the LayoutPass abstraction (docs/design/system/layout-pass-pipeline.md):
// the manifest's structural invariants + runPipeline's debug-mode enforcement.
import { describe, test, expect } from 'bun:test'
import { LAYOUT_PIPELINE } from '../layout-engine.ts'
import { runPipeline, assertTopologicalOrder } from '../layout/pass.ts'
import type { LayoutPass, PassContextBase } from '../layout/pass.ts'

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
        const ok = budget === 'improve-only'
          || (typeof budget === 'object' && typeof budget.worsenBy === 'number' && budget.worsenBy > 0)
        expect(ok).toBe(true)
      }
    }
  })
})

describe('runPipeline invariant enforcement', () => {
  interface TestCtx extends PassContextBase {
    log: string[]
    edges?: Array<{ points: Array<{ x: number; y: number }>; routeCertificate?: unknown }>
  }
  const mkPass = (over: Partial<LayoutPass<TestCtx>> & { id: string }): LayoutPass<TestCtx> => ({
    doc: '', after: [], mutates: ['edges'], determinism: 'in-place',
    run: c => { c.log.push(over.id) }, ...over,
  })
  const moveFirstNode = (c: TestCtx) => { const n = c.nodes[0]; if (n) n.x = 9 }

  test('runs passes in array order and honors enabled()', () => {
    const ctx: TestCtx = { frozen: false, nodes: [], log: [] }
    runPipeline(ctx, [mkPass({ id: 'a' }), mkPass({ id: 'b', enabled: () => false }), mkPass({ id: 'c' })])
    expect(ctx.log).toEqual(['a', 'c'])
  })

  test('checkInvariants throws on an out-of-order `after`', () => {
    const ctx: TestCtx = { frozen: false, nodes: [], log: [] }
    expect(() => runPipeline(ctx, [mkPass({ id: 'b', after: ['a'] }), mkPass({ id: 'a' })], { checkInvariants: true }))
      .toThrow(/must run after/)
  })

  test('checkInvariants throws when a positions pass runs after the freeze', () => {
    const ctx: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    expect(() => runPipeline(ctx, [
      mkPass({ id: 'freeze', freezesNodes: true }),
      mkPass({ id: 'move', mutates: ['positions'], run: moveFirstNode }),
    ], { checkInvariants: true })).toThrow(/freeze/)
  })

  test('a whole-graph translate after the freeze is allowed', () => {
    const ctx: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    expect(() => runPipeline(ctx, [
      mkPass({ id: 'freeze', freezesNodes: true }),
      mkPass({ id: 'translate', mutates: ['translate'], run: moveFirstNode }),
    ], { checkInvariants: true })).not.toThrow()
  })

  test('checkInvariants throws when a post-freeze edge rewrite drops its certificate', () => {
    const ctx: TestCtx = {
      frozen: false,
      nodes: [],
      edges: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], routeCertificate: { invariant: 'straight' } }],
      log: [],
    }
    expect(() => runPipeline(ctx, [
      mkPass({ id: 'freeze', freezesNodes: true }),
      mkPass({
        id: 'bad-edge-rewrite',
        mutates: ['edges'],
        run: c => {
          c.edges![0]!.points = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }]
          c.edges![0]!.routeCertificate = undefined
        },
      }),
    ], { checkInvariants: true })).toThrow(/routeCertificate/)
  })

  test('checkInvariants allows a post-freeze edge rewrite that reissues a certificate', () => {
    const ctx: TestCtx = {
      frozen: false,
      nodes: [],
      edges: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], routeCertificate: { invariant: 'straight' } }],
      log: [],
    }
    expect(() => runPipeline(ctx, [
      mkPass({ id: 'freeze', freezesNodes: true }),
      mkPass({
        id: 'good-edge-rewrite',
        mutates: ['edges'],
        run: c => {
          c.edges![0]!.points = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }]
          c.edges![0]!.routeCertificate = { invariant: 'explained-detour' }
        },
      }),
    ], { checkInvariants: true })).not.toThrow()
  })

  test('production mode (no opts) does NOT enforce invariants', () => {
    const ctx: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    expect(() => runPipeline(ctx, [
      mkPass({ id: 'freeze', freezesNodes: true }),
      mkPass({ id: 'move', mutates: ['positions'], run: moveFirstNode }),
    ])).not.toThrow()
  })

  test('onAfterPass fires only for passes that actually ran', () => {
    const ctx: TestCtx = { frozen: false, nodes: [], log: [] }
    const fired: string[] = []
    runPipeline(ctx, [mkPass({ id: 'a' }), mkPass({ id: 'skip', enabled: () => false }), mkPass({ id: 'b' })],
      { onAfterPass: p => { fired.push(p.id) } })
    expect(fired).toEqual(['a', 'b'])
  })
})
