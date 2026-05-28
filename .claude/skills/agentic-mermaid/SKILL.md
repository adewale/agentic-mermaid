---
name: agentic-mermaid
description: Author and edit Mermaid diagrams with structured verification, typed mutation, and round-trip serialization. Use whenever you need to produce, fix, or refactor a Mermaid diagram in any language.
---

# agentic-mermaid

A typed editing surface for Mermaid diagrams. Parse to a `ValidDiagram`, mutate with typed ops, verify structurally without rendering to pixels, serialize back to canonical source.

## Pick a channel before you write code

- If the `agentic-mermaid-mcp` MCP server is connected: use **Code Mode**. Multi-step edits become one round-trip. See `references/code-mode.md`.
- If you can `import` from npm and run TS (filesystem + Node/Bun): use the **library directly**. Same SDK as Code Mode.
- If you only have a shell: use the **CLI** for one-shot ops. See `references/cli.md`. Chained edits via shell are last resort.

## Route by diagram family

Read the right reference for the diagram you're working on:

| Family | Reference |
|---|---|
| Flowchart | `references/flowchart.md` |
| Sequence | upstream: <https://mermaid.js.org/syntax/sequenceDiagram.html> |
| Class | upstream: <https://mermaid.js.org/syntax/classDiagram.html> |
| ER | upstream: <https://mermaid.js.org/syntax/entityRelationshipDiagram.html> |
| State | upstream: <https://mermaid.js.org/syntax/stateDiagram.html> |
| Timeline | upstream: <https://mermaid.js.org/syntax/timeline.html> |
| Journey | upstream: <https://mermaid.js.org/syntax/userJourney.html> |
| XY Chart | upstream: <https://mermaid.js.org/syntax/xyChart.html> |
| Architecture | upstream: <https://mermaid.js.org/syntax/architecture.html> |

`mutate()` is fully implemented for flowchart and state diagrams in v1. Other families parse to an opaque body; round-trip works via source preservation, but `mutate` returns `UNSUPPORTED_FAMILY` for them.

## The canonical workflow

1. `parseMermaid(source)` → `ValidDiagram` (multi-error).
2. Apply one or more `mutate(d, op)` calls.
3. `verifyMermaid(d)` — get structured warnings.
4. If `!result.ok`: back up to the previous `ValidDiagram` and try a different op.
5. `serializeMermaid(d)` only after `verify` passes.

Never concatenate Mermaid source strings.

## Output expectations

Generated Mermaid code should:

1. Be wrapped in ```` ```mermaid ```` fences when embedded in prose.
2. Pass `verifyMermaid` with no error-severity warnings before being committed.
3. Be reachable via `parseMermaid` + `mutate` chains, not string templating.
