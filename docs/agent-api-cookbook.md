# Agentic Mermaid agent API cookbook

This is the practical API reference for agents and agent authors. It complements the short [`Instructions_for_agents.md`](../Instructions_for_agents.md) guide and the deeper [`AGENT_NATIVE.md`](../AGENT_NATIVE.md) rationale.

## Mental model

Agentic Mermaid is not just a renderer. It is a structured edit loop:

1. **Parse** Mermaid source into a `ValidDiagram`.
2. **Narrow** existing structured diagrams to the family you intend to edit.
3. **Mutate** with typed operations instead of string-splicing source.
4. **Verify** before any commit point.
5. **Serialize** only after inspecting `verify.ok`, `verify.warnings`, and, when relevant, `verify.layout`.

For brand-new diagrams, author Mermaid source directly, then parse/verify/render. For existing modeled diagrams, prefer typed mutation so edits preserve structure and round-trip predictably.

## Pick the right channel

| Channel | Use when | Surface |
|---|---|---|
| Library | You can run TypeScript/JavaScript | `import ... from 'agentic-mermaid/agent'` |
| MCP Code Mode | An agent needs multi-step edits in one sandboxed call | `agentic-mermaid-mcp`, global `mermaid.*` |
| CLI | Shell-only verification, rendering, preview, or one-shot mutation | `am ...` |

All three channels expose the same contract: parse, optionally narrow, mutate, verify, serialize/render. Agentic Mermaid outputs ASCII, PNG, and SVG; Unicode text and JSON layout are also available.

## Recipe: author a new diagram

Use direct source authoring for new diagrams. Do not construct a diagram by calling `mutate` repeatedly unless you specifically need a mutation trace.

```ts
import { parseMermaid, verifyMermaid, renderMermaidSVG } from 'agentic-mermaid/agent'

const source = `flowchart LR
  User --> Login
  Login --> Dashboard`

const parsed = parseMermaid(source)
if (!parsed.ok) throw new Error(parsed.error.map(e => e.message).join('\n'))

const verify = verifyMermaid(parsed.value)
if (!verify.ok) throw new Error(JSON.stringify(verify.warnings, null, 2))

const svg = renderMermaidSVG(parsed.value, { security: 'strict' })
```

CLI equivalent:

```bash
am verify diagram.mmd
am preview diagram.mmd --security strict --open
am render diagram.mmd --format svg > diagram.svg
```

## Recipe: edit an existing flowchart safely

```ts
import { parseMermaid, asFlowchart, mutate, verifyMermaid, serializeMermaid } from 'agentic-mermaid/agent'

const parsed = parseMermaid('flowchart TD\n  API --> DB')
if (!parsed.ok) throw new Error('parse failed')

const flow = asFlowchart(parsed.value)
if (!flow) throw new Error(`not a structured flowchart: ${parsed.value.kind}`)

const r1 = mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
if (!r1.ok) throw new Error(r1.error.message)

const r2 = mutate(r1.value, { kind: 'add_edge', from: 'API', to: 'Cache' })
if (!r2.ok) throw new Error(r2.error.message)

const verify = verifyMermaid(r2.value)
if (!verify.ok) throw new Error(JSON.stringify(verify.warnings, null, 2))

const source = serializeMermaid(r2.value)
```

CLI equivalent:

```bash
am mutate flow.mmd --ops '[
  {"kind":"add_node","id":"Cache","label":"Cache"},
  {"kind":"add_edge","from":"API","to":"Cache"}
]'
```

`am mutate` verifies before emitting source. If verification fails, it exits `3` and omits `source`.

## Recipe: batch mutations with rollback

When applying several edits, keep the previous verified value. If a mutation or verification fails, return the last known-good diagram and the failure reason.

```ts
import { parseMermaid, asFlowchart, mutate, verifyMermaid, serializeMermaid, type FlowchartMutationOp } from 'agentic-mermaid/agent'

export function applyFlowchartOps(source: string, ops: FlowchartMutationOp[]) {
  const parsed = parseMermaid(source)
  if (!parsed.ok) return { ok: false as const, phase: 'parse', error: parsed.error }

  let current = asFlowchart(parsed.value)
  if (!current) return { ok: false as const, phase: 'narrow', family: parsed.value.kind }

  const initialVerify = verifyMermaid(current)
  if (!initialVerify.ok) return { ok: false as const, phase: 'initial-verify', warnings: initialVerify.warnings }
  let lastGood = current

  for (const op of ops) {
    const next = mutate(current, op)
    if (!next.ok) return { ok: false as const, phase: 'mutate', op, error: next.error, source: serializeMermaid(lastGood) }

    const verify = verifyMermaid(next.value)
    if (!verify.ok) {
      return { ok: false as const, phase: 'verify', op, warnings: verify.warnings, source: serializeMermaid(lastGood) }
    }

    current = next.value
    lastGood = current
  }

  return { ok: true as const, source: serializeMermaid(current), verify: verifyMermaid(current) }
}
```

## Recipe: handle opaque fallback bodies

Every built-in renderable family has a typed mutation path when its modeled subset narrows successfully. Unmodeled syntax is preserved as an opaque fallback body: it still parses, verifies, renders, and serializes losslessly, but family narrowers return `null` for that particular body.

```ts
import { parseMermaid, asFlowchart, verifyMermaid, serializeMermaid } from 'agentic-mermaid/agent'

const parsed = parseMermaid(source)
if (!parsed.ok) return { phase: 'parse', errors: parsed.error }

const flow = asFlowchart(parsed.value)
if (!flow) {
  return {
    phase: 'unsupported-family',
    family: parsed.value.kind,
    source: serializeMermaid(parsed.value),
    note: 'This body is opaque. Use source-level editing only if explicitly requested; then re-parse and verify.'
  }
}

const verify = verifyMermaid(flow)
```

For source-level edits, preserve as much original source as possible, then run `parseMermaid` and `verifyMermaid` again before returning it.

## Recipe: inspect quality without screenshots

`verifyMermaid` is structural. It catches reliable warning codes and returns layout JSON; it is not a subjective aesthetics score.

```ts
import { parseMermaid, verifyMermaid, measureQuality, layoutMermaid } from 'agentic-mermaid/agent'

const parsed = parseMermaid(source)
if (!parsed.ok) throw new Error('parse failed')

const verify = verifyMermaid(parsed.value, { labelCharCap: 28 })
const quality = measureQuality(layoutMermaid(parsed.value))

return {
  ok: verify.ok,
  warnings: verify.warnings,
  bounds: verify.layout.bounds,
  quality,
}
```

Use render artifacts for human visual review:

```ts
import { renderMermaidSVG, renderMermaidASCII, renderMermaidPNG } from 'agentic-mermaid/agent'

const svg = renderMermaidSVG(diagram, { security: 'strict' })
const ascii = renderMermaidASCII(diagram, { useAscii: true })
const png = renderMermaidPNG(diagram, { fitTo: { width: 1600 }, background: '#fff' })
```

## Recipe: write SVG, PNG, and ASCII artifacts

Library channel:

```ts
import { writeFileSync } from 'node:fs'
import { parseMermaid, verifyMermaid, renderMermaidSVG, renderMermaidPNG, renderMermaidASCII } from 'agentic-mermaid/agent'

const parsed = parseMermaid(source)
if (!parsed.ok) throw new Error(parsed.error.map(e => e.message).join('\n'))

const verify = verifyMermaid(parsed.value)
if (!verify.ok) throw new Error(JSON.stringify(verify.warnings, null, 2))

writeFileSync('diagram.svg', renderMermaidSVG(parsed.value, { security: 'strict' }))
writeFileSync('diagram.png', renderMermaidPNG(parsed.value, { fitTo: { width: 1200 }, background: '#fff' }))
writeFileSync('diagram.txt', renderMermaidASCII(parsed.value, { useAscii: true }))
```

CLI channel:

```bash
am verify diagram.mmd
am render diagram.mmd --format svg > diagram.svg
am render diagram.mmd --format png --output diagram.png
am render diagram.mmd --format ascii > diagram.txt
```

MCP channel:

- Use Code Mode for parse/narrow/mutate/verify/serialize.
- Use the `render_png` helper for base64 PNG bytes when the host needs a raster artifact.
- In HTTP/SSE mode, use `render_png` with `output: "file"` or `output: "url"` when the host wants a managed artifact instead of inline base64.
- Use Code Mode or library/CLI for SVG and ASCII artifacts.

## Recipe: MCP Code Mode

In MCP Code Mode, do not import. The server injects `mermaid.*` as a global. Return JSON-serializable values.

```ts
const parsed = mermaid.parseMermaid('flowchart TD\n  API --> DB')
if (!parsed.ok) return { phase: 'parse', errors: parsed.error }

const flow = mermaid.asFlowchart(parsed.value)
if (!flow) return { phase: 'narrow', family: parsed.value.kind }

const next = mermaid.mutate(flow, { kind: 'rename_node', from: 'DB', to: 'Database' })
if (!next.ok) return { phase: 'mutate', error: next.error }

const verify = mermaid.verifyMermaid(next.value)
if (!verify.ok) return { phase: 'verify', warnings: verify.warnings }

return { source: mermaid.serializeMermaid(next.value) }
```

Code Mode constraints:

- No imports, dynamic imports, `async`/`await`, or Promise jobs.
- SDK-returned diagrams are read-only; edit through `mermaid.mutate`.
- Binary output such as PNG should usually be produced by a narrow helper or host code, not by large Code Mode payloads. `agentic-mermaid-mcp --transport http` serves managed URL artifacts from `/artifacts/<name>`.

## Mutation op crib sheet

Use `am capabilities --json` for machine-readable discovery. Current typed mutation families are:

| Family | Narrower | Op kinds |
|---|---|---|
| Flowchart | `asFlowchart` | `add_node`, `remove_node`, `rename_node`, `set_label`, `add_edge`, `remove_edge` |
| State | `asState` | `add_state`, `remove_state`, `rename_state`, `set_state_label`, `add_transition`, `remove_transition`, `set_transition_label`, `make_composite` |
| Sequence | `asSequence` | `add_participant`, `remove_participant`, `add_message`, `remove_message`, `set_message_text` |
| Timeline | `asTimeline` | `set_title`, `add_section`, `remove_section`, `set_section_label`, `add_period`, `remove_period`, `set_period_label`, `add_event`, `remove_event`, `set_event_text` |
| Class | `asClass` | `set_title`, `add_class`, `remove_class`, `rename_class`, `add_member`, `remove_member`, `add_relation`, `remove_relation`, `add_note`, `remove_note` |
| ER | `asEr` | `add_entity`, `remove_entity`, `rename_entity`, `add_attribute`, `remove_attribute`, `add_relation`, `remove_relation` |
| Journey | `asJourney` | `set_title`, `add_section`, `remove_section`, `set_section_label`, `add_task`, `remove_task`, `set_task_text`, `set_task_score`, `set_task_actors`, `rename_actor` |
| Architecture | `asArchitecture` | `add_service`, `remove_service`, `rename_service`, `set_service_label`, `set_service_icon`, `move_service`, `add_group`, `remove_group`, `add_edge`, `remove_edge` |
| XY chart | `asXyChart` | `set_title`, `set_x_axis`, `set_y_axis`, `add_series`, `remove_series`, `set_series_values`, `set_series_name`, `reorder_series` |
| Pie | `asPie` | `set_title`, `set_show_data`, `add_slice`, `remove_slice`, `rename_slice`, `set_slice_value`, `reorder_slice` |
| Quadrant | `asQuadrant` | `set_title`, `set_axis_labels`, `set_quadrant_label`, `add_point`, `remove_point`, `move_point`, `rename_point` |
| Gantt | `asGantt` | `set_title`, `add_section`, `rename_section`, `remove_section`, `add_task`, `remove_task`, `rename_task`, `set_task_status`, `set_task_dates` |

Unsupported typed mutation is a stop signal, not a prompt to fake structure. Either report the unsupported family or perform explicit source-level editing followed by parse/verify.

## Warning-code crib sheet

Tier 1 warnings are reliable structural/source checks. Do not suppress Tier 1 errors unless you fully understand the consequence.

| Code | Meaning |
|---|---|
| `EMPTY_DIAGRAM` | Nothing renderable |
| `EDGE_MISANCHORED` | Edge endpoint is not attached to a real target |
| `OFF_CANVAS` | Node or edge segment lies outside canvas bounds |
| `GROUP_BREACH` | Member lies outside its group bounds |
| `UNKNOWN_SHAPE` | Shape fell back because the name is unrecognized |
| `LABEL_OVERFLOW` | Label exceeds `labelCharCap` |
| `UNRESOLVABLE_SCHEDULE` | Gantt parses but its schedule cannot resolve; render would fail |

Tier 2 warnings are advisory geometric checks for flowchart/state: `NODE_OVERLAP`, `ROUTE_SELF_CROSS`, and the route-contract tripwires `ROUTE_HITCH`, `ROUTE_UNEXPLAINED_BEND`, `ROUTE_LABEL_ON_SHARED_TRUNK`, `ROUTE_CONTAINER_MISANCHOR`, `ROUTE_SHAPE_MISANCHOR`, `ROUTE_STALE_AFTER_NODE_MOVE`.

Tier 3 warnings are advisory lint checks for common agent mistakes: `DUPLICATE_EDGE`, `UNREACHABLE_NODE`, `DECISION_BRANCH_UNLABELED`, `COMMENT_DROPPED`. They do not flip `verify.ok`, but they are worth fixing when the caller asks for clean maintainable diagrams.

## Common anti-patterns

- Regenerating an existing structured diagram instead of mutating it.
- Concatenating source for an edit covered by a typed op.
- Serializing before reading `verify.ok` and `verify.warnings`.
- Treating `verify.ok` as a human aesthetics score.
- Calling `mutate` on opaque fallback bodies.
- Hiding unsupported-family results. Return them explicitly so the caller can choose a source-level path.

## Minimal decision tree

```text
Do you have a brand-new diagram?
  yes → write Mermaid source → parse → verify → render/return
  no  → parse existing source
        structured narrower exists?
          yes → mutate → verify → serialize
          no  → preserve source; report unsupported-family unless source-level editing was requested
```
