# Agentic Mermaid vocabulary

This page defines the words the docs, CLI, skills, and future website should use consistently. It exists because the Mermaid ecosystem uses similar words for different layers: source language, renderer support, terminal output, and agent edit authority.

Research basis: a 2026-06-12 GitHub scan of [`mermaid-js/mermaid`](https://github.com/mermaid-js/mermaid), [`AlexanderGrooff/mermaid-ascii`](https://github.com/AlexanderGrooff/mermaid-ascii), [`lukilabs/beautiful-mermaid`](https://github.com/lukilabs/beautiful-mermaid), and this fork's PR/issue history. Mermaid core had 33 syntax-doc pages on `develop` at scan time; that is syntax evidence, not a promise that Agentic Mermaid can render or mutate every family.

## Core rule

```txt
Mermaid syntax support is not the same as Agentic Mermaid edit authority.
```

Use the narrowest accurate verb:

- **references** — a doc or skill links to upstream Mermaid syntax.
- **accepts** — the parser recognizes a family/header.
- **parses** — source becomes an internal `ValidDiagram` or preserved opaque body.
- **renders** — the source produces SVG/PNG/ASCII/Unicode/JSON output.
- **verifies** — `verifyMermaid` can return structured warnings/errors.
- **mutates** — typed `mutate` operations are safe for the modeled subset.
- **round-trips** — `parse -> serialize -> parse` preserves the supported meaning, or preserves source verbatim for opaque/source-level bodies.

Do not say “supports Mermaid” when you mean only one of those verbs.

## Layer vocabulary

| Term | Meaning | Agent rule |
|---|---|---|
| **Mermaid source** | The text a user writes: `flowchart LR`, `sequenceDiagram`, `gantt`, directives, comments, frontmatter. | Treat it as the durable object. Do not replace it with a rendered artifact. |
| **Diagram family** | A Mermaid diagram kind such as flowchart, sequence, ER, timeline, journey, xychart, architecture, or Gantt. | Check `am capabilities --json` before claiming render or mutation support. |
| **Header** | The first meaningful family token, e.g. `flowchart`, `graph`, `sequenceDiagram`, `architecture-beta`. | Header names identify likely family; they do not prove the whole body is modeled. |
| **Upstream syntax reference** | Mermaid core documentation copied or linked for authoring help. | Reference docs are not support claims. Product nav should mark them as upstream syntax. |
| **Host renderer** | GitHub, GitLab, Obsidian, Mermaid Chart, or another renderer pinned to its own Mermaid version/config. | Do not infer host parity. Agentic Mermaid should state its own syntax target and capability output. |
| **Renderer support** | The ability to produce an artifact from source. | Distinguish SVG, PNG, ASCII, Unicode, and JSON layout. |
| **Edit authority** | The authority an agent has to change structure through typed operations. | Mutation authority is narrower than render support. |

## Agent edit vocabulary

| Term | Meaning | Stop condition |
|---|---|---|
| **Structured family** | The parser models enough of the family to expose typed operations. | Only mutate after narrowing to that family. |
| **Narrow** | Convert a parsed diagram to a family-specific body, e.g. `asFlowchart(d)` or `asSequence(d)`. | If narrowing returns `null`, do not call `mutate`. |
| **Typed mutation** | A declared operation such as `add_node`, `add_message`, `add_entity`, or `set_period_label`. | Use only advertised ops from capabilities/API docs. |
| **Source-level-only** | The family can parse/render/verify/round-trip, but no typed mutation API is advertised. | Preserve source or make an explicit text edit, then parse/verify/render. |
| **Opaque fallback** | Known family source that is preserved because unsupported syntax would be lost by partial modeling. | Do not normalize or serialize from a lossy partial IR. |
| **Modeled subset** | The specific syntax this repo understands structurally. | Outside the subset, fall back to source-level behavior. |
| **Round-trip** | The source or canonical serialized form remains stable through parse/serialize. | A failed round-trip is a bug or a stop signal. |
| **Receipt** | The evidence left after a run: source, artifact path, command, warning list, verifier result, and agent note. | Commit or report receipts for automated diagram changes. |

## Current family edit policy

`am capabilities --json` is authoritative. The human summary today is:

| Family | Common header(s) | Render policy | Edit policy |
|---|---|---|---|
| Flowchart | `flowchart`, `graph` | SVG/PNG/ASCII/Unicode/JSON layout | structured when narrowed |
| State | `stateDiagram-v2` | SVG/PNG/ASCII/Unicode/JSON layout | structured when narrowed |
| Sequence | `sequenceDiagram` | SVG/PNG/ASCII/Unicode/JSON layout | structured for participants/messages; rich blocks may be opaque/source-preserved |
| Timeline | `timeline` | SVG/PNG/ASCII/Unicode/JSON layout | structured when narrowed |
| Class | `classDiagram` | SVG/PNG/ASCII/Unicode/JSON layout | structured when narrowed |
| ER | `erDiagram` | SVG/PNG/ASCII/Unicode/JSON layout | structured when narrowed |
| Journey | `journey` | SVG/PNG/ASCII/Unicode/JSON layout | structured when narrowed |
| XY chart | `xychart`, `xychart-beta` | SVG/PNG/ASCII/Unicode/JSON layout | structured when narrowed |
| Pie | `pie` | SVG/PNG/ASCII/Unicode/JSON layout | structured when narrowed |
| Quadrant | `quadrantChart` | SVG/PNG/ASCII/Unicode/JSON layout | structured when narrowed |
| Gantt | `gantt` | SVG/PNG/ASCII/Unicode/JSON layout | structured when narrowed; calendar/click/comment segments may ride along verbatim |
| Architecture | `architecture-beta` | SVG/PNG/ASCII/Unicode/JSON layout | structured when narrowed |

Families present in Mermaid core docs but absent from this table are upstream Mermaid families, not Agentic Mermaid render-support claims. A listed family can still fall back to opaque/source-preserved behavior for syntax outside its modeled subset.

## Output vocabulary

| Term | Meaning | Evidence pressure from the ecosystem |
|---|---|---|
| **SVG** | Vector markup artifact. | Beautiful Mermaid issues/PRs repeatedly ask for styling, CSS classes, text contrast, minified output, and PDF-compatible colors. |
| **PNG** | Raster artifact derived from SVG. | Mermaid core has PNG/export mismatch reports; treat PNG as a separate artifact with fit/background options. |
| **ASCII** | 7-bit text drawing for logs, email, CI, and constrained terminals. | Mermaid-ASCII and Beautiful Mermaid issues show that ASCII correctness includes labels, arrows, box borders, and truncation. |
| **Unicode text** | Terminal drawing with box-drawing characters and fullwidth-aware layout. | Mermaid-ASCII PRs around Unicode/CJK and Beautiful Mermaid CJK/emoji issues make display-cell width part of correctness. |
| **JSON layout** | Machine-readable geometry and structure. | Use when an agent needs to inspect nodes/edges/regions rather than scrape pixels. |
| **Region metadata** | Mapping from text/SVG regions back to diagram objects. | Useful for TUIs, MCP artifacts, and agent-visible evidence. |

Do not use “ASCII” as a generic word for all terminal diagrams. Say **ASCII** for 7-bit output and **Unicode text** when box drawing or fullwidth display behavior matters.

## Verification vocabulary

| Term | Meaning |
|---|---|
| **Structural warning** | A problem in the diagram model or required artifact boundary, e.g. empty diagram, misanchored edge, off-canvas group. |
| **Geometric warning** | A layout problem such as node overlap or route self-crossing. |
| **Lint warning** | A source/model quality issue such as duplicate edge or unreachable node. |
| **Warning code** | Stable machine-readable code returned by `verifyMermaid`, e.g. `LABEL_OVERFLOW` or `ROUTE_SELF_CROSS`. |
| **Quality metric** | A scored layout or visual measure. Use it for comparison, not as the only proof of correctness. |
| **Golden** | Expected output fixture. Use for deterministic ASCII/SVG regressions where the exact artifact matters. |
| **Differential fixture** | A test that compares behavior against Mermaid core, upstream docs, or another renderer. Use when syntax compatibility is the question. |

A verifier warning is not automatically a failed task. The agent should inspect severity and user intent. A structural error is usually a stop condition; a lint warning may be a revise-and-retry signal.

## Config and styling vocabulary

| Term | Meaning | Agent rule |
|---|---|---|
| **Mermaid config** | Runtime config passed through options, frontmatter, or init directives. | Preserve config when round-tripping source. |
| **Frontmatter** | YAML block before Mermaid source. | Parse and preserve; Mermaid core recently fixed leading-whitespace tolerance in [PR #7732](https://github.com/mermaid-js/mermaid/pull/7732). |
| **Init directive** | Mermaid `%%{init: ...}%%` directive. | Treat as source-level config, not visible diagram content. |
| **Theme variable** | Mermaid-compatible style variable. | Resolve safely for outputs that cannot depend on browser CSS. |
| **Class definition** | Mermaid `classDef` styling. | Preserve source; emit classes only where the renderer explicitly supports them. |
| **Class assignment** | `class A foo` or shorthand class syntax on nodes. | Do not drop assignments just because the renderer lacks a visible style for them. |
| **Link style** | Mermaid `linkStyle` directive for edge styling. | Preserve edge-index semantics; index drift changes meaning. |
| **Strict security** | Sanitized rendering mode for untrusted source. | Use for docs/site rendering unless a trusted pipeline says otherwise. |

## Layout vocabulary

These words should mean concrete layout behavior:

| Term | Meaning |
|---|---|
| **Direction** | Declared flow direction, such as `TD`, `TB`, `LR`, or `RL`. |
| **Source order** | The order of declarations in Mermaid source. Some renderers use it as a layout hint; do not assume all do. |
| **Subgraph / group** | A container around nodes or services. Edges may attach to child nodes or the container itself, depending on family and syntax. |
| **Anchor** | The side/port/semantic endpoint where an edge connects. |
| **Route** | The path an edge takes through the layout. |
| **Trunk** | Shared segment for sibling edges from the same source before they branch. Mermaid-ASCII and Beautiful Mermaid issues show this affects readability. |
| **Back edge** | Edge that travels opposite the main direction. It often needs different routing or visual treatment. |
| **Fan-out** | One source with many outgoing edges. |
| **Fan-in** | Many sources converging on one target. |
| **Crossing** | Edge-edge intersection. Some crossings are unavoidable; self-crossing is usually a bug. |
| **Label corridor** | Space reserved so labels do not collide with edges, boxes, or other labels. |
| **Display-cell width** | Terminal column width after Unicode/fullwidth rules, not JavaScript string length. |

## Ecosystem terms to keep separate

| Ecosystem term | Use it for | Do not confuse it with |
|---|---|---|
| **Mermaid** | The upstream language, parser, renderer, docs, and syntax governance. | Agentic Mermaid's narrower local capability set. |
| **Mermaid-ASCII** | Alexander Grooff's terminal Mermaid renderer and its display-cell problem space. | All ASCII output everywhere. |
| **Beautiful Mermaid** | Luki Labs' renderer/product upstream and fork network. | The renamed `agentic-mermaid` package in this fork. |
| **Agentic Mermaid** | This fork's local-first, agent-operable rendering/editing toolkit. | A hosted AI diagram generator. |
| **Mermaid Chart** | Mermaid's hosted/editor product surface. | Mermaid core syntax or local rendering. |
| **Host support** | What GitHub/GitLab/Obsidian/etc. render today. | Upstream syntax support or Agentic Mermaid support. |

## Issue-derived vocabulary pressure

The terms above came from repeated ecosystem pressure, not wordsmithing:

- Mermaid core keeps adding and stabilizing families: swimlane, C4/C4-beta, architecture, radar, Wardley, Venn, Gantt, ER, XY, and proposals such as BPMN/data-pipeline/neuralnet. Mermaid's [beta suffix policy PR #7835](https://github.com/mermaid-js/mermaid/pull/7835) is why “beta header” needs a name.
- Mermaid core issues such as [#7815](https://github.com/mermaid-js/mermaid/issues/7815), [#7669](https://github.com/mermaid-js/mermaid/issues/7669), and [#7677](https://github.com/mermaid-js/mermaid/issues/7677) show pressure around consistent theming, syntax reference, and extensible diagram types.
- Mermaid-ASCII issues and PRs such as [#59](https://github.com/AlexanderGrooff/mermaid-ascii/issues/59), [#47](https://github.com/AlexanderGrooff/mermaid-ascii/pull/47), [#58](https://github.com/AlexanderGrooff/mermaid-ascii/pull/58), and [#64](https://github.com/AlexanderGrooff/mermaid-ascii/pull/64) make terminal-specific words necessary: display-cell width, label priority, subgraph title, edge route.
- Beautiful Mermaid issues such as [#1](https://github.com/lukilabs/beautiful-mermaid/issues/1), [#2](https://github.com/lukilabs/beautiful-mermaid/issues/2), [#79](https://github.com/lukilabs/beautiful-mermaid/issues/79), [#111](https://github.com/lukilabs/beautiful-mermaid/issues/111), [#115](https://github.com/lukilabs/beautiful-mermaid/issues/115), [#119](https://github.com/lukilabs/beautiful-mermaid/issues/119), and [#121](https://github.com/lukilabs/beautiful-mermaid/issues/121) show why agents need explicit terms for CLI, syntax compatibility, config, routing, contrast, CJK width, and label preservation.
- Agentic Mermaid PRs such as [#11](https://github.com/adewale/beautiful-mermaid/pull/11), [#17](https://github.com/adewale/beautiful-mermaid/pull/17), [#21](https://github.com/adewale/beautiful-mermaid/pull/21), [#23](https://github.com/adewale/beautiful-mermaid/pull/23), [#24](https://github.com/adewale/beautiful-mermaid/pull/24), and [#27](https://github.com/adewale/beautiful-mermaid/pull/27) turn those terms into local contracts: agent API, layout comparison, routing goldens, mutation/golden hardening, Gantt implementation/spec boundaries, and website strategy.

## Agent decision rules

When an agent edits a diagram:

1. Identify the family/header.
2. Check capabilities or the docs for render and edit policy.
3. Parse source; preserve frontmatter/init/comments unless the task explicitly removes them.
4. If structured and narrowed, use typed mutation.
5. If source-level-only or opaque, use deliberate text edits and state the limitation.
6. Verify before serializing or reporting success.
7. Render the requested artifact format.
8. Leave a receipt: source path, output path, command, warnings, and any unsupported syntax.

The safe default is source preservation. A pretty diagram that dropped unsupported syntax is worse than a refused mutation.

## Related docs

- [Diagram families](./diagram-families.md)
- [Agent mutation policy](./agent-mutation-policy.md)
- [ASCII and terminal output](./ascii.md)
- [Mermaid config](./config.md)
- [Quality](./quality.md)
- [Fork differences](./fork-differences.md)
- [Adding diagram types](./contributing/adding-diagram-types.md)
