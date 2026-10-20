import type { RenderOptions } from '../types.ts'
import { AGENTIC_LAYERED_IMPLEMENTATION, emitGraphLayoutDecision, GraphLayoutUnsupportedError, type GraphLayoutDecision } from './backend.ts'

/** Family adapters retain their measured geometry and painting rules. Only a
 * typed native capability decline permits the requested one-way fallback. */
export function runMeasuredGraphBackend<T>(
  options: Pick<RenderOptions, 'graphLayout'>,
  native: () => T,
  elk: () => T,
): T {
  const policy = options.graphLayout
  if (!policy) return elk()
  const attempts: Array<GraphLayoutDecision['attempts'][number]> = []
  let result: T, selected = policy.backend, reason: string | undefined
  if (policy.backend === 'agentic') {
    try {
      result = native()
      attempts.push({ backend: 'agentic', outcome: 'selected' })
    } catch (error) {
      if (!(error instanceof GraphLayoutUnsupportedError) || policy.fallback !== 'elk') throw error
      reason = error.reason
      attempts.push({ backend: 'agentic', outcome: 'unsupported', reason })
      result = elk()
      selected = 'elk'
      attempts.push({ backend: 'elk', outcome: 'selected' })
    }
  } else {
    result = elk()
    attempts.push({ backend: 'elk', outcome: 'selected' })
  }
  emitGraphLayoutDecision({ requested: policy.backend, fallback: policy.fallback ?? 'none', selected, attempts,
    implementation: selected === 'agentic' ? AGENTIC_LAYERED_IMPLEMENTATION : 'elk-layered@1', ...(reason ? { reason } : {}) })
  return result
}
