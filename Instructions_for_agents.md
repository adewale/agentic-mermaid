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

Use `asFlowchart` / `asState` / `asSequence` / `asTimeline` / `asClass` / `asEr` / `asJourney` / `asArchitecture` / `asXyChart` / `asPie` / `asQuadrant` / `asGantt` before mutating existing diagrams. State diagrams own a dedicated body: `asState` narrows them and state-shaped ops (`add_state`, `add_transition`, `make_composite`, …) apply; `asFlowchart` returns null on a state diagram. Sequence diagrams are segment-preserving: one with `Note`/`alt`/`loop`/`par`/`activate`/`autonumber`/`title` still narrows via `asSequence` and keeps its participant/message ops while those unmodeled lines ride along verbatim; `remove_message`/`set_message_text` indexes address only top-level messages (messages inside an `alt`/`loop` block are not touched); only an un-segmentable sequence (e.g. an unbalanced `end`) falls back to opaque. Gantt charts are segment-preserving too: title/section/task ops stay live while calendar directives (`dateFormat`, `excludes`, …), `click` lines, and comments ride along verbatim; gantt rendering never reads the wall clock — pass `ganttToday` to draw the today marker. In Code Mode, SDK-returned diagrams are read-only; structured edits must go through `mermaid.mutate`. Opaque-fallback bodies (any unmodeled syntax) round-trip losslessly as source-level bodies but do not expose structured mutation; return an unsupported-family result unless the task explicitly asks for source-level editing, then re-parse and verify before returning.

## The verify-before-commit rule

Run `verifyMermaid` at every commit point — anywhere the result would be saved, sent, or shown. For new diagrams, verify the authored source. For existing diagrams, verify after mutation and before serializing. You may batch several `mutate` calls between verifications, but never serialize a `ValidDiagram` whose `verify` result you have not inspected. `verify.ok` is structural, not a visual-quality score; inspect `verify.layout`, render artifacts, or PNG/SVG screenshots for visual tasks.

## Tier 1 vs Tier 2 vs Tier 3 warnings

Tier 1 (structural, reliable, universal): `EMPTY_DIAGRAM`, `EDGE_MISANCHORED`, `OFF_CANVAS`, `GROUP_BREACH`, `UNKNOWN_SHAPE`, `LABEL_OVERFLOW` (source-based char-count check, default 40), `UNRESOLVABLE_SCHEDULE` (gantt: parses but the schedule cannot resolve — render would fail; `reason` names the `GANTT_*` error). Applies to every family. Never suppress Tier 1 errors.

Tier 2 (geometric, advisory, flowchart-specific): `NODE_OVERLAP`, `ROUTE_SELF_CROSS`, plus the route-contract tripwires `ROUTE_HITCH`, `ROUTE_UNEXPLAINED_BEND`, `ROUTE_LABEL_ON_SHARED_TRUNK`, `ROUTE_CONTAINER_MISANCHOR`, `ROUTE_SHAPE_MISANCHOR`, `ROUTE_STALE_AFTER_NODE_MOVE` (docs/design/route-contracts.md — the layout pipeline upholds these itself, so they fire only on pipeline regressions). Only fire for flowchart/state. For other families, geometric concerns surface via perceptual metrics (`measureQuality(layoutMermaid(d))`). See `docs/quality.md`. Don't gate CI on Tier 2 alone.

Tier 3 (lint, advisory): `DUPLICATE_EDGE`, `UNREACHABLE_NODE`, `DECISION_BRANCH_UNLABELED`, `COMMENT_DROPPED`, `UNSUPPORTED_SYNTAX`. These catch common agent mistakes or source-preserved Mermaid syntax that still parse/render but are probably not fully modeled. They never flip `verify.ok`; inspect and fix when the task asks for clean maintainable diagrams. `DECISION_BRANCH_UNLABELED` means a multi-exit decision diamond has an unlabeled branch. `COMMENT_DROPPED` means in-body `%%` comments will not survive structured serialization; the leading wrapper (frontmatter, `%%{init}%%` directives, comments before the header) always round-trips byte-verbatim. `UNSUPPORTED_SYNTAX` means a Mermaid construct (for example flowchart edge IDs, edge metadata, click/href, or markdown strings) is preserved losslessly as source but is not fully modeled by local structured mutation/render semantics.

## CLI verbs

`am capabilities --json` — JSON envelope listing families, `families[].editPolicy`, `families[].mutationOps`, warning codes, output formats (`svg`, `ascii`, `unicode`, `png`, `json`). Schema-stable; use it to self-discover.
`am batch --jsonl` — JSONL stdin → JSONL stdout for render/verify/parse/serialize/mutate. Malformed lines surface error but don't abort the stream.
`am render <file…> --format svg|ascii|unicode|json [--security strict]` — JSON = layout shape; --security strict = no external-fetch refs; multiple files → results array for non-PNG formats. `--watch` is single-file/non-PNG only. PNG uses `--format png --output file.png` for one input and does not support watch/multi-input.
`am preview <file|-> [--output out.html] [--open] [--json] [--security strict]` — standalone strict-mode HTML preview for human inspection.
`am mutate <file|-> (--op '<JSON>'|--ops '<JSON array|file>') [--json]` — apply mutation(s), run verify, emit source only if verify succeeds. JSON success includes `{ok,source,verify}`; verify failure exits 3 and omits source.
`am describe <file|-> [--format text|json]` — prose summary or structured AX tree (`{nodes,edges,entryPoints,sinks}`, #7349). Library: `describeMermaid(d, {format})`.
`am llms-txt` — agent-discovery digest (llms.txt convention).
`am init-agent [--dir .] [--force]` — writes a non-clobbering AGENTS.md section, root skills/ bundle, and .mcp.json sample into a consumer repo.
`am render-markdown <file.md> [--ascii]` — render each Mermaid fenced block; skips invalid diagrams, never aborts the file. JSON: `{blocks:[{index,ok,output|error}]}`.
Exit codes: `0` ok, `2` arg/parse/mutation error, `3` verify-failed, `4` internal. Parse and verify-failure errors carry `error.details` arrays, not stringified blobs.

Library extras: `renderMermaidPNG(src,{fitTo,background})` returns PNG bytes; `renderMermaidASCIIWithMeta(src)` → `{ascii,regions,warnings,routeParity}` for TUI click-mapping; `analyzeMermaid(d)` / `analyzeMermaidSource(source)` returns non-rendering feedback/action/Gantt facts; `asciiToMermaid(ascii)` reverses flowchart ASCII (best-effort, lossy); `verifyNoExternalRefs(svg)` asserts no external fetch; `renderMermaidSVG(src,{idPrefix})` namespaces def ids for multi-diagram pages. See SECURITY.md.

## Anti-patterns

- Regenerating an existing parsed diagram instead of mutating it. Defeats round-trip; produces noise.
- Verifying only after a long risky edit chain. Loses precision about which op broke it.
- Serializing before reading `verify.ok` / `verify.warnings` / `verify.layout`.
- Concatenating source to edit an existing structured diagram when a typed `mutate` op exists. Direct source authoring is fine for new diagrams.
- Calling `mutate` on an opaque-fallback body; the structured-family narrower returns null for unmodeled syntax, so edit its preserved source instead.
