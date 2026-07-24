# Mermaid 11.16 family-fidelity audit

Status: complete for every family in the checked registry. Audited: 2026-07-10.

This document is a human-reviewed visual-metaphor and fidelity evidence ledger,
not a routing, capability, status, or roadmap authority. Registry-derived tests
check that every built-in has a row; machine capability states live in the
generated Section A capability report, and live work lives only in root
`TODO.md`.

This is the compatibility and visual-metaphor half of the diagram-family citizenship contract. The ordinary citizenship matrix proves that a family reaches every product surface; this audit proves that the thing reaching those surfaces still means and looks like that family.

## Claim boundary

**Documentation-complete** means every stable construct on the official Mermaid 11.16 syntax page is inventoried and has one of these executable outcomes:

1. modeled, canonically serializable, and rendered with its documented semantic effect;
2. preserved without loss and rendered through the family parser when typed editing is not applicable; or
3. deliberately made inert for security/offline determinism (for example JavaScript callbacks or network image fetching), with a named diagnostic and a regression test.

Parser acceptance alone does not count. Source preservation alone does not count when the construct claims a visible semantic effect. An implementation-derived golden does not count as its own oracle. The evidence combines pinned Mermaid examples/specs, independently authored semantic assertions, family geometry invariants, and renderer-generated artifacts.

**Visual-metaphor complete** does not mean pixel-identical to Mermaid. It means the output preserves the recognizable domain convention described by Mermaid and a domain reference such as Wikipedia: a Mindmap has a central idea and radiating hierarchy; a Gantt chart has a time axis and scheduled bars; a Sequence diagram has lifelines and chronological messages. Each row below names that hallmark and a screenshot reviewers can inspect.

## Audit result

| Family | Mermaid 11.16 syntax authority | Domain convention | Required visual signature | Executable evidence | Renderer evidence |
|---|---|---|---|---|---|
| Flowchart | [Mermaid Flowchart](https://mermaid.js.org/syntax/flowchart.html) | [Wikipedia: Flowchart](https://en.wikipedia.org/wiki/Flowchart) | Directed node-link topology, semantically distinct shapes, exposed endpoints and arrowheads. | `flowchart-parser-conformance.test.ts`, `flowchart-v11-shapes.test.ts`, `closing-the-gap.test.ts` | [`flowchart-v11-shapes-after.png`](./families/flowchart-v11-shapes-after.png) |
| State | [Mermaid State diagrams](https://mermaid.js.org/syntax/stateDiagram.html) | [Wikipedia: State diagram](https://en.wikipedia.org/wiki/State_diagram) | States and transitions with start/end, choice/history/fork/join, composite frames, notes and concurrency regions. | `state-pseudostates.test.ts`, `state-notes.test.ts`, `closing-the-gap.test.ts` | [`state-pseudostates-after.png`](./families/state-pseudostates-after.png) |
| Sequence | [Mermaid Sequence diagrams](https://mermaid.js.org/syntax/sequenceDiagram.html) | [Wikipedia: Sequence diagram](https://en.wikipedia.org/wiki/Sequence_diagram) | Participants above lifelines, chronological message arrows, activations, blocks, creation and destruction. | `sequence-parser.test.ts`, `sequence-layout.test.ts`, `closing-the-gap.test.ts` | [`sequence-parity-after.png`](./families/sequence-parity-after.png) |
| Timeline | [Mermaid Timeline](https://mermaid.js.org/syntax/timeline.html) | [Wikipedia: Timeline](https://en.wikipedia.org/wiki/Timeline) | Ordered chronology on a visible rail with periods, sections and event cards. | `timeline-parser.test.ts`, `timeline-layout.test.ts`, `closing-the-gap.test.ts` | [`timeline-vertical-after.png`](./families/timeline-vertical-after.png) |
| Class | [Mermaid Class diagrams](https://mermaid.js.org/syntax/classDiagram.html) | [Wikipedia: Class diagram](https://en.wikipedia.org/wiki/Class_diagram) | UML compartment boxes, annotations, namespaces, cardinalities and distinct relationship endpoint symbols. | `class-parser.test.ts`, `class-serializer-conformance.test.ts`, `closing-the-gap.test.ts` | [`class-namespaces-after.png`](./families/class-namespaces-after.png) |
| ER | [Mermaid ER diagrams](https://mermaid.js.org/syntax/entityRelationshipDiagram.html) | [Wikipedia: Entity–relationship model](https://en.wikipedia.org/wiki/Entity%E2%80%93relationship_model) | Entity/attribute boxes joined by identifying/non-identifying relationships with distinguishable crow’s-foot cardinalities and group containment. | `er-parser.test.ts`, `er-typed-segments.test.ts`, `closing-the-gap.test.ts` | [`er-direction-after.png`](./families/er-direction-after.png) |
| Journey | [Mermaid User Journey](https://mermaid.js.org/syntax/userJourney.html) | [Wikipedia: Customer experience](https://en.wikipedia.org/wiki/Customer_experience) | Ordered tasks grouped into sections, actor ownership and a visible satisfaction trajectory. | `journey-parse-core.test.ts`, `journey-layout-quality.test.ts`, `closing-the-gap.test.ts` | [`journey-section-overlap-after.png`](./families/journey-section-overlap-after.png) |
| Architecture | [Mermaid Architecture](https://mermaid.js.org/syntax/architecture.html) | [Wikipedia: Software architecture](https://en.wikipedia.org/wiki/Software_architecture) | Services, groups, junctions, icons and side-aware connections arranged as a bounded system map. | `architecture-parser.test.ts`, `architecture-layout.test.ts`, `closing-the-gap.test.ts` | [`architecture-align-after.png`](./families/architecture-align-after.png) |
| XY chart | [Mermaid XYChart](https://mermaid.js.org/syntax/xychart.html) | [Wikipedia: Statistical graphics](https://en.wikipedia.org/wiki/Statistical_graphics) | Measured Cartesian axes with bars/lines, series identity, legends and optional point labels in both orientations. | `xychart-parser.test.ts`, `xychart-renderer.test.ts`, `closing-the-gap.test.ts` | [`xychart-legend-after.png`](./families/xychart-legend-after.png) |
| Pie | [Mermaid Pie chart](https://mermaid.js.org/syntax/pie.html) | [Wikipedia: Pie chart](https://en.wikipedia.org/wiki/Pie_chart) | Radial part-to-whole slices or donut, proportional angles, labels/legend and static emphasis. | `pie-elevation.test.ts`, `pie.test.ts`, `closing-the-gap.test.ts` | [`pie-donut-labels-after.png`](./families/pie-donut-labels-after.png) |
| Quadrant | [Mermaid Quadrant chart](https://mermaid.js.org/syntax/quadrantChart.html) | [Wikipedia: Cartesian coordinate system](https://en.wikipedia.org/wiki/Cartesian_coordinate_system) | Two labeled axes divide four named regions; normalized points and leaders remain in the correct region without collisions. | `quadrant.test.ts`, `quadrant-style.test.ts`, `closing-the-gap.test.ts` | [`quadrant-styling-after.png`](./families/quadrant-styling-after.png) |
| Gantt | [Mermaid Gantt](https://mermaid.js.org/syntax/gantt.html) | [Wikipedia: Gantt chart](https://en.wikipedia.org/wiki/Gantt_chart) | Time-scaled task bars grouped by section with statuses, milestones, exclusions and dependency paths. | `gantt-upstream-bench.test.ts`, `gantt-dependency-overlay.test.ts`, `closing-the-gap.test.ts` | [`gantt-dependency-overlay-after.png`](./families/gantt-dependency-overlay-after.png) |
| Mindmap | [Mermaid Mindmap](https://mermaid.js.org/syntax/mindmap.html) | [Wikipedia: Mind map](https://en.wikipedia.org/wiki/Mind_map) | A central idea with deterministic bilateral/radial hierarchy, curved branches, authored node shapes and local pictograms; one-sided tidy-tree is explicit only. | `mindmap-gitgraph-doc-parity.test.ts`, `mindmap-gitgraph-upstream-oracle.test.ts`, `mindmap-gitgraph-content-corpus.test.ts`, `closing-the-gap.test.ts` | [`mindmap-content-gallery.png`](./families/mindmap-content-gallery.png) |
| GitGraph | [Mermaid GitGraph](https://mermaid.js.org/syntax/gitgraph.html) | [Wikipedia: Directed acyclic graph](https://en.wikipedia.org/wiki/Directed_acyclic_graph) | Source-ordered commit history on distinct branch lanes with merges, cherry-picks, tags and commit-type marks. | `mindmap-gitgraph-doc-parity.test.ts`, `mindmap-gitgraph-upstream-oracle.test.ts`, `mindmap-gitgraph-content-corpus.test.ts`, `closing-the-gap.test.ts` | [`gitgraph-content-gallery.png`](./families/gitgraph-content-gallery.png) |
| Radar | [Mermaid Radar](https://mermaid.js.org/syntax/radar.html) | [Wikipedia: Radar chart](https://en.wikipedia.org/wiki/Radar_chart) | Equi-angular spokes radiating from a shared center with one closed translucent area per entity, dot vertices on the data points, and radial axis labels; circle vs polygon graticule and smooth vs straight edges. | `radar-parser.test.ts`, `radar-integration.test.ts`, `radar-renderer.test.ts`, `agent-radar.test.ts`, `closing-the-gap.test.ts` | [`radar-demo.png`](./families/radar-demo.png) |
| Sankey | [Mermaid Sankey](https://mermaid.js.org/syntax/sankey.html) | [Wikipedia: Sankey diagram](https://en.wikipedia.org/wiki/Sankey_diagram) | Layered node columns joined by value-proportional ribbon links whose widths conserve flow between stages (conservation checked by the `FLOW_IMBALANCE` lint); node labels flip sides at the canvas midline, with justify/center/left/right alignment policies for sinks and orphans. Known domain divergences, deliberate and ledgered in `eval/mermaid-sankey-bench/harvest.json`: no return/recirculation flows (cycles reject loudly at parse, matching upstream Mermaid but not the broader Sankey tradition), left-to-right flow only, `gradient` ribbons render as a composited-visible midpoint blend (scene paint safety forbids `url()` gradients), and values display at full precision. | `sankey-parser.test.ts`, `sankey-integration.test.ts`, `sankey-renderer.test.ts`, `sankey-rubric-properties.test.ts`, `agent-sankey.test.ts`, `closing-the-gap.test.ts` | [`sankey-demo.png`](./families/sankey-demo.png) |

## Review rules carried forward

A future family cannot satisfy citizenship by adding a parser and a rectangle renderer. Before registration it must:

- pin the Mermaid syntax page/version and account for every documented construct;
- harvest upstream examples/tests and maintain an executable divergence ledger;
- state the family’s domain visual hallmark using Mermaid plus a Wikipedia/domain reference;
- add independent geometry/semantic assertions for that hallmark;
- commit a representative renderer artifact and place it in the PR’s captioned Visual Evidence table;
- demonstrate at least one discriminating red→green or revert probe;
- avoid claiming compatibility for syntax that is merely accepted, preserved, flattened or warned.

The checked enforcement lives in `diagram-family-citizenship.test.ts`, the two matrix surfaces `mermaidSyntaxParity` and `familyVisualMetaphor`, and the contributor definition of done in `adding-diagram-types.md`.
