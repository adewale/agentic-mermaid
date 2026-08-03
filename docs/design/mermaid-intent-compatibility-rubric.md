# Mermaid intent-compatibility rubric

Generated from eval/mermaid-intent-compatibility/rubric.ts and the frozen GitHub harvest 16529f96153b. Do not hand-edit this report.

## North-star contract

Agentic Mermaid is not trying to become Mermaid. Given Mermaid syntax, it must preserve what the author meant and communicate the same facts. Layout, routing, typography, paint, collision handling, accessibility, determinism, and terminal projection may improve independently when those changes do not alter meaning.

The primary dimensions are syntax acceptance, semantic preservation, communicative equivalence, no silent loss, and demand traceability. Visual similarity is a secondary migration/familiarity audit in docs/design/mermaid-renderer-fidelity-rubric.md; it is not included in the intent score.

## Evidence scale

- **0** — Unaccounted: no explicit contract or executable evidence.
- **1** — Declared: the intended behavior is named but only smoke-tested.
- **2** — Example-backed: representative fixtures exist, with material untested constructs.
- **3** — Stratified: positive, negative, edge-case, and round-trip evidence covers the construct family.
- **4** — Protected: executable invariants and regression tests make silent semantic drift difficult.

Scores measure executable evidence maturity, not aesthetic taste. Demand traceability is derived rather than assigned: 0 for no matching items, 1 for fewer than 3, 2 for 3–9 or one-sided evidence, and 3 for at least 10 items with at least three records from each repository and at least three issues and pull requests. Level 4 is reserved for GitHub items that are individually bound to minimized executable fixtures.

## GitHub demand research

Captured 2026-08-03T19:04:48.169Z using GitHub GraphQL repository pagination v1. Every issue and pull request in both repositories, paginated directly from the repository connections. Popularity uses total comment, distinct participant, review, and reaction counts. Titles, bodies, labels, states, and timestamps are classified during collection; bodies are retained only as SHA-256 digests.

- [mermaid-js/mermaid](https://github.com/mermaid-js/mermaid): 3764 issues and 3739 pull requests.
- [lukilabs/beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid): 64 issues and 75 pull requests.

Popularity is 1 + ln(1 + engagement), where engagement combines item reactions, comments, distinct participants, and PR reviews. Recency uses a 730-day activity half-life with a 0.2 floor so durable older needs are never erased. Issues use multiplier 1; open PRs 0.65; merged PRs 0.85; bot-authored items 0.1. The final item score is popularity × recency × kind × actor. Issues remain demand evidence; PRs remain implementation evidence even when shown in one ranking.

Classification is deterministic keyword/label routing. Family routing uses titles and labels first, then falls back to bodies only when the headline has no family signal; intent categories use the full title/label/body text. It can miss euphemisms and produce legitimate multi-family matches; URLs and body digests are retained so important results can be manually audited without making an opaque model the authority.

### Demand and implementation supply by intent category

| Category | Issues | Weighted demand | PRs | Weighted supply |
|---|---:|---:|---:|---:|
| output-runtime | 2444 | 3120.10 | 1389 | 1135.89 |
| interoperability | 1832 | 2482.61 | 2601 | 1636.27 |
| text-labels | 1786 | 2424.30 | 1656 | 1698.68 |
| syntax-acceptance | 998 | 1451.99 | 916 | 785.42 |
| layout-relationships | 1040 | 1427.59 | 603 | 608.45 |
| semantic-correctness | 789 | 984.32 | 1246 | 575.48 |
| styling-theming | 771 | 975.04 | 560 | 485.27 |
| configuration | 483 | 628.56 | 798 | 454.61 |
| new-family | 288 | 601.38 | 153 | 198.32 |
| uncategorized | 312 | 297.61 | 308 | 203.76 |
| accessibility | 54 | 75.85 | 56 | 53.67 |
| performance | 49 | 72.59 | 218 | 79.05 |
| security | 56 | 68.01 | 695 | 123.31 |

### Demand and implementation supply by diagram family

| Family | Issues | Weighted demand | PRs | Weighted supply |
|---|---:|---:|---:|---:|
| cross-cutting | 1296 | 1424.18 | 2623 | 1628.85 |
| flowchart | 1096 | 1395.18 | 347 | 398.29 |
| sequence | 309 | 373.70 | 139 | 125.36 |
| class | 264 | 331.23 | 89 | 79.86 |
| gantt | 236 | 308.82 | 125 | 121.59 |
| er | 132 | 194.08 | 71 | 87.14 |
| state | 139 | 169.67 | 68 | 67.48 |
| architecture | 76 | 154.03 | 93 | 124.30 |
| gitgraph | 113 | 136.33 | 88 | 77.05 |
| mindmap | 72 | 103.79 | 52 | 61.55 |
| c4 | 48 | 81.72 | 57 | 79.67 |
| timeline | 48 | 77.20 | 43 | 54.25 |
| block | 41 | 67.53 | 16 | 27.49 |
| xychart | 32 | 53.16 | 45 | 59.54 |
| pie | 36 | 46.31 | 27 | 26.36 |
| sankey | 21 | 33.07 | 49 | 44.04 |
| zenuml | 16 | 22.68 | 83 | 34.76 |
| journey | 17 | 20.16 | 22 | 21.80 |
| quadrant | 14 | 19.75 | 20 | 24.70 |
| usecase | 7 | 19.38 | 8 | 11.63 |
| packet | 6 | 14.89 | 9 | 8.55 |
| requirement | 12 | 14.73 | 16 | 15.91 |
| radar | 9 | 12.08 | 16 | 22.63 |
| kanban | 4 | 4.85 | 12 | 13.49 |

### Highest-weight unsupported-family evidence

- [mermaid-js/mermaid#4628](https://github.com/mermaid-js/mermaid/issues/4628) — Add Use Case diagram type (issue, score 7.47, updated 2026-06-10)
- [mermaid-js/mermaid#3221](https://github.com/mermaid-js/mermaid/issues/3221) — C4 context graph relationship text overlaps resources and boxes (issue, score 4.67, updated 2026-06-17)
- [mermaid-js/mermaid#1276](https://github.com/mermaid-js/mermaid/issues/1276) — Support for C4 Models (issue, score 4.56, updated 2025-04-11)
- [mermaid-js/mermaid#4906](https://github.com/mermaid-js/mermaid/issues/4906) — Themes do not work for C4 diagrams (issue, score 3.89, updated 2026-06-17)
- [mermaid-js/mermaid#7842](https://github.com/mermaid-js/mermaid/pull/7842) — feat(c4): migrate C4 element shapes to the unified shapes (pull-request, score 3.52, updated 2026-07-30)
- [mermaid-js/mermaid#948](https://github.com/mermaid-js/mermaid/issues/948) — Packet structure diagrams (issue, score 3.36, updated 2025-07-08)
- [mermaid-js/mermaid#6082](https://github.com/mermaid-js/mermaid/issues/6082) — Ability to hide stereotypes in mermaid (issue, score 3.21, updated 2026-07-15)
- [mermaid-js/mermaid#177](https://github.com/mermaid-js/mermaid/issues/177) — Poll - next diagram type addition (issue, score 3.21, updated 2023-09-21)
- [mermaid-js/mermaid#5423](https://github.com/mermaid-js/mermaid/issues/5423) — Block diagram group title should be rendered above of inner blocks (issue, score 3.13, updated 2025-06-05)
- [mermaid-js/mermaid#5741](https://github.com/mermaid-js/mermaid/issues/5741) — Duplicated IDs for markers (still) (issue, score 3.10, updated 2026-04-23)
- [mermaid-js/mermaid#7737](https://github.com/mermaid-js/mermaid/pull/7737) — Release Candidate 11.15.0 (pull-request, score 3.05, updated 2026-05-11)
- [mermaid-js/mermaid#6327](https://github.com/mermaid-js/mermaid/issues/6327) — Packet-beta feature (issue, score 2.99, updated 2026-03-02)

## Built-in family result

| Family | Intent /100 | Implementation /100 | Demand trace /4 | Issues | Weighted demand | PRs | Weighted supply | Decision |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| flowchart | 95 | 100 | 3 | 899 | 1166.89 | 283 | 356.87 | protect |
| state | 90 | 94 | 3 | 85 | 108.79 | 44 | 51.35 | protect |
| sequence | 95 | 100 | 3 | 236 | 305.03 | 94 | 101.94 | protect |
| timeline | 80 | 81 | 3 | 37 | 60.02 | 35 | 48.10 | strengthen |
| class | 90 | 100 | 2 | 192 | 256.29 | 63 | 64.29 | protect |
| er | 95 | 100 | 3 | 96 | 140.89 | 64 | 82.93 | protect |
| journey | 80 | 88 | 2 | 7 | 10.51 | 10 | 10.25 | strengthen |
| architecture | 75 | 81 | 2 | 56 | 122.39 | 71 | 94.40 | strengthen |
| xychart | 95 | 100 | 3 | 29 | 48.05 | 40 | 55.87 | protect |
| pie | 90 | 100 | 2 | 33 | 43.37 | 21 | 23.73 | protect |
| quadrant | 90 | 100 | 2 | 13 | 18.23 | 16 | 21.01 | protect |
| gantt | 90 | 100 | 2 | 140 | 176.78 | 86 | 91.79 | protect |
| mindmap | 90 | 100 | 2 | 55 | 82.57 | 39 | 53.29 | protect |
| gitgraph | 90 | 100 | 2 | 61 | 81.39 | 53 | 46.55 | protect |
| radar | 90 | 100 | 2 | 7 | 8.17 | 14 | 22.39 | protect |

## How this is operational

1. Run bun run intent:github:refresh to recrawl both repositories and replace the normalized harvest.
2. Run bun run intent:families to regenerate this report.
3. Run bun run intent:families:check in CI. It rejects missing families, invalid contracts/scores, missing evidence files, stale or tampered research, changed weighting, and report drift.
4. Convert high-weight items into minimized tests. Once individual issue/PR URLs are attached to those fixtures, raise demand traceability to level 4.
5. Revisit the harvest at least every 120 days; the offline check deliberately expires old evidence.

## flowchart

Intent compatibility: **95/100**; implementation evidence: **100/100**; demand traceability: **3/4**; decision: **protect**.

Contract: Preserve node identity, directed/multi-edge topology, subgraph membership, authored direction, endpoint markers, labels, shapes, links, and styling intent.

| Intent dimension | Syntax acceptance | Semantic preservation | Communicative equivalence | No silent loss | Demand traceability |
|---|---:|---:|---:|---:|---:|
| Evidence level (0–4) | 4 | 4 | 4 | 4 | 3 |

Facts AM must preserve:

- Node and subgraph identity survives parse/serialize.
- Edge direction, multiplicity, markers, labels, and containment remain inspectable.
- Author-specified graph/subgraph direction is treated as a constraint, not decoration.

Presentation freedom:

- ELK may choose different ranks, bends, spacing, and compaction than Mermaid Dagre.
- Collision avoidance and canvas growth may move labels or nodes.

Known intent risks:

- Edges targeting subgraphs and nested direction changes are high-demand semantic traps.
- HTML/Markdown labels can be accepted yet lose intended text structure.

Next actions:

- Bind the highest-weight subgraph, label, and edge-routing reports to minimized conformance fixtures.
- Add syntax-preservation mutations for every Mermaid v11 node shape.

Executable evidence:

- `src/__tests__/flowchart-v11-shapes.test.ts`
- `src/__tests__/layout-rubric.test.ts`
- `src/__tests__/family-registration-conformance.test.ts`

Highest-weight matching user evidence (1182 matching items):

- [mermaid-js/mermaid#2509](https://github.com/mermaid-js/mermaid/issues/2509) — subgraph direction not applying (issue, score 6.27, updated 2026-07-02)
- [mermaid-js/mermaid#2977](https://github.com/mermaid-js/mermaid/issues/2977) — Move the subgraph label to the bottom left corner (issue, score 5.55, updated 2026-07-01)
- [mermaid-js/mermaid#3806](https://github.com/mermaid-js/mermaid/issues/3806) — Multiline title in flowchart subgraphs is overlapped by nodes (issue, score 5.23, updated 2026-07-07)
- [mermaid-js/mermaid#3723](https://github.com/mermaid-js/mermaid/issues/3723) — Support specifying that two nodes should be at the same level/rank (issue, score 5.14, updated 2026-03-08)
- [mermaid-js/mermaid#1209](https://github.com/mermaid-js/mermaid/issues/1209) — Subgraph label spacing is missing left/right and bottom spacing (issue, score 4.88, updated 2026-02-10)

## state

Intent compatibility: **90/100**; implementation evidence: **94/100**; demand traceability: **3/4**; decision: **protect**.

Contract: Preserve state identity, transition order and direction, labels, start/end/history/choice/fork/join semantics, notes, composite containment, and concurrency.

| Intent dimension | Syntax acceptance | Semantic preservation | Communicative equivalence | No silent loss | Demand traceability |
|---|---:|---:|---:|---:|---:|
| Evidence level (0–4) | 4 | 4 | 3 | 4 | 3 |

Facts AM must preserve:

- Pseudostates remain typed rather than flattened into ordinary nodes.
- Composite and concurrent regions retain containment and transition endpoints.

Presentation freedom:

- Composite sizing, region proportions, and transition routing may differ.
- Marker proportions need not match Mermaid pixels.

Known intent risks:

- Nested concurrency can render plausibly while attaching a transition to the wrong semantic scope.
- Aliases and labels can be confused during round-trip serialization.

Next actions:

- Trace high-weight nested-state reports to executable containment and transition-scope fixtures.

Executable evidence:

- `src/__tests__/state-pseudostates.test.ts`
- `src/__tests__/family-registration-conformance.test.ts`

Highest-weight matching user evidence (129 matching items):

- [mermaid-js/mermaid#6336](https://github.com/mermaid-js/mermaid/issues/6336) — Self-edges/loops look very awkward in state diagrams (issue, score 4.43, updated 2026-05-08)
- [mermaid-js/mermaid#5969](https://github.com/mermaid-js/mermaid/issues/5969) — live editor uses layout: elk for adaptive rendering.  This isn't documented anywhere (issue, score 3.69, updated 2026-06-23)
- [mermaid-js/mermaid#2383](https://github.com/mermaid-js/mermaid/issues/2383) — Improve layout on state diagrams so that it tries harder not to cross lines. (issue, score 3.48, updated 2025-11-28)
- [mermaid-js/mermaid#6108](https://github.com/mermaid-js/mermaid/issues/6108) — Notes positionning in state diagram does not respect syntax (issue, score 2.87, updated 2026-06-25)
- [mermaid-js/mermaid#7520](https://github.com/mermaid-js/mermaid/pull/7520) — fix(stateDiagram): enforce strict comment syntax (pull-request, score 2.39, updated 2026-04-21)

## sequence

Intent compatibility: **95/100**; implementation evidence: **100/100**; demand traceability: **3/4**; decision: **protect**.

Contract: Preserve participant identity and order, message chronology/direction/type, activations, notes, create/destroy events, and fragment branching/nesting.

| Intent dimension | Syntax acceptance | Semantic preservation | Communicative equivalence | No silent loss | Demand traceability |
|---|---:|---:|---:|---:|---:|
| Evidence level (0–4) | 4 | 4 | 4 | 4 | 3 |

Facts AM must preserve:

- Vertical ordering communicates source chronology.
- Fragment operands and activation lifetimes remain explicit.
- Arrow form and direction retain message meaning.

Presentation freedom:

- Participant spacing, note placement, fragment padding, and typography may improve independently.

Known intent risks:

- Overlapping activation stacks and nested par/alt/critical blocks can shift event ownership.
- Autonumber and actor aliases can be present visually but wrong semantically.

Next actions:

- Turn demand-ranked activation and nested-fragment failures into event-row invariant tests.

Executable evidence:

- `src/__tests__/sequence-parser.test.ts`
- `src/__tests__/sequence-layout.test.ts`
- `src/__tests__/family-registration-conformance.test.ts`

Highest-weight matching user evidence (330 matching items):

- [mermaid-js/mermaid#523](https://github.com/mermaid-js/mermaid/issues/523) — Styling components of the sequence diagram (issue, score 7.36, updated 2026-07-01)
- [mermaid-js/mermaid#5023](https://github.com/mermaid-js/mermaid/issues/5023) — [Sequence diagram] Create participant in box (issue, score 4.88, updated 2026-05-04)
- [mermaid-js/mermaid#1844](https://github.com/mermaid-js/mermaid/issues/1844) — Using Sequence Diagram is there any way to make some parts of the text in bold? (issue, score 4.55, updated 2026-01-22)
- [mermaid-js/mermaid#4787](https://github.com/mermaid-js/mermaid/issues/4787) — Add actor symbol from sequence diagrams to Flowcharts (issue, score 4.47, updated 2026-07-10)
- [mermaid-js/mermaid#2199](https://github.com/mermaid-js/mermaid/issues/2199) — Support note text that spans multiple lines in sequence diagram (issue, score 4.45, updated 2026-04-17)

## timeline

Intent compatibility: **80/100**; implementation evidence: **81/100**; demand traceability: **3/4**; decision: **strengthen**.

Contract: Preserve section membership and source chronology of periods and events, including multiline descriptions and accessibility metadata.

| Intent dimension | Syntax acceptance | Semantic preservation | Communicative equivalence | No silent loss | Demand traceability |
|---|---:|---:|---:|---:|---:|
| Evidence level (0–4) | 3 | 3 | 3 | 4 | 3 |

Facts AM must preserve:

- Periods/events remain in authored order and section.
- Orientation changes presentation without changing chronology.

Presentation freedom:

- Rail/card composition, orientation, colors, wrapping, and alternation may differ from Mermaid.

Known intent risks:

- Ambiguous colon parsing and repeated period labels can merge distinct events.
- A polished card layout can conceal an ordering error.

Next actions:

- Add demand-linked fixtures for repeated periods, multiline events, and section transitions.

Executable evidence:

- `src/__tests__/timeline-layout.test.ts`
- `src/__tests__/family-registration-conformance.test.ts`

Highest-weight matching user evidence (72 matching items):

- [mermaid-js/mermaid#2268](https://github.com/mermaid-js/mermaid/issues/2268) — Can we support vertial timeline diagram (issue, score 5.64, updated 2026-03-13)
- [mermaid-js/mermaid#6440](https://github.com/mermaid-js/mermaid/pull/6440) — Feature/event modeling diagram (pull-request, score 3.69, updated 2026-04-09)
- [mermaid-js/mermaid#1708](https://github.com/mermaid-js/mermaid/issues/1708) — Gantt as event timeline (issue, score 3.48, updated 2026-03-14)
- [mermaid-js/mermaid#5741](https://github.com/mermaid-js/mermaid/issues/5741) — Duplicated IDs for markers (still) (issue, score 3.10, updated 2026-04-23)
- [mermaid-js/mermaid#7270](https://github.com/mermaid-js/mermaid/pull/7270) — feature/2268: Add vertical timeline variation (pull-request, score 3.05, updated 2026-03-13)

## class

Intent compatibility: **90/100**; implementation evidence: **100/100**; demand traceability: **2/4**; decision: **protect**.

Contract: Preserve class/namespace identity, members, methods, visibility, generics, annotations, notes, relationship direction/type, labels, and cardinalities.

| Intent dimension | Syntax acceptance | Semantic preservation | Communicative equivalence | No silent loss | Demand traceability |
|---|---:|---:|---:|---:|---:|
| Evidence level (0–4) | 4 | 4 | 4 | 4 | 2 |

Facts AM must preserve:

- UML endpoint markers and relationship types remain typed.
- Namespace containment and compartment membership survive serialization.

Presentation freedom:

- Namespace packing, compartment sizing, bends, and typography may differ.

Known intent risks:

- Generic/member punctuation can be mistaken for Mermaid grammar.
- A visually plausible marker on the wrong end reverses UML meaning.

Next actions:

- Bind demand-ranked generics, namespace, and relationship reports to a construct-by-endpoint matrix.

Executable evidence:

- `src/__tests__/class-marker-geometry.test.ts`
- `src/__tests__/class-namespace.test.ts`
- `src/__tests__/family-registration-conformance.test.ts`

Highest-weight matching user evidence (255 matching items):

- [mermaid-js/mermaid#1052](https://github.com/mermaid-js/mermaid/issues/1052) — Add `package` to class diagram (issue, score 4.88, updated 2025-12-30)
- [mermaid-js/mermaid#1604](https://github.com/mermaid-js/mermaid/issues/1604) — Please add association class support to classDiagram syntax (issue, score 4.86, updated 2026-07-15)
- [mermaid-js/mermaid#6018](https://github.com/mermaid-js/mermaid/issues/6018) — Support nested Namespaces (issue, score 3.80, updated 2026-04-13)
- [mermaid-js/mermaid#4706](https://github.com/mermaid-js/mermaid/issues/4706) — class diagrams: allow notes for namespace'd classes (issue, score 3.35, updated 2025-10-27)
- [mermaid-js/mermaid#7092](https://github.com/mermaid-js/mermaid/issues/7092) — Hardware / Logical / HDL Design Daigram (issue, score 3.31, updated 2026-04-20)

## er

Intent compatibility: **95/100**; implementation evidence: **100/100**; demand traceability: **3/4**; decision: **protect**.

Contract: Preserve entity identity, attributes/types/keys/comments, relationship labels, direction, and both endpoint cardinality/optionality semantics.

| Intent dimension | Syntax acceptance | Semantic preservation | Communicative equivalence | No silent loss | Demand traceability |
|---|---:|---:|---:|---:|---:|
| Evidence level (0–4) | 4 | 4 | 4 | 4 | 3 |

Facts AM must preserve:

- Crow’s-foot terminals encode the parsed cardinalities.
- Attribute rows and key annotations remain associated with the correct entity.

Presentation freedom:

- Table dimensions, entity ordering, route bends, and classic/neo styling may differ.

Known intent risks:

- Marker placement can reverse optionality or cardinality without changing topology.
- Attribute comments and complex types stress tokenization.

Next actions:

- Create demand-linked cardinality-by-direction and complex-attribute round-trip fixtures.

Executable evidence:

- `src/__tests__/er-parser.test.ts`
- `src/__tests__/er-typed-segments.test.ts`
- `src/__tests__/family-registration-conformance.test.ts`

Highest-weight matching user evidence (160 matching items):

- [mermaid-js/mermaid#2673](https://github.com/mermaid-js/mermaid/issues/2673) — erDiagram styling does not seem to work (issue, score 3.98, updated 2025-11-07)
- [mermaid-js/mermaid#4429](https://github.com/mermaid-js/mermaid/issues/4429) — Support NOT NULL attribute key for erDiagram syntax (issue, score 3.77, updated 2025-07-10)
- [mermaid-js/mermaid#5168](https://github.com/mermaid-js/mermaid/issues/5168) — Sectioning of ER diagrams (issue, score 3.73, updated 2026-05-21)
- [mermaid-js/mermaid#1546](https://github.com/mermaid-js/mermaid/issues/1546) — Allow entity type names to contain spaces, punctuation and other characters (issue, score 3.57, updated 2025-11-08)
- [mermaid-js/mermaid#4139](https://github.com/mermaid-js/mermaid/issues/4139) — Add syntax for inheritance in the Entity Relationship Diagram (issue, score 3.44, updated 2025-08-27)

## journey

Intent compatibility: **80/100**; implementation evidence: **88/100**; demand traceability: **2/4**; decision: **strengthen**.

Contract: Preserve section/task order, task scores, actor ownership, labels, and the relationship between score and experience trajectory.

| Intent dimension | Syntax acceptance | Semantic preservation | Communicative equivalence | No silent loss | Demand traceability |
|---|---:|---:|---:|---:|---:|
| Evidence level (0–4) | 3 | 4 | 3 | 4 | 2 |

Facts AM must preserve:

- Every task retains its exact score and actor set.
- Sections and tasks retain authored order.

Presentation freedom:

- AM may communicate satisfaction as a curve instead of Mermaid task blocks/faces.

Known intent risks:

- Actor lists containing punctuation can split incorrectly.
- Curve geometry must not imply values other than the parsed score.

Next actions:

- Add demand-linked actor-list and score-extreme round trips plus curve-to-score assertions.

Executable evidence:

- `src/__tests__/journey-layout-quality.test.ts`
- `src/__tests__/family-registration-conformance.test.ts`

Highest-weight matching user evidence (17 matching items):

- [mermaid-js/mermaid#6262](https://github.com/mermaid-js/mermaid/issues/6262) — Faces in Journey Diagram Out of Bound (issue, score 2.03, updated 2026-03-02)
- [mermaid-js/mermaid#6263](https://github.com/mermaid-js/mermaid/pull/6263) — 6262 - Fixed faces positioning in journey diagram (pull-request, score 1.91, updated 2026-04-21)
- [mermaid-js/mermaid#6243](https://github.com/mermaid-js/mermaid/issues/6243) — Boxes do not automatically adjust with large amount of text in Journey Diagram (issue, score 1.91, updated 2025-10-17)
- [mermaid-js/mermaid#4450](https://github.com/mermaid-js/mermaid/pull/4450) — add `@mermaid-js/parser` separate package (pull-request, score 1.90, updated 2024-03-06)
- [mermaid-js/mermaid#3508](https://github.com/mermaid-js/mermaid/issues/3508) — Let style the title of Journey Diagram (issue, score 1.84, updated 2025-04-15)

## architecture

Intent compatibility: **75/100**; implementation evidence: **81/100**; demand traceability: **2/4**; decision: **strengthen**.

Contract: Preserve service, group, and junction identity; nesting; icon/label intent; edge direction; authored endpoint sides; and alignment/placement constraints.

| Intent dimension | Syntax acceptance | Semantic preservation | Communicative equivalence | No silent loss | Demand traceability |
|---|---:|---:|---:|---:|---:|
| Evidence level (0–4) | 3 | 3 | 3 | 4 | 2 |

Facts AM must preserve:

- Edges attach to the authored services/junctions and respect requested sides.
- Nested groups and alignment hints remain explicit constraints.

Presentation freedom:

- ELK may replace fCOSE; whitespace and global topology may differ when constraints remain satisfied.

Known intent risks:

- Post-layout corrections can satisfy one side/alignment constraint while violating another.
- Unknown icons must diagnose rather than silently vanish.

Next actions:

- Build a constraint-satisfaction corpus from demand-ranked architecture reports before evaluating fCOSE.

Executable evidence:

- `src/__tests__/architecture-layout.test.ts`
- `src/__tests__/family-registration-conformance.test.ts`

Highest-weight matching user evidence (127 matching items):

- [mermaid-js/mermaid#6109](https://github.com/mermaid-js/mermaid/issues/6109) — Official AWS/GCP/Azure architecture icons (issue, score 5.19, updated 2026-06-13)
- [mermaid-js/mermaid#5367](https://github.com/mermaid-js/mermaid/issues/5367) — Proposal: Cloud Architecture Diagram (issue, score 4.55, updated 2026-06-13)
- [mermaid-js/mermaid#5950](https://github.com/mermaid-js/mermaid/issues/5950) — Architecture Diagram Documentation - How to use Icons Packs in Live Editor, embedded GitHub Markdown or `.mmd` files for CLI generation etc. (issue, score 4.47, updated 2025-11-12)
- [mermaid-js/mermaid#7699](https://github.com/mermaid-js/mermaid/issues/7699) — Add Native BPMN 2.0 Support to Mermaid.js (issue, score 3.90, updated 2026-07-25)
- [mermaid-js/mermaid#6322](https://github.com/mermaid-js/mermaid/issues/6322) — Text for edges in architecture diagrams (issue, score 3.82, updated 2026-06-13)

## xychart

Intent compatibility: **95/100**; implementation evidence: **100/100**; demand traceability: **3/4**; decision: **protect**.

Contract: Preserve axis orientation/domains/categories, series kind/order/identity, and exact bar/line values so the chart communicates the same quantitative relationships.

| Intent dimension | Syntax acceptance | Semantic preservation | Communicative equivalence | No silent loss | Demand traceability |
|---|---:|---:|---:|---:|---:|
| Evidence level (0–4) | 4 | 4 | 4 | 4 | 3 |

Facts AM must preserve:

- Exact source values remain available independently of display rounding.
- Scale direction and categorical ordering do not change with presentation.

Presentation freedom:

- Tick count, tick formatting, canvas budget, and label collision handling may differ.

Known intent risks:

- Custom nice ticks can accidentally change the perceived domain.
- Unequal series lengths and negative values can be silently truncated.

Next actions:

- Use D3 as a mathematical oracle for adversarial domains and bind high-demand scale reports to exact-value fixtures.

Executable evidence:

- `src/__tests__/xychart-renderer.test.ts`
- `src/__tests__/family-registration-conformance.test.ts`

Highest-weight matching user evidence (69 matching items):

- [mermaid-js/mermaid#5292](https://github.com/mermaid-js/mermaid/issues/5292) — XYChart not allowing legends (issue, score 4.52, updated 2026-06-10)
- [mermaid-js/mermaid#5926](https://github.com/mermaid-js/mermaid/issues/5926) — xychart X-axis labels overlapping each other to be unreadable - need feature to rotate them by 45 degrees (GNUplot can do this) (issue, score 3.51, updated 2026-06-01)
- [mermaid-js/mermaid#6164](https://github.com/mermaid-js/mermaid/issues/6164) — XY Chart: Display value above bar (issue, score 3.26, updated 2026-03-12)
- [mermaid-js/mermaid#5167](https://github.com/mermaid-js/mermaid/pull/5167) — xychart: support for multiple datasets added (pull-request, score 2.93, updated 2026-05-13)
- [mermaid-js/mermaid#7724](https://github.com/mermaid-js/mermaid/pull/7724) — Add legends to XY charts (pull-request, score 2.81, updated 2026-06-10)

## pie

Intent compatibility: **90/100**; implementation evidence: **100/100**; demand traceability: **2/4**; decision: **protect**.

Contract: Preserve every category and exact value, proportional meaning, title/showData intent, styling, and explicit highlight/donut extensions.

| Intent dimension | Syntax acceptance | Semantic preservation | Communicative equivalence | No silent loss | Demand traceability |
|---|---:|---:|---:|---:|---:|
| Evidence level (0–4) | 4 | 4 | 4 | 4 | 2 |

Facts AM must preserve:

- Sub-1% slices remain represented instead of being silently discarded.
- Arc proportions derive from exact semantic values.

Presentation freedom:

- Label suppression, collision handling, legend layout, and arc path formatting may differ.

Known intent risks:

- Copying Mermaid’s sub-1% filter would violate author intent.
- Negative, zero, and all-zero datasets require explicit diagnostics.

Next actions:

- Keep small-slice preservation normative and trace demand-ranked value/label reports to tests.

Executable evidence:

- `src/__tests__/pie.test.ts`
- `src/__tests__/pie-elevation.test.ts`
- `src/__tests__/family-registration-conformance.test.ts`

Highest-weight matching user evidence (54 matching items):

- [mermaid-js/mermaid#5632](https://github.com/mermaid-js/mermaid/issues/5632) — Screen reader / accessibility technology support for diagrams (issue, score 3.40, updated 2026-02-02)
- [mermaid-js/mermaid#1983](https://github.com/mermaid-js/mermaid/issues/1983) — Left align output? (pie chart specifically) (issue, score 2.83, updated 2026-01-12)
- [mermaid-js/mermaid#5899](https://github.com/mermaid-js/mermaid/issues/5899) — Pie slices aren't sorted by their label as claimed by docs (issue, score 2.61, updated 2026-03-03)
- [mermaid-js/mermaid#7760](https://github.com/mermaid-js/mermaid/pull/7760) — Feature: Enhance Pie Chart - Enable donut chart, Set legend position, and highlight slice (pull-request, score 2.36, updated 2026-05-26)
- [mermaid-js/mermaid#7394](https://github.com/mermaid-js/mermaid/pull/7394) — fix: prevent long pie chart titles from being clipped (pull-request, score 2.20, updated 2026-03-13)

## quadrant

Intent compatibility: **90/100**; implementation evidence: **100/100**; demand traceability: **2/4**; decision: **protect**.

Contract: Preserve axis labels/directions, quadrant labels, point identity, and exact normalized coordinates so quadrant membership and relative position remain truthful.

| Intent dimension | Syntax acceptance | Semantic preservation | Communicative equivalence | No silent loss | Demand traceability |
|---|---:|---:|---:|---:|---:|
| Evidence level (0–4) | 4 | 4 | 4 | 4 | 2 |

Facts AM must preserve:

- Point coordinates and quadrant numbering remain exact.
- Collision displacement uses leaders so authored coordinates remain recoverable.

Presentation freedom:

- Density scaling, wrapping, label displacement, and leader routing may improve readability.

Known intent risks:

- Moving a label without a leader can imply the wrong point position.
- Axis inversion can reverse the author’s intended judgement.

Next actions:

- Add exact coordinate/axis-orientation metamorphic tests linked to demand evidence.

Executable evidence:

- `src/__tests__/family-registration-conformance.test.ts`
- `src/__tests__/scene-fidelity.test.ts`

Highest-weight matching user evidence (29 matching items):

- [mermaid-js/mermaid#4812](https://github.com/mermaid-js/mermaid/issues/4812) — Word wrap and Markdown in Quadrant charts (issue, score 2.85, updated 2026-04-10)
- [mermaid-js/mermaid#7734](https://github.com/mermaid-js/mermaid/pull/7734) — fix: read block.padding and sanitizeText config dynamically instead of at import time (pull-request, score 2.61, updated 2026-05-27)
- [mermaid-js/mermaid#7693](https://github.com/mermaid-js/mermaid/pull/7693) — fix(quadrant-chart): add UNICODE_TEXT support for CJK and emoji (pull-request, score 2.09, updated 2026-05-04)
- [mermaid-js/mermaid#7818](https://github.com/mermaid-js/mermaid/issues/7818) — Diagram Proposal: RASCI Matrix (issue, score 2.01, updated 2026-06-07)
- [mermaid-js/mermaid#4450](https://github.com/mermaid-js/mermaid/pull/4450) — add `@mermaid-js/parser` separate package (pull-request, score 1.90, updated 2024-03-06)

## gantt

Intent compatibility: **90/100**; implementation evidence: **100/100**; demand traceability: **2/4**; decision: **protect**.

Contract: Preserve task/section identity and order, dates/durations, dependencies, milestones, status tags, exclusions, date formats, and explicit today semantics.

| Intent dimension | Syntax acceptance | Semantic preservation | Communicative equivalence | No silent loss | Demand traceability |
|---|---:|---:|---:|---:|---:|
| Evidence level (0–4) | 4 | 4 | 4 | 4 | 2 |

Facts AM must preserve:

- The UTC scheduler produces inspectable start/end facts and dependency relationships.
- Critical/dependency overlays add information without altering the authored schedule.

Presentation freedom:

- Tick density/formatting, bar spacing, label placement, and overlay styling may differ.

Known intent risks:

- Locale/timezone parsing can move tasks across dates.
- Exclusions and chained dependencies can yield plausible but wrong schedules.

Next actions:

- Prioritize demand-ranked date parsing, exclusions, and dependency reports in the pinned schedule corpus.

Executable evidence:

- `src/__tests__/gantt-upstream-bench.test.ts`
- `src/__tests__/family-registration-conformance.test.ts`

Highest-weight matching user evidence (226 matching items):

- [mermaid-js/mermaid#1301](https://github.com/mermaid-js/mermaid/issues/1301) — Gantt diagram date text on the horizontal axis overlapped if tasks span a long period of time (issue, score 3.61, updated 2025-10-14)
- [mermaid-js/mermaid#3290](https://github.com/mermaid-js/mermaid/issues/3290) — Vertical dependency lines in Gantt chart (issue, score 3.54, updated 2025-09-18)
- [mermaid-js/mermaid#5140](https://github.com/mermaid-js/mermaid/issues/5140) — Add linebreak to task gantt (issue, score 3.51, updated 2026-03-31)
- [mermaid-js/mermaid#6585](https://github.com/mermaid-js/mermaid/issues/6585) — Diagram Proposal: Add PERT Chart Diagram Type for Project Planning (issue, score 3.32, updated 2026-04-21)
- [mermaid-js/mermaid#3295](https://github.com/mermaid-js/mermaid/issues/3295) — Sub task for Gantt chart (issue, score 3.09, updated 2025-11-13)

## mindmap

Intent compatibility: **90/100**; implementation evidence: **100/100**; demand traceability: **2/4**; decision: **protect**.

Contract: Preserve root/hierarchy, parentage, sibling order, labels, shapes, icons, and classes regardless of radial, bilateral, or tidy-tree presentation.

| Intent dimension | Syntax acceptance | Semantic preservation | Communicative equivalence | No silent loss | Demand traceability |
|---|---:|---:|---:|---:|---:|
| Evidence level (0–4) | 4 | 4 | 4 | 4 | 2 |

Facts AM must preserve:

- Hierarchy and source order are independent of force-directed or deterministic positioning.
- Authored shape/icon/class intent remains attached to the correct node.

Presentation freedom:

- AM need not reproduce Cose-Bilkent positions, edge widths, or balance.

Known intent risks:

- Indentation errors can silently reparent an entire subtree.
- Icons/classes may parse but disappear in terminal output.

Next actions:

- Turn demand-ranked indentation, icon, and long-label reports into hierarchy and projection fixtures.

Executable evidence:

- `src/__tests__/mindmap-gitgraph-upstream-oracle.test.ts`
- `src/__tests__/family-registration-conformance.test.ts`

Highest-weight matching user evidence (94 matching items):

- [mermaid-js/mermaid#4784](https://github.com/mermaid-js/mermaid/issues/4784) — Ishikawa diagram (issue, score 4.94, updated 2026-03-31)
- [mermaid-js/mermaid#4099](https://github.com/mermaid-js/mermaid/issues/4099) — Add click interactions to MindMap (issue, score 4.79, updated 2026-03-20)
- [mermaid-js/mermaid#5932](https://github.com/mermaid-js/mermaid/pull/5932) — feat: Add Venn diagram (pull-request, score 4.39, updated 2026-02-26)
- [mermaid-js/mermaid#5045](https://github.com/mermaid-js/mermaid/issues/5045) — Concept Map (Mindmap connection lines) (issue, score 4.08, updated 2026-07-28)
- [mermaid-js/mermaid#5653](https://github.com/mermaid-js/mermaid/issues/5653) — Feature Request: Support for Layout Configuration in Mindmaps (issue, score 3.93, updated 2025-10-15)

## gitgraph

Intent compatibility: **90/100**; implementation evidence: **100/100**; demand traceability: **2/4**; decision: **protect**.

Contract: Preserve source-ordered commits, branch creation/checkout, commit identity/type/tag, merges, cherry-picks, and the resulting history topology.

| Intent dimension | Syntax acceptance | Semantic preservation | Communicative equivalence | No silent loss | Demand traceability |
|---|---:|---:|---:|---:|---:|
| Evidence level (0–4) | 4 | 4 | 4 | 4 | 2 |

Facts AM must preserve:

- History topology is primary; branch lanes are a projection.
- Commit and merge/cherry-pick identity remain inspectable.

Presentation freedom:

- Lane offsets, orientation, label rotation/backgrounds, and route bends may differ.

Known intent risks:

- Reusing commit IDs or invalid cherry-pick sources must diagnose explicitly.
- A visually connected merge can still reference the wrong parent.

Next actions:

- Bind demand-ranked topology reports to source-order and parent-set invariants.

Executable evidence:

- `src/__tests__/mindmap-gitgraph-upstream-oracle.test.ts`
- `src/__tests__/family-registration-conformance.test.ts`

Highest-weight matching user evidence (114 matching items):

- [mermaid-js/mermaid#5898](https://github.com/mermaid-js/mermaid/issues/5898) — gitGraph: Cannot merge main into a production branch that has no prior commits in it (issue, score 3.38, updated 2026-01-20)
- [mermaid-js/mermaid#6148](https://github.com/mermaid-js/mermaid/issues/6148) — It seems that `parallelCommits: true` makes no difference (issue, score 3.34, updated 2025-11-03)
- [mermaid-js/mermaid#5242](https://github.com/mermaid-js/mermaid/issues/5242) — Transit system diagrams (issue, score 3.05, updated 2025-03-11)
- [mermaid-js/mermaid#4388](https://github.com/mermaid-js/mermaid/issues/4388) — Unable to render rich display  Diagram error not found. (issue, score 2.75, updated 2025-02-05)
- [mermaid-js/mermaid#3801](https://github.com/mermaid-js/mermaid/issues/3801) — GitGraph support for multiple tags (issue, score 2.31, updated 2024-07-18)

## radar

Intent compatibility: **90/100**; implementation evidence: **100/100**; demand traceability: **2/4**; decision: **protect**.

Contract: Preserve axis identity/order, exact dataset values, min/max ranges, legend identity, and curve/graticule configuration so comparative shape meaning remains truthful.

| Intent dimension | Syntax acceptance | Semantic preservation | Communicative equivalence | No silent loss | Demand traceability |
|---|---:|---:|---:|---:|---:|
| Evidence level (0–4) | 4 | 4 | 4 | 4 | 2 |

Facts AM must preserve:

- Polar vertices derive from typed axes and exact values.
- Series identity and scale bounds remain explicit.

Presentation freedom:

- Curve interpolation, legend packing, axis-label spacing, and graticule style may differ.

Known intent risks:

- Mismatched axis/value counts can rotate or truncate meaning.
- Automatic range changes can exaggerate or flatten differences.

Next actions:

- Add demand-ranked axis/value mismatch and range fixtures with exact polar-coordinate assertions.

Executable evidence:

- `src/__tests__/radar-renderer.test.ts`
- `src/__tests__/family-registration-conformance.test.ts`

Highest-weight matching user evidence (21 matching items):

- [mermaid-js/mermaid#7535](https://github.com/mermaid-js/mermaid/pull/7535) — feat: add Cynefin framework diagram type (pull-request, score 2.69, updated 2026-05-06)
- [mermaid-js/mermaid#7781](https://github.com/mermaid-js/mermaid/pull/7781) — fix(radar): align axis labels based on angular position to prevent clipping (pull-request, score 2.29, updated 2026-06-02)
- [mermaid-js/mermaid#6481](https://github.com/mermaid-js/mermaid/pull/6481) — feat: Add optional axis / tick labels for radar chart (pull-request, score 2.15, updated 2026-06-15)
- [mermaid-js/mermaid#7403](https://github.com/mermaid-js/mermaid/pull/7403) — fix: make treemap title and labels theme-aware for dark background readers (pull-request, score 1.96, updated 2026-03-12)
- [mermaid-js/mermaid#7333](https://github.com/mermaid-js/mermaid/pull/7333) — 7162: add line and column numbers to parse error messages (pull-request, score 1.84, updated 2026-01-23)
