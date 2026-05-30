# Code Mode (preferred channel)

`agentic-mermaid-mcp` exposes a primary Code Mode tool, `execute(code)`, plus
narrow `render_png` and `describe` helpers. The server runs JavaScript in a
`node:vm` sandbox with `mermaid.*` as a global; the TypeScript declaration in
the MCP prompt is for guidance, not transpilation. SDK-returned diagrams are
read-only in Code Mode; use `mermaid.mutate(...)` for structured edits instead
of assigning into the IR. The whole verify-after-mutate loop is one round-trip.

## SDK shape

```text
mermaid.parseMermaid(source): Result<ValidDiagram, ParseError[]>
mermaid.asFlowchart(d): FlowchartValidDiagram | null
mermaid.asSequence(d):  SequenceValidDiagram | null
mermaid.asTimeline(d):  TimelineValidDiagram | null
mermaid.asClass(d):     ClassValidDiagram | null
mermaid.asEr(d):        ErValidDiagram | null
mermaid.mutate(flow,     FlowchartMutationOp): Result<FlowchartValidDiagram, MutationError>
mermaid.mutate(seq,      SequenceMutationOp):  Result<SequenceValidDiagram, MutationError>
mermaid.mutate(timeline, TimelineMutationOp):  Result<TimelineValidDiagram, MutationError>
mermaid.mutate(klass,    ClassMutationOp):     Result<ClassValidDiagram, MutationError>
mermaid.mutate(er,       ErMutationOp):        Result<ErValidDiagram, MutationError>
mermaid.verifyMermaid(input, { suppress?, labelCharCap? }): VerifyResult
mermaid.serializeMermaid(d): string
mermaid.renderMermaidSVG(input, { security?: 'default'|'strict', idPrefix?, mermaidConfig?: MermaidRuntimeConfig }): string
mermaid.renderMermaidASCII(input, { useAscii?: boolean, mermaidConfig?: MermaidRuntimeConfig }): string
```

`MermaidRuntimeConfig` matches the runtime config surface: arbitrary Mermaid config keys plus `theme`, `fontFamily`, `themeVariables`, `timeline`, `xyChart`, `useMaxWidth`, `useWidth`, and `themeCSS`.

All SDK methods are synchronous and pure. Code Mode does not support `async`/`await`, Promise jobs, or dynamic import. Layout is deterministic; there is no seed.

## Flowchart pattern

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
Code Mode; do not use `async`/`await` or Promise jobs; narrow before mutate; verify before every
serialize; for opaque bodies, return an explicit unsupported-family result unless
the task requested source-level editing and you can re-parse + verify afterward.
