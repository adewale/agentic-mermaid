import type { GraphLayoutOptions, PositionedGraph } from '../types.ts'
import type { RubricMetrics } from '../layout-rubric.ts'
import { DeferredDependencyError } from './certification-error.ts'
export type { LayoutOptimizationEvidence } from './optimization-budget.ts'

type Optimization = typeof import('./optimization-budget.ts')
let implementation: Optimization | undefined
function load(): Promise<void> {
  return import('./optimization-budget.ts').then(module => { implementation = module })
}

/** Default family rendering carries no optional graph search implementation. */
export function withLayoutOptimizationBudget<T>(owner: object, options: GraphLayoutOptions | undefined, run: () => T, isolate = false): T {
  if (!implementation) {
    if (!options?.quality && !options?.viewport) return run()
    throw new DeferredDependencyError('Layout optimization', load)
  }
  return implementation.withLayoutOptimizationBudget(owner, options, run, isolate)
}

export function layoutOptimizationEvidenceOf(owner: object) { return implementation?.layoutOptimizationEvidenceOf(owner) }
export function retainComparisonMetrics(graph: PositionedGraph, metrics: RubricMetrics, unreadable: boolean): void {
  implementation?.retainComparisonMetrics(graph, metrics, unreadable)
}
