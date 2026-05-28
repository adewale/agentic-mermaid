# Code Mode (preferred channel)

When `agentic-mermaid-mcp` is connected, call its single `execute` tool with TypeScript. The server runs it in a sandboxed `node:vm` context with the `mermaid.*` SDK exposed as a global.

## SDK

```ts
declare const mermaid: {
  parseMermaid(source: string): Result<ValidDiagram, ParseError[]>
  asFlowchart(d: ValidDiagram): FlowchartValidDiagram | null
  asSequence(d: ValidDiagram):  SequenceValidDiagram | null
  // mutate is overloaded — flowchart and sequence have their own MutationOp unions
  mutate(d: FlowchartValidDiagram, op: FlowchartMutationOp): Result<FlowchartValidDiagram, MutationError>
  mutate(d: SequenceValidDiagram,  op: SequenceMutationOp):  Result<SequenceValidDiagram, MutationError>
  verifyMermaid(input: ValidDiagram | string, opts?: { suppress?: WarningCode[] }): VerifyResult
  serializeMermaid(d: ValidDiagram): string
  renderMermaidSVG(input: ValidDiagram | string): string
  renderMermaidASCII(input: ValidDiagram | string): string
}
```

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
  if (!r0.ok) return { phase: 'parse', errors: r0.error }
  const seq = mermaid.asSequence(r0.value)
  if (!seq) return { phase: 'narrow' }

  const r1 = mermaid.mutate(seq, { kind: 'add_message', from: 'Bob', to: 'Alice', text: 'Hello back', style: 'reply' })
  if (!r1.ok) return { phase: 'mutate', error: r1.error }
  const r2 = mermaid.mutate(r1.value, { kind: 'add_participant', id: 'Charlie', participantKind: 'actor' })
  if (!r2.ok) return { phase: 'mutate', error: r2.error }
  const r3 = mermaid.mutate(r2.value, { kind: 'add_message', from: 'Charlie', to: 'Alice', text: 'Hey' })
  if (!r3.ok) return { phase: 'mutate', error: r3.error }

  const v = mermaid.verifyMermaid(r3.value)
  return { ok: v.ok, source: mermaid.serializeMermaid(r3.value), warnings: v.warnings }
}
```

## Cross-family multi-diagram refactor

```ts
async () => {
  const results = []
  for (const src of sources) {
    const r = mermaid.parseMermaid(src)
    if (!r.ok) { results.push({ err: r.error }); continue }
    const flow = mermaid.asFlowchart(r.value)
    if (flow) {
      const renamed = mermaid.mutate(flow, { kind: 'rename_node', from: 'AuthService', to: 'IdentityService' })
      results.push(renamed.ok ? { source: mermaid.serializeMermaid(renamed.value) } : { err: renamed.error })
      continue
    }
    // Non-mutable family: string-edit canonicalSource.
    const edited = src.replace(/AuthService/g, 'IdentityService')
    results.push({ source: edited, family: r.value.kind, viaString: true })
  }
  return results
}
```

## Conventions

- Return the final value from the arrow. `console.log` for supplementary output only.
- Never `await` SDK methods — they're synchronous.
- `mutate` is overloaded. Narrow first via `asFlowchart` or `asSequence`.
- For 6 non-mutable families, edit `canonicalSource` as a string.
