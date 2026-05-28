# Code Mode (preferred channel)

When the `agentic-mermaid-mcp` server is connected, call its single `execute` tool with TypeScript. The model writes an async-arrow body; the server runs it in a sandboxed `node:vm` context with the `mermaid.*` SDK exposed as a global.

This is the cheapest channel for multi-step edits. The whole verify-after-mutate loop happens in one round-trip.

## The SDK

```ts
declare const mermaid: {
  parseMermaid(source: string): Result<ValidDiagram, ParseError[]>
  asFlowchart(d: ValidDiagram): FlowchartValidDiagram | null
  mutate(d: FlowchartValidDiagram, op: MutationOp): Result<FlowchartValidDiagram, MutationError>
  verifyMermaid(input: ValidDiagram | string, opts?: { suppress?: WarningCode[] }): VerifyResult
  serializeMermaid(d: ValidDiagram): string
  renderMermaidSVG(input: ValidDiagram | string): string
  renderMermaidASCII(input: ValidDiagram | string): string
}
```

All calls are synchronous and pure.

## The canonical pattern

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

  return {
    source: mermaid.serializeMermaid(cur),
    ascii: mermaid.renderMermaidASCII(cur),
  }
}
```

## Auto-fix loop

```ts
async () => {
  let r = mermaid.parseMermaid(source)
  if (!r.ok) return { error: r.error }
  const flow = mermaid.asFlowchart(r.value)
  if (!flow) return { kind: r.value.kind, mutationsUnsupported: true }
  let d = flow

  for (let attempt = 0; attempt < 3; attempt++) {
    const v = mermaid.verifyMermaid(d)
    if (v.ok) return { source: mermaid.serializeMermaid(d), attempts: attempt }
    const fixable = v.warnings.find(w => w.code === 'UNKNOWN_SHAPE')
    if (fixable) {
      const next = mermaid.mutate(d, {
        kind: 'set_label',
        target: (fixable as any).node,
        label: '',
      })
      if (next.ok) d = next.value
    } else {
      return { unfixable: v.warnings }
    }
  }
  return { gaveUp: true }
}
```

## Multi-diagram cross-cuts

```ts
async () => {
  const results = []
  for (const src of sources) {
    const r = mermaid.parseMermaid(src)
    if (!r.ok) { results.push({ err: r.error }); continue }
    const flow = mermaid.asFlowchart(r.value)
    if (!flow) {
      // Non-flowchart family: edit the source string directly.
      const edited = src.replace(/AuthService/g, 'IdentityService')
      results.push({ source: edited, family: r.value.kind, viaString: true })
      continue
    }
    const renamed = mermaid.mutate(flow, { kind: 'rename_node', from: 'AuthService', to: 'IdentityService' })
    if (!renamed.ok) { results.push({ err: renamed.error }); continue }
    const v = mermaid.verifyMermaid(renamed.value)
    results.push({ source: mermaid.serializeMermaid(renamed.value), warnings: v.warnings })
  }
  return results
}
```

## Conventions

- Return the final value from the arrow. Use `console.log` only for supplementary debug output.
- Never `await` the SDK methods — they're synchronous.
- `mutate` only accepts `FlowchartValidDiagram`. For other families, edit `canonicalSource` directly.
- If you need composition (`@include`, splice, templating), implement it in your `execute` body. The SDK is intentionally small.
