// Runnable example: the agent verify-after-mutate loop.
//   bun run examples/agent-loop.ts
//
// Demonstrates parse → narrow → mutate (flowchart + sequence) → verify →
// serialize, plus the opaque fallback for constructs we don't structurally model.

import {
  parseMermaid, asFlowchart, asSequence, mutate, verifyMermaid, serializeMermaid,
} from '../src/agent/index.ts'

function line(s: string) { process.stdout.write(s + '\n') }

// 1. Flowchart: insert a Cache between API and DB.
{
  const d0 = parseMermaid('flowchart TD\n  API --> DB')
  if (!d0.ok) throw new Error('parse failed')
  const flow = asFlowchart(d0.value)!
  const a = mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
  if (!a.ok) throw new Error(a.error.message)
  const b = mutate(a.value, { kind: 'add_edge', from: 'API', to: 'Cache' })
  if (!b.ok) throw new Error(b.error.message)
  const c = mutate(b.value, { kind: 'add_edge', from: 'Cache', to: 'DB' })
  if (!c.ok) throw new Error(c.error.message)
  const v = verifyMermaid(c.value)
  if (!v.ok) throw new Error('verify failed')
  line('--- flowchart ---')
  line(`verify ok: ${v.ok}  warnings: ${v.warnings.length}`)
  line(serializeMermaid(c.value))
}

// 2. Sequence: add a reply.
{
  const d0 = parseMermaid('sequenceDiagram\n  Alice->>Bob: Hi')
  if (!d0.ok) throw new Error('parse failed')
  const seq = asSequence(d0.value)!
  const a = mutate(seq, { kind: 'add_message', from: 'Bob', to: 'Alice', text: 'Hello', style: 'reply' })
  if (!a.ok) throw new Error(a.error.message)
  const v = verifyMermaid(a.value)
  if (!v.ok) throw new Error('verify failed')
  line('--- sequence ---')
  line(`verify ok: ${v.ok}  warnings: ${v.warnings.length}`)
  line(serializeMermaid(a.value))
}

// 3. Opaque fallback: a sequence diagram with a Note isn't structurally
//    mutable, but it round-trips losslessly via preserved body.source.
{
  const d0 = parseMermaid('sequenceDiagram\n  Alice->>Bob: Hi\n  Note over Bob: thinking')
  if (!d0.ok) throw new Error('parse failed')
  line('--- opaque sequence (has a Note) ---')
  line(`asSequence is null (not mutable): ${asSequence(d0.value) === null}`)
  line(`round-trips losslessly: ${serializeMermaid(d0.value).includes('Note over Bob')}`)
}
