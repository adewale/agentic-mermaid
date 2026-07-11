# Family Elevation Plan

Status: implementation complete for all 72 family items and all 18 completion packages; final-head CI/review evidence is retained externally
Last reviewed: 2026-07-10

This document began as the plan of record and now records the implemented
family-elevation scope plus the completed release-evidence gate. PR #142 delivered the broad twelve-family baseline and
closed the parser-integrity cluster—Flowchart quoted non-rectangle labels and
Unicode IDs, Timeline grammar drift, State/Class/ER `:::` identity corruption,
and ER aliases/composite keys—using shared grammar primitives and cross-surface
tests. The follow-on program completed Architecture routing/agent/icons/terminal
work, State/Class/ER residual elevation, and full Mindmap/GitGraph citizenship,
alongside the Unicode, hard-width terminal, marker, SVG identity/reference,
accessibility, configuration-honesty, and mutation packages. Executable
evidence is recorded below.
Worked example: the Journey elevation (PR #141), whose method this plan
generalizes to the other eleven families.

## How these issues were found

Every item below carries a provenance tag naming the leg of the audit that
surfaced it. The audit (2026-07-10, run against merged `main` after PR #141)
had three legs, mirroring the Journey research method in
[`families/journey-usage-research.md`](./families/journey-usage-research.md):

1. **Local audit + render probes** (`probe:`) — per-family reading of the
   renderer parser, agent body, layout, renderer, ASCII path, tests, and
   design docs, plus stress fixtures rendered to PNG/SVG/ASCII and inspected.
   Probe fixtures are named inline (e.g. `f-quoted-parens`); each fix
   re-creates its fixture as the failing test, so the fixtures live on as
   tests rather than as attachments.
2. **Upstream demand** (`upstream:`) — open AND closed issues/PRs of
   `mermaid-js/mermaid`, `AlexanderGrooff/mermaid-ascii`, and
   `lukilabs/beautiful-mermaid`, cited by number.
3. **Fork graph** (`fork:`) — the most popular forks first of all three
   repos, ranked by stars/recency (the crawl method of
   `scripts/research/fork-journey-crawl.ts`), distinguishing passive mirrors
   from genuinely divergent forks and mining the divergent ones for
   family-relevant work.

Items marked **V** were verified during the audit by an executed probe or a
direct code read with file:line evidence; items marked **S** are suspected
and must be re-verified as the first step of their work item.

## Fix vs. feature

Every item is classified:

- **Fix** — shipped behavior is wrong: output corrupts, content is silently
  lost, a succeeding op does not round-trip, or a documented input silently
  does nothing. Fixes are debts; they come first.
- **Feature (parity)** — a capability upstream Mermaid ships that this
  renderer honestly lacks. Absence is visible, not corrupting.
- **Feature (beyond-parity)** — a capability nothing in the ecosystem ships.

One conversion rule resolves the boundary cases: **for an unmodeled
construct, honesty is the fix; modeling is the feature.** When upstream-legal
syntax silently corrupts output today (sequence `box`, class `:::`, ER
aliases), the *fix* is to stop lying — preserve the source opaquely or emit a
targeted diagnostic — and the *feature* is to actually model and render the
construct. Plan items below that carry both a Fix and a Feature stage say so.

## Principles

The Journey elevation validated a specific discipline. Every item in this
plan is executed under it.

### P1. Correctness by construction first; checks second

Where a defect class can be made unrepresentable, restructure rather than
patch: one shared grammar per family instead of N hand-copies that drift;
layouts that tile by construction instead of overlap checks; palettes sized
to element counts instead of modulo wraps; serializers whose output is
produced by the same grammar that parses it. Checks (tests, verify
tripwires, rubric metrics) then become regression guards, not the only line
of defense.

### P2. Red → green → refactor, with revert proof

Every fix begins with a failing test that reproduces the defect from its
provenance fixture. The test is run red before the fix, green after, and the
fix is temporarily reverted to confirm the test fails again. PR descriptions
state the red counts (as PR #141 did). Refactor happens after green:
duplication found while fixing (grammar copies, statement splitters,
per-family wrap code) is extracted into shared modules in the same PR only
when the fix itself demanded touching it — otherwise it is a named follow-up.

### P3. The fidelity contract: a succeeding op must round-trip

`mutate` returning ok promises that serialize → render-parse reproduces the
edit. The audit found this contract broken in four families (class `set_title`
/`add_note`, ER `add_entity`, state unlabeled `add_state`, sequence
`remove_participant`). The construction-level enforcement is a
**serializer→render-parser conformance suite per family** — the property
that any structured body's serialized source must re-parse through the
*renderer's* parser to equivalent structure. The pattern exists as
`flowchart-parser-conformance.test.ts`; this plan extends it to every
family, because eight of the verified silent-loss bugs lived exactly in that
untested seam.

### P4. Documented limitation ⇒ runtime diagnostic

A gap recorded only in prose is experienced by users as silent corruption.
Every accepted-but-ignored config field gets the `INEFFECTIVE_CONFIG` lint
(introduced in PR #141) or gets wired; every unmodeled construct gets a
targeted `UNSUPPORTED_SYNTAX` reason or an honest opaque fallback; CLI flag
parsing stops swallowing unknown flags silently.

### P5. Snapshots pin; invariants judge

Golden regeneration launders bugs into baselines. Any PR that regenerates
goldens must land invariant gates beside them (geometry, contrast, width
budgets, containment) that would have caught the defect the goldens
previously hid, and must carry the `[approve-goldens]` commit line.

### P6. Shared primitives over per-family fixes

Fixes that recur across families are implemented once in the shared layer
and adopted per family: the grapheme-safe wrap module (`src/ascii/wrap.ts`),
`wcagContrastRatio` (`src/shared/color-math.ts`), PNG glyph-coverage
warnings, the family rubric (`src/family-rubric.ts`), content-hashed SVG id
namespacing. The scene-IR fidelity oracle is upgraded once (text geometry,
not just content) and every family inherits the guard.

### P7. Sequencing: honesty, then fixes, then parity, then signatures

Phases below are ordered so that cheap systemic honesty (conformance suites,
lints) lands before behavior changes, silent-data-loss fixes land before
capability work, and beyond-parity signatures come last — each phase leaves
the tree releasable. One concern per PR, `good-pr` applied, full suite +
tsc + website:check green at every merge.

---

## Recurring defect classes and their construction remedies

| Class | Seen in | Remedy by construction | Guard |
|---|---|---|---|
| C1 Grammar drift / silent misparse | flowchart, state, sequence, class, ER, timeline, xychart | One shared parse core per family (journey pattern: event-walker grammar consumed by renderer parser, agent body, verify scan) | Cross-surface convergence tests; differential fuzz (renderer vs agent accept/reject must agree) |
| C2 Op→render fidelity break | class, ER, state, sequence, flowchart | Serializer emits only forms the render grammar accepts; ops validate labels against the render grammar | Per-family conformance property suite (P3) |
| C3 Accepted-but-ignored config | all 14 | Typed runtime-config sections; wire-or-warn | `INEFFECTIVE_CONFIG` lint + config probes in tests |
| C4 Geometry invariant violations | flowchart, sequence, quadrant, pie, architecture | Layout structures that cannot express the violation (tiling, budgeted label columns) | Family-rubric assessors; verify tripwires promoted from warnings |
| C5 Text truth (measurement, wrap, CJK, contrast) | all | Shared wrap/measure/contrast primitives; label width budgets in every layout | Width-budget and WCAG gates; adversarial text corpora (FE0F/ZWJ/CJK) |
| C6 Output-surface divergence (SVG≠PNG≠ASCII≠scene-IR) | flowchart, xychart, pie, ER, quadrant | One source of geometric truth; raster font = metrics font; scene-IR semantic geometry = drawn geometry | PNG pixel-scan tests; ASCII no-shared-cells invariant; fidelity oracle checks text x/y/anchor |

---

## Mechanically checked ledger

This table is the authoritative status surface for every numbered family item
and cross-cutting workstream below. Stable IDs make omissions and duplicate
claims test failures in `family-elevation-ledger.test.ts`. Status has exactly
three values: `done` means the named acceptance behavior and a discriminating
or enrollment guard ship; `partial` names the remaining acceptance work;
`not-started` means no implementation is claimed. The prose work plan remains
the specification and provenance record.

<!-- family-elevation-ledger:start -->
| ID | Phase | Status | Evidence or exact remainder |
|---|---|---|---|
| F1 | 1 | done | Quote-aware shape scanning and round-trip properties: `parser.test.ts`, `flowchart-parser-conformance.test.ts`. |
| F2 | 2 | done | Cross-hierarchy extraction and stale-route certificates: `subgraph-direction.test.ts`, `route-contracts.test.ts`. |
| F3 | 1 | done | Unicode identifiers and bare-header defaults: `parser.test.ts`. |
| F4 | 2 | done | Parallel ASCII lanes and reserved-cell properties: `property-ascii-routing.test.ts`, `ascii-pathfinder-determinism.test.ts`. |
| F5 | 2 | done | Start arrows use explicit pre-rotated geometry and start/end crosses have raster-proven symmetric visibility: `flowchart-marker-raster.test.ts`. |
| F6 | 2/3 | done | Typed wrapping and wire-or-warn spacing: `flowchart-runtime-config.test.ts`, `flowchart-markdown-strings.test.ts`. |
| F7 | 3 | done | Stable authored edge IDs and ID-targeted edits: `flowchart-edge-ids.test.ts`. |
| F8 | 3 | done | Expanded shape, direction, subgraph, and style operations: `flowchart-op-menu.test.ts`. |
| S1 | 1/3 | done | Structured/rendered notes with side and clearance invariants: `state-notes.test.ts`. |
| S2 | 1/3 | done | Fork, join, choice, history, and concurrency rendering: `state-pseudostates.test.ts`. |
| S3 | 1 | done | Identity-safe class shorthand and shared paint rendering: `renderer-css-classes.test.ts`, `parser.test.ts`. |
| S4 | 2 | done | Spatial State terminal output includes note boxes/connectors and concurrency separators: `state-ascii-elevation.test.ts`. |
| S5 | 1 | done | Unlabeled state serialization re-parses: `agent-state.test.ts`, `state-ops.test.ts`. |
| S6 | 3 | done | Certified self-loop arcs and dense occupancy: `self-loop-arcs.test.ts`. |
| S7 | 3 | done | Direction, movement, composite, note, and recursive operations: `state-ops.test.ts`. |
| SE1 | 1 | done | Boundary-aware block keywords: `sequence-parser.test.ts`. |
| SE2 | 2 | done | Message-width budgeting and canvas containment: `sequence-layout.test.ts`. |
| SE3 | 1 | done | Activation events and marker vocabulary: `sequence-parser.test.ts`, `sequence-layout.test.ts`. |
| SE4 | 3 | done | Autonumber, lifecycle, and box rendering: `sequence-create-destroy.test.ts`, `sequence-box.test.ts`. |
| SE5 | 1 | done | Participant removal respects preserved blocks: `agent-sequence-ops.test.ts`. |
| SE6 | 3 | done | Typed sequence config and expanded operations: `sequence-config.test.ts`, `agent-sequence-ops.test.ts`. |
| SE7 | 2 | done | Block and note containment geometry: `sequence-layout.test.ts`. |
| CL1 | 1 | done | Serializer productions re-enter the render parser: `class-serializer-conformance.test.ts`. |
| CL2 | 1 | done | Generic identity and member grammar: `class-generics.test.ts`, `class-parser.test.ts`. |
| CL3 | 1/3 | done | Shared structured `classDef`/`class`/`cssClass`/`:::`/inline paint and typed style operations: `class-residual-elevation.test.ts`. |
| CL4 | 1 | done | Direction, spacing, and config honesty: `class-direction-config.test.ts`. |
| CL5 | 4 | done | Layout-owned cardinality-label allocation passes the dense collision stress invariant: `class-residual-elevation.test.ts`. |
| CL6 | 3 | done | Compact/nested namespace parsing, configurable hierarchy, containment, and terminal frames: `class-residual-elevation.test.ts`, `class-ascii-namespaces.test.ts`. |
| ER1 | 1 | done | Bare entities render and survive typed edits: `er-parser.test.ts`, `agent-er.test.ts`. |
| ER2 | 1 | done | Stable IDs, aliases, and `set_entity_label`: `er-parser.test.ts`, `agent-er.test.ts`. |
| ER3 | 1/2 | done | Composite badges and visible comments: `er-parser.test.ts`, `er-integration.test.ts`. |
| ER4 | 1 | done | Label-less relationships remain visible: `er-parser.test.ts`. |
| ER5 | 2 | done | Terminal routes avoid foreign entity boxes and attribute rows under explicit clearance invariants: `er-ascii-clearance.test.ts`. |
| ER6 | 3 | done | Direction, config, and crow's-foot signatures: `er-direction-config.test.ts`, `er-crowsfoot.test.ts`. |
| T1 | 1 | done | Shared colon/directive grammar: `timeline-parser.test.ts`, `agent-timeline.test.ts`. |
| T2 | 1 | done | Event-less canonical periods re-render: `agent-timeline.test.ts`. |
| T3 | 1 | done | `disableMulticolor` wiring and warnings: `agent-timeline.test.ts`. |
| T4 | 3 | done | Vertical layout and width controls: `timeline-layout.test.ts`. |
| T5 | 3 | done | Ordering, insertion, and accessibility operations: `agent-timeline.test.ts`. |
| G1 | 4 | done | Dependency and critical-path overlays: `gantt-dependency-overlay.test.ts`. |
| G2 | 3 | done | Excluded-day plot shading: `gantt-excluded-shading.test.ts`. |
| G3 | 0/1 | done | Sanitized today marker, CLI clock, and unknown-flag errors: `cli-gantt-today-flag.test.ts`. |
| G4 | 3 | done | Ordering, identity, and flag operations: `agent-gantt.test.ts`. |
| G5 | 2/3 | done | Measured task-label wrapping: `gantt-layout.test.ts`. |
| G6 | 1/3 | done | Upstream exclusion boundaries and milestone status paint: `gantt-exclusion-boundary.test.ts`. |
| XY1 | 3 | done | Multi-series legend: `xychart-legend.test.ts`. |
| XY2 | 1 | done | Strict finite series and shared axis parsing: `xychart-parser.test.ts`. |
| XY3 | 1/2 | done | Background-aware contrast and raster parity: `xychart-renderer.test.ts`, `png-fonts.test.ts`. |
| XY4 | 2 | done | Tick containment, thinning, and zero baseline geometry: `xychart-layout.test.ts`. |
| XY5 | 3 | done | Orientation and point-level operations: `agent-xychart.test.ts`. |
| P1 | 0/1 | done | Pie config/theme variables are wired or warned: `pie-elevation.test.ts`. |
| P2 | 2 | done | Legend and percentage-label geometry: `pie-elevation.test.ts`. |
| P3 | 3 | done | Slice labels, donut, and legend positions: `pie-elevation.test.ts`. |
| P4 | 2 | done | High-count hue-spread palettes: `pie-elevation.test.ts`. |
| Q1 | 3 | done | Structured point and class styling: `quadrant-style.test.ts`. |
| Q2 | 2 | done | Axis-label budgets and wrapping: `quadrant.test.ts`. |
| Q3 | 0 | done | Scene text x, y, and anchor fidelity: `scene-text-fidelity.test.ts`. |
| Q4 | 4 | done | Dense placement and density/config sizing: `quadrant-style.test.ts`, `quadrant-config.test.ts`. |
| A1 | 1/4 | done | Deterministic side-constrained placement, visibility-grid obstacle routing, and truthful route certificates: `architecture-layout.test.ts`, `architecture-integration.test.ts`. |
| A2 | 1 | done | Deterministic order-independent alignment: `architecture-layout.test.ts`. |
| A3 | 0/1 | done | Natural config mappings plus named fcose no-ops: `architecture-config.test.ts`. |
| A4 | 1/3 | done | Typed junction, group-label, `{group}` boundary-edge, accessibility, move, and in-place edge operations: `agent-architecture.test.ts`. |
| A5 | 4 | done | Bounded deterministic offline curated icon registry, sanitized fallback, native-byte preservation, and attribution: `architecture-icons.test.ts`, `THIRD_PARTY_NOTICES.md`. |
| A6 | 4 | done | Projected services/junctions/groups, boundary-side routes, labels, Unicode, and hard-width terminal output: `architecture-ascii.test.ts`. |
| X1 | 0 | done | Thirty generated structured diagrams per family serialize, re-enter both parsers, and compare an independent structured-body inventory against the actual renderer-parser inventory before checking idempotence: `property-all-families-fuzz.test.ts`; canonical discovery/corpus guards remain in `cli-capabilities.test.ts`, `agent-mermaid-corpus.test.ts`. |
| X2 | 2 | done | Grapheme/display-cell measurement and writes cover terminal renderers, metadata, validation, SVG, and PNG adversarial cases: `ascii-unicode-family-contract.test.ts`, `ascii-class-er-unicode.test.ts`. |
| X3 | 4 | done | Hard `targetWidth`, typed impossible-width diagnostics, distinctive-content preservation for every family, and library/CLI/Code Mode/hosted plumbing: `ascii-target-width.test.ts`, `cli-target-width.test.ts`, `hosted-mcp.test.ts`. |
| X4 | 4 | done | Typed Scene identity and deterministic all-family exact node/group `(id, role)` plus relation `(id, role, from, to)` multisets: `svg-identity-contract.test.ts`. |
| X5 | 0/2 | done | Two-instance all-family collision proof plus marker/filter/clip-path/paint/href/ARIA reference coverage: `svg-id-hygiene-all-families.test.ts`. |
| X6 | 3/4 | done | Typed relation ARIA and every built-in palette's WCAG text/relation thresholds: `accessibility-relation-palette.test.ts`. |
| X7 | 0 | done | All 14 families have typed config sections and exhaustive key/value wire-or-warn classification on source and explicit config paths: `unknown-config-wire-or-warn.test.ts`, `state-config.test.ts`, `mindmap-gitgraph-citizenship.test.ts`. |
| X8 | 4 | done | Mindmap and GitGraph pass the zero-exception 21-surface matrix, complete a vendored-and-hashed 26/69-block pinned upstream oracle whose AST-extracted titles/sources/order match every classification, installed-tarball library/CLI/MCP checks, all-family properties, and reproducible focused mutation lanes: `diagram-family-citizenship.test.ts`, `mindmap-gitgraph-upstream-oracle.test.ts`, `e2e/tarball-consumer-fuzz.e2e.test.ts`. |
<!-- family-elevation-ledger:end -->

### Remaining completion packages

This is the mechanically checked acceptance decomposition for the root
`TODO.md` umbrella `FAM-ELEVATION-RESIDUAL`, not a second owner-priority list.
It prevents “substantially complete” from hiding a missing acceptance decision.
A package closes only when its linked ledger rows become `done` under the
Definition of Done.

<!-- family-elevation-backlog:start -->
| ID | Phase | Status | Evidence or exact remainder |
|---|---|---|---|
| B01 | 0 | done | Mechanical IDs, statuses, duplicate/omission checks, ordinal work-plan correspondence, cited-file existence, and exact executable `(row, file, title)` evidence for every done claim: `family-elevation-ledger.test.ts`. |
| B02 | 0 | done | Generated all-family serializer→renderer-parser properties, lossless opaque reparse/render probes, State config geometry, CLI flag ownership, and scene fidelity: `property-all-families-fuzz.test.ts`, `opaque-unsupported-warning.test.ts`, `state-config.test.ts`. |
| B03 | 1/4 | done | Architecture side-constrained placement, obstacle routing, and certificates close `A1`: `architecture-layout.test.ts`, `architecture-integration.test.ts`. |
| B04 | 1/3 | done | Architecture junction/group/boundary/accessibility/edit parity closes `A4`: `agent-architecture.test.ts`. |
| B05 | 2/4 | done | State notes/regions, Class namespace frames, ER clearance, and spatial Architecture terminal gates close `S4`, `CL6`, `ER5`, and `A6`: `state-ascii-elevation.test.ts`, `class-ascii-namespaces.test.ts`, `er-ascii-clearance.test.ts`, `architecture-ascii.test.ts`. |
| B06 | 2 | done | Unicode-width adoption and adversarial terminal/SVG/PNG proof complete: `ascii-unicode-family-contract.test.ts`. |
| B07 | 3 | done | Typed State regions, paint, bare declarations, hyphenated composites, and style operations: `state-typed-elevation.test.ts`, `state-ops.test.ts`. |
| B08 | 1/3/4 | done | Class paint, compact/hierarchical namespaces, terminal frames, and cardinality allocation close `CL3`, `CL5`, and `CL6`: `class-residual-elevation.test.ts`, `class-ascii-namespaces.test.ts`. |
| B09 | 3 | done | ER direction/paint and ordered typed/opaque segments preserve source while refusing identity edits that would stale opaque text: `er-typed-segments.test.ts`. |
| B10 | 4 | done | Layout-owned Class cardinality placement and dense discriminating collision stress close `CL5`: `class-residual-elevation.test.ts`. |
| B11 | 4 | done | Offline bounded Architecture icon registry, fallback policy, security tests, and licensing close `A5`: `architecture-icons.test.ts`, `THIRD_PARTY_NOTICES.md`. |
| B12 | 4 | done | Width-constrained ASCII is specified and wired through library, CLI, Code Mode, hosted MCP, and docs: `ascii-target-width.test.ts`, `cli-target-width.test.ts`. |
| B13 | 4 | done | One typed all-family SVG identity schema is published and enforced: `svg-identity-contract.test.ts`. |
| B14 | 3/4 | done | Typed relation accessibility and all-palette WCAG thresholds are executable: `accessibility-relation-palette.test.ts`. |
| B15 | 4 | done | All 26 official pinned Mindmap blocks plus parser/layout/SVG/terminal/agent/config/property/installed-package citizenship: `mindmap-gitgraph-upstream-oracle.test.ts`, `mindmap-gitgraph-citizenship.test.ts`, `e2e/tarball-consumer-fuzz.e2e.test.ts`. |
| B16 | 4 | done | All 69 official pinned GitGraph blocks (62 executable, seven explicit exclusions/divergences) plus replay/layout/SVG/terminal/agent/config/property/installed-package citizenship: `mindmap-gitgraph-upstream-oracle.test.ts`, `mindmap-gitgraph-citizenship.test.ts`, `e2e/tarball-consumer-fuzz.e2e.test.ts`. |
| B17 | 0/2 | done | Every family and local SVG reference type passes the two-instance collision matrix: `svg-id-hygiene-all-families.test.ts`. |
| B18 | all | done | The complete local matrix, final-head SHA, immutable green CI jobs, fresh reviewer ACCEPT, and residual warnings are retained in `family-elevation-acceptance.md` and the stable [PR audit record](https://github.com/adewale/agentic-mermaid/pull/149#issuecomment-4949151500); `family-elevation-ledger.test.ts` keeps this done row exact-title bound. |
<!-- family-elevation-backlog:end -->

The retained causal check `bun run test:family-elevation-reverts` now injects twenty-one final-review regression classes in a temporary checkout and requires exact red counts `(1, 1, 14, 1, 1, 1, 1, 1, 1, 1, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1)`. In addition to the original State paint, branch order, config, upstream, SVG identity, mutation grammar, hard-width, and ER-clearance faults, it now proves label-less ER relations, XYChart raster backgrounds, Quadrant axis budgets, Mindmap reserved-prefix closure, GitGraph ancestry validation, duplicate-parent suppression, injective relation identity, and continuous State concurrency separators. Every probe restores the source after its exact focused red count; earlier packages retain their focused Stryker/sabotage lanes.

## Work plan by family

Format: `[Fix|Feature(parity)|Feature(beyond)] [V|S] Title — construction move; first red test. (provenance)`

### Flowchart

1. **[Fix] [V] Quoted labels on non-rectangle shapes drop edges; `set_label` output self-corrupts.** Construction: quote-aware label extraction for every shape from one label grammar; the serializer and parser share the escaping table, so the serializer cannot emit an unreadable form. Red: parse `A("Retry (up to 3x)") --> B` → both nodes + edge; property: for arbitrary labels, mutate(set_label) → serialize → re-parse is lossless. (probe `f-quoted-parens`, `roundtrip-probe`; code src/parser.ts:593-622,852; upstream beautiful-mermaid#125)
2. **[Fix] [V] Cross-hierarchy edges render as disconnected stubs.** Construction: routes are re-derived (or re-anchored) after any node move, so a route that does not touch its endpoints cannot be emitted; promote endpoint-touching to a verify failure. Red: `f-deep-subgraphs` asserts every edge path starts on its source shape. (probe `f-deep-subgraphs`; warned-but-shipped `ROUTE_STALE_AFTER_NODE_MOVE`; upstream #2509/#4738/#6438)
3. **[Fix] [V] CJK node IDs parse to an empty diagram; headerless `graph` throws.** Construction: one ID character-class shared with the state parser (`\p{L}`); default direction TB like upstream. Red: `graph TD; 開始 --> 終了` yields two nodes. (probe `f-cjk-ids`, `f-headerless`; code src/parser.ts:625 vs :423; mermaid-ascii#74 corpus)
4. **[Fix] [V] ASCII merges parallel edges and interleaves labels.** Construction: multi-lane allocation for duplicate node pairs; label cells reserved before routing so two labels cannot share cells. Red: 5 labeled parallel edges → 5 distinct labeled lanes; invariant test: no two label strings overlap cells. (probe `f-parallel-edges`; mermaid-ascii#56/#70; beautiful-mermaid#112/#121)
5. **[Fix] [V] PNG loses bidirectional start markers and half-clips cross markers.** Construction: emit pre-rotated explicit marker geometry (no `auto-start-reverse` dependence); marker refX derived from marker size, not the border. Red: pixel-scan `f-markers` PNG for ink at both ends. (probe `f-markers`, `f-bidir-only`; code renderer.ts:157-231 + pinned resvg 2.6.2)
6. **[Feature(parity)] [V] Label wrapping (`wrappingWidth`) + typed `FlowchartRuntimeConfig`.** Fix stage per P4: `INEFFECTIVE_CONFIG` for nodeSpacing/rankSpacing/curve today. Feature stage: measured-width auto-wrap in node sizing; thread spacing config into layout. Red (fix): config probe expects the lint; red (feature): sentence-length diamond label stays under a width budget. (probe `f-long-labels`, `f-theme-dark`; code src/mermaid-source.ts:69-80; upstream #6424/#4950/#7931)
7. **[Feature(parity)] [S] Model v11.6 edge IDs (`e1@-->`) as stable edge identity** instead of consuming and discarding them; unlocks `remove_edge`/`set_label` targeting by ID. (code src/parser.ts:650,696; upstream PR #6136)
8. **[Feature(parity)] [V] Widen the flowchart op menu** (subgraph ops, set_shape, set_direction, style ops) to the level its own graph model already supports — originally the thinnest menu of the 12-family baseline. (code op-schema.ts:96-103; journey convention from PR #141)

### State

1. **[Fix] [V] Notes misparse into phantom states.** Fix stage: recognize `note ... end note` blocks and skip them loudly (no phantom states). Feature(parity) stage: model + render notes, beating upstream's open placement bug. Red: `s-notes` asserts no phantom node and (later) a rendered note anchored to the declared side. (probe `s-notes`; code src/parser.ts:461; upstream #3782; repo #118 — whose "preserved verbatim" premise this evidence corrects)
2. **[Fix+Feature(parity)] [V] Pseudostates:** `[H]` transitions silently vanish (Fix: parse + at minimum warn); `<<fork>>/<<choice>>/<<join>>` render as plain boxes and `--` regions merge (Feature(parity): bars, diamond, dashed separators — upstream's own rendering has been broken since 2021, #2514). History-state rendering is Feature(beyond) — upstream only has an open PR (#5700). Red: `s-bare-and-history` asserts the transition survives parse. (probes `s-fork-choice`, `s-bare-and-history`, `s-concurrency`; upstream #2514/#5096/#4052/#5700)
3. **[Fix] [V] `:::`/`classDef` garble state output** ("::badBadEvent" label boxes). Construction: port the flowchart classDef/`:::` handling living in the same file — one styling grammar, two consumers. Red: `s-classdef` asserts no `::`-prefixed edge labels and applied classes. (probe `s-classdef`; code src/parser.ts:193-242 vs state path; upstream #1352/#3732/#7290)
4. **[Fix] [V] ASCII composite states corrupt text and route through nodes.** Shares the C4/C5 remedy with flowchart ASCII (label-cell reservation, box avoidance). Market note: mermaid-ascii renders 0/10 real state diagrams (their #61/#74) — this is also the biggest open terminal-rendering lane. Red: `s-composite-deep` ASCII contains every label intact. (probe `s-composite-deep`; mermaid-ascii#61/#74/#59)
5. **[Fix] [V] Unlabeled `add_state` silently vanishes on serialize.** Construction: the serializer emits a legal parseable form for every body state (`X : X`), or the op rejects — enforced by the state conformance suite (P3). Red: probe script asserts round-trip contains the state. (probe `state-probe`; code state-body.ts:237-241)
6. **[Feature(parity)] [V] Self-transition loops drawn as real arcs** (currently degenerate stubs; layout deliberately relaxes self-loops out of route contracts). Upstream fixed state-side in 2025 (#6336 = the bar), flowchart-side still open (#6049 = the beat). (probes `s-composite-deep`, `f-parallel-edges`; code layout-engine.ts:736)
7. **[Feature(parity)] [V] Ops: `set_direction`, `move_state`, `dissolve_composite`, note ops** (after item 1), recursive `remove_state`. (code op-schema.ts:105-114)

### Sequence

1. **[Fix] [V] Block-keyword regex silently deletes messages** (`parser->>lexer` swallowed as a `par` block; `option` inside `critical` destroys the frame). Construction: word-boundary block grammar shared with the agent body (which already gets this right) — one keyword table, two consumers. Red: `15-keyword-prefix-actor` renders all 3 messages; `07-critical-option` keeps its frame. (probes 15/07; code src/sequence/parser.ts:117,132 vs agent sequence-body.ts:34-41)
2. **[Fix] [V] Long message labels clipped off both canvas edges.** Construction: actor spacing and the bounding box derive from *all* placed text — port the ASCII renderer's per-gap label budgeting to SVG, so a label wider than its gap widens the gap. Red: `01-long-labels` asserts every label inside the viewBox. (probe 01; code layout.ts:108,410-417; upstream #1483/#1827)
3. **[Fix] [V] Standalone `activate`/`deactivate` dropped** — 1,696 corpus lines render no bars; `-x` draws the wrong head; `<<->>` mints a phantom actor. Red: `02-activations` asserts activation rects; `09-cross-arrow` asserts cross marker and two actors. (probes 02/09/16; corpus eval/mermaidseqbench/data.csv; code parser.ts:176,219-221)
4. **[Fix→Feature(parity)] [V] `autonumber`/`create`/`destroy`/`box`:** Fix stage — stop the silent ignore (targeted diagnostics; keep `box` from collapsing the whole body to opaque via its bare `end`). Feature stage — render numbers, boxes, lifeline create/destroy. (probes 03/04/05/06; upstream #1838/#4833/#5023)
5. **[Fix] [V] `remove_participant` succeeds while the participant survives** in shorthand/in-block messages and resurrects on render. Construction: ops resolve against the same message grammar the renderer uses (C1) and the conformance suite (P3) rejects success-without-effect. Red: resurrection probe becomes the test. (probe resurrect-probe; code sequence-body.ts:35,214-223)
6. **[Feature(parity)] [V] Reorder/insert/label ops + `SequenceRuntimeConfig`** with wire-or-warn (actorMargin, wrap, mirrorActors). (code mutation-ops.ts:12, mermaid-source.ts:69-80; beautiful-mermaid#101)
7. **[Fix] [V] Note/block containment tripwires** — notes breach block frames, nested tabs overprint; the invariants are already spec'd in repo issues #25 §14.2/#26 WS11. Construction: per-depth block insets; note-aware block extents; verify warnings mirroring the gantt geometry tripwires. (probes 08/11; upstream #1765/#3216/#7651)

### Class

1. **[Fix] [V] Serializer emits grammar the render parser drops** (`title`, `note`, `class A["label"]`, backtick IDs, `A -- B` rendering as a directed association). Construction: the class conformance suite (P3) plus teaching the render parser every production `renderClass` can emit; a plain link renders with no marker. Red: agent-drift probe becomes the test (title, note, 3 relations all render). (probe `agent-drift-probe`, `c1`; code src/class/parser.ts:284-331 vs class-body.ts:39-59)
2. **[Fix] [V] Classifier/generics corruption** (`$`/`*` leak into the type column; literal tildes; `Container~T~ <|-- X` phantom class; `class Registry~K,V~` vanishes; ASCII drops method parens — a third dialect). Construction: one member grammar shared by SVG and ASCII; generics normalize to display form in exactly one place. Red: `c2`/`c3` fixtures pin member text and single-node identity. (probes c2/c3; code parser.ts:231-251, ascii/class-diagram.ts:31-34; upstream #5459/#7480)
3. **[Fix] [V] `A:::style` creates a phantom class named `A:::highlight`;** `style`/`classDef`/`cssClass` silently dropped. Fix: strip + model `:::` (flowchart's implementation is in the same file); minimum honesty is a targeted warning. (probe c6; code parser.ts:126-137; upstream #6587)
4. **[Fix] [V] `direction` ignored; spacing render-options no-op for class/ER.** Wire `direction` to ELK; thread nodeSpacing/layerSpacing; add class config section with wire-or-warn. (probe `config-probe`, c4; code layout.ts:95)
5. **[Feature(beyond)] [V] Cardinality collision pass** — endpoint texts join the label-separation machinery ER already has; upstream #3125 open since 2022. Red: `c5-stress` asserts no two cardinality glyph boxes overlap. (probe c5; code renderer.ts:607-621)
6. **[Feature(parity)] [V] Render namespaces** (parsed today, invisible in layout/render); ELK compound-node pattern exists for flowchart subgraphs. (probe c4; repo #118; upstream #7618)

### ER

1. **[Fix] [V] Bare entities dropped** — the official `add_entity` op is invisible. Red: agent-drift probe asserts the entity renders. (probe `agent-drift-probe`/e1; code src/er/parser.ts:83-89)
2. **[Fix] [V] Aliases empty the whole diagram** (`CUSTOMER["Customer Account"]` → blank SVG, no error); the `label` field already exists unpopulated. Fix parses + renders labels; add `set_entity_label` op. (probe e2; code types.ts:22-28; upstream #4746 settled syntax; beautiful-mermaid#129)
3. **[Fix] [V] Composite keys `PK, FK` lose the PK; comments invisible outside interactive SVG.** Construction: attribute grammar tokenizes keys as a comma-list; comments render as a column (upstream parity) so PNG/ASCII carry them. Red: e1 pins badges `PK,FK` and a visible comment. (probe e1/e4; code parser.ts:159-165)
4. **[Fix] [V] Label-less relationships delete the edge and its entity** — against the family's own loud-error policy. Accept with empty label (upstream-legal) — one-regex fix. (probe e1; code parser.ts:185)
5. **[Fix] [V] ASCII ER stamps labels over attribute rows and routes edges through boxes.** Shares the flowchart/state ASCII remedy; strategic note: mermaid-ascii renders 0/77 real ER diagrams — this repo has the only implementation, minus these bugs. (probe e4 unicode; beautiful-mermaid#121; mermaid-ascii#74)
6. **[Feature(parity)] [V] `direction` + `er` config section** (upstream shipped in v11.4; beautiful-mermaid#131 open; addresses "ER gets really wide" #2807). **[Feature(parity)] [V] Crow's-foot glyph correction** (`|o` draws two ticks; one-or-more indistinguishable from many). (probes/config-probe, e3; code layout.ts:78)

### Timeline

1. **[Fix] [V] Body/renderer grammar drift:** bare-`:` event splitting corrupts `10:30`-style text into phantom events; `accTitle:` becomes a period; asymmetric acceptance. Construction: extract the renderer's splitter + directive regexes into a timeline parse core both consume (journey pattern). Red: `2020 : Standup at 10:30 daily` models ONE event on both surfaces. (probes P3b/P4/P7/P10; code timeline-body.ts:19,41 vs timeline/parser.ts:121,182-215)
2. **[Fix] [V] Serializer emits `2020 :` its own renderer throws on;** bare periods unmodeled. Conformance suite (P3) + serialize event-less periods bare. (probes P5/P9)
3. **[Fix] [V] `disableMulticolor` ignored for labeled sections.** One-line gate fix + config probe test. (probe P2; code renderer.ts:79-84,147-155)
4. **[Feature(parity)] [V] Vertical (`TD`) timeline + width control** — 13 periods currently render 4,652px wide; upstream shipped vertical timelines 2026-03 (PR #7270), so this is parity now. (probe timeline-stress; upstream #2268/#5067/#5858; beautiful-mermaid#86)
5. **[Feature(parity)] [V] Ops parity with the journey convention** (move/insert/a11y ops) + the differential body-vs-renderer test gantt already has. (code op-schema.ts:124-135)

### Gantt

1. **[Feature(beyond)] [V] Dependency arrows + critical-path overlay — the family's signature.** The scheduler already computes the dependency graph, critical path, and slack (property-tested); no renderer draws them; upstream has none and has been asked since 2018. Opt-in render option, never new syntax; gated on arrow/label/tick overlap tests per gantt-research.md's own caveat. Red: connectors present between `after`-linked bars; crit-path emphasis matches `analyze`. (code schedule.ts:398-456; docs gantt.md §Not supported; upstream #818/#3290/#7300)
2. **[Feature(parity)] [V] Render excluded days as plot shading** — scheduling honors `excludes weekends` but the plot shows nothing, reading as a bug; `isExcludedDay` and `xOf()` already exist. (probe P6; upstream #6421/#7062/#314)
3. **[Fix] [V] `todayMarker` style accepted-but-ignored; today marker unreachable from the CLI; unknown CLI flags silently swallowed.** Apply the sanitized style or warn; add `--gantt-today`; error on unknown flags. (probe P1 + FLAG_SPECS read; code gantt/types.ts:103, renderer.ts:393-404, cli/index.ts:51-83)
4. **[Feature(parity)] [V] move/insert/tag-toggle ops** — the family where source order IS scheduling semantics lacks ordering ops; `set_task_status` can't toggle milestone/vert; no `set_task_id` despite `after` references. (code op-schema.ts:221-231; schedule implicit-start chaining)
5. **[Feature(parity)] [V] Task-label wrapping in the SVG label column** (65-char label → 432px column). Reuse shared wrap machinery; row height becomes label-aware. (probe4; code layout.ts:252-268; upstream #6946/#2886)
6. **[Fix] [V] Resolve the ledgered `exclude-boundary-model` divergence** (`[start,end)` vs upstream `(start,end]` shifts schedules) — adopt upstream's boundary or promote the divergence to a tested contract; plus status-styled milestones (done/active currently identical). (ledger eval/mermaid-gantt-bench/exclusions.json e3/e4; probe P11; upstream #4273)

### XYChart

1. **[Feature(parity)] [V] Multi-series SVG legend** — types and ASCII legend already exist, `legend: []` hardcoded; upstream shipped legends 2026-06 (PR #7724 closing #5292), flipping the design doc's deliberate omission. (probe xy-stress; code layout.ts:171,258; docs xychart.md)
2. **[Fix] [V] Silent axis-directive drops + NaN data poisoning** (`y-axis "Title"` ignored; multi-word name + range ignored; one junk value → every bar `y="NaN"`). Construction: shared axis grammar with the agent body (which models the dropped forms — measured drift), loud error on non-numeric data per the family's own policy. (probes xy-yaxis-title-only, xy-multiword-range, xy-nan; code parser.ts:210; upstream #5293)
3. **[Fix] [V] `backgroundColor` swaps `--bg` without adapting text (≈1.1:1) and the PNG path ignores it.** The Journey contrast remedy: derive text from the effective background; honor background in raster. (probe xy-darkbg; code render-family-hooks.ts:204-206)
4. **[Fix] [V] Axis geometry:** top tick label half-clips; tick-thinning blanks whole category labels (upstream now rotates); negative bars need a zero baseline (upstream also broken — beatable). (probes xy-multiword-range, xy-stress; upstream #7774/#5618/PR #5274)
5. **[Feature(parity)] [V] `set_orientation` + per-point ops;** extend `interactive` tooltips beyond xychart. (code types.ts:731-739)

### Pie

1. **[Fix] [V] All pie config/themeVariables silently ignored** (hook never reads frontmatter; no pie config type). Wire `textPosition`/`pie1..pie12`/stroke/opacity or lint; honoring pieN in source order fixes what upstream itself broke (#5314). (code render-family-hooks.ts:214-219; mermaid-source.ts:69-80)
2. **[Fix] [V] Legend geometry:** longest row clips at the canvas edge; `<br/>` rows collide; "(0.0%)" for nonzero small slices. (probes pie-15, pie-br; code layout.ts:106)
3. **[Feature(parity)] [V] On-slice percentage labels** (upstream since 2020) **and donut mode + legend position** (upstream v11.16.0), with a small-slice collision policy. (probe pie-15; upstream #1027/#7607/PR #7760)
4. **[Fix] [V] Palette degeneration at high slice counts** — same monochrome-ladder cause as Journey's actor dots; hue-spread ladder with a contrast check. (probe pie-15; code xychart/colors.ts:102-124)

### Quadrant

1. **[Fix→Feature(parity)] [V] Per-point styling/classDef parsed, validated, discarded;** `:::` knocks the agent body opaque. Fix: stop discarding silently (warn). Feature: render the styles (upstream merged PR #5173, documented). (code quadrant/parser.ts:38,72,103; agent quadrant-body.ts:95)
2. **[Fix] [V] Axis labels overprint into garble** — zero collision handling; budget each label to its half-plot with wrap/ellipsis. (probe quad-longaxis; code layout.ts:149-165)
3. **[Fix] [V] Scene-IR text geometry drift + blind fidelity oracle** — point-label semantic coordinates differ from drawn ones; the oracle checks only content/fontSize. Fix the oracle once (text x/y/anchor) and this class dies in every family. (code renderer.ts:209-227, scene/fidelity.ts:141-164)
4. **[Feature(beyond)] [V] Dense-cluster label placement** (leader lines / priority hiding / density-scaled plot; the plot is hardcoded 380px and all sizing config is ignored — fix the config half under C3). (probe quad-20; code layout.ts:24-39,111-146)

### Architecture

1. **[Fix] [V] Port semantics ignored in placement/routing** — edges cut through card interiors on upstream's own demo; per-edge sides are dropped at `architectureToMermaidGraph` and routing has no obstacle avoidance. Construction: sides become placement constraints; routes avoid node/group interiors; verify gains anchor-faces-partner tripwires. Deterministic side-respecting layout is also the differentiation story (upstream's fcose is nondeterministic by reputation). (probes p1/p2/p4/p7; code src/architecture/parser.ts:293; upstream #6024/#6166/#6194/#6432)
2. **[Fix] [V] `align row|column` (upstream v11.16.0) hard-errors** — current upstream grammar fails outright; the repo's own vendored reference documents it. (probe p8; upstream PR #7708)
3. **[Fix] [V] Six documented `architecture.*` config keys silently swallowed** (`nodeSeparation`, `idealEdgeLengthMultiplier`, `edgeElasticity`, `numIter`, `seed`, `randomize`) — wire the two with natural mappings, lint the rest. (probe p9; code src/architecture/config.ts:115)
4. **[Fix] [V] Agent surface can't touch junctions, group labels, or edges in place;** `{group}` edges and accTitle force whole-diagram opaque while the renderer handles them — renderer/agent drift. (code op-schema.ts:177, architecture-body.ts:37)
5. **[Feature(beyond)] [V] Iconify icons with a dignified fallback** — unknown icons currently degrade to a bare floating letter; bundled packs beat upstream in hosted contexts (top upstream demand cluster, ~170 reactions). Staged: badge the fallback + more built-ins (small), then offline iconify resolution. (probe p6; code renderer.ts:468; upstream #5950/#6109/#6019)
6. **[Feature(beyond)] [V] Spatial ASCII architecture** — current output is an indented outline with label-keyed (ambiguous) edge lists; nothing in the ecosystem renders architecture to text. (probe p1 unicode; snapshot testdata/unicode/architecture_group_boundary_edge.txt)

---

## Cross-cutting workstreams

- **X1 [Fix] Conformance suites for every family** (P3) — the single
  highest-leverage guard; would have caught eight verified bugs. Small
  effort per family; blocks nothing; land first. (fork/parent evidence:
  repo issue #36 established the pattern for flowchart)
- **X2 [Fix] CJK/fullwidth/emoji width correctness everywhere** — the most
  duplicated defect class across all three ecosystems (≥8 independent
  reports; four merged mermaid-ascii CJK PRs; the `edte` fork). Journey's
  grapheme-safe wrap module is the seed; adopt in flowchart/sequence/ER
  SVG measurement and all ASCII paths. (upstream mermaid#4151/#6607;
  mermaid-ascii#59; beautiful-mermaid#119/#121/#122)
- **X3 [Feature(beyond)] Width-constrained ASCII output** (`--target-width`,
  auto-fit, `<br/>` labels) — built independently by two forks
  (`pgavlin/mermaid-ascii`, open mermaid-ascii PR #47) because agents embed
  diagrams in fixed-width contexts. (fork: pgavlin; mermaid-ascii#47/#74)
- **X4 [Feature(beyond)] Stable element-identity contract in SVG**
  (`data-id`/`data-from`/`data-to`, `className` passthrough) — invented
  independently by three forks/embedders (martynovs, richardtallent PR #81,
  jgraph/draw.io); journey already carries `data-id`s — generalize and
  document as a contract. (fork: martynovs, richardtallent, jgraph)
- **X5 [Fix] Multi-diagram id hygiene for all families** — content-hashed
  marker/def ids (journey pattern) everywhere. (upstream #5741;
  beautiful-mermaid#133/#134/#96)
- **X6 [Feature(parity→beyond)] Accessibility** — aria/edge semantics from
  the typed graph model; WCAG-checked themes. (upstream #2395/#5632/#3691;
  beautiful-mermaid#115/PR #116)
- **X7 [Fix] Typed runtime-config sections + `INEFFECTIVE_CONFIG`** for the
  eight families lacking them (C3, mechanical).
- **X8 [Feature(beyond)] New families through the citizenship gate:
  mindmap and gitGraph first** — the strongest fork-graph signal (three
  independent forks each spent their largest effort on family expansion);
  the citizenship test guarantees any new family lands pre-enrolled in the
  quality loop. (fork: martynovs — 23 types; RokPre/mermaid-unicode;
  pgavlin — 22 types; upstream demand #4628/#1462/#1227)

## Phases

1. **Phase 0 — Honesty + guards (all Fix, small):** X1 conformance suites,
   X7 config lints, unknown-CLI-flag errors, quadrant fidelity-oracle fix.
   No behavior change beyond new diagnostics; every later phase is measured
   against these gates.
2. **Phase 1 — Silent-data-loss fixes:** the C1/C2 cluster (sequence
   block-keyword deletion + activations; class/ER serializer fidelity +
   phantom classes/aliases/keys; flowchart quoted labels + CJK ids;
   timeline colon drift; state phantom notes + `[H]` loss; xychart NaN/axis
   drops; architecture align + port routing). Each lands with its family
   parse core where the fix demands one (P1) and its conformance suite red
   first (P2).
3. **Phase 2 — Geometry + text truth:** sequence label budgeting and block
   insets, flowchart stub routes + wrapping, pie/quadrant label geometry,
   gantt label column, ASCII lane/label-cell reservation (flowchart, state,
   ER shared), PNG marker parity, X2 CJK adoption.
4. **Phase 3 — Parity features:** xychart legend, pie slice labels + donut,
   quadrant point styling, timeline vertical mode, gantt exclude shading,
   state pseudostates, class namespaces, ER direction, sequence
   autonumber/box/create-destroy, op-menu parity everywhere.
5. **Phase 4 — Signatures (beyond-parity):** gantt dependency/critical-path
   overlay, architecture icon + routing story, class cardinality collision
   pass, quadrant dense-cluster placement, X3 width-constrained ASCII,
   X4 identity contract, X8 mindmap + gitGraph.

### Phase 0 closure in PR #142

Phase 0 is complete under its original honesty-only boundary:

- **X1 conformance:** the shared all-family property registry generates 30
  structured diagrams per family. Each must serialize and re-enter both parsers;
  an inventory derived independently from the typed body is compared with the
  actual renderer parser's nodes/edges/groups (Flowchart and State explicitly
  invoke their legacy render parser), then agent facts, idempotence, and valid
  SVG are checked (`property-all-families-fuzz.test.ts`). Canonical discovery and corpus
  conservation remain additional enrollment guards (`cli-capabilities.test.ts`,
  `agent-mermaid-corpus.test.ts`).
- **Opaque honesty:** every family capable of whole-body fallback is enrolled
  in `opaque-unsupported-warning.test.ts`; each fixture now proves canonical
  source preservation, opaque reparse, and idempotent serialization, while
  valid unsupported fixtures also render through the public SVG path.
  Flowchart and Quadrant retain their more specific reasons.
- **X7 config:** State was the last missing family section. Ten fields with
  faithful ELK/measured-text equivalents now have discriminating geometry
  probes; nine legacy Dagre/fixed-metric fields, unsupported renderer values,
  invalid values, and unknown `state.*` keys emit qualified diagnostics.
  Explicit library config uses the same classifier and cannot disappear
  silently (`state-config.test.ts`, `unknown-config-wire-or-warn.test.ts`).
- **CLI and fidelity guards:** unknown or command-inapplicable flags fail with
  exit 2 (`cli-gantt-today-flag.test.ts`, `cli-flags-help-sync.test.ts`), and
  Scene-IR text fidelity checks content plus x/y/anchor
  (`scene-text-fidelity.test.ts`).

The original two State warning failures were author-reported during the first
Phase 0 pass; their raw red output was not committed. The final review preserved
stronger revert evidence in the PR description: disconnecting the State hook
fails 11 focused tests, while dropping an Architecture service from serialized
output fails the X1 property. The ledger gate checks all 72 ordinal work-plan
items against stable IDs, resolves exact `test`/`it` acceptance titles, and
allows a truthful prerequisite downgrade; it does not treat filename existence
or the word “Complete” as behavioral proof.

### Current phase status

| Phase | State | Evidence / remainder |
|---|---|---|
| 0 — honesty + guards | **Complete** | All-family canonical conformance enrollment, corpus faithfulness, universal opaque fallback diagnostics, typed wire-or-warn config including State, unknown-CLI-flag errors, and the scene text-geometry oracle are executable gates. More syntax-specific warnings are parity improvements, not honesty blockers, because every fallback is already lossless and announced. |
| 1 — silent-data-loss fixes | **Complete** | Shared parser grammars, serializer conformance, ordered preservation, and deterministic Architecture side/obstacle routing close every named C1/C2 and port-integrity item. |
| 2 — geometry + text truth | **Complete** | Shared grapheme/display-cell measurement, hard target width, dense-loop occupancy, label fitting, PNG coverage, and spatial State/Class/ER/Architecture terminal invariants are executable. |
| 3 — parity features | **Complete** | The named State/Class/ER residual syntax is typed, rendered, and editable; all existing family parity items and expanded op menus ship with source-preserved fallback only for genuinely unmodeled syntax. |
| 4 — signatures | **Complete** | Gantt overlays, Quadrant density, hard terminal width, SVG identity/reference and WCAG contracts, Architecture routing/icons, Class cardinality allocation, and full Mindmap/GitGraph citizenship all pass acceptance. |

Phase completion follows the executable exits above; focused green tests alone
do not override the full build/type/unit/E2E/website/tracker evidence. Mutation
configs and nightly lanes are reproducible adequacy tools, while the 2026-07-10
97–99% focused scores remain historical local measurements without retained
CI artifacts and are not used as phase-completion proof.

## Definition of done (every item)

1. Red test from the provenance fixture, confirmed red, then green, then
   revert-proofed; counts stated in the PR.
2. Any golden regeneration ships beside a new invariant gate and carries
   `[approve-goldens]`.
3. Duplication touched by the fix is extracted, not copied a fourth time.
4. Full suite + `tsc` + `website:check` + `bun run track` green; tracker
   baseline changes are deliberate and explained.
5. `good-pr` applied: repro steps, generated before/after evidence for
   visual changes, standalone description, honest risk notes.
