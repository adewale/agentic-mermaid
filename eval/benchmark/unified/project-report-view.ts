import type { UnifiedSuiteResult } from './types.ts'

/** The retained lane owns its rows, including metadata rows without an engine
 * field. This reporting view never changes the immutable owning result. */
export function projectReportView(result: UnifiedSuiteResult, project: string): UnifiedSuiteResult {
  if (!project.trim()) throw Error('A retained project owner is required for attribution')
  return {
    ...result,
    observations: result.observations.map(row => ({ ...row, metrics: { ...row.metrics, implementation: project, project } })),
  }
}
