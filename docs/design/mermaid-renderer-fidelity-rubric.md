# Secondary Mermaid visual-familiarity audit

Generated from `eval/mermaid-family-fidelity/rubric.ts` against the pinned Mermaid 11.16.0 package. Do not hand-edit this report.

## Claim boundary

This is a secondary migration/familiarity audit, not Agentic Mermaid's product objective. The primary contract is **Mermaid intent compatibility** in `docs/design/mermaid-intent-compatibility-rubric.md`: accept Mermaid syntax, preserve the author's facts, communicate the same relationships, and never lose unsupported intent silently. A different or improved layout is allowed.

This audit still separates visual familiarity from Agentic artifact quality. Internal Scene consistency, clean geometry, deterministic output, accessibility, or an attractive screenshot can raise artifact quality; none of those facts alone proves that the result looks like Mermaid. A 100 visual score requires same-engine or pinned differential evidence for every visual dimension, but no visual score overrides the intent contract.

Scores are evidence maturity, not aesthetic taste:

- **0** — Unknown or absent: no evidence establishes the behavior.
- **1** — Smoke-level: output exists, but the claim has no discriminating oracle.
- **2** — Metaphor-level: the family reads correctly, with known or unmeasured Mermaid differences.
- **3** — Upstream-informed: behavior is deliberately matched and independently asserted, but not continuously measured against Mermaid.
- **4** — Differentially proven: the same engine is used or a pinned Mermaid oracle measures agreement for this dimension.

The five familiarity dimensions are layout geometry, routing/topology, paint/style, labels/typography, and upstream differential evidence. The five quality dimensions are correctness coverage, robustness, determinism, semantics/accessibility, and configuration parity. Each axis is averaged and scaled to 100; the two axes are never blended, and neither is blended into intent compatibility.

## Cross-family result

| Family | Visual familiarity /100 | Artifact quality /100 | Library decision | Mermaid library provenance |
|---|---:|---:|---|---|
| flowchart | 70 | 95 | retain | dagre-d3-es (default graph layout); D3 selection/rendering utilities |
| state | 70 | 95 | retain | dagre-d3-es (default graph layout); D3 selection/rendering utilities |
| sequence | 70 | 95 | retain | D3 selection only; no external sequence layout engine |
| timeline | 60 | 95 | retain | D3 selection only; no external timeline layout engine |
| class | 70 | 95 | retain | dagre-d3-es (default graph layout); D3 selection/rendering utilities |
| er | 70 | 95 | retain | dagre-d3-es (default graph layout); D3 selection/rendering utilities |
| journey | 60 | 95 | retain | D3 selection and shape helpers; no external journey layout engine |
| architecture | 60 | 90 | evaluate | cytoscape 3.33.3; cytoscape-fcose 2.2.0; layout-base/cose-base |
| xychart | 65 | 95 | evaluate | D3 scaleLinear; D3 scaleBand; D3 line/selection |
| pie | 75 | 95 | evaluate | D3 pie; D3 arc; D3 scaleOrdinal |
| quadrant | 70 | 100 | retain | D3 scaleLinear |
| gantt | 75 | 100 | retain | dayjs; D3 scaleTime/axes/time intervals |
| mindmap | 65 | 95 | evaluate | cytoscape; cytoscape-cose-bilkent |
| gitgraph | 75 | 95 | retain | D3 selection only; no external GitGraph layout engine |
| radar | 75 | 100 | retain | No external layout engine; SVG selection helpers only |

## How to repeat the assessment

1. Keep Mermaid pinned and record its renderer source plus library imports from the installed source maps.
2. Use a construct-stratified corpus: minimal syntax, official examples, dense/long-label stress, every direction/alignment, styling, and degenerate values.
3. Enforce the separate intent-compatibility contract first, then compare normalized geometry, topology/routes, paint resources, and label bounds. Raster similarity is supplementary because fonts and antialiasing can hide or exaggerate structural differences.
4. Score only the evidence that is checked continuously. A golden produced by Agentic is not an upstream oracle.
5. Record Agentic robustness improvements separately when they intentionally diverge from Mermaid.
6. Re-run `bun run fidelity:families:check`; a new family, missing source evidence, stale generated report, invalid score, or empty action list must fail.

## Library-adoption summary

These are engineering candidates, not instructions to copy Mermaid. Adopt a library only when it improves semantic correctness or maintainability without weakening Agentic's intent, determinism, safety, and accessibility contracts.

- **Pending family enrollment:** Sankey is not a built-in on this base. Evaluate `d3-sankey` behind the typed Scene adapter when Sankey is enrolled; do not claim adoption from an unmerged implementation.
- **Evaluate behind an adapter/oracle:** Architecture (Cytoscape/fCOSE), Mindmap (Cytoscape/Cose-Bilkent), XY chart (D3 scales/shapes), and Pie (D3 pie/arc).
- **Retain custom/ELK:** Flowchart, State, Class, ER, Sequence, Timeline, Journey, Quadrant, Gantt, GitGraph, and Radar. These either have deliberate product contracts, use an equally custom upstream layout, or gain too little from swapping a primitive. Differential tests are still required.

## flowchart

Visual familiarity: **70/100**; artifact quality: **95/100**; dependency decision: **retain**.

Upstream engine: Registered graph renderer; Mermaid 11.16 defaults to Dagre and can select another registered layout.

Agentic engine: ELK layered layout plus Agentic routing, shape intersection, label packing, and Scene lowering.

Decision: Keep ELK as the product default: it is an intentional engine difference with strong routing contracts. Add Dagre as a pinned differential oracle before considering a compatibility mode.

| Visual dimension | Geometry | Routing/topology | Paint/style | Labels/type | Upstream differential |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 3 | 3 | 3 | 3 | 2 |

| Quality dimension | Correctness | Robustness | Determinism | Semantics/a11y | Config parity |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 4 | 4 | 4 | 4 | 3 |

Strengths:

- Broad shape and endpoint semantics; strong route-tripwire coverage.
- Deterministic Scene and terminal projections.

Known gaps:

- ELK node order, rank compaction, and spline/orthogonal routes are not Mermaid-Dagre geometry.
- No routine image/geometry differential against pinned Mermaid.

Next actions:

- Build a Mermaid-Dagre geometry corpus covering clusters, long labels, multiedges, self-loops, and four directions.
- Report geometry agreement separately from Agentic route-quality improvements.

Evidence:

- Mermaid 11.16 source map `node_modules/mermaid/dist/chunks/mermaid.esm.min/chunk-LUNKGL7L.mjs.map` → `src/diagrams/flowchart/flowRenderer-v3-unified.ts`
- Mermaid 11.16 source map `node_modules/mermaid/dist/chunks/mermaid.esm.min/dagre-QGBC2H2C.mjs.map` → `src/rendering-util/layout-algorithms/dagre/index.js`
- Agentic `src/layout-engine.ts`
- Agentic `src/renderer.ts`
- Agentic `src/__tests__/layout-rubric.test.ts`
- Agentic `src/__tests__/flowchart-v11-shapes.test.ts`

## state

Visual familiarity: **70/100**; artifact quality: **95/100**; dependency decision: **retain**.

Upstream engine: Unified graph renderer backed by the registered layout, normally Dagre.

Agentic engine: State-specific parse model projected through the ELK graph pipeline with pseudostate and composite post-processing.

Decision: Retain the ELK pipeline because composite-state containment and route contracts are already shared with flowchart; use Dagre for differential evidence, not an unmeasured engine swap.

| Visual dimension | Geometry | Routing/topology | Paint/style | Labels/type | Upstream differential |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 3 | 3 | 3 | 3 | 2 |

| Quality dimension | Correctness | Robustness | Determinism | Semantics/a11y | Config parity |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 4 | 4 | 4 | 4 | 3 |

Strengths:

- Explicit start/end, history, choice, fork/join, note, and composite-state semantics.
- Shared hard geometry invariants and accessibility projection.

Known gaps:

- Composite sizing and concurrency-region geometry can differ materially from Mermaid Dagre.
- No pinned visual oracle for pseudostate marker proportions and note placement.

Next actions:

- Add a construct-stratified Mermaid differential corpus, especially nested composites and concurrency.
- Measure marker, label, and compound-frame deltas independently.

Evidence:

- Mermaid 11.16 source map `node_modules/mermaid/dist/chunks/mermaid.esm.min/stateDiagram-v2-HCNZSXAK.mjs.map` → `src/diagrams/state/stateDiagram-v2.ts`
- Mermaid 11.16 source map `node_modules/mermaid/dist/chunks/mermaid.esm.min/dagre-QGBC2H2C.mjs.map` → `src/rendering-util/layout-algorithms/dagre/index.js`
- Agentic `src/state/parse-core.ts`
- Agentic `src/layout-engine.ts`
- Agentic `src/renderer.ts`
- Agentic `src/__tests__/state-pseudostates.test.ts`

## sequence

Visual familiarity: **70/100**; artifact quality: **95/100**; dependency decision: **retain**.

Upstream engine: Mermaid-owned temporal layout and SVG drawing; D3 is used primarily for selection.

Agentic engine: Deterministic custom temporal layout and renderer with typed fragments, activations, notes, and lifelines.

Decision: There is no upstream layout library to adopt. Improve parity through a pinned semantic/geometry differential corpus.

| Visual dimension | Geometry | Routing/topology | Paint/style | Labels/type | Upstream differential |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 3 | 3 | 3 | 3 | 2 |

| Quality dimension | Correctness | Robustness | Determinism | Semantics/a11y | Config parity |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 4 | 4 | 4 | 4 | 3 |

Strengths:

- Chronology, fragments, activations, actor lifecycle, and messages are modeled rather than flattened.
- Deterministic label measurement avoids browser-layout drift.

Known gaps:

- Actor spacing, fragment nesting dimensions, activation offsets, and note placement are not numerically compared with Mermaid.
- Font measurement differs from Mermaid browser DOM measurement.

Next actions:

- Harvest nested alt/par/critical/loop fixtures and compare lifeline x positions plus event-row y positions.
- Add visual review cases for create/destroy and overlapping activations.

Evidence:

- Mermaid 11.16 source map `node_modules/mermaid/dist/chunks/mermaid.esm.min/sequenceDiagram-ESAOAU5S.mjs.map` → `src/diagrams/sequence/sequenceRenderer.ts`
- Agentic `src/sequence/layout.ts`
- Agentic `src/sequence/renderer.ts`
- Agentic `src/__tests__/sequence-layout.test.ts`
- Agentic `src/__tests__/sequence-parser.test.ts`

## timeline

Visual familiarity: **60/100**; artifact quality: **95/100**; dependency decision: **retain**.

Upstream engine: Mermaid-owned block layout and SVG drawing; D3 selection only.

Agentic engine: Custom deterministic chronological rail, period/event cards, sections, and vertical/horizontal layouts.

Decision: Retain the custom engine; library adoption would not close the fidelity gap because upstream layout is also Mermaid-owned.

| Visual dimension | Geometry | Routing/topology | Paint/style | Labels/type | Upstream differential |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 2 | 3 | 2 | 3 | 2 |

| Quality dimension | Correctness | Robustness | Determinism | Semantics/a11y | Config parity |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 4 | 4 | 4 | 4 | 3 |

Strengths:

- Visible chronological rail and explicit section/event semantics.
- Measured cards and both orientations are robust under long content.

Known gaps:

- Agentic’s rail/card composition is a stronger domain metaphor but not Mermaid’s exact alternating block layout.
- Upstream gradient/theme behavior and browser text wrapping are not differential-tested.

Next actions:

- Separate “Mermaid compatibility view” fixtures from the enhanced vertical timeline view.
- Compare block ordering, card sizes, and section color assignment on official examples.

Evidence:

- Mermaid 11.16 source map `node_modules/mermaid/dist/chunks/mermaid.esm.min/timeline-definition-MJJPMYOD.mjs.map` → `src/diagrams/timeline/timelineRenderer.ts`
- Agentic `src/timeline/layout.ts`
- Agentic `src/timeline/renderer.ts`
- Agentic `src/__tests__/timeline-layout.test.ts`

## class

Visual familiarity: **70/100**; artifact quality: **95/100**; dependency decision: **retain**.

Upstream engine: Unified graph renderer using the registered layout, normally Dagre.

Agentic engine: ELK compound layout with UML compartments, namespace frames, notes, labels, and typed endpoint markers.

Decision: Retain ELK for namespaces and deterministic compound routing; add Dagre differential measurement for compatibility claims.

| Visual dimension | Geometry | Routing/topology | Paint/style | Labels/type | Upstream differential |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 3 | 3 | 3 | 3 | 2 |

| Quality dimension | Correctness | Robustness | Determinism | Semantics/a11y | Config parity |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 4 | 4 | 4 | 4 | 3 |

Strengths:

- Typed UML marker geometry, compartments, annotations, notes, and nested namespaces.
- Namespace containment and marker endpoint geometry have independent assertions.

Known gaps:

- ELK namespace packing and relationship bends differ from Mermaid Dagre.
- Compartment typography and marker proportions lack an upstream numerical oracle.

Next actions:

- Create a UML differential matrix by relation type, cardinality, namespace depth, direction, and note placement.
- Track compartment width/height and marker terminal deltas.

Evidence:

- Mermaid 11.16 source map `node_modules/mermaid/dist/chunks/mermaid.esm.min/classDiagram-v2-4NET3KXY.mjs.map` → `src/diagrams/class/classDiagram-v2.ts`
- Mermaid 11.16 source map `node_modules/mermaid/dist/chunks/mermaid.esm.min/dagre-QGBC2H2C.mjs.map` → `src/rendering-util/layout-algorithms/dagre/index.js`
- Agentic `src/class/layout.ts`
- Agentic `src/class/renderer.ts`
- Agentic `src/__tests__/class-marker-geometry.test.ts`
- Agentic `src/__tests__/class-namespace.test.ts`

## er

Visual familiarity: **70/100**; artifact quality: **95/100**; dependency decision: **retain**.

Upstream engine: Unified graph renderer using the registered layout, normally Dagre.

Agentic engine: ELK layered entity layout with typed crow’s-foot markers, attribute rows, groups, and labels.

Decision: Keep ELK and typed crow’s-foot semantics; use Dagre as a visual-parity oracle rather than replacing a working graph substrate.

| Visual dimension | Geometry | Routing/topology | Paint/style | Labels/type | Upstream differential |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 3 | 3 | 3 | 3 | 2 |

| Quality dimension | Correctness | Robustness | Determinism | Semantics/a11y | Config parity |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 4 | 4 | 4 | 4 | 3 |

Strengths:

- Cardinality semantics and terminal geometry are typed and inspectable.
- Entity labels, attributes, groups, and relationship styles have broad regression coverage.

Known gaps:

- Entity ordering, bend selection, and label placement differ with ELK.
- Neo/classic Mermaid marker styling is not scored as a separate parity dimension.

Next actions:

- Add cardinality-by-direction differential fixtures and terminal silhouette comparisons.
- Measure entity table geometry separately from routing.

Evidence:

- Mermaid 11.16 source map `node_modules/mermaid/dist/chunks/mermaid.esm.min/erDiagram-OQMWT43X.mjs.map` → `src/diagrams/er/erRenderer-unified.ts`
- Mermaid 11.16 source map `node_modules/mermaid/dist/chunks/mermaid.esm.min/dagre-QGBC2H2C.mjs.map` → `src/rendering-util/layout-algorithms/dagre/index.js`
- Agentic `src/er/layout.ts`
- Agentic `src/er/renderer.ts`
- Agentic `src/__tests__/er-typed-segments.test.ts`
- Agentic `src/__tests__/er-parser.test.ts`

## journey

Visual familiarity: **60/100**; artifact quality: **95/100**; dependency decision: **retain**.

Upstream engine: Mermaid-owned task/actor layout and SVG helpers; D3 selection plus icon arcs.

Agentic engine: Custom tiled-section layout with experience curve, score guide, actor dots, and deterministic labels.

Decision: Retain the custom engine: the current output intentionally elevates the satisfaction trajectory. Treat that as product quality, not proof of Mermaid visual parity.

| Visual dimension | Geometry | Routing/topology | Paint/style | Labels/type | Upstream differential |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 2 | 3 | 2 | 3 | 2 |

| Quality dimension | Correctness | Robustness | Determinism | Semantics/a11y | Config parity |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 4 | 4 | 4 | 4 | 3 |

Strengths:

- Satisfaction trajectory and actor ownership are visually explicit.
- Section tiling and curve geometry have independent quality assertions.

Known gaps:

- Agentic’s curve-first visual language is intentionally unlike Mermaid’s task blocks/faces.
- Actor legend wrapping and score icon geometry are not compared with browser output.

Next actions:

- Maintain explicit enhanced-vs-compatibility screenshots.
- Add official-example differential measures for task order, actor color assignment, and section widths.

Evidence:

- Mermaid 11.16 source map `node_modules/mermaid/dist/chunks/mermaid.esm.min/journeyDiagram-WII6DRMM.mjs.map` → `src/diagrams/user-journey/journeyRenderer.ts`
- Agentic `src/journey/layout.ts`
- Agentic `src/journey/renderer.ts`
- Agentic `src/__tests__/journey-layout-quality.test.ts`

## architecture

Visual familiarity: **60/100**; artifact quality: **90/100**; dependency decision: **evaluate**.

Upstream engine: Cytoscape graph with the fCOSE force-directed compound layout and alignment/relative-placement constraints.

Agentic engine: ELK compound layout followed by deterministic side/port, group, alignment, junction, and route post-passes.

Decision: Build an fCOSE differential oracle before adoption. A direct switch could improve Mermaid likeness but regress Agentic’s side-aware port and alignment contracts.

| Visual dimension | Geometry | Routing/topology | Paint/style | Labels/type | Upstream differential |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 2 | 2 | 3 | 3 | 2 |

| Quality dimension | Correctness | Robustness | Determinism | Semantics/a11y | Config parity |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 4 | 3 | 4 | 4 | 3 |

Strengths:

- Side-aware connections, junctions, nested groups, icons, and align hints are explicitly modeled.
- Agentic post-passes are deterministic and testable.

Known gaps:

- ELK and fCOSE produce visibly different topology, group compaction, and whitespace.
- The many post-passes raise interaction risk and make parity hard to reason about.

Next actions:

- Run fCOSE and ELK on the same typed graph, then score side validity, crossings, group containment, alignment, and displacement from Mermaid.
- Adopt fCOSE only if an adapter preserves port sides and beats ELK on a representative corpus.

Evidence:

- Mermaid 11.16 source map `node_modules/mermaid/dist/chunks/mermaid.esm.min/architectureDiagram-CXLCLZGG.mjs.map` → `src/diagrams/architecture/architectureRenderer.ts`
- Agentic `src/architecture/layout.ts`
- Agentic `src/architecture/align.ts`
- Agentic `src/architecture/renderer.ts`
- Agentic `src/__tests__/architecture-layout.test.ts`

## xychart

Visual familiarity: **65/100**; artifact quality: **95/100**; dependency decision: **evaluate**.

Upstream engine: Mermaid chart builder using D3 linear/band scales, tick generation, line paths, and selection.

Agentic engine: Custom deterministic scales, ticks, plot sizing, bars/lines, legends, and collision-aware labels.

Decision: Evaluate D3 scale and shape primitives behind the typed chart builder. They can close tick and line-path parity without surrendering Agentic canvas/label robustness.

| Visual dimension | Geometry | Routing/topology | Paint/style | Labels/type | Upstream differential |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 2 | 4 | 3 | 2 | 2 |

| Quality dimension | Correctness | Robustness | Determinism | Semantics/a11y | Config parity |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 4 | 4 | 4 | 4 | 3 |

Strengths:

- Both orientations, multiple series, legends, measured axes, and point labels are deterministic.
- Cartesian semantics and exact data values remain typed.

Known gaps:

- Custom nice-tick and band calculations can disagree with D3 on domains, tick counts, and padding.
- Canvas budgeting and text measurement differ from Mermaid’s builder/browser measurements.

Next actions:

- Add D3 scale differential tests for adversarial domains, reversed ranges, decimals, and sparse dates.
- Consider adopting d3-scale/d3-shape primitives while retaining Agentic’s layout shell.

Evidence:

- Mermaid 11.16 source map `node_modules/mermaid/dist/chunks/mermaid.esm.min/xychartDiagram-R6JRNRHN.mjs.map` → `src/diagrams/xychart/chartBuilder/components/axis/linearAxis.ts`
- Agentic `src/xychart/layout.ts`
- Agentic `src/xychart/axis-utils.ts`
- Agentic `src/xychart/renderer.ts`
- Agentic `src/__tests__/xychart-renderer.test.ts`

## pie

Visual familiarity: **75/100**; artifact quality: **95/100**; dependency decision: **evaluate**.

Upstream engine: D3 pie/arc generators and ordinal scale, with Mermaid-owned legend and label composition.

Agentic engine: Custom trigonometric arc paths, measured legend layout, collision-aware slice labels, donut and highlight extensions.

Decision: Evaluate d3-shape for angle and path generation. Keep Agentic label collision handling and extensions; explicitly decide whether Mermaid’s <1% slice filtering is compatibility or data loss.

| Visual dimension | Geometry | Routing/topology | Paint/style | Labels/type | Upstream differential |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 3 | 4 | 3 | 3 | 2 |

| Quality dimension | Correctness | Robustness | Determinism | Semantics/a11y | Config parity |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 4 | 4 | 4 | 4 | 3 |

Strengths:

- Proportional arcs, full-circle handling, donut mode, label fitting, and static emphasis are independently tested.
- Legend sizing and label suppression are robust under dense data.

Known gaps:

- Mermaid filters slices below 1%; Agentic retains them, so geometry and legend totals can diverge.
- Hand-built SVG path formatting will not byte/point match d3-arc.

Next actions:

- Add a declared compatibility policy and tests for sub-1% slices.
- Run d3-pie/d3-arc as a geometry oracle and adopt if it simplifies edge cases without losing extensions.

Evidence:

- Mermaid 11.16 source map `node_modules/mermaid/dist/chunks/mermaid.esm.min/pieDiagram-OG5FZAAG.mjs.map` → `src/diagrams/pie/pieRenderer.ts`
- Agentic `src/pie/layout.ts`
- Agentic `src/pie/renderer.ts`
- Agentic `src/__tests__/pie.test.ts`
- Agentic `src/__tests__/pie-elevation.test.ts`

## quadrant

Visual familiarity: **70/100**; artifact quality: **100/100**; dependency decision: **retain**.

Upstream engine: Mermaid-owned chart builder using D3 linear scales for normalized coordinates.

Agentic engine: Custom normalized transforms with density-scaled plot, label wrapping, spiral collision avoidance, and leaders.

Decision: Retain the custom engine. Replacing a two-point affine transform with d3-scale has little payoff; use D3 only as a tiny differential oracle.

| Visual dimension | Geometry | Routing/topology | Paint/style | Labels/type | Upstream differential |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 3 | 4 | 3 | 2 | 2 |

| Quality dimension | Correctness | Robustness | Determinism | Semantics/a11y | Config parity |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 4 | 4 | 4 | 4 | 4 |

Strengths:

- Correct normalized coordinate semantics and quadrant numbering.
- Collision-aware labels/leaders materially exceed upstream robustness for dense points.

Known gaps:

- Density scaling, wrapping, and displaced labels intentionally differ from Mermaid.
- Point-label placement has no browser visual differential.

Next actions:

- Use D3 scaleLinear as a unit-level coordinate oracle.
- Keep parity and enhanced label-placement scores separate.

Evidence:

- Mermaid 11.16 source map `node_modules/mermaid/dist/chunks/mermaid.esm.min/quadrantDiagram-QALJNKXI.mjs.map` → `src/diagrams/quadrant-chart/quadrantBuilder.ts`
- Agentic `src/quadrant/layout.ts`
- Agentic `src/quadrant/renderer.ts`
- Agentic `src/__tests__/quadrant.test.ts`
- Agentic `src/__tests__/quadrant-style.test.ts`

## gantt

Visual familiarity: **75/100**; artifact quality: **100/100**; dependency decision: **retain**.

Upstream engine: Mermaid-owned scheduler/renderer using dayjs plus D3 time scales, axes, intervals, formatting, and selection.

Agentic engine: Custom UTC scheduler and deterministic time-axis/bar layout with dependency and critical-path overlays.

Decision: Retain the UTC scheduler for offline determinism and explicit calendar semantics. Use dayjs/D3 as differential oracles for parsing and ticks, not as blanket replacements.

| Visual dimension | Geometry | Routing/topology | Paint/style | Labels/type | Upstream differential |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 3 | 3 | 3 | 3 | 3 |

| Quality dimension | Correctness | Robustness | Determinism | Semantics/a11y | Config parity |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 4 | 4 | 4 | 4 | 4 |

Strengths:

- Pinned upstream corpus already covers many schedule semantics.
- No wall-clock dependency; today marker is explicit; overlays add inspectable dependency meaning.

Known gaps:

- Tick choice, time formatting, and browser-measured label geometry can differ from D3.
- Dependency overlays are Agentic extensions and must not inflate Mermaid parity scoring.

Next actions:

- Extend the upstream bench from schedule facts to axis tick/date-label geometry.
- Keep UTC determinism as a non-negotiable artifact-quality criterion.

Evidence:

- Mermaid 11.16 source map `node_modules/mermaid/dist/chunks/mermaid.esm.min/ganttDiagram-65O4CIDK.mjs.map` → `src/diagrams/gantt/ganttRenderer.js`
- Agentic `src/gantt/schedule.ts`
- Agentic `src/gantt/layout.ts`
- Agentic `src/gantt/renderer.ts`
- Agentic `src/__tests__/gantt-upstream-bench.test.ts`

## mindmap

Visual familiarity: **65/100**; artifact quality: **95/100**; dependency decision: **evaluate**.

Upstream engine: Registered graph renderer defaulting to Cytoscape Cose-Bilkent for mindmaps.

Agentic engine: Custom deterministic bilateral/radial hierarchy with tidy-tree option, curved branches, shapes, and icons.

Decision: Evaluate Cose-Bilkent as a Mermaid-compatibility oracle or optional mode. Do not replace the deterministic bilateral signature without comparative evidence.

| Visual dimension | Geometry | Routing/topology | Paint/style | Labels/type | Upstream differential |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 2 | 2 | 3 | 3 | 3 |

| Quality dimension | Correctness | Robustness | Determinism | Semantics/a11y | Config parity |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 4 | 4 | 4 | 4 | 3 |

Strengths:

- Deterministic central/bilateral hierarchy and authored shape/icon support.
- Existing upstream content corpus exercises syntax and semantics.

Known gaps:

- Force-directed Cose geometry is fundamentally different from tidy bilateral placement.
- Upstream depth-weighted edge widths and theme gradients need explicit visual comparison.

Next actions:

- Run Cose-Bilkent as a pinned oracle on the existing content corpus and quantify radial balance, crossings, depth spacing, and displacement.
- Offer a compatibility mode only if determinism can be controlled and packaged safely.

Evidence:

- Mermaid 11.16 source map `node_modules/mermaid/dist/chunks/mermaid.esm.min/mindmap-definition-GVBGAMR2.mjs.map` → `src/diagrams/mindmap/mindmapRenderer.ts`
- Agentic `src/mindmap/layout.ts`
- Agentic `src/mindmap/position.ts`
- Agentic `src/mindmap/renderer.ts`
- Agentic `src/__tests__/mindmap-gitgraph-upstream-oracle.test.ts`

## gitgraph

Visual familiarity: **75/100**; artifact quality: **95/100**; dependency decision: **retain**.

Upstream engine: Mermaid-owned lane/commit geometry; D3 is used for selection, not layout.

Agentic engine: Custom deterministic branch-lane, commit, merge, cherry-pick, tag, and orientation layout.

Decision: No upstream layout library exists to adopt. Close gaps with source-order and geometry differentials.

| Visual dimension | Geometry | Routing/topology | Paint/style | Labels/type | Upstream differential |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 3 | 3 | 3 | 3 | 3 |

| Quality dimension | Correctness | Robustness | Determinism | Semantics/a11y | Config parity |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 4 | 4 | 4 | 4 | 3 |

Strengths:

- Source-ordered commits, branch lanes, merge/cherry-pick identity, tags, and mark types are explicit.
- Content corpus and upstream oracle already provide stronger evidence than most families.

Known gaps:

- Lane offsets, label rotation/backgrounds, and theme-specific commit geometry are not fully measured.
- Enhanced labels may differ from Mermaid even when history topology matches.

Next actions:

- Extend the existing oracle to lane coordinates, commit centers, and merge path bends.
- Score topology independently from label/background polish.

Evidence:

- Mermaid 11.16 source map `node_modules/mermaid/dist/chunks/mermaid.esm.min/gitGraphDiagram-7AKFKS3M.mjs.map` → `src/diagrams/git/gitGraphRenderer.ts`
- Agentic `src/gitgraph/layout.ts`
- Agentic `src/gitgraph/position.ts`
- Agentic `src/gitgraph/renderer.ts`
- Agentic `src/__tests__/mindmap-gitgraph-upstream-oracle.test.ts`

## radar

Visual familiarity: **75/100**; artifact quality: **100/100**; dependency decision: **retain**.

Upstream engine: Mermaid-owned polar math, curve interpolation, legend, axes, and graticule rendering.

Agentic engine: Custom deterministic polar geometry, polygon/circle graticules, straight/smoothed curves, dots, ticks, labels, and legend.

Decision: Retain the custom math. The right next step is a polar-coordinate/path differential, not dependency adoption.

| Visual dimension | Geometry | Routing/topology | Paint/style | Labels/type | Upstream differential |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 3 | 4 | 3 | 3 | 2 |

| Quality dimension | Correctness | Robustness | Determinism | Semantics/a11y | Config parity |
|---|---:|---:|---:|---:|---:|
| Score (0–4) | 4 | 4 | 4 | 4 | 4 |

Strengths:

- Axes, min/max scaling, graticules, curve modes, dots, legends, and labels are typed and deterministic.
- Polar semantics are simple enough for strong independent invariants.

Known gaps:

- Smooth path interpolation and label/legend spacing are not compared with Mermaid output.
- No image or path-command differential exists.

Next actions:

- Compare polar vertex coordinates exactly and smoothed paths by sampling.
- Add legend/axis-label bounding-box comparison on long multilingual labels.

Evidence:

- Mermaid 11.16 source map `node_modules/mermaid/dist/chunks/mermaid.esm.min/diagram-5YXONRP5.mjs.map` → `src/diagrams/radar/renderer.ts`
- Agentic `src/radar/layout.ts`
- Agentic `src/radar/scale.ts`
- Agentic `src/radar/renderer.ts`
- Agentic `src/__tests__/radar-renderer.test.ts`
