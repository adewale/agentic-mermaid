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

`src/architecture/layout.ts` starts from deterministic layered placement and then solves Architecture-specific constraints before geometry freezes:

- side declarations constrain the lowest-common-container sibling units; connected components move together and legal contradictory constraints remain renderable with `placement: 'conflicted'`;
- services and junctions expose the authored `L`/`R`/`T`/`B` anchors, including group-boundary endpoints;
- deterministic visibility-grid Dijkstra routing avoids every foreign service, junction, and group interior while minimizing length, then bends, with stable tie-breaking;
- each route carries a certificate separating placement from route validity: `placement`, `sourceFacesTarget`, `targetFacesSource`, and `obstacleFree`;
- group bounds and edge-label midpoints are recomputed from the final constrained geometry.

### Render

`src/architecture/renderer.ts` renders architecture-specific SVG primitives rather than generic flowchart boxes:

- visible diagram-title header furniture with an accessible-name fallback
- framed groups with header bands
- service cards with accent rails
- junction rings
- architecture-specific arrow markers and semantic `data-*` hooks
- native handcrafted icon paths plus the bounded offline curated registry in `src/architecture/icons.ts`; unknown names use an escaped fallback badge

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

## Completed elevation contracts

- **Typed editing:** services, junctions, groups, group labels, accessibility,
  ordinary and `{group}` endpoints, moves, and in-place edge updates are all
  structured. Moving a service referenced by a group-boundary edge is refused
  unless the caller explicitly updates that boundary, so preserved semantics
  cannot become stale silently.
- **Offline icons:** `src/architecture/icons.ts` resolves curated MDI paths
  without network, filesystem, dynamic import, or raw SVG. Inputs are bounded
  by `ARCHITECTURE_ICON_LIMITS` (`maxIcons: 32`, `maxNameBytes: 128`,
  `maxPathBytes: 4096`), paths-only, sanitized, deterministic, and attributed
  in `THIRD_PARTY_NOTICES.md`. Native icon bytes remain unchanged.
- **Spatial terminal output:** `src/ascii/architecture.ts` projects services,
  junctions, nested groups, side/boundary routes, and labels onto a
  grapheme/display-cell canvas. Unicode and 7-bit modes share topology and
  honor the hard `targetWidth` contract.

Executable gates: `architecture-layout.test.ts`,
`architecture-integration.test.ts`, `agent-architecture.test.ts`,
`architecture-icons.test.ts`, and `architecture-ascii.test.ts`.

## Compatibility Notes

- Mermaid's current public header for this diagram family is `architecture-beta`, so that is the supported header.
- Leading Mermaid comments (`%% ...`), YAML frontmatter, and Mermaid init directives before the header are stripped by the public SVG/PNG/ASCII/agent entrypoints before they call `parseArchitectureDiagram()`.
- The public architecture renderers interpret the merged wrapper config for a focused subset of Mermaid semantics:
  `theme`, `themeVariables`, `fontFamily`, `fontSize`, and `architecture.padding` / `architecture.iconSize` / `architecture.fontSize` /
  `architecture.nodeSeparation` / `architecture.idealEdgeLengthMultiplier` (see the wire-or-warn table above).
- `parseArchitectureDiagram()` expects preprocessed `architecture-beta` body lines; wrapper config is intentionally handled outside the parser because the parser returns only the diagram model.
