import { describe, expect, test } from 'bun:test'
import { DeferredDependencyError, GraphLayoutUnsupportedError, LayoutCertificationError, withGraphLayoutDecisionObserver, type GraphLayoutDecision } from '../layout/backend.ts'
import { runMeasuredGraphBackend } from '../layout/measured-backend.ts'

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
