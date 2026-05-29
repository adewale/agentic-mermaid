# Code Mode (preferred channel)

`agentic-mermaid-mcp` exposes a primary Code Mode tool, `execute(code)`, plus
narrow `render_png` and `describe` helpers. The server runs your async-arrow
body in a `node:vm` sandbox with `mermaid.*` as a global. The whole
verify-after-mutate loop is one round-trip.

## SDK

```ts
mermaid.parseMermaid(source): Result<ValidDiagram, ParseError[]>
mermaid.asFlowchart(d): FlowchartValidDiagram | null
mermaid.asSequence(d):  SequenceValidDiagram | null
mermaid.mutate(flow, FlowchartMutationOp): Result<FlowchartValidDiagram, MutationError>
mermaid.mutate(seq,  SequenceMutationOp):  Result<SequenceValidDiagram, MutationError>
mermaid.verifyMermaid(input, { suppress?, labelCharCap? }): VerifyResult
mermaid.serializeMermaid(d): string
mermaid.renderMermaidSVG(input): string
mermaid.renderMermaidASCII(input): string
```

All synchronous and pure. Layout is deterministic; there is no seed.

## Flowchart pattern

```ts
async () => {
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
}
```

## Sequence pattern

```ts
async () => {
  const r0 = mermaid.parseMermaid('sequenceDiagram\n  Alice->>Bob: Hi')
  if (!r0.ok) return { errors: r0.error }
  const seq = mermaid.asSequence(r0.value)
  if (!seq) return { kind: r0.value.kind, note: 'opaque — edit canonicalSource' }
  const r1 = mermaid.mutate(seq, { kind: 'add_message', from: 'Bob', to: 'Alice', text: 'Hello', style: 'reply' })
  if (!r1.ok) return { error: r1.error }
  return { source: mermaid.serializeMermaid(r1.value) }
}
```

## Cross-family refactor

```ts
async () => sources.map(src => {
  const r = mermaid.parseMermaid(src)
  if (!r.ok) return { err: r.error }
  const flow = mermaid.asFlowchart(r.value)
  if (flow) {
    const renamed = mermaid.mutate(flow, { kind: 'rename_node', from: 'A', to: 'B' })
    return renamed.ok ? { source: mermaid.serializeMermaid(renamed.value) } : { err: renamed.error }
  }
  return { source: src.replace(/\bA\b/g, 'B'), viaString: true, family: r.value.kind }
})
```

Conventions: return the final value; never `await` SDK methods (synchronous);
narrow before mutate; for opaque bodies edit `canonicalSource` as a string.
