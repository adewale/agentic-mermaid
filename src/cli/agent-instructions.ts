export const AGENT_INSTRUCTIONS = `# agentic-mermaid — agent-use guide

This is the canonical agent-use guide. The same content lives in AGENTS.md.

## Quick start

The code below runs unchanged whether you import the library, call it inside Code Mode \`execute()\` (as an async arrow returning the final value), or compose its CLI equivalents. Prefer Code Mode or library import for multi-step edits; reach for the CLI for one-shot operations.

\`\`\`ts
import { parseMermaid, asFlowchart, asSequence, asTimeline, asClass, asEr, mutate, verifyMermaid, serializeMermaid } from 'beautiful-mermaid/agent'

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

// asClass / asEr / asTimeline narrow to their typed bodies similarly.

// journey / xychart / architecture, plus any opaque-fallback body
// (e.g., a sequence diagram with notes/alt/loop/activate): edit
// d0.value.canonicalSource as a string. The library never silently
// drops constructs it does not model.
\`\`\`

## The verify-after-mutate rule

Run \`verifyMermaid\` at every commit point — anywhere the result would be saved, sent, or shown. You may batch several \`mutate\` calls between verifications, but never serialize a \`ValidDiagram\` whose \`verify\` result you have not inspected.

## Tier 1 vs Tier 2 vs Tier 3 warnings

Tier 1 (structural, reliable, universal): \`EMPTY_DIAGRAM\`, \`EDGE_MISANCHORED\`, \`OFF_CANVAS\`, \`GROUP_BREACH\`, \`UNKNOWN_SHAPE\`, \`LABEL_OVERFLOW\` (source-based char-count check, default 40). Applies to every family. Never suppress Tier 1 errors.

Tier 2 (geometric, advisory, flowchart-specific): \`NODE_OVERLAP\`, \`ROUTE_SELF_CROSS\`. Only fire for flowchart/state. For other families, geometric concerns surface via perceptual metrics (\`measureQuality(layoutMermaid(d))\`). See \`QUALITY.md\`. Don't gate CI on Tier 2 alone.

Tier 3 (lint, advisory, opt-in): produced by \`FamilyPlugin.verify\` hooks. Default \`verifyMermaid\` does not run Tier 3. No built-in family ships Tier 3 rules yet — registry is wired, catalogue is empty.

## CLI verbs

\`am capabilities --json\` — JSON envelope listing families, mutation ops, warning codes, output formats (\`svg\`, \`ascii\`, \`png\`). Schema-stable; use it to self-discover.
\`am batch --jsonl\` — JSONL stdin → JSONL stdout. Malformed lines surface error but don't abort the stream.
\`am render <file…> --format svg|ascii|unicode|png|json [--output f] [--security strict] [--watch]\` — PNG via resvg+DejaVu (deterministic x86_64); JSON = layout shape; --security strict = no external-fetch refs; --output required for PNG; multiple files → results array; --watch re-renders on change.
\`am describe <file> [--format text|json]\` — prose summary or structured AX tree (\`{nodes,edges,entryPoints,sinks}\`, #7349). Library: \`describeMermaid(d, {format})\`.
\`am llms-txt\` — agent-discovery digest (llms.txt convention).
\`am render-markdown <file.md> [--ascii]\` — render each \`\`\`mermaid fenced block; skips invalid diagrams, never aborts the file. JSON: \`{blocks:[{index,ok,output|error}]}\`.
Exit codes: \`0\` ok, \`2\` arg error, \`3\` verify-failed, \`4\` internal. Errors carry \`error.details\` (structured ParseError[]), not a stringified blob.

Library extras: \`renderMermaidASCIIWithMeta(src)\` → \`{ascii,regions}\` for TUI click-mapping; \`asciiToMermaid(ascii)\` reverses flowchart ASCII (best-effort, lossy); \`verifyNoExternalRefs(svg)\` asserts no external fetch; \`renderMermaidSVG(src,{idPrefix})\` namespaces def ids for multi-diagram pages. See SECURITY.md.

## Anti-patterns

- Regenerating source instead of mutating. Defeats round-trip; produces noise.
- Verifying once at the end of a long chain. Loses precision about which op broke it.
- Concatenating Mermaid source strings. Use \`mutate\` and \`serializeMermaid\`.
- Calling \`mutate\` on a journey / xychart / architecture diagram (or any opaque-fallback body) — the type system rejects it; edit \`canonicalSource\` directly.
`
