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

## Separate optional backend

ZenUML remains an optional browser renderer using pinned upstream core. It does
not lower native Scene marks, consume Agentic styles/palettes or provide typed
editing. Its fixed vendor-theme output and capability limits must be shown
separately; a successful returned SVG does not establish native aesthetics.

## Limits

The selected fixtures do not establish readability at arbitrary density. A
20px explicitly authored node border can hide a small arrowhead in Event
Modeling and existing Flowchart; this is a shared stroke/marker visibility gap,
not a reason to claim that geometry-floor success proves every painted marker.
It is not repaired by a family-specific visual exemption here.

Original pinned Mermaid assertions, curated semantic/operation gates and
Davebench acceptance/timing are separate reports. Green CI does not mean the
whole original assertion inventory passes, and an accepted SVG is not a
perceptual-quality score. The PR must show the actual counts and peer results.
