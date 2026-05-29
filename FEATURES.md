# Features — capability inventory

What the `beautiful-mermaid/agent` surface in this fork can do, organized
by capability area. This is the user-facing inventory; the per-loop
implementation log is `DIVERGENCES.md`; active backlog is only `TODO.md`.

## Core IR & editing loop

- **Typed `ValidDiagram` IR** — parse Mermaid into a sealed, typed value.
- **`parseMermaid(source)`** → `Result<ValidDiagram, ParseError[]>`. Never
  throws on malformed input; structured errors.
- **`mutate(d, op)`** — family-overloaded typed mutation. Ops per family:
  flowchart/state (6), sequence (5), timeline (10), class (10), ER (7).
- **`verifyMermaid(d, opts)`** — structural verification (no pixels).
- **`serializeMermaid(d)`** — back to canonical source.
- **Round-trip** — `parse → serialize` is byte-stable; opaque bodies
  preserve original indentation/comments verbatim.
- **Narrowers** — `asFlowchart`/`asSequence`/`asTimeline`/`asClass`/`asEr`
  return `null` on a non-matching or opaque body (steers agents off the
  unsafe path).

## Diagram families (9)

| Family | Parse/render/round-trip | Structured mutation |
|---|---|---|
| Flowchart, State | ✅ | ✅ (6 ops) |
| Sequence | ✅ | ✅ (5 ops; alt/loop/note → opaque) |
| Timeline | ✅ | ✅ (10 ops) |
| Class | ✅ | ✅ (10 ops) |
| ER | ✅ | ✅ (7 ops) |
| Journey, XY chart, Architecture | ✅ | opaque (lossless round-trip) |

**Structured-or-opaque rule:** every family either has a structured body
or preserves source verbatim. Constructs are never silently dropped.

## Output formats

- **SVG** — `renderMermaidSVG` (+ `--compact`, `--security strict`, CSS
  variable fonts, `idPrefix` namespacing).
- **ASCII / Unicode** — `renderMermaidASCII` (CJK/emoji width, FE0F/ZWJ,
  `maxWidth` wrapping, trunk-shared fanouts).
- **PNG** — `renderMermaidPNG` (offline `@resvg/resvg-js`, bundled DejaVu,
  cross-runtime deterministic on x86_64).
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

`render` (svg/ascii/unicode/png/json, `--compact`, `--security strict`,
`--output`, `--watch`, multi-input), `render-markdown` (skip bad blocks),
`parse`, `verify`, `mutate`, `format`, `describe` (text/json),
`capabilities --json` (including `families[].mutationOps`), `batch --jsonl`,
`llms-txt`, `--agent-instructions`. `mutate` verifies before emitting source.
Exit codes 0/2/3/4; structured `error.details`.

## MCP server

Code Mode `execute(code)` (typed `mermaid.*` SDK in a `node:vm` sandbox),
plus narrow helper tools: `render_png` and `describe`.

## Distribution

- npm library (`beautiful-mermaid/agent` subpath).
- **Single binary** — `bun run build:binary` → `dist/am`, standalone
  executable, no runtime dependency (#1018).
- **llms.txt** agent-discovery digest, derived from capabilities.

## Guarantees & evidence

- **Determinism** — byte-identical across runs, processes, and runtimes
  (bun ≡ node, x86_64) for SVG layout, PNG, and ASCII.
- **Corpus gates** — 247-sample mermaid-js docs corpus + 132-case
  MermaidSeqBench, gated in CI.
- **Benchmarks** — `eval/benchmark/RESULTS.md` (measured vs mmdc, termaid).
- **Agent-usage validation** — `eval/agent-usage/` scenarios,
  anti-pattern linter, sandbox trace instrumentation, and stored Code Mode eval runner.
- **~1695 unit tests + 56 e2e tests**, tsc + build + lint clean.

## Not browser-dependent

The entire core (parse/verify/mutate/serialize/SVG/ASCII/PNG) runs with no
DOM, no headless browser, synchronously. This is the structural
differentiator vs Puppeteer-based Mermaid CLIs.
