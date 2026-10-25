import { portableCases } from '../portable/cohorts.ts'
import type { UnifiedWorkload } from './types.ts'

const extraCases: UnifiedWorkload[] = [
  { id: 'required:eventmodeling', family: 'eventmodeling', source: 'eventmodeling\ntf 01 ui CartUI\ntf 02 cmd AddItem\ntf 03 evt ItemAdded', expectedLabels: ['CartUI', 'AddItem', 'ItemAdded'], features: ['documented-required-pending-maturity-review'], provenance: 'Pinned Mermaid docs/syntax/eventmodeling.md public example' },
  { id: 'required:zenuml', family: 'zenuml', source: 'zenuml\ntitle Demo\nAlice->John: Hello John, how are you?\nJohn->Alice: Great!', expectedLabels: ['Alice', 'John', 'Hello John, how are you?', 'Great!'], features: ['documented-required-pending-maturity-review'], provenance: 'Pinned Mermaid docs/syntax/zenuml.md public example; external renderer loading is a separate prerequisite' },
]

/** Additional required-family probes do not rewrite the original portable cohort. */
export function requiredFamilyWorkloads(): UnifiedWorkload[] {
  return [...portableCases(['family']).map(testCase => ({ id: testCase.id, family: testCase.family, source: testCase.source, expectedLabels: testCase.expected.labels, features: ['authored-family-representative'], provenance: 'Independent authored family stimulus; admission does not certify all features or painted correspondence' })), ...extraCases]
}
