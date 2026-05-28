# Code Mode (preferred channel)

When the `agentic-mermaid-mcp` server is connected, call its single `execute` tool with a TypeScript snippet. The model writes an async-arrow body; the server runs it in a sandboxed `node:vm` context with the `mermaid.*` SDK exposed as a global.

This is the cheapest channel for multi-step edits. The whole verify-after-mutate loop happens in one round-trip.

## The SDK

The typed declaration the model sees:

```ts
declare const mermaid: {
  parseMermaid(source: string): Result<ValidDiagram, ParseError[]>
  mutate(d: ValidDiagram, op: MutationOp): Result<ValidDiagram, MutationError>
  verifyMermaid(input: ValidDiagram | string, opts?: { suppress?: WarningCode[] }): VerifyResult
  serializeMermaid(d: ValidDiagram): string
  renderMermaidSVG(input: ValidDiagram | string): string
  renderMermaidASCII(input: ValidDiagram | string): string
}
```

All calls are synchronous and pure. Compose chains freely; the model only round-trips with the MCP server once per `execute`.

## The canonical pattern

```ts
async () => {
  const r0 = mermaid.parseMermaid(source)
  if (!r0.ok) return { phase: 'parse', errors: r0.error }
  let cur = r0.value

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
  let cur = mermaid.parseMermaid(source)
  if (!cur.ok) return { error: cur.error }
  let d = cur.value
  for (let attempt = 0; attempt < 3; attempt++) {
    const v = mermaid.verifyMermaid(d)
    if (v.ok) return { source: mermaid.serializeMermaid(d), attempts: attempt }
    // Try to fix the first fixable warning
    const overflow = v.warnings.find(w => w.code === 'LABEL_OVERFLOW')
    if (overflow && 'target' in overflow) {
      const next = mermaid.mutate(d, {
        kind: 'set_label',
        target: overflow.target as string,
        // shorten labels by inserting <br/> at midpoint
        label: shortenLabel(/* ... */),
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

Loading a list of source strings and applying the same rename across all of them is one `execute` call. The agent supplies the algorithm; the SDK supplies the primitives.

```ts
async () => {
  const results = []
  for (const src of sources) {
    const r = mermaid.parseMermaid(src)
    if (!r.ok) { results.push({ err: r.error }); continue }
    const renamed = mermaid.mutate(r.value, { kind: 'rename_node', from: 'AuthService', to: 'IdentityService' })
    if (!renamed.ok) { results.push({ err: renamed.error }); continue }
    const v = mermaid.verifyMermaid(renamed.value)
    results.push({
      source: mermaid.serializeMermaid(renamed.value),
      warnings: v.warnings,
    })
  }
  return results
}
```

## Conventions

- Return the final value from the arrow. Use `console.log` only for supplementary debug output.
- Never `await` the SDK methods — they're synchronous.
- If you need composition that the SDK doesn't ship (e.g., `@include`, splice, templating), implement it in your `execute` body. The SDK is intentionally small.
