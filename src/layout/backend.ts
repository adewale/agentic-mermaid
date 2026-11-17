import { immutableDecision } from './decision-evidence.ts'

export { graphLayoutDecisionsOf, retainGraphLayoutDecision, transferGraphLayoutDecisions } from './decision-evidence.ts'

import type { Direction, GraphLayoutOptions, RenderOptions } from '../types.ts'

export { measureRenderStage, type RenderStage, type RenderStageSample, withRenderStageObserver } from '../render-stages.ts'
export { DeferredDependencyError, type LayoutCertificationAttempt, LayoutCertificationError } from './certification-error.ts'

export interface GraphLayoutDecision {
  readonly requested: 'elk'
  readonly fallback: 'none'
  readonly selected: 'elk'
  readonly reason?: string
  readonly attempts: readonly {
    readonly backend: 'elk'
    readonly outcome: 'selected'
    readonly reason?: string
  }[]
  readonly implementation: string
  readonly role?: 'primary' | 'companion'
}

export class GraphLayoutUnsupportedError extends Error {
  readonly code = 'GRAPH_LAYOUT_UNSUPPORTED'
  constructor(readonly reason: string) {
    super(`Graph layout configuration is unsupported: ${reason}`)
    this.name = 'GraphLayoutUnsupportedError'
  }
}

let observer: ((decision: GraphLayoutDecision) => void) | undefined

export function withGraphLayoutDecisionObserver<T>(observe: (decision: GraphLayoutDecision) => void, run: () => T): T {
  const previous = observer
  observer = observe
  try {
    return run()
  } finally {
    observer = previous
  }
}

export function emitGraphLayoutDecision(decision: GraphLayoutDecision): void {
  observer?.(immutableDecision(decision))
}

/** Validate direct layout callers as well as the public option schema. */
function assertElkSelection(policy: GraphLayoutOptions | undefined): void {
  if (!policy) return
  if (policy.backend !== undefined && policy.backend !== 'elk') throw new GraphLayoutUnsupportedError("Native ('agentic') was removed; use the ELK graph backend")
  if (policy.fallback !== undefined && policy.fallback !== 'none') throw new GraphLayoutUnsupportedError('Graph backend fallback was removed; ELK is the sole graph engine')
}

/** Specialized families retain their actual ELK producer evidence. */
export function selectElkForGraphFamily(options: Pick<RenderOptions, 'graphLayout'>, _family: string): GraphLayoutDecision {
  assertElkSelection(options.graphLayout)
  return elkDecision()
}

function elkDecision(): GraphLayoutDecision {
  return { requested: 'elk', fallback: 'none', selected: 'elk', attempts: [{ backend: 'elk', outcome: 'selected' }], implementation: 'elk-layered@1' }
}

/** Omitted policy preserves implicit evidence; an explicit policy records ELK. */
export function runElkGraphBackend<T>(options: Pick<RenderOptions, 'graphLayout'>, elk: () => T, retainDecision?: (result: T, decision: GraphLayoutDecision) => void): T {
  const policy = options.graphLayout
  assertElkSelection(policy)
  const result = elk()
  if (policy) {
    const decision = elkDecision()
    retainDecision?.(result, decision)
    emitGraphLayoutDecision(decision)
  }
  return result
}

/** Shared Mermaid-to-ELK direction mapping, without depending on the graph engine. */
export function directionToElk(dir: Direction): string {
  switch (dir) {
    case 'LR':
      return 'RIGHT'
    case 'RL':
      return 'LEFT'
    case 'BT':
      return 'UP'
    case 'TD':
    case 'TB':
    default:
      return 'DOWN'
  }
}
