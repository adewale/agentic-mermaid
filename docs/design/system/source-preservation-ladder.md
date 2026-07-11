# Source preservation ladder

Status: implemented as the Agentic Mermaid family-adoption contract.

Agentic Mermaid edits source, not just pictures. Every family must declare how
much source it can model and what happens when it encounters syntax outside the
modeled subset. Silent loss is never an acceptable level.

## Levels

| Level | Name | Contract |
|---|---|---|
| L0 | reject/fail loud | The construct is not safely renderable/editable. Parsing or verification returns a named error/warning; no partial IR is serialized as if it were complete. |
| L1 | whole-body opaque | The family header is recognized, but the body is preserved byte-for-byte as opaque source. Typed narrowers return `null`; render/verify may use a safe legacy/family parser. |
| L2 | segment-preserving mixed body | Modeled statements are typed-editable; unmodeled blocks/directives/comments remain in ordered opaque segments and serialize without silent loss. |
| L3 | canonical structured body | Accepted body syntax is modeled; parse → serialize → parse is stable. Unsupported syntax falls back to L1/L2 or fails loud. |
| L4 | traceable structured model | L3 plus stable source spans, rendered regions, and action/analysis sidecars for load-bearing semantic objects. |

## Construct policy

| Construct class | Required behavior |
|---|---|
| Frontmatter / init directives / leading comments | Preserved in `meta.wrapperSource` and re-emitted verbatim by default; canonical wrapper synthesis is opt-in. |
| In-body comments | Preserved by opaque bodies; structured bodies must either preserve them or report `COMMENT_DROPPED`. |
| Unknown family syntax | Use L1 opaque preservation when rendering remains safe; otherwise L0 named failure. |
| Mermaid v11 `@{ ... }` metadata | Must not create phantom nodes or silently drop targets. Current safety floor preserves opaque/unsupported forms and consumes supported label metadata conservatively. Full typed-shape vocabulary remains separate (#44). |
| Actions/clicks | Never execute during parse/render/analysis. Preserve source intent and expose source-only metadata where modeled. |
| Render regions | Stable IDs are required for L4 claims; V1 region coverage may be partial but must be documented and tested. |

## Current family levels

| Family | Body preservation level | L4 traceability status |
|---|---|---|
| flowchart | L3 for modeled graph syntax; L1 for unsupported syntax/metadata forms | Partial L4: nodes/edges/groups/labels/source map, route certs, action analysis, region MVP |
| state | L3 structured body including concurrency regions and paint | Partial L4 via graph projection, source map, route certs, region MVP |
| sequence | L2 segment-preserving structured body | Partial L4: participants/messages layout + lifeline certificates |
| timeline | L3 structured body with opaque fallback | Partial L4: sections/periods/events layout regions/certs |
| class | L3 structured body including namespaces/generics/paint | Partial L4: classes/members source map, geometry validators, orthogonal-box certs |
| er | L2/L3 ordered typed/opaque segments including direction/paint | Partial L4: entities/attrs/cardinalities source map, geometry validators, orthogonal-box certs |
| journey | L3 structured body with opaque fallback | Partial L4: sections/tasks regions/source map |
| architecture | L3 structured body | Partial L4: groups/services/junctions/side-anchored certs |
| xychart | L3 structured body with opaque fallback | Partial L4: plot/marks/labels source map + containment certs |
| pie | L3 structured body with opaque fallback | Partial L4: slices/legend source map + containment certs |
| quadrant | L3 structured body with opaque fallback | Partial L4: quadrants/points source map + containment certs |
| gantt | L2/L3 structured body with schedule resolver and named schedule errors | Partial L4: sections/tasks source map, schedule analysis, containment certs |
| mindmap | L3 indentation-sensitive structured tree; duplicate identities fail loud at L0 | Partial L4: node/edge projection and deterministic regions |
| gitgraph | L3 replayed structured history; invalid replay and duplicate ids fail loud at L0 | Partial L4: commit/parent projection and deterministic regions |

## Reviewer rule

A family may advance levels incrementally, but it may not regress silently. New
syntax support must add one of: typed modeling, opaque preservation, or a named
failure with docs/tests. Mutation APIs require L3 for the affected construct;
agents must verify before serializing.
