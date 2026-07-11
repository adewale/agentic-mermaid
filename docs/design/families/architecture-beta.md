# Architecture Diagrams (`architecture-beta`) Design Notes

## Overview

Architecture support follows the same parse -> layout -> render split used by the other specialized diagram families, while intentionally reusing the shared graph layout engine for node and group placement.

Current scope covers:

- `group`, `service`, and `junction`
- side-anchored edges (`L`, `R`, `T`, `B`)
- `{group}` boundary routing for services inside groups
- visible `title ...` header furniture, including title-only diagrams
- `align row|column` directives (upstream v11.16.0) — parsed, modeled,
  round-tripped losslessly, and honored as placement constraints
- multi-line labels via `<br>` / `\n`
- SVG, PNG, and ASCII output (PNG via the shared SVG rasterization pipeline)

## Pipeline

### Parse

`src/architecture/parser.ts` builds a typed architecture model from Mermaid source and then converts it into the shared `MermaidGraph` shape for placement. The parser keeps Mermaid-oriented field names (`group`, `service`, `junction`, boundary anchors) and validates boundary edges up front so unsupported forms fail clearly.

### Layout

`src/architecture/layout.ts` delegates node and group placement to `layoutGraphSync()` through `architectureToMermaidGraph()`, then projects the positioned graph back into architecture-specific primitives.

Architecture-specific work happens after shared placement:

- services keep their card bounds from the graph layout
- junctions reuse the graph point-node placement
- group-boundary edges are rerouted against the enclosing group frame
- edge labels use the orthogonal polyline midpoint so labels stay on-path

### Render

`src/architecture/renderer.ts` renders architecture-specific SVG primitives rather than generic flowchart boxes:

- visible diagram-title header furniture with an accessible-name fallback
- framed groups with header bands
- service cards with accent rails
- junction rings
- architecture-specific arrow markers and semantic `data-*` hooks
- lightweight icon badges with a fallback glyph path

## Align directives (upstream v11.16.0)

Upstream PR #7708 added `align row|column <id> <id> ...`: the listed
services/junctions share a row (same y) or column (same x), fed to fcose as
relative-placement constraints. The shipped contract here (plan §Architecture
item 2, option (b)):

- **One shape parser** — `src/architecture/align.ts` owns the directive's
  grammar (axis keyword, ≥2 members, no duplicate members) and canonical
  serialization. Both the strict render parser (`src/architecture/parser.ts`)
  and the structured agent body parser (`src/agent/architecture-body.ts`)
  consume it, so the surfaces cannot drift.
- **Upstream-parity validation** — members must be already-declared services
  or junctions (never groups); malformed directives are rejected by the render
  parser exactly where upstream rejects them. In the agent surface a malformed
  directive falls back to a lossless opaque body and verify reports the render
  failure.
- **Lossless round-trip** — alignments are modeled on `ArchitectureBody`
  (`alignments`), serialized after edges (declaration-before-use by
  construction), and survive serialize→re-parse byte-stably. `rename_service`
  rewrites members; `remove_service` drops the member and dissolves any
  directive left with fewer than two members (the edge-cascade idiom).
- **Deterministic geometry constraint** — after layered placement establishes
  stable source order, `src/architecture/layout.ts` gives row members one
  center-y or column members one center-x and packs them on the free axis with
  configured node spacing. This happens before group bounds and edge routes
  freeze, so containment and side anchors reflect the aligned geometry. Verify
  no longer emits `architecture_align`; geometry tests pin shared centers and
  sibling non-overlap.

## Runtime config (wire-or-warn, plan §Architecture item 3 / X7)

`src/architecture/config.ts` is the single wire-or-warn table for the
documented `architecture.*` keys:

| Key | Status | Mapping |
|---|---|---|
| `padding`, `iconSize`, `fontSize` | wired | visual metrics (pre-existing) |
| `nodeSeparation` | wired | same-layer sibling spacing in px (`RenderOptions.nodeSpacing` fallback — the class/er `nodeSpacing` pass-through idiom; explicit RenderOptions win) |
| `idealEdgeLengthMultiplier` | wired | layer gap scaled around upstream's `1.5` default: `round(56 × m / 1.5)` — upstream defines it as ideal same-group edge length, and the layer gap is the deterministic edge length between connected ranks |
| `edgeElasticity`, `numIter`, `seed`, `randomize` | lint | fcose force-simulation knobs with no meaning in a deterministic layout; each present key is named by verify's Tier-3 `INEFFECTIVE_CONFIG` (`ARCHITECTURE_NOOP_CONFIG_FIELDS`) |

`resolveArchitectureRenderOptions()` folds the wired keys into RenderOptions
and is consumed by BOTH the SVG render hook and verify's layout adapter
(`src/agent/family-layouts.ts`), so `verify.layout` stays truthful under
config. The typed section shape is `ArchitectureRuntimeConfig` in
`src/mermaid-source.ts`.

## Explicitly deferred (later phases of the family-elevation plan)

These are documented boundaries, not omissions — each is a named item in
`docs/design/family-elevation-plan.md` §Architecture:

- **Port routing / obstacle avoidance (item 1):** per-edge sides as placement
  constraints and routes that avoid node/group interiors, plus
  anchor-faces-partner verify tripwires.
- **Agent-surface junctions, group labels, in-place edge ops (item 4):**
  `{group}` edges and accTitle/accDescr still fall back to opaque bodies.
- **Iconify icons with a dignified fallback (item 5):** unknown icons still
  degrade to the fallback glyph badge.
- **Spatial ASCII architecture (item 6):** ASCII output remains an indented
  outline with an edge list, not a spatial rendering.

## Compatibility Notes

- Mermaid's current public header for this diagram family is `architecture-beta`, so that is the supported header.
- Leading Mermaid comments (`%% ...`), YAML frontmatter, and Mermaid init directives before the header are stripped by the public SVG/PNG/ASCII/agent entrypoints before they call `parseArchitectureDiagram()`.
- The public architecture renderers interpret the merged wrapper config for a focused subset of Mermaid semantics:
  `theme`, `themeVariables`, `fontFamily`, `fontSize`, and `architecture.padding` / `architecture.iconSize` / `architecture.fontSize` /
  `architecture.nodeSeparation` / `architecture.idealEdgeLengthMultiplier` (see the wire-or-warn table above).
- `parseArchitectureDiagram()` expects preprocessed `architecture-beta` body lines; wrapper config is intentionally handled outside the parser because the parser returns only the diagram model.
