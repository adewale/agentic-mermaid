---
name: agentic-mermaid
description: Author and edit Mermaid diagrams with structured verification, typed mutation, and round-trip serialization. Structured mutation for flowchart, state, sequence, timeline, class, and ER; source-level parse-and-render for journey, xychart, architecture, and opaque fallbacks.
---

# Agentic Mermaid

A typed editing surface for Mermaid. New diagrams can be authored as Mermaid source and verified/rendered directly. Existing modeled diagrams can be parsed to a `ValidDiagram`, mutated with typed ops, verified structurally (no pixels), and serialized back to canonical source. Layout is deterministic — verified cross-process, no seed.

## Pick a channel

- `agentic-mermaid-mcp` connected → **Code Mode** (`references/code-mode.md`). Multi-step edits in one round-trip.
- Can run JS/TS with imports → **library** (`agentic-mermaid/agent`). Same SDK.
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
| Journey | ✓ | structural | ✓ | — | verbatim/source-level |
| XY chart | ✓ | structural | ✓ | — | verbatim/source-level |
| Architecture | ✓ | structural | ✓ | — | verbatim/source-level |

Any diagram with constructs we don't model falls back to an **opaque** body: it still parses, renders, verifies, and round-trips losslessly — it just isn't offered for structured mutation (the narrower returns null). The parser never silently drops anything.

## Workflow

For new diagrams, author Mermaid source directly, then `parseMermaid` / `verifyMermaid` / render. For existing modeled diagrams:

1. `parseMermaid(source)` → `ValidDiagram`.
2. `asFlowchart(d)` / `asSequence(d)` / `asTimeline(d)` / `asClass(d)` / `asEr(d)` to narrow before mutating.
3. `mutate(d, op)` (typed per family).
4. `verifyMermaid(d)` — structured warnings; inspect `ok` / `warnings` / `layout`.
5. On `!ok`, revert to the previous `ValidDiagram`, try another op.
6. `serializeMermaid(d)` only after inspected verify passes.

Do not regenerate or concatenate source to edit an existing structured diagram when a typed op exists. Direct source authoring is fine for new diagrams. See `references/flowchart.md`, `references/sequence.md`.
