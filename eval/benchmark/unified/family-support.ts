import { FAMILY_SUPPORT_PROTOCOL, familySupportProbe } from '../portable/cohorts.ts'
import type { BenchmarkObservation, UnifiedWorkload } from './types.ts'

export { FAMILY_SUPPORT_PROTOCOL }

/** One untimed probe per family in this portfolio: the portable family cohort's canonical source. */
export function familySupportWorkloads(workloads: readonly UnifiedWorkload[]): UnifiedWorkload[] {
  return [...new Set(workloads.map(workload => workload.family))].flatMap(family => {
    const probe = familySupportProbe(family)
    return probe ? [{ id: probe.id, family, source: probe.source, expectedLabels: probe.expected.labels, features: ['family-support-probe'], provenance: `${FAMILY_SUPPORT_PROTOCOL}: portable family cohort source` }] : []
  })
}

/** The tool rejected the source outright (an error, nonzero exit or no output), rather than
 * returning output that then failed qualification. Only a rejection makes a family unsupported. */
export function rejectsSource(row: BenchmarkObservation): boolean {
  return row.status === 'unsupported' || (row.status === 'failed' && row.metrics?.rejected === true)
}

/** Probe rows stay in the evidence as family-support observations, never as corpus or speed rows. */
export function familySupportRow(row: BenchmarkObservation): BenchmarkObservation {
  const { samplesMs: _samples, ...rest } = row
  return { ...rest, operation: 'family-support', mode: 'family-support-probe', status: rejectsSource(row) ? 'unsupported' : row.status }
}

/** A workload of a family whose probe the tool rejected, recorded from its lane's own row without running it. */
export function unsupportedFamilyRow(base: BenchmarkObservation, probe: BenchmarkObservation): BenchmarkObservation {
  return {
    ...base,
    surface: probe.surface,
    runtime: probe.runtime,
    status: 'unsupported',
    detail: `Not run: the tool rejected ${probe.caseId}, this family's canonical source: ${probe.detail ?? 'no output'}`,
    metrics: { ...base.metrics, familySupportProbe: probe.caseId },
  }
}
