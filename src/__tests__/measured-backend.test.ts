import { describe, expect, test } from 'bun:test'
import { DeferredDependencyError, GraphLayoutUnsupportedError, LayoutCertificationError, LayoutWorkLimitError, withGraphLayoutDecisionObserver, selectElkForGraphFamily, type GraphLayoutDecision } from '../layout/backend.ts'
import { runMeasuredGraphBackend, solveMeasuredLayout } from '../layout/measured-backend.ts'
import { elkMeasuredAdapter } from '../layout/elk-measured-adapter.ts'
import { nativeMeasuredAdapter } from '../layout/native-measured-adapter.ts'
import { fitMeasuredLayout } from '../layout/fit-measured-layout.ts'
import { assignChannelTracks } from '../layout/channel-tracks.ts'
import type { MeasuredGraph, MeasuredLayoutResult } from '../layout/measured-graph.ts'

describe('measured family backend selection', () => {
  test('invalid backend selections cannot execute or report a measured producer, even with fallback', () => {
    const invalid = ['typo', 'trinity', 0, Symbol('typo'), { toString() { throw new Error('must not coerce invalid selection') } }]
    for (const backend of invalid) for (const fallback of ['none', 'elk'] as const) {
      const calls: string[] = [], decisions: GraphLayoutDecision[] = []
      const options = { graphLayout: { backend, fallback } } as unknown as Parameters<typeof runMeasuredGraphBackend>[0]
      let failure: unknown
      try {
        withGraphLayoutDecisionObserver(value => decisions.push(value), () => runMeasuredGraphBackend(options,
          () => { calls.push('native'); return 1 }, () => { calls.push('elk'); return 2 }, true,
          () => { calls.push('retain') }))
      } catch (error) { failure = error }
      expect(calls).toEqual([])
      expect(decisions).toEqual([])
      expect(failure).toBeInstanceOf(TypeError)
    }
  })

  test('family fallback rejects invalid backend names without coercing the selection', () => {
    for (const backend of ['typo', 'trinity', Symbol('typo'), { toString() { throw new Error('must not coerce invalid selection') } }]) {
      for (const fallback of ['none', 'elk'] as const) {
        const options = { graphLayout: { backend, fallback } } as unknown as Parameters<typeof selectElkForGraphFamily>[0]
        expect(() => selectElkForGraphFamily(options, 'sequence')).toThrow(TypeError)
      }
    }
  })

  test('one backend read determines both the actual producer and its retained decision', () => {
    let reads = 0
    const options = { graphLayout: { get backend() { return reads++ === 0 ? 'agentic' as const : 'elk' as const }, fallback: 'none' as const } }
    const calls: string[] = [], decisions: GraphLayoutDecision[] = []
    const result = withGraphLayoutDecisionObserver(value => decisions.push(value), () => runMeasuredGraphBackend(options,
      () => { calls.push('native'); return 1 }, () => { calls.push('elk'); return 2 }, false, undefined))
    expect(result).toBe(1)
    expect(reads).toBe(1)
    expect(calls).toEqual(['native'])
    expect(decisions[0]).toMatchObject({ requested: 'agentic', selected: 'agentic', implementation: 'agentic-layered@28' })
  })

  test('a producer cannot rewrite the backend identity of the decision it already executed', () => {
    const policy: { backend: 'agentic' | 'elk'; fallback: 'none' } = { backend: 'agentic', fallback: 'none' }
    const decisions: GraphLayoutDecision[] = []
    const result = withGraphLayoutDecisionObserver(value => decisions.push(value), () => runMeasuredGraphBackend({ graphLayout: policy },
      () => { policy.backend = 'elk'; return 'native' }, () => 'elk'))
    expect(result).toBe('native')
    expect(decisions[0]).toMatchObject({ requested: 'agentic', selected: 'agentic', implementation: 'agentic-layered@28' })
  })

  test('an explicit policy with a missing backend cannot silently select ELK', () => {
    for (const backend of [undefined, null]) for (const fallback of ['none', 'elk'] as const) {
      const options = { graphLayout: { backend, fallback } } as unknown as Parameters<typeof runMeasuredGraphBackend>[0]
      let calls = 0
      expect(() => runMeasuredGraphBackend(options, () => ++calls, () => ++calls)).toThrow(TypeError)
      expect(() => selectElkForGraphFamily(options, 'sequence')).toThrow(TypeError)
      expect(calls).toBe(0)
    }
    expect(selectElkForGraphFamily({}, 'sequence')).toMatchObject({ requested: 'elk', selected: 'elk', fallback: 'none' })
  })

  test('the admitted fallback cannot change during producer execution', () => {
    for (const permitted of [false, true]) {
      const policy = { backend: 'agentic' as const, fallback: permitted ? 'elk' as const : 'none' as const }
      const decline = new GraphLayoutUnsupportedError('capacity'), decisions: GraphLayoutDecision[] = []
      let elkCalls = 0
      const run = () => withGraphLayoutDecisionObserver(value => decisions.push(value), () => runMeasuredGraphBackend({ graphLayout: policy },
        () => { policy.fallback = permitted ? 'none' : 'elk'; throw decline }, () => { elkCalls++; return 'elk' }))
      if (permitted) {
        expect(run()).toBe('elk')
        expect(decisions[0]).toMatchObject({ requested: 'agentic', selected: 'elk', fallback: 'elk' })
        expect(elkCalls).toBe(1)
      } else {
        expect(run).toThrow(decline)
        expect(decisions).toEqual([])
        expect(elkCalls).toBe(0)
      }
    }
    const policy = { backend: 'agentic' as const, fallback: 'none' as 'none' | 'elk' }, decisions: GraphLayoutDecision[] = []
    withGraphLayoutDecisionObserver(value => decisions.push(value), () => runMeasuredGraphBackend({ graphLayout: policy },
      () => { policy.fallback = 'elk'; return 'native' }, () => 'elk'))
    expect(decisions[0]).toMatchObject({ requested: 'agentic', selected: 'agentic', fallback: 'none' })
  })

  test('invalid fallback values are rejected without executing any producer', () => {
    for (const fallback of [null, 'typo', Symbol('typo'), { toString() { throw new Error('must not coerce invalid fallback') } }]) {
      const options = { graphLayout: { backend: 'agentic', fallback } } as unknown as Parameters<typeof runMeasuredGraphBackend>[0]
      let calls = 0
      expect(() => runMeasuredGraphBackend(options, () => ++calls, () => ++calls)).toThrow(TypeError)
      expect(() => selectElkForGraphFamily(options, 'sequence')).toThrow(TypeError)
      expect(calls).toBe(0)
    }
  })

  test('retainers and observers share closed evidence of the producer that actually ran', () => {
    const retained: GraphLayoutDecision[] = [], observed: GraphLayoutDecision[] = [], writes: boolean[] = []
    const result = withGraphLayoutDecisionObserver(value => observed.push(value), () => runMeasuredGraphBackend(
      { graphLayout: { backend: 'agentic', fallback: 'none' } }, () => 'native', () => 'elk', false,
      (_value, decision) => {
        retained.push(decision)
        writes.push(Reflect.set(decision, 'requested', 'elk'), Reflect.set(decision, 'selected', 'elk'),
          Reflect.set(decision.attempts[0]!, 'backend', 'elk'), Reflect.deleteProperty(decision.attempts, '0'))
      }))
    expect(result).toBe('native')
    expect(writes).toEqual([false, false, false, false])
    expect(observed[0]).toBe(retained[0])
    expect(observed[0]).toMatchObject({ requested: 'agentic', selected: 'agentic', fallback: 'none',
      attempts: [{ backend: 'agentic', outcome: 'selected' }], implementation: 'agentic-layered@28' })
  })

  test('attributes exactly one typed-decline fallback and retains its actual reason', () => {
    const decisions: GraphLayoutDecision[] = [], calls: string[] = []
    const result = withGraphLayoutDecisionObserver(value => decisions.push(value), () => runMeasuredGraphBackend(
      { graphLayout: { backend: 'agentic', fallback: 'elk' } },
      () => { calls.push('native'); throw new GraphLayoutUnsupportedError('channel capacity') },
      () => { calls.push('elk'); return 'placed' },
    ))
    expect(result).toBe('placed')
    expect(calls).toEqual(['native', 'elk'])
    expect(decisions).toEqual([expect.objectContaining({ requested: 'agentic', selected: 'elk', reason: 'channel capacity',
      attempts: [{ backend: 'agentic', outcome: 'unsupported', reason: 'channel capacity' }, { backend: 'elk', outcome: 'selected' }] })])
    expect(Object.isFrozen(decisions[0]!.attempts)).toBe(true)
  })

  test.each([
    new TypeError('broken measured geometry'),
    new DeferredDependencyError('native', async () => {}),
  ])('propagates %s without executing fallback', error => {
    let fallback = 0
    for (const allowCandidateRejection of [false, true]) {
      expect(() => runMeasuredGraphBackend({ graphLayout: { backend: 'agentic', fallback: 'elk' } },
        () => { throw error }, () => { fallback++; return 0 }, allowCandidateRejection)).toThrow(error)
      expect(fallback).toBe(0)
    }
  })

  test('only the generic graph policy admits certified rejection and retains its decision before observing it', () => {
    const error = new LayoutCertificationError([]), options = { graphLayout: { backend: 'agentic' as const, fallback: 'elk' as const } }
    let fallbacks = 0
    const fallback = () => { fallbacks++; return { layoutDecision: undefined as GraphLayoutDecision | undefined } }
    expect(() => runMeasuredGraphBackend(options, () => { throw error }, fallback)).toThrow(error)
    expect(fallbacks).toBe(0)
    const order: string[] = []
    const result = withGraphLayoutDecisionObserver(() => { order.push('observe') }, () => runMeasuredGraphBackend(options,
      () => { throw error }, fallback, true, (value, decision) => { order.push('retain'); value.layoutDecision = decision }))
    expect(fallbacks).toBe(1)
    expect(order).toEqual(['retain', 'observe'])
    expect(result.layoutDecision).toMatchObject({ requested: 'agentic', selected: 'elk', reason: 'candidate failed mandatory geometry certification',
      attempts: [{ backend: 'agentic', outcome: 'candidate-rejected', reason: 'candidate failed mandatory geometry certification' }, { backend: 'elk', outcome: 'selected' }] })
    expect(() => runMeasuredGraphBackend({ graphLayout: { backend: 'agentic' } }, () => { throw error }, fallback, true)).toThrow(error)
    expect(fallbacks).toBe(1)
  })

  test('supplied-ledger exhaustion cannot authorize an ELK fallback', () => {
    const work = { pairs: 0, arcs: 100, swaps: 100 }
    let fallback = 0
    expect(() => runMeasuredGraphBackend({ graphLayout: { backend: 'agentic', fallback: 'elk' } },
      () => assignChannelTracks([{ sourceCross: 0, targetCross: 10, offset: 0, track: 0 }], 20, 4, 20, work,
        () => { throw new LayoutWorkLimitError('pairs') }),
      () => { fallback++; return 0 },
    )).toThrow(LayoutWorkLimitError)
    expect(work).toEqual({ pairs: -1, arcs: 100, swaps: 100 })
    expect(fallback).toBe(0)
  })

  test('strict selection retains capability errors and default selection preserves legacy evidence', () => {
    const error = new GraphLayoutUnsupportedError('expanded graph limit'), decisions: GraphLayoutDecision[] = []
    expect(() => runMeasuredGraphBackend({ graphLayout: { backend: 'agentic' } }, () => { throw error }, () => 'elk')).toThrow(error)
    const result = withGraphLayoutDecisionObserver(value => decisions.push(value), () => runMeasuredGraphBackend({}, () => { throw new Error('native must not execute') }, () => 'legacy'))
    expect(result).toBe('legacy')
    expect(decisions).toEqual([])
  })
})

describe('measured solve boundary', () => {
  const graph: MeasuredGraph = {
    nodes: [{ id: 'relation-1 漢🙂', width: 100, height: 40, contact: 'rectangle', paintStrokeWidth: 2 }, { id: 'target', width: 100, height: 40, contact: 'rectangle', paintStrokeWidth: 2 }],
    edges: [{ source: 0, target: 1, minSpan: 1, sourcePortSpan: 2, targetPortSpan: 7, label: { width: 56, height: 20 } }],
    direction: 'TB', padding: 32, nodeSpacing: 40, layerSpacing: 72, edgeSpacing: 8, minimumTerminalLead: 16, maximumEdgeStrokeWidth: 2,
  }

  test.each([['Native', nativeMeasuredAdapter], ['ELK', elkMeasuredAdapter({ rootId: 'measured-test', edgeNodeSpacing: 12 })]] as const)('%s supplies placement and routed geometry without changing measured input', (_name, adapter) => {
    const before = structuredClone(graph)
    const placement = solveMeasuredLayout({ role: 'placement', graph }, adapter)
    const routed = solveMeasuredLayout({ role: 'routed', graph }, adapter)
    expect(graph).toEqual(before)
    for (const geometry of [placement, routed]) {
      expect(geometry.nodes).toHaveLength(2)
      expect(geometry.nodes.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true)
      expect(geometry.height).toBeGreaterThan(80)
    }
    expect(routed.edges).toHaveLength(1)
    const route = routed.edges[0]!
    expect(route.points.length).toBeGreaterThanOrEqual(2)
    expect(route.labelPosition).toBeDefined()
    // Both rectangles are separated along the requested axis; routes retain
    // the authored endpoint order, regardless of backend coordinates.
    const first = route.points[0]!, last = route.points.at(-1)!
    expect(first.y).toBeGreaterThanOrEqual(routed.nodes[0]!.y)
    expect(first.y).toBeLessThanOrEqual(routed.nodes[0]!.y + 40)
    expect(last.y).toBeGreaterThanOrEqual(routed.nodes[1]!.y)
    expect(last.y).toBeLessThanOrEqual(routed.nodes[1]!.y + 40)
    const empty = { ...graph, nodes: [], edges: [], minimumTerminalLead: 0 }
    expect(solveMeasuredLayout({ role: 'routed', graph: empty }, adapter)).toMatchObject({ width: 64, height: 64, nodes: [], edges: [] })
  })

  test('Native and ELK reject own contradictory contact metadata without observing inherited diamond metadata', () => {
    const rectangle = { id: 'rectangle', width: 100, height: 60, contact: 'rectangle' as const, paintStrokeWidth: 2 }
    const input: MeasuredGraph = { nodes: [{ ...rectangle, contactDiamond: { strokeExtent: NaN } }], edges: [], direction: 'TB', padding: 32, nodeSpacing: 40, layerSpacing: 72,
      edgeSpacing: 8, minimumTerminalLead: 0, nodeClearance: 0, maximumEdgeStrokeWidth: 2, maximumEdgeBendRadius: 0 }
    const before = structuredClone(input), request = { role: 'placement' as const, graph: input }
    for (const adapter of [nativeMeasuredAdapter, elkMeasuredAdapter({ rootId: 'contradictory', edgeNodeSpacing: 6 })]) expect(() => adapter.solve(request)).toThrow(TypeError)
    expect(input).toEqual(before)
    let observations = 0
    const inherited = Object.assign(Object.create({ get contactDiamond() { observations++; return { strokeExtent: NaN } } }), { ...rectangle, id: 'inherited' })
    const plainRequest = { role: 'placement' as const, graph: { ...input, nodes: [inherited] } }
    nativeMeasuredAdapter.solve(plainRequest)
    elkMeasuredAdapter({ rootId: 'inherited', edgeNodeSpacing: 6 }).solve(plainRequest)
    expect(observations).toBe(0)
  })

  test('shared fitting retains actual permitted dimensions rather than the smaller measured minimum', () => {
    const input: MeasuredGraph = { ...graph, nodes: [{ id: 'small', width: 20, height: 20, contact: 'rectangle', paintStrokeWidth: 2, sizePolicy: 'minimum' }],
      edges: [{ source: 0, target: 0, minSpan: 1, label: { width: 90, height: 24 }, sourcePortSpan: 2, targetPortSpan: 2 }] }
    const result = { width: 200, height: 200, nodes: [{ x: 0, y: 0, width: 100, height: 80 }],
      edges: [{ points: [{ x: 100, y: 30 }, { x: 130, y: 30 }, { x: 130, y: 60 }, { x: 100, y: 60 }], labelPosition: { x: 130, y: 45 } }] }
    const fitted = fitMeasuredLayout(input, result)
    expect([fitted.nodes[0]!.width, fitted.nodes[0]!.height]).toEqual([100, 80])
    expect(fitted.width).toBeGreaterThanOrEqual(fitted.nodes[0]!.x + 100 + input.padding)
    expect(fitted.height).toBeGreaterThanOrEqual(fitted.nodes[0]!.y + 80 + input.padding)
  })

  test('rejects wrong roles, lost subjects and invalid extents before family completion', () => {
    const valid = { width: 200, height: 200, nodes: [{ x: 0, y: 0 }, { x: 0, y: 100 }], edges: [{ points: [{ x: 50, y: 40 }, { x: 50, y: 100 }] }] }
    const malformed: MeasuredLayoutResult[] = [
      { kind: 'placed', geometry: valid },
      { kind: 'routed', geometry: { ...valid, nodes: [] } },
      { kind: 'routed', geometry: { ...valid, edges: [] } },
      { kind: 'routed', geometry: { ...valid, width: Infinity } },
      { kind: 'routed', geometry: { ...valid, nodes: [{ x: NaN, y: 0 }, valid.nodes[1]!] } },
      { kind: 'routed', geometry: { ...valid, nodes: [{ x: 0, y: 0, width: 101, height: 40 }, valid.nodes[1]!] } },
      { kind: 'routed', geometry: { ...valid, edges: [{ points: [{ x: 0, y: 0 }, { x: Infinity, y: 40 }] }] } },
    ]
    for (const result of malformed) expect(() => solveMeasuredLayout({ role: 'routed', graph }, { solve: () => result })).toThrow(TypeError)
    const dependency = new DeferredDependencyError('native', async () => {})
    expect(() => solveMeasuredLayout({ role: 'routed', graph }, { solve: () => { throw dependency } })).toThrow(dependency)
  })

  test('Native and ELK preserve diamond capability refusals for placement and routed requests', () => {
    const input: MeasuredGraph = { ...graph, nodes: [
      { id: 'Q', width: 100, height: 100, contact: 'diamond', contactDiamond: { strokeExtent: 4 }, paintStrokeWidth: 2 },
      { id: 'A', width: 100, height: 60, contact: 'rectangle', paintStrokeWidth: 2 },
      { id: 'B', width: 100, height: 60, contact: 'rectangle', paintStrokeWidth: 2 },
    ], edges: [{ source: 0, target: 1, minSpan: 1, sourcePortSpan: 2, targetPortSpan: 12, sourceMarkerPresent: false },
      { source: 0, target: 2, minSpan: 1, sourcePortSpan: 2, targetPortSpan: 12, sourceMarkerPresent: false }] }
    for (const role of ['placement', 'routed'] as const) {
      expect(() => nativeMeasuredAdapter.solve({ role, graph: input })).toThrow(GraphLayoutUnsupportedError)
      expect(() => elkMeasuredAdapter({ rootId: 'diamond', edgeNodeSpacing: 6 }).solve({ role, graph: input })).toThrow(GraphLayoutUnsupportedError)
    }
    const thin = { ...input, nodes: input.nodes.map(({ paintStrokeWidth: _, ...body }) => body),
      edges: input.edges.map(({ sourcePortSpan: _, targetPortSpan: __, ...edge }) => edge), edgeSpacing: undefined,
      nodeClearance: undefined, maximumEdgeStrokeWidth: undefined, maximumEdgeBendRadius: undefined }
    expect(() => elkMeasuredAdapter({ rootId: 'diamond-thin', edgeNodeSpacing: 6 }).solve({ role: 'routed', graph: thin })).toThrow(GraphLayoutUnsupportedError)
  })

  test('ELK measured subset declines constraints it cannot translate instead of dropping them', () => {
    const adapter = elkMeasuredAdapter({ rootId: 'measured-test', edgeNodeSpacing: 12 })
    for (const unsupported of [
      { ...graph, nodes: [{ ...graph.nodes[0]!, contact: 'ellipse' as const, contactEllipse: { rx: 20, ry: 20 } }, graph.nodes[1]!] },
      { ...graph, edges: [{ ...graph.edges[0]!, minSpan: 2 }] },
      { ...graph, maximumEdgeBendRadius: 12 },
    ]) expect(() => solveMeasuredLayout({ role: 'routed', graph: unsupported }, adapter)).toThrow('ELK graph layout does not support this input')
  })

  test.each((['TB', 'BT', 'LR', 'RL'] as const).flatMap(direction => [
    { direction, name: 'ELK', adapter: elkMeasuredAdapter({ rootId: 'measured-test', edgeNodeSpacing: 0 }) },
    { direction, name: 'Native', adapter: nativeMeasuredAdapter },
  ]))('$name preserves measured body capacity and terminal lead in $direction', ({ direction, adapter }) => {
    const demand: MeasuredGraph = { ...graph, direction, minimumTerminalLead: 40,
      nodes: graph.nodes.map(node => ({ ...node, width: 40, height: 30, sizePolicy: 'minimum' })),
      edges: Array.from({ length: 8 }, () => ({ source: 0, target: 1, minSpan: 1, sourcePortSpan: 20, targetPortSpan: 12 })),
    }
    const before = structuredClone(demand)
    const result = solveMeasuredLayout({ role: 'routed', graph: demand }, adapter)
    expect(demand).toEqual(before)
    const horizontal = direction === 'LR' || direction === 'RL'
    expect(horizontal ? result.nodes[0]!.height : result.nodes[0]!.width).toBeGreaterThan(horizontal ? 30 : 40)
    const ports = result.edges.map(edge => horizontal ? edge.points[0]!.y : edge.points[0]!.x).sort((a, b) => a - b)
    for (let i = 1; i < ports.length; i++) expect(ports[i]! - ports[i - 1]!).toBeGreaterThanOrEqual(28)
    expect(() => solveMeasuredLayout({ role: 'routed', graph: { ...demand, nodes: demand.nodes.map(node => ({ ...node, sizePolicy: 'fixed' })) } }, adapter)).toThrow(GraphLayoutUnsupportedError)
    const loop = solveMeasuredLayout({ role: 'routed', graph: { ...demand, nodes: [demand.nodes[0]!], edges: [{ ...demand.edges[0]!, target: 0 }] } }, adapter).edges[0]!.points
    expect(Math.hypot(loop[0]!.x - loop.at(-1)!.x, loop[0]!.y - loop.at(-1)!.y)).toBeGreaterThanOrEqual(20)
    for (const [a, b] of [[loop[0]!, loop[1]!], [loop.at(-1)!, loop.at(-2)!]] as const) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(40)
  })
  test.each(['TB', 'BT', 'LR', 'RL'] as const)('Native production hands wide ordinary faces to the early capacity planner in %s', async direction => {
    const { parseMermaid } = await import('../parser.ts')
    const { layoutGraphSync } = await import('../layout-engine.ts')
    const model = parseMermaid(`flowchart ${direction}\nA --> T\nB --> T`)
    const options = { graphLayout: { backend: 'agentic' as const, fallback: 'none' as const },
      styleFace: { edge: { lineWidth: 4 }, node: { cornerRadius: 0 } } }
    const before = structuredClone(model), output = layoutGraphSync(model, options), target = output.nodes.find(node => node.id === 'T')!
    expect(model).toEqual(before)
    expect(output.edges).toHaveLength(2)
    expect(direction === 'LR' || direction === 'RL' ? target.height : target.width).toBeGreaterThanOrEqual(42)
    const fixed = new Map([['T', { width: 30, height: 30 }]])
    expect(() => layoutGraphSync(model, { ...options, nodeSizes: fixed })).toThrow('fixed body has insufficient physical port capacity')
    expect(fixed.get('T')).toEqual({ width: 30, height: 30 })
  })

})
