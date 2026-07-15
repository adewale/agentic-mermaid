# Analysis diagrams

Ad-hoc, human-authored diagrams that describe the project itself. Unlike the
figures under [`docs/design/system`](../design/system/) and
[`docs/design/families`](../design/families/), these are **not** part of the
family authority and are **not** drift-tested — they are point-in-time analysis
snapshots. Both are authored as Mermaid and render with our own CLI.

## Files

- [`agentic-mermaid-architecture.mmd`](./agentic-mermaid-architecture.mmd) — a
  pedagogical, entry-to-output view of the render pipeline: the four entry
  surfaces (CLI, MCP, library, web) funnel through one shared waist (the render
  contract), into per-family typed hooks, the ELK-based layout engine, and back
  out to SVG/PNG, ASCII/Unicode, and layout JSON. For the canonical,
  test-locked system figure, see
  [`docs/design/system/architecture.mmd`](../design/system/architecture.mmd)
  instead; this file is a looser companion, not a replacement.

- [`styling-capability-radar.mmd`](./styling-capability-radar.mmd) — the
  renderer's styling surface (capability) versus how much of it the project's
  own shipped diagrams actually use. **The 0–10 scores are subjective
  estimates**, not a computed metric; treat them as a discussion aid. The
  headline gaps (capability present, largely unused in default output) are node
  shapes, `classDef`/inline styling, and fill treatments.

## Render

```bash
bun run bin/am.ts render docs/analysis/styling-capability-radar.mmd \
  --format png --output radar.png --style github-light
bun run bin/am.ts render docs/analysis/agentic-mermaid-architecture.mmd \
  --format png --output architecture.png --style github-light
```

Swap `--style` for any registered look/palette (`am styles`), e.g.
`--style blueprint` or `--style dracula`.
