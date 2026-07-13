# Brand primitives and forward-compatible family support — plan

Status: revised discovery and execution plan. The capability baseline is this
PR after its 14-family-contract rebase, with Mermaid `11.16.0`. The current
product has 14 native registered families. Mermaid 11.16 has 30 user-facing core
families plus the first-party external ZenUML family: 31 families in the
official public surface.

## Decision

The original direction still makes sense, but the scope and architecture need
to be more precise before implementation:

1. Keep **Look + Palette** as the low floor.
2. Add a small public, semantic **Brand primitives** layer rather than restoring
   the old arbitrary `style.node` / `style.edge` / `style.group` API.
3. Add **semantic bindings** so authored classes, categories, statuses, and
   metadata can select brand slots without embedding raw CSS or SVG.
4. Add a composable, deterministic **Treatment** extension between JSON and a
   wholesale drawing backend.
5. Resolve all appearance inputs once into one immutable `ResolvedAppearance` shared
   by layout, Scene lowering, SVG, and PNG.
6. Treat Mermaid family and syntax growth as a versioned protocol. A new header
   must be recognized and preserved or diagnosed without being silently routed
   to Flowchart, even before Agentic Mermaid can render it.
7. Consolidate sources of truth as part of the work. Brand extensibility is not
   credible while family detection, style fields, option transport, semantic
   roles, or capability claims can drift between code paths.

This plan is the normative product and architecture decision. The
[`cupertino-style-plan.md`](./cupertino-style-plan.md) is one probe and execution
work package; it does not independently decide the public brand API. Current
family citizenship remains governed by
[`diagram-family-citizenship.md`](../contributing/diagram-family-citizenship.md),
and actionable work remains owned by [`TODO.md`](../../TODO.md).

## Vocabulary and claim boundary

Use these terms consistently in code, docs, tests, and product copy:

| Term | Meaning |
|---|---|
| **Look** | Geometry or material treatment such as crisp, hand-drawn, watercolor, or publication. |
| **Palette** | Semantic color values. A colors-only style is a palette. |
| **Brand primitives** | Role typography, spacing, shape, border, elevation, semantic status/category slots, and non-color visual cues. |
| **Mode** | One independently selectable context axis and value, such as `colorScheme: dark`, `contrast: high`, or `density: compact`; not a flattened combination name. |
| **Semantic policy** | Ordered bindings from authored/domain meaning to brand slots plus constraints evaluated over resolved tokens or Scene marks. |
| **Treatment** | A runtime-ordered, deterministic typed Scene transformation pass for a signature effect that does not merit a general JSON field. |
| **Brand pack** | A versioned distributable record containing mode axes, token mappings, constraints, resources, and optional Treatment references. |
| **Family** | One Mermaid diagram language and visual metaphor, not one renderer or layout-engine variant. |
| **Syntax feature** | A documented construct within a family: a header alias, statement, shape, label form, directive, config key, style directive, interaction, or asset reference. |
| **Native syntax** | Parsed with semantic effect, round-tripped, verified, laid out, rendered, and tested on the claimed output. |
| **Native realization** | Implemented directly in the selected backend/output without lowering to a different primitive. |
| **Emulated** | Lowered in software to a semantically faithful representation because the target has no native facility; this is still tested, not assumed. |
| **Projected** | The same semantic intent is represented through an output/backend-specific form without material information loss; differences are documented and tested. |
| **Lossy** | Recognized and rendered with declared information loss plus a stable diagnostic; never silently counted as native parity. |
| **Source-preserved** | Kept byte-faithfully but not available for structured mutation or native rendering. This is not native support. |
| **Unsupported** | Recognized but unavailable for the requested family/backend/output/host capability; the request fails or degrades only according to an explicit policy. |
| **Diagnosed** | Rejected or made inert with a stable, actionable reason. This is not support. |
| **Absent** | Neither recognized nor accounted for. This is a bug for a syntax feature in the pinned upstream manifest. |
| **Not applicable** | The feature has no meaning for that family, operation, backend, or output, with a recorded rationale. |

Do not mix two state schemas. `FamilySyntaxState` is `native |
source-preserved | diagnosed | absent | not-applicable`; it records what the
library understands about upstream syntax and operations. `RealizationState` is
`native | emulated | projected | lossy | unsupported`; it records how one
backend/output realizes a negotiated semantic primitive. A faithful Canvas
arrowhead can therefore be `emulated`, while an ASCII arrowhead is `projected`.
Neither is confused with byte-preserving an unparsed Mermaid feature.

Never say “all Mermaid families” when the evidence quantifies only over
`BUILTIN_FAMILY_METADATA`. Say “all registered Agentic Mermaid families.” A
family is “supported” only for the explicitly advertised capability and output;
a non-empty SVG, parser acceptance, or source preservation is not enough.

## Goal and success criteria

Enable a brand to express a coherent design system across every registered
Agentic Mermaid family, while making it cheap and safe to adopt every stable
Mermaid family that exists now or appears later.

The plan succeeds when:

- a nontechnical user can choose a preset, compose a Look and Palette, or load a
  JSON brand pack;
- a designer can bind local domain meaning to semantic brand slots without raw
  CSS, SVG, or family-specific renderer knowledge;
- an expert can add a deterministic treatment without replacing the compositor;
- a backend author can still implement genuinely new drawing machinery;
- every entry point produces the same shared resolved-request and resolved-appearance
  digests for the same input; output-specific projections are explicit;
- SVG and PNG consume the same `ResolvedAppearance` and render request, while terminal
  output consumes a defined semantic projection of that brand rather than a
  disconnected theme model;
- adding a family is primarily one adapter plus family-specific semantics, not a
  hunt through duplicated switches, schemas, docs, editors, and transports;
- upgrading Mermaid produces a machine-readable diff of added families, headers,
  syntax, config, theme variables, and maturity changes;
- every current or future family has explicit capability cells rather than an
  ambiguous boolean “supported” flag.

### Parity contract

“Parity” does not mean that a PNG scale control must appear in ASCII, or that
font weight has a literal ANSI equivalent. It has three independently tested
levels:

1. **Contract parity:** every shared public field has the same name, type,
   validation, precedence, default, and diagnostic meaning in the library,
   CLI, local and hosted MCP, editor, and website. A curated UI may hide advanced
   fields behind JSON import or an advanced panel, but it may not make them
   unreachable.
2. **Transport parity:** equivalent input through each entry point produces the
   same canonical `ResolvedRenderRequest` and `ResolvedAppearance` digests after
   excluding declared output-only fields. No adapter silently drops or rewrites
   a shared field.
3. **Output parity:** SVG and PNG preserve the same branded geometry, paint,
   semantic identity, accessibility, security decisions, and deterministic
   resources, subject only to declared raster concerns. ASCII/Unicode preserves
   semantic role, hierarchy, emphasis, status/category selection, and
   diagnostics through a terminal projection; it does not claim pixel or
   typographic equivalence.

Backend parity is semantic, not pictorial. `default`, `rough`, and `hybrid` are
supposed to draw different pixels, but must consume the same resolved geometry,
roles, connector semantics, authored-style precedence, identity, accessibility,
security, resources, and diagnostics. A backend may deliberately project a
primitive into its drawing language; it may not silently ignore it.

Parity evidence is factored rather than hidden in one impossible Cartesian
golden suite:

- transport x shared field proves request receipt and resolution;
- family x role/primitive proves semantic consumption and fallback;
- first-party backend x Scene mark/primitive proves rendering-contract parity;
- output x semantic/security contract proves SVG, PNG, ASCII and Unicode
  projection behavior;
- a small sentinel cross-product catches interactions between those dimensions.

Each matrix declares which of those two schemas it uses. `diagnosed` is an
accountable inventory state, not permission for a shared field to remain missing
indefinitely: the matrix must record an owner or an explicit product decision.
Release claims state the parity level and output, never the unqualified phrase
“full parity.”

## What the three brand probes established

| Probe | Source | What it proves |
|---|---|---|
| `cupertino` | emilkowalski's apple-design skill and public Apple design guidance | A borderless surface language needs elevation, role typography, radius and spacing discipline, designed modes, and semantic accent placement. |
| `vercel` | vercel-labs/beautiful-mermaid and the Geist visual language | Brand defaults, deterministic fonts, hairlines, live retheming, and motion cannot be represented completely by the current public JSON surface. |
| `cf-workers` | CF Workers design-system tokens | Real brands need surface/text ramps, strong+soft categories, status colors, sans+mono roles, scales, tinted layered shadows, signature treatments, and enforceable constraints. |

The current public `StyleSpec` provides seven palette slots, one font, sketch
stroke/fill controls, three backdrops, intent/mono metadata, and backend
selection. `RenderOptions` adds explicit colors, global spacing, font, shadow,
security, interactivity, family options, config, and output controls. Mermaid
source adds per-element `classDef`, `class`, `style`, `linkStyle`, metadata, and
family-specific semantics. These are useful customization points, but they are
not yet one portable brand record:

- role typography, padding, radii, and role colors exist only in the private
  `InternalStyleFace` used by built-ins;
- semantic Scene channels already carry importance, value, category, status,
  progress, route, and emphasis, but there is no public binding contract;
- PNG accepts only a subset of SVG render options and therefore cannot reproduce
  every branded SVG request;
- ASCII/Unicode has a separate theme and spacing model and does not consume
  Style + Palette;
- editor, CLI, local/hosted MCP, SDK, and website expose different subsets;
- `registerBackend` accepts arbitrary backend IDs, while public `StyleSpec` and
  validation accept only `default | rough | hybrid`, so a newly registered ID
  cannot be selected through the documented public style path;
- `registerFamily` is documented as an extension point, but its `id` is the
  closed 14-member `DiagramKind` and core source routing also uses a closed
  union. It can replace an existing family more honestly than it can add one.

These inconsistencies are plan inputs, not documentation footnotes.

### Current customization and extension inventory

This is the complete public customization inventory at the baseline. It records
what exists, not what every transport exposes correctly.

| Surface | Current customization points |
|---|---|
| `StyleSpec` identity | `$schema`, `name`, `blurb` |
| `StyleSpec.colors` | `bg`, `fg`, `line`, `accent`, `muted`, `surface`, `border` |
| `StyleSpec` typography | `font` |
| `StyleSpec` stroke | `stroke`, `roughness`, `bowing`, `passes`, `strokeWidth` |
| `StyleSpec` fill | `fill`, `hachureAngle`, `hachureGap`, `fillWeight`, `washOpacity`, `washEdge` |
| `StyleSpec` page/treatment | `backdrop` |
| `StyleSpec` expert/advisory | `backend`, `intent`, `mono` |
| style composition | named Look or Palette, anonymous inline spec, or left-to-right `StyleInput[]` stack; `registerStyle`, `resolveStyleStack`, `fromShikiTheme`, and built-in `THEMES` support reuse/conversion |
| `RenderOptions` palette/type | `bg`, `fg`, `line`, `accent`, `muted`, `surface`, `border`, `font`, `style`, `seed` |
| `RenderOptions` geometry | `padding`, `nodeSpacing`, `layerSpacing`, `wrappingWidth`, `componentSpacing` |
| `RenderOptions` visual/output | `transparent`, `interactive`, `shadow`, `embedFontImport`, `compact`, `idPrefix`, `security` |
| `RenderOptions` family behavior | `class.hierarchicalNamespaces`, `architecture.visual`, `timeline.maxWidth`, `journey.experienceCurve`, `gantt.dependencyArrows`, `gantt.criticalPath`, `ganttToday` |
| `RenderOptions` Mermaid config/diagnostics | `mermaidConfig`, `onConfigDiagnostic` |
| `PngOptions` raster/font | `scale`, `background`, `fitTo`, `fontDirs`, `loadSystemFonts`, `onWarning`; only `style`, `seed`, and `ganttToday` currently forward into the SVG request |
| `AsciiRenderOptions` terminal | `useAscii`, `paddingX`, `paddingY`, `boxBorderPadding`, `colorMode`, `theme`, `mermaidConfig`, `maxWidth`, `targetWidth`, `ganttToday` |
| Mermaid source | frontmatter and init config; title/accessibility; family syntax and metadata; `classDef`, `class`, `:::`, `style`, `linkStyle`; safe links/click metadata where supported; direction/layout/look/renderer settings; icons/images subject to family and security policy |
| SVG post-render | documented CSS custom properties plus emitted class/data/semantic identity hooks allow live retheming and inspection; direct DOM rewrites are not portable brand configuration |

The public programmatic extension points are:

| Extension point | Intended use | Baseline truth |
|---|---|---|
| `registerStyle(StyleSpec)` | reusable declarative Look or Palette | works, JSON-safe, and stackable; cannot register private face fields |
| `registerBackend(StyleBackend)` | new compositor/drawing algorithm over Scene marks | registration works, but arbitrary IDs cannot currently be selected by valid public `StyleSpec` |
| `registerFamily(FamilyPlugin)` | parser/mutation/verification/layout/Scene/SVG/ASCII family hooks | hooks exist, but the closed `DiagramKind` and hard-coded routing prevent a truthful new typed family without core edits/casts |
| `FamilyPlugin.lowerScene` + exported Scene types | semantic lowering consumed by styled backends | required for styled rendering, but “has a lowering” is too coarse while roles/features can remain raw or unconsumed |
| custom style/font files | portable JSON fragments and caller font directories | style JSON works; SVG may name any font, while deterministic PNG requires bundled/caller-provided font coverage |
| Mermaid-authored classes/styles/config | local semantic and per-element customization inside source | family-dependent; must remain preserved, security-checked, and ordered after global brand defaults |

`getStyle`, `knownStyles`, `getBackend`, `knownFamilies`, validation, schemas,
and capability commands are the discovery half of those extension points. Their
output must be derived from the same registrations and capability evidence.

## Design principles from emergence and compositionality

Kasey Klimes's
[“When to Design for Emergence”](https://uxmag.com/articles/when-to-design-for-emergence)
frames brand styling as a long-tail problem. Purpose-built defaults serve common
needs, while a small alphabet and shared joining protocol let users apply local
knowledge to outcomes the library did not anticipate. The relevant tests are:
meaningful surprise, use of contextual knowledge, and a useful result without
technical training. That implies low floors, wide walls, and high ceilings.

Jules Hedges's
[“On compositionality”](https://julesh.com/posts/2017-04-22-on-compositionality.html)
adds the necessary engineering constraint: users should be able to build and
reason recursively through stable interfaces while forgetting implementation
details. Composition is not merely “many knobs”; it needs predictable laws and
local reasoning.

The two ideas are complementary only when we distinguish levels:

> Enable surprising user outcomes at the product level while eliminating
> surprising interactions at the implementation level.

`registerBackend` is an expert ceiling, but it does not meet Klimes's
nontechnical criterion. The missing middle is public semantic bindings plus a
small Treatment protocol. Conversely, a field for every discovered brand detail
would create a wide but non-compositional schema. General primitives enter the
alphabet only when they have brand-independent meaning and lawful merge
semantics; one-off details remain treatments until evidence supports promotion.

### Research and standards basis

The plan treats the literature and industry practice as architectural evidence,
not name-dropping. The following findings change its boundaries and gates:

| Evidence | Consequence for this plan |
|---|---|
| Parnas's information-hiding criterion and program-family work | Section A hides likely-to-change parsing, layout, transport and rendering decisions behind stable behavioral contracts. Section B owns brand variability. Real brand probes discover commonality; holdout brands test whether it generalized. |
| Abstract data types and compositional systems | `ResolvedAppearance`, Scene primitives and extension descriptors specify observable behavior and composition laws, not renderer representation. A stack is not compositional merely because it accepts many entries. |
| Software product-line and feature-model practice | Core assets and variability are explicit; mode axes and compatibility constraints replace a flat list of combinations. A-before-B is dependency direction with iterative feedback, not a waterfall. |
| Open implementations and architectural-mismatch research | The plan offers a graduated ladder: declarative fragments/BrandPacks, then a narrow Treatment meta-level, then a backend escape hatch. Descriptors declare lifecycle, data/control flow, resources and environment as well as types. |
| End-to-end and extension-design guidance | Core preserves identity, semantics and provenance; end surfaces validate accessibility, security, resource availability and actual output. Extensions negotiate capabilities, versions and failure behavior instead of relying on permissive parsing. |
| DTCG 2025.10 and mature design systems | Brand tokens remain typed and portable, with explicit alias resolution, orthogonal modes, semantic foreground/background pairs, data-palette intent, deprecation metadata and mappings into Agentic Mermaid roles. |
| SVG 2 paths/painting/markers and Filter Effects | Connectors expose topology, tangents, caps, joins, miters, dashes, markers and effect-aware bounds as one cross-backend contract rather than reconstructing them from SVG strings. |
| Conformance and combinatorial-testing practice | Exhaustive one-dimensional contract tests are combined with constrained t-way interactions, targeted high-risk cases, reference tests and versioned conformance reports against actual renderer implementations. |

The architectural waist must remain small, but “small” does not mean one giant
`Resolved*` record. It means a few versioned behavioral protocols composed from
cohesive immutable subrecords, with namespaced extensions and explicit
capability negotiation. This avoids turning today's common representation into
tomorrow's permanent bottleneck.

## Target brand model

### Authoring and capability ladder

The low floor and high ceiling are separate product requirements. Each step adds
power without invalidating the one below it, and a user moves up only when the
brand requires it. The effort ranges are order-of-magnitude authoring estimates,
not delivery promises; production review across families, sizes, contrast modes,
fonts, and outputs usually costs more than writing the record.

| Level | Authoring path | Typical mechanical effort | Capability and intended user |
|---|---|---:|---|
| 0. Preset | choose a named Look or Palette | seconds | nontechnical user; no file or code |
| 1. Composition | stack Look + Palette and change a few fields in the editor or inline request | minutes | global colors, font, stroke, fill, backdrop and deterministic seed |
| 2. Custom Look | save and validate a reusable JSON fragment | tens of minutes; hours with visual review | the current `StyleSpec` low floor, without registration or family knowledge |
| 3. Brand pack | map existing design tokens, roles and modes into versioned JSON | hours to days depending on token quality | designer/design-system owner; portable typography, geometry, elevation and modes |
| 4. Semantic policy | add class/tag/status/category bindings and constraints | hours plus cross-family QA | domain-aware branding without selectors or renderer code |
| 5. Treatment | publish a trusted TypeScript extension and pass conformance | days | signature ornaments or material effects over typed Scene marks |
| 6. Backend | implement and register a compositor/drawing algorithm | multi-day expert work | genuinely new rendering machinery, not ordinary branding |

Levels 0–2 exist today, although Level 2 is less capable than built-in styles.
Levels 3–5 are proposed APIs. Level 6 exists in partial form but needs truthful
selection, versioning, packaging and conformance. Existing named styles,
`StyleInput[]` stacks, inline records and style JSON files remain valid and
compile through the new resolver; a pack name or version is never required for
the low-floor workflows.

These are capability tiers over one algebra, not incompatible schemas. Level 2
today is the legacy reusable `StyleSpec` subset. B0 introduces
`AppearanceFragment`, which later phases enrich with roles and may carry B3
bindings/constraints inline. A BrandPack packages fragments, modes and policy for
reuse; it is not required to unlock those semantics.

The author-effort gate is therefore not merely “the schema validates.” An
unfamiliar user must be able to create a palette-only Look, a role-rich brand,
and a status-bound brand without editing a family adapter. Advanced UI may be
progressively disclosed, but the same JSON must remain usable through every
public entry point.

### Composable inputs and runtime stages

The public conceptual model is:

```
Look / Palette / AppearanceFragment / BrandSelection
              + source styling + explicit render overrides
                             |
                     resolveAppearance
                             v
                   ResolvedAppearance
                             |
             phase-checked Scene Treatments
                             v
                      backend/output
```

The input stack has lawful precedence; these arrows show compilation stages,
not another inheritance or merge order. A Look or Palette can be used alone,
stacked with the other inputs, or packaged inside a BrandPack.

All declarative fragments remain partial and JSON-safe. A candidate public
shape, subject to schema design, is:

#### What a BrandPack is and why it exists

An `AppearanceFragment` answers “change these appearance values for this
render.” A **BrandPack** answers “install and reproduce this named design system
over time and across tools.” It is a versioned declarative manifest that can
contain a base fragment, orthogonal modes, semantic tokens, role defaults, bindings,
constraints, and references to installed resources or trusted Treatments.

The pack exists because a pile of render options is not a distributable design
system: it has no identity, compatibility range, mode selection, token
mapping, dependency/resource declaration, migration story or conflict policy.
Conversely, a pack is deliberately unnecessary for one-off customization. It
contains no executable code, markup, callbacks or ambient URLs; code and binary
resources live in separately installed, integrity-checked, host-allowlisted
packages that the declarative pack may reference.

```ts
interface BrandPack {
  $schema: string
  id: NamespacedId
  displayName?: string
  version: string
  compatibility: { core: SemverRange; scene?: SemverRange }
  tokenMappings?: TokenMapping[]
  requires?: ExtensionRequirement[]
  resources?: ResourceRequirement[]
  $description?: string
  $deprecated?: boolean | string
  $extensions?: Record<NamespacedId, JsonValue>
  base?: AppearanceFragment
  modes?: {
    axes: Record<string, {
      default: string
      values: Record<string, AppearanceFragment>
    }>
    resolutionOrder: string[]
    combinations?: Array<{
      when: Record<string, string>
      apply: AppearanceFragment
    }>
  }
}

interface AppearanceFragment {
  // Compatibility-normalized form of the current StyleSpec Look fields:
  // stroke/fill algorithms and tuning, backdrop, intent and mono. Legacy
  // font, color and width fields normalize into tokens/roles so they do not
  // create overlapping canonical leaves.
  look?: StyleLookFragment
  tokens?: {
    definitions?: Record<TokenId, TokenDefinition>
    colors?: {
      page?: ColorToken
      surfaces?: Partial<Record<'base' | 'raised' | 'sunken' | 'overlay', ColorToken>>
      text?: Partial<Record<'primary' | 'secondary' | 'muted' | 'inverse', ColorToken>>
      line?: ColorToken
      border?: ColorToken
      accent?: SemanticColorPair
      statuses?: Partial<Record<'success' | 'warning' | 'error' | 'info', SemanticColorPair>>
      categories?: Record<string, SemanticColorPair>
      data?: {
        qualitative?: { series: SemanticColorPair[]; overflow: 'cycle' | 'error' }
        sequential?: ColorScale
        diverging?: ColorScale
      }
    }
    discriminators?: {
      statuses?: Partial<Record<'success' | 'warning' | 'error' | 'info', NonColorCue>>
      categories?: Record<string, NonColorCue>
      series?: NonColorCue[]
    }
    typography?: {
      families?: { sans?: FontStackRef; mono?: FontStackRef }
      roles?: Partial<Record<BrandTextRole, TextToken>>
    }
    geometry?: {
      radii?: Record<string, DimensionToken>
      spacing?: Record<string, DimensionToken>
      borderWidths?: Record<string, DimensionToken>
      dashPatterns?: Record<string, DashToken>
    }
    elevation?: Record<string, ElevationToken>
  }
  roles?: Partial<Record<BrandRole, BrandRoleStyle>>
  bindings?: SemanticBinding[]
  constraints?: BrandConstraint[]
  treatments?: TreatmentRef[]
}

interface TokenDefinition<T = TokenValue> {
  $type?: TokenType
  $value: T | TokenRef
  $description?: string
  $deprecated?: boolean | string
  $extensions?: Record<NamespacedId, JsonValue>
}

type ColorToken = TokenRef | TypedColor
type SemanticColorPair = {
  strong: ColorToken
  onStrong: ColorToken
  soft?: ColorToken
  onSoft?: ColorToken
  border?: ColorToken
  icon?: ColorToken
}

interface ColorScale {
  stops: Array<{ position: number; color: ColorToken }>
  interpolationSpace: ColorSpace
  domain?: [number, number]
  midpoint?: number
  sampling: 'continuous' | { steps: number }
  overflow: 'clamp' | 'error'
}

interface NonColorCue {
  symbol?: string
  marker?: MarkerToken
  dash?: DashToken
  hatch?: HatchToken
}

type FontStackRef = ResourceRef | { resources: ResourceRef[]; genericFallback?: string }
```

Mode axes are orthogonal where possible: `colorScheme`, `contrast`, `density`,
`scale`, and future platform/accessibility contexts are selected independently
instead of flattening combinations such as `darkHighContrastCompact` into one
ever-growing mode name. Every axis declares a default and
`resolutionOrder` is an exact permutation of its axes. The normative expansion
is `base < selected axis fragments in resolutionOrder < matching combinations
in listed order < later AppearanceInput entries`. Duplicate JSON keys, omitted
defaults, unknown axes/values and an invalid resolution order are errors;
overlapping matching combinations use the explicit list order and are diagnosed
for review. A host-derived selection is materialized into the resolved request
and digest rather than remaining ambient context. DTCG Resolver documents may
be mapped into this selection model rather than reauthored by hand.

`StyleSpec` is a compatibility facade and the Level 2 fragment format, not a
second resolver. Its public fields normalize into `AppearanceFragment` before
merge. Preserve `RenderOptions.style` unchanged and add one optional stack that
can take a small inline fragment or a packaged brand selection:

```ts
interface BrandSelection {
  pack: string | BrandPack
  modes?: Record<string, string>
}

type AppearanceInput = AppearanceFragment | BrandSelection

interface RenderOptions {
  style?: StyleInput | StyleInput[]
  appearance?: AppearanceInput | AppearanceInput[]
}
```

Resolution expands `style` first, then each explicit appearance input from left
to right, then source styling and explicit render overrides according to the
precedence below. A fragment is validated inline; a namespaced pack ID resolves
through the brand registry. This keeps “make corners 8px” at the low floor
while reserving BrandPacks for identity, modes, reuse and distribution. The
transport shape is frozen in Section B and shared by all surfaces; the CLI, MCP,
and editor do not invent separate inputs.

The public registry/discovery floor mirrors styles:
`validateBrandPack`, `registerBrandPack`, `getBrandPack`, `knownBrandPacks`, and
the pure `resolveAppearance`. Registration is namespaced and collision-safe;
loading or validating inline JSON does not register it or activate referenced
Treatments automatically.

BrandPack migrations are separately registered pure transforms keyed by schema/
pack version; declarative JSON may request a known migration but cannot embed or
execute migration code.

The stable Design Tokens Community Group 2025.10 reports are the interchange
baseline, not a schema to copy wholesale: they are Community Group Final Reports,
not W3C Recommendations. BrandPacks accept explicit mappings from typed DTCG
tokens/resolver contexts into Agentic Mermaid roles. Preserve standard
description/deprecation metadata and inert namespaced `$extensions`; do not
guess meaning from arbitrary group names or vendor token paths.

Token values and references remain typed. Semantic slots and role properties
normally reference `definitions`; assemble the effective graph after stack/mode
expansion and only then resolve aliases. Cycles, unknown references and type
mismatches are errors. Typed colors retain color space and alpha in
`ResolvedAppearance`; `ResolvedRenderRequest` declares the target output profile,
conversion and gamut policy so SVG and PNG make the same conversion.
Foreground/background pairs, named semantic categories and distinct qualitative,
sequential and diverging data palettes are first-class because a lone status
color or generic array cannot guarantee contrast or chart semantics. Non-color
cues carry the same distinctions into high-contrast and no-color outputs.

`FontStackRef` resolves through the installed resource registry. The frozen
render snapshot records the selected face resource/content hash, face index,
weight/style, glyph coverage and a metrics/shaping fingerprint. Unrestricted
system-font lookup is explicitly non-reproducible unless the selected faces and
hashes are captured in that snapshot; a family-name string alone is not a
portable font identity.

The exact JSON names are held stable by a versioned schema. Prefer named scale
slots; ordered arrays are reserved for genuinely ordered palettes with explicit
cycling/overflow behavior. Renderers never depend on positional magic. Packs compose only
through the caller's explicit Style/Brand stack—there is no second hidden
`extends` graph. Token arrays are atomic replacement leaves. Treatment references
compose in stable left-to-right order by fully qualified ID: an exact duplicate
is idempotently de-duplicated, a later compatible reference updates options
without moving its first position, and incompatible versions/options fail with a
conflict diagnostic.

JSON `null` is rejected in v1 rather than acquiring an accidental clear/reset
meaning; omission means inherit. A later reset operation requires an explicit
typed sentinel and composition laws. V1 bindings are equality matches over
normalized class, tag, status, category and namespaced metadata fields. CSS
selectors, tree queries, arbitrary predicates and renderer-private fields are
not part of the declarative language. V1 constraints report `warn` or `error`;
automatic paint/geometry rewriting is deferred until it has separate
composition laws.

### No built-in privilege

Today a built-in can use private `InternalStyleFace` fields that a custom
`StyleSpec` cannot: text/node/edge/group typography, padding, radius, line
width, fill/border/stroke colors, edge bend radius, group font and header fill.
Built-ins may also rely on preinstalled fonts and automatic registration. That
is an implementation privilege, not an intended product tier.

The target contract is:

- every built-in Look has an exportable public source record and compiling that
  record is behaviorally equivalent to selecting the built-in by name;
- private compiled structures may remain for performance, but must be derived
  from public fields and may not add expressive power;
- current private face values migrate to public core roles and brand primitives,
  not to an arbitrary per-element styling object;
- a third-party installed package can bundle license-compatible fonts and
  trusted Treatments/backends through the same namespaced registries and
  conformance suite used by first-party packages;
- standalone untrusted JSON remains intentionally unable to embed executable
  code, markup, callbacks, fonts, or arbitrary URLs. It may reference only
  installed, host-allowlisted resources and extensions.

By B3, a declarative custom brand can exceed a current built-in face in semantic
roles, status/category slots, modes, bindings and constraints. B5 establishes
the same documented extension ceiling for installed third-party and first-party
packages on hosts that install and allowlist the same capabilities; B6 proves
and ships built-in equivalence. The remaining intentional differences are host
trust and installed resources, not private rendering APIs.

| Capability | Public custom style now | Built-in style now | Target custom API |
|---|---|---|---|
| seven colors, global font, stroke/fill/backdrop | native | native | preserved as the Level 2 compatibility floor |
| node/edge/group typography and paint | unavailable | private `InternalStyleFace` | public stable core roles |
| role padding, radii, widths and edge bend | only coarse global render options | private face scalars | public role geometry using shared measurement/render values |
| title, legend, axis, technical and future-family roles | family-specific or unavailable | no universal built-in contract | core plus namespaced roles with required fallback |
| surface/text ramps and sans/mono pairing | unavailable | flat colors and one main font; partial private overrides | named semantic tokens consumed consistently by adapters |
| status/category strong+soft slots and bindings | authored family-local styles | unavailable | declarative normalized bindings over Scene channels |
| light/dark/high-contrast/density modes | separate names/caller stacks | separate names/caller stacks | orthogonal mode axes with deterministic resolution |
| elevation and signature material effects | boolean shadow or whole backend work | renderer/private implementation | declarative elevation tokens or a typed Treatment |
| constraints | advisory `intent`/`mono` only | no enforcement advantage | resolver/Scene `warn | error` constraints |
| distribution and design-token ingestion | style JSON, `fromShikiTheme`, caller fonts | repository registration and bundled fonts | namespaced packs, explicit token mappings and installed resources |
| new compositor | backend registration, but novel IDs are not valid style values | core can wire an ID | selectable namespaced backend with the same conformance contract |

Promoting `InternalStyleFace` alone would close only part of rows two and three.
It would not provide modes, semantic bindings, token ramps, constraints,
packaging, Treatments, transport parity or forward-compatible family roles.

### Semantic role vocabulary

The public roles should be fewer and more stable than Mermaid's family-specific
syntax. Family adapters map concrete marks into this core vocabulary:

| Role group | Candidate core roles | Examples across families |
|---|---|---|
| document | `page`, `title`, `subtitle`, `annotation`, `legend`, `axis`, `grid` | chart titles, Wardley notes, axes, graticules |
| containers | `group`, `groupHeader`, `lane`, `section`, `boundary`, `domain` | subgraphs, swimlanes, C4 boundaries, Kanban columns, Cynefin domains |
| entities | `node`, `actor`, `service`, `record`, `task`, `event`, `field`, `file`, `folder` | flowchart nodes, requirements, commits, packet fields, TreeView entries |
| relations | `edge`, `edgeLabel`, `message`, `lifeline`, `dependency`, `flow` | arrows, sequence signals, Sankey bands, Gantt dependencies |
| data | `series`, `bar`, `point`, `slice`, `area`, `curve`, `set`, `overlap` | XY, Pie, Radar, Treemap, Venn |
| metadata | `label`, `technicalLabel`, `member`, `attribute`, `cardinality`, `badge`, `status`, `progress` | class members, ER cardinalities, Kanban priority, GitGraph tags |

Family-specific roles remain possible through namespaced extension roles, but
must declare a fallback core role. The current closed `SceneRole` union should
therefore evolve into a stable core role plus a namespaced extension identifier,
not grow forever every time Mermaid adds a visual concept.

This is not the removed arbitrary role-style API in another spelling. Core
roles are stable cross-family semantics, never element IDs or selectors;
`BrandRoleStyle` has a closed brand-neutral property whitelist; adapters own the
family mapping and fallback; and measurement and paint consume the same one
resolved value. A candidate core role enters v1 only when at least two unrelated
families or holdout brands need it. Otherwise it remains namespaced until the
evidence generalizes.

Each role descriptor also declares traits such as `shape`, `connector`, `text`,
`identity`, `interactive`, its default brand slot, and its core fallback.
Backends and accessibility/identity policies query those traits rather than
maintaining separate literal role sets that a new family can silently miss.

### Semantic bindings

Bindings map authored meaning, not SVG selectors, to brand slots. Candidate
inputs include:

- Mermaid class names and safe `@{ ... }` metadata;
- normalized family statuses such as Gantt `done | active | crit`, State
  start/end, Kanban priority, GitGraph commit type, or requirement risk;
- structured categories such as service kind, chart series, journey actor,
  lane, section, and domain;
- explicit agent-side tags stored in the semantic IR.

The same binding must mean the same thing across families. For example,
`category:storage -> categories.storage` should resolve to the same strong/soft pair
for an Architecture service, a Flowchart node, a Pie slice, and a Sankey band.
Bindings are ordered, declarative, safe under strict security, and report
unmatched or conflicting selectors.

### Brand constraints

Constraints are not renderer switches. Token-only rules such as “no pure white
page” can run while resolving the brand. Scene rules such as “accent may not be
a large-area fill,” actual contrast, “technical labels use mono,” and “dark
modes use hairlines rather than glow” run **after** authored class/style
cascade, final mark paint/geometry, and Treatments. `ResolvedAppearance` carries
the compiled rules; token constraints run after appearance resolution, while
final Scene constraints run after the last paint Treatment and before the
backend. They return stable diagnostic codes identifying the resolved role/mark
that violated each rule.

### Core accessibility profile

Brand constraints supplement but cannot weaken a core `AccessibilityProfile`.
The final resolved Scene checks WCAG 2.2 contrast thresholds—4.5:1 for normal
text, 3:1 for large text, and 3:1 for meaningful graphical objects and focus
indicators—including every `strong/onStrong` and `soft/onSoft` pair. Status and
category meaning must also have a non-color cue. Interactive SVG preserves
focus, selected, disabled and link semantics.

The default profile emits structured violations; an explicitly requested
strict/accessible render fails on them. Product copy may claim “accessible” only
for an output/profile combination that passes these gates. Brand policy may set
stricter thresholds or additional constraints, never redefine contrast math or
turn a core failure into success.

### Treatment protocol

#### What a Treatment is and why it exists

A **Treatment** is trusted registered code that deterministically transforms or
decorates typed Scene marks after semantic styling is resolved and before final
backend output. It is for a recognizable effect—corner brackets, registration
marks, status chrome, material grain, a ruled-paper ornament—that cannot be
expressed honestly as a general token but also does not require a new drawing
engine.

Treatments fill the gap between declarative fields and a `StyleBackend`:

- a primitive is data with broad, brand-independent meaning;
- a Treatment is a composable signature effect over existing primitives;
- a backend owns a genuinely different compositor or drawing algorithm.

Without Treatments, every one-off effect either bloats the public schema with a
brand-specific boolean or replaces the whole backend. Treatments preserve a
small declarative language and let effects compose over the same semantic marks.
They are not embedded in untrusted BrandPack JSON; a host installs and
allowlists them, and a pack can only reference an allowed namespaced ID.

Add a runtime-owned Scene pass below brand JSON and above the backend:

```ts
registerTreatment({
  descriptor: {
    id: 'acme/corner-brackets',
    kind: 'treatment',
    version: '1.0.0',
    phase: 'geometry',
    scope: 'document',
    reads: ['role', 'channels', 'bounds'],
    writes: ['ornament'],
    preserves: ['semanticIdentity', 'accessibility', 'hitGeometry'],
  },
  apply(scene, ctx) {
    // Return a new typed Scene plus diagnostics. Core owns traversal/order.
    return { scene: ctx.mapMarks(scene, addCornerBrackets), diagnostics: [] }
  },
})
```

Core freezes the registry/capability snapshot, compiles a left-to-right pipeline,
and invokes each pass exactly once; Treatments receive no `next` callback and
cannot skip, duplicate, reorder, or re-enter downstream passes. The phase is a
type boundary, not only an ordering hint:

- `semantic` receives and returns `SemanticScene` before measurement/layout;
- `geometry` receives and returns `PositionedScene` before final bounds/viewBox;
- `paint` receives and returns `BoundedScene`, is in-bounds, and cannot change
  geometry.

`Treatment<P>` therefore has a phase-specific input/output type rather than one
unqualified Scene type. Raw-output transformation is outside the v1 Treatment
protocol; if introduced later, it is a separately privileged extension kind and
is never activatable by a BrandPack. The context contains the family, selected
modes, output, partitioned seed, readonly resource resolver and negotiated
capabilities. Core may provide deterministic `mapMarks` helpers without ceding
traversal ownership.

Before execution, core checks that each pass's emitted mark/trait set is
accepted by the next pass and the selected backend. After execution it validates
declared preservation and bounds invariants. Left-to-right order alone is not a
composition proof: incompatible adjacent passes fail preflight with a stable
diagnostic rather than relying on order-sensitive accidents.

Treatments must be deterministic, immutable-input/pure-output,
family-independent by default, namespaced, composable in declared order,
security-constrained, and unable to inject untyped markup. They may add typed
background patterns, ornaments, edge chips, or status chrome while preserving
identity, hit geometry, ARIA, and PNG parity. A Treatment that dispatches on
many families is evidence that the role vocabulary or family adapter is
incomplete.

Each Treatment declares whether it is `paint-only` and in-bounds, or a typed
Scene transformation that can change bounds. Transforming Treatments run before
final bounds/viewBox calculation and must declare z-order, generated-ID
ownership, hit-target behavior and semantic-parent ownership. The conformance
kit checks clipping, duplicate identity, accessibility, deterministic seed
partitioning, failure isolation and preservation of authored hit geometry.

A post-positioning geometry Treatment may add ornaments or monotonically expand
declared local bounds, but it may not change intrinsic measurement, layout
anchors, obstacle topology, connector routes or semantic endpoints. A pass that
invalidates any of those must run in the semantic phase and declare the required
remeasurement/repositioning; v1 rejects an unsupported invalidation instead of
silently accepting overlaps. Conformance compares declared invalidations with
the traits that actually changed.

The deterministic input is limited to immutable Scene/config, a random stream
partitioned by document seed + Treatment ID/version + semantic mark ID + pass
index, and declared content-addressed resources. Wall clock, environment,
network, ambient filesystem, global mutable state and shared PRNGs are forbidden.

Treatments are trusted registered code, not content embedded in a pack. A host
must explicitly allowlist treatment IDs that declarative packs may activate;
loading untrusted JSON never registers or activates arbitrary code. Treatment
output is limited to typed Scene marks and safe values—no raw CSS, SVG/HTML,
JavaScript, callbacks, ambient I/O, or unapproved URLs.

### One resolved appearance

Every surface compiles the style stack, selected modes, token mapping,
bindings, constraints, treatments, and explicit overrides into one immutable,
versioned `ResolvedAppearance`. Layout reads only geometry-affecting resolved
values; Scene lowering and backends read paint/treatment values from the same
object. No renderer re-merges raw style fragments.

`ResolvedAppearance` is a runtime-owned abstract data type, not an accepted
authoring or persistence format. Consumers receive capability-scoped readonly
views for geometry, paint, resources or constraints rather than depending on its
physical fields. Test digests specify observable equivalence and do not freeze
private record layout.

Global brand styling is a default, not a replacement for authored Mermaid
semantics. The intended paint precedence is:

```
engine defaults < Look/Palette/Brand stack < source theme/config
  < authored class/style/linkStyle < explicit render overrides
```

Treatment passes consume already resolved semantic marks and must declare whether
they add, mask, or replace paint; replacement cannot be the implicit default.
Brand constraints inspect the final outcome and report or deliberately enforce
policy separately rather than silently erasing authored styling.

The composition laws are public API:

1. **Identity:** an empty fragment changes nothing.
2. **Associativity:** regrouping a stack does not change the result.
3. **Right bias at leaves:** later defined values win only where they overlap.
4. **Locality:** independent subrecords do not erase one another.
5. **Undefined is absence:** `undefined` never clears a prior value.
6. **Idempotence:** applying the same replacement fragment twice is equivalent
   to once.
7. **Mode homomorphism:** resolving selected mode axes and then applying
   overrides is equivalent to the documented ordered stack expansion.
8. **Family coherence:** every consumed role has one resolved value, an explicit
   fallback, or a documented not-applicable state.
9. **Determinism and purity:** source + resolved request + seed + frozen registry,
   extension, resource and capability snapshot fixes output.
10. **Layout/render coherence:** geometry-affecting tokens are measured and drawn
    from the same resolution.
11. **Output parity:** SVG and PNG consume the same resolved request; terminal
    output derives its declared semantic projection; unsupported output features
    fail or warn explicitly.
12. **JSON safety:** declarative records contain no executable code, markup, or
    unapproved resource URLs.

## Mermaid 11.16 family envelope

The official Mermaid 11.16 core registry exposes 30 user-facing families. The
official docs navigation lists 30 entries too, but it substitutes the first-party
external ZenUML integration for the core Railroad family; their union is 31.
The table records that full public surface, the current Agentic Mermaid baseline,
and the syntax/brand pressure each family contributes. “Native” here means
registered Agentic Mermaid family support; it does not claim every future
upstream construct.

| Mermaid family | Primary header(s) | Current status | Additional syntax and brand pressure |
|---|---|---|---|
| [Flowchart](https://mermaid.ai/open-source/syntax/flowchart.html) | `flowchart`, `graph`, `flowchart-elk` | native for `flowchart`/`graph`; explicit ELK declaration needs capability accounting | directions, renderer/layout variants, subgraphs, large shape catalog, edge IDs/types/animation, markdown/HTML labels, icons/images, metadata, classes/styles/clicks, layout/look selection |
| [Swimlanes](https://mermaid.ai/open-source/syntax/swimlanes.html) | `swimlane-beta` | not native; currently at risk of Flowchart misrouting | Flowchart syntax plus lane ownership, cross-lane semantics, beta grammar |
| [Sequence](https://mermaid.ai/open-source/syntax/sequenceDiagram.html) | `sequenceDiagram` | native | actor kinds, lifelines, activations, fragments, notes, autonumber, links/menus, create/destroy, rich arrow endpoints |
| [Class](https://mermaid.ai/open-source/syntax/classDiagram.html) | `classDiagram`, `classDiagram-v2` | native for `classDiagram`; v2 alias is not routed | compartments, generics, annotations, namespaces, cardinality, relationship endpoints, classes/styles/clicks |
| [State](https://mermaid.ai/open-source/syntax/stateDiagram.html) | `stateDiagram`, `stateDiagram-v2` | native | pseudostates, composite/concurrent regions, notes, direction, classes/styles/clicks |
| [Entity Relationship](https://mermaid.ai/open-source/syntax/entityRelationshipDiagram.html) | `erDiagram` | native | entities/attributes/keys/comments, aliases, crow's-foot/cardinality and identifying semantics, direction |
| [User Journey](https://mermaid.ai/open-source/syntax/userJourney.html) | `journey` | native | sections, actors, scores, task ownership and categorical/status color |
| [Gantt](https://mermaid.ai/open-source/syntax/gantt.html) | `gantt` | native | date formats, exclusions, milestones, statuses, dependencies, sections, axes, today marker, compact/config |
| [Pie](https://mermaid.ai/open-source/syntax/pie.html) | `pie` | native | values, labels, legend, donut/showData/config, categorical series |
| [Quadrant](https://mermaid.ai/open-source/syntax/quadrantChart.html) | `quadrantChart` | native | normalized coordinates, quadrant labels, axes, points, per-point style/classes |
| [Requirement](https://mermaid.ai/open-source/syntax/requirementDiagram.html) | `requirementDiagram`, `requirement` | not native | SysML requirement/element types, risk/method/status, relationship taxonomy, direct/class styling |
| [GitGraph](https://mermaid.ai/open-source/syntax/gitgraph.html) | `gitGraph` | native | branch/checkout/merge/cherry-pick, commit types/tags, orientation and config |
| [C4](https://mermaid.ai/open-source/syntax/c4.html) | `C4Context`, `C4Container`, `C4Component`, `C4Dynamic`, `C4Deployment` | not native; upstream experimental | five related dialects, boundaries, people/systems/containers/components, relationship/update macros, fixed-style legacy |
| [Mindmap](https://mermaid.ai/open-source/syntax/mindmap.html) | `mindmap` | native | indentation, shapes, icons/classes, hierarchy depth, branch/category palettes |
| [Timeline](https://mermaid.ai/open-source/syntax/timeline.html) | `timeline` | native; upstream docs still call the family experimental | periods, sections, events, orientation and categorical cycling |
| [ZenUML](https://mermaid.ai/open-source/syntax/zenuml.html) | `zenuml` through an official external diagram package | not native; upstream external/experimental loading | alternate nested sequence DSL, async rendering, loops/alt/try/comments, dependency/version negotiation |
| [Sankey](https://mermaid.ai/open-source/syntax/sankey.html) | `sankey`, legacy `sankey-beta` | not native; graduated in source while docs still say experimental | CSV quoting, weighted flow bands, node/link palettes, quantitative width semantics |
| [XY Chart](https://mermaid.ai/open-source/syntax/xyChart.html) | `xychart`, `xychart-beta` | native | horizontal/vertical bars and lines, numeric/category axes, ranges, legends, series styles/config |
| [Block](https://mermaid.ai/open-source/syntax/block.html) | `block`, legacy `block-beta` | not native; graduated upstream | authored grid/columns/spans/space blocks, composites, shapes, edges, classes/styles |
| [Packet](https://mermaid.ai/open-source/syntax/packet.html) | `packet`, legacy `packet-beta` | not native; graduated upstream | absolute and relative bit ranges, field labels, contiguous coverage, fixed grid typography |
| [Kanban](https://mermaid.ai/open-source/syntax/kanban.html) | `kanban` | not native | indentation, columns/tasks, assignee/ticket/priority metadata, optional external links |
| [Architecture](https://mermaid.ai/open-source/syntax/architecture.html) | `architecture`, legacy/documented `architecture-beta` | native for `architecture-beta`; upstream has graduated the header | groups/services/junctions, nesting, icons, side-aware edges, layout/config and asset registration |
| [Radar](https://mermaid.ai/open-source/syntax/radar.html) | `radar-beta` | not native | axes, curves, min/max/ticks/graticules/legend, categorical colors and nested theme variables |
| [Event Modeling](https://mermaid.ai/open-source/syntax/eventmodeling.html) | `eventmodeling` | not native | compact/relaxed DSL aliases, timeframes, swimlanes, entity taxonomy, inline/referenced data |
| [Treemap](https://mermaid.ai/open-source/syntax/treemap.html) | `treemap`, legacy `treemap-beta` | not native; graduated in source while docs still warn syntax may evolve | indentation, parent/leaf distinction, values, class bindings, hierarchical surfaces and labels |
| [Venn](https://mermaid.ai/open-source/syntax/venn.html) | `venn-beta` | not native; upstream warns syntax may evolve | sets, higher-arity unions, sizes, overlap-specific semantic fills/labels |
| [Ishikawa](https://mermaid.ai/open-source/syntax/ishikawa.html) | `ishikawa`, legacy `ishikawa-beta` | not native; graduated in source while docs still warn syntax may evolve | indentation, cause hierarchy, spine/branch metaphor, head/cause roles |
| [Wardley](https://mermaid.ai/open-source/syntax/wardley.html) | `wardley-beta` | not native; beta identifier | fixed coordinate semantics, components/anchors, flows, evolution, notes/annotations, inertia/strategy/pipelines |
| [Cynefin](https://mermaid.ai/open-source/syntax/cynefin.html) | `cynefin-beta` | not native | fixed semantic domains, items, transitions, domain theme variables, deterministic wavy boundaries |
| [TreeView](https://mermaid.ai/open-source/syntax/treeView.html) | `treeView-beta` | not native | indentation or box-drawing input, file/folder semantics, Unicode preservation, annotations and registered icons |
| [Railroad](https://mermaid.ai/open-source/syntax/railroad.html) | `railroad-beta`, `railroad-ebnf-beta`, `railroad-abnf-beta`, `railroad-peg-beta` | not native; beta-only and omitted from docs navigation | four grammar front ends sharing terminal/nonterminal, sequence, choice, optional/repetition and annotation roles |

Mermaid's core detector registry also contains pseudo/internal inputs such as
`info`, `error`, and the unparsed-frontmatter `---` detector. They belong in an
automated **upstream watch manifest**, not in marketed family counts. Renderer
and layout variants such as Flowchart ELK and v2 implementations are
capabilities of a logical family, not extra product families. A `-beta` suffix
is not itself a maturity signal: Mermaid's source policy distinguishes
never-beta, graduated-with-legacy-alias, and beta-only families, and the docs can
lag that policy.

### Syntax capability contract

For every family, the registry must record these dimensions independently:

| Dimension | Required accounting |
|---|---|
| identity and routing | canonical family ID, headers/aliases, case/direction rules, Mermaid introduction/deprecation version, upstream maturity |
| document framing | YAML frontmatter, init directives, comments, title, `accTitle`, single/multiline `accDescr` |
| grammar | statements, nesting/indentation, ordering, delimiters/CSV, aliases, optional forms, invalid-input behavior |
| text | quoted/bare labels, Markdown strings, HTML labels, math, escapes, Unicode, grapheme and multiline behavior |
| authored appearance | theme variables, `classDef`, `class`, `:::`, `style`, `linkStyle`, inline metadata and family-specific styling |
| semantic identity | stable IDs, categories, statuses, values, relationships, regions, source maps and brand-role mapping |
| interaction and assets | links, clicks/callbacks, tooltips, menus, icons, images, external registries and strict-security behavior |
| configuration | source/explicit config keys, value validation, layout/look/renderer selection, ineffective-key diagnostics |
| processing | detect, parse, source preservation, serialize, mutate, verify, layout, Scene lowering |
| outputs | SVG, PNG, ASCII, Unicode, accessibility, deterministic IDs and security |
| evidence | official docs/upstream fixture provenance, divergence ledger, semantic properties, visual-metaphor evidence |

Each cell is `native`, `source-preserved`, `diagnosed`, `not-applicable`, or
`absent`. Product support is derived from this matrix; it is never a hand-written
boolean. Experimental upstream status is orthogonal: a beta family may be
natively supported at a pinned version while still requiring stricter upgrade
gates.

## Forward-compatibility protocol

### One upstream manifest

Generate and commit an `UpstreamMermaidManifest` from the pinned Mermaid package,
official docs navigation/pages (including pages missing from navigation), config
schema, detector registry, beta policy, external first-party registrations, and
harvested upstream fixtures. Store the Mermaid version and source commit/SHA. On
dependency upgrade, CI must report:

- families or dialects added/removed;
- new or changed headers and aliases;
- stable/beta/experimental status changes;
- added/removed syntax features and examples;
- config and theme-variable schema changes;
- new external asset, interaction, layout, or security behavior.

The manifest is an inventory and change detector, not proof of semantic parity.
Every claimed native cell still needs executable evidence.

### One family descriptor

Replace the split between `DiagramKind`, `RoutedDiagramType`,
`BUILTIN_FAMILY_METADATA`, hand-written detectors, config maps, and capability
projections with one canonical `FamilyDescriptor`. It should declare:

- stable internal ID, official upstream ID, headers/aliases, maturity/version;
- detector and collision priority;
- minimal example and official fixture references;
- parser/preservation/mutation/verification hooks;
- config schema and diagnostics;
- layout, Scene, SVG, PNG, ASCII/Unicode hooks;
- semantic roles/channels and brand-consumption map;
- accessibility/security/asset policies;
- capability states and evidence references.

Canonical authority does not mean a physical god object. `FamilyDescriptor` is
a declarative manifest plus references to stable operations; parser, layout and
backend representations stay hidden behind those behavioral interfaces.

Built-in structured bodies can keep a closed discriminated union for exhaustive
core code. Runtime extension IDs must use a separate open, namespaced family ID.
This makes `registerFamily` truthful without weakening built-in exhaustiveness.
Registration must reject collisions unless an explicit test-only replacement API
is used.

### Lossless unknown-family behavior

- Never default an unknown or newly introduced header to Flowchart.
- If the pinned upstream manifest recognizes the header but the family is not
  native, retain the original document bytes and source spans in an opaque body;
  normalization is a read-only detection/parser view. Emit a stable capability
  diagnostic for parse/mutate/render requests.
- If the header is unknown to both manifests, retain the original source in an
  `unknown` envelope and report `UNKNOWN_HEADER` with upgrade/registration help.
- Do not strip frontmatter, directives, comments, or unmodeled segments merely
  to detect a family.
- Promotion from opaque to structured must preserve parse -> serialize -> parse
  closure and must not invalidate previously preserved documents.

### Extension versioning and conformance

- Version `BrandPack`, `ResolvedAppearance`, Treatment, backend, family, and
  capability schemas independently.
- Treat human-friendly names and version ranges as authoring inputs. A
  reproducibility record locks the exact BrandPack, Treatment, backend, core/
  Scene/config contract and resource versions plus content hashes and the frozen
  capability decision. Replaying without that snapshot is best-effort, not a
  deterministic claim.
- Use one `ExtensionDescriptor`/registry/pipeline compiler for Treatment,
  backend, future-family and resource contributions, with kind-specific hooks.
  A descriptor declares namespaced ID, kind, package version, compatible core/
  Scene/config-schema ranges, phase/scope/order, reads/writes, preserved or
  invalidated traits, capabilities/limits, conflicts, resources, permissions,
  bounds/z-order/identity/hit/a11y effects and failure policy. Registration
  collisions fail; replacement is explicit; each render freezes a snapshot.
- Negotiate the family + Treatment stack + backend + output + host-policy
  capability set before layout/render. Missing required capability is a
  structured error; a missing preferred capability follows one declared lossy/
  projected fallback with a diagnostic; optional unknown capabilities remain
  inert and discoverable.
- Namespace family IDs, role IDs, treatment IDs, config keys, token mappings and
  open `CapabilityId` strings. Capability requirements are `required |
  preferred | optional` and may carry numeric limits; a closed enum must not
  make an unknown future ID unrepresentable.
- Publish versioned Treatment and Backend conformance suites. Each report pins
  core/extension/Scene/resource versions and hashes and proves routing, opaque
  behavior, mutual mark/role acceptance, style composition, pass order,
  deterministic SVG/PNG, accessibility, hit/bounds behavior, security, resource
  integrity, failure isolation, unknown optional fields and discovery. Every
  advertised capability cites passing fixture IDs and the pinned runtime/
  environment; structural assertions are paired with reference renders and
  explicit fuzzy thresholds where exact bytes are inappropriate.
- Add greasing fixtures for unknown optional capability/config/role values and
  required-unknown failures so extension paths do not ossify around only today's
  registrations.
- Preserve unknown optional fields and capability IDs structurally through
  load/save and extension-to-extension forwarding; field-by-field adapters must
  prove they do not discard them. Unknown required features fail with one
  structured unsupported list rather than partial activation.
- Reject unknown unnamespaced fields in declarative authoring schemas; preserve
  namespaced `$extensions` inert unless an installed extension claims them. The
  descriptor/package forwarding rule above applies to negotiated newer-schema
  optional fields and does not make typos in a BrandPack silently valid.
- Deprecations remain accepted and diagnosed for a published migration window;
  schema migrations are pure and testable.
- External icons, images, links, fonts, and callbacks use explicit capability and
  security policies. Offline/strict output never fetches ambient resources.
- Installed resources use a content-addressed manifest with logical ID, package
  path, media type, SHA-256 digest, byte size, license and required/optional
  status. Reject traversal, symlinks, MIME mismatch and declared limits; a
  readonly resolver exposes only verified resources.
- Run every first- or third-party backend result through one
  `OutputSecurityPolicy`: a secure-static SVG/HTML allowlist; no script/event
  attributes, `foreignObject`, raw CSS, unapproved URL schemes or ambient
  external references; approved resources embedded or integrity-checked; and
  stable failure diagnostics. Backend trust never bypasses output validation.

#### Extension trust tiers

Trust is independent of capability and expressiveness:

| Tier | Content and authority |
|---|---|
| Declarative | Appearance fragments, BrandPacks and resource manifests are data only. They may select installed, allowlisted IDs but never import, download, execute or escalate host policy. |
| Trusted in-process | Treatments and backends run only after explicit host installation and allowlisting. They remain subject to typed input/output, resource, determinism, budget and output-security contracts. |
| Future untrusted code | Requires a separate worker/process or WASI-style capability sandbox with explicit imports plus CPU, memory, time and output budgets. A runtime permission flag is not treated as a hostile-code sandbox. |

### Adoption order for Mermaid's missing families

Native family growth follows Section A6 and is not a prerequisite for the first
Section B customization PRs, but it consumes the same shared protocol:

1. **Recognition floor:** account for all 31 official public families plus the
   core pseudo/internal watch set in detection, opaque preservation,
   capabilities, and diagnostics.
2. **Stable high-leverage wave:** Requirement, Block, Packet, Kanban, and
   TreeView. Together they exercise records/status, authored grids, fixed-width
   fields, metadata, indentation/Unicode, icons, and terminal output.
3. **Data-visualization wave:** Sankey, Radar, and then Treemap/Venn when their
   pinned grammars are acceptable. This tests weighted flows, curves, areas,
   overlaps, legends, scales, and strong/soft category tokens.
4. **Domain-model wave:** Swimlanes, Event Modeling, C4, and ZenUML. These test
   shared grammar reuse, related dialects, async/external dependencies,
   boundaries, and lane/domain semantics.
5. **Change-prone metaphor wave:** Ishikawa, Wardley, and Cynefin after explicit
   pinned-version decisions. Preserve and watch them before claiming stability.

The priority can change with demand, but every wave uses the same citizenship,
syntax, brand, output, and extension contracts.

## Internal-consistency contract

Internal consistency is a deliverable, not incidental refactoring.

One declaration should enter one registry-driven pipeline:

```
detect -> lossless envelope -> family parse -> semantic normalize
  -> resolve request/appearance + token constraints -> negotiate/freeze pass plan
  -> SemanticScene -> semantic Treatments -> layout -> PositionedScene
  -> geometry Treatments -> final bounds/viewBox -> BoundedScene
  -> paint Treatments -> final Scene constraints -> backend
  -> OutputSecurityPolicy -> output validation/projection
```

Capabilities and degradation decisions are recorded at those boundaries, not
inferred afterwards from whether some output happened to be non-empty.

### Essential Scene primitives, starting with connectors

Section A defines the renderer's small semantic alphabet before Section B makes
it brand-customizable. A primitive belongs in the core when it is used by
multiple unrelated families, affects layout/bounds/identity/accessibility, and
has stable semantics that every backend must understand or explicitly project.
The minimum inventory is document/page, text, shape, container/group,
connector, marker, and chart/data mark. Family metaphors remain adapter-owned.

Connectors are the first parity probe because nearly every family uses them and
the current system spreads their decisions across routers, family renderers,
marker definitions, Scene lowering, styled backends, hit geometry, ASCII and
quality checks. The canonical `ConnectorMark` contract must carry:

- semantic endpoints, direction, relationship kind, identity, accessibility,
  status/category/emphasis channels and safe interaction metadata;
- positioned route geometry with explicit routing ownership, preserved
  subpaths/closedness, stable marker anchors and endpoint tangents, label
  anchors and hit geometry;
- bend geometry (`bendRadius`) separately from stroke-corner paint;
- stroke width, color/opacity, dash array/offset, `lineCap`, `lineJoin`,
  `miterLimit`, path-length calibration, paint order and optional non-scaling
  policy;
- typed start/mid/end marker archetypes or geometry, `viewBox`, `refX`/`refY`,
  overflow, `markerUnits`, fill/stroke/context paint, scale, orientation, bounds
  and stable resource identity;
- label paint/halo and the marker/label clearance required by layout;
- a terminal projection and stable diagnostics for features a character grid
  cannot represent.

Bounds and hit testing include cap extension, half stroke width, acute miter
spikes, marker bounds, filters/shadows and declared Treatment displacement.
Closing a path and drawing an explicit final segment remain distinct because
their cap/join and marker semantics differ. Roughening a connector may alter its
shaft but must preserve semantic topology, marker anchors/tangents and dash
restart behavior unless it declares a lossy projection.

Define a portable connector/marker subset that every graphical first-party
backend must realize natively or emulate faithfully, and an advanced subset
whose per-behavior claims may be projected, lossy or unsupported. Claims are
recorded separately for topology/closedness, caps, joins, miters, dash restart/
offset, path-length calibration, paint order, non-scaling stroke, transforms and
start/mid/end marker orientation. SVG `<marker>` is one projection, never the
semantic source used by raster or terminal backends.

The same separation applies to shapes: semantic shape is authored Mermaid
meaning; role-level `cornerRadius` is a brand default only where the shape
declares radius applicability. A circle does not become a rounded rectangle,
and an authored sharp/rounded shape is not silently replaced. Measurement,
layout, crisp rendering, rough/hybrid rendering, SVG/PNG projection, hit
testing, verification and accessibility all consume the same positioned mark.

### Remove ambiguous historical identities

The current `tufte` name means both a palette in `THEMES` and a full Look in the
style registry; built-in Look registration silently overwrites the palette
entry. This is representative of the broader historical overlap between
“theme,” “palette,” and “style.” Section A introduces explicit kinds and
collision-safe names such as `palette:tufte` and `look:tufte`. The bare
`tufte` alias continues to select the currently observable full Look during a
published compatibility window, with discovery showing its canonical ID and
the formerly shadowed palette becoming directly addressable. New registrations
must be namespaced and cannot silently replace another kind or owner.

This cleanup happens before BrandPack naming. Otherwise the pack registry would
institutionalize the same ambiguity at a larger scale.

### Canonical authorities

| Concern | Canonical authority | Derived consumers |
|---|---|---|
| upstream Mermaid inventory | `UpstreamMermaidManifest` | upgrade diff, family backlog, syntax fixtures, maturity labels |
| shipped family and capabilities | `FamilyDescriptor` registry | types/narrowers, routing, CLI/MCP/editor/site/docs, citizenship matrix |
| public brand/style fields | one typed field manifest + JSON Schema | `StyleSpec`/`BrandPack` types, validator, docs tables, CLI/MCP/editor forms |
| semantic roles/channels | core role registry + family adapter declarations | Scene types, brand consumption matrix, treatments, constraints |
| render request | one normalized `ResolvedRenderRequest`, shared-field manifest and output projection descriptors | SVG, PNG, ASCII/Unicode, CLI, MCP, editor, website |
| appearance resolution | one pure `resolveAppearance` | measurement, layout, Scene lowering, all render backends |
| Scene and primitives | versioned Scene/Connector schema plus invariants | layout, staged Treatments, backends, bounds/hit testing, accessibility and conformance suites |
| extension lifecycle | common `ExtensionDescriptor` registry plus pipeline compiler | registration, discovery, packaging, negotiation, ordering and frozen render snapshots |
| capability decisions | canonical capability manifest plus frozen negotiation result | preflight, diagnostics, fallback/error policy, generated matrices and product claims |
| conformance evidence | versioned fixture catalog plus machine-readable report schema | extension registration/release gates, implementation/version/environment claims and docs badges |
| output security | one `OutputSecurityPolicy` and validator | every first- and third-party backend/output adapter |
| examples | family descriptor minimal example + a shared example manifest | editor, website, docs, evals, contact sheets |
| live work | root `TODO.md` | issues/PRs; plans link to IDs and do not become shadow backlogs |

### Consistency invariants

- vocabulary in this plan, public docs, types, diagnostics, and capability JSON
  uses the glossary above;
- every declared family header routes identically through SDK, SVG, ASCII, CLI,
  MCP, and editor preprocessing;
- every public field is accepted/rejected identically by TypeScript, runtime
  validation, JSON Schema, CLI/MCP, editor, and docs;
- every render surface either forwards a field or exposes a stable unsupported
  diagnostic—never silent omission;
- equivalent fixtures entering through the library, CLI, local/hosted MCP,
  editor and website adapters produce the same shared resolved-request and
  resolved-appearance digests; output-only fields are excluded by a checked manifest,
  not hand-picked by each test;
- layout and rendering consume identical resolved typography/spacing/shape
  values;
- all family adapters account for every core role they emit and every public
  primitive they consume;
- SVG and PNG preserve semantic identity, accessibility, security, and branded
  appearance except explicitly raster-only concerns;
- every backend result passes the same output-security validator; trusted code
  has no direct route around the final security boundary;
- ASCII/Unicode derives a `ResolvedTerminalStyle` from the same brand roles and
  bindings, preserving hierarchy/emphasis/status meaning and diagnosing visual
  primitives that the selected color mode cannot represent;
- registry projections use deterministic order and generated counts;
- generated freshness tests are paired with semantic invariants;
- family-specific behavior stays family-specific. Consolidation removes duplicate
  protocol and mechanics, not distinct domain metaphors or layout algorithms.

## Consolidation opportunities

### In this plan and its documentation set

1. Keep this document as the only active decision and dependency order for brand
   primitives. Keep Cupertino as a probe/evidence work package.
2. Treat [`styles-rollout.md`](../design/system/styles-rollout.md) as the executed
   history of Style + Palette, not a second active brand roadmap.
3. Keep
   [`archive/remove-role-styling-plan.md`](./archive/remove-role-styling-plan.md)
   as historical rationale. The new semantic brand-role layer is a redesigned
   global interface, not resurrection of arbitrary per-element role objects.
4. Generate the 14-family native fidelity table in
   [`mermaid-family-fidelity-audit.md`](../design/mermaid-family-fidelity-audit.md)
   from the family/evidence manifests. Keep qualitative hallmark prose reviewed.
5. Extend the existing citizenship matrix instead of creating a second brand
   support matrix: add brand-role consumption and output parity as checked
   capability/evidence fields.
6. Put promoted implementation items in root `TODO.md` with stable IDs; the plan
   explains dependencies and acceptance criteria but does not track duplicate
   checkboxes.

### In Agentic Mermaid

| Priority | Consolidation | Current duplication/inconsistency | Target |
|---|---|---|---|
| P0 | family identity and routing | `DiagramKind` in `src/agent/types.ts`, `RoutedDiagramType` and detectors in `src/mermaid-source.ts`, `detectKind` in `src/agent/parse.ts`, metadata/registry in `src/agent/families.ts`, plus surface projections | one `FamilyDescriptor` authority with a closed built-in union and open extension ID |
| P0 | render request transport | `RenderOptions` in `src/types.ts`; smaller `PngOptions`; separate `AsciiRenderOptions`; CLI/MCP/editor/hosted subsets and family forwarding | one normalized shared request with declared output projections and capability diagnostics; PNG derives its SVG request and terminal output derives a semantic style projection rather than rebuilding disconnected subsets |
| P0 | positioned artifact and verification | public SVG uses `src/render-family-hooks.ts`, while `src/agent/family-layouts.ts` and `src/agent/verify.ts` reparse/reproject geometry | one family artifact or `projectPositioned` path shared by SVG, PNG, layout JSON, verify, certificates, and quality checks |
| P0 | style/brand field definition | `StyleSpec`, `KNOWN_KEYS`, validation, JSON Schema, docs field table, editor controls, CLI/MCP descriptions | one field manifest generates or checks all surfaces |
| P0 | style resolution | stack/color/face merging in `src/scene/style-registry.ts`, theme precedence in `src/theme.ts`, style defaults in `src/styles.ts`, per-family projection | one immutable `ResolvedAppearance`; current `StyleSpec` and future BrandPacks adapt into it, built-in compiled faces derive from exportable public records, and family adapters never re-resolve |
| P0 | truthful extension selection | arbitrary `registerBackend` IDs cannot pass `StyleSpec.backend`; `registerFamily` cannot add a typed ID | namespaced, versioned extension IDs plus registration/selection conformance |
| P1 | semantic roles | closed `SceneRole` grows per family; family renderers choose mappings independently | stable core role registry, namespaced extensions with required fallback, generated role-consumption matrix |
| P1 | family config capabilities | keys/value/no-op diagnostics in `src/shared/family-config-diagnostics.ts` remain separate from family hook/metadata declarations | family descriptor owns config schema, resolver, diagnostics, and capability projection |
| P1 | universal Mermaid envelope | frontmatter/init/comments/accessibility are parsed in `src/mermaid-source.ts`, `src/agent/parse.ts`, `src/index.ts`, `src/shared/accessibility-directives.ts`, and family parsers | one lossless `ParsedMermaidEnvelope` with byte spans and universal metadata; family parsers receive the preserved body |
| P1 | parser authority | agent `*-body.ts` parsers duplicate `src/<family>/parser.ts` grammars (existing `CONS-26`) | one grammar AST projected into agent bodies with source-preserved segments |
| P1 | examples/discovery | minimal examples and labels are duplicated across metadata, editor, website, fixtures, SDK text (existing `CONS-27`) | descriptor example + shared example manifest; generated surfaces |
| P1 | style and palette identity | Looks and palette-only styles share one name map; a full look can shadow a palette name | explicit kind/namespace/collision policy while preserving stack ergonomics |
| P2 | treatment/backends | rough/hybrid share machinery, but one-off effects otherwise jump to a whole backend | runtime-owned typed Treatment pass pipeline; keep the backend registry for compositor changes |
| P2 | common family mechanics | accessibility directive scans, label extraction, IDs, title ops, hashes, color-mix strings, outline geometry recur (existing `CONS-11`, `CONS-16`, `CONS-30`) | shared pure helpers with property/model-gap tests |
| P2 | positioned/rendered paths | several families independently resolve/parse for SVG and `layoutMermaid` (existing `CONS-42`) | one resolve -> position -> project result shared by outputs |
| P2 | small duplicate registries | named CSS colors exist in both `src/shared/css-named-colors.ts` and `src/sequence/colors.ts`; style labels and font bundles are separately enumerated | import/generate from the existing shared color table, style metadata, and font manifest |

Do not consolidate family parsers into a universal grammar, family layouts into a
universal layout algorithm, or family palette semantics into one cycling rule.
The reusable waist is protocol, roles, resolution, and mechanics; family meaning
remains behind adapters.

This work extends the existing consolidation program rather than replacing it.
Add gates beside `consolidation-gate.test.ts` and
`property-abstraction-waists.test.ts` for registry-owned detection, one
positioned artifact, render-option/surface parity, named-style/resolved-style
equivalence, and complete role-trait/brand-fallback consumption.

## Execution plan: Section A before Section B

The plan now has two product boundaries rather than interleaved “brand” and
“family” tracks:

- **Section A makes the existing system correct, coherent, explicit and
  extensible.** It is worth shipping even if custom branding is cancelled.
- **Section B exposes that foundation as progressively richer custom Styles and
  branding.** It may add inputs to the Section A waist but may not create a
  second layout, Scene, backend, output or capability path.

```
Section A — correctness and parity
A0 truth -> A1 identities -> A2 request/appearance waist -> A3 primitives
         -> A4 family/positioned protocol -> A5 first-party parity
         -> A6 forward compatibility -> A7 consolidation evidence

Section B — public customization
A3 -> B0 inline fragments
A5 + B0 -> B1 semantic Styles + built-in equivalence
A6(protocol) + B1 -> B2 BrandPacks
B1 + B2 -> B3 bindings/constraints
A6(protocol) + B1 -> B4 Treatments
A6(protocol) + B4 -> B5 installed extensions/backends
A7 + B2 + B3 + B4 + B5 -> B6 migration, usability and release evidence
```

Section A does not wait for BrandPacks. Section B does not wait for every missing
Mermaid family, but each newly registered family must use the Section A protocol
and pass the current Section B sentinel contract available at that time.
These are implementation prerequisites; public release of a B capability also
requires its relevant A5 parity gates. `A6(protocol)` means recognition,
version negotiation, namespaces and conformance—not completion of the native-
family adoption backlog, which continues in parallel.
“A before B” is dependency direction, not waterfall: holdout brands and real
authoring work in B may reveal a recurring missing primitive, but promotion back
into A requires cross-family evidence, a behavioral contract, compatibility
review and conformance tests rather than a brand-specific shortcut.

## Section A — correctness, parity, consolidation, and essential primitives

### A0 — truth and characterization floor

- Correct claims about registered versus upstream families, `registerFamily`,
  `registerBackend`, SVG/PNG parity and terminal projection.
- Characterize current precedence, routing, family/backend/output behavior and
  public-surface receipt before changing it.
- Fix skip-undefined stack merging and distinguish omission from rejected JSON
  `null` before adding nested records.
- Define the capability/parity vocabulary and quantify tests over registries
  rather than copied counts.

Exit: current behavior and known divergence are machine-readable; a change
cannot improve one path by silently changing another.

### A1 — canonical identities, registries, and historical cleanup

- Define generic kind/namespace/provenance/version/collision machinery and apply
  it in A to Palette, Look, backend, family, role and resource registrations.
  B2 and B4 instantiate BrandPack and Treatment kinds without inventing another
  registry model.
- Split the two meanings of `tufte` into canonical `palette:tufte` and
  `look:tufte`; retain the bare alias as a diagnosed compatibility mapping to
  the currently observable Look for a published window.
- Derive discovery order, labels, editor choices, CLI/MCP schemas, website copy
  and docs from registry metadata instead of separate lists.
- Consolidate style labels, font resources, named colors and aliases behind
  their existing or new canonical registries.

Exit: no registration silently shadows another meaning or owner, and legacy
aliases have deterministic migrations.

### A2 — one render request and one resolved appearance

- Introduce one `ResolvedRenderRequest`, a checked shared-field/output-only
  manifest, and one immutable `ResolvedAppearance` consumed below the boundary.
- Keep the waist factored into cohesive, versioned request, appearance,
  capability and Scene subcontracts rather than growing one universal object.
- Normalize current `StyleSpec`, named Looks/Palettes, Mermaid theme/config and
  explicit render overrides once with one documented precedence model.
- Make PNG derive its graphical request from SVG rather than rebuilding a
  subset; define terminal projection as an output adapter rather than a separate
  styling system.
- Make library, CLI, local/hosted MCP, editor and website adapters expose
  comparable request/appearance digests in tests and diagnose unavailable
  resources or output capabilities.

Exit: the same current-style fixture produces the same shared digests through
every entry point; no layout, family or backend re-merges raw inputs.

### A3 — essential Scene primitives, with connectors first

- Finalize the core document, text, shape, container/group, connector, marker
  and chart/data-mark contracts using the criteria above.
- Define the minimal stable core Scene-role/trait registry and the namespaced-
  role fallback protocol required by current families. Section A owns semantic
  identity, applicability and fallback; it does not assign brand values.
- Make connector route geometry, bend radius, stroke cap/join/miter, dash,
  markers, labels, hit geometry, identity, accessibility and terminal projection
  typed rather than reconstructed from SVG strings.
- Separate authored semantic shape/relationship meaning from configurable paint
  and applicable geometry defaults.
- Make measurement, layout, verification, crisp rendering, rough/hybrid
  rendering and output projection consume the same positioned marks.
- Define the generic typed Scene-transform lifecycle—accepted/emitted marks,
  paint-only versus bounds-changing behavior, ordering, identity ownership,
  determinism, resources, security and failure isolation—that Section B exposes
  as Treatments. Section B adds branding uses, not a second transform pipeline.
- Record primitive support per feature and operation (`native | emulated |
  projected | lossy | unsupported`), not coarse flags such as `connectors:
  true`; validate
  claims against each actual target renderer, not only the format specification.

Exit: every essential primitive has one typed contract, explicit consumers and
an unsupported/projection diagnostic; connector semantics survive every path.

### A4 — canonical family and positioned-artifact protocol

- Introduce `FamilyDescriptor` as the authority for identity, headers,
  detection, config schema/diagnostics, examples, role maps, operations, layout,
  Scene lowering, outputs and capability evidence.
- Separate closed built-in IDs from open namespaced extension IDs.
- Introduce one lossless `ParsedMermaidEnvelope`; family parsers receive the
  preserved body rather than rescanning universal metadata independently.
- Converge SVG, PNG, layout JSON, verify, certificates and quality checks on one
  positioned artifact or explicit `projectPositioned` view.

Exit: current families no longer depend on copied routing switches or parallel
positioning projections; a synthetic family registers atomically.

### A5 — first-party subsystem, backend and output parity

- Gate all 14 current families with `family x role/primitive` consumption and
  fallback evidence.
- Gate `default`, `rough` and `hybrid` with `backend x Scene mark/primitive`
  conformance. Different drawing character is expected; semantic input,
  geometry requirements, identity, accessibility, security, resources and
  diagnostics must agree.
- Gate library/CLI/MCP/editor/website transport receipt independently from
  backend rendering, then run a sentinel interaction cross-product.
- Require SVG/PNG semantic and branded-appearance parity for current Styles,
  deterministic fonts/resources and strict security. Cross-output fixtures prove
  glyph coverage and metrics from the same locked font faces.
- Convert typed colors through one declared output profile/gamut policy; assert
  identical SVG/PNG conversion and the expected PNG sRGB/ICC/cICP metadata and
  precedence. Run every result through `OutputSecurityPolicy`.
- Compile `ResolvedAppearance` into `ResolvedTerminalStyle` for no-color, ANSI
  16/256, truecolor and HTML; preserve role/hierarchy/emphasis/status semantics
  and diagnose radius, typography, elevation and other nonrepresentable paint.
  `auto` resolves from caller override first, then TTY capability, `TERM=dumb`
  and `NO_COLOR`, and the decision enters the request digest. No-color output
  preserves status/category through labels, symbols, markers or line patterns;
  HTML styled text is an output encoding, not a terminal color capability.

Exit: the existing graphical first-party system can claim contract, transport
and semantic backend parity; terminal output can claim explicit semantic
projection parity, never pixel parity.

### A6 — upstream and extension forward compatibility

- Establish the version-pinned 31-family public manifest plus core
  pseudo/internal watch entries and upgrade diffs.
- Ensure unsupported official and unknown future headers are losslessly
  preserved or explicitly diagnosed and never fall through to Flowchart.
- Version Scene, family, backend, capability and resource contracts; negotiate
  supported ranges and retain deprecated migrations for a published window.
- Add native families through the adoption waves and citizenship ratchet. Each
  family must pass the primitive, backend, output and discovery contracts in
  force when it registers.

Exit: a Mermaid upgrade yields a reviewable manifest diff; every stable family
is native at its advertised capability or explicitly preserved/diagnosed, and a
synthetic future family needs no new core switch.

### A7 — consolidation and correctness evidence

- Replace duplicated tables/counts with generated registry projections and
  semantic invariants.
- Consolidate repeated parsers/helpers only where the abstraction preserves
  family meaning; do not create a universal grammar, layout or palette rule.
- Publish request/backend/output/family capability matrices and archive
  superseded execution plans; keep actionable work in `TODO.md`.
- Run characterization, property, model-gap, conformance, security,
  accessibility, deterministic-resource and visual-regression gates.
- Keep exhaustive one-dimensional conformance for every registered field, role,
  primitive, family, backend and output; use constrained t-way covering arrays
  plus targeted high-order security/font/layout cases for interactions, rather
  than pretending the full Cartesian product is testable.
- Deliver four normative, versioned artifacts: the Scene/Connector schema and
  invariants; `ExtensionDescriptor` plus registry/pipeline compilation rules;
  the capability/fallback/error-policy matrix; and conformance fixtures with a
  machine-readable implementation report.

Exit: Section A has independent release notes and measurable system benefits
without relying on a custom BrandPack demo.

## Section B — richer custom Styles and branding

### B0 — inline appearance fragments and the low floor

- Add a partial JSON-safe `AppearanceFragment` accepted inline or in a stack,
  without requiring a name, package or version.
- Preserve existing one-name, Look + Palette, inline `StyleSpec` and JSON-file
  workflows as compatibility inputs to the same algebra.
- Expose common shape/container corner radius and connector bend/cap/join/width/
  dash/marker defaults at this level, subject to semantic applicability and
  authored-source precedence.
- Generate TypeScript, validator, JSON Schema, docs, CLI/MCP advanced input and
  editor import/advanced controls from one field manifest.

Exit: changing global sharp/rounded shape and connector character is a small
inline customization, not a versioned BrandPack project.

### B1 — semantic Style roles and public built-in equivalence

- Expose public brand slots and brand-neutral typography, spacing, radii, border,
  elevation, surface/text, status and category properties for the A3 role
  registry; geometry-affecting values remain shared by measurement and paint.
- Add a new core role only with cross-family or holdout evidence. B1 maps brand
  tokens to roles but does not create a second semantic-role system.
- Export every built-in Look as an ordinary public source record and prove it is
  behaviorally equivalent to selection by built-in name. Private compiled forms
  may exist only as derived optimizations.
- Require deterministic PNG font coverage or a stable named fallback diagnostic.

Exit: an external public record can express everything a current built-in face
can, and every first-party Look passes through the same Section A contracts.

### B2 — BrandPacks, modes, resources, and token ingestion

- Finalize and version the BrandPack envelope and namespaced registry/discovery
  APIs after the fragment algebra and role consumption are proven.
- Add orthogonal `colorScheme`, `contrast`, `density`, `scale` and future
  context modes with deterministic resolution order, constrained combination
  overrides and explicit selection.
- Add design-token ingestion through mappings into Agentic Mermaid semantics,
  not vendor-specific public fields.
- Define installed font/icon/resource references, offline behavior, package
  integrity, host allowlists, conflicts and migrations. Declarative JSON never
  embeds executable code or ambient fetches.

Exit: a BrandPack is portable and reproducible through library, CLI, local/
hosted MCP, editor and website wherever installed-resource capability permits;
unavailable host resources produce the same structured diagnostics.

### B3 — semantic bindings and brand constraints

- Add ordered equality bindings over normalized class, tag, status, category
  and namespaced metadata; exclude CSS selectors, tree queries, arbitrary
  predicates and renderer-private state.
- Add resolver-time token constraints and post-cascade/post-Treatment Scene
  constraints with stable mark/role diagnostics. V1 actions are `warn | error`,
  not silent rewriting.
- Publish binding precedence, specificity, unmatched/conflict and constraint
  composition laws with property tests.

Exit: a brand author can express the same domain meaning across unrelated
families without enumerating family adapters or embedding source-specific CSS.

### B4 — Treatments, the controlled code extension

- Add the trusted, host-allowlisted Treatment pass pipeline over typed Scene marks,
  including paint-only versus bounds-changing declarations, z-order, generated
  identity, hit geometry, failure isolation and seed partitioning.
- Migrate at least one signature effect that would otherwise require a brand-
  specific field or whole backend.
- Ship composition, security, accessibility, SVG/PNG and future-family
  conformance tests.

Exit: signature effects compose without bloating the declarative schema or
bypassing the Section A primitive/backend contracts.

### B5 — installed extensions and custom backends

- Make arbitrary registered backends selectable through namespaced, versioned
  references or remove the misleading public override.
- Run third-party backends through the same `backend x Scene mark/primitive`
  suite as first-party backends, plus version negotiation, collision, resource,
  strict-security and failure-isolation tests.
- Define a distributable package boundary for records, resources, Treatments and
  backends without granting declarative JSON executable authority.

Exit: an installed third-party package has the same rendering ceiling as a
first-party package; trust and bundled resources, not private APIs, are the only
intentional difference.

### B6 — built-in migration, usability, and brand release evidence

- Reimplement all built-in Looks/Palettes as first-party packages or public
  records over B0–B5; delete private expressiveness after equivalence gates pass.
- Publish the authoring ladder, primitive-versus-Treatment decision guide,
  BrandPack cookbook, capability/role matrices and migration guidance for
  legacy Style/theme names.
- Run sentinel and holdout brands across registered families, backends, SVG,
  PNG and terminal projection, plus low-floor usability and small-size visual
  review.

Exit: built-ins dogfood exactly the abstractions external authors receive, and
broad branding claims are supported by conformance and human evidence.

## Evidence and gates

### Brand expressiveness

- **Holdout-brand test:** reproduce at least three brands not used to design the
  schema across all registered families, SVG and PNG, without core changes.
- **Sentinel brand:** every token is deliberately distinctive so a no-op or
  wrong role is obvious; render it for every current and newly added family.
- **Semantic binding:** the same status/category tag selects the same slot across
  structural, temporal, domain, and chart families.
- **Constraint tests:** positive and negative examples for accent area, contrast,
  mono role, modes, and unmatched bindings.
- **Human low-floor test:** give unfamiliar users a token file and ask for a
  branded multi-family sheet; measure time to first useful result and whether
  core code was required.
- **Progressive-authoring test:** the same task has a documented preset, inline
  fragment, reusable JSON pack and installed-extension path; choosing a simpler
  path never requires understanding the levels above it.
- **No-family-knowledge test:** brand authors do not enumerate registered
  families or edit adapters to style core roles; unmatched bindings and
  unconsumed roles return actionable diagnostics.
- **No-built-in-privilege test:** export each first-party Look, resolve it as an
  ordinary public record in a clean registry, and compare semantic output and
  accepted visual tolerance with selection by built-in name.

### Composition and consistency

- property-test every composition law, including nested partial records and
  modes;
- assert all public fields have schema, validator, docs, transport, resolver,
  consumption, and unsupported-diagnostic coverage;
- assert a named built-in and its public resolved/exported representation are
  behaviorally equivalent, including private implementation defaults;
- assert all current family headers route identically on every entry point;
- assert layout and Scene geometry agree after typography/spacing overrides;
- submit one serialized fixture through library, CLI, local MCP, hosted MCP,
  editor and website adapters; compare shared resolved-request digest, resolved-
  appearance digest, diagnostics and capability decisions;
- assert `default`, `rough` and `hybrid` consume every applicable Scene
  mark/primitive with equal semantic, geometry, identity, accessibility,
  security, resource and diagnostic behavior; intentional visual projection is
  recorded rather than compared for pixel equality;
- assert every connector preserves endpoints, direction, markers, label/hit
  geometry, dash/cap/join/bend semantics and stable identity through positioned
  layout, each first-party backend, SVG/PNG and terminal projection;
- cover multiple subpaths, `Z` versus an explicit final `L`, zero-length paths,
  odd/even dash arrays and offsets, acute miter bounds/clipping, mid and
  bidirectional markers, roughened-marker tangents, transforms, non-scaling
  stroke, marker overflow and SVG/PNG projection in connector conformance;
- assert local/hosted SVG and PNG semantic and visual parity, deterministic
  bytes, font fallback, strict security, identity, ARIA, and reference safety;
- assert ASCII/Unicode consumes the same semantic role/binding selections and
  returns the specified projection diagnostics for every non-representable
  primitive and color mode;
- assert external Treatment ordering, purity, seed partitioning, failure
  isolation, role fallback, and new-family behavior. Passing an individual suite
  does not imply universal composability: every selected stage proves its emitted
  marks/roles/capabilities are accepted by the next through pairwise contract and
  sentinel end-to-end tests. Acceptance with no effect and no declared
  realization state/diagnostic is a conformance failure.

### Mermaid compatibility and forward evolution

- harvest every official syntax-page example and relevant upstream parser/DB
  fixture with version/SHA provenance;
- classify every documented feature cell; fail CI on `absent` cells;
- maintain executable divergence and security/offline ledgers;
- compare the generated upstream manifest on dependency upgrades;
- register a fake next-version header and syntax feature in tests to prove lossless
  unknown behavior and discovery projection;
- require domain properties and visual-metaphor evidence in addition to golden
  output for each new family.

## Explicit non-goals

- No arbitrary raw per-element brand style objects. Mermaid-native source styling
  remains the per-element mechanism; semantic bindings connect it to brand slots.
- No executable code, CSS, SVG/HTML markup, callbacks, or unapproved URLs inside
  declarative styles/packs. Trusted host-registered Treatments are executable
  code, but packs may activate only allowlisted IDs and Treatments may emit only
  typed, validated Scene marks and safe values.
- No brand-specific public fields such as `cornerBrackets: true`.
- No universal grammar, layout algorithm, router, or family palette rule.
- No claim that ASCII/Unicode is pixel-, font-, or geometry-equivalent to
  graphical output. A5 supplies a separately specified semantic projection from
  the same resolved appearance; non-representable primitives remain diagnosed
  rather than simulated misleadingly.
- No automatic native rendering of unstable families merely because Mermaid's
  detector recognizes their header.

## Deferred: cross-family motion

Motion remains a separate vocabulary after the static resolution and extension
protocols are stable. Vercel and CF demonstrate that easing, duration, sequencing,
and reduced-motion behavior can be brand identity, while current product value is
primarily deterministic static SVG/PNG and terminal output. Future motion tokens
must compile from the same semantic roles, preserve authored Flowchart animation,
obey `prefers-reduced-motion`, avoid runtime JavaScript where possible, and use
the same capability/forward-compatibility model. Nothing in the static brand
schema should preclude that layer.

## Sources

- Mermaid 11.16 documentation navigation and family list —
  <https://mermaid.ai/open-source/intro/getting-started.html>
- Mermaid syntax and configuration model —
  <https://mermaid.ai/open-source/intro/syntax-reference.html>
- Mermaid Flowchart syntax —
  <https://mermaid.ai/open-source/syntax/flowchart.html>
- Mermaid configuration schema —
  <https://mermaid.ai/open-source/config/schema-docs/config.html>
- Mermaid theming — <https://mermaid.ai/open-source/config/theming.html>
- Mermaid accessibility —
  <https://mermaid.ai/open-source/config/accessibility.html>
- Mermaid source diagram registry —
  <https://github.com/mermaid-js/mermaid/tree/develop/packages/mermaid/src/diagrams>
- Mermaid 11.16 core registration and detector orchestration —
  <https://github.com/mermaid-js/mermaid/blob/f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc/packages/mermaid/src/diagram-api/diagram-orchestration.ts>
- Mermaid Railroad syntax —
  <https://mermaid.ai/open-source/syntax/railroad.html>
- Mermaid beta-family policy —
  <https://github.com/mermaid-js/mermaid/blob/f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc/packages/mermaid/src/diagram-api/diagram-beta-policy.spec.ts>
- Kasey Klimes, “When to Design for Emergence” —
  <https://uxmag.com/articles/when-to-design-for-emergence>
- Jules Hedges, “On compositionality” —
  <https://julesh.com/posts/2017-04-22-on-compositionality.html>
- David Parnas, “On the Criteria To Be Used in Decomposing Systems into
  Modules” — <https://doi.org/10.1145/361598.361623>
- David Parnas, “On the Design and Development of Program Families” —
  <https://cse.msu.edu/~cse870/Public/Homework/SS2003/HW5/Parnas_76-program-families.pdf>
- David Parnas, “Designing Software for Ease of Extension and Contraction” —
  <https://ocw.mit.edu/courses/16-355j-software-engineering-concepts-fall-2005/1c68d0f98909a126ec5eb6a0ff358ec7_parnas_ease.pdf>
- Frank DeRemer and Hans Kron, “Programming-in-the-Large Versus
  Programming-in-the-Small” — <https://doi.org/10.1145/800027.808431>
- John Guttag, “Abstract Data Types and the Development of Data Structures” —
  <https://doi.org/10.1145/942572.807045>
- David Garlan, Robert Allen, and John Ockerbloom, “Architectural Mismatch: Why
  Reuse Is So Hard” — <https://doi.org/10.1109/52.469757>
- Gregor Kiczales, “Beyond the Black Box: Open Implementation” —
  <https://doi.org/10.1109/52.476280>
- Software Engineering Institute, “A Framework for Software Product Line
  Practice” —
  <https://www.sei.cmu.edu/library/a-framework-for-software-product-line-practice-version-50/>
- Don Batory, “Feature Models, Grammars, and Propositional Formulas” —
  <https://www.cs.utexas.edu/ftp/predator/splc05.pdf>
- Dovrolis et al., “Evolution of a Narrow Waist: What Makes Protocols
  Succeed?” — <https://faculty.cc.gatech.edu/~dovrolis/Papers/evoarch-extended.pdf>
- Saltzer, Reed, and Clark, “End-to-End Arguments in System Design” —
  <https://web.mit.edu/Saltzer/www/publications/endtoend/endtoendA4.pdf>
- NIST SP 800-142, “Practical Combinatorial Testing” —
  <https://csrc.nist.gov/pubs/sp/800/142/final>
- RFC 6709, “Design Considerations for Protocol Extensions” —
  <https://www.rfc-editor.org/rfc/rfc6709.html>
- W3C Design Tokens Community Group 2025.10 format, resolver and color reports —
  <https://www.designtokens.org/tr/2025.10/format/>,
  <https://www.designtokens.org/tr/2025.10/resolver/>,
  <https://www.designtokens.org/tr/2025.10/color/>
- WCAG 2.2 contrast, non-text contrast and use-of-color guidance —
  <https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html>,
  <https://www.w3.org/WAI/WCAG22/understanding/non-text-contrast.html>,
  <https://www.w3.org/WAI/WCAG22/Understanding/use-of-color>
- CSS Fonts Module Level 4 — <https://www.w3.org/TR/css-fonts-4/>
- Portable Network Graphics (PNG) Specification, Third Edition —
  <https://www.w3.org/TR/png-3/>
- `NO_COLOR` convention — <https://no-color.org/>
- Material 3 color roles —
  <https://developer.android.com/reference/kotlin/androidx/compose/material3/ColorScheme>
- Carbon data-visualization color palettes —
  <https://carbondesignsystem.com/data-visualization/color-palettes/>
- Adobe Spectrum theme modes —
  <https://opensource.adobe.com/spectrum-web-components/tools/theme/api/>
- SVG 2 paths and painting plus SVG Markers and Filter Effects —
  <https://www.w3.org/TR/SVG2/paths.html>,
  <https://www.w3.org/TR/SVG2/painting.html>,
  <https://www.w3.org/TR/svg-markers/>,
  <https://www.w3.org/TR/filter-effects-1/>
- SVG Integration secure static modes and Content Security Policy Level 3 —
  <https://www.w3.org/TR/svg-integration/>, <https://www.w3.org/TR/CSP3/>
- LLVM and MLIR pass-management contracts —
  <https://llvm.org/docs/NewPassManager.html>,
  <https://mlir.llvm.org/docs/PassManagement/>
- W3C Test Methodology and Web Platform Tests reference tests —
  <https://www.w3.org/TR/test-methodology/>,
  <https://web-platform-tests.org/writing-tests/reftests.html>
- WebAssembly System Interface security principles —
  <https://wasi.dev/security>
- Node.js permission model limitations —
  <https://nodejs.org/api/permissions.html>
- emilkowalski apple-design skill —
  <https://www.skills.sh/emilkowalski/skill/apple-design>
- vercel-labs/beautiful-mermaid —
  <https://github.com/vercel-labs/beautiful-mermaid>
- CF Workers design system —
  <https://cf-workers-design-system.adewale-883.workers.dev/>
