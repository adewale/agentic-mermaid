# Event Modeling: composition and visual contract

The aesthetic thesis is **follow information through time without losing its lane**.
Every authored frame gets a chronological column; repeated namespace/type lanes
retain their identity. Reset frames break inference, and explicit inputs remain
visible causal connections. Labels and payloads get measured space before drawing.

This is a native consumer of the composition delivered by [#409](https://github.com/adewale/agentic-mermaid/issues/409).
It introduces no general layout framework or second rendering registry.

| Contract | Existing authority reused | Event Modeling's responsibility |
|---|---|---|
| Preserve meaning before projection | `EventModelingBody`, parser observations, checked edits | Frame IDs/order, explicit versus inferred references, payload/note/GWT ownership; `eventLanes` and `eventRelations` feed graphical, facts and terminal consumers |
| Measure once and retain it | `shared/prepared-text.ts`, `resolveRenderStyle` | Layout retains the actual frame/lane blocks and resolved face; the drawing consumes those same blocks |
| Keep placement domain-specific | Existing family layout hook | Chronological columns, measured lane headers, namespace return and reserved vertical padding; pixel placement is not reused as terminal cells |
| Share connector geometry | `scene/connector-geometry.ts`, also used by Requirement and other families | Route the domain relation; retain the rounded path's actual points and endpoint contours for both inspection and painting |
| Share drawing and output | `DrawingFactory`, `sceneLowering`, `shared/scene-document.ts`, marker resources | Emit typed node/group/edge/text marks with authored identities, lane parent references and relation endpoints |
| Reuse the terminal compositor | `convertToAsciiGraph`, `drawGraph`, `TerminalDocument` | Project the same frames/relations and literal labels into a named-lane graph; do not claim pixel swimlane geometry |
| Retain enforcement and delivery | Existing positioned view, graphical pipeline, registry and lazy loader | Expose measured bounds/parents/paths and exercise shared security, certification, determinism and payload checks |

The document shell is also used by Packet, Kanban, Treemap and Ishikawa.
Prepared text is used throughout the native families. Rounded connector projection
is the existing Requirement/graph mechanism. The native additions are domain
semantics and placement, not copies of those lower-level implementations.

## Style and palette consumption

Frames use the existing `node` role, lane containers use `group`, relations use
`edge`, and labels keep their owning frame/lane. Shared backends therefore apply
crisp, hand-drawn and watercolor treatments. Palette colors pass through the
existing `DiagramColors` and fill-ink resolver. Monochrome structural defaults
are deliberate: frame type is already explicit text and lane membership, rather
than an invented numerical series requiring a category legend.

Node padding/radius/line/fill/text, group typography/padding/header fill and
connector bend radius are consumed through the shared resolved face. Header
and node ink use their actual fills. Layout and drawing consume the same
rounded path. `data-parent` preserves lane ownership in SVG independently of
visible proximity. Source IDs, data and references remain semantic identities
when a style changes their appearance.

Multiple incoming and outgoing relations receive deterministic vertical port
slots. Node height reserves at least 12px between adjacent arrow approaches;
thicker edge strokes increase that spacing. A single relation keeps its center
port. This prevents two declared inputs from painting one coincident arrowhead.
The same retained slot endpoints feed positioned output, rounded connectors and
SVG. Owning tests inspect actual arrow pixels for reciprocal/backward routes and
a twelve-input reset frame, as well as the declared identities and bounds.
Ports dock outside the centered node outline using the existing
`paintedStrokeExtent` calculation for flat sides. Text insets, lane margins and
gutters reserve that stroke extent before drawing. Crisp raster regressions
exercise 20px outlines, matching and contrasting edge colors, and rounded
two-input routes; repainting arrows over node borders is not the repair.

The existing styled-output golden workflow includes the same three-frame input
in patent-drawing, hand-drawn × GitHub Light, hand-drawn × Dracula and watercolor
× Solarized Light. Comparing the two hand-drawn renders isolates the palette
change; comparing the looks exposes different stroke/fill treatment. The broader
registry-derived render portfolio owns Look/Palette interaction coverage. The
chart-honesty pixel tests own legibility, canvas bounds, presence and unchanged
words across registered styles. Goldens detect change; visual review is still
required and is agent review unless a human is named.

The domain-rich citizenship fixture combines namespace return, both reset and
ordinary frames, two explicit sources, a referenced multiline payload, a note
and a Given/When/Then specification. Its typed edit changes the payload while
independent checks retain frame identity, ownership and relationships.

That existing rich fixture also supplies reviewed hand-drawn × GitHub Light,
hand-drawn × Dracula and watercolor × Solarized Light goldens. It is not copied
into a separate gallery. Independent SVG checks inspect owned payload/note/GWT
text, namespace lane membership and both reset inputs after a checked data edit.

## Correctness and performance evidence

The original pinned Event inventory collects both files: fifteen parser cases
and twenty-five source-type rule cases pass against their actual pinned
controls. The rule adapter calls the production authority used by native
verification; its receipts retain actual target/source types and no invented
parser inputs. The reference executes the unchanged pinned validator itself.
Only the private Langium validation-registry wiring case remains unavailable
on the native side; its reference control passes. The parser adapter projects
actual native frames, reset flags, source references and owned record counts,
retaining an authored type spelling only when it denotes the native type. It
supplies no DOM geometry or text measurements.

Source-type lint follows explicit authored inputs: commands receive UI or
processor inputs, events receive commands, read models receive events, and
processors/UI receive read models. Each invalid input produces an advisory
`EVENT_SOURCE_TYPE` warning identifying source and target. Native parsing and
rendering retain the connection; inferred chronological relations do not claim
an explicit source type and do not receive this lint.

An exploratory Chromium source profile attributes most small-diagram work to
shared request admission, drawing, security and paint certification, rather than
family placement. Its instrumented timings are diagnostic, not peer scores.
The family scanner did separately show quadratic growth on a valid frame with
long leading whitespace: it repeatedly sliced and trimmed the same physical
line. Incremental line tracking removes that repetition while retaining exact
authored offsets. Comment-only prefixes remain whitespace, so a following title
retains a literal URL instead of treating its `//` as a comment. The existing
relative-growth guard protects this bounded-work
contract; timing campaigns remain in Trident and outside CI.

## ZenUML and its separate upstream control

Native ZenUML retains its own authored call/return/branch model and checked edits,
then projects directly to existing Sequence geometry, Scene and terminal owners.
It has no vendor DOM dependency. The explicit upstream browser renderer remains
a separate control using pinned core and its own paint mapping. That upstream
path consumes shared palettes and supported paint colors while retaining vendor
geometry and typography; it does not supply the native editing or Scene
contract. Report its capability limits separately from native ZenUML evidence.

## Limits

The selected fixtures do not establish readability at arbitrary density or every
authored stroke-width/Look interaction. Native shape geometry and sketch
backends have different paint realization limits; named-look goldens and crisp
stroke-boundary raster checks qualify their stated finite inputs separately.
They do not create a family-specific exemption from shared paint certification.

Original pinned Mermaid assertions, curated semantic/operation gates and
Davebench acceptance/timing are separate reports. Green CI does not mean the
whole original assertion inventory passes, and an accepted SVG is not a
perceptual-quality score. The PR must show the actual counts and peer results.
