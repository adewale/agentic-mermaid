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

## Themed, sparse, document-first

The site reads like a **rendered Markdown document.** One centred column at a
`70ch` measure, generous whitespace, text before chrome. The element set is the
Markdown set — headings, paragraphs, lists, `<hr>` rules between sections, fenced
code blocks, blockquotes, tables, and figures — with no cards, panels, grids, or
shadows. Links are the only accent. The masthead is a single quiet line (mark,
wordmark, text links, a switcher, a hairline) rather than an app nav. A faint
desaturated grain (`body::before`, `feTurbulence`, ~7%) gives the dark some
texture.

**Theme switcher** (`theme.js` + `[data-theme]` palettes in `styles.css`),
echoing the GitHub Pages one — named palettes with colour swatches — but as a
single quiet trigger that opens a smooth dropdown, with the whole page
**colour-crossfading** (0.35s) on change. Six themes drawn from the renderer's
own: **Pine** (dark, default), **Paper** (light), **Nord**, **Dracula**,
**Solarized** (light), **GitHub**. Each diagram ships a light and a dark render
(`workflow-{light,dark}.svg`, re-themed via a `themeVariables` init directive in
the source) and crossfades to match the theme; light themes show the light
diagram, dark themes the dark. Choice persists in `localStorage`, with an inline
head guard against a flash of the default.

On the renderer's themes: our diagrams previously used the fork's `default`
(`zinc-light`), whose closest stock Mermaid theme is `neutral` (grayscale); the
site's pine accent is nearest `forest`. There is no stock dark-green theme,
which is why the white diagrams clashed — so the figures now carry an explicit
dark palette that matches the page.

`states.html` and `alternatives.html` are kept only as design-history reference
sheets; a small legacy-component block at the end of `styles.css` exists solely
so they still render in dark. They are not site pages.

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

The logo is a small layered directed graph, after Kozo Sugiyama's framework for
drawing DAGs — rank assignment, crossing minimisation, downward flow — which is
the family of algorithms the layout engine uses (via ELK). The flow converges:
three source nodes in rank 1 (the prong tips) route to one sink in rank 3 (the
handle). Every edge spans two ranks, so each is **routed through a dummy node**
in rank 2 — the framework's signature move for long edges — and the three dummies
line up as a crossbar. The upshot: the layered drawing **vaguely resembles a
trident**, emergent from the layout rather than drawn as one (a wink back at an
earlier idea this arc had rejected as too literal). The dummies are small hollow
circles that reward a second look.

Two motions, both true to the method:

- **On load the mark assembles like the layout it depicts** — ranks settle into
  place top to bottom (layer assignment), then the edges route in, the long edge
  and its dummy last. `shot-shader-settle.png` is the filmstrip.
- **A WebGL shader sweeps a soft light down through the ranks** now and then, the
  way the method passes over layers: a signal propagating through the hierarchy.
  `shot-shader.png` is the filmstrip.

It stays restrained by confinement (26px), one accent family, and gaps between
both motions; it settles to a single still frame under `prefers-reduced-motion`,
quickens on hover, and falls back to the flat accent fill (white graph still
shown) if WebGL is missing.

The graph is one drawing — circles for nodes, strokes for edges, the long edge a
bent polyline, the dummy a hollow circle — shared by the logo glyph,
`favicon.svg`, and the docs end-mark. The same node/edge coordinates drive the
shader (in viewBox space), so the sweep lights exactly the ranks the white graph
draws. (Earlier versions used a trident, then a two-node flowchart; both were
dropped — too on-the-nose, then too generic.)

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
