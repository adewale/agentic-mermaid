# What is different about this fork?

This document describes **Agentic Mermaid**, the `adewale/beautiful-mermaid` fork, relative to upstream `lukilabs/beautiful-mermaid`. It is intentionally product/documentation focused; upstreamable changes should still be split into small PRs.

## Live site

The canonical live site is **[agentic-mermaid.dev](https://agentic-mermaid.dev/)** — a Cloudflare Workers Static Assets deployment built from [`website/`](../website):

- Home & docs: <https://agentic-mermaid.dev/>
- Live editor: <https://agentic-mermaid.dev/editor>
- Family comparisons (Mermaid vs Beautiful Mermaid vs Agentic Mermaid): <https://agentic-mermaid.dev/comparisons/>

Alongside the static surface (the public website, machine-readable manifests, schemas, recipes, and skill files), the Cloudflare Worker serves a stateless hosted MCP endpoint at `/mcp` (`https://agentic-mermaid.dev/mcp`) — six tools including Code Mode `execute` in per-request Dynamic Worker isolates. There is still no REST render API: `/mcp` speaks MCP JSON-RPC only.

GitHub Pages is no longer a deployed surface; its samples-gallery generator has been retired. The live editor is served at [agentic-mermaid.dev/editor](https://agentic-mermaid.dev/editor) and built by `scripts/site/editor.ts` (also used by `website/build.ts`), and is exercised in a real browser by `e2e/browser.test.ts`.

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

The live editor has registry-backed example coverage for every built-in family
(`src/__tests__/editor-examples.test.ts`). Browser E2E still spot-checks several
fork-added rendering paths: architecture, timeline, journey, and xychart.

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

1. The [live gallery](https://agentic-mermaid.dev/), especially **Contents → Role Styles**.
2. The [live editor](https://agentic-mermaid.dev/editor), which starts blank and has **Examples** for every supported diagram family plus role-style presets.
3. [`README.md`](../README.md) quick starts and docs routing.
4. [`CHANGELOG.md`](../CHANGELOG.md) for user-facing change history.

## Layout and quality work

- A layout before/after comparison harness (`eval/layout-compare/`) and per-family `RenderedLayout` adapters so perceptual metrics gate layout changes with evidence. Debug JSON can also expose opt-in graph route certificates, family edge-route certificates, region-containment certificates, and region/action sidecars for tooling; default JSON stays compact.
- Still different from the current upstream release (Beautiful Mermaid 1.1.3): decision-branch routing emits a diamond's branches from facet-mid ports as mirror-symmetric routes (the layout symmetry floor), and an edge to a subgraph attaches to its container with `direction` overrides honored inside it — a case upstream 1.1.3 still mis-routes (`mermaid-js/mermaid#2509` leaves it unsolved). Both are shown side by side on the [differences page](https://agentic-mermaid.dev/comparisons/).
- Already upstreamed: fan-in grouping (upstream #68/#69) and labeled fan-out trunk sharing with box-start connector placement (#111/#112/#113, upstream PR #113) landed here first and now render identically in Beautiful Mermaid 1.1.3 — they are no longer fork-only.
- ER cardinality parsing matches Mermaid's lexer exactly; malformed relationship lines error loudly instead of being silently dropped.

## Parser and semantic divergences from Mermaid.js

- **Subgraph membership is *first-defined-wins*.** A node belongs to the subgraph
  where it is **first defined**, and a top-level reference counts as a definition —
  so a node referenced at the top level and then listed inside a subgraph block
  stays at the top level. Mermaid.js instead lets the subgraph *block* claim any
  node it lists, regardless of a prior top-level reference. In the canonical Mermaid
  docs example:

  ```mermaid
  flowchart TB
      c1-->a2
      subgraph one
      a1-->a2
      end
      subgraph two
      b1-->b2
      end
      subgraph three
      c1-->c2
      end
  ```

  Mermaid.js places `a2` inside `one` and `c1` inside `three`; this fork keeps `a2`
  and `c1` at the top level (only `a1`/`c2` are inside those subgraphs). See it both
  ways: [open in Mermaid Live](https://mermaid.live/edit#pako:eNp10DELwjAQBeC_Et7cDjpmcBBXJ50kyzW5NoU2V9KEIqX_XbSoRXB87z44eDOsOIZG3clkPcWkrkcTlFLK7sryQPs1jLlqIg1eSeC1oe2Zg_txaZK1qZ6u-u98ZN48tF-JAj3HnloHjdkgee7ZQBs4ril3yWBBAcpJLvdgoVPMXCBKbjx0Td3IBfLgKPGppSZS_yYDhZvIJ7Jrk8TzOsRrj-UBwvBYkQ)
  · [open in the fork editor](https://agentic-mermaid.dev/editor#eyJzb3VyY2UiOiJmbG93Y2hhcnQgVEJcbiAgICBjMS0tPmEyXG4gICAgc3ViZ3JhcGggb25lXG4gICAgYTEtLT5hMlxuICAgIGVuZFxuICAgIHN1YmdyYXBoIHR3b1xuICAgIGIxLS0+YjJcbiAgICBlbmRcbiAgICBzdWJncmFwaCB0aHJlZVxuICAgIGMxLS0+YzJcbiAgICBlbmQifQ==).

  This is a deliberate divergence, not a bug: it gives deterministic
  *definition-scope* membership with no surprising re-parenting when a node is
  mentioned again inside a container, consistent with the fork's goal of
  predictable, source-preserving behavior rather than Mermaid pixel/layout parity
  (see [#38](https://github.com/adewale/beautiful-mermaid/issues/38)). Mermaid's own
  users report *its* behavior as a bug (`mermaid-js/mermaid#738`, `#2707`). The rule
  is inherited from upstream Beautiful Mermaid (introduced in its v1.0.0 rewrite),
  not fork-invented, and is guarded by `src/__tests__/parser.test.ts` — a node
  genuinely defined inside one subgraph and later referenced inside another
  likewise stays in its first subgraph (it is never re-parented by a mere
  reference).

## What is intentionally not in this fork

- No committed `dist/` artifacts.
- No large bundled upstream PR: upstream contributions should remain focused and independently reviewable.

## Upstreaming strategy

The fork should continue extracting small upstreamable PRs from broad fork work. This file is not the backlog: parked fork-port ideas live only under `PARK-3` in `TODO.md` until one is promoted to a focused issue.
