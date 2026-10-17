# Mermaid, Beautiful Mermaid, and Agentic Mermaid

Use this page to decide which of the three projects fits your task. The
table maps the three primary projects; the related Zombie/C4 comparison below
distinguishes implemented outputs from preserved source and proposals.

- **[Mermaid](https://github.com/mermaid-js/mermaid)** (`mermaid`) is the
  original. It defines the grammar that both other projects implement,
  supports a broader diagram catalogue, and is rendered natively by GitHub,
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
  across runs, structured verification, and CLI/MCP surfaces. The trade is explicit: the checked registry covers a focused subset of Mermaid's
  broader catalogue in exchange for the guarantee that parsing and re-serializing
  a diagram never drops syntax.

## Comparison scope — checked 2026-10-17

The syntax/fixture baseline is Mermaid 11.16. The Beautiful package comparator
is **1.1.3**, not every unmerged contribution. Its inspected main is
[`2ac8bbbb`](https://github.com/lukilabs/beautiful-mermaid/tree/2ac8bbbb060ca0a65a6a21f3200bd99b1587b488).
Agentic claims here refer to source
[`3ef2fb8`](https://github.com/adewale/agentic-mermaid/tree/3ef2fb8beff21359fb6e3b798e025a3d69311539)
(declares **0.4.2**); npm and the public deployment still report **0.4.1** at
this check. Installing that release is not equivalent to using current source.

A merged main commit, an npm version, an open PR and a historical benchmark are
different evidence. The [release issue](https://github.com/adewale/agentic-mermaid/issues/378)
tracks delivery; compare peer changelogs and the exact version you install rather
than treating this dated page as a continuously verified scorecard.

## At a glance

| | Mermaid | Beautiful Mermaid | Agentic Mermaid |
|---|---|---|---|
| Primary job | Define and render the diagram language everywhere | Fast, beautiful, browserless rendering | Agent-safe diagram *editing* plus rendering |
| Runtime | Browser DOM (Node via Puppeteer/`mermaid-cli`) | Browserless TypeScript renderer | Browserless SVG/terminal; native resvg for Node PNG; lazy browser ESM entry |
| Diagram types | Broad Mermaid catalogue, including newer experimental families | Flowchart, state, sequence, class, ER, and XY chart | Registry-backed subset listed by `am capabilities --json` |
| Output formats | SVG (PNG/PDF via CLI tooling) | SVG, ASCII/Unicode | SVG, PNG (offline resvg), ASCII/Unicode, JSON layout |
| Theming | Theme config + CSS | Two-color foundation, 15+ named themes, Shiki/VS Code compatibility, live CSS-variable switching | Style + Palette stacks: named looks, palette-only styles, custom JSON records, and deterministic seeds |
| Parse to a typed AST for editing | — (internal parser, not an editing API) | — (render-only API) | ✅ `parseRegisteredMermaid` → typed `ValidDiagram` |
| Typed mutation | — | — | Registered families expose modeled edits; opaque/source-preserved bodies refuse typed mutation |
| Structural verification | — | — | ✅ 3 warning tiers + perceptual quality metrics, all families |
| Deterministic output | Depends on renderer, configuration and host | No Agentic cross-runtime guarantee claimed for this comparator | Byte equality tested for the supported runtime/version matrix, not arbitrary machines or dependencies |
| Round-trip guarantee (parse → serialize keeps your source) | — | — | ✅ verbatim for unmodeled syntax, canonical for structured bodies |
| CLI | `mermaid-cli` (`mmdc`, Puppeteer-based) | — | `am` (render/verify/mutate/batch/preview/…, single-binary build) |
| MCP / agent surface | Official hosted MCP (validation, PNG, Mermaid Chart integration) | — | Local Code Mode MCP (<!-- BEGIN GENERATED: local-mcp-tools -->`execute`, `describe_sdk`, `render_png`, and `describe`<!-- END GENERATED: local-mcp-tools -->) plus hosted `/mcp` (`execute`, progressive schema discovery, render/verify/describe, `mutate`/`build`), `llms.txt`, agent skill |
| Interactivity (click handlers, animations) | Host and security-policy dependent | Partial (tooltips) | Typed action metadata; host activation and strict output policy remain separate |
| Ecosystem & docs | Vast — the de-facto standard, GitHub/GitLab/Notion render it natively | Growing, popular for terminal/AI use | Small; this repo |

## What each does that the others don't

**Only Mermaid:** the full diagram-type catalogue, including families neither
other project renders (requirement, C4, block, packet, kanban, treemap,
ZenUML, and newer additions like venn, wardley, treeview, event modeling —
see `am capabilities --json` for what Agentic Mermaid registers); native
rendering inside GitHub, GitLab, Notion, Obsidian, and hundreds of tools;
the grammar itself — both other projects implement *Mermaid's* language,
and valid Mermaid is the writing contract. That does not require matching its
layout or reproducing its quirks.

**Only Beautiful Mermaid (vs Mermaid):** synchronous, dependency-light
rendering with no browser; a deliberate two-color theming foundation with
enriched palettes and Shiki theme compatibility; ASCII/Unicode terminal
output. Agentic Mermaid inherits all of this — it is upstream's work, and
credit belongs there.

**Only Agentic Mermaid:** the typed editing loop. `parseRegisteredMermaid` returns a
sealed IR; family narrowers (`asFlowchart` … `asXyChart`) expose typed
mutation ops; `verifyMermaid` returns structured warnings instead of asking
an agent to eyeball pixels; `serializeMermaid` round-trips losslessly
(structured-or-opaque: anything the parser doesn't model is preserved
verbatim, never silently dropped). Plus offline PNG, JSON layout, an `am`
CLI built for agents (exit codes, JSONL batch, `capabilities --json`
self-discovery), a local Code Mode MCP server, a bounded hosted MCP endpoint
for zero-install render/verify/describe and structured edits, and tested
byte-identical determinism within the tested environment. These are additional
workflow contracts, not a claim that other renderers cannot be used by agents.

## Zombie Mermaid and C4 bloodlines

[Zombie Mermaid](https://github.com/dfadler/zombie-mermaid) is an independently
maintained Beautiful Mermaid fork, not an upstream PR branch. This comparison
inspected its source at
[`9a4a667d`](https://github.com/dfadler/zombie-mermaid/tree/9a4a667dec24cc37a5bc3eea8434ff8d6eb52400).
Its published **5.7.1** tag points to
[`3e688e4e`](https://github.com/dfadler/zombie-mermaid/tree/3e688e4e5e00ec9f92444af4757e0ec7c449e84b),
which predates that main head; do not call every inspected main change released.

At those source points Agentic has **16 native SVG/terminal families** and
Zombie has **nine when State is counted separately** (its registry groups
Flowchart/State into one of eight type categories). These are family-level
counts, not construct-fidelity scores. Agentic is broader, but **not a strict
superset**: Zombie renders C4, while Agentic only preserves its source envelope.
The [Agentic descriptors](https://github.com/adewale/agentic-mermaid/blob/3ef2fb8beff21359fb6e3b798e025a3d69311539/src/agent/families.ts)
and Zombie's [SVG](https://github.com/dfadler/zombie-mermaid/blob/9a4a667dec24cc37a5bc3eea8434ff8d6eb52400/packages/svg-renderer/src/registry.ts)
and [terminal](https://github.com/dfadler/zombie-mermaid/blob/9a4a667dec24cc37a5bc3eea8434ff8d6eb52400/packages/ascii-renderer/src/registry.ts)
registries are the capability evidence; this page is not a second full roster.

| C4 implementation / evidence | SVG | Terminal | Meaning of “support” |
|---|---|---|---|
| [Mermaid's pinned C4 syntax](https://github.com/mermaid-js/mermaid/blob/f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc/docs/syntax/c4.md) | Native C4 renderer | No native text renderer | Five legacy variants; renderer support is not universal construct/layout parity. |
| [Beautiful main dispatch](https://github.com/lukilabs/beautiful-mermaid/blob/2ac8bbbb060ca0a65a6a21f3200bd99b1587b488/src/index.ts) | No native C4 | No native C4 | PRs [#34](https://github.com/lukilabs/beautiful-mermaid/pull/34) and [#71](https://github.com/lukilabs/beautiful-mermaid/pull/71) remain proposals, not merged support. |
| [Zombie C4 SVG](https://github.com/dfadler/zombie-mermaid/blob/9a4a667dec24cc37a5bc3eea8434ff8d6eb52400/packages/svg-renderer/src/c4/renderer.ts) and [terminal renderer](https://github.com/dfadler/zombie-mermaid/blob/9a4a667dec24cc37a5bc3eea8434ff8d6eb52400/packages/ascii-renderer/src/c4-diagram.ts) | Native renderer | Dedicated boundary/element layout and routed relations | Not merely captured gallery SVG or a relationship list. Terminal orientation and unsupported constructs still have limits; native does not mean complete parity. |
| [pgavlin terminal renderer](https://github.com/pgavlin/mermaid-ascii/blob/ab8074a98bef86a951c3443910363a8d1415135b/pkg/c4/renderer.go) | Not established by this text renderer | Stacked boxes plus textual relationship list | Useful text output, but not relationships routed between C4 elements. Do not equate it with Zombie's terminal geometry. |
| Agentic source at the checked baseline | Unsupported family | Unsupported family | Recognized C4 headers/source envelopes can round-trip through the open preservation API; no native C4 layout or typed edits. [#387](https://github.com/adewale/agentic-mermaid/issues/387) is a proposal, not a shipped capability. |

Native C4 support must be established at its own parser, layout, output and
editing boundaries. Recognizing a header, preserving source, drawing a screenshot
in a gallery and rendering the family natively are not interchangeable claims.

### Historical peer observations

The color comparisons in [#303](https://github.com/adewale/agentic-mermaid/issues/303)
used **Zombie 2.2.6**. They remain evidence about that version, not the October
source or a promise that every original gap remains. Zombie's
[later color fix](https://github.com/dfadler/zombie-mermaid/commit/3861e50dfc8bd7de17a00b8b9939c257482aead1)
changes invalid style-color handling for Flowchart, State and Class. Its current
Class/ER support must likewise be read from the pinned source/changelog, not
inferred from that old matrix. These notes do not silently rewrite the original
measurements or claim a fresh cross-product benchmark.

## Mindmap/GitGraph and the terminal ecosystem

The checked fixtures follow the official [Mindmap](https://mermaid.ai/open-source/syntax/mindmap.html) and [GitGraph](https://mermaid.ai/open-source/syntax/gitgraph.html) syntax pages and render from the same authored source in Mermaid 11.16.0 and Agentic Mermaid. See the captioned [Mindmap comparison](./design/families/mindmap.md#visual-evidence) and [GitGraph comparison](./design/families/gitgraph.md#visual-evidence). Compare semantic structure—labels, shapes, hierarchy, lanes, commits, parentage, tags, and bounds—not pixels, because the layout/style engines differ.

The recorded fixture comparison used
[AlexanderGrooff/mermaid-ascii](https://github.com/AlexanderGrooff/mermaid-ascii)
**1.4.0**, which exited 1 for both families:

```text
unsupported graph type 'mindmap'. Supported types: graph TD, graph TB, graph LR, flowchart TD, flowchart TB, flowchart LR
unsupported graph type 'gitGraph'. Supported types: graph TD, graph TB, graph LR, flowchart TD, flowchart TB, flowchart LR
```

This is a historical, version-pinned observation, not a replay against the latest
release or a claim about all related forks. Its [coverage issue #74](https://github.com/AlexanderGrooff/mermaid-ascii/issues/74)
is context, not current execution evidence. An unsupported render is not a
visually worse render.

## Choosing

- Rendering inside a web app, or you need a family absent from `am capabilities --json` → **Mermaid**.
- Fast, beautiful SVG/ASCII rendering of the core families in
  Node/Bun/terminal, render-only → **Beautiful Mermaid**.
- An AI agent (or any program) needs to *edit* diagrams safely, verify them
  structurally, or guarantee reproducible output in CI → **Agentic Mermaid**.

## Compatibility notes

Mermaid is our input language, not a pixel or bug-for-bug specification. Write
valid Mermaid 11.16; read unambiguous intent generously with diagnostics, and
reject input whose meaning cannot be determined. Display/layout choices remain
ours. Preserving source does not imply native rendering or structural
verification: unsupported families receive an explicit diagnostic, and opaque
bodies do not gain typed editing merely because their bytes survive. See the
[preservation contract](./project/divergences.md#structured-or-opaque-is-load-bearing).
Upstream-relevant fixes are extracted into small PRs back to
`lukilabs/beautiful-mermaid` per the
[upstreaming strategy](./fork-differences.md#upstreaming-strategy).
