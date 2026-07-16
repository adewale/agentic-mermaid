import {
  resolvedRenderExecutionPlanOf,
  type ResolvedRenderRequest,
} from './render-contract.ts'

const REPORTED_REQUESTS = new WeakSet<ResolvedRenderRequest>()

/** Emit the diagnostics captured by the canonical request plan at most once.
 * Mark before callback invocation so observer re-entry cannot duplicate them. */
export function emitResolvedConfigDiagnostics(request: ResolvedRenderRequest): void {
  if (REPORTED_REQUESTS.has(request)) return
  REPORTED_REQUESTS.add(request)
  const plan = resolvedRenderExecutionPlanOf(request)
  const diagnostics = plan.configDiagnostics ?? []
  if (diagnostics.length === 0) return
  const report = plan.onConfigDiagnostic ?? ((diagnostic: (typeof diagnostics)[number]) => console.warn(diagnostic.message))
  for (const diagnostic of diagnostics) report(diagnostic)
}
