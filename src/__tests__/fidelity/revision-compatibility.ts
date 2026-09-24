import type { FidelityRevisionAcknowledgement } from './contract.ts'

// This is the one pre-existing revision split in the upstream inventory. The
// old suite harvest remains useful historical/accounting evidence, but it must
// not silently masquerade as a current construct receipt. New cases in this
// registry pin the manifest revision unless a similarly explicit declaration
// is reviewed and added here.
export const FIDELITY_REVISION_ACKNOWLEDGEMENTS: readonly FidelityRevisionAcknowledgement[] = Object.freeze([
  {
    id: 'historical-suite-harvest-a2d968-to-f3dea',
    manifestRevision: 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc',
    artifactRevision: 'a2d9686451df7c4644a3eeca20535bbd4c5776b0',
    artifactIds: Object.freeze(['suite-accounting', 'suite-cases', 'suite-exclusions']),
    rationale: 'The cross-family parser/DB harvest predates the Mermaid 11.16 manifest pin. It remains historical accounting evidence only; it cannot satisfy a current receipt or native capability claim.',
    evidence: Object.freeze(['eval/mermaid-upstream-suite-bench/manifest.json', 'eval/mermaid-upstream-suite-bench/README.md', 'docs/project/issue-248-fidelity-delivery-plan.md']),
  },
])
