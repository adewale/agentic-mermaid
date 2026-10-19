# Family composition and final paint evidence

The 17 native diagram families share Scene shapes, connectors, prepared text,
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

Two extractions in this change have demonstrated consumers. `pathArtwork`
feeds original registered paths to both Scene serialization and geometry in
Flowchart and Mindmap. Architecture uses typed source shapes directly.
`layoutTooltip` retains the measured
block and allocated rectangle used by Pie, Quadrant and XYChart; lowering
consumes that object instead of preparing the source again. An unsupported icon
similarly retains its fallback token before placement.

Measured compartments, interval packing, axes, row grids and partition tracks
remain candidates for later extraction when two consumers need the same
contract. For example, a shared measured compartment could expose prepared
header/body regions and ports to Class and ER while each keeps its own member
model. A track or partition component would need explicit spans and ownership;
a rectangle wrapper cannot supply them. These are design examples, not new
placement infrastructure delivered by this change.
