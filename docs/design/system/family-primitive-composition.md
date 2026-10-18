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
