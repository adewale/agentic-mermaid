# Terminal composition

Every built-in terminal family constructs a `TerminalDocument` through its
existing `FamilyDescriptor.renderAscii` hook. A document contains positioned
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

Text, markers and card surfaces cannot silently be erased by a later route.
Incompatible text/geometry and unrelated collinear route overlaps produce
projection diagnostics with optional zero-based cell coordinates that follow
composition and reflection. Coincident identical markers retain all owners.
Explicitly allocated bundles may share runs and markers. A crossing can have
two independent route owners; a shared printed intersection does not merge
their semantic identities.

Family layouts keep their own constraints. Class and ER share card-face demand,
port allocation, free label rectangles and the existing bounded A* search.
Sequence lays out lexical fragment boundaries, notes and messages in order.
Chart adapters allocate numeric marks and literal labels in their own units.
Reversals move geometry, text blocks, frames and ports while preserving text
reading order; they do not reverse serialized strings.

## Output and metadata

One encoder derives plain, ANSI and HTML text from the drawing. ASCII and
Unicode select family glyphs before encoding. Security checks still apply at
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
- `parentId`, `members`, `from`, `to`, `bundle` and `ports`, when the family
  supplies the corresponding semantic geometry.

Terminal action regions retain their compatible bounds and add `cellSpans`
and parent identities. Generated IDs avoid authored IDs in the same render.
String-only extension hooks remain supported; without a matching captured
drawing, metadata reports `TERMINAL_OWNERSHIP_UNAVAILABLE` instead of inventing
regions. Changing a native hook's returned string likewise invalidates its
captured geometry.

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
