---
name: agentic-mermaid
description: Author and edit Mermaid diagrams with structured verification, typed mutation, and round-trip serialization. Use whenever you need to produce, fix, or refactor a Mermaid diagram in any language.
---

# agentic-mermaid

A typed editing surface for Mermaid diagrams. Parse to a `ValidDiagram`, mutate with typed ops (flowchart + state only), verify structurally without rendering to pixels, serialize back to canonical source.

## Pick a channel before you write code

- If the `agentic-mermaid-mcp` MCP server is connected: use **Code Mode**. Multi-step edits become one round-trip. See `references/code-mode.md`.
- If you can `import` from npm and run TS: use the **library directly**. Same SDK as Code Mode.
- If you only have a shell: use the **CLI** for one-shot ops. See `references/cli.md`. Chained edits via shell are last resort.

## Route by diagram family — but know what's supported

| Family | parse | verify | render | mutate | serialize |
|---|---|---|---|---|---|
| Flowchart, State | ✓ | full (Tier 1 + 2) | ✓ | **all 6 ops** | structured re-emit |
| Sequence, Class, ER, Timeline, Journey, XY, Architecture | ✓ | structural only | ✓ | **not supported** | `canonicalSource` verbatim |

For families without mutation, cross-cutting edits live at the source level (string operations against `canonicalSource`).

## The canonical workflow

1. `parseMermaid(source)` → `ValidDiagram`.
2. Narrow via `asFlowchart(d)` if you intend to mutate.
3. Apply one or more `mutate(flow, op)` calls.
4. `verifyMermaid(d)` — get structured warnings.
5. If `!result.ok`: back up to the previous `ValidDiagram` and try a different op.
6. `serializeMermaid(d)` only after `verify` passes.

Never concatenate Mermaid source strings.

## Family references

- `references/flowchart.md` — shape/edge syntax and full mutation coverage
- Other families: see upstream Mermaid docs (links in flowchart reference)
