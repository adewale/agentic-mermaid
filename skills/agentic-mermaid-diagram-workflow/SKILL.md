---
name: agentic-mermaid-diagram-workflow
description: Agent-agnostic skill for authoring and editing Mermaid diagrams with structured verification, typed mutation, round-trip serialization, and graphical, terminal, and layout outputs. The live capability registry identifies renderable and mutable families; unmodeled syntax remains source-preserved.
---

# Agentic Mermaid — diagram workflow

An agent-agnostic typed editing surface for Mermaid. New diagrams can be authored as Mermaid source and verified/rendered directly. Existing modeled diagrams can be parsed to a `ValidDiagram`, mutated with typed ops, verified structurally (not as subjective visual scoring), and serialized back to canonical source. Agentic Mermaid outputs SVG, PNG, ASCII, Unicode, and JSON layout; layout is deterministic — verified cross-process, no layout seed. Styled looks (`style` render option: name | spec | stack, e.g. `['hand-drawn', 'dracula']`) accept an ink `seed` that re-rolls wobble without ever moving layout; see docs/style-authoring.md.

## Pick a channel

- `agentic-mermaid-mcp` connected → **Code Mode** (`references/code-mode.md`). Multi-step edits in one round-trip.
- Can run JS/TS with imports → **library** (`agentic-mermaid/agent`). Same SDK.
- Shell only → **CLI** (`references/cli.md`).
- No local install, network only → **hosted MCP** at `https://agentic-mermaid.dev/mcp` (stateless Streamable HTTP JSON-RPC; `execute`, `describe_sdk`, `render_svg`, `render_ascii`, `render_png`, `verify`, `describe`, `mutate`, and `build` tools — 64 KB input cap). Read `references/hosted-mcp.md` before composing a hosted request. Use the named direct tool and its exact argument object; do not substitute library APIs or local Code Mode for a hosted direct-tool task.

For hosted MCP, choose the least-powerful tool that completes the task:

| Need | Tool | Required arguments |
|---|---|---|
| Structural validity, family, warnings, layout counts | `verify` | `{ source }` |
| Prose, AX tree, or semantic fact inventory | `describe` | `{ source, format?: 'text' \| 'json' \| 'facts' }` |
| Edit an existing diagram with known ops | `mutate` | `{ source, ops: [{ kind, ...fields }] }` |
| Author a new modeled diagram with known ops | `build` | `{ family, ops: [{ kind, ...fields }] }` |
| Discover one family's exact op fields | `describe_sdk` | `{ family, detail: 'fields' }` |
| Custom synchronous control flow | `execute` | `{ code, timeoutMs? }` |

Use `render_svg`, `render_ascii`, or `render_png` for a requested output; do not route a one-shot render, verify, describe, mutate, or build through `execute`.
Mutation vocabularies are family-specific and are never interchangeable. In
particular, a state diagram uses `add_state` and `add_transition`; never reuse
the flowchart-only `add_node` or `add_edge` kinds for a state diagram. If the
exact family op is not already known, call `describe_sdk` instead of borrowing
an op name from another family. State `add_state` accepts `id`, optional
`label`, `parent`, and `region`; it has no `terminal` field. Model an
unsuccessful terminal state as an ordinary state reached by the requested
labeled transition rather than inventing a convenience flag. For a class
association, use `{ kind: 'add_relation', from, to, relKind: 'association' }`;
there is no `add_relationship` op or `relation` field.
The request envelope's `tool` is always one of the bare hosted names above.
Never invent a provider-qualified name such as `hosted_agentic_mermaid_mcp.*`
or a diagram-specific tool such as `update_state_diagram`.
For a hosted task that asks for one final fenced JSON request, use this exact
response order: (1) finish all explanation as prose or inline code, (2) emit
the request in the answer's only fenced block, and (3) stop immediately after
the closing fence. Never print a fenced request before the explanation, even as
an example or draft, and never repeat it. Before emitting, count exactly one
fenced block and recheck every op `kind` and field against this skill or
`describe_sdk`; do not substitute a plausible synonym.

## Capability discovery

Run `am capabilities --json` (or call the equivalent SDK capability API) before
choosing a family or mutation. Its registry-derived family entries expose the
current narrower, operation schema, edit policy, output support, and minimal
source example; the generated Section A matrix supplies explicit native,
source-preserved, diagnosed, and absent states. This skill intentionally does
not maintain a second family or operation table.

On hosted MCP, inspect the connected server's `tools/list` for its tool surface
and call `describe_sdk({ family, detail: 'fields' })` for mutation fields. There
is no hosted tool named `capabilities`.

Any diagram with constructs we don't model falls back to an **opaque** body: it still parses, renders, verifies, and round-trips losslessly — it just isn't offered for structured mutation (the narrower returns null). The parser never silently drops anything.

State diagrams own a dedicated body: `asState` models states/transitions, `[*]`, composites, stereotypes/history, concurrency regions, notes, bare declarations, and class/inline paint. `asFlowchart` returns null on a state diagram.

Gantt diagrams are segment-preserving: `asGantt` keeps title/section/task ops live while calendar directives (`dateFormat`, `axisFormat`, `excludes`, `includes`, `weekend`, `weekday`, `todayMarker`, `tickInterval`, `inclusiveEndDates`, `topAxis`), `click` lines, comments, and accessibility lines ride along verbatim. Gantt rendering is deterministic and never reads the wall clock; pass `ganttToday` when rendering if a `todayMarker` should be visible.

`references/upstream/` documents Mermaid syntax for many more families than this renderer accepts; it is authoring reference only. `am capabilities --json` is the authoritative list of renderable families.

## Workflow

For new diagrams, author Mermaid source directly, then `parseRegisteredMermaid` / `verifyMermaid` / render. For existing modeled diagrams:

1. `parseRegisteredMermaid(source)` → `ValidDiagram`.
2. Use the family entry's advertised narrower (for example `asFlowchart(d)` or
   `asState(d)`) before mutating.
3. `mutate(d, op)` (typed per family).
4. `verifyMermaid(d)` — structured warnings; inspect `ok` / `warnings` / `layout`.
5. On `!ok`, revert to the previous `ValidDiagram`, try another op.
6. `serializeMermaid(d)` only after inspected verify passes.

Do not regenerate or concatenate source to edit an existing structured diagram when a typed op exists. Direct source authoring is fine for new diagrams. Mutation ops use the discriminator field `kind` (not `type`). Edge removal uses ids such as `{ kind: 'remove_edge', id: 'API->DB' }`; verify before serializing.

For `mutate` or `build`, treat the returned envelope as the commit boundary:
accept `source` only when both top-level `ok` and `verify.ok` are true, and
inspect `verify.warnings`. If an op fails, use its `opIndex` and `error`, call
`describe_sdk` with `detail: 'fields'`, then retry with only the returned
`kind` and fields. Never guess a hosted op name or fall back to source
concatenation.

When the user asks which embedded verification fields must pass, name the
response paths exactly: require top-level `ok`, confirm top-level `family`,
require `verify.ok`, and inspect `verify.warnings`. Do not replace those field
paths with a paraphrase.

In a hosted `mutate` request, `source` is the exact pre-edit input; do not apply
the requested change to that string yourself. Express every change only in
`ops`, and include no convenience fields that `describe_sdk` did not advertise.
For file-backed input, inspect the bytes rather than relying on terminal display:
preserve line endings and whether the file has a final newline. If the file ends
in LF, the JSON `source` string must end in `\n` after its last visible line.
Never trim or normalize the source; compare the JSON-decoded `source` bytes to
the attachment before emitting the request.

If a request such as “make this better” has no concrete quality goal, ask for
the audience, output medium, and intended improvement before mutating. A
read-only `verify`, `describe`, or render inspection is safe to offer, but do
not invent an edit objective.

Minimal existing-flowchart pattern:

```ts
const parsed = parseRegisteredMermaid(source)
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
