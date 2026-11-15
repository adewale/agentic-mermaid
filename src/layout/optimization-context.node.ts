import { layoutOptimizationKernel } from '../optional-kernels.node.js'
export type { LayoutOptimizationEvidence } from './optimization-budget.ts'
type Optimization = typeof import('./optimization-runtime.ts')
let implementation: Optimization | undefined
export function layoutOptimization(enable = false): Optimization | undefined {
  if (enable && !implementation) implementation = layoutOptimizationKernel() as Optimization
  return implementation
}
