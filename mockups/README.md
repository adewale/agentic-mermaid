# Site mockups — `agentic-mermaid.dev`

Design-exploration mockups for the Agentic Mermaid website (the Path B /
[PR #27](https://github.com/adewale/beautiful-mermaid/pull/27) spec). These are
**static concepts, not the production site** — they are not wired to the spec's
generated routes or machine manifests.

## Pages

- `home.html` — landing + three-way start rail (`/`).
- `editor.html` — editor workbench with SVG/Unicode output and the tiered `verify` panel (`/editor`).
- `agents-harnesses.html` — local-MCP setup cards per harness (`/agents/harnesses`).

## Design constraints

Designed against [impeccable.style/slop](https://impeccable.style/slop): two real
type families (DejaVu Serif display + DejaVu Sans body, roman not italic; no
Inter/Geist/Space Grotesk/Instrument Serif), a single pine-teal accent (no
gradients), hairline-edged cards with no shadow, 12px card radius, ease-out
motion. Shared tokens live in `styles.css`.

The embedded diagrams are **real renderer output**, not hand-drawn SVG:
`diagrams/*.mmd` are the sources, rendered with `am render`. The `Inter`
`@import` the renderer emits is stripped so the pages are self-contained.

## Regenerate

```bash
# diagrams (SVG + Unicode), then strip the web-font @import
bun run bin/am.ts render mockups/diagrams/workflow.mmd --format svg > mockups/diagrams/workflow.svg
# ... (see git history for the post-process one-liner)

# screenshots → mockups/shot-*.png
bun run mockups/shot.ts
```
