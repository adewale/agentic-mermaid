# Shared terminal compositor

The shared terminal compositor is the owned cell drawing used by every built-in
terminal family. It supplies common terminal composition and encoding primitives; each
family still chooses its layout. Its guarantees apply to native terminal
artifacts, rather than to every rendering format or every possible layout.

## Scope and guarantees

| Surface | Current scope |
| --- | --- |
| ASCII and Unicode | All built-in terminal families construct owned cell geometry before alphabet lowering. |
| Plain, ANSI and terminal HTML | Encodings of that same drawing; HTML here means escaped terminal text with color spans. |
| Terminal metadata and actions | Regions derive from the emitted drawing, with exact occupied spans and typed parent references. |
| SVG, PNG and graphical layout | Use their existing Scene and pixel adapters; terminal admission does not validate their geometry or semantic identities. |
| Family placement and routing | Remain family-specific; composition checks admitted geometry but cannot make every requested arrangement feasible. |
| String-only extension hooks | Keep text output support and report unavailable ownership instead of inventing geometry. |
| Native C4 | C4-owned hierarchy and placement consume the shared card, frame, port, route and text primitives; see [C4](../design/families/c4.md). |

The represented-content-or-explicit-diagnostic contract does not promise that
every label or route can be placed. Compound membership and complete
parallel/reciprocal demand now participate in graph allocation before painting.
A collision diagnostic still means that a bounded placement was refused; it
does not count as a successful rendering of the missing content.

## Drawing authority

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

Terminal generated names and semantic identity are separate. Composite identity
keys use tagged tuples, so punctuation in authored IDs cannot merge different endpoint
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
Middle paths join exterior exits without re-entering protected marker corridors;
crossing fallback retains those reservations and labels leave them clearance.
Namespace headers are measured routing obstacles, separate from endpoint
identities; containers and classes can share an authored name without changing
a relationship's target. Complete sibling envelopes settle before routing.
State notes use the same immutable contiguous-route proof and mask painter with
their existing border-based ports. Complete note boxes and their attachment
approaches settle outside their ancestor envelopes before routing. Search reads
the admitted graph and annotation layer, protects cards/headers/other notes and
permits only perpendicular ancestor-frame crossings. Explicit same-face note bundles may
share a trunk. A full stroke batch is admitted before any route ink or ports
are published; a refused attachment leaves its note visible with a diagnostic.
Batch cell and endpoint extents validate before mutation. Marker definitions
are immutable snapshots at both route allocation and drawing import.
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
measurement. When a flat embedding interleaves members and nonmembers, compound
placement rebuilds it as recursive quotient graphs: each child container is an
atomic item at its parent's level. Membership and authored endpoints remain
unchanged. Envelope allocation then reserves measured frame/header clearance
between disjoint items. Parallel/reciprocal demand reserves physical face slots
and complete label capacity before cell routes are planned. The same allocated
polyline supplies lines, corners, markers and public ports. A failed bounded
allocation reports a specific geometry diagnostic instead of claiming a route.
Container ports use their actual frame, rather than a representative member.
Final header/face capacity is measured after reverse-grid projection. Nested
frame insets reserve descendant marker approaches and a clear cell; joint
approach admission checks different endpoints together before edge painting.

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
- `parentId`, `parentKind` and `members`: native hierarchy and explicit membership.
- `annotationTarget: { id, kind }`: an attached State or Class note's target,
  independent of hierarchy. It grants no frame, membership or collision
  exemption and survives a refused connector. Certification reports an
  unavailable or wrong-kind target as unverified.
- `from`, `to`, `bundle` and `ports`, when the family supplies the corresponding
  semantic geometry.

Logical text blocks retain admitted, owner-specific empty-row provenance through
composition and reflection. `projectedText` joins actual glyph rows and explicitly
authored empty rows; it never fills arbitrary gaps between independent calls or
adds occupied cells for an empty row. Sequence messages share one scope across
their label lines, while repeated actor/header occurrences remain separate.

Terminal action regions retain their compatible bounds and add `cellSpans`,
optional `occludedCellSpans`, and parent identities. Generated IDs avoid authored IDs in the same render.
Terminal generated identity allocation distinguishes semantic keys from
preferred readable names, so derived terminal labels and relationships cannot
alias each other.
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
imports the relevant state passes through the same boundary. The audits found
gaps and extended their owning contracts:

| Invariant | Gap and representative class | Construction boundary |
| --- | --- | --- |
| Distinct terminal semantic identities remain distinct | Delimiter-concatenated endpoint keys collided before name suffixing; text-group and diagnostic keys have the same risk | Structured composite keys, separate readable names, and admission of supported key components |
| Parent references retain their namespace | Bare IDs lost the node/container distinction during action conversion and compatibility checks | Typed immutable parent references consumed by both geometry admission and output adapters |
| Intended background occlusion is explicit | A cell compositor cannot infer that a message or heading should cut a gap in a lifeline or activation | Family layout reserves foreground footprints before either background pass; collision diagnostics remain enabled |
| One identity has one immutable definition | Explicit registration validated definitions while paint, attribution and layer imports bypassed it | One snapshot-and-validation path, with complete batch validation before target mutation and caches restricted to owned immutable values |
| Admitted ink remains serializable | Legacy row caps became stale after positioned writes, sparse overlays and reflection | Accepted cell placement maintains row extents; transforms rebuild them from moved occupied geometry |
| Allocated graph ports and approaches fit their semantic endpoints | A representative child lost the container's actual face; independently valid nested ports still had overlapping approaches | Node-or-container endpoint objects, final-envelope face checks, shared measured frame insets, joint approach admission and actual frame/marker contact regressions |

Owning regressions include foreign frozen handles, mutable/getter callers,
partial failed imports, arbitrary ID separators, same-ID/different-kind parents,
wide continuations, authored spaces, reflected ragged rows, and active sequence
headings. Primitive tests cover composition combinations that current built-in
families may not exercise. Family and action tests separately check the final
public text, diagnostics, endpoint identities and parent mapping.

## Rebuilding on this basis

### Shared semantics with format-specific geometry

Sankey now prepares one pure, family-owned semantic identity plan before either
layout: authored endpoints, structured occurrence keys and collision-safe public
link/title identities. The shared generated-name allocator reserves authored
node identities, including generated-looking names, and preserves ordinary
readable IDs where unambiguous. SVG attributes, layout regions and terminal
ownership consume that same plan. Typed text-mark identity keeps a generated
title separate from its bounded Scene part ID. Obtaining semantic identities
and formatting numeric display values requires neither d3-sankey nor terminal
cell geometry. This repairs semantic correspondence; it is not a claim that
the earlier duplicate identities caused missing ribbons or wrong PNG pixels.

Authored source reaches family parsing unchanged. Display controls are prepared
as inert text before output geometry; connector references and action targets
remain semantic values. XML attributes encode TAB/LF/CR and decode references
once. Sankey uses its existing CSV parser on physical rows, preserving quoted
blank lines and comment-looking content.

Subsequent migrations should share immutable semantic references, including kind
and ID, and validate parent/endpoint correspondence at the boundary where a
family creates or imports them. Extend existing identity, action and route tests
at their owning boundaries. Corresponding retained source elements must remain
unambiguous across output projections; different projections can have different
visual marks, region inventories and explicit losses. One source element may
own multiple parts or text occurrences. Public semantic IDs, Scene part IDs,
SVG resource IDs and action-region namespaces have different responsibilities.

Cell layout remains responsible for grapheme widths, occupied spans, terminal
ports and line extents. Graphical layout remains responsible for pixel text bounds,
curves, surfaces, markers and SVG references. Each needs final-output checks in
its own coordinates; sharing an identity helper is not proof of either layout.
The independent route-verification policy remains
[#265](https://github.com/adewale/agentic-mermaid/issues/265).

### Follow-up order and boundaries

| Work | Next deliverable |
| --- | --- |
| [#387: native C4](https://github.com/adewale/agentic-mermaid/issues/387) | Implemented in source through the existing registry; output-specific dispositions and evidence live in [C4](../design/families/c4.md). Publication is a separate release step. |
| String-only extensions | Preserve explicit ownership-unavailable diagnostics; design an opt-in native artifact contract when a concrete extension consumer needs it. |

The combined fixes for [#400](https://github.com/adewale/agentic-mermaid/issues/400),
[#397](https://github.com/adewale/agentic-mermaid/issues/397) and
[#398](https://github.com/adewale/agentic-mermaid/issues/398) exercise the shared
semantic boundary and the separate cell-layout boundary together. Their tests
check literal identities/membership, emitted graphemes, occupied frames, physical
endpoint contact and connected owned routes, including nested containers with
parallel/reciprocal edges and wide labels beside protected markers. They do not
prove every family layout feasible. C4 can reuse available primitives without
waiting for every layout limit to disappear.

### Existing reuse

The migration already uses the basis to implement ordered sequence containment,
Class/ER cardinalities, self/parallel routes and directions, complete Quadrant
labels, Gantt axis/cursor ownership and one XY quantizer for ticks, baseline,
bars and lines. Tests inspect emitted cells, owners and physical bounds as
well as ordinary public output and reviewed goldens.

The native C4 family uses the same card, compartment, frame, port and route
primitives through the existing family registry. They also give
terminal hit testing precise cells and let future accessibility or selection
surfaces distinguish repeated text without new label-search heuristics.
C4 admission, typed editing/serialization and pixel layout have their own
family implementation; compositor guarantees alone do not prove those paths.

Format-specific projections remain explicit. Pie uses a bar list, Sankey uses
adjacency output, and Radar uses a numeric ruler/bar table. Authored graphical
settings that these forms cannot preserve receive feature-specific projection
diagnostics. A compositor does not by itself fix SVG title geometry, ER source
serialization order, or structured-edit admission contracts.
