# Authoring an aesthetic style

Agentic Mermaid renders every diagram twice-abstracted: family renderers lower
their positioned layout to a **SceneGraph** of semantic marks (roles, stable
ids, channels), and a **StyleBackend** serializes those marks to SVG. An
*aesthetic style* is a data record that selects a backend and its parameters —
registered once, it applies to **every** diagram family, including families
added later. No per-family wiring, ever.

```ts
import { registerAesthetic, renderMermaidSVG } from 'agentic-mermaid'

registerAesthetic({
  name: 'my-style',
  label: 'My style',
  blurb: 'One sentence someone picks it by.',
  backend: 'rough',                  // 'default' | 'rough' | 'hybrid'
  intent: 'draft',                   // 'premium' | 'draft' | 'lofi'
  density: 'normal',                 // 'delicate' | 'normal' | 'bold'
  colors: { bg: '#f7f5ef', fg: '#1a1a1e', line: '#26262b' },
  font: 'Caveat',
  roughness: 1.0,
  passes: 2,
  strokeWidth: 1.8,
  fill: 'none',                      // 'none' | 'hachure' | 'solid' | 'wash'
  backdrop: 'paper-ruled',           // 'plain' | 'paper-ruled' | 'grid'
  mono: true,
})

const svg = renderMermaidSVG(source, { aesthetic: 'my-style' })
```

## The contract you get for free

- **Any style × any theme.** Your `colors` are *defaults*: anything the user
  sets via `RenderOptions` colors or Mermaid `themeVariables` wins. Never
  assume your palette survives.
- **Determinism.** All stochastic marks are seeded
  `hash(options.seed, stableNodeId, substream)` — identical input produces
  identical bytes; `seed` re-rolls the wobble without moving layout.
- **Semantics survive.** Markers, `class`/`data-*` attributes, hit geometry,
  ARIA, and strict-security guarantees pass through every backend. Text is
  drawn last, never perturbed, with a page-colored halo (labels stay legible
  on any fill).
- **Crisp is sacred.** `aesthetic: 'crisp'` (or unset) is byte-identical to
  previous releases and gated by a corpus-wide equivalence test.

## Choosing a backend

| Backend | Use for | What it does |
|---|---|---|
| `default` | palette/typography styles (Tufte) | crisp geometry, your colors/fonts/line widths |
| `rough` | sketch looks (hand-drawn, Excalidraw, blueprint, pen-and-ink) | rough.js jittered strokes + hachure/solid fills, role-aware (axes/grids/text stay crisp) |
| `hybrid` | native NPR marks | everything `rough` does, plus perfect-freehand pressure ribbons (`stroke: 'freehand'`) and watercolor washes (`fill: 'wash'`) |

Only a genuinely **new capability** (a new fill algorithm, compositor, or
layout-aware dialect) justifies backend code: implement `StyleBackend`, call
`registerBackend(...)`, and keep the determinism rule (seed in, bytes out).
Backends never dispatch on diagram family — they see roles and channels.

## The quality rubric — what makes a style GOOD

The mechanics above are the easy part. Across the prototype's 31 styles, the
difference between a cheap style and a premium one was never the wiring —
always the judgement:

1. **Source it.** Start from real references (photos, the actual product),
   not memory. Name the reference in your blurb. Naive-from-memory looks cheap.
2. **Premium defaults.** No pure `#000`/`#fff` — warm or desaturated neutrals.
   A real typeface, not a bare fallback. Refined line weights. ONE accent per
   figure unless the aesthetic is intrinsically polychrome.
3. **Monochrome contract** (`mono: true`): tone comes from hatch density and
   line weight, never from extra hues. And don't shade a region people write
   inside — hand-drawn boxes stay open (`fill: 'none'`).
4. **Legibility gates.** Text must clear WCAG 4.5:1 against the page the halo
   reveals; non-text strokes 3:1. Declare `density: 'delicate'` if your style
   needs room (hairline + serif styles collapse at thumbnail size).
5. **Diagram-fit, not illustration-fit.** Outline + flat fill beats texture +
   depth; edges are first-class; the style must read at a glance from stroke +
   palette alone.
6. **Fidelity, not caricature.** Capture the 2–3 signatures that make the
   reference recognisable and stop. Judge the result against its declared
   `intent` — a lo-fi mock that looks polished has failed, exactly like a
   premium style that looks cheap.

Worked example (the clearest lesson from the prototype): "Making Software"
*before* — pure black on white, generic serif, blue everywhere — read as
cheap. *After* — warm neutrals (`#fafaf9`/`#0c0a09`), Fraunces, hairlines,
rounded corners, one blue accent — read as premium. Same mechanics, different
judgement.

## Verify before you ship

```bash
bun test src/__tests__/styled-output.test.ts   # determinism + goldens
bun test src/__tests__/scene-fidelity.test.ts  # semantic/crisp agreement
bun test src/__tests__/svg-equivalence.test.ts # crisp path untouched
```

Then render your style across all twelve diagram types and *look at it small*
— the poster/contact-sheet harness in `scripts/sketch-prototype/` is the
visual-review surface. A style ships when it is distinctive at a glance,
legible at cell size, and honest to its intent.
