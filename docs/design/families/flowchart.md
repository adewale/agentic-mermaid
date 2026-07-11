# Flowchart — family contracts

Status: living contract for the flowchart-family elevation
(plan §Flowchart items 3, 6, 7, 8; repo issues #44 and #102).
Last updated: 2026-07-10.

Flowchart is the flagship family: the legacy `src/parser.ts` grammar feeds the
ELK layout engine (`src/layout-engine.ts`), the SceneGraph SVG renderer
(`src/renderer.ts`), the ASCII grid, and the structured agent body
(`src/agent/flowchart-body.ts`). This document records the contracts added by
the elevation; the parser conformance floor lives in
[flowchart-parser-conformance.md](./flowchart-parser-conformance.md).

## Typed runtime config (`flowchart` section) — wire-or-warn

Upstream schema verified 2026-07-10
(mermaid.js.org config schema, FlowchartDiagramConfig).

| Key | Status | Effect |
|---|---|---|
| `nodeSpacing` | **wired** | → `RenderOptions.nodeSpacing` → ELK `spacing.nodeNode` |
| `rankSpacing` | **wired** | → `RenderOptions.layerSpacing` → ELK `nodeNodeBetweenLayers` |
| `wrappingWidth` | **wired** | measured-pixel auto-wrap of node labels at layout sizing |
| `curve`, `htmlLabels`, `padding`, `diagramPadding`, `titleTopMargin`, `subGraphTitleMargin`, `arrowMarkerAbsolute`, `defaultRenderer`, `inheritDir` | **lint** | `INEFFECTIVE_CONFIG` Tier-3 warning naming the field |

- Single wire-or-warn table: `src/flowchart-config.ts`
  (`FLOWCHART_NOOP_CONFIG_FIELDS` lives beside `resolveFlowchartRenderOptions`
  so wire and warn cannot drift). Verify hook:
  `flowchartIneffectiveConfigWarnings` in `src/agent/verify.ts`.
- Explicit `RenderOptions` always win over frontmatter/init-directive config.
- `wrappingWidth` semantics mirror upstream: regular labels wrap **only when
  the key is explicitly configured** (so existing corpus geometry cannot
  drift); **markdown-string labels always wrap** at the upstream default of
  200 (`FLOWCHART_DEFAULT_WRAPPING_WIDTH`). Wrapping reuses the shared
  measured-pixel wrap extracted from the journey layout
  (`src/shared/label-wrap.ts` — P6, no fourth wrap fork). The ASCII renderer
  keeps its cell-width sibling (`src/ascii/wrap.ts`) and does not consume
  `wrappingWidth` (px does not map to cells).
- Wrapping is applied by the flowchart render hook
  (`layoutFlowchartWithConfig` in `src/render-family-hooks.ts`) **before** ELK
  sizing, so layout, renderer, and SVG see the same lines. The `state` family
  shares the base layout hook and reads none of the `flowchart` config section.

## v11.6 edge IDs (`e1@-->`) — stable edge identity

- `MermaidEdge.id` / `PositionedEdge.id` carry the authored ID through
  parse → layout → SVG. The serializer re-emits `id@` verbatim before the
  arrow operator; round-trip is byte-stable for `A e1@--> B`.
- SVG: the edge line carries `data-id="e1"` (the X4 identity contract nodes
  and subgraphs already honor); edges without an authored ID emit no
  `data-id` (byte stability for existing output).
- Ops: `remove_edge.id` and `set_label.target` accept an authored edge ID
  first, then the endpoint forms `from->to` / `from->to#k`
  (`findEdgeIndexById` in `src/agent/flowchart-body.ts`).
- Edge IDs no longer force the opaque agent fallback and the
  `flowchart_edge_id` UNSUPPORTED_SYNTAX lint is retired. Edge **metadata**
  (`e1@{ animate: true }`) remains opaque + `flowchart_edge_metadata` lint —
  animate/curve semantics are upstream-only.

## v11.3+ typed shapes (`@{ shape: ... }`) — repo #44

- **One normalization table**: `src/flowchart-shapes.ts`
  (`FLOWCHART_V11_SHAPES` / `normalizeV11Shape`). Every documented short name
  and alias (48 canonical names; upstream shape table fetched 2026-07-10) maps
  to a canonical id + a rendering geometry from the existing `NodeShape` enum.
- **Exact** mappings (legacy bracket syntax draws the same symbol; no
  warning): `rect`, `rounded`, `stadium`, `cyl`, `diam`, `hex`, `lean-r`,
  `lean-l`, `trap-b`, `trap-t`, `circle`, `dbl-circ`, `fr-rect`, `odd`.
- **Approximate** mappings render the documented nearest geometry and emit
  the Tier-3 `flowchart_shape_substitution` lint naming the substitution
  (one warning per substituted node; never `UNKNOWN_SHAPE` for a documented
  name). Notable approximations: `delay`→rounded, `cloud`→rounded,
  `h-cyl`/`lin-cyl`/`datastore`/`bow-rect`→cylinder, `sl-rect`→lean-r,
  `hourglass`→diamond, `notch-pent`→hexagon, `f-circ`/`sm-circ`/`cross-circ`/
  `bang`→circle, `fr-circ`→doublecircle, `lin-rect`→subroutine,
  `tri`→trapezoid, `flip-tri`→trapezoid-alt, document/process/comment
  variants→rectangle.
- Model: `MermaidNode.shape` stays the drawn geometry; `semanticShape` is the
  canonical v11 id; `authoredShape` preserves the author's spelling, which the
  serializer re-emits verbatim (`A@{ shape: manual-input, label: "User Input" }`).
  The SVG node group adds `data-semantic-shape` beside `data-shape`.
- **Metadata entry grammar is shared**: `parseMetadataEntries` in
  `src/parser.ts` (comma- or whitespace/newline-separated entries,
  quote-aware) is consumed by both the render parser and the agent
  structured/opaque gate (`src/agent/flowchart-unsupported.ts`).
- Structured/opaque boundary: metadata whose keys ⊆ {shape, label} with a
  documented shape name parses **structured**; undocumented shape names,
  `icon:`/`img:` metadata, and extra keys keep the lossless opaque fallback +
  `flowchart_node_metadata` lint (the #29 safety floor: label renders on a
  rectangle, metadata keys never become nodes).
- Ops: `set_shape` (and `add_node.shape`) accept both geometry names and any
  documented v11 name/alias; v11 names set `semanticShape`/`authoredShape`,
  geometry names clear them.

## Markdown strings (`"`…`"`) — repo #102

- The render parser accepts backtick-quoted labels on nodes (any shape,
  single-line; multiline via the quoted-rectangle and shape forms) and on
  edge labels (pipe and text-arrow forms): backticks are consumed and
  `**bold**` / `*italic*` markers render as weighted/italic SVG tspan runs.
  Measurement accounts for bold-run weight, and wrapping rebalances tags per
  line so emphasis cannot leak or disappear across a break.
- Explicit line breaks: real newlines inside the backtick string (and `<br>`)
  become label line breaks. Multiline strings are coalesced pre-parse
  (`coalesceMarkdownStringLines`), joining on `<br>` — the label pipeline's
  canonical break token — so single-line shape grammars keep matching.
- Markdown labels auto-wrap at `flowchart.wrappingWidth` (default 200),
  matching upstream's markdown-only auto-wrap default.
- The agent body stays **opaque** for any backtick source, so the original
  bytes round-trip verbatim; `verify` is clean (render parity passes) with a
  Tier-3 lint explaining that the form is rendered but source-preserved rather
  than structurally mutable.
- A direction-less `flowchart` header now defaults to `TD`, so the exact
  upstream markdown fixture renders and is imported into the executable bench.

## Op menu (plan §Flowchart 8)

14 ops (was 6). New ops follow the journey/gantt conventions — prescriptive
errors, registered in op-schema + mutation-ops + sdk-decl + types:

- `set_shape(id, shape)` — geometry or v11 name/alias.
- `set_direction(direction, subgraph?)` — diagram direction, or a subgraph's
  `direction` override.
- `add_subgraph(id, label?, parent?, members?)` — members are existing nodes
  MOVED into the new subgraph (the state `make_composite` precedent);
  duplicate ids and unknown members reject prescriptively.
- `remove_subgraph(id, removeMembers?)` — default dissolves the box (members
  move to the parent scope, children are promoted); `removeMembers: true`
  deletes member nodes and their edges.
- `move_node(id, subgraph | null)` — null = top level.
- `define_class(name, style)` / `set_node_class(id, className | null)` /
  `set_node_style(id, style | null)` — style strings parse through the
  parser's own `parseStyleProps` (one style grammar); empty parses reject.

Every op round-trips: serialize → render-parse reproduces the edit (P3;
`flowchart-op-menu.test.ts` re-parses through `src/parser.ts`).

## Guards

- `flowchart-runtime-config.test.ts` — wire-or-warn partition, spacing/wrap
  wiring, no-config byte stability.
- `flowchart-edge-ids.test.ts` — id modeling, byte round-trip, SVG data-id,
  op targeting, edge-metadata opacity.
- `flowchart-v11-shapes.test.ts` — full vocabulary coverage against the
  documented table, exact-geometry equivalence with legacy syntax,
  substitution lints, authored-spelling round-trip, opaque fallbacks.
- `flowchart-markdown-strings.test.ts` — styled bold/italic runs and metrics,
  balanced formatting across wraps, explicit breaks, default auto-wrap,
  verbatim opaque round-trip, and the exact #102 sample.
- `flowchart-op-menu.test.ts` — the widened menu, registry + schema + mutator
  + conformance.
- Golden gates: 32 `layout-geometry-baseline.json` and 108
  `svg-output-baseline.json` records regenerated (flowchart records only,
  reviewed record-by-record; the diffs are the modeled shapes/markdown labels
  and the new identity attributes).
