# What is different about this fork?

This document describes **Agentic Mermaid**, the `adewale/beautiful-mermaid` fork, relative to upstream `lukilabs/beautiful-mermaid`. It is intentionally product/documentation focused; upstreamable changes should still be split into small PRs.

## Fork-owned live sites

- GitHub Pages gallery: <https://adewale.github.io/beautiful-mermaid/>
- GitHub Pages live editor: <https://adewale.github.io/beautiful-mermaid/editor>

This repo owns the GitHub Pages deployment. The Craft/Cloudflare site is upstream-owned and is not a deployment target for this fork.

## Agent-native workflow (largest fork-vs-upstream gap)

Agentic Mermaid is published as `agentic-mermaid` and adds a typed editing surface for AI agents under the `agentic-mermaid/agent` subpath export, plus an `am` CLI and an `agentic-mermaid-mcp` Code Mode MCP server (stdio plus opt-in HTTP/SSE transport with managed render artifacts). A render-only library forces an agent to regenerate the whole diagram to change one node; here, new diagrams are authored as source then parsed/verified/rendered, while existing structured diagrams go parse → narrow → mutate → verify → serialize.

Twelve of the twelve families are structured-when-narrowed: flowchart (6 ops), state (8 ops via a dedicated `StateBody` and `asState`), sequence (5 ops, **segment-preserving** — notes/`alt`/`loop` blocks ride along verbatim while the ops stay live), timeline (10), class (10), ER (7), journey (10), XY chart (8), architecture (10), pie (7 via `asPie`), quadrant (7 via `asQuadrant`), and Gantt (9 via `asGantt`). Any unmodeled syntax still round-trips losslessly via preserved source (opaque fallback). Layout is deterministic and verified byte-identical across processes, and `verifyMermaid` returns structured warnings in three tiers (structural, geometric, lint) plus perceptual quality metrics (`measureQuality`) covering every family. See [`AGENT_NATIVE.md`](../AGENT_NATIVE.md) and [`Instructions_for_agents.md`](../Instructions_for_agents.md). Upstream has no equivalent; for a three-way functionality view including Mermaid itself, see [`comparison.md`](./comparison.md).

## New and expanded diagram support

This fork renders a wider set of Mermaid families in both the gallery and editor:

- Flowcharts and state diagrams
- Architecture diagrams (`architecture-beta`)
- Sequence diagrams
- Class diagrams
- ER diagrams
- Timeline diagrams (`timeline`)
- User Journey diagrams (`journey`)
- XY charts (`xychart` and `xychart-beta`)
- Pie charts (`pie`, with `showData`)
- Quadrant charts (`quadrantChart`) — not yet rendered anywhere else in the beautiful-mermaid network
- Gantt charts (`gantt`) with date axes, sections, dependencies, milestones, exclusions, and vertical markers

The live editor has E2E coverage for several fork-added families: architecture, timeline, journey, and xychart.

## Semantic role-based SVG styling

The fork adds a consistent SVG styling API across diagram families:

```ts
renderMermaidSVG(source, {
  style: {
    text: { fontSize: 13, letterSpacing: 0.1 },
    node: { fontSize: 15, paddingX: 22, paddingY: 14, cornerRadius: 16, lineWidth: 1.5 },
    edge: { fontSize: 12, lineWidth: 2.25, bendRadius: 12 },
    group: { fontSize: 12, textTransform: 'uppercase', paddingX: 24, paddingY: 18, cornerRadius: 18 },
  },
})
```

The roles intentionally describe meaning instead of SVG element names:

| Role | Used for |
| --- | --- |
| `style.text` | Shared typography fallback |
| `style.node` | Primary cards, boxes, entities, services, participants, tasks |
| `style.edge` | Connectors, relationships, messages, route labels |
| `style.group` | Subgraphs, groups, sections, bands, containers |

Diagram families only consume roles that their layout and renderer both support. Defaults are preserved when `style` is omitted.

## Mermaid config and source wrappers

This fork supports Mermaid-style source wrappers before diagram headers, including:

- YAML frontmatter
- `%%{init: ...}%%` directives
- `%%{initialize: ...}%%` directives
- Mermaid comments before the header

These are merged with `options.mermaidConfig` where supported. XY chart and architecture rendering use this to honor Mermaid-compatible theme/config fields.

## Showcase and editor discovery

Users can discover fork features through:

1. The [live gallery](https://adewale.github.io/beautiful-mermaid/), especially **Contents → Role Styles**.
2. The [live editor](https://adewale.github.io/beautiful-mermaid/editor), which starts blank and has **Examples** for every supported diagram family plus role-style presets.
3. [`README.md`](../README.md) quick starts and docs routing.
4. [`CHANGELOG.md`](../CHANGELOG.md) for user-facing change history.

## Layout and quality work beyond upstream

- ASCII layout fixes for upstream-reported issues: fan-in grouping (upstream #68/#69), labeled fan-out trunk sharing and box-start connector placement (#111/#112/#113 class), edges to subgraph ids attaching to the container instead of a phantom node, and `direction` overrides inside subgraphs honored even with external links (a case `mermaid-js/mermaid#2509` leaves unsolved).
- A layout before/after comparison harness (`eval/layout-compare/`) and per-family `RenderedLayout` adapters so perceptual metrics gate layout changes with evidence.
- ER cardinality parsing matches Mermaid's lexer exactly; malformed relationship lines error loudly instead of being silently dropped.

## What is intentionally not in this fork

- No committed `dist/` artifacts.
- No large bundled upstream PR: upstream contributions should remain focused and independently reviewable.

## Upstreaming strategy

The fork should continue extracting small upstreamable PRs from broad fork work. This file is not the backlog: parked fork-port ideas live only under `PARK-3` in `TODO.md` until one is promoted to a focused issue.
