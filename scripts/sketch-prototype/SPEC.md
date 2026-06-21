# Hand-rendered (NPR) styles for agentic-mermaid — build specification

Status: design spec (prototype lives alongside in `scripts/sketch-prototype/`).
Goal: make diagram *aesthetic* a first-class, pluggable dimension — hand-drawn,
pen-and-ink, Tufte, brush, sumi-e, blueprint, watercolor, stipple, comic,
chalkboard, woodcut, risograph, crayon, … — across **all** diagram families,
without regressing semantics, routing, interaction, accessibility, the agent API,
or the golden-test contract.

This document specifies the production design. The prototype proves feasibility
(27 styles × 12 diagram types, byte-deterministic, resvg/PNG-safe) but takes a
shortcut — it post-processes finished SVG with regexes. The production design
pushes the same model *into* the renderer instead.

---

## 1. Principles

1. **Separate appearance, layout metrics, and rendering dialects.** Paint-only
   styles can be orthogonal to layout; most serious styles are not. Fonts,
   padding, marker dimensions, stroke overshoot, effect bounds, and minimum
   feature size must resolve before final layout. A few aesthetics (terminal
   grids, transit lattices, PCB traces, codex registers) are full rendering
   dialects with explicit layout hooks and graceful fallbacks. Colour still
   composes through theme tokens where possible: **any appearance × any palette
   × any diagram type**, bounded by the selected dialect's contract.
2. **A style is data that selects a backend, assets, and parameters.** No new
   code path for a typical appearance style; only new capabilities or trusted
   dialect plugins add backend code.
3. **Semantic channels survive styling.** `tone` is a derived rendering channel,
   not the only semantic channel. Importance, category, status, value, progress,
   uncertainty, route/net identity, emphasis, and selection must remain
   independent so styles can map them to texture, stroke, fill, hue, size, or
   annotation without collapsing meaning.
4. **Determinism is sacred.** The repo is snapshot/golden/mutation tested. Every
   stochastic mark is produced by a seeded PRNG keyed on stable identifiers and
   named random substreams.
   `Math.random()`/`Date` are forbidden in the render path.
5. **Substrate-aware.** Browser SVG, static SVG, PNG/resvg, ASCII, and future
   Canvas/WebGL backends must preserve the same diagram semantics where the
   substrate supports them. Static export explicitly loses interaction while
   preserving accessibility metadata and bounded visual equivalence; filter-only
   effects degrade gracefully (§10).

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

Introduce a proper post-layout **SceneGraph IR** between each family's
positioned layout result and "SVG bytes", plus a **StyleBackend** interface that
consumes it. This is a render-mark IR, not a universal layout model: family
parsers, layout algorithms, certificates, and `Positioned*` types remain
family-specific. The new waist sits at the existing render-family hook layer:
public SVG rendering dispatches through the family registry, each family lowers
its positioned result to SceneGraph marks, and the selected backend serializes
those marks.

The current Agentic Mermaid crisp renderer is implemented by `DefaultBackend`
(selected by public `aesthetic:'crisp'`); rough.js is implemented by
`RoughBackend`; pressure-sensitive freehand strokes are a native `HybridBackend`
capability. They are peers behind the same semantic contract, not "default SVG"
plus an after-the-fact effect.

```
source ─► family hook ─► style/color resolution ─► layout metrics ─► family layout ─► positioned result
                                  │                  ▲
                                  └─ assets/fonts ───┘

positioned result ─► family SceneGraph lowering ─► StyleBackend ─► SVG/PNG
                              ▲                         ▲
                              └─ roles · channels · metadata
```

Stable abstraction waists:
- `FamilyLayoutContext`: source, options, render options, and resolved colors
  enter a family-specific layout hook without forcing a body-only layout model.
- `PositionedDiagram`: the common minimum for laid-out family results; concrete
  positioned types remain specialized.
- `SceneGraph`: the post-layout semantic render-mark tree.
- `ResolvedElementStyle`: the already-resolved cascade attached to scene nodes.
- `StyleBackend`: family-agnostic mark serialization and composition.

Style packs must not widen these waists by smuggling family-specific layout
logic into backend parameters. If a style needs layout-aware behavior
(`terminal`, `transit`, `pcb`), it declares that capability as a family hook or
layout hint with testable rubric constraints.

### 3.1 SceneGraph IR (`src/render-ir.ts`)

The renderer emits a scene tree instead of strings. It must preserve native
geometry, grouping, transforms, clipping, accessibility, interaction, and
semantic channels; it must not eagerly flatten all geometry into point contours.

```ts
type SceneNode =
  | GroupNode
  | ShapeNode
  | ConnectorNode
  | TextNode
  | SymbolNode
  | InteractionNode

interface SceneNodeBase {
  id: string
  role: SceneRole                         // node, actor, lifeline, pie-slice, axis, ...
  parentId?: string
  z: number
  transform?: Matrix
  clip?: Geometry
  channels: SemanticChannels
  style: ResolvedElementStyle             // classDef + inline style + theme/style cascade
  metadata: {
    classes?: string[]
    data?: Record<string, string>
    accessibility?: AccessibilityInfo     // title, desc, aria, reading order
    interaction?: InteractionInfo         // links, tooltips, hover/focus, hit target ids
  }
}

type Geometry =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx?: number; ry?: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'polygon'; points: Point[]; winding?: 'nonzero' | 'evenodd' }
  | { kind: 'path'; segments: PathSegment[]; d?: string; fillRule?: 'nonzero' | 'evenodd' }
  | { kind: 'compound'; children: Geometry[]; fillRule?: 'nonzero' | 'evenodd' }

interface ShapeNode extends SceneNodeBase { kind: 'shape'; geometry: Geometry }
interface ConnectorNode extends SceneNodeBase {
  kind: 'connector'
  geometry: { kind: 'polyline' | 'path'; points?: Point[]; segments?: PathSegment[] }
  lineStyle: 'solid' | 'dotted' | 'thick' | 'invisible'
  startMarker?: Marker
  endMarker?: Marker
  routeId?: string
  junction?: boolean
}
interface TextNode extends SceneNodeBase {
  kind: 'text'
  runs: TextRun[]                         // preserves <tspan>, emphasis, code, syntax colour
  box: TextBox
}
```

- `role` (e.g. `node`, `group-header`, `actor`, `lifeline`, `pie-slice`,
  `bar`, `axis`) lets backends make role-aware choices (don't hachure a
  lifeline; do hatch a node).
- `channels` preserve typed meaning (§5); `tone` and `hue` are derived outputs,
  not the whole semantic model.
- `z` preserves paint order for correct stroke clipping (§6, "indication").
- Native path segments remain native until a backend asks for flattening; that
  request must include an explicit tolerance and coordinate space.
- Composite diagram constructs remain groups: cylinders, double circles,
  subroutines, class compartments, sequence activations, chart series, labels,
  accessibility nodes, and transparent hit targets are not split into unrelated
  flat drawables.
- Visual geometry, interaction geometry, and accessibility geometry are
  distinct. A stipple cloud or hachure fill must not become the hover/focus
  target; the original semantic hit area survives as an `InteractionNode`.

Every built-in family renderer produces a `SceneGraph`. This is the main
invasive change, but it is mechanical and shared: the crisp renderer becomes
the default `StyleBackend` consuming the same IR, so behaviour is preserved
exactly. The migration should happen as one coordinated all-family milestone,
not as an indefinitely mixed production state: every built-in family must have
a SceneGraph lowering, default-backend rendering, preservation fixtures, and
registry coverage before the new production path becomes the default.

This builds on the post-rebase `render-family-hooks.ts` architecture instead of
creating a parallel renderer stack. The family registry remains the dispatch
waist; SceneGraph lowering is a new registered render operation beside
`layout`, `renderSvg`, and `renderAscii`. ASCII may receive semantic channels
later, but its grid/A* geometry remains output-specific.

### 3.2 Style backends (`src/styles/backends.ts`)

```ts
interface StyleBackend {
  id: 'default' | 'rough' | 'hybrid' | string
  capabilities: Capability[]
  resolveAssets?(style: StyleSpec, target: RenderTarget): AssetResolution
  layoutHints?(style: StyleSpec, metrics: FontMetrics): LayoutHints
  drawShape(d: ShapeNode, ctx: StyleContext): SvgChunk
  drawConnector(d: ConnectorNode, ctx: StyleContext): SvgChunk
  drawMarker(m: Marker, ctx: StyleContext): SvgChunk
  drawText(d: TextNode, ctx: StyleContext): SvgChunk
  drawGroup?(d: GroupNode, ctx: StyleContext): SvgChunk
  drawInteraction?(d: InteractionNode, ctx: StyleContext): SvgChunk
  drawBackdrop(w: number, h: number, ctx: StyleContext): SvgChunk
  compose(chunks: SvgChunk[], ctx: StyleContext): SvgDocument
}
```

The stroke/fill/backdrop/postfx breakdown is still useful authoring vocabulary,
but those pieces are backend internals now: they are knobs a backend
may expose, not the top-level architecture. This keeps `DefaultBackend`,
`RoughBackend`, and `HybridBackend` honest: all must preserve labels, markers,
ARIA/title/desc, classes, IDs, links, tooltips, hit targets, themes, security
mode, determinism, and static-export compatibility through the same interface.
Backends do not dispatch on diagram family; family-specific knowledge ends at
the SceneGraph lowering hook.

Built-in backends:

| Backend | Role | Notes |
|---|---|---|
| `DefaultBackend` (`id:'default'`) | Agentic Mermaid crisp SVG | Byte-identical default path selected by `aesthetic:'crisp'`; owns precise SVG primitives, current themes, markers, labels, and accessibility. |
| `RoughBackend` (`id:'rough'`) | rough.js-backed sketch geometry | Uses rough.js OpSets for sketchy lines, polygons, ellipses, arbitrary paths, hachure/cross-hatch/dots; Agentic Mermaid still owns semantics and output guarantees. |
| `HybridBackend` (`id:'hybrid'`) | rough/native NPR composition | Delegates sketch strokes/fills to `RoughBackend`, then adds native marks rough.js does not provide: watercolor, blue-noise stipple, halftone, perfect-freehand ribbons, brush ribbons, grain, misregistration, label halos. |

#### rough.js as the foundational non-crisp backend

The prototype uses **rough.js** (`roughjs/bin/generator`, the headless API — no
DOM/canvas) as the implementation of the `rough` backend. We call
`gen.polygon/linearPath/path(...)`, then serialize the returned **OpSets** with
`gen.opsToPath()` into our own `<path>` elements (`rough-adapter.ts`), keeping
control of attributes (CSS-var theming, markers, filters, ARIA, strict mode) and
resvg-safety.

Why it earns its place:
- **Arbitrary `<path>` coverage.** `gen.path(d, …)` roughens *any* SVG path —
  pie wedges, cylinders, curved chart series, rounded headers — which the
  regex-only prototype left un-styled. This is the single biggest correctness
  win; the poster's pie/xy columns are now hand-rendered in every style.
- **Mature line model** (length-damped bowing, double stroke, non-meeting
  ellipse endpoints) and a built-in fill repertoire (`hachure`, `cross-hatch`,
  `dots`, `zigzag`, `solid`) mapping straight onto `rough` backend params
  (`hachureGap`, `hachureAngle`, `fillWeight`).
- **Determinism.** Every call passes an explicit integer `seed`; rough's PRNG is
  a pure function of it ⇒ byte-stable output (verified). **Pin the rough.js
  version exactly** so seeded geometry can't shift under a dependency bump (treat
  a bump as a golden-fixture change).

What stays native (rough.js can't do these): tone-as-density **ladders**
(Tonal Art Maps), **blue-noise stipple** (Secord), tone-sized **halftone**,
tapered variable-width **perfect-freehand ribbons** (pressure-sensitive
centerline → filled outline polygon), **brush ribbons** (sumi-e),
**watercolor** glaze + edge-darkening, direction fields, "indication", and the
compositing layer (grain, misregistration, backdrops). Those are implemented as
`HybridBackend` extensions, not as a competing rendering architecture.

Cost: one small (~native-free, pure-JS) runtime dependency. Acceptable for the
payoff; serialize via OpSets (not RoughSVG) so we never depend on a DOM.

### 3.3 A Style = selection + params (`src/styles/registry.ts`)

The exact authoring surface below was **converged empirically** by iterating the
current 27-style prototype across all diagram types (the refinement loop). It is
the minimum set of knobs that let a style both *exemplify its reference* and
*stay readable*.

```ts
interface StyleSpec {
  name: string; label: string; blurb: string
  backend: 'default' | 'rough' | 'hybrid'
  intent: 'premium' | 'draft' | 'lofi'
  density: 'delicate' | 'normal' | 'bold'
  capabilities?: Capability[]
  layoutTier?: 'backend' | 'semantic-hooks' | 'layout-aware'

  // palette — composes with the user's theme (any style × any palette)
  colors: { bg; fg; line; accent; muted; surface; border }
  font: FontSpec

  // backend params — interpreted by the selected backend
  stroke: 'crisp' | 'jittered' | 'brush' | 'pencil' | 'freehand'
  roughness: number; passes: number; strokeWidth: number
  bowing?: number
  brushWidth?: number; linecap: 'round'|'butt'; strokeOpacity?: number
  strokeFilter?: string                 // svg filter id (chalk/sumi-bleed/grunge…)
  freehand?: {
    size: number                         // perfect-freehand base diameter
    thinning: number
    smoothing: number
    streamline: number
    simulatePressure: boolean
    pressureFrom: 'constant' | 'geometry' | 'tone' | 'role'
    start?: { cap: boolean; taper: number | true }
    end?: { cap: boolean; taper: number | true }
    flattenSelfIntersections?: boolean
  }

  // fill params — tone-driven, rendered by the selected backend
  fill: 'none'|'hachure'|'crosshatch'|'stipple'|'halftone'|'wash'|'scribble'|'solid'
  fillColor: string; baseTone: number   // floor shading so shapes aren't empty
  toneFromLuminance: boolean            // derive extra tone from the region's value
  keepHue: boolean                      // fill with the region's own colour (charts)
  hachureAngle: number; hachureGap?: number; fillWeight?: number
  spotPalette?: string[]                // solid: per-region flat spot colour (screenprint)
  fillFilter?: string

  // backdrop + compositor
  backdrop: 'plain'|'paper-ruled'|'grid'|'slate'|'rice'|'washi'
  defs?: string                         // trusted-plugin only; data packs use safe named defs

  misregister?: number; misColor?: string     // duotone registration offset (riso)
  glowColor?: string; glowOffset?: number      // offset drop-glow behind shapes (latentpop)
  seal?: boolean                               // decorative chop (chinese brush)

  // readability (WCAG guardrail, §7) + typography
  labelHalo?: string                    // text knockout colour (default: page bg)
  labelInk?: string                     // label colour (default: auto-contrast vs halo)
  textTransform?: 'uppercase'           // e.g. blueprint all-caps lettering
  letterSpacing?: number
  nodeCornerRadius?: number             // rounded boxes (crisp/clean styles)
  boxShadow?: boolean                   // soft drop-shadow under shapes (whiteboard)
  mono: boolean                         // enforce §3.8's one-ink/tone contract
}

interface FontSpec {
  family: string
  fallback: string[]
  asset?: {
    kind: 'bundled' | 'external-reviewed' | 'system'
    path?: string
    url?: string
    license: string
    provenance: string
    requiredForPng: boolean
  }
  metrics: 'asset' | 'fallback-compatible' | 'system'
}
```

`defs` is intentionally marked as a trusted-plugin escape hatch. External JSON
style packs use a constrained schema of named filters/backdrops/assets with
generated, namespaced IDs. They cannot inject arbitrary XML, CSS, scripts,
external URLs, or duplicate IDs; that boundary must integrate with Mermaid's
strict security mode and existing SVG ID namespacing.

A style may also need **decorative "furniture"** that isn't a per-shape mark —
e.g. the blueprint's border frame + title block, or a red seal. These live in
the backend's `drawBackdrop` step (it gets the page width/height), so the
registry exposes backdrops as first-class, not just flat colours. Authenticity
research per style
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
- **Fonts are a design dependency, not a prototype-asset dependency.** Several
  looks only land with the right typeface, and fonts affect text metrics, so
  asset resolution must happen before layout. The prototype's local TTFs are
  research/evidence fixtures, not production resources. A production style
  registry needs an explicit font-asset policy; it must not lift TTFs, PNGs,
  SVGs, or other resources from `scripts/sketch-prototype/`. If production needs
  a new bundled asset, add it through the normal asset path with reviewable
  licensing/provenance instead of promoting the prototype copy.

Mirror the existing `THEMES` record in `theme.ts`: styles are data, hot-swappable,
and a JSON schema can validate externally shipped styles. The prototype's
`styles.ts` is a flattened feasibility table, not the production registry.


### 3.3a Authoring a custom style (DELIVERABLE: a guide doc)

> **Commitment:** ship `docs/style-authoring.md` — a guide that shows both
> **people and their agents** how to write a style, end to end. It belongs next
> to the existing agent-facing material (`AGENT_NATIVE.md`,
> `Instructions_for_agents.md`, `llms.txt`) and is surfaced to agents via
> `llms.txt` + the `--agent-instructions` CLI output, so an LLM can author a
> style from the docs alone.

What's involved in a custom style — and why it's small — is the whole point of
the architecture: **a typical style is one data record selecting a backend and
parameters.** The guide will cover:

1. **Pick a backend + params + palette + font asset.** Choose `backend`
   (`default|rough|hybrid`), then the backend params (`roughness`, `bowing`,
   `hachureGap`, `brushWidth`, `baseTone`, …), `backdrop`, compositor knobs, and
   a `FontSpec` with fallback, metrics source, license, and provenance. No engine
   code for the common case. *Two real examples added this round —
   `flux-latentpop` (screenprint: vivid ground + `halftone` + misregistration +
   grunge filter) and `making-software` (cream + `none` fill + blue accent
   edges + serif) — were each just a `StyleSpec` literal.*
2. **`registerStyle(spec)`** (or drop a JSON file in a styles dir). The contrast
   guardrail (§7) runs automatically; `contrast-audit.ts` tells you pass/fail.
3. **Only write code if you need a *new* backend capability** (e.g. a novel
   compositor, fill, or layout-aware route constraint). That implements or
   extends the `StyleBackend` contract in §3.2 and registers the capability —
   the guide documents each interface contract + the determinism rule (seed in,
   bytes out).
4. **Verify**: run the audit, drop the style into the contact-sheet/poster
   harness, eyeball all 12 diagram types.

The guide will include a copy-paste `StyleSpec` template, the parameter
reference, the determinism/seed contract, the WCAG guardrail behaviour, and a
worked agent prompt ("add a style that looks like X").

### 3.3b Documenting what makes a GOOD style (a quality rubric, DELIVERABLE)

> **Commitment:** `docs/style-authoring.md` must include a **quality rubric** —
> not just "how to wire a style up" but "how to make it *good*." This is the
> single highest-leverage doc: across this project the difference between a
> cheap style and a premium one was never the mechanics, always the judgement.

The rubric is a checklist a human or agent self-applies before shipping a style.
It codifies the lessons earned here:

1. **Source it.** Start from real references (photos, the actual product, a
   research pass). Name the reference in the spec. Naive-from-memory looks cheap.
2. **Premium-by-default audit.** No pure `#000`/`#fff`; warm/true neutrals; a
   *real* bundled typeface (not a system fallback); refined hairlines; one
   accent unless the aesthetic is intrinsically polychrome; whitespace; flat
   (no gratuitous shadow/gradient). (See §3.6 — these are also the defaults.)
3. **Monochrome contract** (§3.8): if mono, tone comes from hatch/shading, never
   multiple hues; don't shade a region you write inside.
4. **Legibility gates (automated):** must pass `bun run sketch:check`
   (`styles.test.ts` + `contrast-audit.ts`: WCAG 4.5:1 label, mono contract,
   structural well-formedness) and the visual readability review at *small*
   size (§3.9 density class).
5. **Diagram-fit, not illustration-fit** (§14 principles): outline+flat-fill
   over texture+depth; edges first-class; maps to box/edge/label primitives;
   distinctive at a glance.
6. **Fidelity, not caricature:** capture the 2–3 signatures that make the
   reference recognisable; resist piling on every motif (the "caricature" trap
   we hit repeatedly).

The doc must show **worked good/bad pairs** as calibration — e.g. Making
Software *before* (pure black/white, blue-on-everything, generic serif →
cheap) vs *after* (warm neutrals, one accent, Fraunces, rounded → premium);
Flux LatentPop's caricature vs faithful versions. Examples teach the judgement
the checklist can only gesture at.

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
into `classNames`) maps a class → backend params for mixed-media diagrams.

### 3.5 Central registry → automatic coverage of every diagram type

The single most important architectural property: **a style is registered once
and works for every diagram type — forever, including types added later.** This
falls out of the SceneGraph IR (§3.1): family renderers emit semantic nodes
(`shape`/`connector`/`text`/`group`/`interaction`/…); the selected
`StyleBackend` turns scene nodes into SVG. A style never names a diagram family.
So:

- `registerStyle(spec)` adds a row to one global `STYLES` registry (mirrors
  `THEMES`). The poster/contact-sheet iterate the registry × the diagram-type
  registry — `N` styles × `M` types with **zero per-pair code** (the prototype
  already does this: adding the 5 styles this round needed no per-family work).
- A **new diagram family** only has to emit the IR; it then renders in *all*
  registered styles automatically. A **new style** selects an existing backend
  and declares params/assets; only novel capabilities need backend code. This
  `N+M` (not `N×M`) wiring is the whole point.
- Capability gating: if a style declares it can't support a primitive, the
  engine falls back to `DefaultBackend` for that primitive rather than failing silently
  (the Mermaid `handDrawn`-breaks-on-packet lesson, §13).
- **Proven:** the 10-style candidate batch (terminal, transit, PCB, patent,
  stained-glass, star-chart, Bauhaus, ukiyo-e, codex, mid-century) was added as
  **pure data records — zero engine changes.** That `N+M` property is now an
  explicit target: *"adding a typical appearance style requires no new engine
  code."* It is not a law of nature. A style that needs a new mark operator,
  compositor, semantic channel, asset resolver, or layout dialect may touch
  backend code, but it must declare that as a versioned capability instead of
  hiding bespoke branches behind one-off booleans.

Style packs are versioned:

```ts
interface StylePack {
  schemaVersion: 1
  namespace: string
  styles: StyleSpec[]
  assets?: AssetDeclaration[]
  capabilities?: CapabilityRequest[]
  targetSupport?: Partial<Record<RenderTarget, SupportLevel>>
}
```

Data packs are safe and declarative. Trusted plugins may register code-backed
mark operators or dialect hooks; they are reviewed like renderer code, not
treated as inert data.

### 3.5a Four integration tiers (depth of style hooks)

The candidate set revealed that styles want *different depths* of control:
1. **Restyle (post-process)** — today's prototype: rewrite finished SVG. Cheap,
   universal, but blind to semantics (loses `weight`/`routeId`, can't reroute).
2. **Backend-only** — consume the SceneGraph IR through `DefaultBackend`,
   `RoughBackend`, or `HybridBackend`; control stroke/fill/backdrop/compositor
   + per-role choices. Covers
   the common styles: hand-drawn, Excalidraw, pen-and-ink, patent, chalkboard,
   watercolor-ish, risograph, whiteboard, sketchnotes.
3. **Backend + semantic hooks/assets** — same backend contract, but the style
   needs explicit `weight`, `routeId`, `junction`, font assets, or metrics.
   Examples: Excalidraw needs a reviewed Excalifont asset; star-chart needs node
   magnitude; transit/PCB need route/net identity and junction dots.
4. **Layout-aware (deepest)** — a few aesthetics ARE a spatial grammar, not a
   skin: terminal/TUI wants a **character grid**; transit wants a **45° route
   lattice**; PCB wants **orthogonal net routing + junctions**; codex wants
   **registers**. Their most authentic form influences *layout*, not just
   painting. The spec should expose an optional **layout hook** (a style may
   post-process or constrain ELK's routing/placement) as tier 4 — used rarely,
   gated, and always degrading gracefully to tier 2.

### 3.5b Prototype style configuration matrix

This is the production `StyleSpec` shape each prototype style needs. All rows
also include the shared palette tokens (`bg`, `fg`, `line`, `accent`, `muted`,
`surface`, `border`), WCAG label halo/ink resolution, deterministic seeding, and
the no-prototype-resource asset policy from §9.

| Style | Backend | Intent / density | Tier | FontSpec | Required config |
|---|---|---|---|---|---|
| `crab` | `DefaultBackend` | `premium` / `normal` | backend + semantic hooks/assets | Anthropic Sans/Serif-compatible reviewed asset; prototype uses Fraunces fallback | Anthropic-inspired ivory/slate/clay tokens from public site CSS; `fill:solid`, muted secondary swatches, `nodeCornerRadius:8`, restrained editorial composition. |
| `salmon` | `DefaultBackend` | `premium` / `bold` | backend-only | FT Kunst Grotesk-compatible reviewed asset; prototype uses DejaVu Sans fallback | CF Workers design tokens: cream ground, warm brown text, Cloudflare orange `#FF4801`, subtle fills, dashed/bordered card feeling, `nodeCornerRadius:16`. |
| `freehand` | `HybridBackend` | `draft` / `bold` | backend + native mark capability | Architects Daughter-compatible reviewed asset; fallback `cursive` | `stroke:freehand` via perfect-freehand, pressure-sensitive filled outline ribbons, no fills, clean paper ground, marker-preservation centerline. |
| `hand-drawn` | `RoughBackend` | `draft` / `normal` | backend-only | Caveat-compatible reviewed asset; fallback `cursive` | `stroke:jittered`, `roughness:1.0`, `passes:2`, `strokeWidth:1.8`, `fill:none`, `backdrop:paper-ruled`, `mono:true`. |
| `pen-and-ink` | `RoughBackend` | `premium` / `delicate` | backend-only | EB Garamond-compatible reviewed asset; serif fallback | `stroke:jittered`, `roughness:0.5`, `passes:1`, `strokeWidth:1.5`, `fill:none`, warm cream page, `mono:true`. |
| `tufte` | `DefaultBackend` | `premium` / `delicate` | backend-only | EB Garamond-compatible reviewed asset; serif fallback | `stroke:crisp`, `strokeWidth:0.8`, no fill, faint non-text rules, one red accent, `mono:true`; non-text contrast exemption remains explicit. |
| `blueprint` | `HybridBackend` | `premium` / `bold` | backend + backdrop furniture | Share Tech Mono-compatible reviewed asset; monospace fallback | `stroke:jittered`, low `roughness`, `linecap:butt`, `fill:none`, `backdrop:blueprint`, border frame/title block, uppercase text, `mono:true`. |
| `watercolor` | `HybridBackend` | `premium` / `normal` | backend-only | Caveat-compatible reviewed asset; fallback `cursive` | rough outline, `fill:wash`, `baseTone:0.55`, pigment `spotPalette`, edge-darkening/pooling compositor, polychrome. |
| `chalkboard` | `HybridBackend` | `draft` / `bold` | backend-only | Caveat-compatible reviewed asset; fallback `cursive` | `stroke:pencil`, high roughness, dusty `strokeFilter`, `backdrop:slate`, no fill, `mono:true`. |
| `risograph` | `HybridBackend` | `premium` / `bold` | backend-only | DejaVu Sans Bold or reviewed bold sans; sans fallback | rough stroke, `fill:wash`, two spot inks, `backdrop:rice`, `misregister`, grain/compositor capability. |
| `making-software` | `DefaultBackend` | `premium` / `delicate` | backend-only | Fraunces-compatible reviewed serif; serif fallback | `stroke:crisp`, refined hairlines, `fill:none`, `nodeCornerRadius:7`, one blue accent, warm neutrals, `mono:true`. |
| `excalidraw` | `RoughBackend` | `draft` / `normal` | backend + font asset | Excalifont reviewed asset from `https://plus.excalidraw.com/excalifont`; fallback Architects Daughter/Caveat | rough.js `stroke:jittered`, `roughness:1.1`, `passes:2`, pastel `hachure` fills via `spotPalette`, rounded nodes, open/sketch marker styling. |
| `whiteboard` | `HybridBackend` | `draft` / `bold` | backend-only | Caveat-compatible reviewed asset; fallback `cursive` | thick translucent marker strokes, `fill:none`, `boxShadow`, soft blur filter, marker-colour palette. |
| `sketchnotes` | `HybridBackend` | `draft` / `bold` | backend-only | Architects Daughter-compatible reviewed asset; fallback `cursive` | bold `stroke:jittered`, `fill:solid`, cheerful pastel `spotPalette`, `boxShadow`, rounded containers. |
| `pencil` | `HybridBackend` | `draft` / `normal` | backend-only | Architects Daughter-compatible reviewed asset; fallback `cursive` | graphite `stroke:jittered`, `fill:scribble`, `toneFromLuminance:true`, muted paper, `boxShadow`, `mono:true`. |
| `terminal` | `DefaultBackend` | `premium` / `bold` | layout-aware | Share Tech Mono-compatible reviewed asset; monospace fallback | crisp thin rules, no fill, phosphor palette, `mono:true`; full fidelity may add character-grid layout hints. |
| `transit` | `DefaultBackend` | `premium` / `bold` | semantic hooks + layout-aware | DejaVu Sans Bold or reviewed transit-map sans; sans fallback | crisp thick rounded routes, station/junction glyphs, `routeId` colours, `nodeCornerRadius:12`; optional 45-degree lattice layout hook. |
| `pcb` | `RoughBackend` | `premium` / `bold` | semantic hooks + layout-aware | Share Tech Mono-compatible reviewed asset; monospace fallback | gold traces on solder-mask ground, uppercase text, net identity, junction dots, optional orthogonal-routing/layout hook. |
| `patent` | `RoughBackend` | `premium` / `normal` | backend-only | EB Garamond-compatible reviewed asset; serif fallback | uniform thin black line, `fill:hachure`, `baseTone:0.14`, `toneFromLuminance:true`, `hachureAngle:-50`, `mono:true`. |
| `stained-glass` | `RoughBackend` | `premium` / `bold` | backend-only | Cinzel-compatible reviewed asset; decorative serif fallback | heavy lead-came stroke, `fill:solid`, jewel `spotPalette`, local-bg contrast handling for labels/outlines. |
| `star-chart` | `RoughBackend` | `premium` / `delicate` | semantic hooks | EB Garamond-compatible reviewed asset; serif fallback | faint grid, pale-gold strokes, no fill, `weight` maps to star magnitude/node size, coordinate-grid backdrop. |
| `bauhaus` | `DefaultBackend` | `premium` / `bold` | backend-only | DejaVu Sans Bold or reviewed geometric sans; sans fallback | crisp geometric strokes, `fill:solid`, primary `spotPalette`, `labelHalo`, flat composition. |
| `ukiyo-e` | `HybridBackend` | `premium` / `normal` | backend-only | EB Garamond-compatible reviewed asset; serif fallback | rough keyline, `fill:solid`, muted woodblock `spotPalette`, `backdrop:washi`. |
| `codex` | `HybridBackend` | `premium` / `bold` | layout-aware | DejaVu Sans Bold or reviewed display sans; sans fallback | heavy contours, flat saturated `spotPalette`, `backdrop:rice`, label halo; full fidelity may add register/layout hooks. |
| `mid-century` | `DefaultBackend` | `premium` / `normal` | backend-only | DejaVu Sans or reviewed mid-century sans; sans fallback | crisp line, `fill:solid`, teal/mustard/red `spotPalette`, `nodeCornerRadius:3`, lots of air. |
| `vinegar` | `RoughBackend` | `lofi` / `normal` | backend + font asset | Balsamiq Sans reviewed asset; fallback casual sans/cursive | single-pass wobbly stroke, no fill, rounded containers, greyscale palette, intentional low-fidelity polish inversion, `mono:true`. |
| `giscardpunk` | `HybridBackend` | `premium` / `bold` | backend-only | Fredoka-compatible reviewed asset; rounded sans fallback | chunky rough strokes, `fill:solid`, warm harvest `spotPalette`, `backdrop:rice`, `nodeCornerRadius:16`. |

### 3.6 Premium-by-default — Making Software as the baseline

Making Software is the **exemplar**: a custom style should look premium without
the author getting everything right. So the registry ships **premium defaults**
that every style inherits unless it opts out:

- Neutrals are never pure `#000`/`#fff` — default ink/page resolve to slightly
  warm/desaturated tokens.
- A real bundled typeface (never a bare system fallback); fonts are a
  first-class registry asset (§9).
- Refined hairlines + a default `nodeCornerRadius` + generous label padding.
- **One accent per figure** — geometry stays monochrome unless a style asks for
  multi-colour fills (`spotPalette`).
- Whitespace, flat (no gratuitous shadows/gradients), and the WCAG guardrail
  (§7) always on.

A `StyleSpec` overrides only what it needs; the defaults keep the floor high so
the *next* contributed style starts at "Making Software" quality, not "ugly".

**Fidelity intent (learned from Vinegar/Balsamiq).** "Premium" is not the only
goal — some styles are *deliberately* low-fidelity. Balsamiq's entire value is
looking unfinished (it signals "draft — critique structure, not pixels"). So a
style declares an `intent: 'premium' | 'draft' | 'lofi'`, and premium defaults
are **opt-out**: a `lofi` style keeps the WCAG/legibility floor but inverts the
polish defaults (intentional wobble, greyscale, rough rather than refined). The
quality rubric (§3.3b) then judges a style **against its own declared intent** —
a lo-fi mock that looks polished has *failed*, just as a premium style that
looks cheap has. "Premium-by-default" means *high-floor*, not *uniform gloss*.

### 3.7 How styles and themes compose (orthogonal, token-mediated)

From Excalidraw's architecture: keep **aesthetic** (geometry/stroke/fill/texture)
and **colour theme** (palette) orthogonal, mediated by **semantic tokens**.

- A `StyleSpec` should reference palette **tokens** (`stroke: --fg`,
  `fill: --accent`, `band: --surface`) rather than literal hex; the active
  **theme** resolves tokens → concrete colours (the existing `theme.ts`
  CSS-variable system already is this resolver).
- Styles therefore define *behaviour* (roughness, fill pattern, stroke width,
  roundness, texture); themes define *the colours the tokens map to*. Result:
  **any style × any theme** — "hand-drawn × Dracula", "blueprint × Solarized".
- A style may still pin intrinsic colours where the aesthetic *is* the colour
  (blueprint's cyanotype blue, LatentPop's spot inks) — those are declared as
  style-owned constants, not theme tokens, and documented as such.
- Excalidraw's dark mode is a lossy render-time invert; we do better — themes
  resolve tokens to palettes authored for each mode, and the WCAG guardrail
  re-checks contrast after resolution, so a style stays legible under any theme.
- Defaults cascade (Excalidraw "current-item" lesson): the resolved
  (style × theme) applies to every new element/family with no per-type wiring.

Formal precedence:

```text
Mermaid family semantic defaults
  < active theme tokens (`theme.ts` CSS variables / `resolveDiagramColors`)
  < aesthetic defaults / premium floor
  < aesthetic role rules
  < Mermaid `classDef`
  < Mermaid inline style
  < per-element API override
  < accessibility policy
```

This extends the existing internal color waist rather than introducing a second
resolver. `resolveDiagramColors()` remains the boundary that normalizes Mermaid
theme names, `themeVariables`, public render options, and font embedding into
`DiagramColors`; `resolveNodeInlineStyle()` / `resolveEdgeInlineStyle()` remain
the family-source layer for `classDef`, `style`, and `linkStyle`. Production
style resolution should add aesthetic defaults, role rules, semantic-channel
derivations, local-background contrast, and accessibility policy on top of that
resolved model. The resolved result is stored as
`ResolvedElementStyle`/metadata on SceneGraph nodes, so backends consume a
single contract and never rediscover colors from serialized SVG.

The final accessibility step is policy-controlled:
- `accessibility: 'adjust'` auto-nudges label/stroke colours to pass contrast
  and emits metadata warnings.
- `accessibility: 'warn'` preserves the user's colour exactly and reports
  failures.
- `accessibility: 'strict'` rejects output that cannot satisfy required text and
  non-text contrast.

Inline Mermaid styles, class names, and user data must be first-class
`ResolvedElementStyle`/metadata fields on the SceneGraph, not recovered later
from emitted SVG strings.

### 3.8 The monochrome contract (TESTED)

A **monochrome** style (`mono: true`) conveys tone/emphasis through
**shading/hatching density and line weight — never through multiple fill hues**.
Mixing hues inside a one-ink aesthetic (e.g. coloured node fills in "hand-drawn")
breaks internal consistency and looks wrong. The contract, enforced by
`styles.test.ts` (CI gate, alongside the WCAG audit):

- a `mono` style must not carry a multi-hue `spotPalette` (hue spread < 20°),
  and must keep `keepHue:false`;
- its `line`/`border`/`fill` inks share one hue family (a single *accent* — like
  Tufte's red or Making Software's blue — is still allowed);
- emphasis/value therefore comes from the *fill mode* (hachure gap,
  cross-hatch, stipple density), exactly as patent/engraving/pen-and-ink do.

Corollary (also a design rule): **don't shade a region you write inside.** A
chalk/marker author draws a box and writes in it — they don't crosshatch its
interior. Label-bearing nodes default to unfilled outlines; hatching is reserved
for *semantic* tone (emphasis, group bands, chart values), gated by
`MIN/MAX_FILL_AREA` and `baseTone`.

### 3.9 Density class — delicate styles need room

Styles are not equally robust at small sizes (observed: Making Software's
hairlines + serif + whitespace read beautifully large but go faint in a dense
poster cell, whereas bold styles like Sketchnotes hold up). A style should
declare a **density class** (`delicate | normal | bold`) so the renderer can
pick a sensible minimum render size / line-weight floor per context. Premium,
restrained styles are *delicate* by nature — the system should give them space
rather than letting them shrink into illegibility. (This is why the standalone
Making Software poster — bigger cells — looked better than its small cell in the
combined grid; the fix is min-size, not heavier strokes.)

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
| `freehandStroke` | perfect-freehand | centerline + pressure → filled outline polygon; ideal for marker, brush, whiteboard, sketch connectors |
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

## 5. Semantic channels and derived tone

The SceneGraph preserves typed semantic channels. `tone ∈ [0,1]` is derived by
the selected style/backend only after those channels survive the renderer
boundary.

```ts
interface SemanticChannels {
  importance?: number       // hierarchy, star magnitude, callout weight
  value?: number            // chart value or quantitative measure
  category?: string         // chart series, entity type, swimlane
  status?: string           // active, critical, done, failed, selected
  progress?: number         // gantt/task completion
  uncertainty?: number
  emphasis?: boolean
  route?: string            // transit route or PCB net identity
  toneHint?: number         // optional author hint, not the only semantic input
}
```

A style maps channels to rendering outputs:

```
channels + role + cascade + StyleSpec
  -> tone, hue, texture, stroke width, marker shape, label treatment, size
```

This avoids collapsing unrelated meanings. A Gantt task can remain critical,
complete, active, selected, and long; a chart series can preserve categorical
identity while value maps to size or density; a transit route can keep route
identity separate from stroke thickness. Scales and legends must remain attached
to the scene graph so an aesthetic can add texture, marker, or direct-label
fallbacks when hue alone is insufficient.

The prototype still approximates tone from rendered fill luminance
(`toneFromLuminance`) because it post-processes SVG. In production, `tone` is a
style-derived output from `SemanticChannels`; `keepHue` styles (watercolor,
charts, transit) may carry categorical hue into fills while monochrome styles
map tone to hatch/dot/line-weight density.

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

## 7. Readability, accessibility & contrast

WCAG relative luminance + contrast ratios are the numeric guardrail, but the
renderer refactor must preserve accessibility and interaction semantics too.
SceneGraph nodes carry reading order, `<title>`, `<desc>`, ARIA, links,
tooltips, focus state, classes, `data-*` attributes, and dedicated hit targets.
Backends may change visual marks, but they must not turn stipple dots, hachure
segments, or decorative filters into the user's interaction geometry. Contrast
math is one part of that contract:

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
4. **Contrast must be checked against the ACTUAL local background, not just the
   page.** The candidate set surfaced this: stained-glass cames are near-black
   on a dark *leading* ground but read fine against the bright *glass fills* —
   the page-relative audit wrongly failed them. Lesson: for a region with a
   solid/opaque fill, the outline's background is the **fill**, and a label's
   background is the **halo-over-fill** — the guardrail/audit should resolve the
   effective local bg per element role (page · fill · halo) before measuring.
   (Today's prototype side-steps it by giving filled styles a light ground; the
   IR-based version should compute it properly.)

Plus **1.4.1 Use of Color**: meaning never rests on hue alone — our styles
already differentiate by shape/texture (hachure vs stipple vs dots), so a
monochrome or colour-blind viewer still reads structure; hue-led charts (pie)
keep texture + labels.

**Readability is cross-cutting — it also governs the CHROME, not just the art.**
A recurring lesson: the *presentation* layer (galleries, contact sheets, the
poster's row/column labels, captions, legends) must obey the same contract as
the diagrams. Generated labels must **auto-fit and never clip/overflow** into
adjacent content, and meet the same contrast bar. (Concretely: the poster's
left-hand style names now auto-fit the header column instead of spilling into
the first cell.) Any tool that *renders a label the user will read* — diagram,
legend, or framing chrome — is in scope for the readability gate.

**Testable property.** `contrast-audit.ts` runs the two ratios for every style
and exits non-zero on any failure, so readability gates CI like a golden test.
Current status: all 27 styles PASS (text ≥4.5:1, non-text ≥3:1; Tufte's faint
rules exempted by design). In production the same check runs per
style × diagram-role over the IR.

---

## 8. Determinism & testing

Use the repository's post-rebase testing taxonomy: every gate must say what
kind of oracle it is and what it does *not* prove. Line coverage is a finder,
not an adequacy target; mutation score and sabotage/property failures are the
stronger evidence that style contracts actually bite.

- **Seed contract:** `seed(node, stream) = hash(options.seed, stableSceneNodeId,
  streamName)`, where `streamName` is a semantic substream such as
  `outline/pass:0`, `outline/pass:1`, `fill/hatch:17`, `marker:end`, or
  `freehand/centerline`. Do not key randomness on list position or `markIndex`;
  inserting a new decorative mark must not reshuffle unrelated geometry. All
  randomness flows from `makeRng(seed)` (mulberry32). Verified: the prototype is
  byte-identical across runs for all 27 styles.
- **Byte identity vs semantic identity:** the crisp path must remain
  byte-identical until the scene serializer deliberately replaces the old
  emitter. Styled backends must be deterministic per dependency/font/rasterizer
  version; cross-substrate acceptance is bounded visual difference plus
  identical preserved semantics where the substrate supports them.
- **Specified oracles / preservation gate:** before judging appearance, tests
  assert that markers, dash arrays, IDs, classes, `data-*`, inline styles,
  transforms, clip paths, masks, ARIA/title/desc, links, tooltips, hit targets,
  text runs, route certificates, and focus/hover affordances survive crisp and
  styled rendering. This is the functional correctness gate.
- **Derived oracles / goldens:** add SVG fixtures per
  (style × representative diagram). Because output is deterministic, these are
  stable. Default `crisp` reuses existing fixtures unchanged. Golden drift only
  proves that output changed; human or rubric review still decides whether the
  change is an improvement.
- **Derived + human oracles / contact sheet and poster:** keep
  `scripts/sketch-prototype/poster.ts` as the visual-review surface. The
  automated prototype gate is `bun run sketch:check`; add a poster
  check/fingerprint mode before wiring raster poster output into
  `characterization:check`. Poster review is evidence, not a substitute for
  structural preservation or property tests.
- **Metamorphic oracles:** add relation tests for style resolution and lowering:
  stable seed + same SceneGraph gives byte-identical marks; changing only a
  non-rendered ID does not change geometry; accessibility adjustment can change
  color but not layout metrics; disabling a backend capability falls back
  without dropping semantic nodes.
- **Pseudo-oracles / adequacy:** add a `stryker.styles.config.json` or
  incremental Stryker lane targeting pure style resolution, channel-to-tone
  mapping, capability negotiation, and mark primitives. These are ideal mutation
  targets because they are deterministic and isolated.
- **Invariant tests (shipped): `styles.test.ts`** — asserts the monochrome
  contract (§3.8), the WCAG 4.5:1 label-contrast contract (§7) for every style,
  and structural well-formedness. Together with `contrast-audit.ts`, this runs
  under `bun run sketch:check` in CI (currently 81 tests / 118 expectations).
  These encode the design rules as a CI gate so a new style can't regress them.
- **Conformance corpus:** add adversarial fixtures, not just the poster:
  every node/marker shape; dashed, thick, invisible, self-loop, and bidirectional
  connectors; nested groups; sequence notes/activations/loops/alternatives;
  class compartments and mixed text runs; ER cardinalities; long/multiline/CJK/
  RTL/emoji labels; classDefs and inline styles; transparent/dark backgrounds;
  zero/negative/extreme chart values; tiny/huge diagrams; browser/resvg
  differences; duplicate IDs; strict-security output.
- **Heuristic / perceptual oracles:** layout-aware styles (`terminal`,
  `transit`, `pcb`, future architectural/register styles) feed their hard and
  soft constraints into the existing layout-rubric / visual-rubric model rather
  than inventing private "looks better" checks. Hard violations stay zero;
  soft metrics ratchet with reviewed baselines.
- **Performance budgets:** each backend declares scale-aware limits for SVG
  bytes, generated path commands, dots/hatches per region, filters/clip paths,
  render time, resvg memory, raster dimensions, cache keys, and simplification
  tolerance. Stipple/halftone/freehand density must scale down for thumbnails
  and up for export without changing semantics.

---

## 9. Fonts

Styles declare a `FontSpec`, not just a family string. The family is still
threaded through the existing `--font` CSS variable, but the asset and metrics
are part of style resolution because text measurement affects node sizes and
therefore layout. In the production pipeline, style resolution must run before
layout:

```
StyleSpec + target ─► resolveAssets() ─► FontMetrics ─► layout ─► SceneGraph
```

The prototype carries local TTFs so its posters and contact sheets are
reproducible, but those files are disposable prototype inputs. Production must
not ship or copy resources from `scripts/sketch-prototype/`.

For production PNG via **resvg** (no web-font fetch), prefer the existing
approved bundled font fallback or a separately reviewed asset under the normal
asset tree. Any new production font must be deliberately added with explicit
license/provenance documentation and a metric source. Browser SVG may keep
optional `@import` behaviour where security mode allows it, but strict/offline
rendering must not depend on remote or prototype-local font files.

Concrete example: the Excalidraw style should use Excalifont rather than a loose
"handwriting" substitute if we want fidelity. The public Excalifont page calls
it the official Excalidraw hand-drawn font and links a download; it also includes
license language that must be verified against the downloaded distribution before
bundling. The production `FontSpec` should record that provenance
(`https://plus.excalidraw.com/excalifont`), the verified license, the bundled
asset path (if accepted), and a fallback stack for browser-only or strict modes.

---

## 10. Substrate & capability negotiation

| Effect | Browser SVG | resvg/PNG | Fallback |
|---|---|---|---|
| paths, hachure, stipple, halftone, ribbons | ✓ | ✓ | — |
| `feGaussianBlur` (bleed) | ✓ | ✓ | reduce stdDeviation |
| `feTurbulence` grain (paper/slate/wax) | ✓ | ✓ (slower) | bake a tiled PNG grain |
| `feDisplacementMap` (chalk/crayon) | ✓ | ✓ | skip → plain stroke |
| `mix-blend-mode` (riso overprint) | ✓ | ✗ | manual offset duplicate (prototype does this) |

Each `StyleBackend` declares `capabilities: Capability[]`; each `StyleSpec`
declares the capabilities it requires. The renderer picks the fallback when
targeting PNG or strict security mode. Reuse the existing browser-vs-resvg
plumbing (`inlineResolvedColors`, strict-security `stripExternalRefs`).

**Cross-substrate bonus:** SceneGraph roles and semantic channels can inform the
existing **ASCII** renderer (channels → glyph density/route characters/status
markers) and future canvas/WebGL backends. They are not a mandate to collapse
ASCII geometry into SVG geometry: the post-rebase architecture keeps ASCII's
grid/A* internals output-specific while sharing family registration and
semantic dispatch.

---

## 11. Phasing

1. **All-family SceneGraph lowering + `DefaultBackend` behind the existing
   family registry.** Migrate every built-in renderable family in one coordinated
   branch: flowchart/state, sequence, class, ER, timeline, journey, xychart, pie,
   quadrant, gantt, and architecture. Each family gets a lowering hook from its
   positioned result to SceneGraph, crisp default rendering through
   `DefaultBackend`, preservation fixtures, accessibility/interaction fixtures,
   and registry/doc-sync coverage before the path is enabled by default. Include
   font asset/metric resolution, padding, marker extents, stroke/effect bounds,
   and minimum feature size before layout, even for the crisp default, so all
   backends share the same pipeline.
2. **One-shot equivalence gate before switching default.** The all-family branch
   must prove: default `crisp` output is byte-identical where the serializer has
   not intentionally changed; any deliberate serialization drift has golden
   review; semantic preservation passes for every representative family fixture;
   layout-rubric hard violations stay zero; `render-family-hooks` dispatch stays
   deterministic.
3. **Adopt rough.js** (pinned) as `RoughBackend`: `jittered`/`pencil`
   stroke + `hachure`/`crosshatch`/`dots` fill, incl. arbitrary-path roughening;
   ship `hand-drawn`, `Excalidraw`, `pen-and-ink`, `tufte` with tone. Add
   goldens + poster row.
4. **`HybridBackend` extensions** (`freehand` via perfect-freehand,
   `brush`/`wash`/`stipple`/`halftone`, compositors, reviewed font assets such
   as Excalifont) → ship the remaining styles.
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

## 14. What makes a good diagram style + candidate backlog

Synthesised from building 27 prototype styles and a wide aesthetic survey. A good
*diagram* style is not the same as a good *illustration* style:

1. **Outline + flat fill beats texture + depth.** Hard dark stroke + ungraded
   fill survives shrinking; soft/3-D looks (clay, embroidery, voxel,
   glassmorphism, neumorphism) collapse at small size.
2. **Edges are first-class.** Favour aesthetics with a native connector grammar
   (schematic traces, transit routes) over icon systems (ISOTYPE) that lack one.
3. **Tone discipline — earn every value.** Hierarchy via line weight / hatch
   density; colour is a *semantic* channel, not decoration (the §3.8 contract).
4. **Legible small, legible at a glance.** Labels are the usual failure point —
   default to clean type on a flat ground; ornamental scripts need a size budget
   (the §3.9 density class).
5. **Maps cleanly to box/edge/label primitives** (ideally with a layout grammar
   the renderer can exploit: a character grid, a route lattice, registers).
6. **High figure–ground contrast** (why neumorphism/glassmorphism are weak).
7. **Restraint over horror vacui** — confine ornament to titles/legends/borders.
8. **Distinctive in one glance** from stroke + palette signature alone.

**Candidate backlog** (ranked for diagrams; ★ = surprising/non-obvious):
- ★ **Terminal / TUI box-drawing** — monospace Unicode box glyphs; the medium
  *is* a node-link rendering technique, not a skin. Monochrome.
- **Transit / subway map (Beck)** — 45° route lattice, uniform coloured strokes,
  station dots; edges first-class. (Beck derived it from a circuit schematic.)
- ★ **PCB / circuit schematic** — boxes=components, edges=traces, junction dots;
  has both a mono line variant and the green/gold board variant.
- **Patent drawing (USPTO)** — the ideal disciplined *monochrome* skin: uniform
  line weight, tone only via oblique hatching, numbered leader-line callouts.
- ★ **Stained glass** — bold black "came" outlines + flat luminous fills; already
  a bold-outline/flat-fill diagram. Polychrome.
- ★ **Star chart / celestial atlas** — magnitude-sized star nodes (free node
  weighting), faint coordinate grid, Greek-letter keyed labels.
- **Bauhaus** — geometric primitives, primary palette, geometric sans; "the
  designed flowchart."
- **Ukiyo-e woodblock** — bold keyline + large flat colour areas.
- ★ **Mesoamerican codex** — glyph-nodes joined by *footprint* paths (a fresh
  arrow metaphor); heavy contours, flat saturated fills.
- **Mid-century infographic** — flat teal/mustard/red on cream; a reliable
  polychrome default.

Monochrome-friendly (tone via hatching): terminal, patent, star chart,
engraving, sumi-e, schematic-line. Inherently polychrome (colour carries
meaning): transit, PCB-board, stained glass, Bauhaus, codex, ukiyo-e,
mid-century. (Picking a style's `mono` flag follows directly from this split.)

---

## 15. References

- Winkenbach & Salesin, *Computer-Generated Pen-and-Ink Illustration*, SIGGRAPH '94.
- Praun, Hoppe, Webb, Finkelstein, *Real-Time Hatching*, SIGGRAPH 2001 (Tonal Art Maps).
- Secord, *Weighted Voronoi Stippling*, NPAR 2002.
- Hertzmann, *A Survey of Stroke-Based Rendering*, IEEE CG&A 2003.
- Curtis, Anderson, Seims, Fleischer, Salesin, *Computer-Generated Watercolor*, SIGGRAPH '97.
- Xie et al., *Artist Agent: RL for Oriental Ink Painting*, 2012; *Contour-driven Sumi-e rendering*.
- Shihn, *The Algorithms behind Rough.js* (2020); AbdulMassih et al., *Mimicking Hand-Drawn Pencil Lines*.
- Ruiz, *perfect-freehand* (MIT): pressure-sensitive centerline-to-outline freehand strokes.
```
