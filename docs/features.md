# Features — capability inventory

What Agentic Mermaid can do, organized by capability area. The npm import paths are `agentic-mermaid` and `agentic-mermaid/agent`; audit and trusted host-resource helpers remain repository tooling. Implementation history lives in [`project/divergences.md`](./project/divergences.md); active backlog is only [`../TODO.md`](../TODO.md).

## Core IR & editing loop

- **Typed `ValidDiagram` IR** — parse Mermaid into a sealed, typed value.
- **`parseRegisteredMermaid(source)`** → `Result<ValidDiagram, ParseError[]>`. Never
  throws on malformed input; structured errors.
- **`mutate(d, op)`** — family-overloaded typed mutation. The generated
  `am capabilities --json` response and SDK declaration expose the authoritative
  operation menu for every registered family.
- **`verifyMermaid(d, opts)`** — structural and geometric verification plus a
  strict render-parity gate, with deterministic semantic facts available for
  meaning-level checks.
- **`serializeMermaid(d)`** — back to canonical source.
- **Round-trip** — structured bodies serialize to canonical, idempotent
  source; opaque bodies preserve original indentation/comments verbatim.
- **Narrowers** — each family descriptor owns its generated SDK narrower;
  discover the current names through `am capabilities --json`. A narrower
  returns `null` on a non-matching or source-level/opaque body, steering agents
  off the unsafe path without maintaining a second family roster here.

## Diagram families

The canonical `FamilyDescriptor` registry owns headers, discovery, examples,
operations, rendering hooks, positioned projections, semantic roles, and
capability evidence. Run `am capabilities --json` for the current roster and
per-family operation shapes; the generated Section A matrix records native,
source-preserved, diagnosed, and not-applicable capabilities without a copied
table. `absent` belongs to the validation vocabulary but is rejected from the
shipped syntax ledger:
[`project/section-a-capability-report.md`](./project/section-a-capability-report.md).

**Structured-or-opaque rule:** every family either has a structured body
or preserves source verbatim. Constructs are never silently dropped.

## Output formats

Agentic Mermaid outputs **SVG, PNG, ASCII, Unicode, and JSON layout** from the same renderer foundation.

- **Styles** — every SVG/PNG render accepts `style`: any registered Look or
  Palette discovered through `knownStyleDescriptors()`, an inline JSON record,
  or a stack merged left → right
  (`{ style: ['hand-drawn', 'dracula'] }`). `seed` re-rolls styled ink and
  never moves layout. CLI: `am render --style … --seed N`, `am styles`;
  MCP render tools take `style`/`seed`; RENDER_FAILED-gated verify means a
  clean verify proves the styled source renders. Authoring guide, schema, and
  cookbook: `docs/style-authoring.md`, `docs/schemas/style-spec.schema.json`,
  and `docs/custom-style-cookbook.md`. Custom font selection and resolution:
  `docs/custom-fonts.md`.

- **SVG** — `renderMermaidSVG` (`compact`, `security:'strict'`, CSS
  variable fonts, all-family semantic `data-id`/`data-role` identities, typed
  relation ARIA, and `idPrefix` namespacing for markers, filters, clip paths,
  paints, hrefs, and ARIA references). CLI exposes `--security strict`.
- **ASCII / Unicode** — `renderMermaidASCII` uses grapheme/display-cell geometry
  across every family. `targetWidth` is a hard bound with typed impossible-width
  errors; deprecated `maxWidth` remains best-effort only.
- **PNG** — `renderMermaidPNG(source, { ...sharedRenderOptions, fitTo, background, fontDirs, loadSystemFonts, onWarning })` or `am render diagram.mmd --format png --output diagram.png` (offline `@resvg/resvg-js`; bundled Inter — the metrics font — with DejaVu fallback plus the built-in style faces,
  cross-runtime deterministic on same-machine x86_64/ARM64 where Node + built `dist/` are present; explicit sRGB + cICP metadata with no conflicting ICC profile). Characters without bundled coverage (CJK, emoji) warn loudly; supply `--font-dirs <dir>` / `fontDirs` or `--system-fonts` / `loadSystemFonts: true`.
  Trusted hosts can bind one registered graphical backend across SVG, native
  PNG, and browser PNG with `createMermaidRenderer`,
  `createMermaidPNGRenderer`, and `createMermaidBrowserPNGRenderer`; backend
  selection is host policy and cannot be smuggled through serializable render
  options or Styles.
- **JSON layout** — `layoutMermaid` / `am render --format layout`; add `--certificates` (or `layoutMermaid(d, { debug: true })`) to include opt-in graph route certificates, family edge-route certificates (class/ER/architecture/sequence), region-containment certificates (timeline/charts), V1 region/action sidecars, exact ports, and side/slot/role assignments where applicable.
- **ASCII with metadata** — `renderMermaidASCIIWithMeta` → `{ ascii, regions, actions, warnings, routeParity }`
  for TUI click-mapping.
- **Reverse** — `asciiToMermaid` reconstructs flowchart source from ASCII
  (best-effort, lossy, structural round-trip).

## Verification tiers

- **Tier 1 (structural, universal):** EMPTY_DIAGRAM, EDGE_MISANCHORED,
  OFF_CANVAS, GROUP_BREACH, UNKNOWN_SHAPE, LABEL_OVERFLOW, UNRESOLVABLE_SCHEDULE,
  RENDER_FAILED (a clean verify proves the source actually renders).
- **Tier 2 (geometric — route tripwires for flowchart/state, anchor/overlap checks for class/ER):** NODE_OVERLAP, ROUTE_SELF_CROSS, and the route-contract tripwires ROUTE_HITCH, ROUTE_UNEXPLAINED_BEND, ROUTE_LABEL_ON_SHARED_TRUNK, ROUTE_SELF_LOOP_OCCUPANCY, ROUTE_CONTAINER_MISANCHOR, ROUTE_SHAPE_MISANCHOR, ROUTE_STALE_AFTER_NODE_MOVE.
- **Tier 3 (lint and inspect-only policy):** DUPLICATE_EDGE, UNREACHABLE_NODE, DECISION_BRANCH_UNLABELED, FLOW_IMBALANCE, COMMENT_DROPPED, UNSUPPORTED_SYNTAX, CONTENT_DROPPED_ON_ROUNDTRIP, INEFFECTIVE_CONFIG, LOW_CONTRAST, BRAND_CONSTRAINT_WARNING, BRAND_CONSTRAINT_ERROR. FLOW_IMBALANCE flags a sankey intermediate node whose inflow and outflow differ (conservation is the domain's defining property). Brand constraints inspect final contrast, accent area, or monochrome role paint without repainting/relayout; only the caller-selected `action: "error"` code flips `verify.ok`.
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
  the SVG (no Google Fonts `@import`) after one shared transform plus residual
  verification policy.
- **`verifyNoExternalRefs(svg)`** — scanner / CI gate / agent self-check.
- No `<image>`/`<script>`/external-href injection; click directives
  sanitized. See [`../SECURITY.md`](../SECURITY.md).

## CLI (`am`)

`render` (svg/ascii/unicode/json with multi-input results; png uses one
input plus `--output`; `--security strict`, `--watch`), `render-markdown` (skip bad blocks),
`parse`, `verify`, `mutate` (`--op` or `--ops`), `preview` (strict standalone HTML + optional `--open`), `format`, `describe` (text/json),
`capabilities --json` (including `families[].editPolicy`,
`families[].mutationOps`, and the machine-readable `sectionA` contract matrix),
`batch --jsonl` (including mutate),
`llms-txt`, `init-agent`, `--agent-instructions`. `mutate` verifies before emitting source; `init-agent` writes a non-clobbering `AGENTS.md` section, root `skills/` bundle, and `.mcp.json` sample into a consumer repo.
Exit codes 0/2/3/4; parse and verify-failure errors include structured `error.details` arrays.

## MCP server

Local `agentic-mermaid-mcp` is Code Mode-first: `execute(code)` runs synchronous
JavaScript in a local `node:vm` sandbox with a typed `mermaid.*` SDK declaration,
plus narrow `describe_sdk`, `render_png`, and `describe` helpers. The initial
Code Mode declaration carries only the core SDK; `describe_sdk` returns one
family's mutation schema on demand. It supports stdio by default and
HTTP/SSE via `agentic-mermaid-mcp --transport http`; local `render_png` can
return base64 bytes or managed file/URL artifacts with MIME type, byte count, and
SHA-256 metadata.

The hosted endpoint at `https://agentic-mermaid.dev/mcp` is stateless
Streamable HTTP. It exposes nine bounded MCP JSON-RPC tools: `execute` in a
Cloudflare Dynamic Worker isolate, pure `describe_sdk` / `render_svg` /
`render_ascii` / `render_png` / `verify` / `describe`, and declarative `mutate` / `build` for
structured edits. Hosted inputs are capped at 64 KB, PNG is base64-only, and the
endpoint is a convenience surface rather than a REST render API.

## Distribution

- npm library (`agentic-mermaid` and `agentic-mermaid/agent`) with Node-runnable bins (`am`, the package-runner alias `agentic-mermaid`, and `agentic-mermaid-mcp`).
- **Single binary** — `bun run build:binary` → `dist/am`, standalone
  executable, no runtime dependency (#1018).
- **llms.txt** agent-discovery digest, derived from capabilities.

## Guarantees & evidence

- **Determinism** — byte-identical across repeated runs and processes for
  SVG layout/ASCII; full-corpus ASCII repeated-run guard; cross-runtime guards
  exist for bun ≡ node on same-machine x86_64/ARM64 when Node + built `dist/`
  artifacts are present.
- **Corpus gates** — pinned Mermaid documentation and MermaidSeqBench corpora,
  gated in CI; their manifests, rather than this prose, own current counts.
- **Benchmarks** — `eval/benchmark/RESULTS.md` (measured vs mmdc, termaid).
- **Agent-usage validation** — `eval/agent-usage/` scenarios,
  anti-pattern linter, sandbox trace instrumentation, and stored Code Mode eval runner.
- **Unit, browser/e2e, typecheck, build, binary-build, eval, and lint gates**
  are part of the verification contract.

## Not browser-dependent

The entire core (parse/verify/mutate/serialize/ASCII/PNG/SVG) runs with no
DOM, no headless browser, synchronously. This is the structural
differentiator vs Puppeteer-based Mermaid CLIs.
