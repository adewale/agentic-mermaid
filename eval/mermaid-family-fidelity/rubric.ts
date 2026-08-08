import type { BuiltinFamilyId } from '../../src/agent/families.ts'

export const FIDELITY_SCORE_SCALE = {
  0: 'Unknown or absent: no evidence establishes the behavior.',
  1: 'Smoke-level: output exists, but the claim has no discriminating oracle.',
  2: 'Metaphor-level: the family reads correctly, with known or unmeasured Mermaid differences.',
  3: 'Upstream-informed: behavior is deliberately matched and independently asserted, but not continuously measured against Mermaid.',
  4: 'Differentially proven: the same engine is used or a pinned Mermaid oracle measures agreement for this dimension.',
} as const

export type FidelityScore = keyof typeof FIDELITY_SCORE_SCALE
export type DependencyDecision = 'adopt' | 'evaluate' | 'retain'

export interface UpstreamSourceEvidence {
  sourceMap: string
  source: string
  tokens: readonly string[]
}

export interface FamilyFidelityScores {
  visual: {
    layoutGeometry: FidelityScore
    routingTopology: FidelityScore
    paintStyling: FidelityScore
    labelsTypography: FidelityScore
    upstreamDifferential: FidelityScore
  }
  quality: {
    correctnessCoverage: FidelityScore
    robustness: FidelityScore
    determinism: FidelityScore
    semanticsAccessibility: FidelityScore
    configurationParity: FidelityScore
  }
}

export interface FamilyFidelityAssessment {
  id: BuiltinFamilyId
  upstreamEngine: string
  agenticEngine: string
  upstreamLibraries: readonly string[]
  dependencyDecision: DependencyDecision
  decision: string
  upstreamEvidence: readonly UpstreamSourceEvidence[]
  agenticEvidence: readonly string[]
  scores: FamilyFidelityScores
  strengths: readonly string[]
  gaps: readonly string[]
  actions: readonly string[]
}

const dagreEvidence: UpstreamSourceEvidence = {
  sourceMap: 'node_modules/mermaid/dist/chunks/mermaid.esm.min/dagre-QGBC2H2C.mjs.map',
  source: 'src/rendering-util/layout-algorithms/dagre/index.js',
  tokens: ["dagreLayout", "dagre-d3-es/src/dagre/index.js"],
}

export const MERMAID_FAMILY_FIDELITY_ASSESSMENTS = [
  {
    id: 'flowchart',
    upstreamEngine: 'Registered graph renderer; Mermaid 11.16 defaults to Dagre and can select another registered layout.',
    agenticEngine: 'ELK layered layout plus Agentic routing, shape intersection, label packing, and Scene lowering.',
    upstreamLibraries: ['dagre-d3-es (default graph layout)', 'D3 selection/rendering utilities'],
    dependencyDecision: 'retain',
    decision: 'Keep ELK as the product default: it is an intentional engine difference with strong routing contracts. Add Dagre as a pinned differential oracle before considering a compatibility mode.',
    upstreamEvidence: [
      { sourceMap: 'node_modules/mermaid/dist/chunks/mermaid.esm.min/chunk-LUNKGL7L.mjs.map', source: 'src/diagrams/flowchart/flowRenderer-v3-unified.ts', tokens: ['getRegisteredLayoutAlgorithm', 'data4Layout.layoutAlgorithm'] },
      dagreEvidence,
    ],
    agenticEvidence: ['src/layout-engine.ts', 'src/renderer.ts', 'src/__tests__/layout-rubric.test.ts', 'src/__tests__/flowchart-v11-shapes.test.ts'],
    scores: { visual: { layoutGeometry: 3, routingTopology: 3, paintStyling: 3, labelsTypography: 3, upstreamDifferential: 2 }, quality: { correctnessCoverage: 4, robustness: 4, determinism: 4, semanticsAccessibility: 4, configurationParity: 3 } },
    strengths: ['Broad shape and endpoint semantics; strong route-tripwire coverage.', 'Deterministic Scene and terminal projections.'],
    gaps: ['ELK node order, rank compaction, and spline/orthogonal routes are not Mermaid-Dagre geometry.', 'No routine image/geometry differential against pinned Mermaid.'],
    actions: ['Build a Mermaid-Dagre geometry corpus covering clusters, long labels, multiedges, self-loops, and four directions.', 'Report geometry agreement separately from Agentic route-quality improvements.'],
  },
  {
    id: 'state',
    upstreamEngine: 'Unified graph renderer backed by the registered layout, normally Dagre.',
    agenticEngine: 'State-specific parse model projected through the ELK graph pipeline with pseudostate and composite post-processing.',
    upstreamLibraries: ['dagre-d3-es (default graph layout)', 'D3 selection/rendering utilities'],
    dependencyDecision: 'retain',
    decision: 'Retain the ELK pipeline because composite-state containment and route contracts are already shared with flowchart; use Dagre for differential evidence, not an unmeasured engine swap.',
    upstreamEvidence: [
      { sourceMap: 'node_modules/mermaid/dist/chunks/mermaid.esm.min/stateDiagram-v2-HCNZSXAK.mjs.map', source: 'src/diagrams/state/stateDiagram-v2.ts', tokens: ['stateRenderer-v3-unified', 'new StateDB(2)'] },
      dagreEvidence,
    ],
    agenticEvidence: ['src/state/parse-core.ts', 'src/layout-engine.ts', 'src/renderer.ts', 'src/__tests__/state-pseudostates.test.ts'],
    scores: { visual: { layoutGeometry: 3, routingTopology: 3, paintStyling: 3, labelsTypography: 3, upstreamDifferential: 2 }, quality: { correctnessCoverage: 4, robustness: 4, determinism: 4, semanticsAccessibility: 4, configurationParity: 3 } },
    strengths: ['Explicit start/end, history, choice, fork/join, note, and composite-state semantics.', 'Shared hard geometry invariants and accessibility projection.'],
    gaps: ['Composite sizing and concurrency-region geometry can differ materially from Mermaid Dagre.', 'No pinned visual oracle for pseudostate marker proportions and note placement.'],
    actions: ['Add a construct-stratified Mermaid differential corpus, especially nested composites and concurrency.', 'Measure marker, label, and compound-frame deltas independently.'],
  },
  {
    id: 'sequence',
    upstreamEngine: 'Mermaid-owned temporal layout and SVG drawing; D3 is used primarily for selection.',
    agenticEngine: 'Deterministic custom temporal layout and renderer with typed fragments, activations, notes, and lifelines.',
    upstreamLibraries: ['D3 selection only; no external sequence layout engine'],
    dependencyDecision: 'retain',
    decision: 'There is no upstream layout library to adopt. Improve parity through a pinned semantic/geometry differential corpus.',
    upstreamEvidence: [{ sourceMap: 'node_modules/mermaid/dist/chunks/mermaid.esm.min/sequenceDiagram-ESAOAU5S.mjs.map', source: 'src/diagrams/sequence/sequenceRenderer.ts', tokens: ["import { select } from 'd3'", 'sequenceItems'] }],
    agenticEvidence: ['src/sequence/layout.ts', 'src/sequence/renderer.ts', 'src/__tests__/sequence-layout.test.ts', 'src/__tests__/sequence-parser.test.ts'],
    scores: { visual: { layoutGeometry: 3, routingTopology: 3, paintStyling: 3, labelsTypography: 3, upstreamDifferential: 2 }, quality: { correctnessCoverage: 4, robustness: 4, determinism: 4, semanticsAccessibility: 4, configurationParity: 3 } },
    strengths: ['Chronology, fragments, activations, actor lifecycle, and messages are modeled rather than flattened.', 'Deterministic label measurement avoids browser-layout drift.'],
    gaps: ['Actor spacing, fragment nesting dimensions, activation offsets, and note placement are not numerically compared with Mermaid.', 'Font measurement differs from Mermaid browser DOM measurement.'],
    actions: ['Harvest nested alt/par/critical/loop fixtures and compare lifeline x positions plus event-row y positions.', 'Add visual review cases for create/destroy and overlapping activations.'],
  },
  {
    id: 'timeline',
    upstreamEngine: 'Mermaid-owned block layout and SVG drawing; D3 selection only.',
    agenticEngine: 'Custom deterministic chronological rail, period/event cards, sections, and vertical/horizontal layouts.',
    upstreamLibraries: ['D3 selection only; no external timeline layout engine'],
    dependencyDecision: 'retain',
    decision: 'Retain the custom engine; library adoption would not close the fidelity gap because upstream layout is also Mermaid-owned.',
    upstreamEvidence: [{ sourceMap: 'node_modules/mermaid/dist/chunks/mermaid.esm.min/timeline-definition-MJJPMYOD.mjs.map', source: 'src/diagrams/timeline/timelineRenderer.ts', tokens: ["import { select } from 'd3'", 'TimelineTask'] }],
    agenticEvidence: ['src/timeline/layout.ts', 'src/timeline/renderer.ts', 'src/__tests__/timeline-layout.test.ts'],
    scores: { visual: { layoutGeometry: 2, routingTopology: 3, paintStyling: 2, labelsTypography: 3, upstreamDifferential: 2 }, quality: { correctnessCoverage: 4, robustness: 4, determinism: 4, semanticsAccessibility: 4, configurationParity: 3 } },
    strengths: ['Visible chronological rail and explicit section/event semantics.', 'Measured cards and both orientations are robust under long content.'],
    gaps: ['Agentic’s rail/card composition is a stronger domain metaphor but not Mermaid’s exact alternating block layout.', 'Upstream gradient/theme behavior and browser text wrapping are not differential-tested.'],
    actions: ['Separate “Mermaid compatibility view” fixtures from the enhanced vertical timeline view.', 'Compare block ordering, card sizes, and section color assignment on official examples.'],
  },
  {
    id: 'class',
    upstreamEngine: 'Unified graph renderer using the registered layout, normally Dagre.',
    agenticEngine: 'ELK compound layout with UML compartments, namespace frames, notes, labels, and typed endpoint markers.',
    upstreamLibraries: ['dagre-d3-es (default graph layout)', 'D3 selection/rendering utilities'],
    dependencyDecision: 'retain',
    decision: 'Retain ELK for namespaces and deterministic compound routing; add Dagre differential measurement for compatibility claims.',
    upstreamEvidence: [
      { sourceMap: 'node_modules/mermaid/dist/chunks/mermaid.esm.min/classDiagram-v2-4NET3KXY.mjs.map', source: 'src/diagrams/class/classDiagram-v2.ts', tokens: ['classRenderer-v3-unified', 'new ClassDB()'] },
      dagreEvidence,
    ],
    agenticEvidence: ['src/class/layout.ts', 'src/class/renderer.ts', 'src/__tests__/class-marker-geometry.test.ts', 'src/__tests__/class-namespace.test.ts'],
    scores: { visual: { layoutGeometry: 3, routingTopology: 3, paintStyling: 3, labelsTypography: 3, upstreamDifferential: 2 }, quality: { correctnessCoverage: 4, robustness: 4, determinism: 4, semanticsAccessibility: 4, configurationParity: 3 } },
    strengths: ['Typed UML marker geometry, compartments, annotations, notes, and nested namespaces.', 'Namespace containment and marker endpoint geometry have independent assertions.'],
    gaps: ['ELK namespace packing and relationship bends differ from Mermaid Dagre.', 'Compartment typography and marker proportions lack an upstream numerical oracle.'],
    actions: ['Create a UML differential matrix by relation type, cardinality, namespace depth, direction, and note placement.', 'Track compartment width/height and marker terminal deltas.'],
  },
  {
    id: 'er',
    upstreamEngine: 'Unified graph renderer using the registered layout, normally Dagre.',
    agenticEngine: 'ELK layered entity layout with typed crow’s-foot markers, attribute rows, groups, and labels.',
    upstreamLibraries: ['dagre-d3-es (default graph layout)', 'D3 selection/rendering utilities'],
    dependencyDecision: 'retain',
    decision: 'Keep ELK and typed crow’s-foot semantics; use Dagre as a visual-parity oracle rather than replacing a working graph substrate.',
    upstreamEvidence: [
      { sourceMap: 'node_modules/mermaid/dist/chunks/mermaid.esm.min/erDiagram-OQMWT43X.mjs.map', source: 'src/diagrams/er/erRenderer-unified.ts', tokens: ['getRegisteredLayoutAlgorithm', "select } from 'd3'"] },
      dagreEvidence,
    ],
    agenticEvidence: ['src/er/layout.ts', 'src/er/renderer.ts', 'src/__tests__/er-typed-segments.test.ts', 'src/__tests__/er-parser.test.ts'],
    scores: { visual: { layoutGeometry: 3, routingTopology: 3, paintStyling: 3, labelsTypography: 3, upstreamDifferential: 2 }, quality: { correctnessCoverage: 4, robustness: 4, determinism: 4, semanticsAccessibility: 4, configurationParity: 3 } },
    strengths: ['Cardinality semantics and terminal geometry are typed and inspectable.', 'Entity labels, attributes, groups, and relationship styles have broad regression coverage.'],
    gaps: ['Entity ordering, bend selection, and label placement differ with ELK.', 'Neo/classic Mermaid marker styling is not scored as a separate parity dimension.'],
    actions: ['Add cardinality-by-direction differential fixtures and terminal silhouette comparisons.', 'Measure entity table geometry separately from routing.'],
  },
  {
    id: 'journey',
    upstreamEngine: 'Mermaid-owned task/actor layout and SVG helpers; D3 selection plus icon arcs.',
    agenticEngine: 'Custom tiled-section layout with experience curve, score guide, actor dots, and deterministic labels.',
    upstreamLibraries: ['D3 selection and shape helpers; no external journey layout engine'],
    dependencyDecision: 'retain',
    decision: 'Retain the custom engine: the current output intentionally elevates the satisfaction trajectory. Treat that as product quality, not proof of Mermaid visual parity.',
    upstreamEvidence: [{ sourceMap: 'node_modules/mermaid/dist/chunks/mermaid.esm.min/journeyDiagram-WII6DRMM.mjs.map', source: 'src/diagrams/user-journey/journeyRenderer.ts', tokens: ["import { select } from 'd3'", 'drawActorLegend'] }],
    agenticEvidence: ['src/journey/layout.ts', 'src/journey/renderer.ts', 'src/__tests__/journey-layout-quality.test.ts'],
    scores: { visual: { layoutGeometry: 2, routingTopology: 3, paintStyling: 2, labelsTypography: 3, upstreamDifferential: 2 }, quality: { correctnessCoverage: 4, robustness: 4, determinism: 4, semanticsAccessibility: 4, configurationParity: 3 } },
    strengths: ['Satisfaction trajectory and actor ownership are visually explicit.', 'Section tiling and curve geometry have independent quality assertions.'],
    gaps: ['Agentic’s curve-first visual language is intentionally unlike Mermaid’s task blocks/faces.', 'Actor legend wrapping and score icon geometry are not compared with browser output.'],
    actions: ['Maintain explicit enhanced-vs-compatibility screenshots.', 'Add official-example differential measures for task order, actor color assignment, and section widths.'],
  },
  {
    id: 'architecture',
    upstreamEngine: 'Cytoscape graph with the fCOSE force-directed compound layout and alignment/relative-placement constraints.',
    agenticEngine: 'ELK compound layout followed by deterministic side/port, group, alignment, junction, and route post-passes.',
    upstreamLibraries: ['cytoscape 3.33.3', 'cytoscape-fcose 2.2.0', 'layout-base/cose-base'],
    dependencyDecision: 'evaluate',
    decision: 'Build an fCOSE differential oracle before adoption. A direct switch could improve Mermaid likeness but regress Agentic’s side-aware port and alignment contracts.',
    upstreamEvidence: [{ sourceMap: 'node_modules/mermaid/dist/chunks/mermaid.esm.min/architectureDiagram-CXLCLZGG.mjs.map', source: 'src/diagrams/architecture/architectureRenderer.ts', tokens: ["import cytoscape from 'cytoscape'", "import fcose from 'cytoscape-fcose'", 'relativePlacementConstraint'] }],
    agenticEvidence: ['src/architecture/layout.ts', 'src/architecture/align.ts', 'src/architecture/renderer.ts', 'src/__tests__/architecture-layout.test.ts'],
    scores: { visual: { layoutGeometry: 2, routingTopology: 2, paintStyling: 3, labelsTypography: 3, upstreamDifferential: 2 }, quality: { correctnessCoverage: 4, robustness: 3, determinism: 4, semanticsAccessibility: 4, configurationParity: 3 } },
    strengths: ['Side-aware connections, junctions, nested groups, icons, and align hints are explicitly modeled.', 'Agentic post-passes are deterministic and testable.'],
    gaps: ['ELK and fCOSE produce visibly different topology, group compaction, and whitespace.', 'The many post-passes raise interaction risk and make parity hard to reason about.'],
    actions: ['Run fCOSE and ELK on the same typed graph, then score side validity, crossings, group containment, alignment, and displacement from Mermaid.', 'Adopt fCOSE only if an adapter preserves port sides and beats ELK on a representative corpus.'],
  },
  {
    id: 'xychart',
    upstreamEngine: 'Mermaid chart builder using D3 linear/band scales, tick generation, line paths, and selection.',
    agenticEngine: 'Custom deterministic scales, ticks, plot sizing, bars/lines, legends, and collision-aware labels.',
    upstreamLibraries: ['D3 scaleLinear', 'D3 scaleBand', 'D3 line/selection'],
    dependencyDecision: 'evaluate',
    decision: 'Evaluate D3 scale and shape primitives behind the typed chart builder. They can close tick and line-path parity without surrendering Agentic canvas/label robustness.',
    upstreamEvidence: [{ sourceMap: 'node_modules/mermaid/dist/chunks/mermaid.esm.min/xychartDiagram-R6JRNRHN.mjs.map', source: 'src/diagrams/xychart/chartBuilder/components/axis/linearAxis.ts', tokens: ["scaleLinear } from 'd3'", 'this.scale.ticks()'] }],
    agenticEvidence: ['src/xychart/layout.ts', 'src/xychart/axis-utils.ts', 'src/xychart/renderer.ts', 'src/__tests__/xychart-renderer.test.ts'],
    scores: { visual: { layoutGeometry: 2, routingTopology: 4, paintStyling: 3, labelsTypography: 2, upstreamDifferential: 2 }, quality: { correctnessCoverage: 4, robustness: 4, determinism: 4, semanticsAccessibility: 4, configurationParity: 3 } },
    strengths: ['Both orientations, multiple series, legends, measured axes, and point labels are deterministic.', 'Cartesian semantics and exact data values remain typed.'],
    gaps: ['Custom nice-tick and band calculations can disagree with D3 on domains, tick counts, and padding.', 'Canvas budgeting and text measurement differ from Mermaid’s builder/browser measurements.'],
    actions: ['Add D3 scale differential tests for adversarial domains, reversed ranges, decimals, and sparse dates.', 'Consider adopting d3-scale/d3-shape primitives while retaining Agentic’s layout shell.'],
  },
  {
    id: 'pie',
    upstreamEngine: 'D3 pie/arc generators and ordinal scale, with Mermaid-owned legend and label composition.',
    agenticEngine: 'Custom trigonometric arc paths, measured legend layout, collision-aware slice labels, donut and highlight extensions.',
    upstreamLibraries: ['D3 pie', 'D3 arc', 'D3 scaleOrdinal'],
    dependencyDecision: 'evaluate',
    decision: 'Evaluate d3-shape for angle and path generation. Keep Agentic label collision handling and extensions; explicitly decide whether Mermaid’s <1% slice filtering is compatibility or data loss.',
    upstreamEvidence: [{ sourceMap: 'node_modules/mermaid/dist/chunks/mermaid.esm.min/pieDiagram-OG5FZAAG.mjs.map', source: 'src/diagrams/pie/pieRenderer.ts', tokens: ["arc, pie as d3pie, scaleOrdinal", '(d.value / sum) * 100 >= 1'] }],
    agenticEvidence: ['src/pie/layout.ts', 'src/pie/renderer.ts', 'src/__tests__/pie.test.ts', 'src/__tests__/pie-elevation.test.ts'],
    scores: { visual: { layoutGeometry: 3, routingTopology: 4, paintStyling: 3, labelsTypography: 3, upstreamDifferential: 2 }, quality: { correctnessCoverage: 4, robustness: 4, determinism: 4, semanticsAccessibility: 4, configurationParity: 3 } },
    strengths: ['Proportional arcs, full-circle handling, donut mode, label fitting, and static emphasis are independently tested.', 'Legend sizing and label suppression are robust under dense data.'],
    gaps: ['Mermaid filters slices below 1%; Agentic retains them, so geometry and legend totals can diverge.', 'Hand-built SVG path formatting will not byte/point match d3-arc.'],
    actions: ['Add a declared compatibility policy and tests for sub-1% slices.', 'Run d3-pie/d3-arc as a geometry oracle and adopt if it simplifies edge cases without losing extensions.'],
  },
  {
    id: 'sankey',
    upstreamEngine: 'd3-sankey 0.12.3 for node layers, ordering, coordinates, and horizontal ribbon paths, with Mermaid-owned SVG labels and paint.',
    agenticEngine: 'The same d3-sankey 0.12.3 geometry behind a typed deterministic Scene adapter with bounded local gradient resources and terminal loss reporting.',
    upstreamLibraries: ['d3-sankey 0.12.3', 'D3 selection and Tableau10 color scale'],
    dependencyDecision: 'adopt',
    decision: 'Keep d3-sankey as the shared geometry authority. Preserve its layout through the Scene adapter while independently testing parser fidelity, resource safety, compositing, labels, and projections.',
    upstreamEvidence: [{ sourceMap: 'node_modules/mermaid/dist/chunks/mermaid.esm.min/sankeyDiagram-H77HJZDF.mjs.map', source: 'src/diagrams/sankey/sankeyRenderer.ts', tokens: ["from 'd3-sankey'", "attr('gradientUnits', 'userSpaceOnUse')", "style('mix-blend-mode', 'multiply')"] }],
    agenticEvidence: ['src/sankey/layout.ts', 'src/sankey/renderer.ts', 'src/__tests__/sankey-integration.test.ts', 'src/__tests__/sankey-renderer.test.ts', 'src/__tests__/sankey-rubric-properties.test.ts', 'src/__tests__/scene-gradient-resources.test.ts'],
    scores: { visual: { layoutGeometry: 4, routingTopology: 4, paintStyling: 3, labelsTypography: 3, upstreamDifferential: 3 }, quality: { correctnessCoverage: 4, robustness: 4, determinism: 4, semanticsAccessibility: 4, configurationParity: 4 } },
    strengths: ['Uses Mermaid’s pinned geometry engine and link-path generator while keeping authored values and identities explicit.', 'Typed local gradients, deterministic ID rewriting, palette compensation, dark-background compositing, and bounded resources have focused contracts.', 'Quoted CSV, numeric edge cases, duplicate links, zero-flow graphs, pathological dimensions, and layout invariants have regression and property coverage.'],
    gaps: ['Agentic palette selection, text measurement, label composition, and dark-background compositing intentionally need not pixel-match Mermaid.', 'There is no continuously executed end-to-end geometry and raster differential against Mermaid browser output.', 'Terminal output necessarily projects away gradients and mix-blend-mode while reporting the loss.'],
    actions: ['Add a pinned same-input Mermaid differential for node/link coordinates, label bounds, resolved paint resources, and raster output.', 'Track intentional dark-background and terminal divergences separately from shared-engine geometry parity.'],
  },
  {
    id: 'quadrant',
    upstreamEngine: 'Mermaid-owned chart builder using D3 linear scales for normalized coordinates.',
    agenticEngine: 'Custom normalized transforms with density-scaled plot, label wrapping, spiral collision avoidance, and leaders.',
    upstreamLibraries: ['D3 scaleLinear'],
    dependencyDecision: 'retain',
    decision: 'Retain the custom engine. Replacing a two-point affine transform with d3-scale has little payoff; use D3 only as a tiny differential oracle.',
    upstreamEvidence: [{ sourceMap: 'node_modules/mermaid/dist/chunks/mermaid.esm.min/quadrantDiagram-QALJNKXI.mjs.map', source: 'src/diagrams/quadrant-chart/quadrantBuilder.ts', tokens: ["import { scaleLinear } from 'd3'", 'QuadrantPointInputType'] }],
    agenticEvidence: ['src/quadrant/layout.ts', 'src/quadrant/renderer.ts', 'src/__tests__/quadrant.test.ts', 'src/__tests__/quadrant-style.test.ts'],
    scores: { visual: { layoutGeometry: 3, routingTopology: 4, paintStyling: 3, labelsTypography: 2, upstreamDifferential: 2 }, quality: { correctnessCoverage: 4, robustness: 4, determinism: 4, semanticsAccessibility: 4, configurationParity: 4 } },
    strengths: ['Correct normalized coordinate semantics and quadrant numbering.', 'Collision-aware labels/leaders materially exceed upstream robustness for dense points.'],
    gaps: ['Density scaling, wrapping, and displaced labels intentionally differ from Mermaid.', 'Point-label placement has no browser visual differential.'],
    actions: ['Use D3 scaleLinear as a unit-level coordinate oracle.', 'Keep parity and enhanced label-placement scores separate.'],
  },
  {
    id: 'gantt',
    upstreamEngine: 'Mermaid-owned scheduler/renderer using dayjs plus D3 time scales, axes, intervals, formatting, and selection.',
    agenticEngine: 'Custom UTC scheduler and deterministic time-axis/bar layout with dependency and critical-path overlays.',
    upstreamLibraries: ['dayjs', 'D3 scaleTime/axes/time intervals'],
    dependencyDecision: 'retain',
    decision: 'Retain the UTC scheduler for offline determinism and explicit calendar semantics. Use dayjs/D3 as differential oracles for parsing and ticks, not as blanket replacements.',
    upstreamEvidence: [{ sourceMap: 'node_modules/mermaid/dist/chunks/mermaid.esm.min/ganttDiagram-65O4CIDK.mjs.map', source: 'src/diagrams/gantt/ganttRenderer.js', tokens: ["import dayjs from 'dayjs'", 'scaleTime', 'axisBottom'] }],
    agenticEvidence: ['src/gantt/schedule.ts', 'src/gantt/layout.ts', 'src/gantt/renderer.ts', 'src/__tests__/gantt-upstream-bench.test.ts'],
    scores: { visual: { layoutGeometry: 3, routingTopology: 3, paintStyling: 3, labelsTypography: 3, upstreamDifferential: 3 }, quality: { correctnessCoverage: 4, robustness: 4, determinism: 4, semanticsAccessibility: 4, configurationParity: 4 } },
    strengths: ['Pinned upstream corpus already covers many schedule semantics.', 'No wall-clock dependency; today marker is explicit; overlays add inspectable dependency meaning.'],
    gaps: ['Tick choice, time formatting, and browser-measured label geometry can differ from D3.', 'Dependency overlays are Agentic extensions and must not inflate Mermaid parity scoring.'],
    actions: ['Extend the upstream bench from schedule facts to axis tick/date-label geometry.', 'Keep UTC determinism as a non-negotiable artifact-quality criterion.'],
  },
  {
    id: 'mindmap',
    upstreamEngine: 'Registered graph renderer defaulting to Cytoscape Cose-Bilkent for mindmaps.',
    agenticEngine: 'Custom deterministic bilateral/radial hierarchy with tidy-tree option, curved branches, shapes, and icons.',
    upstreamLibraries: ['cytoscape', 'cytoscape-cose-bilkent'],
    dependencyDecision: 'evaluate',
    decision: 'Evaluate Cose-Bilkent as a Mermaid-compatibility oracle or optional mode. Do not replace the deterministic bilateral signature without comparative evidence.',
    upstreamEvidence: [{ sourceMap: 'node_modules/mermaid/dist/chunks/mermaid.esm.min/mindmap-definition-GVBGAMR2.mjs.map', source: 'src/diagrams/mindmap/mindmapRenderer.ts', tokens: ["fallback: 'cose-bilkent'", 'layoutAlgorithm'] }],
    agenticEvidence: ['src/mindmap/layout.ts', 'src/mindmap/position.ts', 'src/mindmap/renderer.ts', 'src/__tests__/mindmap-gitgraph-upstream-oracle.test.ts'],
    scores: { visual: { layoutGeometry: 2, routingTopology: 2, paintStyling: 3, labelsTypography: 3, upstreamDifferential: 3 }, quality: { correctnessCoverage: 4, robustness: 4, determinism: 4, semanticsAccessibility: 4, configurationParity: 3 } },
    strengths: ['Deterministic central/bilateral hierarchy and authored shape/icon support.', 'Existing upstream content corpus exercises syntax and semantics.'],
    gaps: ['Force-directed Cose geometry is fundamentally different from tidy bilateral placement.', 'Upstream depth-weighted edge widths and theme gradients need explicit visual comparison.'],
    actions: ['Run Cose-Bilkent as a pinned oracle on the existing content corpus and quantify radial balance, crossings, depth spacing, and displacement.', 'Offer a compatibility mode only if determinism can be controlled and packaged safely.'],
  },
  {
    id: 'gitgraph',
    upstreamEngine: 'Mermaid-owned lane/commit geometry; D3 is used for selection, not layout.',
    agenticEngine: 'Custom deterministic branch-lane, commit, merge, cherry-pick, tag, and orientation layout.',
    upstreamLibraries: ['D3 selection only; no external GitGraph layout engine'],
    dependencyDecision: 'retain',
    decision: 'No upstream layout library exists to adopt. Close gaps with source-order and geometry differentials.',
    upstreamEvidence: [{ sourceMap: 'node_modules/mermaid/dist/chunks/mermaid.esm.min/gitGraphDiagram-7AKFKS3M.mjs.map', source: 'src/diagrams/git/gitGraphRenderer.ts', tokens: ["import { select } from 'd3'", 'COMMIT_STEP'] }],
    agenticEvidence: ['src/gitgraph/layout.ts', 'src/gitgraph/position.ts', 'src/gitgraph/renderer.ts', 'src/__tests__/mindmap-gitgraph-upstream-oracle.test.ts'],
    scores: { visual: { layoutGeometry: 3, routingTopology: 3, paintStyling: 3, labelsTypography: 3, upstreamDifferential: 3 }, quality: { correctnessCoverage: 4, robustness: 4, determinism: 4, semanticsAccessibility: 4, configurationParity: 3 } },
    strengths: ['Source-ordered commits, branch lanes, merge/cherry-pick identity, tags, and mark types are explicit.', 'Content corpus and upstream oracle already provide stronger evidence than most families.'],
    gaps: ['Lane offsets, label rotation/backgrounds, and theme-specific commit geometry are not fully measured.', 'Enhanced labels may differ from Mermaid even when history topology matches.'],
    actions: ['Extend the existing oracle to lane coordinates, commit centers, and merge path bends.', 'Score topology independently from label/background polish.'],
  },
  {
    id: 'radar',
    upstreamEngine: 'Mermaid-owned polar math, curve interpolation, legend, axes, and graticule rendering.',
    agenticEngine: 'Custom deterministic polar geometry, polygon/circle graticules, straight/smoothed curves, dots, ticks, labels, and legend.',
    upstreamLibraries: ['No external layout engine; SVG selection helpers only'],
    dependencyDecision: 'retain',
    decision: 'Retain the custom math. The right next step is a polar-coordinate/path differential, not dependency adoption.',
    upstreamEvidence: [{ sourceMap: 'node_modules/mermaid/dist/chunks/mermaid.esm.min/diagram-5YXONRP5.mjs.map', source: 'src/diagrams/radar/renderer.ts', tokens: ['drawGraticule', 'drawCurves', 'Math.min(config.width, config.height) / 2'] }],
    agenticEvidence: ['src/radar/layout.ts', 'src/radar/scale.ts', 'src/radar/renderer.ts', 'src/__tests__/radar-renderer.test.ts'],
    scores: { visual: { layoutGeometry: 3, routingTopology: 4, paintStyling: 3, labelsTypography: 3, upstreamDifferential: 2 }, quality: { correctnessCoverage: 4, robustness: 4, determinism: 4, semanticsAccessibility: 4, configurationParity: 4 } },
    strengths: ['Axes, min/max scaling, graticules, curve modes, dots, legends, and labels are typed and deterministic.', 'Polar semantics are simple enough for strong independent invariants.'],
    gaps: ['Smooth path interpolation and label/legend spacing are not compared with Mermaid output.', 'No image or path-command differential exists.'],
    actions: ['Compare polar vertex coordinates exactly and smoothed paths by sampling.', 'Add legend/axis-label bounding-box comparison on long multilingual labels.'],
  },
] as const satisfies readonly FamilyFidelityAssessment[]

export function dimensionAverage(values: Record<string, FidelityScore>): number {
  const scores = Object.values(values)
  return Math.round((scores.reduce<number>((sum, score) => sum + score, 0) / scores.length) * 25)
}

export function familyFidelityScores(assessment: FamilyFidelityAssessment): { visual: number; quality: number } {
  return {
    visual: dimensionAverage(assessment.scores.visual),
    quality: dimensionAverage(assessment.scores.quality),
  }
}
