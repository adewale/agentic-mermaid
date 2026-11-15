# Family composition and final paint evidence

The 23 native diagram families share Scene shapes, connectors, prepared text,
groups and document resources. Each family retains its own layout and data
semantics: chart coordinates, sequence order, graph routes and calendar dates
are not interchangeable placement rules.

Artwork must enter Scene as typed source geometry. A registered icon's paths
produce shape children inside a transformed group; the SVG projection and
inspection consume those same paths. Class endpoint overlays remain artwork
owned by the original relationship, rather than additional relationships.
Accessibility titles, descriptions and stylesheets declare their non-painting
purpose, which admission checks against the serialized element vocabulary.
Visible raw document content remains explicitly unmeasured.

Text retains the actual `PixelTextBlock` chosen before placement, including
source spans, display runs, wrapping, font inputs and occupied geometry.
Preparation performed during lowering is marked `fallback`; its existence
does not prove that layout reserved enough room. Conditional tooltip artwork
retains its geometry and conditional state rather than pretending it is always
visible or always absent.

An artwork owner identifies the semantic subject to which a mark contributes.
Group composition supplies ownership to otherwise unowned children without
mutating reusable marks or discarding their private SVG projection. Explicit
ownership survives nested wrappers. Inspection preserves every primitive in
paint order, with its owner and ancestor chain; duplicate-looking identifiers
do not collapse distinct marks.

`inspectScenePrimitives` consumes final lowered geometry and retained text.
Affine transforms compose through groups, including non-scaling strokes.
Paint bounds include strokes, joins, caps, typed paths and endpoint markers.
Path envelopes are conservative: Bézier control hulls and complete arc
ellipses can include empty space. An envelope outside a region is a candidate
for checking, not proof that painted pixels were clipped. Missing geometry
makes evidence unavailable rather than producing a partial successful bound.

The corpus assertion lives beside Scene fidelity. It uses the existing layout
corpus, registered examples and interacting feature witnesses, and requires
visible native artwork to be measured with text retained from layout. This
assertion protects composition; it does not claim raster-level font coverage,
arbitrary backend behavior or every possible interactive state.

Pixel geometry and terminal cells have separate owners and checkers. Shared
identities and display interpretation can be compared between them, but a
pixel bounding box cannot certify a terminal route or wide-grapheme cell.

## Existing consumers and their boundaries

The shared layer supplies measured text, owned drawing and inspection. The
following placement rules stay with their existing owners; sharing a drawing
primitive does not require sharing a placement algorithm.

| Existing families | Shared components used by the family | Placement and semantics that remain local |
| --- | --- | --- |
| Flowchart, State | [Graph text](../../../src/graph-text.ts), [outlines and ports](../../../src/shape-outline.ts), [graph Scene lowering](../../../src/renderer.ts) and typed connectors | [Graph layout](../../../src/layout-engine.ts) owns routing; State retains pseudostates, transitions and nesting. |
| Class, ER | [Prepared text](../../../src/shared/prepared-text.ts), shape/text/group marks, relationship resources and endpoint artwork | [Class layout](../../../src/class/layout.ts) reserves members and annotations; [ER layout](../../../src/er/layout.ts) reserves attributes and key columns. Their inheritance and cardinality models remain distinct. |
| C4 | Prepared text and the same shape and connector marks, drawn by the [typed SVG writer](../../../src/scene/svg-writer.ts) | [C4 placement](../../../src/c4/placement.ts) retains boundaries, authored row limits, person/database decorations and interaction directions. It is not a general grid engine. |
| Architecture, Mindmap | [Typed path artwork](../../../src/scene/artwork.ts), [fallback icon text](../../../src/shared/icon-fallback.ts), affine composition and prepared labels | [Architecture layout](../../../src/architecture/layout.ts) owns directional ports and groups; [Mindmap layout](../../../src/mindmap/layout.ts) owns ordered radial hierarchy. |
| Sequence | Prepared text, connector/marker resources, owned shapes and groups | [Sequence layout](../../../src/sequence/layout.ts) owns chronology, lifelines, activations, creation and enclosing control fragments. Actor glyphs and menu labels enter the same typed inspection path. |
| XYChart, Quadrant | Typed rectangles/lines/circles, prepared text and [retained tooltips](../../../src/shared/tooltip-layout.ts) | [XY axes](../../../src/xychart/axis-utils.ts) and [Quadrant layout](../../../src/quadrant/layout.ts) keep numeric domains, baselines and authored data coordinates. Label clearance cannot move a data value. |
| Pie, Radar | Typed paths/polygons/circles, prepared legends and text bounds; Pie also uses retained tooltips | [Pie layout](../../../src/pie/layout.ts) keeps totals and angles; [Radar scales](../../../src/radar/scale.ts) keep domains and spoke order. A common circle does not make these the same radial layout. |
| Timeline, Journey, Gantt, GitGraph | Prepared text, owned shape/group/connector marks and bounds | [Timeline](../../../src/timeline/layout.ts) owns periods, [Journey](../../../src/journey/layout.ts) scores and actors, [Gantt](../../../src/gantt/layout.ts) calendar intervals, and [GitGraph](../../../src/gitgraph/layout.ts) branch ancestry. Pixel row placement and terminal cell allocation remain separate. |
| Sankey | Typed ribbons, rectangles, prepared labels, channels and paint bounds | [Sankey layout](../../../src/sankey/layout.ts) retains weights, conservation, layer order and ribbon widths. It does not flatten weighted links into ordinary graph strokes. |
| Requirement, Kanban | [Measured text rows](../../../src/shared/text-rows.ts), prepared blocks and owned shape/text/group marks | [Requirement](../../../src/requirement/layout.ts) retains typed fields, relationship direction and ELK placement. [Kanban](../../../src/kanban/layout.ts) retains column/card order, metadata, ticket actions and viewport wrapping. |
| Packet, Treemap, Block | Prepared text, rectangles, groups, ports and retained bounds | [Packet](../../../src/packet/layout.ts) splits inclusive bit ranges into rows without changing their widths. [Treemap](../../../src/treemap/layout.ts) partitions area by hierarchical values. [Block](../../../src/block/layout.ts) retains authored grid order, spans and empty cells, then shares obstacle routing. Their partitions are different contracts. |
| Ishikawa | [Hierarchy validation and child lookup](../../../src/shared/hierarchy-model.ts), prepared text and owned connectors | [Fishbone placement](../../../src/ishikawa/layout.ts) retains the effect, category hierarchy and alternating cause branches. Treemap consumes the same hierarchy helpers with a different placement rule. |

Existing shared components have demonstrated consumers. `pathArtwork`
feeds original registered paths to both Scene serialization and geometry in
Flowchart and Mindmap. Architecture uses typed source shapes directly.
`layoutTooltip` retains the measured
block and allocated rectangle used by Pie, Quadrant and XYChart; lowering
consumes that object instead of preparing the source again. An unsupported icon
similarly retains its fallback token before placement.

## Measured rows across cards and legends

Requirement cards, Kanban headers/cards, Pie legends and Radar legends repeat
the same allocation: keep prepared blocks in order, reserve the greater of
text height and an intrinsic row minimum, separate rows, and retain their text
centres. [The shared allocator](../../../src/shared/text-rows.ts) now owns this
rule. It returns the original items and blocks with occupied row regions,
stack dimensions and text positions; it does not prepare text again. An
explicit pixel origin preserves the families' coordinate accumulation.

The consumers still own the choices that carry meaning:

- [Requirement](../../../src/requirement/layout.ts) selects ID, text, risk and
  verification fields, starts rows below its stereotype/name header, and keeps
  text at the start of any authored minimum line stride.
- [Kanban](../../../src/kanban/layout.ts) selects label/ticket/assignee/priority
  rows, applies card and header padding, then places cards in their authored
  columns. Its header deliberately retains a trailing row gap.
- [Pie](../../../src/pie/layout.ts) computes values, percentages and highlighted
  label width. Row height reserves the swatch; legend positioning does not
  change slice angles, totals or authored order.
- [Radar](../../../src/radar/layout.ts) wraps curve names and centres swatches
  within their rows. Domains, axis positions, curve order and point coordinates
  stay in the Radar layout.

Each consumer puts the same retained blocks and resulting positions in its
existing positioned artifact. Scene lowering, style projection, inspection and
certification continue to consume that artifact; there is no second drawing
or inspection model. Terminal families keep cell-based preparation and
allocation. Sharing the meaning of a label does not make pixels into cells.

[Spacing configuration](../../../src/shared/config-spacing.ts) is shared by
Class and ER without importing either family's layout. ER previously loaded
Class's ELK/card/namespace code just to read a non-negative numeric setting.
The extraction keeps explicit RenderOptions precedence and the existing
wire-or-warn behavior; it does not add supported config keys.

These are infrastructure changes. They add no syntax or family capabilities
and claim no improvement to the visible artwork. Preservation is checked by
the existing corpus geometry gate, family semantics/operation tests, measured
text/Scene checks and browser dependency/payload report. The focused pixel
comparison is supplementary to those independent contracts.

## Composing another consumer

A graph/container family can prepare domain-specific fields, allocate its
rows and pass measured boxes/ports to the existing ELK integration, as
Requirement does. A Swimlane variant could instead retain Flowchart identities
and connectors while supplying lane membership and constrained placement; no
new universal graph model is needed.

An ordered family can allocate prepared rows inside its own bands and keep
interval scheduling local. Kanban demonstrates rows inside authored columns;
Gantt's calendar/dependency rules and Sequence's chronology must not migrate
into a generic stack. Shared interval packing needs a second consumer with the
same ordering and overlap contract before extraction.

Cartesian and radial families can share prepared text, measured legends,
tooltips and drawing marks while keeping scale interpretation local. Radar
and Pie now share row allocation, while XYChart and Quadrant retain their
numeric axes and authored points. No common scale or axis engine is claimed.

Partition and track families can reuse preparation and owned rectangles while
retaining their conservation rules. Packet bit spans, Block grid spans and
Treemap area weights cannot use the same partitioner merely because they draw
rectangles. Their current implementations are concrete consumers of existing
text, hierarchy, routing and Scene primitives, rather than promises of a
general track engine.

Measured compartments, interval packing, axes, row grids and partition tracks
remain candidates when two consumers demonstrate the same contract. Class/ER
headers, member compartments and key columns remain family-owned; the text-row
allocator is not a full card abstraction and does not claim port ownership or
painted-ink certification by itself.

## Validation and loading cost

Compared with merged main `1133266ffe07367ce8ed359be15886a8c05e0c39`, the
audited implementation at `e0c556cb5b9a8438bbfbb469ffd1eed053fc8136` passes the existing
303-diagram exact geometry gate. A supplementary 128-case comparison across
the six affected families retained identical public layouts, SVG strings and
terminal output, including the same rejected negative Kanban input. Eight
focused default/large-type PNGs also matched byte for byte. These finite
comparisons protect the refactor; they establish no new general layout or
font guarantee.

The relevant local checks pass: 226 family/geometry/work-limit tests, 28 Scene
tests, and the pinned Mermaid 12.2 suite's 124 tests / 4,156 assertions. The
existing upstream test for unique Requirement edge IDs remains skipped.
Typecheck, lint and the built browser dependency/payload checks pass. The
row-allocation tests protect retained identity, intrinsic decoration space,
text alignment, explicit origins and disjoint regions under wrapped/wide text;
they are regression guards for the shared contract, not evidence of a newly
fixed rendering bug.

Adversarial review added 2,294 Requirement/Kanban layout comparisons and 1,608
Class/ER configuration comparisons. No substantive drift was found in those
scopes; fractional arithmetic tails below 1e-9 are not universal byte-identity
evidence. The Pie/Radar review found a 0.01px rounded-coordinate change at
fractional font sizes because relative row offsets regrouped additions. Both
families now allocate at the absolute legend origin. All 1,224 legend cases
then match the baseline exactly. Two focused tests fail on the unaudited
refactor and pass with the correction; this repairs a regression introduced
by the refactor rather than an existing main-branch bug.

The same Bun 1.4.2 browser build/report measures these changes to each complete
budgeted family load, including dependencies:

| Family | Gzip delta (bytes) | Brotli delta (bytes) | Request delta |
| --- | ---: | ---: | ---: |
| Class | -682 | -856 | 0 |
| ER | -6,418 | -5,938 | 0 |
| Requirement | +321 | +299 | +1 |
| Kanban | +283 | +258 | +1 |
| Pie | +266 | +265 | +1 |
| Radar | +291 | +213 | +1 |

The shared row module remains lazy and appears only in its four consumers'
loads. The initial module graph stays at four requests and 14,233 raw bytes;
gzip remains 5,493 bytes; Brotli moves from 4,928 to 4,936 bytes.
Other families retain their request counts. Kanban's 195,180-byte gzip closure
crosses its 195,000-byte ceiling; Radar's 180,502-byte Brotli closure crosses
its 180,500-byte ceiling. Only those ceilings advance to the next 500-byte
step, 195,500 and 181,000. The extra lazy request and compressed bytes are the
cost of source reuse here, rather than a download reduction for these four
families. No execution speedup is claimed.

Recheck the existing gates with:

```sh
bun run typecheck && bun run lint
bun test --timeout 30000 src/__tests__/text-rows.test.ts src/__tests__/layout-equivalence.test.ts
bun run reference:mermaid && bun run test:mermaid-modern
bun run build:browser:lazy && bun run scripts/build/browser-lazy-report.ts --json
```

The browser report accepts `--root <checkout>` to measure another revision's
build with the same reporter and toolchain. Dependency membership and complete
closures matter alongside byte counts; a filename/compression change alone
does not establish a smaller startup payload.
