# What is different about this fork?

This document describes **Agentic Mermaid**, the `adewale/beautiful-mermaid` fork, relative to upstream `lukilabs/beautiful-mermaid`. It is intentionally product/documentation focused; upstreamable changes should still be split into small PRs.

## Fork-owned live sites

- GitHub Pages gallery: <https://adewale.github.io/beautiful-mermaid/>
- GitHub Pages live editor: <https://adewale.github.io/beautiful-mermaid/editor>

This repo owns the GitHub Pages deployment. The Craft/Cloudflare site is upstream-owned and is not a deployment target for this fork.

## Agent-native workflow (largest fork-vs-upstream gap)

Agentic Mermaid is published as `agentic-mermaid` and adds a typed editing surface for AI agents under the `agentic-mermaid/agent` subpath export, plus an `am` CLI and an `agentic-mermaid-mcp` Code Mode MCP server. The workflow is differentiated from render-only tools: new diagrams may be authored as source then parsed/verified/rendered, while existing structured diagrams should go parse → narrow → mutate → verify → serialize. Journey, XY chart, architecture, and opaque-fallback diagrams round-trip losslessly via preserved source but do not expose structured mutation. Layout is deterministic and verified byte-identical across processes. See [`AGENT_NATIVE.md`](../AGENT_NATIVE.md) and [`Instructions_for_agents.md`](../Instructions_for_agents.md). Upstream has no equivalent.

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

The live editor has E2E coverage for fork-added families: architecture, timeline, journey, and xychart.

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

## What is intentionally not in this fork

- No committed `dist/` artifacts.
- No large bundled upstream PR: upstream contributions should remain focused and independently reviewable.

## Upstreaming strategy

The fork should continue extracting small upstreamable PRs from broad fork work. This file is not the backlog: parked fork-port ideas live only under `PARK-3` in `TODO.md` until one is promoted to a focused issue.
