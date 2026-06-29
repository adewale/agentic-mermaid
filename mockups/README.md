# Site mockups — `agentic-mermaid.dev`

Design-exploration source files for the Agentic Mermaid website (the Path B /
[PR #27](https://github.com/adewale/beautiful-mermaid/pull/27) spec). The
Cloudflare Workers Static Assets site now lives in `website/`; its build step
converts these mockups into clean routes and adds the spec's machine-readable
manifests, schemas, recipes, examples, and public skill surface.

## Pages

- `home.html` — landing, agent prompt/MCP CTAs, edit loop, and local setup (`/`).
- `editor.html` — editor workbench with SVG/Unicode output and the tiered `verify` panel (`/editor`).
- `skill-workflow.html` — public workflow-skill landing (`/skills/agentic-mermaid-diagram-workflow/`).
- `docs-article.html` — a `/docs` reading page using the same document column,
  masthead, typography, and control primitives as the rest of the site.
- `states.html`, `alternatives.html` — craft reference sheets, not site routes.
- `tufte-max.html` — an experiment, not a site page: the editor's `verify` panel
  rebuilt in full Tufte idiom.

## Editorial docs surfaces — same primitives as the site

The `/docs` route is intentionally no longer a separate visual system. It uses
`styles.css` for the same masthead, centred `70ch` document measure, heading
scale, code blocks, figures, copy/status widgets, and note primitive as the
landing, gallery, families, skill, and docs pages. The docs page may still contain explanatory
notes and sparklines, but they are ordinary reusable prose primitives rather than
a page-scoped asymmetric Tufte layout.

## Controls (no pills)

Pills read soft and consumer, which fights the precise manual/workbench voice.
Buttons use an 8px radius (the same family as the 7px mark and 8px inputs), tags
are squared 6px chips with a leading status dot, and editor pane controls are
segmented controls rather than pseudo-tabs. `alternatives.html` shows the older
options compared as design history.

## Themed, sparse, document-first

The site reads like a **rendered Markdown document.** One centred column at a
`70ch` measure, generous whitespace, text before chrome. The element set is the
Markdown set — headings, paragraphs, lists, `<hr>` rules between sections, fenced
code blocks, blockquotes, tables, and figures — with no cards, panels, grids, or
shadows. Links are the only accent. The masthead is a single quiet line (mark,
wordmark, text links, a switcher, a hairline) rather than an app nav.

## Theme boundary — public shell fixed, diagram themes editor-only

The public site no longer has a global theme picker. Paper/Dusk site chrome is a
brand surface, not a renderer-theme preview. Diagram themes live in the editor's
explicit **Diagram theme** dropdown and change render output only; they must not
retint the public masthead, prose, logo, or docs shell.

The CSS still keeps the brand/theme/scheme token seam because diagrams, plates,
forced-colors handling, and historical reference sheets use it, but production
public pages ship without `.theme-switch` markup or global `am-theme` state.
`theme.js` handles copy widgets and status feedback only.

## Design and writing constraints

Visual design follows [impeccable.style/slop](https://impeccable.style/slop):
a calibration-sheet type direction (Charter-style serif, Avenir/system sans,
SF Mono/Menlo mono), a restrained warm accent plus pine brand mark, no generic
AI gradients, hairline surfaces, modest radii, ease-out motion, and no glowing
SaaS chrome.

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
quickens on hover, and falls back to the flat chip fill (the deep-green graph
still shown) if WebGL is missing. The shader's three greens are read from CSS
custom properties (`--m-deep`/`--m-mid`/`--m-sweep`) rather than hard-coded, so
the mark palette lives in the brand layer; `mark-greens.html` and
`mark-live.html` are the shade exploration and the Fern/Tonal in-context test.

The graph is one drawing — circles for nodes, strokes for edges, the long edge a
bent polyline, the dummy a hollow circle — shared by the logo glyph,
`favicon.svg`, and the docs end-mark. The same node/edge coordinates drive the
shader (in viewBox space), so the sweep lights exactly the ranks the graph
draws. (Earlier versions used a trident, then a two-node flowchart; both were
dropped — too on-the-nose, then too generic.)

## Regenerate

```bash
# diagrams (SVG + Unicode), then strip the web-font @import (see git history for the one-liner)
bun run bin/am.ts render mockups/diagrams/workflow.mmd --format svg > mockups/diagrams/workflow.svg

# gallery tiles, families table, and the mockup agent-surface files — all generated
# from the family registry (src/agent/families.ts), the editor examples, and the
# `am` CLI. Re-run when a diagram family is added and it shows up everywhere.
bun run mockups/site-gen.ts

# production static site under website/public, ready for Wrangler
bun run website
bun run website:check
bun run website:dev

# page stills → mockups/shot-<page>-{light,dark,mobile}.png
bun run mockups/shot.ts

# states sheet + motion filmstrips → shot-states-{light,dark}.png, shot-motion-{theme,entrance}.png
bun run mockups/record.ts

# living-mark shader filmstrip → shot-shader.png, shot-shader-context.png
bun run mockups/shader.ts

# the Tufte Max experiment → shot-tufte-max.png
bun run mockups/tufte-shot.ts
```
