# Code Mode (structured edit channel)

`agentic-mermaid-mcp` exposes a primary Code Mode tool, `execute(code)`, plus
narrow `describe_sdk`, `render_png`, and `describe` helpers. The initial
`execute` declaration contains only the core SDK. Call
`describe_sdk({ family, detail: 'fields' })` before an unfamiliar mutation to
load that family's exact schema; use `detail: 'signatures'` for a compact menu.
The server runs JavaScript in a
`node:vm` sandbox with `mermaid.*` as a global; the TypeScript declaration in
the MCP prompt is for guidance, not transpilation. SDK-returned diagrams are
read-only in Code Mode; use `mermaid.mutate(...)` for structured edits instead
of assigning into the IR. For brand-new diagrams, direct Mermaid source authoring
followed by parse/verify/render is usually simpler than mutation. The whole
verify-before-commit loop is one round-trip.

## SDK shape

```text
mermaid.parseRegisteredMermaid(source): Result<ValidDiagram, ParseError[]>
mermaid.asFlowchart(d): FlowchartValidDiagram | null  // example narrower
mermaid.mutate(narrowed, op): Result<ValidDiagram, MutationError> // concrete overload preserves the family
// Call describe_sdk({ family, detail: 'fields' }) for the registry-derived
// narrower and exact family operation overloads.
mermaid.verifyMermaid(input, { suppress?, labelCharCap? }): VerifyResult
mermaid.describeMermaidFacts(d): string[]
mermaid.checkMermaid(d, spec): { ok: boolean; missing: string[]; unexpected: string[]; facts: string[] }
mermaid.serializeMermaid(d): string
mermaid.renderMermaidASCII(input, { useAscii?: boolean, ganttToday?: string, mermaidConfig?: MermaidRuntimeConfig }): string
mermaid.renderMermaidSVG(input, { security?: 'default'|'strict', idPrefix?, ganttToday?: string, mermaidConfig?: MermaidRuntimeConfig }): string
```

Agentic Mermaid outputs SVG, PNG, ASCII, Unicode, and JSON layout. In Code Mode, render SVG and text through `mermaid.*`: `renderMermaidASCII(input, { useAscii: true })` returns ASCII and `useAscii: false` returns Unicode box-drawing text. Use the narrow MCP `render_png` helper or host/library code for PNG binary output; JSON layout is available on `verifyMermaid(...).layout` and through the CLI/library layout APIs. `MermaidRuntimeConfig` matches the runtime config surface: arbitrary Mermaid config keys plus `theme`, `fontFamily`, `themeVariables`, `timeline`, `xyChart`, `gantt`, `mindmap`, `gitGraph`, `useMaxWidth`, `useWidth`, and `themeCSS`. `ganttToday` is a render option, not a clock read; pass it when a Gantt `todayMarker` should render.

All SDK methods are synchronous and pure. Code Mode does not support `async`/`await`, Promise jobs, or dynamic import. Layout is deterministic; there is no layout seed (the render option `seed` only re-rolls ink of styled looks — `style: name | record | stack` — and never moves geometry).

## New diagram pattern

```ts
const source = 'flowchart LR\n  User --> Login\n  Login --> Dashboard'
const parsed = mermaid.parseRegisteredMermaid(source)
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
const r0 = mermaid.parseRegisteredMermaid(source)
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
const r0 = mermaid.parseRegisteredMermaid('sequenceDiagram\n  Alice->>Bob: Hi')
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
  const r = mermaid.parseRegisteredMermaid(src)
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
verify before every serialize; `verify.ok` is structural rather than visual or semantic, so inspect layout/render artifacts for visual tasks and use `checkMermaid` facts for task-critical meaning; for an opaque-fallback body (any unmodeled syntax, where the narrower returns null), return an explicit unsupported-family result unless the task requested source-level editing and you can re-parse + verify afterward.
