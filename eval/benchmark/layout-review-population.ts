import { createHash } from 'node:crypto'
import { extractOfficialCorpus } from '../shared/official-fences.ts'
import { releaseBenchCases } from './release-bench-cases.ts'
import { agentEditCase } from './release-bench-fidelity.ts'
import type { Input } from './release-bench.ts'

/** Historical PR449 CI canary. Supplementary workloads must not alter it. */
export const layoutReviewCaseIds = [
  'flowchart:official-syntax/flowchart.md#82', 'state:official-syntax/stateDiagram.md#16',
  'requirement:official-syntax/requirementDiagram.md#4', 'flowchart:cyclic-labelled-11',
  'flowchart:cyclic-labelled-10', 'flowchart:cyclic-labelled-15', 'flowchart:cyclic-labelled-19',
  'flowchart:cyclic-labelled-9', 'flowchart:cyclic-labelled-13', 'flowchart:cyclic-labelled-9-chains',
  'flowchart:cyclic-labelled-15-chains', 'flowchart:cyclic-labelled-18-cuts',
  'requirement:cyclic-labelled-relations', 'requirement:100-requirements-99-relations',
  'er:official-syntax/entityRelationshipDiagram.md#24', 'er:cyclic-labelled-entities', 'er:40-entities',
  'er:compound-domains', 'class:official-syntax/classDiagram.md#0', 'class:official-syntax/classDiagram.md#17',
  'class:compound-namespaces', 'class:cyclic-labelled-members', 'class:80-classes',
  'architecture:official-syntax/architecture.md#2', 'architecture:aligned-junction-services',
  'architecture:40-services', 'agent:edit-flowchart',
] as const

export const architectureSupplementaryCaseIds = [
  'architecture:16-junctions', 'architecture:32-junctions', 'architecture:32-large-junctions',
] as const

export function layoutReviewPopulation(ids: readonly string[] = layoutReviewCaseIds): Input[] {
  const all: Input[] = [
    ...extractOfficialCorpus().map(input => ({ ...input, kind: 'corpus' as const })),
    ...releaseBenchCases().map(input => ({ ...input, kind: 'scaling' as const })),
    { ...agentEditCase, kind: 'workflow' },
  ]
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate selected input IDs')
  const selected = all.filter(input => ids.includes(input.id))
  if (selected.length !== ids.length || new Set(selected.map(input => input.id)).size !== ids.length) {
    throw new Error(`Missing or duplicate input identities: ${ids.filter(id => selected.filter(input => input.id === id).length !== 1).join(', ')}`)
  }
  return selected // Match existing release scheduling, not selector-list order.
}

export function populationIdentity(inputs: readonly Input[]) {
  return {
    digest: createHash('sha256').update(JSON.stringify(inputs)).digest('hex'),
    inputs: inputs.map(input => ({ ...input, sourceSha256: createHash('sha256').update(input.source).digest('hex') })),
  }
}

if (import.meta.main) {
  const supplementary = process.argv.includes('--architecture-supplementary')
  const ids = supplementary ? architectureSupplementaryCaseIds : layoutReviewCaseIds
  console.log(process.argv.includes('--case-list') ? ids.join(',') : JSON.stringify({
    protocol: 'layout-review-population@1', scope: supplementary ? 'architecture-supplementary' : 'historical27',
    ...populationIdentity(layoutReviewPopulation(ids)),
  }, null, 2))
}
