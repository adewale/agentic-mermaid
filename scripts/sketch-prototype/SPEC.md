# Hand-rendered (NPR) styles for agentic-mermaid — build specification

Status: design spec (prototype lives alongside in `scripts/sketch-prototype/`).
Goal: make diagram *aesthetic* a first-class, pluggable dimension — hand-drawn,
pen-and-ink, Tufte, brush, sumi-e, blueprint, watercolor, stipple, comic,
chalkboard, woodcut, risograph, crayon, … — across **all** diagram families,
without disturbing layout, routing, the agent API, or the golden-test contract.

This document specifies the production design. The prototype proves feasibility
(13 styles × 12 diagram types, byte-deterministic, resvg/PNG-safe) but takes a
shortcut — it post-processes finished SVG with regexes. The production design
pushes the same model *into* the renderer instead.

---

## 1. Principles

1. **Aesthetic is orthogonal to layout and to colour.** Layout (ELK + family
   layouts), semantics (the parsed model), and palette (`theme.ts` CSS vars)
   stay untouched. A style only changes *how a primitive is drawn* and *what the
   page looks like*. Therefore: **any style × any palette × any diagram type.**
2. **A style is data, composed of four strategies.** No new code path per style.
3. **Tone is a channel, not a colour.** Shading is built from stroke density,
   dot density/size, or layered washes — per the NPR literature — not from alpha
   guesses. See §5.
4. **Determinism is sacred.** The repo is snapshot/golden/mutation tested. Every
   stochastic mark is produced by a seeded PRNG keyed on stable identifiers.
   `Math.random()`/`Date` are forbidden in the render path.
5. **Substrate-aware.** Output must rasterize identically under resvg (PNG) as it
   displays in a browser; degrade filter-only effects gracefully (§9).

---

## 2. Current architecture (recap)

```
source ──parse──► model ──layout──► PositionedGraph ──renderSvg()──► SVG string
                                              (per family: renderSequenceSvg, …)
                          ▲                          │
                     theme.ts (CSS vars)      inlineResolvedColors() (resvg-safe)
```

The leaf emitters in `src/renderer.ts` (`renderRect`, `renderRoundedRect`,
`renderDiamond`, `renderCircle`, `renderHexagon`, `renderCylinder`, `renderEdge`,
`renderGroup`, arrow `<marker>` defs …) each produce **one crisp SVG element**.
Family renderers (`src/sequence/`, `src/class/`, `src/er/`, …) have their own
analogous emitters. `resolveRenderStyle()` in `src/styles.ts` already turns
`RenderOptions.style` into a resolved style object — the natural hook for adding
an aesthetic selector.

Where the prototype falls short: regex post-processing can't see semantics
(role, tone, z-order), mishandles `<path>`-based shapes (pie wedges, cylinders),
re-implements clipping crudely, and double-pays for SVG it then rewrites.

---

## 3. Target architecture

Introduce a thin **Drawable IR** between "renderer knows geometry+semantics" and
"SVG bytes", and a **StyleEngine** that consumes it.

```
model + layout ─► Drawable[] (semantic primitives) ─► StyleEngine(style) ─► SVG
                                                          ▲
                                       4 strategies: stroke · fill · backdrop · postfx
```

### 3.1 Drawable IR (`src/render-ir.ts`)

The renderer emits primitives instead of strings:

```ts
type Drawable =
  | { kind: 'region'; path: Outline; role: NodeRole; tone: number; hue?: string; z: number; id: string }
  | { kind: 'connector'; path: Polyline; lineStyle: 'solid'|'dotted'|'thick'|'invisible';
      startMarker?: Marker; endMarker?: Marker; id: string }
  | { kind: 'label'; text: string; x: number; y: number; anchor; font; weight; role }
  | { kind: 'divider'; a: Point; b: Point; role }      // class member rules, ER separators
  | { kind: 'glyph'; ... }                              // icons, seals, milestone diamonds

type Outline = { contour: Point[]; holes?: Point[][]; corner?: number }  // closed
```

- `role` (e.g. `node`, `group-header`, `actor`, `lifeline`, `pie-slice`,
  `bar`, `axis`) lets strategies make role-aware choices (don't hachure a
  lifeline; do hatch a node).
- `tone ∈ [0,1]` and optional `hue` are computed once, semantically (§5).
- `z` preserves paint order for correct stroke clipping (§6, "indication").

Every family renderer produces `Drawable[]`. This is the only invasive change,
but it is mechanical and shared: the crisp renderer becomes a default
`StrokeRenderer` consuming the same IR, so behaviour is preserved exactly.

### 3.2 The four strategies (`src/styles/strategies.ts`)

```ts
interface StrokeRenderer { open(p: Polyline, ctx): string; closed(o: Outline, ctx): string }
interface FillStrategy   { fill(o: Outline, tone: number, hue: string|undefined, ctx): string }
interface Backdrop       { draw(w: number, h: number, ctx): string }
interface Compositor     { defs(ctx): string; palette(base: DiagramColors): DiagramColors;
                           wrap(svg: string, ctx): string }      // filters, grain, misregistration
```

Built-ins (in the prototype today across `engine.ts` + `rough-adapter.ts`):

| Strategy | Variants | Engine |
|---|---|---|
| StrokeRenderer | `crisp`, `jittered` (damped-bow double stroke), `pencil` (overshoot + displacement), `brush` (tapered ribbon) | **rough.js** for `jittered`/`pencil` & arbitrary paths; native for `brush` |
| FillStrategy | `none`, `hachure`, `crosshatch`, `stipple` (blue-noise), `halftone`, `wash` (glaze + edge-darkening), `scribble`, `solid` (flat spot-colour, screenprint) | **rough.js** for `hachure`/`crosshatch`/`dots`; native for the rest |
| Backdrop | `plain`, `paper-ruled`, `grid`, `slate`, `rice`, `washi` | native |
| Compositor | palette + optional `blur`/`grain`/`glow`/`misregister` | native |

#### rough.js as the default stroke/hatch engine

The prototype uses **rough.js** (`roughjs/bin/generator`, the headless API — no
DOM/canvas) as the default `StrokeRenderer` for `jittered`/`pencil` and the
default `FillStrategy` for `hachure`/`crosshatch`/`dots`. We call
`gen.polygon/linearPath/path(...)`, then serialize the returned **OpSets** with
`gen.opsToPath()` into our own `<path>` elements (`rough-adapter.ts`), keeping
control of attributes (CSS-var theming, filters) and resvg-safety.

Why it earns its place:
- **Arbitrary `<path>` coverage.** `gen.path(d, …)` roughens *any* SVG path —
  pie wedges, cylinders, curved chart series, rounded headers — which the
  regex-only prototype left un-styled. This is the single biggest correctness
  win; the poster's pie/xy columns are now hand-rendered in every style.
- **Mature line model** (length-damped bowing, double stroke, non-meeting
  ellipse endpoints) and a built-in fill repertoire (`hachure`, `cross-hatch`,
  `dots`, `zigzag`, `solid`) mapping straight onto our `FillStrategy` knobs
  (`hachureGap`, `hachureAngle`, `fillWeight`).
- **Determinism.** Every call passes an explicit integer `seed`; rough's PRNG is
  a pure function of it ⇒ byte-stable output (verified). **Pin the rough.js
  version** so seeded geometry can't shift under a dependency bump (treat a bump
  as a golden-fixture change).

What stays native (rough.js can't do these): tone-as-density **ladders**
(Tonal Art Maps), **blue-noise stipple** (Secord), tone-sized **halftone**,
tapered variable-width **brush ribbons** (sumi-e), **watercolor** glaze +
edge-darkening, direction fields, "indication", and the compositing layer
(grain, misregistration, backdrops). rough.js is the sketchy-stroke + basic-hatch
60%; our engine owns the differentiated 40%.

Cost: one small (~native-free, pure-JS) runtime dependency. Acceptable for the
payoff; serialize via OpSets (not RoughSVG) so we never depend on a DOM.

### 3.3 A Style = selection + params (`src/styles/registry.ts`)

The exact authoring surface below was **converged empirically** by iterating 15
styles across all diagram types (the refinement loop). It is the minimum set of
knobs that let a style both *exemplify its reference* and *stay readable*.

```ts
interface StyleSpec {
  name: string; label: string; blurb: string

  // palette — composes with the user's theme (any style × any palette)
  colors: { bg; fg; line; accent; muted; surface; border }
  font: string

  // 1 — STROKE
  stroke: 'crisp' | 'jittered' | 'brush' | 'pencil'
  roughness: number; passes: number; strokeWidth: number
  brushWidth?: number; linecap: 'round'|'butt'; strokeOpacity?: number
  strokeFilter?: string                 // svg filter id (chalk/sumi-bleed/grunge…)

  // 2 — FILL (tone-driven)
  fill: 'none'|'hachure'|'crosshatch'|'stipple'|'halftone'|'wash'|'scribble'|'solid'
  fillColor: string; baseTone: number   // floor shading so shapes aren't empty
  toneFromLuminance: boolean            // derive extra tone from the region's value
  keepHue: boolean                      // fill with the region's own colour (charts)
  hachureAngle: number
  spotPalette?: string[]                // solid: per-region flat spot colour (screenprint)
  fillFilter?: string

  // 3 — BACKDROP
  backdrop: 'plain'|'paper-ruled'|'grid'|'slate'|'rice'|'washi'
  defs?: string                         // custom <filter> defs the style references

  // 4 — COMPOSITOR / effects
  misregister?: number; misColor?: string     // duotone registration offset (riso)
  glowColor?: string; glowOffset?: number      // offset drop-glow behind shapes (latentpop)
  seal?: boolean                               // decorative chop (chinese brush)

  // 5 — READABILITY (WCAG guardrail, §7) + typography
  labelHalo?: string                    // text knockout colour (default: page bg)
  labelInk?: string                     // label colour (default: auto-contrast vs halo)
  textTransform?: 'uppercase'           // e.g. blueprint all-caps lettering
  letterSpacing?: number
  nodeCornerRadius?: number             // rounded boxes (crisp/clean styles)
  boxShadow?: boolean                   // soft drop-shadow under shapes (whiteboard)
}
```

A style may also need **decorative "furniture"** that isn't a per-shape mark —
e.g. the blueprint's border frame + title block, or a red seal. These live in
the `Backdrop` strategy (it gets the page width/height), so the registry exposes
backdrops as first-class, not just flat colours. Authenticity research per style
(pen-and-ink = *no* interior hatching; blueprint = Prussian blue + white lines +
title block; chalkboard = dusty broken strokes; risograph = 2 spot inks +
misregistration + grain; whiteboard = thick translucent marker strokes) is what
drove these surface additions — a custom-style API must expose all of:
backdrop furniture, per-style filter `defs`, spot palettes, registration offset,
text-transform, and the label halo/ink overrides.

```ts
registerStyle(spec)               // third-party styles register here
getStyle(name): ResolvedStyle
```

**Surface lessons from the loop** (what we had to add to make styles exemplary
*and* legible — these are the non-obvious bits a custom-style API must expose):
- `solid` fill + `spotPalette` + `glowColor/Offset` — needed for flat-colour
  screenprint looks (Flux LatentPop); pure hatch/wash can't express them.
- `labelHalo`/`labelInk` — a single page-knockout ink fails when a style fills
  shapes dark (e.g. navy nodes on orange); the override lets labels be
  light-on-dark while staying WCAG-checked.
- Region-size gating (`MIN_FILL_AREA`/`MAX_FILL_AREA`, engine globals) — don't
  shade tiny label boxes (readability) *or* huge background plates / chart plot
  areas (they swamp content). Without the upper cap, gantt/quadrant backgrounds
  drowned the data.
- `strokeFilter`/`fillFilter` + `defs` — per-style SVG filters (chalk dust, ink
  bleed, grunge) are essential to several looks; the registry must allow a style
  to ship its own filter defs.
- `baseTone` + `toneFromLuminance` + `keepHue` — separate "how much default
  shading", "shade by semantic value", and "keep chart colours" — all three are
  needed and independent.
- **Typography + neutrals decide "premium vs ugly".** The Making Software rebuild
  was the clearest lesson: a faithful palette is not enough. The premium read
  came from (a) warm neutrals — `#fafaf9`/`#0c0a09`, never pure `#fff`/`#000`;
  (b) the *right* serif (Fraunces, closest free match to ABC Arizona) not a
  generic one; (c) refined hairlines + rounded corners (`nodeCornerRadius`);
  (d) ONE accent per figure (blue highlight), geometry otherwise monochrome.
  So a custom-style API must expose font *and* corner radius *and* discourage
  pure-black/white, or naive styles look cheap. (Excalidraw needed the inverse
  insight: hachure fill must be a PASTEL distinct from the dark stroke — a
  `spotPalette` on the `hachure` fill, not the ink colour.)
- **Fonts are the gating dependency.** Several styles only land with the right
  bundled TTF (Fraunces, Share Tech Mono, Architects Daughter…). The registry
  needs a font-asset story; resvg/PNG needs real TTFs (woff2 web fonts aren't
  enough). Departure Mono (Making Software's mono) remains a TODO — no OFL TTF
  was retrievable in-sandbox.

Mirror the existing `THEMES` record in `theme.ts`: styles are data, hot-swappable,
and a JSON schema can validate externally shipped styles. The prototype's
`styles.ts` is exactly this table (now 15 entries) in flattened form.


### 3.3a Authoring a custom style (DELIVERABLE: a guide doc)

> **Commitment:** ship `docs/style-authoring.md` — a guide that shows both
> **people and their agents** how to write a style, end to end. It belongs next
> to the existing agent-facing material (`AGENT_NATIVE.md`,
> `Instructions_for_agents.md`, `llms.txt`) and is surfaced to agents via
> `llms.txt` + the `--agent-instructions` CLI output, so an LLM can author a
> style from the docs alone.

What's involved in a custom style — and why it's small — is the whole point of
the architecture: **a style is one data record.** The guide will cover:

1. **Pick the four strategies + a palette + a font.** Choose `stroke`
   (`crisp|jittered|brush|pencil`), `fill`
   (`none|hachure|crosshatch|stipple|halftone|wash|scribble`), `backdrop`, and a
   `compositor`/palette; set the params (`roughness`, `hachureGap`, `brushWidth`,
   `baseTone`, …). No engine code. *Two real examples added this round —
   `flux-latentpop` (screenprint: vivid ground + `halftone` + misregistration +
   grunge filter) and `making-software` (cream + `none` fill + blue accent
   edges + serif) — were each just a `StyleSpec` literal.*
2. **`registerStyle(spec)`** (or drop a JSON file in a styles dir). The contrast
   guardrail (§7) runs automatically; `contrast-audit.ts` tells you pass/fail.
3. **Only write code if you need a *new* strategy variant** (e.g. a novel fill).
   That implements one of the four interfaces in §3.2 and registers it — the
   guide documents each interface contract + the determinism rule (seed in,
   bytes out).
4. **Verify**: run the audit, drop the style into the contact-sheet/poster
   harness, eyeball all 12 diagram types.

The guide will include a copy-paste `StyleSpec` template, the parameter
reference, the determinism/seed contract, the WCAG guardrail behaviour, and a
worked agent prompt ("add a style that looks like X").

### 3.4 Public API

Extend `RenderOptions` (`src/types.ts`) and resolve in `resolveRenderStyle`:

```ts
interface RenderOptions {
  // …existing…
  aesthetic?: string | StyleSpec      // 'hand-drawn' | 'tufte' | custom spec
  seed?: number                        // deterministic re-roll (editor "shuffle")
}
```

Default `aesthetic` = `'crisp'` ⇒ **byte-identical to today** (critical for
existing goldens). Per-element override via Mermaid `:::class` (already parsed
into `classNames`) maps a class → fill/stroke strategy for mixed-media diagrams.

---

## 4. Engine primitives & the literature

The sketchy **stroke + hachure/cross-hatch** marks are produced by **rough.js**
(see §3.2). The primitives below are the *native* additions in `engine.ts` that
rough.js does not provide; production moves them to `src/styles/marks/`. (The
hand-rolled `inkLine`/`inkPolygon` remain as a zero-dependency fallback engine.)

| Primitive | Source idea | Notes |
|---|---|---|
| rough.js generator | rough.js / "Mimicking Hand-Drawn Pencil Lines" | default stroke + hachure/cross-hatch; arbitrary path roughening |
| `inkLine`/`inkPolygon` (fallback) | pencil-line realism | damped-bow, corner overshoot; used if rough.js absent |
| `brushStroke` (tapered ribbon) | sumi-e brush footprint (Xie et al.; contour-driven sumi-e) | filled outline, half-width = pressure(t) |
| `tonalHachure` | Winkenbach & Salesin; Praun et al. Tonal Art Maps | tone → gap + #directions (1→2→3) |
| `hachureLines` (scanline, rotated) | Winkenbach & Salesin (BSP clip → scanline) | clip parallel lines to region |
| `stipple` (blue-noise, count ∝ tone) | Secord, Weighted Voronoi Stippling | best-candidate sampler; Lloyd relaxation = future upgrade |
| `halftone` (radius ∝ tone) | Ben-Day / classic halftone | regular rotated grid |
| `watercolorWash` (glaze + edge-darkening) | Curtis et al., Computer-Generated Watercolor | fake of layered glazes + pigment pooling |
| `blueNoise` | blue-noise sampling | replaces white-noise jitter → organic, non-clumping |

Planned upgrades (deferred, noted for completeness):
- **Direction fields** for hachure/brush (`directionAt(p)→angle`): curvature- or
  axis-aligned hatching (Praun) — small interface, big expressive gain.
- **Lloyd relaxation** on stipple points for even blue-noise.
- **Indication** (Winkenbach/Salesin): hatch only an edge band, not the whole
  region — needs the `z`-ordered IR to clip against occluders.
- **Kubelka–Munk** pigment compositing for true watercolor layering.

---

## 5. Tone derivation

Compute `tone ∈ [0,1]` per region **once, from semantics**, not from pixels:

```
tone = clamp( baseTone(style)
            + roleWeight(role)          // group-header darker, de-emphasized lighter
            + emphasis(inlineStyle)     // user `style`/`classDef` fills
            + valueChannel(chart) )     // pie/xy/journey value → tone
```

The prototype approximates this from the rendered fill's luminance
(`toneFromLuminance`), which is the regex shortcut; with the IR it comes straight
from the model. `keepHue` styles (watercolor) carry the region's `hue` into the
fill so charts stay colourful while every other style reads monochrome.

---

## 6. Clipping & paint order

Strategies emit marks that must be **clipped to the region** and **occluded by
nearer regions**. Production options, cheapest first:
1. SVG `clipPath` per region (works in resvg) — simplest, correct.
2. Scanline clip already used by hachure; extend to subtract holes/occluders
   (the Winkenbach/Salesin BSP generalization) for "indication".
Paint order = `z` from the IR (groups < edges < nodes < labels), matching the
existing `renderSvg` back-to-front ordering.

---

## 7. Readability & contrast (WCAG math only)

We borrow **only the math** from WCAG — relative luminance + contrast ratio +
the threshold constants (`contrast.ts`, ~40 lines, zero deps). No ARIA, no
conformance framework. (The renderer already injects `<title>/<desc>`/ARIA in
`index.ts`; that stays as-is.) Three uses, all as a render-time guardrail:

1. **Knock text out to the page (halo), then contrast vs the page.** Every label
   gets a page-coloured `paint-order:stroke` halo, so the glyph never sits
   directly on a fill (solid spot colour, dense hachure, dots…) — the page shows
   through behind it. The ink is then chosen to clear **4.5:1** against the
   *page* (the surface the halo reveals), which makes one ink choice valid
   regardless of what's painted behind. This sidesteps the impossible case where
   a region's fill spans light *and* dark spot colours. `adjustToContrast` nudges
   the ink toward black/white, preserving hue as far as possible. (Large text
   gets the 3:1 allowance, which our enlarged labels already satisfy.)
2. **Don't shade tiny regions.** Fills are skipped below `MIN_FILL_AREA`
   (edge/transition-label boxes, micro-nodes) — an "indication"-style guard so
   small labels stay on clean ground. Heavy fills are also tone-capped.
3. **Non-text contrast.** Strokes/borders vs page are checked against **3:1**
   (WCAG 1.4.11); weak palettes can be auto-bumped. Exposed as opt-in so
   deliberately low-contrast styles (Tufte's faint rules) aren't overridden.

Plus **1.4.1 Use of Color**: meaning never rests on hue alone — our styles
already differentiate by shape/texture (hachure vs stipple vs dots), so a
monochrome or colour-blind viewer still reads structure; hue-led charts (pie)
keep texture + labels.

**Testable property.** `contrast-audit.ts` runs the two ratios for every style
and exits non-zero on any failure, so readability gates CI like a golden test.
Current status: all 15 styles PASS (text ≥4.5:1, non-text ≥3:1; Tufte's faint
rules exempted by design). In production the same check runs per
style × diagram-role over the IR.

---

## 8. Determinism & testing

- **Seed contract:** `seed(drawable) = hash(options.seed, drawable.id, role, markIndex)`.
  All randomness flows from `makeRng(seed)` (mulberry32). Verified: the prototype
  is byte-identical across runs for all 13 styles.
- **Goldens:** add SVG fixtures per (style × representative diagram). Because
  output is deterministic, these are stable. Default `crisp` reuses existing
  fixtures unchanged.
- **Contact sheet / poster:** promote `scripts/sketch-prototype/poster.ts` to the
  visual-regression surface, slotting into `characterization:check`.
- **Mutation tests:** add a `stryker.styles.config.json` targeting the mark
  primitives (they're pure and well-isolated — ideal mutation targets).

---

## 9. Fonts

Styles name a font (`Caveat`, `EB Garamond`, …) threaded through the existing
`--font` CSS variable. For PNG via **resvg (no web-font fetch)** the TTF must be
bundled in `assets/fonts/` and `embedFontImport:false` set (already supported).
Ship OFL fonts only; record provenance. Browser SVG keeps the `@import`.

---

## 10. Substrate & capability negotiation

| Effect | Browser SVG | resvg/PNG | Fallback |
|---|---|---|---|
| paths, hachure, stipple, halftone, ribbons | ✓ | ✓ | — |
| `feGaussianBlur` (bleed) | ✓ | ✓ | reduce stdDeviation |
| `feTurbulence` grain (paper/slate/wax) | ✓ | ✓ (slower) | bake a tiled PNG grain |
| `feDisplacementMap` (chalk/crayon) | ✓ | ✓ | skip → plain stroke |
| `mix-blend-mode` (riso overprint) | ✓ | ✗ | manual offset duplicate (prototype does this) |

Each `Compositor` declares `requires: Capability[]`; the renderer picks the
fallback when targeting PNG. Reuse the existing browser-vs-resvg plumbing
(`inlineResolvedColors`, strict-security `stripExternalRefs`).

**Cross-substrate bonus:** the Drawable IR + tone channel can also drive the
existing **ASCII** renderer (tone → shading glyph density) and a future
canvas/WebGL backend — the IR is the unification point.

---

## 11. Phasing

1. **IR + crisp StrokeRenderer for flowchart** behind `aesthetic:'crisp'`,
   asserting byte-identical output vs today (safety net).
2. **Adopt rough.js** (pinned) as the `jittered`/`pencil` stroke + `hachure`/
   `crosshatch`/`dots` fill engine, incl. arbitrary-path roughening; ship
   `hand-drawn`, `pen-and-ink`, `tufte` with tone. Add goldens + poster row.
3. **`brush`/`wash`/`stipple`/`halftone`** → ship the remaining styles.
4. **Extend IR to each family** (sequence, class, er, …) one at a time; the
   prototype already shows all families survive the transform, so this is
   incremental, not speculative.
5. **Direction fields, indication, Lloyd relaxation, K–M watercolor** as polish.

---

## 12. Risks

- **IR refactor surface.** Touching every family emitter is the main cost.
  Mitigation: IR shape is small; crisp renderer validates equivalence per family.
- **resvg performance** on heavy grain/displacement at PNG scale. Mitigation:
  baked-grain fallback; cap mark counts (stipple already capped at 1400/region).
- **Visual noise at small sizes** (seen in dense diagrams). Mitigation:
  "indication" + tone floors tuned per role; scale-aware density (Praun's TAM
  coherence-across-scales is the principled fix).

---

## 13. Community signal & upstream contribution

**What users actually ask for** (Mermaid.js + Beautiful-Mermaid issue trackers):
1) hand-drawn/sketch look (Mermaid #1886 → shipped `look: handDrawn`; ongoing
tuning), 2) custom/unified CSS-variable theming, 3) dark mode, 4) per-element
colour, 5) fonts. So this work targets the #1 ask, and the orthogonal
style×theme design matches the #2 expectation.

**Lessons from Mermaid Chart's "new looks" launch + its reception:**
- Readability/contrast is the loudest *real* complaint (esp. dark mode) — not
  style taste. Our WCAG guardrail (§7) is therefore core, not cosmetic.
- Apply every look uniformly across *all* diagram types; partial coverage that
  silently fails (e.g. handDrawn on packet diagrams) erodes trust — gate
  unsupported combos instead.
- Decouple look (geometry/stroke) from theme (colour); let them compose.
- Default to the polished/precise look; position hand-drawn as informal.
- Per-diagram opt-in via inline metadata; keep a stable "classic" default.

**Beautiful-Mermaid #115/#116 → file a separate issue.** #115 (open) reports
unreadable labels on custom fills; PR #116 (open) fixes it with a BT.601
brightness flip. Our guardrail is a strict superset: WCAG relative-luminance +
contrast *ratios* (4.5:1 text / 3:1 non-text), per-style halo/ink overrides, and
a CI audit. Recommendation: open a standalone proposal — *"WCAG contrast-based
label-inking guardrail (4.5:1 text / 3:1 stroke), generalizing #115/#116"* —
cross-linked to #115/#116 (offer #116 as a fast partial fix), rather than
scope-creeping their PR. (`contrast.ts` + `contrast-audit.ts` are the reference
implementation.)

---

## 14. References

- Winkenbach & Salesin, *Computer-Generated Pen-and-Ink Illustration*, SIGGRAPH '94.
- Praun, Hoppe, Webb, Finkelstein, *Real-Time Hatching*, SIGGRAPH 2001 (Tonal Art Maps).
- Secord, *Weighted Voronoi Stippling*, NPAR 2002.
- Hertzmann, *A Survey of Stroke-Based Rendering*, IEEE CG&A 2003.
- Curtis, Anderson, Seims, Fleischer, Salesin, *Computer-Generated Watercolor*, SIGGRAPH '97.
- Xie et al., *Artist Agent: RL for Oriental Ink Painting*, 2012; *Contour-driven Sumi-e rendering*.
- Shihn, *The Algorithms behind Rough.js* (2020); AbdulMassih et al., *Mimicking Hand-Drawn Pencil Lines*.
```
