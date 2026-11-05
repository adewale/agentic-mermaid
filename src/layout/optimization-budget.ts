import type { GraphLayoutOptions } from '../types.ts'

export interface LayoutOptimizationEvidence {
  readonly additionalProducerLimit: number
  readonly additionalProducerCalls: number
  readonly primaryProducerCalls: number
  readonly alternativesAttempted: number
  readonly selected: readonly string[]
}
interface Budget { extra: number; primary: number; attempts: number; optional: boolean; selected: string[] }
let active: Budget | undefined
const evidence = new WeakMap<object, LayoutOptimizationEvidence>()
class OptionalLayoutBudgetExceeded extends Error {}

/** One deterministic optional allowance shared by wrapping, ordering and
 * placement. Existing mandatory fallback work remains separately accounted. */
export function withLayoutOptimizationBudget<T>(owner: object, options: GraphLayoutOptions | undefined, run: () => T): T {
  if (active || !options?.quality && !options?.viewport) return run()
  const budget: Budget = { extra: 0, primary: 0, attempts: 0, optional: false, selected: [] }
  active = budget
  try { return run() } finally {
    evidence.set(owner, Object.freeze({ additionalProducerLimit: 2, additionalProducerCalls: budget.extra, primaryProducerCalls: budget.primary, alternativesAttempted: budget.attempts, selected: Object.freeze([...budget.selected]) }))
    active = undefined
  }
}

export function layoutOptimizationEvidenceOf(owner: object): LayoutOptimizationEvidence | undefined { return evidence.get(owner) }
export function canExploreLayout(): boolean { return Boolean(active && !active.optional && active.extra < 2) }
export function selectedLayoutOptimization(strategy: string): void { active?.selected.push(strategy) }

/** Account logical producer invocations even when an engine cache hits, so
 * search decisions and geometry do not depend on cache warmth. */
export function recordLayoutProducer(): void {
  if (!active) return
  if (!active.optional) { active.primary++; return }
  if (active.extra >= 2) throw new OptionalLayoutBudgetExceeded()
  active.extra++
}

export function optionalLayout<T>(run: () => T): T | undefined {
  if (!canExploreLayout()) return undefined
  const budget = active!
  budget.attempts++
  budget.optional = true
  try { return run() } catch (error) {
    if (!(error instanceof OptionalLayoutBudgetExceeded)) throw error
    return undefined
  } finally { budget.optional = false }
}
