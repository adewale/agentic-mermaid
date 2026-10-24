import type { RenderOptions } from '../types.ts'
import { LayoutCertificationError } from './certification-error.ts'
export { DeferredDependencyError, LayoutCertificationError, type LayoutCertificationAttempt } from './certification-error.ts'
export { withRenderStageObserver, measureRenderStage, type RenderStage, type RenderStageSample } from '../render-stages.ts'

export const AGENTIC_LAYERED_IMPLEMENTATION = 'agentic-layered@26'

export interface GraphLayoutDecision {
  readonly requested: 'elk' | 'agentic'
  readonly fallback: 'none' | 'elk'
  readonly selected: 'elk' | 'agentic'
  readonly reason?: string
  readonly attempts: readonly {
    readonly backend: 'elk' | 'agentic'
    readonly outcome: 'selected' | 'unsupported' | 'candidate-rejected'
    readonly reason?: string
  }[]
  readonly implementation: string
  readonly role?: 'primary' | 'companion'
}

export class GraphLayoutUnsupportedError extends Error {
  readonly code = 'GRAPH_LAYOUT_UNSUPPORTED'
  constructor(readonly reason: string) {
    super(`Agentic graph layout does not support this input: ${reason}`)
    this.name = 'GraphLayoutUnsupportedError'
  }
}

let observer: ((decision: GraphLayoutDecision) => void) | undefined
const decisions = new WeakMap<object, readonly GraphLayoutDecision[]>()

export function withGraphLayoutDecisionObserver<T>(observe: (decision: GraphLayoutDecision) => void, run: () => T): T {
  const previous = observer
  observer = observe
  try { return run() } finally { observer = previous }
}

function immutableDecision(decision: GraphLayoutDecision): GraphLayoutDecision {
  return Object.freeze({ ...decision, attempts: Object.freeze(decision.attempts.map(attempt => Object.freeze({ ...attempt }))) })
}

export function emitGraphLayoutDecision(decision: GraphLayoutDecision): void {
  observer?.(immutableDecision(decision))
}

export function retainGraphLayoutDecision(request: object, decision: GraphLayoutDecision): void {
  const retained = decisions.get(request) ?? []
  const value = immutableDecision(decision)
  if (retained.some(previous => JSON.stringify(previous) === JSON.stringify(value))) return
  decisions.set(request, Object.freeze([...retained, value]))
}

export function graphLayoutDecisionsOf(request: object): readonly GraphLayoutDecision[] {
  return decisions.get(request) ?? Object.freeze([])
}

/** Cache copies retain immutable producer evidence without attaching fields
 * to family geometry or changing its per-request primary/companion role. */
export function transferGraphLayoutDecisions(source: object, target: object): void {
  const retained = decisions.get(source)
  if (retained) decisions.set(target, retained)
}

/** Families whose specialized geometry has not joined the owned producer yet. */
export function selectElkForGraphFamily(options: Pick<RenderOptions, 'graphLayout'>, family: string): GraphLayoutDecision {
  const requested = options.graphLayout?.backend ?? 'elk'
  const fallback = options.graphLayout?.fallback ?? 'none'
  if (requested === 'agentic') {
    const reason = `${family} family geometry is not supported by the Agentic backend`
    if (fallback !== 'elk') throw new GraphLayoutUnsupportedError(reason)
    return { requested, fallback, selected: 'elk', reason, attempts: [{ backend: 'agentic', outcome: 'unsupported', reason }, { backend: 'elk', outcome: 'selected' }], implementation: 'elk-layered@1' }
  }
  return { requested, fallback, selected: 'elk', attempts: [{ backend: 'elk', outcome: 'selected' }], implementation: 'elk-layered@1' }
}

/** Family adapters retain their measured geometry and painting rules. Only a
 * typed native capability decline permits the requested one-way fallback. The
 * generic graph adapter also opts into certified candidate rejection. */
export function runMeasuredGraphBackend<T>(
  options: Pick<RenderOptions, 'graphLayout'>,
  native: () => T,
  elk: () => T,
  allowCandidateRejection = false,
  retainDecision?: (result: T, decision: GraphLayoutDecision) => void,
): T {
  const policy = options.graphLayout
  if (!policy) return elk()
  const attempts: Array<GraphLayoutDecision['attempts'][number]> = []
  let result: T, selected = policy.backend, reason: string | undefined
  if (policy.backend === 'agentic') {
    try {
      result = native()
    } catch (error) {
      const unsupported = error instanceof GraphLayoutUnsupportedError
      if ((!unsupported && !(allowCandidateRejection && error instanceof LayoutCertificationError)) || policy.fallback !== 'elk') throw error
      reason = unsupported ? error.reason : 'candidate failed mandatory geometry certification'
      attempts.push({ backend: 'agentic', outcome: unsupported ? 'unsupported' : 'candidate-rejected', reason })
      result = elk()
      selected = 'elk'
    }
  } else {
    result = elk()
  }
  attempts.push({ backend: selected, outcome: 'selected' })
  const decision: GraphLayoutDecision = { requested: policy.backend, fallback: policy.fallback ?? 'none', selected, attempts,
    implementation: selected === 'agentic' ? AGENTIC_LAYERED_IMPLEMENTATION : 'elk-layered@1', ...(reason ? { reason } : {}) }
  retainDecision?.(result, decision)
  emitGraphLayoutDecision(decision)
  return result
}
