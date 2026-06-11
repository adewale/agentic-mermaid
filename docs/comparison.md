# Mermaid, Beautiful Mermaid, and Agentic Mermaid

Three related projects solve different problems, and each is the right choice
for its job. This page maps the functional differences so you can pick the
right tool — it is a routing guide, not a scorecard.

- **[Mermaid](https://github.com/mermaid-js/mermaid)** (`mermaid`) is the
  original and the standard. It defines the diagram language itself, supports
  by far the most diagram types, and renders anywhere a browser DOM exists.
  Everything else in this table exists because Mermaid made text-to-diagram
  mainstream.
- **[Beautiful Mermaid](https://github.com/lukilabs/beautiful-mermaid)**
  (`beautiful-mermaid`, by Craft) re-implements Mermaid rendering as a fast,
  zero-DOM TypeScript library with first-class theming and ASCII output. It
  proved that a synchronous, browserless renderer with careful visual design
  is possible, and it is the foundation this fork is built on.
- **Agentic Mermaid** (`agentic-mermaid`, this repo) extends Beautiful
  Mermaid for AI-agent workflows: a typed parse → mutate → verify →
  serialize editing loop, deterministic output, structured verification, and
  CLI/MCP surfaces. It trades Mermaid's breadth for editability guarantees.

Facts below reflect Mermaid ~11.15 and the upstream `beautiful-mermaid`
repository as of mid-2026; both projects move quickly, so check their
changelogs for the current state.

## At a glance

| | Mermaid | Beautiful Mermaid | Agentic Mermaid |
|---|---|---|---|
| Primary job | Define and render the diagram language everywhere | Fast, beautiful, browserless rendering | Agent-safe diagram *editing* plus rendering |
| Runtime | Browser DOM (Node via Puppeteer/`mermaid-cli`) | Pure TypeScript, zero DOM, synchronous | Pure TypeScript, zero DOM, synchronous |
| Diagram types | ~25 (flowchart, sequence, class, state, ER, gantt, pie, mindmap, gitgraph, timeline, journey, quadrant, sankey, xychart, block, packet, kanban, architecture, radar, treemap, venn, ishikawa, wardley, treeview, event modeling, …) | 6 (flowchart, state, sequence, class, ER, XY chart) | 11 (those 6 + timeline, journey, architecture, pie, quadrant) |
| Output formats | SVG (PNG/PDF via CLI tooling) | SVG, ASCII/Unicode | SVG, PNG (offline resvg), ASCII/Unicode, JSON layout |
| Theming | Theme config + CSS | Two-color foundation, 15+ named themes, Shiki/VS Code compatibility, live CSS-variable switching | Inherits upstream's system + semantic role-based styling (`style.node/edge/group/text`) |
| Parse to a typed AST for editing | — (internal parser, not an editing API) | — (render-only API) | ✅ `parseMermaid` → typed `ValidDiagram` |
| Typed mutation ops | — | — | ✅ 9 of 11 families (74 ops total), structured-or-opaque, never lossy |
| Structural verification | — | — | ✅ 3 warning tiers + perceptual quality metrics, all families |
| Deterministic output | Not a goal (browser/layout variance) | Mostly stable, not a tested guarantee | ✅ byte-identical across runs/processes, CI-gated |
| Round-trip guarantee (parse → serialize keeps your source) | — | — | ✅ verbatim for unmodeled syntax, canonical for structured bodies |
| CLI | `mermaid-cli` (`mmdc`, Puppeteer-based) | — | `am` (render/verify/mutate/batch/preview/…, single-binary build) |
| MCP / agent surface | Official hosted MCP (validation, PNG, Mermaid Chart integration) | — | Code Mode `execute()` MCP (stdio + HTTP/SSE), `llms.txt`, agent skill |
| Interactivity (click handlers, animations) | ✅ | Partial (tooltips) | Inherited where upstream has it; not a focus |
| Ecosystem & docs | Vast — the de-facto standard, GitHub/GitLab/Notion render it natively | Growing, popular for terminal/AI use | Small; this repo |

## What each does that the others don't

**Only Mermaid:** the full diagram-type catalogue (gantt, mindmap, gitgraph,
sankey, and the 11.x additions like kanban, radar, treemap, venn, wardley,
treeview, event modeling); native rendering inside GitHub, GitLab, Notion,
Obsidian, and hundreds of tools; the grammar itself — both other projects
implement *Mermaid's* language, and compatibility with Mermaid is the
correctness bar they measure against.

**Only Beautiful Mermaid (vs Mermaid):** synchronous, dependency-light
rendering with no browser; a deliberate two-color theming foundation with
enriched palettes and Shiki theme compatibility; ASCII/Unicode terminal
output. Agentic Mermaid inherits all of this — it is upstream's work, and
credit belongs there.

**Only Agentic Mermaid:** the typed editing loop. `parseMermaid` returns a
sealed IR; family narrowers (`asFlowchart` … `asXyChart`) expose typed
mutation ops; `verifyMermaid` returns structured warnings instead of asking
an agent to eyeball pixels; `serializeMermaid` round-trips losslessly
(structured-or-opaque: anything the parser doesn't model is preserved
verbatim, never silently dropped). Plus offline PNG, JSON layout, an `am`
CLI built for agents (exit codes, JSONL batch, `capabilities --json`
self-discovery), a Code Mode MCP server, and tested byte-identical
determinism. None of this exists upstream or in Mermaid, because neither
needed it — it exists for coding agents that edit diagrams programmatically.

## Choosing

- Rendering inside a web app, or you need gantt/mindmap/gitgraph/any family
  beyond the 11 here → **Mermaid**.
- Fast, beautiful SVG/ASCII rendering of the core families in
  Node/Bun/terminal, render-only → **Beautiful Mermaid**.
- An AI agent (or any program) needs to *edit* diagrams safely, verify them
  structurally, or guarantee reproducible output in CI → **Agentic Mermaid**.

## Compatibility notes

Agentic Mermaid aims to parse what Mermaid parses for its supported
families and to reject what Mermaid rejects (e.g. ER cardinality tokens
match Mermaid's lexer exactly). Where this fork's renderer accepts a
construct it cannot model for editing, the diagram still parses, renders,
verifies, and round-trips — it just doesn't expose typed mutation for the
unmodeled part. Upstream-relevant fixes are extracted into small PRs back to
`lukilabs/beautiful-mermaid` per the
[upstreaming strategy](./fork-differences.md#upstreaming-strategy).
