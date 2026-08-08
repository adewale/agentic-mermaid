import type { BuiltinFamilyId } from '../../src/agent/families.ts'
import { compareCodePointStrings } from '../../src/shared/deterministic-order.ts'
import type { IntentCategory, ResearchFamily, ResearchHarvest, ResearchItem } from './research.ts'

export const INTENT_EVIDENCE_SCALE = {
  0: 'Unaccounted: no explicit contract or executable evidence.',
  1: 'Declared: the intended behavior is named but only smoke-tested.',
  2: 'Example-backed: representative fixtures exist, with material untested constructs.',
  3: 'Stratified: positive, negative, edge-case, and round-trip evidence covers the construct family.',
  4: 'Protected: executable invariants and regression tests make silent semantic drift difficult.',
} as const

export type IntentEvidenceScore = keyof typeof INTENT_EVIDENCE_SCALE
export type IntentDecision = 'protect' | 'strengthen' | 'expand'

export interface FamilyIntentScores {
  syntaxAcceptance: IntentEvidenceScore
  semanticPreservation: IntentEvidenceScore
  communicativeEquivalence: IntentEvidenceScore
  noSilentLoss: IntentEvidenceScore
}

export interface FamilyIntentAssessment {
  id: BuiltinFamilyId
  contract: string
  decision: IntentDecision
  preservedFacts: readonly string[]
  presentationFreedom: readonly string[]
  knownRisks: readonly string[]
  actions: readonly string[]
  scores: FamilyIntentScores
  evidence: readonly string[]
  researchFamilies: readonly ResearchFamily[]
  researchCategories: readonly IntentCategory[]
}

export const MERMAID_INTENT_COMPATIBILITY_ASSESSMENTS = [
  {
    id: 'flowchart',
    contract: 'Preserve node identity, directed/multi-edge topology, subgraph membership, authored direction, endpoint markers, labels, shapes, links, and styling intent.',
    decision: 'protect',
    preservedFacts: ['Node and subgraph identity survives parse/serialize.', 'Edge direction, multiplicity, markers, labels, and containment remain inspectable.', 'Author-specified graph/subgraph direction is treated as a constraint, not decoration.'],
    presentationFreedom: ['ELK may choose different ranks, bends, spacing, and compaction than Mermaid Dagre.', 'Collision avoidance and canvas growth may move labels or nodes.'],
    knownRisks: ['Edges targeting subgraphs and nested direction changes are high-demand semantic traps.', 'HTML/Markdown labels can be accepted yet lose intended text structure.'],
    actions: ['Bind the highest-weight subgraph, label, and edge-routing reports to minimized conformance fixtures.', 'Add syntax-preservation mutations for every Mermaid v11 node shape.'],
    scores: { syntaxAcceptance: 4, semanticPreservation: 4, communicativeEquivalence: 4, noSilentLoss: 4 },
    evidence: ['src/__tests__/flowchart-v11-shapes.test.ts', 'src/__tests__/layout-rubric.test.ts', 'src/__tests__/family-registration-conformance.test.ts'],
    researchFamilies: ['flowchart'],
    researchCategories: ['syntax-acceptance', 'semantic-correctness', 'layout-relationships', 'text-labels'],
  },
  {
    id: 'state',
    contract: 'Preserve state identity, transition order and direction, labels, start/end/history/choice/fork/join semantics, notes, composite containment, and concurrency.',
    decision: 'protect',
    preservedFacts: ['Pseudostates remain typed rather than flattened into ordinary nodes.', 'Composite and concurrent regions retain containment and transition endpoints.'],
    presentationFreedom: ['Composite sizing, region proportions, and transition routing may differ.', 'Marker proportions need not match Mermaid pixels.'],
    knownRisks: ['Nested concurrency can render plausibly while attaching a transition to the wrong semantic scope.', 'Aliases and labels can be confused during round-trip serialization.'],
    actions: ['Trace high-weight nested-state reports to executable containment and transition-scope fixtures.'],
    scores: { syntaxAcceptance: 4, semanticPreservation: 4, communicativeEquivalence: 3, noSilentLoss: 4 },
    evidence: ['src/__tests__/state-pseudostates.test.ts', 'src/__tests__/family-registration-conformance.test.ts'],
    researchFamilies: ['state'],
    researchCategories: ['syntax-acceptance', 'semantic-correctness', 'layout-relationships'],
  },
  {
    id: 'sequence',
    contract: 'Preserve participant identity and order, message chronology/direction/type, activations, notes, create/destroy events, and fragment branching/nesting.',
    decision: 'protect',
    preservedFacts: ['Vertical ordering communicates source chronology.', 'Fragment operands and activation lifetimes remain explicit.', 'Arrow form and direction retain message meaning.'],
    presentationFreedom: ['Participant spacing, note placement, fragment padding, and typography may improve independently.'],
    knownRisks: ['Overlapping activation stacks and nested par/alt/critical blocks can shift event ownership.', 'Autonumber and actor aliases can be present visually but wrong semantically.'],
    actions: ['Turn demand-ranked activation and nested-fragment failures into event-row invariant tests.'],
    scores: { syntaxAcceptance: 4, semanticPreservation: 4, communicativeEquivalence: 4, noSilentLoss: 4 },
    evidence: ['src/__tests__/sequence-parser.test.ts', 'src/__tests__/sequence-layout.test.ts', 'src/__tests__/family-registration-conformance.test.ts'],
    researchFamilies: ['sequence'],
    researchCategories: ['syntax-acceptance', 'semantic-correctness', 'layout-relationships', 'text-labels'],
  },
  {
    id: 'timeline',
    contract: 'Preserve section membership and source chronology of periods and events, including multiline descriptions and accessibility metadata.',
    decision: 'strengthen',
    preservedFacts: ['Periods/events remain in authored order and section.', 'Orientation changes presentation without changing chronology.'],
    presentationFreedom: ['Rail/card composition, orientation, colors, wrapping, and alternation may differ from Mermaid.'],
    knownRisks: ['Ambiguous colon parsing and repeated period labels can merge distinct events.', 'A polished card layout can conceal an ordering error.'],
    actions: ['Add demand-linked fixtures for repeated periods, multiline events, and section transitions.'],
    scores: { syntaxAcceptance: 3, semanticPreservation: 3, communicativeEquivalence: 3, noSilentLoss: 4 },
    evidence: ['src/__tests__/timeline-layout.test.ts', 'src/__tests__/family-registration-conformance.test.ts'],
    researchFamilies: ['timeline'],
    researchCategories: ['syntax-acceptance', 'semantic-correctness', 'text-labels'],
  },
  {
    id: 'class',
    contract: 'Preserve class/namespace identity, members, methods, visibility, generics, annotations, notes, relationship direction/type, labels, and cardinalities.',
    decision: 'protect',
    preservedFacts: ['UML endpoint markers and relationship types remain typed.', 'Namespace containment and compartment membership survive serialization.'],
    presentationFreedom: ['Namespace packing, compartment sizing, bends, and typography may differ.'],
    knownRisks: ['Generic/member punctuation can be mistaken for Mermaid grammar.', 'A visually plausible marker on the wrong end reverses UML meaning.'],
    actions: ['Bind demand-ranked generics, namespace, and relationship reports to a construct-by-endpoint matrix.'],
    scores: { syntaxAcceptance: 4, semanticPreservation: 4, communicativeEquivalence: 4, noSilentLoss: 4 },
    evidence: ['src/__tests__/class-marker-geometry.test.ts', 'src/__tests__/class-namespace.test.ts', 'src/__tests__/family-registration-conformance.test.ts'],
    researchFamilies: ['class'],
    researchCategories: ['syntax-acceptance', 'semantic-correctness', 'layout-relationships', 'text-labels'],
  },
  {
    id: 'er',
    contract: 'Preserve entity identity, attributes/types/keys/comments, relationship labels, direction, and both endpoint cardinality/optionality semantics.',
    decision: 'protect',
    preservedFacts: ['Crow’s-foot terminals encode the parsed cardinalities.', 'Attribute rows and key annotations remain associated with the correct entity.'],
    presentationFreedom: ['Table dimensions, entity ordering, route bends, and classic/neo styling may differ.'],
    knownRisks: ['Marker placement can reverse optionality or cardinality without changing topology.', 'Attribute comments and complex types stress tokenization.'],
    actions: ['Create demand-linked cardinality-by-direction and complex-attribute round-trip fixtures.'],
    scores: { syntaxAcceptance: 4, semanticPreservation: 4, communicativeEquivalence: 4, noSilentLoss: 4 },
    evidence: ['src/__tests__/er-parser.test.ts', 'src/__tests__/er-typed-segments.test.ts', 'src/__tests__/family-registration-conformance.test.ts'],
    researchFamilies: ['er'],
    researchCategories: ['syntax-acceptance', 'semantic-correctness', 'layout-relationships', 'text-labels'],
  },
  {
    id: 'journey',
    contract: 'Preserve section/task order, task scores, actor ownership, labels, and the relationship between score and experience trajectory.',
    decision: 'strengthen',
    preservedFacts: ['Every task retains its exact score and actor set.', 'Sections and tasks retain authored order.'],
    presentationFreedom: ['AM may communicate satisfaction as a curve instead of Mermaid task blocks/faces.'],
    knownRisks: ['Actor lists containing punctuation can split incorrectly.', 'Curve geometry must not imply values other than the parsed score.'],
    actions: ['Add demand-linked actor-list and score-extreme round trips plus curve-to-score assertions.'],
    scores: { syntaxAcceptance: 3, semanticPreservation: 4, communicativeEquivalence: 3, noSilentLoss: 4 },
    evidence: ['src/__tests__/journey-layout-quality.test.ts', 'src/__tests__/family-registration-conformance.test.ts'],
    researchFamilies: ['journey'],
    researchCategories: ['syntax-acceptance', 'semantic-correctness', 'layout-relationships'],
  },
  {
    id: 'architecture',
    contract: 'Preserve service, group, and junction identity; nesting; icon/label intent; edge direction; authored endpoint sides; and alignment/placement constraints.',
    decision: 'strengthen',
    preservedFacts: ['Edges attach to the authored services/junctions and respect requested sides.', 'Nested groups and alignment hints remain explicit constraints.'],
    presentationFreedom: ['ELK may replace fCOSE; whitespace and global topology may differ when constraints remain satisfied.'],
    knownRisks: ['Post-layout corrections can satisfy one side/alignment constraint while violating another.', 'Unknown icons must diagnose rather than silently vanish.'],
    actions: ['Build a constraint-satisfaction corpus from demand-ranked architecture reports before evaluating fCOSE.'],
    scores: { syntaxAcceptance: 3, semanticPreservation: 3, communicativeEquivalence: 3, noSilentLoss: 4 },
    evidence: ['src/__tests__/architecture-layout.test.ts', 'src/__tests__/family-registration-conformance.test.ts'],
    researchFamilies: ['architecture'],
    researchCategories: ['syntax-acceptance', 'semantic-correctness', 'layout-relationships'],
  },
  {
    id: 'xychart',
    contract: 'Preserve axis orientation/domains/categories, series kind/order/identity, and exact bar/line values so the chart communicates the same quantitative relationships.',
    decision: 'protect',
    preservedFacts: ['Exact source values remain available independently of display rounding.', 'Scale direction and categorical ordering do not change with presentation.'],
    presentationFreedom: ['Tick count, tick formatting, canvas budget, and label collision handling may differ.'],
    knownRisks: ['Custom nice ticks can accidentally change the perceived domain.', 'Unequal series lengths and negative values can be silently truncated.'],
    actions: ['Use D3 as a mathematical oracle for adversarial domains and bind high-demand scale reports to exact-value fixtures.'],
    scores: { syntaxAcceptance: 4, semanticPreservation: 4, communicativeEquivalence: 4, noSilentLoss: 4 },
    evidence: ['src/__tests__/xychart-renderer.test.ts', 'src/__tests__/family-registration-conformance.test.ts'],
    researchFamilies: ['xychart'],
    researchCategories: ['syntax-acceptance', 'semantic-correctness', 'layout-relationships', 'text-labels'],
  },
  {
    id: 'pie',
    contract: 'Preserve every category and exact value, proportional meaning, title/showData intent, styling, and explicit highlight/donut extensions.',
    decision: 'protect',
    preservedFacts: ['Sub-1% slices remain represented instead of being silently discarded.', 'Arc proportions derive from exact semantic values.'],
    presentationFreedom: ['Label suppression, collision handling, legend layout, and arc path formatting may differ.'],
    knownRisks: ['Copying Mermaid’s sub-1% filter would violate author intent.', 'Negative, zero, and all-zero datasets require explicit diagnostics.'],
    actions: ['Keep small-slice preservation normative and trace demand-ranked value/label reports to tests.'],
    scores: { syntaxAcceptance: 4, semanticPreservation: 4, communicativeEquivalence: 4, noSilentLoss: 4 },
    evidence: ['src/__tests__/pie.test.ts', 'src/__tests__/pie-elevation.test.ts', 'src/__tests__/family-registration-conformance.test.ts'],
    researchFamilies: ['pie'],
    researchCategories: ['syntax-acceptance', 'semantic-correctness', 'text-labels', 'styling-theming'],
  },
  {
    id: 'quadrant',
    contract: 'Preserve axis labels/directions, quadrant labels, point identity, and exact normalized coordinates so quadrant membership and relative position remain truthful.',
    decision: 'protect',
    preservedFacts: ['Point coordinates and quadrant numbering remain exact.', 'Collision displacement uses leaders so authored coordinates remain recoverable.'],
    presentationFreedom: ['Density scaling, wrapping, label displacement, and leader routing may improve readability.'],
    knownRisks: ['Moving a label without a leader can imply the wrong point position.', 'Axis inversion can reverse the author’s intended judgement.'],
    actions: ['Add exact coordinate/axis-orientation metamorphic tests linked to demand evidence.'],
    scores: { syntaxAcceptance: 4, semanticPreservation: 4, communicativeEquivalence: 4, noSilentLoss: 4 },
    evidence: ['src/__tests__/family-registration-conformance.test.ts', 'src/__tests__/scene-fidelity.test.ts'],
    researchFamilies: ['quadrant'],
    researchCategories: ['syntax-acceptance', 'semantic-correctness', 'layout-relationships', 'text-labels'],
  },
  {
    id: 'gantt',
    contract: 'Preserve task/section identity and order, dates/durations, dependencies, milestones, status tags, exclusions, date formats, and explicit today semantics.',
    decision: 'protect',
    preservedFacts: ['The UTC scheduler produces inspectable start/end facts and dependency relationships.', 'Critical/dependency overlays add information without altering the authored schedule.'],
    presentationFreedom: ['Tick density/formatting, bar spacing, label placement, and overlay styling may differ.'],
    knownRisks: ['Locale/timezone parsing can move tasks across dates.', 'Exclusions and chained dependencies can yield plausible but wrong schedules.'],
    actions: ['Prioritize demand-ranked date parsing, exclusions, and dependency reports in the pinned schedule corpus.'],
    scores: { syntaxAcceptance: 4, semanticPreservation: 4, communicativeEquivalence: 4, noSilentLoss: 4 },
    evidence: ['src/__tests__/gantt-upstream-bench.test.ts', 'src/__tests__/family-registration-conformance.test.ts'],
    researchFamilies: ['gantt'],
    researchCategories: ['syntax-acceptance', 'semantic-correctness', 'layout-relationships', 'configuration'],
  },
  {
    id: 'mindmap',
    contract: 'Preserve root/hierarchy, parentage, sibling order, labels, shapes, icons, and classes regardless of radial, bilateral, or tidy-tree presentation.',
    decision: 'protect',
    preservedFacts: ['Hierarchy and source order are independent of force-directed or deterministic positioning.', 'Authored shape/icon/class intent remains attached to the correct node.'],
    presentationFreedom: ['AM need not reproduce Cose-Bilkent positions, edge widths, or balance.'],
    knownRisks: ['Indentation errors can silently reparent an entire subtree.', 'Icons/classes may parse but disappear in terminal output.'],
    actions: ['Turn demand-ranked indentation, icon, and long-label reports into hierarchy and projection fixtures.'],
    scores: { syntaxAcceptance: 4, semanticPreservation: 4, communicativeEquivalence: 4, noSilentLoss: 4 },
    evidence: ['src/__tests__/mindmap-gitgraph-upstream-oracle.test.ts', 'src/__tests__/family-registration-conformance.test.ts'],
    researchFamilies: ['mindmap'],
    researchCategories: ['syntax-acceptance', 'semantic-correctness', 'layout-relationships', 'text-labels'],
  },
  {
    id: 'gitgraph',
    contract: 'Preserve source-ordered commits, branch creation/checkout, commit identity/type/tag, merges, cherry-picks, and the resulting history topology.',
    decision: 'protect',
    preservedFacts: ['History topology is primary; branch lanes are a projection.', 'Commit and merge/cherry-pick identity remain inspectable.'],
    presentationFreedom: ['Lane offsets, orientation, label rotation/backgrounds, and route bends may differ.'],
    knownRisks: ['Reusing commit IDs or invalid cherry-pick sources must diagnose explicitly.', 'A visually connected merge can still reference the wrong parent.'],
    actions: ['Bind demand-ranked topology reports to source-order and parent-set invariants.'],
    scores: { syntaxAcceptance: 4, semanticPreservation: 4, communicativeEquivalence: 4, noSilentLoss: 4 },
    evidence: ['src/__tests__/mindmap-gitgraph-upstream-oracle.test.ts', 'src/__tests__/family-registration-conformance.test.ts'],
    researchFamilies: ['gitgraph'],
    researchCategories: ['syntax-acceptance', 'semantic-correctness', 'layout-relationships'],
  },
  {
    id: 'radar',
    contract: 'Preserve axis identity/order, exact dataset values, min/max ranges, legend identity, and curve/graticule configuration so comparative shape meaning remains truthful.',
    decision: 'protect',
    preservedFacts: ['Polar vertices derive from typed axes and exact values.', 'Series identity and scale bounds remain explicit.'],
    presentationFreedom: ['Curve interpolation, legend packing, axis-label spacing, and graticule style may differ.'],
    knownRisks: ['Mismatched axis/value counts can rotate or truncate meaning.', 'Automatic range changes can exaggerate or flatten differences.'],
    actions: ['Add demand-ranked axis/value mismatch and range fixtures with exact polar-coordinate assertions.'],
    scores: { syntaxAcceptance: 4, semanticPreservation: 4, communicativeEquivalence: 4, noSilentLoss: 4 },
    evidence: ['src/__tests__/radar-renderer.test.ts', 'src/__tests__/family-registration-conformance.test.ts'],
    researchFamilies: ['radar'],
    researchCategories: ['syntax-acceptance', 'semantic-correctness', 'layout-relationships', 'text-labels'],
  },
] as const satisfies readonly FamilyIntentAssessment[]

function average(values: readonly number[]): number {
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 25)
}

export function familyDemandItems(assessment: FamilyIntentAssessment, harvest: ResearchHarvest): ResearchItem[] {
  return harvest.items
    .filter(item => item.families.some(family => assessment.researchFamilies.includes(family)))
    .filter(item => item.categories.some(category => assessment.researchCategories.includes(category)))
    .sort((a, b) =>
      b.weight.score - a.weight.score ||
      compareCodePointStrings(b.updatedAt, a.updatedAt) ||
      compareCodePointStrings(a.url, b.url),
    )
}

export function demandTraceabilityScore(items: readonly ResearchItem[]): IntentEvidenceScore {
  if (items.length === 0) return 0
  if (items.length < 3) return 1
  if (items.length < 10) return 2
  const repositoryCounts = new Map<string, number>()
  const kindCounts = new Map<string, number>()
  for (const item of items) {
    repositoryCounts.set(item.repository, (repositoryCounts.get(item.repository) ?? 0) + 1)
    kindCounts.set(item.kind, (kindCounts.get(item.kind) ?? 0) + 1)
  }
  const repositoriesAreStratified = repositoryCounts.size >= 2 && [...repositoryCounts.values()].every(count => count >= 3)
  const kindsAreStratified = kindCounts.size >= 2 && [...kindCounts.values()].every(count => count >= 3)
  return repositoriesAreStratified && kindsAreStratified ? 3 : 2
}

export function familyIntentScores(assessment: FamilyIntentAssessment, harvest: ResearchHarvest): {
  implementation: number
  demandTraceability: IntentEvidenceScore
  overall: number
} {
  const implementationValues = Object.values(assessment.scores)
  const demandTraceability = demandTraceabilityScore(familyDemandItems(assessment, harvest))
  return {
    implementation: average(implementationValues),
    demandTraceability,
    overall: average([...implementationValues, demandTraceability]),
  }
}
