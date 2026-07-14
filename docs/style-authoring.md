# Authoring styles

A **style** is a partial description of how diagrams look. Every field is
optional: a style that only sets colors is a palette; a style that sets
stroke character, fills, typography, and a palette is a full look. Styles
apply uniformly to every built-in family. An extension gets the same contract
when its `FamilyDescriptor` advertises native Scene execution (`layout` +
`lowerScene`, exposed as the `scene` capability); discovery reports extensions
without that capability instead of promising style support they cannot render.

Styles compose by **stacking**: `RenderOptions.style` accepts a name, an
inline spec, or an array of either, merged left → right (later fields win,
colors merge per channel):

```ts
import { renderMermaidSVG, registerStyle } from 'agentic-mermaid'

// a built-in look
renderMermaidSVG(source, { style: 'hand-drawn' })

// hand-drawn geometry × the dracula Palette
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

// register for reuse by canonical kind:name identity
registerStyle({ name: 'look:acme-brand', /* … */ })
renderMermaidSVG(source, { style: ['look:acme-brand', 'palette:nord'] })
```

You never pick a backend. The engine infers the machinery from what the
style asks for: `stroke: 'freehand'` or `fill: 'wash'` engages the hybrid
backend (pressure ribbons, watercolor); `stroke: 'jittered'`, hachure fills,
sketch parameters, or a page backdrop engage rough.js; anything else renders
on the crisp default backend with your palette and font.

Every field is optional in a reusable fragment, but the resolved final stack
must make each renderer parameter applicable. `hachureAngle`, `hachureGap`,
and `fillWeight` require `fill: 'hachure'`; `washOpacity` and `washEdge`
require `fill: 'wash'`. Crisp/default rendering does not reinterpret
`fill: 'none'` or `fill: 'solid'`, so those values must be combined with a
field that selects the rough or hybrid backend. Rendering fails with a stable
`Invalid style spec` dependency diagnostic when a final stack would otherwise
change request identity without realizing that customization.

Canonical registered identities say what is being named: `look:hand-drawn`
and `palette:dracula`. Discovery exposes exactly one `kind` (`look` or
`palette`), an explicit `isDefault`, and a stable `inputName`. Stable short
inputs such as `hand-drawn` and `dracula` are not deprecation aliases.
`aliases` contains only temporary compatibility spellings, each with a
diagnostic and removal release/date. The historically ambiguous `tufte` alias
continues to mean `look:tufte` until release 0.3.0 after 2027-01-31; discovery
advertises `look:tufte` and `palette:tufte` so neither meaning is implicit.
Likewise, use the stable `crisp` input instead of the diagnosed `default`
compatibility alias.

## The contract you get for free

- **Any Look × any Palette.** Your `colors` are *defaults*: anything the user
  sets via `RenderOptions` colors or Mermaid `themeVariables` wins. The full
  precedence is one line: `defaults < style stack (left→right) <
  themeVariables < explicit color options`.
- **Determinism.** All stochastic marks are seeded
  `hash(options.seed, stableNodeId, substream)`. Source, resolved options,
  frozen registry/capability/resource snapshots, runtime contract and seed fix
  the bytes. `seed` re-rolls wobble without moving layout. Opt-in caller or
  system fonts make PNG provenance `host-dependent`; the logical request
  receipt is not a final-byte digest.
- **Semantics survive the graphical pipeline.** Markers, hit geometry and
  strict-security guarantees pass through every backend. SVG retains
  inspectable `class`/`data-*` identity and ARIA; PNG rasterizes the same
  secured geometry and appearance but cannot embed DOM attributes in pixels.
  Text is drawn last, never perturbed, with a page-colored halo (labels stay
  legible on any fill).
- **Crisp is sacred.** `style: 'crisp'` (or unset) is byte-identical to the
  plain renderer and gated by a corpus-wide equivalence test.

## Field reference

<!-- BEGIN GENERATED STYLE SPEC FIELDS -->
| Group | Field | Type / values | Meaning |
|---|---|---|---|
| metadata | `formatVersion` | `1` | Persisted wire-format version. Optional on input and normalized to 1 on output. |
| metadata | `$schema` | `string` | Optional JSON Schema pointer for file-backed styles; ignored while rendering. |
| metadata | `name` | `string` | Canonical look:name or palette:name identity; required only when registering a style. |
| metadata | `blurb` | `string` | Short human-readable description used by discovery surfaces. |
| palette | `colors` | object: `bg`, `fg`, `line`, `accent`, `muted`, `surface`, `border` | Partial palette of safe, non-fetching CSS color tokens. |
| typography | `font` | `string` | Safe, non-fetching CSS font family or stack; the rendering environment supplies the font face. |
| stroke | `stroke` | `crisp` \| `jittered` \| `freehand` | Stroke treatment; crisp is the default renderer. |
| stroke | `roughness` | `number`; minimum 0; maximum 10 | Rough.js stroke irregularity. |
| stroke | `bowing` | `number`; minimum 0; maximum 10 | Rough.js line bowing. |
| stroke | `passes` | `integer`; minimum 1; maximum 8 | Number of sketch strokes; 1 is single-pass and 2 is the usual double stroke. |
| stroke | `strokeWidth` | `number`; greater than 0; maximum 20 | Base stroke width in SVG user units. |
| fill | `fill` | `none` \| `hachure` \| `solid` \| `wash` | Fill policy for rough/hybrid rendering; none and solid require a final stack that activates one of those backends. |
| fill | `hachureAngle` | `number`; minimum -360; maximum 360 | Hachure line angle in degrees; requires fill hachure in the final stack. |
| fill | `hachureGap` | `number`; greater than 0; maximum 100 | Gap between hachure lines; requires fill hachure in the final stack. |
| fill | `fillWeight` | `number`; greater than 0; maximum 20 | Hachure line weight; requires fill hachure in the final stack. |
| fill | `washOpacity` | `number`; minimum 0; maximum 1 | Watercolor glaze opacity; requires fill wash in the final stack. |
| fill | `washEdge` | `number`; minimum 0; maximum 1 | Watercolor edge-darkening opacity; requires fill wash in the final stack. |
| page | `backdrop` | `plain` \| `paper-ruled` \| `grid` | Flat page furniture drawn behind the diagram. |
| advisory | `intent` | `premium` \| `draft` \| `lofi` | Advisory intent metadata for pickers and quality tooling. |
| advisory | `mono` | `boolean` | Advisory monochrome contract: express tone through shading and weight. |
<!-- END GENERATED STYLE SPEC FIELDS -->

The field table is generated from the same descriptors that define the
TypeScript type, runtime validator, and published JSON Schema. SVG declares a
style's `font`; PNG resolves verified bundled faces plus caller-supplied
`fontDirs` and then uses its documented fallback. See
[Fonts in custom styles](./custom-fonts.md).

JSON style records are first-class: `validateStyleSpec(json)` returns a list
of problems (`[]` means the value is structurally admissible as a fragment;
final-stack applicability is checked during resolution). Renderer-consumed
fields are declarative-only and cannot carry markup, scripts, or fetching URLs,
so validated records are safe to load from files and prompts and compatible with
`security: 'strict'`.
`$schema` is ignored metadata and may, intentionally, be a schema URL.

For file-backed styles, use the schema at
[`docs/schemas/style-spec.schema.json`](./schemas/style-spec.schema.json), also
published as `agentic-mermaid/style-spec.schema.json`. The
[`custom style cookbook`](./custom-style-cookbook.md) has complete JSON files,
screenshots, and CLI commands. For font resolution across SVG, PNG, browser,
and MCP surfaces, see [Fonts in custom styles](./custom-fonts.md).

JSON Schema provides editor discovery plus all structurally expressible type,
enum, and numeric constraints. Runtime `validateStyleSpec` is the normative
admission boundary and additionally enforces the recursive safe-color grammar;
the generated schema marks those leaves with
`x-agentic-mermaid-runtime-validator: safeCssColor` instead of pretending a
portable regular expression can validate nested CSS color functions.

Only a genuinely **new capability** (a new fill algorithm, compositor, or
layout-aware dialect) justifies code. Trusted hosts can implement and register
a namespaced `StyleBackend`; selection is an in-process `HostBackendPolicy`,
not serializable Style data or a CLI/MCP/editor field. Keep the determinism rule
(seed in, bytes out). Backends never dispatch on diagram family — they see
semantic scene marks and paint channels. A registered backend also declares
feature/operation-level `PrimitiveCapabilityClaim`s for every core Scene
primitive; registration rejects empty, duplicate, or cross-target claims so an
extension cannot imply support it has not described. Registration then executes
a frozen document fixture plus one exact witness for each declared first-party
core primitive/feature/operation claim. It rejects a backend that varies
identical `drawNode`/`render` calls, emits unsafe or malformed SVG, drops the
document sentinels, or fails any claim-keyed witness. Namespaced extension claims
with no core witness remain explicitly `unverified-extension`.
`runBackendConformance` exposes the immutable report and
`knownBackendDescriptors()` retains it for discovery.

Host backends must opt into both the versioned core lifecycle and Scene wire
contract explicitly; no built-in compatibility default is borrowed by
`registerBackend`:

```ts
registerBackend(backend, {
  version: '1.0.0',
  compatibility: { core: '^0.1.1', scene: '^1.0.0' },
  provenance: { owner: 'acme-diagrams', source: 'application-startup' },
})
```

The host validates this identity and both ranges before executing any
conformance witness. Every external `FamilyDescriptor` declares a compatible
`core` range; one that provides `lowerScene` must additionally include
`scene: '^1.0.0'` in `identity.compatibility`. A family that remains
source-only or uses the direct-SVG extension fallback does not consume Scene.

Every external family supplies one bounded canonical `example`.
`registerFamily` stages the immutable descriptor and runs every declared
native capability twice through the canonical parse/serialize, layout, strict
SVG, portable PNG pre-raster, terminal, Scene and verification paths. It rolls
the candidate back if a hook throws, changes output between runs, mutates the
registry reentrantly, emits an invalid raster envelope, or fails to witness a
positive Scene role/primitive declaration. `getFamilyConformanceReport` and
`am capabilities --json` expose the immutable evidence; a declaration without
a passed witness is never projected as `native`.

Each admission report is deliberately bounded. Backend admission directly proves SVG behavior
for the named document and exact core claim witnesses; it does not certify a
namespaced extension claim or family-scale visual, bounds, hit-testing, and
performance behavior. Extension authors still need those tests for what they
advertise. PNG is not a second backend conformance target: it inherits the
admitted secured SVG through canonical rasterizers, whose own parity and
color-profile suites are separate.

## The quality rubric — what makes a style GOOD

The mechanics above are the easy part. Across the built-in catalog, the
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
bun run style:audit                         # Style + Palette contract across families
bun test src/__tests__/styled-output.test.ts   # determinism + goldens + composition
bun test src/__tests__/scene-fidelity.test.ts  # semantic/crisp agreement
bun test src/__tests__/svg-equivalence.test.ts # crisp path untouched
```

Then render your style across every registered diagram type and *look at it small*
— the poster/contact-sheet harness in `scripts/sketch-prototype/` is the
visual-review surface. A style ships when it is distinctive at a glance,
legible at cell size, and honest to its intent.
