# Features — capability inventory

What Agentic Mermaid can do, organized by capability area. The npm import paths are `agentic-mermaid` and `agentic-mermaid/agent`; implementation history lives in [`project/divergences.md`](./project/divergences.md); active backlog is only [`../TODO.md`](../TODO.md).

## Core IR & editing loop

- **Typed `ValidDiagram` IR** — parse Mermaid into a sealed, typed value.
- **`parseMermaid(source)`** → `Result<ValidDiagram, ParseError[]>`. Never
  throws on malformed input; structured errors.
- **`mutate(d, op)`** — family-overloaded typed mutation. Ops per family:
  flowchart (6), state (8), sequence (5), timeline (10), class (10), ER (7),
  journey (10), architecture (10), xychart (8), pie (7), quadrant (7), gantt (9).
- **`verifyMermaid(d, opts)`** — structural verification (no pixels).
- **`serializeMermaid(d)`** — back to canonical source.
- **Round-trip** — structured bodies serialize to canonical, idempotent
  source; opaque bodies preserve original indentation/comments verbatim.
- **Narrowers** — `asFlowchart`/`asState`/`asSequence`/`asTimeline`/`asClass`/`asEr`/
  `asJourney`/`asArchitecture`/`asXyChart`/`asPie`/`asQuadrant`/`asGantt`
  return `null` on a non-matching or source-level/opaque body (steers agents
  off the unsafe path).

## Diagram families (12)

| Family | Parse/render/round-trip | Structured mutation |
|---|---|---|
| Flowchart | ✅ | ✅ (6 ops) |
| State | ✅ | ✅ (8 ops via `asState`; `<<fork>>`/notes/`--`/`classDef` → opaque) |
| Sequence | ✅ | ✅ (5 ops; alt/loop/note ride along verbatim as segments) |
| Timeline | ✅ | ✅ (10 ops) |
| Class | ✅ | ✅ (10 ops) |
| ER | ✅ | ✅ (7 ops) |
| Journey | ✅ | ✅ (10 ops via `asJourney`) |
| XY chart | ✅ | ✅ (8 ops via `asXyChart`) |
| Architecture | ✅ | ✅ (10 ops via `asArchitecture`) |
| Pie | ✅ | ✅ (7 ops via `asPie`) |
| Quadrant | ✅ | ✅ (7 ops via `asQuadrant`) |
| Gantt | ✅ | ✅ (9 ops via `asGantt`; calendar directives/click/comments ride along verbatim as segments) |

**Structured-or-opaque rule:** every family either has a structured body
or preserves source verbatim. Constructs are never silently dropped.

## Output formats

Agentic Mermaid outputs **ASCII, PNG, and SVG** from the same renderer foundation, with Unicode text and JSON layout available for specialized workflows.

- **SVG** — `renderMermaidSVG` (`compact`, `security:'strict'`, CSS
  variable fonts, `idPrefix` namespacing). CLI exposes `--security strict`.
- **ASCII / Unicode** — `renderMermaidASCII` (CJK/emoji width, FE0F/ZWJ,
  `maxWidth` wrapping, trunk-shared fanouts).
- **PNG** — `renderMermaidPNG(source, { fitTo, background })` or `am render diagram.mmd --format png --output diagram.png` (offline `@resvg/resvg-js`, bundled DejaVu,
  cross-runtime deterministic on same-machine x86_64/ARM64 where Node + built `dist/` are present).
- **JSON layout** — `layoutMermaid` / `am render --format json`; add `--certificates` (or `layoutMermaid(d, { debug: true })`) to include opt-in graph route certificates plus accepted family certificates (class/ER/architecture/sequence/timeline/charts), V1 region/action sidecars, exact ports, and side/slot/role assignments where applicable.
- **ASCII with metadata** — `renderMermaidASCIIWithMeta` → `{ ascii, regions, warnings, routeParity }`
  for TUI click-mapping.
- **Reverse** — `asciiToMermaid` reconstructs flowchart source from ASCII
  (best-effort, lossy, structural round-trip).

## Verification tiers

- **Tier 1 (structural, universal):** EMPTY_DIAGRAM, EDGE_MISANCHORED,
  OFF_CANVAS, GROUP_BREACH, UNKNOWN_SHAPE, LABEL_OVERFLOW, UNRESOLVABLE_SCHEDULE.
- **Tier 2 (geometric, flowchart):** NODE_OVERLAP, ROUTE_SELF_CROSS, and the route-contract tripwires ROUTE_HITCH, ROUTE_UNEXPLAINED_BEND, ROUTE_LABEL_ON_SHARED_TRUNK, ROUTE_CONTAINER_MISANCHOR, ROUTE_SHAPE_MISANCHOR, ROUTE_STALE_AFTER_NODE_MOVE.
- **Tier 3 (lint, advisory):** DUPLICATE_EDGE, UNREACHABLE_NODE, DECISION_BRANCH_UNLABELED, COMMENT_DROPPED, UNSUPPORTED_SYNTAX, CONTENT_DROPPED_ON_ROUNDTRIP.
- **Perceptual quality** — `measureQuality` / `checkQuality` (edge
  crossings, label legibility, whitespace balance, …). See [`quality.md`](./quality.md).

## Accessibility

- `accTitle`→`<title>`, `accDescr`→`<desc>`, `role="img"`, `aria-labelledby`.
- **AX tree** — `describeMermaid(d, {format:'json'})` → `{nodes, edges,
  entryPoints, sinks}`; prose summary in `{format:'text'}`.
- Auto-contrast node text on custom fills (WCAG luminance).
- External CSS class emission (Mermaid `classDef` assignments → SVG classes).

## Security

- **Strict mode** (`security:'strict'`) — zero external-fetch references in
  the SVG (no Google Fonts `@import`).
- **`verifyNoExternalRefs(svg)`** — scanner / CI gate / agent self-check.
- No `<image>`/`<script>`/external-href injection; click directives
  sanitized. See [`../SECURITY.md`](../SECURITY.md).

## CLI (`am`)

`render` (svg/ascii/unicode/json with multi-input results; png uses one
input plus `--output`; `--security strict`, `--watch`), `render-markdown` (skip bad blocks),
`parse`, `verify`, `mutate` (`--op` or `--ops`), `preview` (strict standalone HTML + optional `--open`), `format`, `describe` (text/json),
`capabilities --json` (including `families[].editPolicy` + `families[].mutationOps`), `batch --jsonl` (including mutate),
`llms-txt`, `init-agent`, `--agent-instructions`. `mutate` verifies before emitting source; `init-agent` writes a non-clobbering `AGENTS.md` section, root `skills/` bundle, and `.mcp.json` sample into a consumer repo.
Exit codes 0/2/3/4; parse and verify-failure errors include structured `error.details` arrays.

## MCP server

Code Mode `execute(code)` (JavaScript in a `node:vm` sandbox with a typed
`mermaid.*` SDK declaration), plus narrow helper tools: `render_png` and
`describe`. The server supports stdio by default and HTTP/SSE via
`agentic-mermaid-mcp --transport http`; `render_png` can return base64 bytes or
managed file/URL artifacts with MIME type, byte count, and SHA-256 metadata.

## Distribution

- npm library (`agentic-mermaid` plus the `agentic-mermaid/agent` subpath) with Node-runnable bins (`am`, `agentic-mermaid`, `agentic-mermaid-mcp`).
- **Single binary** — `bun run build:binary` → `dist/am`, standalone
  executable, no runtime dependency (#1018).
- **llms.txt** agent-discovery digest, derived from capabilities.

## Guarantees & evidence

- **Determinism** — byte-identical across repeated runs and processes for
  SVG layout/ASCII; full-corpus ASCII repeated-run guard; cross-runtime guards
  exist for bun ≡ node on same-machine x86_64/ARM64 when Node + built `dist/`
  artifacts are present.
- **Corpus gates** — 271-entry mermaid-js docs corpus + 132-case
  MermaidSeqBench, gated in CI.
- **Benchmarks** — `eval/benchmark/RESULTS.md` (measured vs mmdc, termaid).
- **Agent-usage validation** — `eval/agent-usage/` scenarios,
  anti-pattern linter, sandbox trace instrumentation, and stored Code Mode eval runner.
- **Unit, browser/e2e, typecheck, build, binary-build, eval, and lint gates**
  are part of the verification contract.

## Not browser-dependent

The entire core (parse/verify/mutate/serialize/ASCII/PNG/SVG) runs with no
DOM, no headless browser, synchronously. This is the structural
differentiator vs Puppeteer-based Mermaid CLIs.
