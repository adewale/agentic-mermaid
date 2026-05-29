# Roadmap — three pillars

This is a status board, not a wish list. Each item is tagged
`shipped`, `partial`, or `cut`, and where a feature is `cut` or
`partial` we name the upstream inspiration so the next implementer
can lift the design directly.

## Pillar 1 — A renderer agents can actually use

- **[shipped] Official CLI `am`.** `render`, `verify`, `parse`,
  `serialize`, `mutate`, `format`, and as of Loop 7 `capabilities`
  and `batch`. Stable JSON envelope on every command.
- **[shipped] MCP server.** Code Mode design: one `execute` tool,
  typed `mermaid.*` SDK declaration injected into the system prompt,
  sandboxed via `node:vm`.
- **[partial] Deterministic ASCII output.** Loop 7 added a
  10-run byte-identity guard on three multi-edge fixtures. Probe
  showed the existing pathfinder is already deterministic; the
  guard catches future regressions. Outstanding: extend the guard
  to the full 247-sample corpus.
- **[partial] Parse / validate / canonicalize modes.** The CLI verbs
  exist (`am parse`, `am verify`, `am format`) but they don't take
  a `--mode` flag yet. An agent that wants "validate only, don't
  canonicalize" runs `am verify` instead of `am format`. Cleaner
  would be one `process` verb with `--mode validate|canonicalize`;
  deferred to Loop 8.
- **[shipped] Machine-readable errors + capabilities.** Loop 7
  shipped `am capabilities --json` with the families × hooks ×
  warning codes matrix. Every error path through the CLI emits
  structured JSON, never just stderr.

## Pillar 2 — Own terminal-shaped diagrams

- **[partial] CJK / emoji width.** Loop 7 added FE0F / FE0E / ZWJ
  handling to `visualWidth` and re-centered sequence-message labels
  on terminal columns. Outstanding: ZWJ flag sequences (e.g. 🇺🇸),
  skin-tone modifier sequences, and the right Math for
  Hangul-Jamo conjoining.
- **[shipped] Robust sequence + flowchart ASCII.** Loop 7 fixed five
  ASCII bugs in sequence (self-arrow multi-line split, alt-block
  width math, CJK label centering, FE0F/ZWJ, pathfinder
  determinism guard). Three new test files lock the fixes.
- **[shipped, Loop 9] `maxWidth` + word wrapping.** `renderMermaidASCII`
  takes `maxWidth?: number`; a label-wrapping preprocessor wraps
  bracket-quoted labels at word boundaries. `wrapLabel` is exported.
- **[shipped, Loop 9] `renderAsciiWithMeta()` for TUI.**
  `renderMermaidASCIIWithMeta` returns `{ ascii, regions }` where each
  region carries kind/id/canvasRow/colStart/colEnd for click-mapping.
- **[shipped, Loop 10] A* OOM guard (#66).** Pathfinder bounds search
  to grid extent + iteration cap; walled targets fall back to a direct
  route instead of hanging.
- **[shipped, Loop 10] fanout trunk-sharing (#113).** Already present
  in edge-bundling.ts; Loop 10 added regression + determinism coverage.
- **[shipped, Loop 10] reverse ASCII→Mermaid (raiscui).** `asciiToMermaid`
  recovers nodes + edges (best-effort, flowchart, lossy — synthesized
  ids, structural round-trip). Exported from `beautiful-mermaid/agent`.
- **[Loop 11] #69 fan-in grouping** — deferred (layout aesthetics, risks
  determinism snapshots).

## Pillar 3 — Agent experience first-class

- **[shipped] `validate`.** Our verb is named `verify`. Same shape
  the user's vision asked for.
- **[shipped] `normalize`.** Our verb is named `format`. Idempotent,
  same shape as Pillar 3's `normalize`.
- **[shipped, Loop 8+9] `render --format ascii|unicode|svg|png|json`.**
  Loop 8 added `png` (writes to `--output file.png`). Loop 9 added
  `json` (layout shape) and `unicode`/`ascii` aliases.
- **[shipped, Loop 9] `describe` for alt text / LLM summaries.**
  `describeMermaid(d)` + `am describe <file>` + MCP `describe` tool.
  Per-family prose: flowchart entry/sink nodes, sequence
  participants/messages, etc.
- **[shipped] `capabilities --json`.** Loop 7. The agent
  introspects the SDK once and never guesses.

## AX / semantic hooks

- **[shipped, Loop 10] external CSS class emission (#81).** Node `<g>`
  carries user-assigned Mermaid class names so external stylesheets can
  target semantic classes.
- **[shipped, pre-Loop-10, tested Loop 10] auto-contrast on custom fills
  (#116).** `contrastTextColor` picks black/white label text by fill
  luminance. Loop 10 added the regression coverage.
- **[Loop 11] rgb()/comma values in `style` statements** — real parser
  bug found in Loop 10 M2: `style A fill:rgb(10,10,10)` is comma-split.
  Hex fills are the supported path until fixed.

## What is not on the roadmap

- A general-purpose Mermaid grammar parser. We rely on Mermaid's
  own parsers for grammar coverage; our IR is the *editing
  surface* on top of that grammar. Adding our own grammar
  parser would double the surface area we have to keep in sync.
- A web playground or hosted service. The MCP server runs locally
  via stdio; the CLI runs locally as `bun run am`. The library is
  pure-functional and ships in npm.
- PDF output. Out of scope; agents that need it pipe `am render`
  SVG into a separate `pdfkit` step. PNG export DID ship in Loop 8
  via `@resvg/resvg-js` (pinned 2.6.2, napi-rs native build, bundled
  DejaVu Sans fonts for cross-runtime determinism). See `AGENT_NATIVE.md`
  "Distribution" + `QUALITY.md` "PNG determinism" for the trade-offs.
