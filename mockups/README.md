# Site mockups — `agentic-mermaid.dev`

Design-exploration mockups for the Agentic Mermaid website (the Path B /
[PR #27](https://github.com/adewale/beautiful-mermaid/pull/27) spec). These are
static concepts, not the production site: they are not wired to the spec's
generated routes or machine manifests.

## Pages

- `home.html` — landing + three-way start rail (`/`).
- `editor.html` — editor workbench with SVG/Unicode output and the tiered `verify` panel (`/editor`).
- `agents-harnesses.html` — local-MCP setup cards per harness (`/agents/harnesses`).

## Themes and responsiveness

Two themes share one token set in `styles.css`. Dark mode applies via OS
preference (`prefers-color-scheme: dark`) or an explicit `[data-theme="dark"]`
attribute; the nav carries a toggle affordance. Diagrams render onto a light
panel (`--diagram-bg`) in both themes so the geometry stays legible. The layout
collapses to a single column at 820px and reduces the display sizes; the nav
swaps its links for a menu button below that width.

## Design and writing constraints

Visual design follows [impeccable.style/slop](https://impeccable.style/slop):
two real type families (DejaVu Serif display + DejaVu Sans body, roman not
italic; no Inter/Geist/Space Grotesk/Instrument Serif), one pine-teal accent
(no gradients), hairline-edged cards with no shadow, 12px card radius, ease-out
motion, and a flat dark theme with no glowing accents.

Copy follows [adewale/anti-slop-writing](https://github.com/adewale/anti-slop-writing):
no "not just X but Y" constructions, no staccato "Same X. Same Y." cadence, and
punchy lines name a mechanism (for example, determinism) rather than asserting
importance.

The embedded diagrams are real renderer output, not hand-drawn SVG:
`diagrams/*.mmd` are the sources, rendered with `am render`. The `Inter`
`@import` the renderer emits is stripped so the pages are self-contained.

## Regenerate

```bash
# diagrams (SVG + Unicode), then strip the web-font @import (see git history for the one-liner)
bun run bin/am.ts render mockups/diagrams/workflow.mmd --format svg > mockups/diagrams/workflow.svg

# screenshots → mockups/shot-<page>-{light,dark,mobile}.png
bun run mockups/shot.ts
```
