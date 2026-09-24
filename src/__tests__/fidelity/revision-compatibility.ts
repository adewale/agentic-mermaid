import type { FidelityRevisionAcknowledgement } from './contract.ts'

// Pre-existing semantic sources that do not share the manifest revision are
// quarantined here. `usage: historical-only` is enforced by the registry:
// these artifacts may explain provenance but may not back a current receipt.
export const FIDELITY_REVISION_ACKNOWLEDGEMENTS: readonly FidelityRevisionAcknowledgement[] = Object.freeze([
  {
    id: 'historical-docs-corpus-a2d968-to-f3dea',
    manifestRevision: 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc',
    artifactRevision: 'a2d9686451df7c4644a3eeca20535bbd4c5776b0',
    artifactIds: Object.freeze(['docs-corpus']),
    usage: 'historical-only',
    rationale: 'The original 12-family documentation corpus predates the Mermaid 11.16 manifest pin and is not exhaustive. It remains regression evidence only.',
    evidence: Object.freeze(['eval/mermaid-docs-corpus/provenance.json', 'eval/mermaid-docs-corpus/README.md', 'docs/project/issue-248-fidelity-delivery-plan.md']),
  },
  {
    id: 'historical-gantt-harvest-unversioned',
    manifestRevision: 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc',
    artifactRevision: 'unversioned',
    artifactIds: Object.freeze(['gantt-cases', 'gantt-exclusions']),
    usage: 'historical-only',
    rationale: 'The multi-repository Gantt harvest records a date and source files but no immutable revisions. It is quarantined until every source repository is pinned.',
    evidence: Object.freeze(['eval/mermaid-gantt-bench/README.md', 'docs/project/issue-248-fidelity-delivery-plan.md']),
  },
  {
    id: 'historical-suite-harvest-a2d968-to-f3dea',
    manifestRevision: 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc',
    artifactRevision: 'a2d9686451df7c4644a3eeca20535bbd4c5776b0',
    artifactIds: Object.freeze(['suite-accounting', 'suite-cases', 'suite-exclusions']),
    usage: 'historical-only',
    rationale: 'The cross-family parser/DB harvest predates the Mermaid 11.16 manifest pin. It remains historical accounting evidence only; it cannot satisfy a current receipt or native capability claim.',
    evidence: Object.freeze(['eval/mermaid-upstream-suite-bench/manifest.json', 'eval/mermaid-upstream-suite-bench/README.md', 'docs/project/issue-248-fidelity-delivery-plan.md']),
  },
])
