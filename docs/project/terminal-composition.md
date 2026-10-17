# Terminal composition

Every built-in terminal family constructs a `TerminalArtifact` containing its
`TerminalDocument` and encoding policy. The paired native drawing function
preserves the existing `FamilyDescriptor.renderAscii` string hook. A document contains positioned
graphemes, their terminal cell widths, paint roles, element owners, complete
text occurrences, surfaces, container bounds and relationship ports. Family
layout decides where those primitives fit before painting them. Pixel layout
continues to use pixel units and its own adapters.

The document is sparse. Empty layers allocate no output-sized arrays; overlay
visits occupied graphemes. Glyphs, roles and ownership share one store. Final
serialization necessarily visits the emitted output cells. This removes the
old parallel character/role stores and per-edge full-canvas merges; it does not
make a general speedup promise for family parsing or stronger route allocation.

## Text and occupied space

Families prepare their display text once, then wrap it using terminal cells.
Wrapping never edits Mermaid source. Literal labels remain literal; formatted
labels use the existing display projection. Graphemes stay atomic, including
CJK, combining marks and ZWJ emoji. Wide cells include owned continuations.
Authored spaces belong to the text footprint, including trailing spaces.
Whole text blocks are measured once and admitted atomically, so a collision
cannot leave half a label. Sparse overlays preflight each complete incoming
text group before painting any of its cells, retaining this guarantee through
layer composition. Every incoming owner must be compatible with every
affected existing owner before any cell is retired. Immutable element handles
and interned owner sets retain all identities at crossings; conflicting
definitions of one identity are rejected. A wide continuation cannot erase a
neighboring marker or surface.

Generated names and semantic identity are separate. Composite identity keys use
tagged tuples, so punctuation in authored IDs cannot merge different endpoint
pairs before generated-name collision avoidance runs. Parents are immutable
`{ id, kind }` references throughout the drawing. Public regions preserve the
existing `parentId` and add `parentKind`; the action adapter maps that complete
reference into its renderer-neutral namespace. A class and a namespace may
therefore share an authored ID without creating a self-parenting action region.

Text, markers and card surfaces cannot silently be erased by a later route.
Incompatible text/geometry and unrelated collinear route overlaps produce
projection diagnostics with optional zero-based cell coordinates that follow
composition and reflection. Coincident identical markers retain all owners.
Explicitly allocated bundles may share runs and markers. A crossing can have
two independent route owners; a shared printed intersection does not merge
their semantic identities.

Connected strokes carry directional ports, line style and rounding; oriented
markers carry shape and direction. Alphabet selection lowers these values to
glyphs centrally. Compatibility glyph painting remains available for decorative
symbols and string adapters. Numeric bars carry half-cell coverage independently
of stroke topology. An opaque bar covers a line while retaining the occluded
relationship separately; hidden lines never become visible bar ownership.

Family layouts keep their own constraints. Class and ER share card-face demand,
port allocation, immutable allocated label rectangles and the existing bounded
A* search. A validated route binds endpoint identities, allocated face ports
and a contiguous exterior path before painting. Bounded occupancy tracks exact
current extents, including deletion, rather than scanning keys during search.
Namespace headers are measured routing obstacles, separate from endpoint
identities; containers and classes can share an authored name without changing
a relationship's target. Complete sibling envelopes settle before routing.
Sequence lays out lexical fragment boundaries, notes and messages in order.
It reserves exact foreground text, note and card footprints before painting
lifelines or activations. Intended background gaps are allocation decisions;
foreign foreground text and route conflicts still reach ordinary admission.
Chart adapters allocate numeric marks and literal labels in their own units.
Reversals move geometry, text blocks, frames and ports while preserving text
reading order; they do not reverse serialized strings.
Text and its opaque padding retain explicit footprint provenance through
repaints and reflection. Growing a grouped label visits only newly included
surface cells. Reflected rows recompute their emitted extents; transforming a
drawing never inherits an ambient painting owner.

Graph headers reserve their measured cells before routes are painted. A stable
occupancy view reuses that drawing, and the existing bounded search detours
obstructed segments while retaining their endpoints and incident directions.
Lines and corners use the same resulting polyline. Measured relationship labels
retain their owner, graphemes, spaces and color while choosing a complete
rectangle on or adjacent to their own route. Adjacent-face candidates derive
from measured label bounds and actual owned route cells, with a bounded local
search for ties. Grid spacing reserves frame margins
and reciprocal-label demand. If bounded local placement fails, ordinary strict
admission reports the collision; no detached label is substituted.
Cards and recursive container frames share provisional and final envelope
measurement. One batch reserves the maximum missing capacity per spacer between
unrelated, logically disjoint items; logical coordinates, routes and ports stay
fixed. Multiline headers reserve a two-cell bend/marker approach. If unrelated
items interleave in both logical axes, spacer growth cannot separate them and
the drawing reports that containment limitation explicitly.

GitGraph reserves complete commit-label rectangles clear of branch rails.
Positive-length shared rail runs and merge stems determine intentional bundles;
crossings alone do not. Each parent relationship retains its own endpoint
ports and connected owned geometry, including coverage hidden by commit marks.

## Output and metadata

One encoding pass derives plain, ANSI and HTML text after title composition.
ASCII and Unicode lower logical geometry before encoding. Security checks still apply at
the common output boundary. A hard `targetWidth` either fits the complete
result or raises the existing `AsciiWidthError`; a soft `maxWidth` guides
family wrapping. Neither policy clips content or inserts an ellipsis.

`renderMermaidASCIIWithMeta` reads the exact drawing retained by that render.
It does not search text or render a second version. Its region fields are:

- `canvasRow`, column bounds and `rowSpan`: the primary text occurrence's
  compatible bounding box, or an explicitly allocated container/route bound.
- `projectedText` and the legacy `authoredTextCells`: the primary emitted text
  occurrence, including spaces and generated display characters. Container
  bounds can cover much more than their header text.
- `ownedCellSpans`: all occupied cells belonging to the element, including
  surfaces, continuations and repeated/disjoint occurrences.
- `occludedCellSpans`: optional semantic route coverage behind opaque marks,
  excluded from visible owned cells.
- `parentId`, `members`, `from`, `to`, `bundle` and `ports`, when the family
  supplies the corresponding semantic geometry.

Terminal action regions retain their compatible bounds and add `cellSpans`,
optional `occludedCellSpans`, and parent identities. Generated IDs avoid authored IDs in the same render.
Generated identity allocation distinguishes semantic keys from preferred
readable names, so derived labels and relationships cannot alias each other.
String-only extension hooks remain supported; metadata reports
`TERMINAL_OWNERSHIP_UNAVAILABLE` instead of inventing regions. Wrapping a native
hook as a string-only function similarly makes no geometry claim. No config
mutation or string-equality test connects a drawing to its output.

Plain native output resolves terminal appearance without running optional
graphical layout. Accessing `terminalStyle` or `receipt` evaluates and memoizes
the same Scene connector evidence previously computed eagerly. A projection
callback requests that evidence before drawing. Gantt's clock is an explicit
resolved input, so delayed evidence retains the same date and marker. Metadata
consumes this full evidence. Performance comparisons
must distinguish text-only output from fully consumed receipts.

Authored parsing is memoized within one render. Flowchart drawing and metadata
reuse its model only when authored and admitted grammar inputs match exactly;
entity decoding and terminal control replacement can require separate models.
Prepared input and the model travel in one internal execution result. Metadata
consumes that local model; the public receipt does not retain a model cache.
Family grammars and layouts remain distinct. Regions group occupied cells and
sort each group's visible cells once.

## Where construction enforces invariants

The representation prevents a defect only when every path that creates or
imports the relevant state passes through the same boundary. The audit found
five gaps and extended their owning contracts:

| Invariant | Gap and representative class | Construction boundary |
| --- | --- | --- |
| Distinct semantic identities remain distinct | Delimiter-concatenated endpoint keys collided before name suffixing; text-group and diagnostic keys have the same risk | Structured composite keys, separate readable names, and admission of supported key components |
| Parent references retain their namespace | Bare IDs lost the node/container distinction during action conversion and compatibility checks | Typed immutable parent references consumed by both geometry admission and output adapters |
| Intended background occlusion is explicit | A cell compositor cannot infer that a message or heading should cut a gap in a lifeline or activation | Family layout reserves foreground footprints before either background pass; collision diagnostics remain enabled |
| One identity has one immutable definition | Explicit registration validated definitions while paint, attribution and layer imports bypassed it | One snapshot-and-validation path, with complete batch validation before target mutation and caches restricted to owned immutable values |
| Admitted ink remains serializable | Legacy row caps became stale after positioned writes, sparse overlays and reflection | Accepted cell placement maintains row extents; transforms rebuild them from moved occupied geometry |

Owning regressions include foreign frozen handles, mutable/getter callers,
partial failed imports, arbitrary ID separators, same-ID/different-kind parents,
wide continuations, authored spaces, reflected ragged rows, and active sequence
headings. Primitive tests cover composition combinations that current built-in
families may not exercise. Family and action tests separately check the final
public text, diagnostics, endpoint identities and parent mapping.

## Rebuilding on this basis

The migration already uses the basis to implement ordered sequence containment,
Class/ER cardinalities, self/parallel routes and directions, complete Quadrant
labels, Gantt axis/cursor ownership and one XY quantizer for ticks, baseline,
bars and lines. Tests inspect emitted cells, owners and physical bounds as
well as ordinary public output and reviewed goldens.

The same card, compartment, frame, port and route primitives can support a
future native C4 family through the existing family registry. They also give
terminal hit testing precise cells and let future accessibility or selection
surfaces distinguish repeated text without new label-search heuristics.
C4 admission, typed editing/serialization, and pixel layout still require
their own implementation; this migration does not claim them.

Format-specific projections remain explicit. Pie uses a bar list, Sankey uses
adjacency output, and Radar uses a numeric ruler/bar table. Authored graphical
settings that these forms cannot preserve receive feature-specific projection
diagnostics. A compositor does not by itself fix SVG title geometry, ER source
serialization order, or structured-edit admission contracts.
