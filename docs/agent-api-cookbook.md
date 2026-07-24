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
| MCP Code Mode | An agent needs multi-step edits in one sandboxed call | local `agentic-mermaid-mcp`, global `mermaid.*` |
| Hosted MCP | No local install is available, or a client wants bounded HTTP tools | `https://agentic-mermaid.dev/mcp` tools: `execute`, render/verify/describe, `mutate`, `build` |
| CLI | Shell-only verification, rendering, preview, or one-shot mutation | `am ...` |

All channels expose the same core contract: parse, optionally narrow, mutate, verify, serialize/render. Agentic Mermaid outputs SVG, PNG, ASCII, Unicode, and JSON layout.

## Recipe: author a new diagram

Use direct source authoring for new diagrams. Do not construct a diagram by calling `mutate` repeatedly unless you specifically need a mutation trace.

```ts
import { parseRegisteredMermaid, verifyMermaid, renderMermaidSVG } from 'agentic-mermaid/agent'

const source = `flowchart LR
  User --> Login
  Login --> Dashboard`

const parsed = parseRegisteredMermaid(source)
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
import { parseRegisteredMermaid, asFlowchart, mutate, verifyMermaid, serializeMermaid } from 'agentic-mermaid/agent'

const parsed = parseRegisteredMermaid('flowchart TD\n  API --> DB')
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
import { parseRegisteredMermaid, asFlowchart, mutate, verifyMermaid, serializeMermaid, type FlowchartMutationOp } from 'agentic-mermaid/agent'

export function applyFlowchartOps(source: string, ops: FlowchartMutationOp[]) {
  const parsed = parseRegisteredMermaid(source)
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
import { parseRegisteredMermaid, asFlowchart, verifyMermaid, serializeMermaid } from 'agentic-mermaid/agent'

const parsed = parseRegisteredMermaid(source)
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

For source-level edits, preserve as much original source as possible, then run `parseRegisteredMermaid` and `verifyMermaid` again before returning it.

## Recipe: inspect quality without screenshots

`verifyMermaid` is structural. It catches reliable warning codes and returns layout JSON; it is not a subjective aesthetics score.

```ts
import { parseRegisteredMermaid, verifyMermaid, measureQuality, layoutMermaid, analyzeMermaid } from 'agentic-mermaid/agent'

const parsed = parseRegisteredMermaid(source)
if (!parsed.ok) throw new Error('parse failed')

const verify = verifyMermaid(parsed.value, { labelCharCap: 28 })
const quality = measureQuality(layoutMermaid(parsed.value))
const routes = layoutMermaid(parsed.value, { debug: true }) // opt-in route, family-edge, and region certificates
const analysis = analyzeMermaid(parsed.value) // feedback edges, actions, Gantt critical path/slack

return {
  ok: verify.ok,
  warnings: verify.warnings,
  bounds: verify.layout.bounds,
  quality,
  routeCertificates: routes.edges.map(e => e.route).filter(Boolean),
  familyCertificates: routes.certificates ?? [],
  analysis,
}
```

For a unified render plus inert action regions, use
`renderMermaidWithActions`. ASCII and Unicode artifacts include structured
terminal `warnings`; an `ASCII_RENDER_FAILED` condition throws instead of
returning an empty output as a successful artifact. SVG actions are marked
`embedded-inert` only when their target metadata is present in that SVG.
This includes Sequence `link`/`links` actor menus as well as admitted
Flowchart, Class, and Gantt interactions; strict SVG removes authored href
metadata and reports those actions through the sidecar only.

Route, family-edge, and region certificates are opt-in; when graph-edge or family-edge certificates are present, `sourcePort`/`targetPort` are exact endpoint anchors where the family exposes them, and `sourcePortAssignment`/`targetPortAssignment` describe side, ordered slot, slot count, and semantic role for graph routes. Timeline/chart certificates use region-containment fields instead. Debug layouts also expose V1 `regions` and source-only `actions` sidecars so agents can attach UI affordances without executing Mermaid callbacks.

For a renderer-neutral hit surface, use the same API for every output:

```ts
import { renderMermaidWithActions } from 'agentic-mermaid/agent'

const rendered = renderMermaidWithActions(source, {
  format: 'png',
  options: { fitTo: { width: 1200 } },
})
// rendered.output is PNG bytes; actionSurface actions reference pixel regions.
for (const action of rendered.actionSurface.actions) {
  if (action.region) console.log(action.target, action.disposition, action.region.bounds)
}
```

Use render artifacts for human visual review:

```ts
import { renderMermaidSVG, renderMermaidASCII, renderMermaidPNG } from 'agentic-mermaid/agent'

const svg = renderMermaidSVG(diagram, { security: 'strict' })
const ascii = renderMermaidASCII(diagram, { useAscii: true, targetWidth: 80 })
const png = renderMermaidPNG(diagram, { fitTo: { width: 1600 }, background: '#fff' })
```

## Recipe: write SVG, PNG, and ASCII artifacts

Library channel:

```ts
import { writeFileSync } from 'node:fs'
import { parseRegisteredMermaid, verifyMermaid, renderMermaidSVG, renderMermaidPNG, renderMermaidASCII } from 'agentic-mermaid/agent'

const parsed = parseRegisteredMermaid(source)
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

- Local MCP: use Code Mode for parse/narrow/mutate/verify/serialize.
- Local MCP: use the `render_png` helper for base64 PNG bytes when the host needs a raster artifact.
- Local HTTP/SSE mode: use `render_png` with `output: "file"` or `output: "url"` when the host wants a managed artifact instead of inline base64.
- Hosted MCP: call `describe_sdk` for one family's compact op signatures or exact field schema, then use direct `render_svg`, `render_ascii`, `render_png`, `verify`, and `describe` for one-shot work; `render_ascii` accepts `targetWidth` as a hard display-cell bound and returns `ASCII_TARGET_WIDTH_IMPOSSIBLE` details when it cannot fit. Use declarative `mutate`/`build` for straightforward op-list edits; reserve hosted `execute` for logic those tools do not express.
- Use local library/CLI/MCP for sensitive diagrams, offline work, larger inputs, or local file/URL PNG artifacts.

## Recipe: MCP Code Mode

In MCP Code Mode, do not import. The server injects `mermaid.*` as a global. Return JSON-serializable values.

```ts
const parsed = mermaid.parseRegisteredMermaid('flowchart TD\n  API --> DB')
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

## Mutation operation discovery

Use `am capabilities --json` for the registry-derived family roster, edit policy, narrower, and mutation-op names. In the library or Code Mode, use `describeOps(family)` or `opSignatures(family)` for exact fields, requiredness, enums, constraints, and defaults. Hosted MCP callers can request one family's schema with `describe_sdk`. These surfaces are generated from the same registry; this cookbook deliberately does not maintain another crib sheet.

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
| `RENDER_FAILED` | Any family: verifies structurally but the strict render parser rejects the canonical source; `reason` carries the renderer error |

Tier 2 warnings are advisory geometric checks — route tripwires for flowchart/state, plus boundary-anchor/overlap checks on class/ER entity boxes: `NODE_OVERLAP`, `ROUTE_SELF_CROSS`, and the route-contract tripwires `ROUTE_HITCH`, `ROUTE_UNEXPLAINED_BEND`, `ROUTE_LABEL_ON_SHARED_TRUNK`, `ROUTE_SELF_LOOP_OCCUPANCY`, `ROUTE_CONTAINER_MISANCHOR`, `ROUTE_SHAPE_MISANCHOR`, `ROUTE_STALE_AFTER_NODE_MOVE`.

Tier 3 covers advisory lint plus caller-selected inspect-only Brand policy: `DUPLICATE_EDGE`, `UNREACHABLE_NODE`, `DECISION_BRANCH_UNLABELED`, `FLOW_IMBALANCE`, `COMMENT_DROPPED`, `UNSUPPORTED_SYNTAX`, `CONTENT_DROPPED_ON_ROUNDTRIP`, `INEFFECTIVE_CONFIG`, `LOW_CONTRAST`, `BRAND_CONSTRAINT_WARNING`, `BRAND_CONSTRAINT_ERROR`. `FLOW_IMBALANCE` reports a sankey intermediate node whose received total differs from its emitted total, naming the node and the unaccounted amount. `LOW_CONTRAST` preserves authored paint and reports its foreground, final opaque background, ratio, and minimum; transparent output is not measured because its host backdrop is unknown. Brand constraints inspect final contrast, accent-area, or mono-role evidence without repainting or relayout. Advisory findings do not flip `verify.ok`; `BRAND_CONSTRAINT_ERROR` does only because the caller explicitly selected `action: "error"`.

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
