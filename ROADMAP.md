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
- **[cut for Loop 7, planned Loop 8] `maxWidth` + word wrapping.**
  Agents rendering ASCII into a terminal want to constrain the
  canvas width. The renderer currently lets the column-greedy
  layout pick the width; a `maxWidth` option that wraps labels
  and re-runs layout would close this. Inspiration: the upstream
  AlexanderGrooff/mermaid-ascii has a `--maxWidth` flag we can
  port directly.
- **[cut for Loop 7, planned Loop 8] `renderAsciiWithMeta()` for
  TUI.** A version of `renderMermaidAscii` that returns
  `{ canvas, regions }` where `regions` maps `(node|edge|label) →
  { x, y, w, h }` so a TUI can attach click handlers, color
  schemes, or pop-ups. Inspiration: raiscui/mermaid-ascii has a
  prototype with the right shape.

## Pillar 3 — Agent experience first-class

- **[shipped] `validate`.** Our verb is named `verify`. Same shape
  the user's vision asked for.
- **[shipped] `normalize`.** Our verb is named `format`. Idempotent,
  same shape as Pillar 3's `normalize`.
- **[partial, Loop 8] `render --format ascii|svg|png|json`.**
  Loop 8 added `--format png` (writes to `--output file.png`; PNG bytes
  would corrupt terminals so stdout is rejected). The remaining
  unicode/json modes deferred to Loop 9 — they don't block PNG.
- **[cut] `describe` for alt text / LLM summaries.** A verb that
  emits an English-language description of a diagram — "five-node
  flowchart, A flows into B and C which both flow into D, …" —
  would let an agent write alt-text without re-implementing the
  prose generator. Not in Loop 8's scope yet; the right
  implementation likely sits on top of the Code Mode `execute`
  surface (the agent writes the prose; we just expose the IR).
- **[shipped] `capabilities --json`.** Loop 7. The agent
  introspects the SDK once and never guesses.

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
