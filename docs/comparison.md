# Mermaid, Beautiful Mermaid, and Agentic Mermaid

Use this page to decide which of the three projects fits your task. The
table maps what each one can do; the sections after it name what only each
one does, and the final section tells you which to install for common jobs.

- **[Mermaid](https://github.com/mermaid-js/mermaid)** (`mermaid`) is the
  original. It defines the grammar that both other projects implement,
  supports roughly 25 diagram types, and is rendered natively by GitHub,
  GitLab, Notion, and Obsidian — which is why most diagrams-as-text you will
  encounter are written in its language.
- **[Beautiful Mermaid](https://github.com/lukilabs/beautiful-mermaid)**
  (`beautiful-mermaid`, by Craft) re-implements Mermaid rendering as a
  synchronous TypeScript library: it computes layout itself and emits SVG
  strings, so it runs in Node, Bun, or an edge function with no browser and
  no Puppeteer. Its theming derives a full palette from two colors and
  accepts Shiki/VS Code themes directly, and it renders to ASCII/Unicode for
  terminals. It is the foundation this fork is built on.
- **Agentic Mermaid** (`agentic-mermaid`, this repo) extends Beautiful
  Mermaid for programs that edit diagrams — AI agents foremost. It adds a
  typed parse → mutate → verify → serialize loop, byte-identical output
  across runs, structured verification, and CLI/MCP surfaces. The trade is
  explicit: 12 diagram families against Mermaid's ~25, in exchange for the
  guarantee that parsing and re-serializing a diagram never drops syntax.

Facts below reflect Mermaid ~11.15 and the upstream `beautiful-mermaid`
repository as of mid-2026; both projects move quickly, so check their
changelogs for the current state.

## At a glance

| | Mermaid | Beautiful Mermaid | Agentic Mermaid |
|---|---|---|---|
| Primary job | Define and render the diagram language everywhere | Fast, beautiful, browserless rendering | Agent-safe diagram *editing* plus rendering |
| Runtime | Browser DOM (Node via Puppeteer/`mermaid-cli`) | Pure TypeScript, zero DOM, synchronous | Pure TypeScript, zero DOM, synchronous |
| Diagram types | ~25 (flowchart, sequence, class, state, ER, gantt, pie, mindmap, gitgraph, timeline, journey, quadrant, sankey, xychart, block, packet, kanban, architecture, radar, treemap, venn, ishikawa, wardley, treeview, event modeling, …) | 6 (flowchart, state, sequence, class, ER, XY chart) | 12 (those 6 + timeline, journey, architecture, pie, quadrant, gantt) |
| Output formats | SVG (PNG/PDF via CLI tooling) | SVG, ASCII/Unicode | SVG, PNG (offline resvg), ASCII/Unicode, JSON layout |
| Theming | Theme config + CSS | Two-color foundation, 15+ named themes, Shiki/VS Code compatibility, live CSS-variable switching | Style + Palette stacks: named looks, palette-only styles, custom JSON records, and deterministic seeds |
| Parse to a typed AST for editing | — (internal parser, not an editing API) | — (render-only API) | ✅ `parseMermaid` → typed `ValidDiagram` |
| Typed mutation ops | — | — | ✅ 12 of 12 families (129 ops total), structured-or-opaque, never lossy |
| Structural verification | — | — | ✅ 3 warning tiers + perceptual quality metrics, all families |
| Deterministic output | Not a goal (browser/layout variance) | Mostly stable, not a tested guarantee | ✅ byte-identical across runs/processes, CI-gated |
| Round-trip guarantee (parse → serialize keeps your source) | — | — | ✅ verbatim for unmodeled syntax, canonical for structured bodies |
| CLI | `mermaid-cli` (`mmdc`, Puppeteer-based) | — | `am` (render/verify/mutate/batch/preview/…, single-binary build) |
| MCP / agent surface | Official hosted MCP (validation, PNG, Mermaid Chart integration) | — | Local Code Mode MCP (`execute`, `render_png`, `describe`) plus hosted `/mcp` (`execute`, render/verify/describe, `mutate`/`build`), `llms.txt`, agent skill |
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
self-discovery), a local Code Mode MCP server, a bounded hosted MCP endpoint
for zero-install render/verify/describe and structured edits, and tested
byte-identical determinism. Neither upstream project needed any of this: both serve humans who write
diagrams once, while this surface serves programs that edit them repeatedly.

## Choosing

- Rendering inside a web app, or you need mindmap/gitgraph/any family
  beyond the 12 here → **Mermaid**.
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
