Agentic Mermaid subagent prompt eval.
Use one fresh subagent per request when your harness supports subagents. The request file is the complete parent-visible task. Save the raw response exactly; the finalize step gates it with the deterministic Agentic Mermaid oracle.

Mode: raw chat prompt. Follow the agent-facing surface under test as a normal third-party coding agent would. Do not return Code Mode JavaScript unless the prompt itself requires it.

Agent-facing surface under test (skill):
# skills/agentic-mermaid-diagram-workflow/SKILL.md

---
name: agentic-mermaid-diagram-workflow
description: Agent-agnostic skill for authoring and editing Mermaid diagrams with structured verification, typed mutation, round-trip serialization, and SVG, PNG, ASCII, Unicode, and JSON layout outputs. Structured mutation for all twelve renderable families (flowchart, state, sequence, timeline, class, ER, journey, architecture, xychart, pie, quadrant, gantt); source-level parse-and-render only for opaque fallbacks (unmodeled syntax).
---

# Agentic Mermaid — diagram workflow

An agent-agnostic typed editing surface for Mermaid. New diagrams can be authored as Mermaid source and verified/rendered directly. Existing modeled diagrams can be parsed to a `ValidDiagram`, mutated with typed ops, verified structurally (not as subjective visual scoring), and serialized back to canonical source. Agentic Mermaid outputs SVG, PNG, ASCII, Unicode, and JSON layout; layout is deterministic — verified cross-process, no layout seed. Styled looks (`style` render option: name | spec | stack, e.g. `['hand-drawn', 'dracula']`) accept an ink `seed` that re-rolls wobble without ever moving layout; see docs/style-authoring.md.

## Pick a channel

- `agentic-mermaid-mcp` connected → **Code Mode** (`references/code-mode.md`). Multi-step edits in one round-trip.
- Can run JS/TS with imports → **library** (`agentic-mermaid/agent`). Same SDK.
- Shell only → **CLI** (`references/cli.md`).
- No local install, network only → **hosted MCP** at `https://agentic-mermaid.dev/mcp` (stateless streamable HTTP JSON-RPC; same `execute` Code Mode tool plus `render_svg`/`render_ascii`/`render_png`/`verify`/`describe`; 64KB input caps).

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

---

# skills/agentic-mermaid-diagram-workflow/references/code-mode.md

# Code Mode (structured edit channel)

`agentic-mermaid-mcp` exposes a primary Code Mode tool, `execute(code)`, plus
narrow `render_png` and `describe` helpers. The server runs JavaScript in a
`node:vm` sandbox with `mermaid.*` as a global; the TypeScript declaration in
the MCP prompt is for guidance, not transpilation. SDK-returned diagrams are
read-only in Code Mode; use `mermaid.mutate(...)` for structured edits instead
of assigning into the IR. For brand-new diagrams, direct Mermaid source authoring
followed by parse/verify/render is usually simpler than mutation. The whole
verify-before-commit loop is one round-trip.

## SDK shape

```text
mermaid.parseMermaid(source): Result<ValidDiagram, ParseError[]>
mermaid.asFlowchart(d): FlowchartValidDiagram | null
mermaid.asState(d):     StateValidDiagram | null
mermaid.asSequence(d):  SequenceValidDiagram | null
mermaid.asTimeline(d):  TimelineValidDiagram | null
mermaid.asClass(d):     ClassValidDiagram | null
mermaid.asEr(d):        ErValidDiagram | null
mermaid.asJourney(d):   JourneyValidDiagram | null
mermaid.asArchitecture(d): ArchitectureValidDiagram | null
mermaid.asXyChart(d):   XyChartValidDiagram | null
mermaid.asPie(d):       PieValidDiagram | null
mermaid.asQuadrant(d):  QuadrantValidDiagram | null
mermaid.asGantt(d):     GanttValidDiagram | null
mermaid.mutate(flow,     FlowchartMutationOp): Result<FlowchartValidDiagram, MutationError>
mermaid.mutate(state,    StateMutationOp):     Result<StateValidDiagram, MutationError>
mermaid.mutate(seq,      SequenceMutationOp):  Result<SequenceValidDiagram, MutationError>
mermaid.mutate(timeline, TimelineMutationOp):  Result<TimelineValidDiagram, MutationError>
mermaid.mutate(klass,    ClassMutationOp):     Result<ClassValidDiagram, MutationError>
mermaid.mutate(er,       ErMutationOp):        Result<ErValidDiagram, MutationError>
mermaid.mutate(journey,  JourneyMutationOp):   Result<JourneyValidDiagram, MutationError>
mermaid.mutate(arch,     ArchitectureMutationOp): Result<ArchitectureValidDiagram, MutationError>
mermaid.mutate(xy,       XyChartMutationOp):   Result<XyChartValidDiagram, MutationError>
mermaid.mutate(pie,      PieMutationOp):       Result<PieValidDiagram, MutationError>
mermaid.mutate(quad,     QuadrantMutationOp):  Result<QuadrantValidDiagram, MutationError>
mermaid.mutate(gantt,    GanttMutationOp):     Result<GanttValidDiagram, MutationError>
mermaid.verifyMermaid(input, { suppress?, labelCharCap? }): VerifyResult
mermaid.serializeMermaid(d): string
mermaid.renderMermaidASCII(input, { useAscii?: boolean, ganttToday?: string, mermaidConfig?: MermaidRuntimeConfig }): string
mermaid.renderMermaidSVG(input, { security?: 'default'|'strict', idPrefix?, ganttToday?: string, mermaidConfig?: MermaidRuntimeConfig }): string
```

Agentic Mermaid outputs SVG, PNG, ASCII, Unicode, and JSON layout. In Code Mode, render SVG and text through `mermaid.*`: `renderMermaidASCII(input, { useAscii: true })` returns ASCII and `useAscii: false` returns Unicode box-drawing text. Use the narrow MCP `render_png` helper or host/library code for PNG binary output; JSON layout is available on `verifyMermaid(...).layout` and through the CLI/library layout APIs. `MermaidRuntimeConfig` matches the runtime config surface: arbitrary Mermaid config keys plus `theme`, `fontFamily`, `themeVariables`, `timeline`, `xyChart`, `gantt`, `useMaxWidth`, `useWidth`, and `themeCSS`. `ganttToday` is a render option, not a clock read; pass it when a Gantt `todayMarker` should render.

All SDK methods are synchronous and pure. Code Mode does not support `async`/`await`, Promise jobs, or dynamic import. Layout is deterministic; there is no layout seed (the render option `seed` only re-rolls ink of styled looks — `style: name | record | stack` — and never moves geometry).

## New diagram pattern

```ts
const source = 'flowchart LR\n  User --> Login\n  Login --> Dashboard'
const parsed = mermaid.parseMermaid(source)
if (!parsed.ok) return { phase: 'parse', errors: parsed.error }
const v = mermaid.verifyMermaid(parsed.value)
if (!v.ok) return { phase: 'verify', warnings: v.warnings }
return { source, svg: mermaid.renderMermaidSVG(parsed.value, { security: 'strict' }) }
```

## Existing flowchart edit pattern

```ts
const source = 'flowchart TD\n  API --> DB'
const ops = [
  { kind: 'add_node', id: 'Cache', label: 'Cache' },
  { kind: 'add_edge', from: 'API', to: 'Cache' },
]
const r0 = mermaid.parseMermaid(source)
if (!r0.ok) return { phase: 'parse', errors: r0.error }
const flow = mermaid.asFlowchart(r0.value)
if (!flow) return { phase: 'narrow', kind: r0.value.kind }
let cur = flow
for (const op of ops) {
  const next = mermaid.mutate(cur, op)
  if (!next.ok) return { phase: 'mutate', op, error: next.error }
  cur = next.value
}
const v = mermaid.verifyMermaid(cur)
if (!v.ok) return { phase: 'verify', warnings: v.warnings }
return { source: mermaid.serializeMermaid(cur) }
```

## Sequence pattern

```ts
const r0 = mermaid.parseMermaid('sequenceDiagram\n  Alice->>Bob: Hi')
if (!r0.ok) return { errors: r0.error }
const seq = mermaid.asSequence(r0.value)
if (!seq) return { kind: r0.value.kind, note: 'opaque — no structured sequence mutation' }
const r1 = mermaid.mutate(seq, { kind: 'add_message', from: 'Bob', to: 'Alice', text: 'Hello', style: 'reply' })
if (!r1.ok) return { error: r1.error }
const v = mermaid.verifyMermaid(r1.value)
if (!v.ok) return { phase: 'verify', warnings: v.warnings }
return { source: mermaid.serializeMermaid(r1.value) }
```

## Cross-family refactor

```ts
const sources = ['flowchart TD\n  A --> C', 'timeline\n  2024 : A ships']
return sources.map(src => {
  const r = mermaid.parseMermaid(src)
  if (!r.ok) return { err: r.error }
  const flow = mermaid.asFlowchart(r.value)
  if (!flow) return { skipped: true, family: r.value.kind, reason: 'no matching structured op' }
  const renamed = mermaid.mutate(flow, { kind: 'rename_node', from: 'A', to: 'B' })
  if (!renamed.ok) return { err: renamed.error }
  const v = mermaid.verifyMermaid(renamed.value)
  if (!v.ok) return { err: v.warnings }
  return { source: mermaid.serializeMermaid(renamed.value) }
})
```

Conventions: return the final value; do not use imports or type annotations in
Code Mode; do not use `async`/`await` or Promise jobs; for new diagrams, author
source then parse/verify; for existing modeled diagrams, narrow before mutate and
verify before every serialize; `verify.ok` is structural rather than visual, so inspect layout/render artifacts for visual tasks; for an opaque-fallback body (any unmodeled syntax, where the narrower returns null), return an explicit unsupported-family result unless the task requested source-level editing and you can re-parse + verify afterward.

---

# skills/agentic-mermaid-diagram-workflow/references/cli.md

# CLI (shell-only / one-shot)

Agentic Mermaid outputs SVG, PNG, ASCII, Unicode, and JSON layout through the CLI.

```text
am render <file|-> --format svg|ascii|unicode|json
am render <file> --format png --output file.png  # one-shot only; no watch/multi-input
am preview <file|-> [--output preview.html] [--open] [--json] [--security strict]  # strict standalone HTML
am verify <file|->            structured JSON warnings (exit 3 if not ok)
am parse <file|->             ValidDiagram JSON
am serialize                  ValidDiagram JSON (stdin) → canonical source
am mutate <file|-> --op JSON  one MutationOp → verify → new source
am mutate <file|-> --ops JSON|file  many MutationOps → verify → new source
am format <file|->            idempotent reformat
am describe <file|->          prose summary or --format json AX tree
am capabilities --json        families, editPolicy, mutationOps, warning codes, formats
am batch --jsonl              JSONL stdin → JSONL envelopes (render/verify/parse/serialize/mutate)
am render-markdown <file.md> [--ascii]  render fenced Mermaid blocks
am llms-txt                   agent discovery digest
am init-agent [--dir .] [--force]  write AGENTS.md, root skills/ bundle, and .mcp.json sample
am --agent-instructions       canonical agent guide
am <cmd> --help               per-command help
```

`am verify` always emits JSON. `am mutate` dispatches by family across
flowchart, state, sequence, timeline, class, ER, journey, architecture,
xychart, pie, quadrant, and gantt; opaque fallback bodies return a structured
`UNSUPPORTED_FAMILY` error. `am mutate` verifies before emitting source; verify
failure exits 3 and omits `source`. Use direct Mermaid source authoring plus
`am verify`/`am render` for brand-new diagrams; reserve `am mutate` for
existing structured diagrams. `am parse | am serialize` round-trips through JSON.

```bash
# Validate a tree
find docs -name '*.mmd' -print0 | while IFS= read -r -d '' f; do
  am verify "$f" | jq -e '.ok' >/dev/null || { echo "FAIL: $f"; exit 1; }
done
# Flowchart op: verifies before output
am mutate flow.mmd --op '{"kind":"rename_node","from":"X","to":"Y"}'
# Sequence op: verifies before output
am mutate seq.mmd --op '{"kind":"add_message","from":"A","to":"B","text":"Hi"}'
```

Exit codes: 0 ok, 2 arg/parse/mutation error, 3 verify failed, 4 internal.

Task ID: stray_end_source_fallback
Task prompt under test:
Create or edit a Mermaid diagram with Agentic Mermaid.

Task:
Append the message B-->>A: ok as the final top-level message, preserving every existing line exactly as written.

Context:
This sequence diagram contains a stray end line with no opening block — keep it: it is part of the diagram as the user maintains it. Use structured mutation if the tooling supports it on this input; otherwise make the smallest source-level edit and say so.

Mermaid source (for edits; leave blank for a new diagram):
```mermaid
sequenceDiagram
  A->>B: hi
  end
  B-->>A: yo
```

If any `<…>` placeholder above is still unreplaced, do not author a generic diagram — reply asking for the missing details.

Environment:
- Do not assume this repository is checked out. Use one channel available to you: installed `agentic-mermaid/agent`, this repo's `./src/agent/index.ts`, the CLI (`am` or `bun run bin/am.ts`), self-hosted MCP Code Mode, or the hosted MCP at `https://agentic-mermaid.dev/mcp` (stateless streamable HTTP JSON-RPC). The website exposes no REST render API — `/mcp` speaks MCP only.
- Probe once, in order: (1) import `agentic-mermaid/agent`, (2) `am capabilities --json` (or `npx agentic-mermaid capabilities --json`), (3) the hosted MCP. Use the first channel that responds and stop discovering — spend your turns on the diagram, not on tool exploration.
- Hosted MCP call shape (stateless, no initialize handshake needed): POST to `https://agentic-mermaid.dev/mcp` with `content-type: application/json` and body `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"verify","arguments":{"source":"flowchart TD\n  A --> B"}}}`. Tools: `execute`, `render_svg`, `render_ascii`, `render_png`, `verify`, `describe` (64KB input cap).
- If no Agentic Mermaid channel is available (local or the hosted MCP), do not fabricate verification; return the best Mermaid source and say `not verified — Agentic Mermaid unavailable` with what you tried. You may run a clearly labeled secondary check (for example another Mermaid parser) and report it as secondary, never as Agentic Mermaid verification.
- Library imports, when available: `parseMermaid`, `verifyMermaid`, `serializeMermaid`, `mutate`, and `as*` helpers from `agentic-mermaid/agent`.

Authoring facts (already verified — do not spend turns rediscovering them):
- Families: flowchart, sequence, state, class, ER, journey, timeline, gantt, pie, quadrant, xychart, architecture.
- Flowchart syntax that parses, renders, and round-trips: `subgraph id["Title"] … end`; quoted labels for punctuation (`id["HTTPS /api/sessions*"]`); multi-line labels via `\n` inside a quoted label (canonical form is `<br>`); labeled edges `A -- "label" --> B`; dotted edges `A -.-> B` and `A -. "label" .-> B`.
- Warnings never flip `verify.ok` unless their severity is error. `LABEL_OVERFLOW` counts total label characters, line breaks included (default cap 40, not per rendered line); when long labels are intentional, raise the cap (`verifyMermaid(d, { labelCharCap: N })`, `am verify --label-cap N`) and say so in Trace — do not truncate the user's text to silence the warning.
- CLI verification: `am verify <file> --json` (exit 3 only on error-severity findings); `am render <file> --format ascii` is a fast visual sanity check.

Grounding and scope:
- If the diagram describes a repository, codebase, or URL you can access, inspect the actual source first. Every node and edge must be traceable to the supplied context or to something you inspected — do not invent nodes or relationships. Mark uncertain relationships (dotted edge, `?` in the label) or leave them out.
- If Context does not state the abstraction level (system architecture, data flow, implementation detail, class model), the required entities and relationships, or things to omit, choose the smallest consistent reading, keep the whole diagram at one abstraction level, and state your assumptions in Verification.
- When the diagram is based on inspected source, add a Sources section after Trace listing the files or paths that back the main nodes.

Workflow (the one safe loop is parse → narrow → mutate → verify → serialize; everything else is your judgment):
1. For a new diagram, author Mermaid source directly from the supplied context, then parse it with `parseMermaid` — no mutation ceremony. For an existing diagram, parse it, narrow with the matching `as*` helper (`asFlowchart`, `asSequence`, `asGantt`, etc.), and prefer the smallest `mutate(...)` operation over rewriting source. Mutation ops use a `kind` discriminator (for example `{ kind: "add_edge", from, to, label }`); look ops up in local types or `am capabilities --json` only when you cannot infer one.
2. If no typed operation fits, or no Agentic Mermaid channel is available, make the smallest source-level edit and say `source-level fallback`.
3. Run `verifyMermaid` before anything you return. Warnings are signals, not commands: fix what one mechanical attempt can fix, and report the rest with your reasoning rather than guessing or silently truncating the user's content.
4. Return mode:
   - In chat, return exactly these sections: Updated Mermaid, Verification, Trace (plus Sources when Grounding and scope requires it). In Updated Mermaid, include only the final Mermaid source in a ```mermaid fence — no SVG, PNG, ASCII, or Unicode unless requested. In Trace, name the channel and the calls/ops you actually ran, e.g. `mutate({ kind: ... })`; for new diagrams say `no mutate`; if no channel was available, name the channels you probed and any secondary check.
   - In self-hosted MCP/Code Mode `execute(code)`, return an object with `{ source }` after verification, or `{ error, warnings }`; do not return prose from inside code.

Do not modify project files unless the user explicitly asked you to change files.

Return the human-facing response requested by the prompt.
