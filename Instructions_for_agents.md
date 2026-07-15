# Agentic Mermaid — agent-use guide

This is the canonical agent-use guide. The same content is emitted by `am --agent-instructions`. A doc-sync test asserts the two are byte-identical.

## When to use Agentic Mermaid

Use Agentic Mermaid when an agent needs to create, edit, verify, describe, or render Mermaid diagrams through deterministic library, CLI, or MCP calls. It is strongest when the workflow needs typed edits, semantic fact read-back, CI-safe verification, or reproducible SVG, PNG, ASCII, and Unicode output.

Do not use the hosted MCP for private diagrams; use the local library, CLI, or self-hosted MCP so source stays in your environment. Use another tool when the artifact is not Mermaid source or requires freeform canvas editing that Mermaid cannot express.

## Quick start

Choose the narrowest channel. New diagrams: build with `buildMermaid(kind, ops)` — or `createMermaid(kind)` then typed mutations — and verify/render the result; author Mermaid source directly only for syntax the typed ops do not model. Existing structured diagrams: parse → narrow → mutate → verify → serialize. Code Mode/library are best for multi-step edits; CLI is best for one-shot verify/render/preview. Code Mode exposes `mermaid.*`; library users import the same names from `agentic-mermaid/agent` — including `describeOps(family)` and `opSignatures(family)`, which return each op's exact fields, required-ness, inlined enum values, and constraint/default notes (e.g. journey score `integer 1..5`, flowchart shape `default: rectangle`) so you can look up an unfamiliar op instead of guessing; use `describeMermaidFacts` / `checkMermaid` when you need semantic read-back such as `edge Processing -> [*] : done`, `member Duck +quack()`, or `task Docs start after core`. A hosted MCP at `agentic-mermaid.dev/mcp` (stateless Streamable HTTP JSON-RPC) exposes `execute` (Code Mode), `describe_sdk` (one family's mutation schema on demand), `render_svg`, `render_ascii`, `render_png`, `verify`, `describe`, and the declarative `mutate` (edit a `source`) and `build` (author from a `family`) — which apply a JSON op list and return `{ok,family,source,verify}`, prescriptive `{ok:false,…,error}` on a bad op; prefer them for structured edits and reserve `execute` for logic the ops do not express — all with 64KB input caps; the call shape is a plain POST (stateless, no initialize handshake): `POST /mcp` with `content-type: application/json` and body `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"verify","arguments":{"source":"flowchart TD\n  A --> B"}}}`. Prefer the local library, CLI, or a self-hosted MCP and reach for the hosted endpoint only when you cannot install. Agentic Mermaid outputs ASCII, PNG, and SVG; Unicode text and JSON layout are also available. Flowchart authoring facts: quote any label carrying punctuation (`id["HTTPS /api/sessions*"]`); `\n` inside a quoted label is a line break and canonicalizes to `<br>` on serialize; `subgraph id["Title"] … end` groups nodes; labeled and dotted edges are `A -- "label" --> B`, `A -.-> B`, and `A -. "label" .-> B`. For every other family, read that family's exact header, edge, and relationship syntax from its `example` in `am capabilities --json` (`capabilities.json` `families[].example`) rather than assuming flowchart syntax — e.g. class inheritance `Base <|-- Derived`, ER cardinality `A ||--o{ B : label`, architecture edges `api:R --> L:db`.

```ts
const source = 'flowchart TD\n  API --> DB'
const d0 = mermaid.parseRegisteredMermaid(source)
if (!d0.ok) throw new Error('parse')

const flow = mermaid.asFlowchart(d0.value)
if (!flow) return { phase: 'narrow', family: d0.value.kind }

const d1 = mermaid.mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
if (!d1.ok) throw new Error('mutate')

const verify = mermaid.verifyMermaid(d1.value)
if (!verify.ok) return { phase: 'verify', warnings: verify.warnings }

return { source: mermaid.serializeMermaid(d1.value) }
```

Blank-slate authoring stays on the typed path — no hand-written source:

```ts
const built = mermaid.buildMermaid('flowchart', [
  { kind: 'add_node', id: 'API', label: 'API' },
  { kind: 'add_node', id: 'DB', label: 'DB' },
  { kind: 'add_edge', from: 'API', to: 'DB' },
], { direction: 'LR' })
if (!built.ok) return { phase: 'build', error: built.error }

const check = mermaid.verifyMermaid(built.value)
if (!check.ok) return { phase: 'verify', warnings: check.warnings }

return { source: mermaid.serializeMermaid(built.value) }
```

Before mutating an existing diagram, use the matching narrower advertised by `am capabilities --json` or `describe_sdk` (for example, `asFlowchart` or `asState`). State diagrams own a dedicated body: `asState` narrows them — including concurrency regions, notes, `<<fork>>`/`<<join>>`/`<<choice>>`, history pseudostates, and class/inline paint — and state-shaped ops (`add_state`, `add_transition`, `make_composite`, `add_note`, `set_state_class`, …) apply; `asFlowchart` returns null on a state diagram. Sequence diagrams are segment-preserving: `alt`/`opt`/`loop`/`par` fragments are typed, their messages appear in describe/facts/verify, and fragment/branch/message mutation ops can author and edit them. Other constructs such as `Note`/`box`/`critical`/`activate`/`autonumber`/`title` ride along verbatim; top-level `remove_message`/`set_message_text` indexes remain separate from fragment messages. Only an un-segmentable sequence (e.g. an unbalanced `end`) falls back to opaque. Gantt charts are segment-preserving too: title/section/task ops stay live while calendar directives (`dateFormat`, `excludes`, …), `click` lines, and comments ride along verbatim; gantt rendering never reads the wall clock — pass `ganttToday` to draw the today marker — and the opt-in `gantt.dependencyArrows`/`gantt.criticalPath` render options overlay dependency arrows and critical-path emphasis without any new Mermaid syntax. In Code Mode, SDK-returned diagrams are read-only; structured edits must go through `mermaid.mutate`. Opaque-fallback bodies (any unmodeled syntax) round-trip losslessly as source-level bodies but do not expose structured mutation; return an unsupported-family result unless the task explicitly asks for source-level editing, then re-parse and verify before returning.

## The verify-before-commit rule

Run `verifyMermaid` at every commit point — anywhere the result would be saved, sent, or shown. For new diagrams, verify the authored source. For existing diagrams, verify after mutation and before serializing. You may batch several `mutate` calls between verifications, but never serialize a `ValidDiagram` whose `verify` result you have not inspected. `verify.ok` is structural, not a visual-quality or semantic-correctness score; for task-critical meaning, inspect `describeMermaidFacts(d)` or call `checkMermaid(d, requiredFacts)` before returning.

## Tier 1 vs Tier 2 vs Tier 3 warnings

Tier 1 (structural, reliable, universal): `EMPTY_DIAGRAM`, `EDGE_MISANCHORED`, `OFF_CANVAS`, `GROUP_BREACH`, `UNKNOWN_SHAPE`, `LABEL_OVERFLOW` (rendered-line char count over the longest displayed line — `<br>`/`\n` split lines, XML entities decode to one char, formatting tags strip; default cap 40, raise via `labelCharCap` / `am verify --label-cap N` when long labels are intentional instead of truncating the user's text), `UNRESOLVABLE_SCHEDULE` (gantt: parses but the schedule cannot resolve — render would fail; `reason` names the `GANTT_*` error), `RENDER_FAILED` (any family: the source verifies structurally but the strict render parser throws, so rendering would fail; `reason` carries the renderer error — a clean verify proves the diagram actually renders). Applies to every family. Never suppress Tier 1 errors.

Tier 2 (geometric, advisory, flowchart-specific): `NODE_OVERLAP`, `ROUTE_SELF_CROSS`, plus the route-contract tripwires `ROUTE_HITCH`, `ROUTE_UNEXPLAINED_BEND`, `ROUTE_LABEL_ON_SHARED_TRUNK`, `ROUTE_SELF_LOOP_OCCUPANCY`, `ROUTE_CONTAINER_MISANCHOR`, `ROUTE_SHAPE_MISANCHOR`, `ROUTE_STALE_AFTER_NODE_MOVE` (docs/design/system/route-contracts.md — the layout pipeline upholds these itself, so they fire only on pipeline regressions). Route tripwires fire for flowchart/state; class and ER additionally run boundary-anchor and overlap checks (`ROUTE_SHAPE_MISANCHOR`, `NODE_OVERLAP` on class/entity boxes). For other families, geometric concerns surface via perceptual metrics (`measureQuality(layoutMermaid(d))`). See `docs/quality.md`. Don't gate CI on Tier 2 alone.

Tier 3 (lint and inspect-only policy): `DUPLICATE_EDGE`, `UNREACHABLE_NODE`, `DECISION_BRANCH_UNLABELED`, `COMMENT_DROPPED`, `UNSUPPORTED_SYNTAX`, `CONTENT_DROPPED_ON_ROUNDTRIP`, `INEFFECTIVE_CONFIG`, `LOW_CONTRAST`, `BRAND_CONSTRAINT_WARNING`, `BRAND_CONSTRAINT_ERROR`. Advisory lint never flips `verify.ok`; a caller-authored Brand constraint with `action: "error"` emits `BRAND_CONSTRAINT_ERROR` and does. Brand constraints inspect final contrast, accent area, or monochrome role paint without repainting or relayout. `DECISION_BRANCH_UNLABELED` means a multi-exit decision diamond has an unlabeled branch. `COMMENT_DROPPED` means in-body `%%` comments will not survive structured serialization; the leading wrapper (frontmatter, `%%{init}%%` directives, comments before the header) always round-trips byte-verbatim. `UNSUPPORTED_SYNTAX` means either a Mermaid construct (for example flowchart edge IDs, edge metadata, click/href, or markdown strings) is preserved losslessly as source but is not fully modeled by local structured mutation/render semantics, or `syntax: "empty_layout"` means the source carries content but the local layout produced a 0x0 canvas with no nodes, edges, or groups. Inspect the warning message and `verify.layout` before accepting the artifact. `CONTENT_DROPPED_ON_ROUNDTRIP` means the structured node/edge/group tally changed across a parse → serialize → re-parse cycle — canonical serialization is silently dropping or duplicating content even though the bytes may re-parse; treat it as a faithfulness bug to report. `INEFFECTIVE_CONFIG` means a Mermaid config field was accepted for compatibility but has no effect on this family's output (the warning names the field). `LOW_CONTRAST` means a concrete authored paint remains authoritative but misses a measurable contrast threshold against the final resolved opaque background; the warning reports both colors, the measured ratio, and the minimum without repainting. Transparent output is not measured because its host backdrop is unknown.

## CLI verbs

`am capabilities --json` — JSON envelope listing families, `families[].editPolicy`, `families[].mutationOps`, warning codes, output formats (`svg`, `ascii`, `unicode`, `png`, `layout`). Schema-stable; use it to self-discover.
`am batch --jsonl` — JSONL stdin → JSONL stdout for render/verify/parse/serialize/mutate. Malformed lines surface error but don't abort the stream.
`am render <file…> --format svg|ascii|unicode|layout [--security strict] [--style <names|file.json>] [--seed N]` — layout emits the JSON layout shape; --security strict = no external-fetch refs; `--style` takes a stack (comma-separated names and/or .json spec files, merged left → right, e.g. `--style hand-drawn,dracula`) and applies to graphical and terminal projection; `--seed` re-rolls styled ink. Multiple files → results array for non-PNG formats. `--watch` is single-file/non-PNG only. PNG uses `--format png --output file.png` for one input and does not support watch/multi-input.
`am preview <file|-> [--output out.html] [--open] [--json] [--security strict]` — standalone strict-mode HTML preview for human inspection.
`am mutate <file|-> (--op '<JSON>'|--ops '<JSON array|file>') [--json]` — apply mutation(s), run verify, emit source only if verify succeeds. JSON success includes `{ok,source,verify}`; verify failure exits 3 and omits source.
`am verify <file|-> [--json] [--label-cap N] [--suppress CODES] [--style <names|file.json>]` — full tiered verify; `--style` evaluates inspect-only Brand constraints against the same styled Scene used by render; exit 3 only on error-severity findings. `am parse` (ValidDiagram JSON), `am serialize` (ValidDiagram JSON on stdin → canonical source), and `am format` (idempotent reformat) round out the loop.
`am describe <file|-> [--format text|json|facts]` — prose summary, structured AX tree (`{nodes,edges,entryPoints,sinks}`, #7349), or semantic fact lines. Library: `describeMermaid(d, {format})`, `describeMermaidFacts(d)`, `checkMermaid(d, facts)`.
`am styles [--json]` — list registered styles: the default, full looks, and palette-only themes, with backends and blurbs.
`am llms-txt` — agent-discovery digest (llms.txt convention).
`am init-agent [--dir .] [--force]` — writes a non-clobbering AGENTS.md section, root skills/ bundle, and .mcp.json sample into a consumer repo.
`am render-markdown <file.md> [--ascii]` — render each Mermaid fenced block; skips invalid diagrams, never aborts the file. JSON: `{blocks:[{index,ok,output|error}]}`.
Exit codes: `0` ok, `2` arg/parse/mutation error, `3` verify-failed, `4` internal. Parse and verify-failure errors carry `error.details` arrays, not stringified blobs.

Library extras: `renderMermaidPNG(src,{fitTo,background,style,seed,fontDirs})` returns PNG bytes; `renderMermaidASCIIWithMeta(src)` → `{ascii,regions,actions,warnings,routeParity}` for TUI click-mapping; `describeMermaidFacts(d)` / `checkMermaid(d, facts)` expose deterministic semantic facts; `analyzeMermaid(d)` / `analyzeMermaidSource(source)` returns non-rendering feedback/action/Gantt analysis; `asciiToMermaid(ascii)` reverses flowchart ASCII (best-effort, lossy); `verifyNoExternalRefs(svg)` asserts no external fetch; `renderMermaidSVG(src,{idPrefix})` namespaces def ids for multi-diagram pages. See SECURITY.md.

## Styles

Every library render call accepts `style`: a registered Look or Palette discovered through `am styles --json`, an inline spec (a plain JSON record of palette/font/stroke/fill/backdrop fields, all optional), or a stack merged left → right (`{ style: ['hand-drawn', 'dracula'] }`). `seed` re-rolls the ink wobble of styled looks and never moves layout, so `(source, style, seed)` reproduces an image exactly. Custom styles are data, not code: check untrusted records with `validateStyleSpec(json)` (returns problems; `[]` = usable) and register reusable ones with a canonical identity such as `registerStyle({ name: 'look:acme', ... })` — importable from `agentic-mermaid` and `agentic-mermaid/agent`. `style: 'crisp'` (or unset) selects the canonical default renderer. Styles apply uniformly to built-in families and to extensions that advertise native Scene/style support. The authoring guide and quality rubric live in docs/style-authoring.md. SVG declares any font; PNG bundles the faces the built-in looks use and uses Inter with DejaVu per-glyph fallback for unbundled families (supply extras via `fontDirs`).

## Anti-patterns

- Regenerating an existing parsed diagram instead of mutating it. Defeats round-trip; produces noise.
- Verifying only after a long risky edit chain. Loses precision about which op broke it.
- Serializing before reading `verify.ok` / `verify.warnings` / `verify.layout`.
- Concatenating source to edit an existing structured diagram when a typed `mutate` op exists. For new diagrams prefer `buildMermaid`/`createMermaid`; direct source authoring is fine for unmodeled syntax.
- Calling `mutate` on an opaque-fallback body; the structured-family narrower returns null for unmodeled syntax, so edit its preserved source instead.
