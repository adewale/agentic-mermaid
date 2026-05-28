---
name: agentic-mermaid
description: Author and edit Mermaid diagrams with structured verification, typed mutation, and round-trip serialization. Supports structured mutation for flowchart, state, and sequence diagrams; parse-and-render for the other 6 families.
---

# agentic-mermaid

A typed editing surface for Mermaid diagrams. Parse to a `ValidDiagram`, mutate with typed ops (flowchart + state + sequence), verify structurally, serialize back to canonical source.

## Pick a channel before you write code

- If `agentic-mermaid-mcp` is connected: use **Code Mode**. Multi-step edits become one round-trip. See `references/code-mode.md`.
- If you can `import` from npm and run TS: use the **library directly**.
- If you only have a shell: use the **CLI**. See `references/cli.md`.

## Capability matrix

| Family | parse | verify | render | mutate | serialize |
|---|---|---|---|---|---|
| Flowchart, State | ✓ | full (Tier 1 + 2) | ✓ | **all 6 ops** | structured re-emit |
| **Sequence** | ✓ | structural (Tier 1) | ✓ | **5 ops** | structured re-emit |
| Class, ER, Timeline, Journey, XY, Architecture | ✓ | structural only | ✓ | **not supported** | `canonicalSource` verbatim |

For non-mutable families, cross-cutting edits live at the source level (string ops against `canonicalSource`).

## Family references

- `references/flowchart.md` — shapes, edges, full mutation coverage
- `references/sequence.md` — participants, messages, sequence ops
- Other families: see upstream Mermaid docs (linked in family refs)

## The canonical workflow

1. `parseMermaid(source)` → `ValidDiagram`.
2. Narrow via `asFlowchart(d)` or `asSequence(d)` if you intend to mutate.
3. Apply one or more `mutate(d, op)` calls.
4. `verifyMermaid(d)` — get structured warnings.
5. If `!result.ok`: revert to the previous `ValidDiagram` and try a different op.
6. `serializeMermaid(d)` only after `verify` passes.

Never concatenate Mermaid source strings.
