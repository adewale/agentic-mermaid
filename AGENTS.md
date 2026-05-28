# agentic-mermaid — agent-use guide

This is the canonical agent-use guide. The same content is emitted by `am --agent-instructions`. A doc-sync test asserts the two are byte-identical.

## Quick start

The code below runs unchanged whether you import the library, call it inside Code Mode `execute()` (as an async arrow returning the final value), or compose its CLI equivalents. Prefer Code Mode or library import for multi-step edits; reach for the CLI for one-shot operations.

```ts
import { parseMermaid, asFlowchart, mutate, verifyMermaid, serializeMermaid } from 'agentic-mermaid'

const d0 = parseMermaid(source)
if (!d0.ok) throw new Error('parse')
const flow = asFlowchart(d0.value)
if (!flow) throw new Error('mutate requires flowchart or state')

const d1 = mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
if (!d1.ok) throw new Error('mutate')
const d2 = mutate(d1.value, { kind: 'add_edge', from: 'API', to: 'Cache' })
if (!d2.ok) throw new Error('mutate')

const result = verifyMermaid(d2.value)
if (!result.ok) {
  // result.warnings is structured; back up to d1.value and try a different op
}

const out = serializeMermaid(d2.value)
```

## The verify-after-mutate rule

Run `verifyMermaid` at every commit point — anywhere the result would be saved, sent, or shown. You may batch several `mutate` calls between verifications, but never serialize a `ValidDiagram` whose `verify` result you have not inspected.

## Tier 1 vs Tier 2 warnings

Tier 1 (structural) warnings are reliable: `EMPTY_DIAGRAM`, `EDGE_MISANCHORED`, `OFF_CANVAS`, `GROUP_BREACH`, `UNKNOWN_SHAPE`. Never suppress them.

Tier 2 (metric) warnings are best-effort: `LABEL_OVERFLOW`, `NODE_OVERLAP`, `ROUTE_SELF_CROSS`. Suppress when overlap or unrecognized shape is intentional. Do not gate CI on Tier 2 alone.

## Anti-patterns

- Regenerating source instead of mutating. Defeats round-trip; produces noise.
- Verifying once at the end of a long chain. Loses precision about which op broke it.
- Concatenating Mermaid source strings. Use `mutate` and `serializeMermaid`.
- Calling `mutate` on a sequence / class / ER / etc. diagram — the type system rejects this; use `asFlowchart` first and handle the null case.
