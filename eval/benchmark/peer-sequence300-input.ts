import { releaseBenchCases } from './release-bench-cases.ts'

/** Supplementary stress input; the shared/default peer populations stay fixed. */
export function sequence300StudyInput(options: ReadonlyMap<string, string>) {
  if (!options.has('sequence300')) return undefined
  if (options.has('corpus') || !options.get('tracks') || !options.get('workloads')?.split(',').some(id => id.trim() === 'seq300')) {
    throw new Error('--sequence300 requires --tracks and explicit --workloads including seq300; it cannot use --corpus')
  }
  const input = releaseBenchCases().find(input => input.id === 'sequence:20-participants-300-messages')
  if (!input?.expectedSvgLabels?.length) throw new Error('Canonical Sequence300 source/label contract is unavailable')
  return { id: 'seq300', releaseCaseId: input.id, source: input.source, expected: input.expectedSvgLabels, reproductionArgs: ['--sequence300'] as const }
}
