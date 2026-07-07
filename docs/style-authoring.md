# Authoring styles

A **style** is a partial description of how diagrams look. Every field is
optional: a style that only sets colors is what people call a *theme*; a
style that only sets `node.cornerRadius` is a tweak; a style that sets
stroke character, fills, typography, and a palette is a full look. Styles
apply uniformly to **every** diagram family — registered once, they work for
all twelve types, including families added later.

Styles compose by **stacking**: `RenderOptions.style` accepts a name, an
inline spec, or an array of either, merged left → right (later fields win,
colors merge per channel, role overrides merge per field):

```ts
import { renderMermaidSVG, registerStyle } from 'agentic-mermaid'

// a built-in look
renderMermaidSVG(source, { style: 'hand-drawn' })

// hand-drawn geometry × the dracula palette — themes are just styles
renderMermaidSVG(source, { style: ['hand-drawn', 'dracula'] })

// an inline custom style — no registration needed
renderMermaidSVG(source, {
  style: {
    colors: { bg: '#fffdf7', fg: '#1c1917', accent: '#e11d48' },
    font: 'Caveat',
    stroke: 'jittered',
    roughness: 0.8,
    fill: 'hachure',
  },
})

// register for reuse by name (name required for registration)
registerStyle({ name: 'acme-brand', /* … */ })
renderMermaidSVG(source, { style: ['acme-brand', 'nord'] })
```

You never pick a backend. The engine infers the machinery from what the
style asks for: `stroke: 'freehand'` or `fill: 'wash'` engages the hybrid
backend (pressure ribbons, watercolor); `stroke: 'jittered'`, hachure fills,
sketch parameters, or a page backdrop engage rough.js; anything else renders
on the crisp default backend with your palette and typography.

## The contract you get for free

- **Any stack × any theme.** Your `colors` are *defaults*: anything the user
  sets via `RenderOptions` colors or Mermaid `themeVariables` wins. The full
  precedence is one line: `defaults < style stack (left→right) <
  themeVariables < explicit color options`.
- **Determinism.** All stochastic marks are seeded
  `hash(options.seed, stableNodeId, substream)` — identical input produces
  identical bytes; `seed` re-rolls the wobble without moving layout, so
  `(source, stack, seed)` is a complete, portable description of an image.
- **Semantics survive.** Markers, `class`/`data-*` attributes, hit geometry,
  ARIA, and strict-security guarantees pass through every backend. Text is
  drawn last, never perturbed, with a page-colored halo (labels stay legible
  on any fill).
- **Crisp is sacred.** `style: 'crisp'` (or unset) is byte-identical to the
  plain renderer and gated by a corpus-wide equivalence test. A style that
  only sets role overrides also stays on the crisp path.

## Field reference

| Group | Fields |
|---|---|
| identity | `name`, `blurb` (required only for `registerStyle`) |
| palette | `colors: { bg, fg, line, accent, muted, surface, border }` — all optional |
| typography | `font` — SVG always declares it; for PNG the faces built-in looks use are bundled (Caveat, EB Garamond, Architects Daughter, Share Tech Mono), other families need the `fontDirs` PNG option or fall back to DejaVu Sans |
| stroke | `stroke: 'crisp' \| 'jittered' \| 'freehand'`, `roughness`, `bowing`, `passes` (1 = single pass, 2 = sketchy double stroke), `strokeWidth` — works on every backend (on the default backend it sets the role line widths; explicit `node`/`edge`/`group.lineWidth` win) |
| fill | `fill: 'none' \| 'hachure' \| 'solid' \| 'wash'`, `hachureAngle`, `hachureGap`, `fillWeight`, `washOpacity`, `washEdge` — `fill` picks the *sketch* fill algorithm; the default backend already paints flat `surface` fills, so `'solid'` is its native behavior and `'none'` only changes output on sketch backends |
| page | `backdrop: 'plain' \| 'paper-ruled' \| 'grid'` |
| role overrides | `text`, `node`, `edge`, `group` (font sizes, label transforms, line widths, corner radii, paddings per semantic role) |
| advisory | `intent: 'premium' \| 'draft' \| 'lofi'`, `mono` — read by pickers and the rubric below, never by the engine |
| expert | `backend` — overrides inference; only needed for code-backed extensions |

JSON style records are first-class: `validateStyleSpec(json)` returns a list
of problems (`[]` = usable). Specs are declarative-only — no field can carry
markup, scripts, or URLs, so they are safe to load from files and prompts and
compatible with `security: 'strict'`.

For file-backed styles, use the schema at
[`docs/schemas/style-spec.schema.json`](./schemas/style-spec.schema.json), also
published as `agentic-mermaid/style-spec.schema.json`. The
[`custom style cookbook`](./custom-style-cookbook.md) has complete JSON files,
screenshots, and CLI commands.

Only a genuinely **new capability** (a new fill algorithm, compositor, or
layout-aware dialect) justifies code: implement `StyleBackend`, call
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
3. **Monochrome discipline** (`mono: true`): tone comes from hatch density and
   line weight, never from extra hues. And don't shade a region people write
   inside — hand-drawn boxes stay open (`fill: 'none'`).
4. **Legibility gates.** Text must clear WCAG 4.5:1 against the page the halo
   reveals; non-text strokes 3:1. Hairline + serif styles collapse at
   thumbnail size — declare `intent` honestly and test small.
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
bun run style:audit                         # element role coverage + role-token propagation + contrast + label transforms
bun test src/__tests__/styled-output.test.ts   # determinism + goldens + composition
bun test src/__tests__/scene-fidelity.test.ts  # semantic/crisp agreement
bun test src/__tests__/svg-equivalence.test.ts # crisp path untouched
```

Then render your style across all twelve diagram types and *look at it small*
— the poster/contact-sheet harness in `scripts/sketch-prototype/` is the
visual-review surface. A style ships when it is distinctive at a glance,
legible at cell size, and honest to its intent.
