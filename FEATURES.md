# Features — capability inventory

What Agentic Mermaid can do, organized by capability area. The npm import paths are `agentic-mermaid` and `agentic-mermaid/agent`; the per-loop implementation log is `DIVERGENCES.md`; active backlog is only `TODO.md`.

## Core IR & editing loop

- **Typed `ValidDiagram` IR** — parse Mermaid into a sealed, typed value.
- **`parseMermaid(source)`** → `Result<ValidDiagram, ParseError[]>`. Never
  throws on malformed input; structured errors.
- **`mutate(d, op)`** — family-overloaded typed mutation. Ops per family:
  flowchart/state (6), sequence (5), timeline (10), class (10), ER (7).
- **`verifyMermaid(d, opts)`** — structural verification (no pixels).
- **`serializeMermaid(d)`** — back to canonical source.
- **Round-trip** — structured bodies serialize to canonical, idempotent
  source; opaque bodies preserve original indentation/comments verbatim.
- **Narrowers** — `asFlowchart`/`asSequence`/`asTimeline`/`asClass`/`asEr`
  return `null` on a non-matching or source-level/opaque body (steers agents
  off the unsafe path).

## Diagram families (9)

| Family | Parse/render/round-trip | Structured mutation |
|---|---|---|
| Flowchart, State | ✅ | ✅ (6 ops) |
| Sequence | ✅ | ✅ (5 ops; alt/loop/note → opaque) |
| Timeline | ✅ | ✅ (10 ops) |
| Class | ✅ | ✅ (10 ops) |
| ER | ✅ | ✅ (7 ops) |
| Journey | ✅ | source-level only (lossless round-trip) |
| XY chart | ✅ | source-level only (lossless round-trip) |
| Architecture | ✅ | source-level only (lossless round-trip) |

**Structured-or-opaque rule:** every family either has a structured body
or preserves source verbatim. Constructs are never silently dropped.

## Output formats

- **SVG** — `renderMermaidSVG` (`compact`, `security:'strict'`, CSS
  variable fonts, `idPrefix` namespacing). CLI exposes `--security strict`.
- **ASCII / Unicode** — `renderMermaidASCII` (CJK/emoji width, FE0F/ZWJ,
  `maxWidth` wrapping, trunk-shared fanouts).
- **PNG** — `renderMermaidPNG` (offline `@resvg/resvg-js`, bundled DejaVu,
  cross-runtime deterministic on same-machine x86_64/ARM64 where Node + built `dist/` are present).
- **JSON layout** — `layoutMermaid` / `am render --format json`.
- **ASCII with metadata** — `renderMermaidASCIIWithMeta` → `{ascii, regions}`
  for TUI click-mapping.
- **Reverse** — `asciiToMermaid` reconstructs flowchart source from ASCII
  (best-effort, lossy, structural round-trip).

## Verification tiers

- **Tier 1 (structural, universal):** EMPTY_DIAGRAM, EDGE_MISANCHORED,
  OFF_CANVAS, GROUP_BREACH, UNKNOWN_SHAPE, LABEL_OVERFLOW.
- **Tier 2 (geometric, flowchart):** NODE_OVERLAP, ROUTE_SELF_CROSS.
- **Tier 3 (lint):** reserved; plugin hooks are wired, no built-in lint codes yet.
- **Perceptual quality** — `measureQuality` / `checkQuality` (edge
  crossings, label legibility, whitespace balance, …). See QUALITY.md.

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
  sanitized. See SECURITY.md.

## CLI (`am`)

`render` (svg/ascii/unicode/json with multi-input results; png uses one
input plus `--output`; `--security strict`, `--watch`), `render-markdown` (skip bad blocks),
`parse`, `verify`, `mutate` (`--op` or `--ops`), `preview` (strict standalone HTML + optional `--open`), `format`, `describe` (text/json),
`capabilities --json` (including `families[].editPolicy` + `families[].mutationOps`), `batch --jsonl` (including mutate),
`llms-txt`, `--agent-instructions`. `mutate` verifies before emitting source.
Exit codes 0/2/3/4; parse and verify-failure errors include structured `error.details` arrays.

## MCP server

Code Mode `execute(code)` (JavaScript in a `node:vm` sandbox with a typed
`mermaid.*` SDK declaration), plus narrow helper tools: `render_png` and
`describe`.

## Distribution

- npm library (`agentic-mermaid` plus the `agentic-mermaid/agent` subpath).
- **Single binary** — `bun run build:binary` → `dist/am`, standalone
  executable, no runtime dependency (#1018).
- **llms.txt** agent-discovery digest, derived from capabilities.

## Guarantees & evidence

- **Determinism** — byte-identical across repeated runs and processes for
  SVG layout/ASCII; full-corpus ASCII repeated-run guard; cross-runtime guards
  exist for bun ≡ node on same-machine x86_64/ARM64 when Node + built `dist/`
  artifacts are present.
- **Corpus gates** — 247-sample mermaid-js docs corpus + 132-case
  MermaidSeqBench, gated in CI.
- **Benchmarks** — `eval/benchmark/RESULTS.md` (measured vs mmdc, termaid).
- **Agent-usage validation** — `eval/agent-usage/` scenarios,
  anti-pattern linter, sandbox trace instrumentation, and stored Code Mode eval runner.
- **Unit, browser/e2e, typecheck, build, binary-build, eval, and lint gates**
  are part of the verification contract.

## Not browser-dependent

The entire core (parse/verify/mutate/serialize/SVG/ASCII/PNG) runs with no
DOM, no headless browser, synchronously. This is the structural
differentiator vs Puppeteer-based Mermaid CLIs.
