# Quadrant Chart — Design Notes

## Overview

The quadrant family renders Mermaid `quadrantChart` diagrams through the same
parse → layout → render pipeline used elsewhere in Agentic Mermaid, with SVG,
PNG, and ASCII output routed through the public entry points and a structured
agent body (`asQuadrant`) for typed mutation.

Supported surface:

- title, `x-axis`/`y-axis` labels (near side required, far side optional)
- `quadrant-1..4` region labels (Mermaid numbering: 1=TR, 2=TL, 3=BL, 4=BR)
- points `Label: [x, y]` with normalized coordinates in `[0, 1]`
- **per-point styling** (upstream merged mermaid-js/mermaid#5173): direct
  `radius:`/`color:`/`stroke-color:`/`stroke-width:` tails, `classDef` tables,
  and `:::class` assignments — parsed, resolved, and rendered
- the documented `quadrantChart` config section, wire-or-warn (see below)
- hover tooltips via the shared `interactive` RenderOptions affordance
- Mermaid accessibility directives (accepted; no dedicated aria slot yet)

Faithfulness contract: malformed lines — out-of-range coordinates, missing
brackets, unknown statements, malformed or unknown style metadata — ERROR
LOUDLY. Nothing is silently dropped.

## Per-point styling (upstream #5173)

The style grammar and the precedence rule live in ONE module,
`src/quadrant/point-style.ts`, consumed by four surfaces so they cannot drift:

- the renderer parser (`src/quadrant/parser.ts`) — loud errors on malformed
  entries;
- the agent body (`src/agent/quadrant-body.ts`) — the same grammar; a tail the
  grammar rejects falls back to a lossless opaque body (the render path then
  errors loudly);
- the layout (`src/quadrant/layout.ts`) — `resolvePointVisual` is the single
  resolution site: **direct styles > class styles > config/theme defaults**
  (upstream's documented order). Resolved radius drives geometry (circle,
  label gap, collision boxes);
- the SVG renderer (`src/quadrant/renderer.ts`) — paints the resolved
  fill/stroke/stroke-width; it never re-resolves styles.

Rendering details:

- resolved fills/strokes are emitted as an inline `style=""` attribute so
  they win over the `.quadrant-point` stylesheet rules; unstyled points keep
  byte-identical markup to the pre-styling renderer;
- `:::class` names are additionally emitted as SVG CSS classes on the circle
  (`class="quadrant-point class1"`), following the flowchart convention, so a
  point referencing an unknown classDef still exposes its class to external
  stylesheets — upstream-parity no-op, never a silent discard;
- value validation is conservative (numbers for radius, `Npx` for
  stroke-width, a safe CSS-color charset for colors) because values land in a
  style attribute;
- the agent serializer emits a canonical form (`radius, color, stroke-color,
  stroke-width` order; classDefs after points) that the renderer parser
  re-parses identically (differential-tested), so styled bodies round-trip
  stably and every mutation op preserves classes/styles it does not touch.

ASCII output plots glyphs only (no color channel for point styling); the
legend still lists every point. Scene-IR marks carry the resolved paint.

## Config — wire-or-warn (C3)

`src/quadrant/config.ts` is the single wire-or-warn table for the documented
QuadrantChartConfig (config-defs-quadrant-chart-config.html):

**Wired** (`QUADRANT_WIRED_CONFIG_FIELDS`): `chartWidth`, `chartHeight`
(canvas size; the square plot side derives after fixed chrome),
`titleFontSize`, `titlePadding`, `quadrantPadding`, `quadrantLabelFontSize`,
`xAxisLabelFontSize`, `yAxisLabelFontSize`, `xAxisLabelPadding`,
`yAxisLabelPadding`, `pointLabelFontSize`, `pointRadius`, `pointTextPadding`,
`quadrantInternalBorderStrokeWidth`, `quadrantExternalBorderStrokeWidth`,
and base `useMaxWidth` (responsive root, xychart parity).

**Not wired** (`QUADRANT_NOOP_CONFIG_FIELDS`): `xAxisPosition`,
`yAxisPosition` (axes always render bottom/left), `quadrantTextTopPadding`
(region labels are centered, never top-anchored), and base `useWidth`. Each
present-but-unwired key emits the `INEFFECTIVE_CONFIG` Tier-3 lint from
`verifyMermaid` (P4: documented limitation ⇒ runtime diagnostic), reading both
frontmatter and `%%{init:…}%%` directives.

Absent config keeps the historical defaults (380px plot, 13px axis text,
24px padding) — upstream's larger defaults are not imposed retroactively.
Config feeds `quadrantStyleDefaults`, which both layout and renderer resolve
through `resolveRenderStyle`, so explicit RenderOptions style faces still win
and measurement always uses the font the SVG draws (this closed a latent
mismatch where layout measured point labels at 13px while the renderer drew
12px). The resolved config rides on the positioned chart (`chart.visual`) so
the renderer reads the same values the layout used. `verify`'s quadrant
layout (`src/agent/family-layouts.ts`) resolves the same config from
`meta.frontmatter`.

## Dense-cluster label placement

Placement is a pure, deterministic function of point geometry (identical
input → identical placement). Per point, in source order:

1. **ring 0** — right → left → below → above of the circle (the historical
   slots; sparse charts keep their exact geometry);
2. **spiral** — 10 outward rings × 16 angles (horizontal-first order),
   connected to the point by a leader line (`.quadrant-leader`);
3. **hidden** — when nothing clears, the label hides; earlier source order
   wins. The hidden label stays on the model (`labelHidden`, `data-label`,
   tooltips) — it is only not drawn.

A slot must clear every already-placed label box, every point circle, every
quadrant region label, and the canvas bounds. The positioned point exposes
its `labelBox` so invariants are testable without re-deriving text metrics.

Plot sizing is density-scaled when unconfigured: 380px through 8 points, then
+20px per extra point, capped at 720px. Explicit `chartWidth`/`chartHeight`
win over density scaling.

Invariant gates (P5 — these judge, snapshots only pin): no two visible
point-label boxes overlap; every visible box stays in-canvas; labels never
sit on foreign point circles; placement is byte-deterministic; property-
fuzzed up to 25 points (`quadrant-dense-labels.test.ts`).

Known limitation: leader LINES are not obstacle-checked, so a leader may
cross a region label or another leader on very dense charts (labels
themselves never overlap).

## Interactive tooltips

`renderMermaidSVG(src, { interactive: true })` wraps each point in a
`quadrant-point-group` hover target (enlarged transparent hit circle) with a
native `<title>` and a styled tooltip (`Label: [x, y]`). The machinery is the
shared primitive `src/shared/svg-tooltip.ts`, extracted from xychart — with
prefix `xychart` it reproduces the historical xychart strings byte-for-byte,
so both families ride one implementation. Default (non-interactive) output is
byte-unchanged.

## Scene-IR text fidelity

The quadrant point-label marks carry their REAL collision-aware position
(`labelX/labelY/labelAnchor`) in the scene IR. The fidelity oracle
(`src/scene/fidelity.ts`) was extended once, generically, to compare text
`x`/`y`/`text-anchor` between semantic fields and crisp serialization
(0.5px slack; missing `text-anchor` = SVG's `start` default), killing the
drift class where a lowering claimed one label position while the crisp SVG
drew another. Styled backends redraw from semantic fields, so the styled
quadrant goldens moved when this was fixed — the styled looks now place
labels where the crisp renderer does.

## Verification

- `verifyQuadrant` (structured body): `EMPTY_DIAGRAM` floor, universal
  `LABEL_OVERFLOW` over title/axes/region/point labels.
- `verifyOpaqueQuadrant`: opaque bodies carrying style-looking metadata warn
  with the specific `quadrant_point_style_metadata` /
  `quadrant_classDef_metadata` `UNSUPPORTED_SYNTAX` reasons (these fire only
  when styles ride an opaque body — well-formed styling parses structured).
- `INEFFECTIVE_CONFIG` for the unwired config keys (see above).
- Tier-2 geometry (group containment) via the real positioned layout.

## Test map

- `quadrant.test.ts` — parser happy/sad paths, geometry, SVG/ASCII
  integration, agent surface, properties.
- `quadrant-style.test.ts` — styling end to end (parser, resolution
  precedence, layout radii, rendered attributes vs classDef, structured
  body round-trip + legacy differential, op preservation).
- `quadrant-config.test.ts` — wired-key effects, INEFFECTIVE_CONFIG,
  wired/noop partition vs the documented schema, density-scaled sizing.
- `quadrant-dense-labels.test.ts` — placement invariants, hiding priority,
  leader lines, determinism, property fuzz.
- `quadrant-interactive.test.ts` — tooltip affordance + shared-primitive
  byte-parity with xychart.
- `scene-text-fidelity.test.ts` — the oracle's text x/y/anchor checks and
  quadrant lowering faithfulness.
- `agent-quadrant.test.ts` — structured mutation, structured-or-opaque
  fallback, corpus round-trip.
