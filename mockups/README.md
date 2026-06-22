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

Two themes share one token set in `styles.css`, and they are deliberately the
same system at two lightnesses rather than two palettes. The neutrals are
anchored on one faintly teal hue — light is a cool paper, dark a teal-charcoal —
and the steps are parallel: in both modes a surface lifts a clear notch off the
background and a hairline border stays visible (the earlier dark mode let cards
sink into the background). Dark applies via OS preference
(`prefers-color-scheme: dark`) or an explicit `[data-theme="dark"]`; the nav
carries a toggle. Diagrams render onto a light panel (`--diagram-bg`) in both
themes so the geometry stays legible.

The logo is the same self-contained chip in both modes — a white node-edge
diagram on the pine accent — so the brand reads identically light or dark. A
`--mark-ring` token is transparent in light and a faint white hairline in dark,
so the chip's edge stays crisp against the near-black nav. The same diagram is
the `favicon.svg`.

The layout collapses to a single column at 820px and reduces the display sizes;
the nav swaps its links for a menu button below that width.

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

The logo is the product's own primitive rather than a sea metaphor: two nodes
joined by a deterministically routed orthogonal edge — the shape the layout
engine makes. A WebGL fragment shader paints the accent ground and sends a faint
signal travelling the edge (`A → bend → B`) now and then: an agent moving
through the diagram. It stays restrained by confinement (26px), one accent
family, and a gap between signals; it settles to a single still frame under
`prefers-reduced-motion`, the signal quickens on hover, and it falls back to the
flat accent fill (white diagram still shown) if WebGL is missing.
`shader-demo.html` shows it large; `shot-shader.png` is a four-frame filmstrip of
the signal travelling A → bend → B.

The diagram is one drawing — nodes as filled rects, the route as a stroked
orthogonal path with an arrowhead — shared by the logo glyph, `favicon.svg`
(white on the pine square), and the end-mark closing the docs article. The edge
geometry is shared with the shader too, in `uv` with a flipped y, so the signal
tracks the same route the white edge draws. (An earlier version used a trident;
it was dropped as too on-the-nose for a "mermaid" product.)

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
