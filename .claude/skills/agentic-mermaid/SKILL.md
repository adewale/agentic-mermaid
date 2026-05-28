---
name: agentic-mermaid
description: Author and edit Mermaid diagrams with structured verification, typed mutation, and round-trip serialization. Structured mutation for flowchart, state, sequence, timeline, class, and ER; parse-and-render for all 9 families.
---

# agentic-mermaid

A typed editing surface for Mermaid. Parse to a `ValidDiagram`, mutate with typed ops, verify structurally (no pixels), serialize back to canonical source. Layout is deterministic — verified cross-process, no seed.

## Pick a channel

- `agentic-mermaid-mcp` connected → **Code Mode** (`references/code-mode.md`). Multi-step edits in one round-trip.
- Can `import` TS → **library** (`beautiful-mermaid/agent`). Same SDK.
- Shell only → **CLI** (`references/cli.md`).

## Capability matrix

| Family | parse | verify | render | mutate | serialize |
|---|---|---|---|---|---|
| Flowchart, State | ✓ | full (Tier 1+2) | ✓ | 6 ops | structured |
| Sequence (simple) | ✓ | structural | ✓ | 5 ops | structured |
| Sequence (notes/alt/loop/…) | ✓ | structural | ✓ | — (opaque) | verbatim |
| Timeline (simple) | ✓ | structural | ✓ | 10 ops | structured |
| Timeline (unmodeled syntax) | ✓ | structural | ✓ | — (opaque) | verbatim |
| **Class (simple)** | ✓ | structural | ✓ | **10 ops** | structured |
| Class (unmodeled syntax) | ✓ | structural | ✓ | — (opaque) | verbatim |
| **ER (simple)** | ✓ | structural | ✓ | **7 ops** | structured |
| ER (unmodeled syntax) | ✓ | structural | ✓ | — (opaque) | verbatim |
| Journey, XY, Architecture | ✓ | structural | ✓ | — | verbatim |

Any diagram with constructs we don't model falls back to an **opaque** body: it still parses, renders, verifies, and round-trips losslessly — it just isn't offered for structured mutation (the narrower returns null). The parser never silently drops anything.

## Workflow

1. `parseMermaid(source)` → `ValidDiagram`.
2. `asFlowchart(d)` / `asSequence(d)` to narrow before mutating.
3. `mutate(d, op)` (typed per family).
4. `verifyMermaid(d)` — structured warnings.
5. On `!ok`, revert to the previous `ValidDiagram`, try another op.
6. `serializeMermaid(d)` after verify passes.

Never concatenate Mermaid source. See `references/flowchart.md`, `references/sequence.md`.
