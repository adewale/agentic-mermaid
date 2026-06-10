---
name: agentic-mermaid-diagram-workflow
description: Agent-agnostic skill for authoring and editing Mermaid diagrams with structured verification, typed mutation, round-trip serialization, and ASCII, PNG, and SVG outputs. Structured mutation for flowchart, state, sequence, timeline, class, and ER; source-level parse-and-render for journey, xychart, architecture, and opaque fallbacks.
---

# Agentic Mermaid — diagram workflow

An agent-agnostic typed editing surface for Mermaid. New diagrams can be authored as Mermaid source and verified/rendered directly. Existing modeled diagrams can be parsed to a `ValidDiagram`, mutated with typed ops, verified structurally (no pixels), and serialized back to canonical source. Agentic Mermaid outputs ASCII, PNG, and SVG; layout is deterministic — verified cross-process, no seed.

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

State diagrams share the flowchart body: narrow them with `asFlowchart` and every flowchart op applies. There is no separate `asState` narrower.

`references/upstream/` documents Mermaid syntax for many more families than this renderer accepts; it is authoring reference only. `am capabilities --json` is the authoritative list of renderable families.

## Workflow

For new diagrams, author Mermaid source directly, then `parseMermaid` / `verifyMermaid` / render. For existing modeled diagrams:

1. `parseMermaid(source)` → `ValidDiagram`.
2. `asFlowchart(d)` / `asSequence(d)` / `asTimeline(d)` / `asClass(d)` / `asEr(d)` to narrow before mutating.
3. `mutate(d, op)` (typed per family).
4. `verifyMermaid(d)` — structured warnings; inspect `ok` / `warnings` / `layout`.
5. On `!ok`, revert to the previous `ValidDiagram`, try another op.
6. `serializeMermaid(d)` only after inspected verify passes.

Do not regenerate or concatenate source to edit an existing structured diagram when a typed op exists. Direct source authoring is fine for new diagrams. Mutation ops use the discriminator field `kind` (not `type`). Edge removal uses ids such as `{ kind: 'remove_edge', id: 'API->DB' }`; verify before serializing.

Minimal existing-flowchart pattern:

```ts
const parsed = parseMermaid(source)
if (!parsed.ok) return { phase: 'parse', errors: parsed.error }
let cur = asFlowchart(parsed.value)
if (!cur) return { phase: 'narrow', family: parsed.value.kind }
for (const op of [
  { kind: 'remove_edge', id: 'API->DB' },
  { kind: 'add_node', id: 'Cache', label: 'Cache' },
  { kind: 'add_edge', from: 'API', to: 'Cache' },
  { kind: 'add_edge', from: 'Cache', to: 'DB' },
] as const) {
  const next = mutate(cur, op)
  if (!next.ok) return { phase: 'mutate', op, error: next.error }
  cur = next.value
}
const verify = verifyMermaid(cur)
if (!verify.ok) return { phase: 'verify', warnings: verify.warnings }
return { source: serializeMermaid(cur) }
```

Output artifact pattern:

```ts
const svg = renderMermaidSVG(cur, { security: 'strict' })
const png = renderMermaidPNG(cur, { fitTo: { width: 1200 }, background: '#fff' })
const ascii = renderMermaidASCII(cur, { useAscii: true })
```

CLI PNG: `am render diagram.mmd --format png --output diagram.png`.

See `references/flowchart.md`, `references/sequence.md`, `references/timeline.md`, and the repository cookbook at `docs/agent-api-cookbook.md`.
