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
| FillStrategy | `none`, `hachure`, `crosshatch`, `stipple` (blue-noise), `halftone`, `wash` (glaze + edge-darkening), `scribble` | **rough.js** for `hachure`/`crosshatch`/`dots`; native for `stipple`/`halftone`/`wash`/`scribble` |
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

```ts
interface StyleSpec {
  name: string; label: string;
  stroke: StrokeRef; fill: FillRef; backdrop: BackdropRef; compositor?: CompositorRef;
  palette?: Partial<DiagramColors>;     // composes with the user's theme
  font?: string;                        // composes with --font
  params: Record<string, number|string|boolean>;   // roughness, gap, brushWidth…
}
registerStyle(spec)               // third-party styles register here
getStyle(name): ResolvedStyle
```

Mirror the existing `THEMES` record in `theme.ts`: styles are data, hot-swappable,
and a JSON schema can validate externally shipped styles. The prototype's
`styles.ts` is exactly this table (13 entries) in flattened form.

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

## 7. Determinism & testing

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

## 8. Fonts

Styles name a font (`Caveat`, `EB Garamond`, …) threaded through the existing
`--font` CSS variable. For PNG via **resvg (no web-font fetch)** the TTF must be
bundled in `assets/fonts/` and `embedFontImport:false` set (already supported).
Ship OFL fonts only; record provenance. Browser SVG keeps the `@import`.

---

## 9. Substrate & capability negotiation

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

## 10. Phasing

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

## 11. Risks

- **IR refactor surface.** Touching every family emitter is the main cost.
  Mitigation: IR shape is small; crisp renderer validates equivalence per family.
- **resvg performance** on heavy grain/displacement at PNG scale. Mitigation:
  baked-grain fallback; cap mark counts (stipple already capped at 1400/region).
- **Visual noise at small sizes** (seen in dense diagrams). Mitigation:
  "indication" + tone floors tuned per role; scale-aware density (Praun's TAM
  coherence-across-scales is the principled fix).

---

## 12. References

- Winkenbach & Salesin, *Computer-Generated Pen-and-Ink Illustration*, SIGGRAPH '94.
- Praun, Hoppe, Webb, Finkelstein, *Real-Time Hatching*, SIGGRAPH 2001 (Tonal Art Maps).
- Secord, *Weighted Voronoi Stippling*, NPAR 2002.
- Hertzmann, *A Survey of Stroke-Based Rendering*, IEEE CG&A 2003.
- Curtis, Anderson, Seims, Fleischer, Salesin, *Computer-Generated Watercolor*, SIGGRAPH '97.
- Xie et al., *Artist Agent: RL for Oriental Ink Painting*, 2012; *Contour-driven Sumi-e rendering*.
- Shihn, *The Algorithms behind Rough.js* (2020); AbdulMassih et al., *Mimicking Hand-Drawn Pencil Lines*.
```
