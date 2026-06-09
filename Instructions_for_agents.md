# Agentic Mermaid — agent-use guide

This is the canonical agent-use guide. The same content is emitted by `am --agent-instructions`. A doc-sync test asserts the two are byte-identical.

## Quick start

Choose the narrowest channel. New diagrams: author Mermaid source directly, then parse/verify/render. Existing structured diagrams: parse → narrow → mutate → verify → serialize. Code Mode/library are best for multi-step edits; CLI is best for one-shot verify/render/preview. Code Mode exposes `mermaid.*`; library users import the same names from `agentic-mermaid/agent`. Agentic Mermaid outputs ASCII, PNG, and SVG; Unicode text and JSON layout are also available.

```ts
const source = 'flowchart TD\n  API --> DB'
const d0 = mermaid.parseMermaid(source)
if (!d0.ok) throw new Error('parse')

const flow = mermaid.asFlowchart(d0.value)
if (!flow) return { phase: 'narrow', family: d0.value.kind }

const d1 = mermaid.mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
if (!d1.ok) throw new Error('mutate')

const verify = mermaid.verifyMermaid(d1.value)
if (!verify.ok) return { phase: 'verify', warnings: verify.warnings }

return { source: mermaid.serializeMermaid(d1.value) }
```

Use `asFlowchart` / `asSequence` / `asTimeline` / `asClass` / `asEr` before mutating existing diagrams. In Code Mode, SDK-returned diagrams are read-only; structured edits must go through `mermaid.mutate`. Journey, xychart, architecture, and opaque-fallback bodies round-trip losslessly as source-level bodies, but do not expose structured mutation; return an unsupported-family result unless the task explicitly asks for source-level editing, then re-parse and verify before returning.

## The verify-before-commit rule

Run `verifyMermaid` at every commit point — anywhere the result would be saved, sent, or shown. For new diagrams, verify the authored source. For existing diagrams, verify after mutation and before serializing. You may batch several `mutate` calls between verifications, but never serialize a `ValidDiagram` whose `verify` result you have not inspected. `verify.ok` is structural, not a visual-quality score; inspect `verify.layout`, render artifacts, or PNG/SVG screenshots for visual tasks.

## Tier 1 vs Tier 2 vs Tier 3 warnings

Tier 1 (structural, reliable, universal): `EMPTY_DIAGRAM`, `EDGE_MISANCHORED`, `OFF_CANVAS`, `GROUP_BREACH`, `UNKNOWN_SHAPE`, `LABEL_OVERFLOW` (source-based char-count check, default 40). Applies to every family. Never suppress Tier 1 errors.

Tier 2 (geometric, advisory, flowchart-specific): `NODE_OVERLAP`, `ROUTE_SELF_CROSS`. Only fire for flowchart/state. For other families, geometric concerns surface via perceptual metrics (`measureQuality(layoutMermaid(d))`). See `QUALITY.md`. Don't gate CI on Tier 2 alone.

Tier 3 (lint, advisory): reserved for future family-specific lint codes. `FamilyPlugin.verify` hooks are wired today, but built-ins currently emit only Tier 1 structural warnings through that hook. No built-in lint catalogue exists yet.

## CLI verbs

`am capabilities --json` — JSON envelope listing families, `families[].editPolicy`, `families[].mutationOps`, warning codes, output formats (`svg`, `ascii`, `unicode`, `png`, `json`). Schema-stable; use it to self-discover.
`am batch --jsonl` — JSONL stdin → JSONL stdout for render/verify/parse/serialize/mutate. Malformed lines surface error but don't abort the stream.
`am render <file…> --format svg|ascii|unicode|json [--security strict]` — JSON = layout shape; --security strict = no external-fetch refs; multiple files → results array for non-PNG formats. `--watch` is single-file/non-PNG only. PNG uses `--format png --output file.png` for one input and does not support watch/multi-input.
`am preview <file|-> [--output out.html] [--open] [--json] [--security strict]` — standalone strict-mode HTML preview for human inspection.
`am mutate <file|-> (--op '<JSON>'|--ops '<JSON array|file>') [--json]` — apply mutation(s), run verify, emit source only if verify succeeds. JSON success includes `{ok,source,verify}`; verify failure exits 3 and omits source.
`am describe <file|-> [--format text|json]` — prose summary or structured AX tree (`{nodes,edges,entryPoints,sinks}`, #7349). Library: `describeMermaid(d, {format})`.
`am llms-txt` — agent-discovery digest (llms.txt convention).
`am render-markdown <file.md> [--ascii]` — render each Mermaid fenced block; skips invalid diagrams, never aborts the file. JSON: `{blocks:[{index,ok,output|error}]}`.
Exit codes: `0` ok, `2` arg/parse/mutation error, `3` verify-failed, `4` internal. Parse and verify-failure errors carry `error.details` arrays, not stringified blobs.

Library extras: `renderMermaidASCIIWithMeta(src)` → `{ascii,regions}` for TUI click-mapping; `asciiToMermaid(ascii)` reverses flowchart ASCII (best-effort, lossy); `verifyNoExternalRefs(svg)` asserts no external fetch; `renderMermaidSVG(src,{idPrefix})` namespaces def ids for multi-diagram pages. See SECURITY.md.

## Anti-patterns

- Regenerating an existing parsed diagram instead of mutating it. Defeats round-trip; produces noise.
- Verifying only after a long risky edit chain. Loses precision about which op broke it.
- Serializing before reading `verify.ok` / `verify.warnings` / `verify.layout`.
- Concatenating source to edit an existing structured diagram when a typed `mutate` op exists. Direct source authoring is fine for new diagrams.
- Calling `mutate` on journey / xychart / architecture / opaque bodies; no narrower exposes structured edits for those source-level bodies.
