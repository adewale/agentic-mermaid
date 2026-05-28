# agentic-mermaid — agent-use guide

This is the canonical agent-use guide. The same content is emitted by `am --agent-instructions`. A doc-sync test asserts the two are byte-identical.

## Quick start

The code below runs unchanged whether you import the library, call it inside Code Mode `execute()` (as an async arrow returning the final value), or compose its CLI equivalents. Prefer Code Mode or library import for multi-step edits; reach for the CLI for one-shot operations.

```ts
import { parseMermaid, asFlowchart, asSequence, mutate, verifyMermaid, serializeMermaid } from 'beautiful-mermaid/agent'

const d0 = parseMermaid(source)
if (!d0.ok) throw new Error('parse')

const flow = asFlowchart(d0.value)
if (flow) {
  const d1 = mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
  if (!d1.ok) throw new Error('mutate')
  if (verifyMermaid(d1.value).ok) return serializeMermaid(d1.value)
}

const seq = asSequence(d0.value)
if (seq) {
  const d1 = mutate(seq, { kind: 'add_message', from: 'Alice', to: 'Bob', text: 'Hi' })
  if (!d1.ok) throw new Error('mutate')
  return serializeMermaid(d1.value)
}

// class / ER / timeline / journey / xychart / architecture, plus any
// sequence diagram with notes/alt/loop/activate (which falls back to opaque):
// edit d0.value.canonicalSource as a string. The library never silently
// drops constructs it does not model.
```

## The verify-after-mutate rule

Run `verifyMermaid` at every commit point — anywhere the result would be saved, sent, or shown. You may batch several `mutate` calls between verifications, but never serialize a `ValidDiagram` whose `verify` result you have not inspected.

## Tier 1 vs Tier 2 warnings

Tier 1 (structural, reliable): `EMPTY_DIAGRAM`, `EDGE_MISANCHORED`, `OFF_CANVAS`, `GROUP_BREACH`, `UNKNOWN_SHAPE`, `LABEL_OVERFLOW` (a source-based character-count check, default 40). Never suppress Tier 1 errors.

Tier 2 (geometric, advisory): `NODE_OVERLAP`, `ROUTE_SELF_CROSS`. These correctly detect what they name; the occurrence may be intentional. Suppress when so. Do not gate CI on Tier 2 alone.

## Anti-patterns

- Regenerating source instead of mutating. Defeats round-trip; produces noise.
- Verifying once at the end of a long chain. Loses precision about which op broke it.
- Concatenating Mermaid source strings. Use `mutate` and `serializeMermaid`.
- Calling `mutate` on a non-flowchart, non-sequence diagram — the type system rejects it; edit `canonicalSource` directly.
