import * as implementation from './optimization-runtime.ts'
export type { LayoutOptimizationEvidence } from './optimization-budget.ts'
/** Source and all-in-one synchronous builds already carry their implementation. */
export function layoutOptimization(_enable = false): typeof implementation | undefined { return implementation }
