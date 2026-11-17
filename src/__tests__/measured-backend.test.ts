import { describe, expect, test } from 'bun:test'
import { DeferredDependencyError, GraphLayoutUnsupportedError, LayoutCertificationError, withGraphLayoutDecisionObserver, type GraphLayoutDecision } from '../layout/backend.ts'
import { runElkGraphBackend } from '../layout/measured-backend.ts'

describe('ELK family producer evidence', () => {
  test('runs ELK once and retains its decision before observing it', () => {
    const order: string[] = [], decisions: GraphLayoutDecision[] = []
    const result = withGraphLayoutDecisionObserver(value => { order.push('observe'); decisions.push(value) }, () => runElkGraphBackend(
      { graphLayout: { backend: 'elk' } },
      () => { order.push('elk'); return { layoutDecision: undefined as GraphLayoutDecision | undefined } },
      (value, decision) => { order.push('retain'); value.layoutDecision = decision },
    ))
    expect(order).toEqual(['elk', 'retain', 'observe'])
    expect(result.layoutDecision).toEqual({ requested: 'elk', selected: 'elk', fallback: 'none', implementation: 'elk-layered@1', attempts: [{ backend: 'elk', outcome: 'selected' }] })
    expect(decisions).toEqual([result.layoutDecision!])
    expect(Object.isFrozen(decisions[0]!.attempts)).toBe(true)
  })

  test.each([new TypeError('broken geometry'), new DeferredDependencyError('elk', async () => {}), new LayoutCertificationError([])])('propagates %s without retrying the producer', error => {
    let calls = 0
    expect(() => runElkGraphBackend({ graphLayout: { backend: 'elk' } }, () => { calls++; throw error })).toThrow(error)
    expect(calls).toBe(1)
  })

  test('rejects retired Native selection and fallback before running layout', () => {
    let calls = 0
    for (const policy of [{ backend: 'agentic' }, { backend: 'elk', fallback: 'elk' }]) {
      expect(() => runElkGraphBackend({ graphLayout: policy as never }, () => { calls++; return 0 })).toThrow(GraphLayoutUnsupportedError)
    }
    expect(calls).toBe(0)
  })

  test('omitted selection preserves implicit evidence', () => {
    const decisions: GraphLayoutDecision[] = []
    const result = withGraphLayoutDecisionObserver(value => decisions.push(value), () => runElkGraphBackend({}, () => 'placed'))
    expect(result).toBe('placed')
    expect(decisions).toEqual([])
  })
})
