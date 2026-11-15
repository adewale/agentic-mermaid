/** Reviewed fixture scope, frozen before either engine runs. Historical bytes
 * remain unchanged; diagnostics still execute and retain their API clocks. */
export const REFERENCE_ELIGIBILITY_PROTOCOL = 'public-positive-eligibility-v2' as const
export const REVIEWED_REFERENCE = Object.freeze({ repo: 'mermaid-js/mermaid', version: '12.2.0', commit: '1fb7869866dd619168d840291c9c54b4f129758b' })
export type ReferenceFixtureScope = 'public-positive' | 'expected-negative' | 'disabled-upstream-test' | 'mocked-grammar-only' | 'internal-parser-only' | 'historical-dialect'
export interface ReferenceEligibility {
  eligible: boolean
  scope: ReferenceFixtureScope
  reason: string
  upstream?: { repo: string; commit: string; path: string; line: number; endLine: number }
}
export interface ReviewedDiagnosticFixture extends ReferenceEligibility {
  caseId: string
  family: string
  source: string
}

/** Whether the declared owner scope promises public-parser acceptance. Actual
 * engine replies are deliberately absent from this decision boundary. */
export function eligibilityFromScope(scope: ReferenceFixtureScope, reason: string, upstream?: ReferenceEligibility['upstream']): ReferenceEligibility {
  return { eligible: scope === 'public-positive', scope, reason, ...(upstream ? { upstream } : {}) }
}

export const REVIEWED_DIAGNOSTIC_FIXTURES: readonly ReviewedDiagnosticFixture[] = [
  {
    caseId: 'flowchart-upstream-should-accept-swimlane-as-a-graph-keyword',
    family: 'flowchart',
    source: 'swimlane LR;A-->B;',
    eligible: false,
    scope: 'historical-dialect',
    reason: 'The retained historical source uses swimlane; the current pinned public grammar test uses swimlane-beta. Keep old-dialect admission diagnostic, not a positive current-public-language criterion.',
    upstream: { repo: 'mermaid-js/mermaid', commit: '1fb7869866dd619168d840291c9c54b4f129758b', path: 'packages/mermaid/src/diagrams/flowchart/parser/flow.spec.js', line: 31, endLine: 43 },
  },
  {
    caseId: 'flowchart-upstream-should-keep-node-label-text-if-already-defined-when-a-style-is-applied',
    family: 'flowchart',
    source: 'graph TD;A(( ));B((Test));C;style A background:#fff;style D border:1px solid red;',
    eligible: false,
    scope: 'internal-parser-only',
    reason: 'The pinned upstream test invokes flow.parser.parse directly. Public mermaid.parse adds preprocessing; this internal-parser source is not an unconditional positive public-parser contract.',
    upstream: { repo: 'mermaid-js/mermaid', commit: '1fb7869866dd619168d840291c9c54b4f129758b', path: 'packages/mermaid/src/diagrams/flowchart/parser/flow-style.spec.js', line: 81, endLine: 92 },
  },
  {
    caseId: 'quadrant-upstream-should-be-able-to-handle-constructor-as-a-classname',
    family: 'quadrant',
    source: 'quadrantChart\n    classDef constructor fill:#ff0000\n    Microsoft:::constructor: [0.75, 0.75]',
    eligible: false,
    scope: 'mocked-grammar-only',
    reason: 'The pinned grammar test installs mockDB and asserts addClass arguments. Real public DB style validation is a different contract; its admission is diagnostic here.',
    upstream: { repo: 'mermaid-js/mermaid', commit: '1fb7869866dd619168d840291c9c54b4f129758b', path: 'packages/mermaid/src/diagrams/quadrant-chart/parser/quadrant.jison.spec.ts', line: 428, endLine: 434 },
  },
  {
    caseId: 'sequence-upstream-should-not-hang-when-as-is-used-without-a-space-before-the-alias-text',
    family: 'sequence',
    source: 'sequenceDiagram\n          participant X_AutoPublishable asAAAAAAAAAAAAA:AAAAAAAAAAAAA',
    eligible: false,
    scope: 'expected-negative',
    reason: 'The pinned public Diagram.fromText test expects a nonempty error without a lexical error, rather than successful source acceptance.',
    upstream: { repo: 'mermaid-js/mermaid', commit: '1fb7869866dd619168d840291c9c54b4f129758b', path: 'packages/mermaid/src/diagrams/sequence/sequenceDiagram.spec.js', line: 2785, endLine: 2797 },
  },
  {
    caseId: 'state-upstream-should-handle-arrow-directions-definitions',
    family: 'state',
    source: 'stateDiagram-v2\n\n    //     [*] -up-> First\n    //     First -right-> Second\n    //     Second --> Third\n    //     Third -left-> Last\n    //',
    eligible: false,
    scope: 'disabled-upstream-test',
    reason: 'The named pinned upstream test is commented out; the retained historical literal contains JavaScript // comment prefixes and is not an active positive Mermaid test.',
    upstream: { repo: 'mermaid-js/mermaid', commit: '1fb7869866dd619168d840291c9c54b4f129758b', path: 'packages/mermaid/src/diagrams/state/stateDiagram-v2.spec.js', line: 326, endLine: 335 },
  },
  {
    caseId: 'state-upstream-should-handle-arrow-directions-definitions-2',
    family: 'state',
    source: 'stateDiagram\n\n    //     [*] -up-> First\n    //     First -right-> Second\n    //     Second --> Third\n    //     Third -left-> Last\n    //',
    eligible: false,
    scope: 'disabled-upstream-test',
    reason: 'The named pinned upstream test is commented out; the retained historical literal contains JavaScript // comment prefixes and is not an active positive Mermaid test.',
    upstream: { repo: 'mermaid-js/mermaid', commit: '1fb7869866dd619168d840291c9c54b4f129758b', path: 'packages/mermaid/src/diagrams/state/stateDiagram.spec.js', line: 313, endLine: 322 },
  },
]

export function referenceEligibilityFor(input: { id: string; family: string; source: string }): ReferenceEligibility {
  const reviewed = REVIEWED_DIAGNOSTIC_FIXTURES.find(fixture => fixture.caseId === input.id)
  if (!reviewed) return eligibilityFromScope('public-positive', 'Retained positive fixture with no reviewed negative, disabled, internal/mock or historical-dialect scope exception.')
  if (input.family !== reviewed.family || input.source !== reviewed.source) throw new Error(`Reviewed reference eligibility source changed: ${input.id}; re-review its owner contract before scoring`)
  return eligibilityFromScope(reviewed.scope, reviewed.reason, reviewed.upstream)
}
