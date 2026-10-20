// Internal opt-in experiments. Read configuration before startup; ordinary
// renders keep the established paths. Tests may scope flags synchronously.
export const PERFORMANCE_EXPERIMENTS = ['indexed-layout'] as const
export type PerformanceExperiment = typeof PERFORMANCE_EXPERIMENTS[number]
const host = globalThis as { process?: { env?: Record<string, string | undefined> }; AGENTIC_MERMAID_EXPERIMENTS?: unknown }
const raw = host.process?.env?.AGENTIC_MERMAID_EXPERIMENTS ?? host.AGENTIC_MERMAID_EXPERIMENTS
const configured = new Set(typeof raw === 'string' ? raw.split(',').map(value => value.trim()).filter(Boolean) : [])
let scoped: ReadonlySet<string> | undefined
export function performanceExperimentEnabled(name: PerformanceExperiment): boolean {
  return (scoped ?? configured).has(name)
}
/** Internal synchronous diagnostic boundary, never a public render option. */
export function withPerformanceExperiments<T>(names: readonly PerformanceExperiment[], run: () => T): T {
  const previous = scoped
  scoped = new Set(names)
  try { return run() } finally { scoped = previous }
}
