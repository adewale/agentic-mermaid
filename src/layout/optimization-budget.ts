import type { GraphLayoutOptions } from '../types.ts'
import { OptionalLayoutBudgetExceeded } from './certification-error.ts'
export { isOptionalLayoutBudgetExceeded } from './certification-error.ts'
export { retainComparisonMetrics } from './non-regressing-alternative.ts'

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
// Internal ablation switch, captured once before module startup. Public
// requests still opt in through graphLayout; normal hosts enable every feature.
const host = globalThis as { process?: { env?: Record<string, string | undefined> }; AGENTIC_MERMAID_LAYOUT_FEATURES?: string }
const configured = host.process?.env?.AGENTIC_MERMAID_LAYOUT_FEATURES ?? host.AGENTIC_MERMAID_LAYOUT_FEATURES
const features = configured === undefined ? undefined : new Set(configured.split(',').filter(Boolean))
export function layoutOptimizationEnabled(name: 'elk-order' | 'ports' | 'wrap'): boolean { return features === undefined || features.has(name) }

/** One deterministic optional allowance shared by wrapping, ordering and
 * placement. Existing mandatory fallback work remains separately accounted. */
export function withLayoutOptimizationBudget<T>(owner: object, options: GraphLayoutOptions | undefined, run: () => T, isolate = false): T {
  if (active && !isolate) return run()
  const previous = active
  if (!options?.quality && !options?.viewport) {
    if (!isolate || !active) return run()
    active = undefined
    try { return run() } finally { active = previous }
  }
  const budget: Budget = { extra: 0, primary: 0, attempts: 0, optional: false, selected: [] }
  active = budget
  try { return run() } finally {
    evidence.set(owner, Object.freeze({ additionalProducerLimit: 2, additionalProducerCalls: budget.extra, primaryProducerCalls: budget.primary, alternativesAttempted: budget.attempts, selected: Object.freeze([...budget.selected]) }))
    active = previous
  }
}

export function layoutOptimizationEvidenceOf(owner: object): LayoutOptimizationEvidence | undefined { return evidence.get(owner) }
export function layoutOptimizationActive(): boolean { return active !== undefined }
export function canExploreLayout(): boolean { return Boolean(active && !active.optional && active.extra < 2) }
export function selectedLayoutOptimization(strategy: string): void { active?.selected.push(strategy) }
export function layoutOptimizationSelections(): string[] { return [...active?.selected ?? []] }
export function restoreLayoutOptimizationSelections(selected: readonly string[]): void { if (active) active.selected = [...selected] }

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
