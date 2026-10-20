import type { RenderOptions } from '../types.ts'

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
