# Site mockups — `agentic-mermaid.dev`

Design-exploration mockups for the Agentic Mermaid website (the Path B /
[PR #27](https://github.com/adewale/beautiful-mermaid/pull/27) spec). These are
static concepts, not the production site: they are not wired to the spec's
generated routes or machine manifests.

## Pages

- `home.html` — landing + three-way start rail (`/`).
- `editor.html` — editor workbench with SVG/Unicode output and the tiered `verify` panel (`/editor`).
- `agents-harnesses.html` — local-MCP setup cards per harness (`/agents/harnesses`).
- `docs-article.html` — a `/docs` reading page in an editorial idiom.
- `states.html`, `alternatives.html` — craft reference sheets, not site routes.

## Editorial docs surfaces (A List Apart / Zeldman)

The reading surfaces under `/docs` follow A List Apart and Jeffrey Zeldman:
type-led, web-standards, accent only in links, generous measure. The article
column switches to a **serif body** for long-form gravitas (the app and
marketing pages keep the sans body) and uses the editorial furniture those
sites are known for — masthead and tagline, a deck/standfirst, a hairline
byline, numbered sections for a real sequence, a drop cap, a figure with a
caption, and a pull quote set between rules, not in a tinted box. The
byline credits `capabilities.json`, since docs are generated from product truth.

## Controls (no pills)

Pills read soft and consumer, which fights the precise manual/workbench voice.
Buttons use an 8px radius (the same family as the 7px mark and 8px inputs), tags
are squared 6px chips with a leading status dot, and the editor's output switch
is an underlined tab bar. `alternatives.html` shows the options compared
(soft-square vs sharp; chip+dot vs mono-bracket vs keyline; tabs vs boxed).

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

## Craft and motion

The interaction layer follows Emil Kowalski's `emil-design-eng`, Jakub Krehel's
`make-interfaces-feel-better`, Paul Bakaus' `impeccable`, and the
[animations.dev vocabulary](https://animations.dev/vocabulary):

- ease-out (`cubic-bezier(0.22, 1, 0.36, 1)`) for anything responding to the
  user; durations are short for frequent motion (140ms hover/press), longer for
  one-time entrance (460ms).
- press feedback is `scale(0.96)`; transitions name specific properties (never
  `all`) and move only transform/opacity/color so the GPU composites them.
- keyboard focus shows a visible ring; hit areas stay 40×40; changing numbers
  use tabular figures; nested radii are concentric (inner = outer − inset).
- theme switching crossfades; the load entrance is staggered; both collapse
  under `prefers-reduced-motion: reduce`.

`states.html` shows these values in one sheet (states that need a cursor are
drawn explicitly so they read in a screenshot). `shot-motion-*.png` are
frame-by-frame filmstrips of the theme crossfade and the entrance, since the
environment has no video encoder.

## The living mark (a restrained shader)

`shader-mark.js` renders a WebGL fragment shader behind the brand glyph: a slow
pine-to-mint caustic, the size of the 26px mark. The logo is a wave and the
product is mermaid, so the motion is on-brand rather than decorative. It stays
restrained by confinement (26px), palette (one accent family), and speed; a
soft vignette plus a glyph text-shadow keep the `≈` legible. It settles to a
single frame under `prefers-reduced-motion`, stirs slightly on hover, and falls
back to the flat accent fill if WebGL is missing. `shader-demo.html` shows it
large; `shot-shader.png` is a four-frame filmstrip of the caustic flowing.

A trident is hidden in the water (Poseidon, the sea, the mermaid): an SDF of a
trident that stays near-invisible at rest and blooms whole every several
seconds, so most people overlook it most of the time and it stays recognizable
when caught. The resting phase is what the page stills and the nav show. The
same motif recurs once, quietly, as the end-mark dingbat closing the docs
article — the kind of fleuron readers skim past.

## Regenerate

```bash
# diagrams (SVG + Unicode), then strip the web-font @import (see git history for the one-liner)
bun run bin/am.ts render mockups/diagrams/workflow.mmd --format svg > mockups/diagrams/workflow.svg

# page stills → mockups/shot-<page>-{light,dark,mobile}.png
bun run mockups/shot.ts

# states sheet + motion filmstrips → shot-states-{light,dark}.png, shot-motion-{theme,entrance}.png
bun run mockups/record.ts

# living-mark shader filmstrip → shot-shader.png, shot-shader-context.png
bun run mockups/shader.ts
```
