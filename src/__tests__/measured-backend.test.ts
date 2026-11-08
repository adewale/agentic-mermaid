import { describe, expect, test } from 'bun:test'
import { DeferredDependencyError, GraphLayoutUnsupportedError, LayoutCertificationError, withGraphLayoutDecisionObserver, type GraphLayoutDecision } from '../layout/backend.ts'
import { runMeasuredGraphBackend, solveMeasuredLayout } from '../layout/measured-backend.ts'
import { elkMeasuredAdapter } from '../layout/elk-measured-adapter.ts'
import { nativeMeasuredAdapter } from '../layout/native-measured-adapter.ts'
import type { MeasuredGraph, MeasuredLayoutResult } from '../layout/measured-graph.ts'

describe('measured family backend selection', () => {
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
    nodes: [{ id: 'relation-1 漢🙂', width: 100, height: 40 }, { id: 'target', width: 100, height: 40 }],
    edges: [{ source: 0, target: 1, minSpan: 1, label: { width: 56, height: 20 } }],
    direction: 'TB', padding: 32, nodeSpacing: 40, layerSpacing: 72,
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
  })

  test('rejects wrong roles, lost subjects and invalid extents before family completion', () => {
    const valid = { width: 200, height: 200, nodes: [{ x: 0, y: 0 }, { x: 0, y: 100 }], edges: [{ points: [{ x: 50, y: 40 }, { x: 50, y: 100 }] }] }
    const malformed: MeasuredLayoutResult[] = [
      { kind: 'placed', geometry: valid },
      { kind: 'routed', geometry: { ...valid, nodes: [] } },
      { kind: 'routed', geometry: { ...valid, edges: [] } },
      { kind: 'routed', geometry: { ...valid, width: Infinity } },
    ]
    for (const result of malformed) expect(() => solveMeasuredLayout({ role: 'routed', graph }, { solve: () => result })).toThrow(TypeError)
    const dependency = new DeferredDependencyError('native', async () => {})
    expect(() => solveMeasuredLayout({ role: 'routed', graph }, { solve: () => { throw dependency } })).toThrow(dependency)
  })

  test('ELK measured subset declines constraints it cannot translate instead of dropping them', () => {
    const adapter = elkMeasuredAdapter({ rootId: 'measured-test', edgeNodeSpacing: 12 })
    for (const unsupported of [
      { ...graph, nodes: [{ ...graph.nodes[0]!, minimumPortSpacing: 24 }, graph.nodes[1]!] },
      { ...graph, edges: [{ ...graph.edges[0]!, minSpan: 2 }] },
      { ...graph, maximumEdgeBendRadius: 12 },
    ]) expect(() => solveMeasuredLayout({ role: 'routed', graph: unsupported }, adapter)).toThrow('ELK graph layout does not support this input')
  })
})
