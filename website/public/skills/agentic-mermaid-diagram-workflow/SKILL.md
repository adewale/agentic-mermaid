---
name: agentic-mermaid-diagram-workflow
description: Agent-agnostic skill for authoring and editing Mermaid diagrams with structured verification, typed mutation, round-trip serialization, and SVG, PNG, ASCII, Unicode, and JSON layout outputs. Structured mutation for all twelve renderable families (flowchart, state, sequence, timeline, class, ER, journey, architecture, xychart, pie, quadrant, gantt); source-level parse-and-render only for opaque fallbacks (unmodeled syntax).
---

# Agentic Mermaid — diagram workflow

An agent-agnostic typed editing surface for Mermaid. New diagrams can be authored as Mermaid source and verified/rendered directly. Existing modeled diagrams can be parsed to a `ValidDiagram`, mutated with typed ops, verified structurally (not as subjective visual scoring), and serialized back to canonical source. Agentic Mermaid outputs SVG, PNG, ASCII, Unicode, and JSON layout; layout is deterministic — verified cross-process, no seed.

## Pick a channel

- `agentic-mermaid-mcp` connected → **Code Mode** (`references/code-mode.md`). Multi-step edits in one round-trip.
- Can run JS/TS with imports → **library** (`agentic-mermaid/agent`). Same SDK.
- Shell only → **CLI** (`references/cli.md`).

## Capability matrix

| Family | parse | verify | render | mutate | serialize |
|---|---|---|---|---|---|
| Flowchart | ✓ | full (Tier 1+2) | ✓ | 6 ops | structured |
| **State (modeled subset)** | ✓ | full (Tier 1+2) | ✓ | **8 ops** | structured |
| State (`<<fork>>`/`<<choice>>`/notes/`--`/`classDef`, unmodeled) | ✓ | structural | ✓ | — (opaque) | verbatim |
| Sequence (simple) | ✓ | structural | ✓ | 5 ops | structured |
| Sequence (notes/alt/loop/…) | ✓ | structural | ✓ | **5 ops** | structured-with-segments |
| Sequence (un-segmentable, e.g. unbalanced `end`) | ✓ | structural | ✓ | — (opaque) | verbatim |
| Timeline (simple) | ✓ | structural | ✓ | 10 ops | structured |
| Timeline (unmodeled syntax) | ✓ | structural | ✓ | — (opaque) | verbatim |
| **Class (simple)** | ✓ | structural | ✓ | **10 ops** | structured |
| Class (unmodeled syntax) | ✓ | structural | ✓ | — (opaque) | verbatim |
| **ER (simple)** | ✓ | structural | ✓ | **7 ops** | structured |
| ER (unmodeled syntax) | ✓ | structural | ✓ | — (opaque) | verbatim |
| **Journey (simple)** | ✓ | structural | ✓ | **10 ops** | structured |
| Journey (accTitle/accDescr, unmodeled) | ✓ | structural | ✓ | — (opaque) | verbatim |
| **Architecture (modeled subset)** | ✓ | structural | ✓ | **10 ops** | structured |
| Architecture (`{group}` boundary, accTitle/accDescr) | ✓ | structural | ✓ | — (opaque) | verbatim |
| **XY chart (modeled subset)** | ✓ | structural | ✓ | **8 ops** | structured |
| XY chart (quoted text, `;` lines, accTitle/accDescr) | ✓ | structural | ✓ | — (opaque) | verbatim |
| **Pie (simple)** | ✓ | structural | ✓ | **7 ops** | structured |
| Pie (accTitle/accDescr, malformed entries) | ✓ | structural | ✓ | — (opaque) | verbatim |
| **Quadrant (modeled subset)** | ✓ | structural | ✓ | **7 ops** | structured |
| Quadrant (styling `classDef`/`:::`, out-of-range coords) | ✓ | structural | ✓ | — (opaque) | verbatim |
| **Gantt (modeled subset)** | ✓ | structural + schedule | ✓ | **9 ops** | structured-with-segments |
| Gantt (duplicate ids / unclosed `accDescr`) | ✓ | structural | ✓ | — (opaque) | verbatim |

Any diagram with constructs we don't model falls back to an **opaque** body: it still parses, renders, verifies, and round-trips losslessly — it just isn't offered for structured mutation (the narrower returns null). The parser never silently drops anything.

State diagrams own a dedicated body (BUILD-19): narrow them with `asState` and apply state-shaped ops (`add_state`, `remove_state`, `rename_state`, `set_state_label`, `add_transition`, `remove_transition`, `set_transition_label`, `make_composite`). `asFlowchart` returns null on a state diagram. The modeled subset is simple states, transitions, `[*]` start/end pseudostates, composite blocks, and `direction`; anything else (`<<fork>>`/`<<choice>>`/`<<join>>`, history states, concurrency `--`, notes, `classDef`/`class`/`:::` styling) keeps the whole body opaque and round-trips verbatim.

Gantt diagrams are segment-preserving: `asGantt` keeps title/section/task ops live while calendar directives (`dateFormat`, `axisFormat`, `excludes`, `includes`, `weekend`, `weekday`, `todayMarker`, `tickInterval`, `inclusiveEndDates`, `topAxis`), `click` lines, comments, and accessibility lines ride along verbatim. Gantt rendering is deterministic and never reads the wall clock; pass `ganttToday` when rendering if a `todayMarker` should be visible.

`references/upstream/` documents Mermaid syntax for many more families than this renderer accepts; it is authoring reference only. `am capabilities --json` is the authoritative list of renderable families.

## Workflow

For new diagrams, author Mermaid source directly, then `parseMermaid` / `verifyMermaid` / render. For existing modeled diagrams:

1. `parseMermaid(source)` → `ValidDiagram`.
2. `asFlowchart(d)` / `asState(d)` / `asSequence(d)` / `asTimeline(d)` / `asClass(d)` / `asEr(d)` / `asJourney(d)` / `asArchitecture(d)` / `asXyChart(d)` / `asPie(d)` / `asQuadrant(d)` / `asGantt(d)` to narrow before mutating.
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
const verify = verifyMermaid(cur)
if (!verify.ok) return { phase: 'verify', warnings: verify.warnings }
const svg = renderMermaidSVG(cur, { security: 'strict' })
const png = renderMermaidPNG(cur, { fitTo: { width: 1200 }, background: '#fff' })
const ascii = renderMermaidASCII(cur, { useAscii: true })
const unicode = renderMermaidASCII(cur, { useAscii: false })
const layout = verify.layout
```

CLI PNG: `am render diagram.mmd --format png --output diagram.png`.

See `references/flowchart.md`, `references/sequence.md`, `references/timeline.md`, `references/upstream/gantt.md`, and the repository cookbook at `docs/agent-api-cookbook.md`.
