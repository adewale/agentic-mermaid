import { DeferredDependencyError } from './certification-error.ts'
export type { LayoutOptimizationEvidence } from './optimization-budget.ts'
type Optimization = typeof import('./optimization-runtime.ts')
let implementation: Optimization | undefined
let pending: Promise<void> | undefined
function load(): Promise<void> {
  return pending ??= import('./optimization-runtime.ts').then(module => { implementation = module }).catch(error => { pending = undefined; throw error })
}
/** A disabled request neither loads nor initializes optional layout search. */
export function layoutOptimization(enable = false): Optimization | undefined {
  if (enable && !implementation) throw new DeferredDependencyError('Layout optimization', load)
  return implementation
}
