// ============================================================================
// agent-instructions: the canonical doc embedded in the `am` binary at
// build time. `am --agent-instructions` prints this string. A doc-sync test
// asserts it equals the Agent workflow section of AGENT_NATIVE.md.
// ============================================================================

export const AGENT_INSTRUCTIONS = `# agentic-mermaid — agent-use guide

This is the canonical agent-use guide. The same content lives in AGENTS.md.

## Quick start

The code below runs unchanged whether you import the library, call it inside Code Mode \`execute()\` (as an async arrow returning the final value), or compose its CLI equivalents. Prefer Code Mode or library import for multi-step edits; reach for the CLI for one-shot operations.

\`\`\`ts
import { parseMermaid, mutate, verifyMermaid, serializeMermaid } from 'agentic-mermaid'

const d0 = parseMermaid(source)
if (!d0.ok) throw new Error('parse')
const d1 = mutate(d0.value, { kind: 'add_node', id: 'Cache', label: 'Cache' })
if (!d1.ok) throw new Error('mutate')
const d2 = mutate(d1.value, { kind: 'add_edge', from: 'API', to: 'Cache' })
if (!d2.ok) throw new Error('mutate')

const result = verifyMermaid(d2.value)
if (!result.ok) {
  // result.warnings is structured; back up to d1.value and try a different op
}

const out = serializeMermaid(d2.value)
\`\`\`

## The verify-after-mutate rule

Run \`verifyMermaid\` at every commit point — anywhere the result would be saved, sent, or shown. You may batch several \`mutate\` calls between verifications, but never serialize a \`ValidDiagram\` whose \`verify\` result you have not inspected.

## Expected warnings

Suppress \`UNKNOWN_SHAPE\`, \`NODE_OVERLAP\`, or \`ROUTE_SELF_CROSS\` when intentional. Never suppress \`LABEL_OVERFLOW\`, \`OFF_CANVAS\`, \`EDGE_MISANCHORED\`, \`GROUP_BREACH\`, or \`EMPTY_DIAGRAM\` — these indicate rendering bugs or malformed input.

## Anti-patterns

- Regenerating source instead of mutating. Defeats round-trip; produces noise.
- Verifying once at the end of a long chain. Loses precision about which op broke it.
- Concatenating Mermaid source strings. Use \`mutate\` and \`serializeMermaid\`.
`
