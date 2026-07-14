# Brand primitives and forward-compatible family support — plan

Status: Section A is implemented by PR #163; Git history determines whether
that implementation is published on `main`. Section B is the normative
customization plan owned by `BUILD-31`. Root `TODO.md` owns live work. Section A
evidence lives in its
[landing record](./archive/section-a-rendering-contract-2026-07.md) and is
projected from the registries into the [generated capability
report](./section-a-capability-report.md). The upstream
compatibility baseline is the version-pinned
[`UpstreamMermaidManifest`](./upstream-mermaid-manifest.json), never a count or
roster copied into prose.

## Decision

The original direction still makes sense. The Section A implementation makes
its correctness, parity, consolidation, and forward-compatibility foundation
explicit; Section B builds richer customization on that
baseline:

1. Keep **Look + Palette** as the low floor.
2. Add a small public, semantic **Brand primitives** layer rather than restoring
   the old arbitrary `style.node` / `style.edge` / `style.group` API.
3. Add **semantic bindings** so authored classes, categories, statuses, and
   metadata can select brand slots without embedding raw CSS or SVG.
4. Reserve B4 as an evidence gate, not a prebuilt abstraction. Only if a concrete
   effect cannot be a primitive and does not justify a drawing backend may B4 add
   one deterministic post-positioning **Treatment** seam; otherwise v1 has no
   Treatment field, registry, pipeline, or conformance program.
5. Resolve all appearance inputs once into one immutable `ResolvedAppearance` shared
   by layout, Scene lowering, SVG, and PNG.
6. Treat Mermaid family and syntax growth as a versioned protocol. A new header
   must be recognized and preserved or diagnosed without being silently routed
   to Flowchart, even before Agentic Mermaid can render it.
7. Consolidate sources of truth as part of the work. Brand extensibility is not
   credible while family detection, style fields, option transport, semantic
   roles, or capability claims can drift between code paths.

This plan is the normative product and architecture decision. The
[documentation-only Cupertino prototype](../custom-style-cookbook.md#cupertino-prototype--documentation-only)
is one public-API probe; it is not a built-in, compatibility alias, separate
plan, or source of scheduled work.
Current family citizenship remains governed by
[`diagram-family-citizenship.md`](../contributing/diagram-family-citizenship.md),
and actionable work remains owned by [`TODO.md`](../../TODO.md).

## Vocabulary and claim boundary

Use these terms consistently in code, docs, tests, and product copy:

| Term | Meaning |
|---|---|
| **Style** | The umbrella appearance input accepted by the current APIs: a named or inline partial record that may be a Look, a Palette, or a composition of both. |
| **Look** | Geometry or material treatment such as crisp, hand-drawn, watercolor, or publication. |
| **Palette** | Semantic color values. A colors-only style is a palette. |
| **Brand primitives** | Role typography, spacing, shape, border, elevation, semantic status/category slots, and non-color visual cues. |
| **Mode** | One independently selectable context axis and value, such as `colorScheme: dark`, `contrast: high`, or `density: compact`; not a flattened combination name. |
| **Semantic policy** | Ordered bindings from authored/domain meaning to brand slots plus constraints evaluated over resolved tokens or Scene marks. |
| **Treatment** | Conditional B4 capability: a runtime-ordered, deterministic post-positioning decoration over typed Scene marks for a proved signature effect that does not merit a general JSON field. |
| **Brand pack** | A minimal versioned distributable record containing appearance fragments, ordered mode axes, bindings/constraints, and installed-resource references; B4 may add ordered Treatment references through an additive schema revision. |
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
- when B4's evidence gate passes, an expert can add a deterministic Treatment
  without replacing the compositor; otherwise the public API contains no dormant
  Treatment machinery;
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
   CLI, Code Mode, local and hosted MCP, editor, and website. A host may enforce a stricter
   security/resource value only when the generated field×surface matrix marks
   that cell `host-enforced` and the effective receipt reflects the constraint.
   A curated UI may hide advanced fields behind JSON import or an advanced
   panel, but it may not make them unreachable without an `unavailable` cell.
2. **Transport parity:** equivalent forwarded input through each entry point
   produces the same canonical `ResolvedRenderRequest` and
   `ResolvedAppearance` digests after excluding declared output-only fields.
   Host-enforced input is constrained before request resolution and produces the
   declared constrained receipt; unavailable input is explicit. No adapter
   silently drops or rewrites a shared field.
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

- transport x shared field records `forwarded`, `host-enforced`, or
  `unavailable` and proves the resulting request receipt and resolution;
- family x role/primitive proves semantic consumption and fallback;
- first-party backend x Scene mark/primitive proves rendering-contract parity;
- output x semantic/security contract proves SVG, PNG, ASCII and Unicode
  projection behavior;
- a small sentinel cross-product catches interactions between those dimensions.

Each matrix declares its state vocabulary. `diagnosed` or `unavailable` is an
accountable inventory state, not permission for a shared field to remain missing
indefinitely: the matrix must record an owner or an explicit product decision.
Release claims state the parity level and output, never the unqualified phrase
“full parity.”

## What the three brand probes established

| Probe | Source | What it proves |
|---|---|---|
| Cupertino prototype | emilkowalski's apple-design skill and public Apple design guidance | A borderless surface language needs elevation, role typography, radius and spacing discipline, designed modes, and semantic accent placement. The checked-in JSON demonstrates only the current public floor and is never auto-registered. |
| `vercel` | vercel-labs/beautiful-mermaid and the Geist visual language | Brand defaults, deterministic fonts, hairlines, live retheming, and motion cannot be represented completely by the current public JSON surface. |
| `cf-workers` | CF Workers design-system tokens | Real brands need surface/text ramps, strong+soft categories, status colors, sans+mono roles, scales, tinted layered shadows, signature treatments, and enforceable constraints. |

The following findings describe the pre-Section-A baseline that motivated the
correctness work; they are retained as historical design evidence, not as a
current capability inventory. The live request, output, backend, family and
role surfaces come from the generated capability report and runtime discovery.
At that baseline, `StyleSpec` provided seven palette slots, one font, sketch
stroke/fill controls, three backdrops, intent/mono metadata, and backend
selection. `RenderOptions` added explicit colors, global spacing, font, shadow,
security, interactivity, family options, config, and output controls. Mermaid
source added per-element `classDef`, `class`, `style`, `linkStyle`, metadata,
and family-specific semantics. They were useful customization points, but were
not one portable brand record:

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

Section A addressed these inconsistencies; Section B builds on the resulting
waists rather than reintroducing the baseline paths.

### Pre-Section-A customization and extension inventory (historical)

This frozen inventory records the implementation baseline used to make the
decision. It must not be updated as a second current API reference.

| Surface | Baseline customization points |
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
| `PngOptions` raster/font | `scale`, `background`, `fitTo`, `fontDirs`, `loadSystemFonts`, `onWarning`; only `style`, `seed`, and `ganttToday` forwarded into the SVG request at the baseline |
| `AsciiRenderOptions` terminal | `useAscii`, `paddingX`, `paddingY`, `boxBorderPadding`, `colorMode`, `theme`, `mermaidConfig`, `maxWidth`, `targetWidth`, `ganttToday` |
| Mermaid source | frontmatter and init config; title/accessibility; family syntax and metadata; `classDef`, `class`, `:::`, `style`, `linkStyle`; safe links/click metadata where supported; direction/layout/look/renderer settings; icons/images subject to family and security policy |
| SVG post-render | documented CSS custom properties plus emitted class/data/semantic identity hooks allow live retheming and inspection; direct DOM rewrites are not portable brand configuration |

The public programmatic extension points are:

| Extension point | Intended use | Baseline truth |
|---|---|---|
| `registerStyle(StyleSpec)` | reusable declarative Look or Palette | works, JSON-safe, and stackable; cannot register private face fields |
| `registerBackend(StyleBackend)` | new compositor/drawing algorithm over Scene marks | registration runs a bounded deterministic/security/semantic SVG smoke; claims remain declarations, and arbitrary IDs cannot currently be selected by valid public `StyleSpec` |
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
nontechnical criterion. The missing middle is public semantic bindings; a small
Treatment protocol is available only if B4's evidence gate proves it necessary.
Conversely, a field for every discovered brand detail would create a wide but
non-compositional schema. General primitives enter the alphabet only when they
have brand-independent meaning and lawful merge semantics; one-off details stay
outside the API until evidence supports either primitive or Treatment promotion.

### Research and standards basis

The plan treats the literature and industry practice as architectural evidence,
not name-dropping. The following findings change its boundaries and gates:

| Evidence | Consequence for this plan |
|---|---|
| Parnas's information-hiding criterion and program-family work | Section A hides likely-to-change parsing, layout, transport and rendering decisions behind stable behavioral contracts. Section B owns brand variability. Real brand probes discover commonality; holdout brands test whether it generalized. |
| Abstract data types and compositional systems | `ResolvedAppearance`, Scene primitives and kind-specific extension descriptors specify observable behavior and composition laws, not renderer representation. A stack is not compositional merely because it accepts many entries. |
| Software product-line and feature-model practice | Core assets and variability are explicit; mode axes and compatibility constraints replace a flat list of combinations. A-before-B is dependency direction with iterative feedback, not a waterfall. |
| Open implementations and architectural-mismatch research | The plan offers a graduated ladder of declarative fragments/BrandPacks, with one narrow post-positioning Treatment seam only if B4's evidence gate passes. The existing backend API remains an expert escape hatch outside the branding roadmap. |
| End-to-end and extension-design guidance | Core preserves identity, semantics and provenance; end surfaces validate accessibility, security, resource availability and actual output. Kind-specific contracts share identity/version policy without being forced through one heterogeneous registry or pipeline. |
| DTCG 2025.10 and mature design systems | A build-time/import compiler resolves external token aliases and maps typed values into Agentic Mermaid's smaller semantic schema. The render runtime does not become a second general design-token engine. |
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
| 2. Custom style fragment | save and validate a reusable JSON fragment | tens of minutes; hours with visual review | the current `StyleSpec` low floor, without registration or family knowledge |
| 3. Brand pack | map existing design tokens, roles and modes into versioned JSON | hours to days depending on token quality | designer/design-system owner; portable typography, geometry, elevation and modes |
| 4. Semantic policy | add class/tag/status/category bindings and constraints | hours plus cross-family QA | domain-aware branding without selectors or renderer code |
| 5. Treatment (conditional) | if B4 is promoted, publish a trusted TypeScript decoration and pass conformance | days | proved signature ornaments or material effects over positioned typed Scene marks |

Levels 0–2 exist today, although Level 2 is less capable than built-in styles.
Levels 3–4 are proposed APIs; Level 5 exists only if B4 is promoted and then adds
its selector to the same style/BrandPack path. The existing backend API remains a
separate expert escape hatch; custom-backend packaging is not part of this roadmap. Existing
named styles, `StyleInput[]` stacks, inline records and style JSON files remain valid and
compile through the new resolver; a pack name or version is never required for
the low-floor workflows.

These are capability tiers over one algebra, not incompatible schemas. Level 2
today is the legacy reusable `StyleSpec` subset. B0 introduces
`AppearanceFragment`, which later phases enrich with roles and may carry B3
bindings/constraints inline. A BrandPack packages fragments, modes and policy for
reuse; it is not required to unlock those semantics.

The author-effort gate is therefore not merely “the schema validates.” An
unfamiliar user must be able to create a Palette, a role-rich brand,
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
       [if B4: post-positioning Treatment additions]
                             v
                      backend/output
```

The input stack has lawful precedence; these arrows show compilation stages,
not another inheritance or merge order. A Look or Palette can be used alone,
stacked with the other inputs, or packaged inside a BrandPack.

All declarative fragments remain partial, JSON-safe, and expressed in Agentic
Mermaid's semantic vocabulary. The v1 schema is deliberately smaller than a
general design-token or package manager.

#### What a BrandPack is and why it exists

An `AppearanceFragment` answers “change these appearance values for this
render.” A **BrandPack** answers “install and reproduce this named design system
over time and across tools.” It gives an ordered fragment stack an identity,
version, compatibility range, orthogonal modes, and references to resources that
the host has already installed and allowlisted.

A pack is unnecessary for one-off customization. It contains no executable
code, markup, callbacks, ambient URLs, dependency resolver, migration program,
or second inheritance system. Package installation and integrity live at the
host/package boundary; the declarative pack only names installed resources.

```ts
interface BrandPack {
  $schema: string
  identity: ExtensionIdentity<'brand-pack'>
  displayName?: string
  description?: string
  deprecated?: boolean | string
  fragments: AppearanceFragment[]
  modes?: {
    axes: Array<{
      id: string
      default: string
      values: Record<string, AppearanceFragment>
    }>
  }
}

interface AppearanceFragment {
  // Compatibility-normalized current Look fields: stroke/fill algorithms and
  // tuning, backdrop, intent and mono. Legacy font/color/width fields compile
  // into the semantic leaves below rather than remaining parallel authorities.
  look?: StyleLookFragment
  tokens?: {
    colors?: {
      page?: TypedColor
      surfaces?: Partial<Record<'base' | 'raised' | 'sunken' | 'overlay', TypedColor>>
      text?: Partial<Record<'primary' | 'secondary' | 'muted' | 'inverse', TypedColor>>
      line?: TypedColor
      border?: TypedColor
      accent?: SemanticColorPair
      statuses?: Partial<Record<'success' | 'warning' | 'error' | 'info', SemanticColorPair>>
      categories?: Record<string, SemanticColorPair>
      data?: {
        qualitative?: SemanticColorPair[]
        sequential?: ColorRamp
        diverging?: ColorRamp
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
}

type SemanticColorPair = {
  strong: TypedColor
  onStrong: TypedColor
  soft?: TypedColor
  onSoft?: TypedColor
  border?: TypedColor
  icon?: TypedColor
}

interface ColorRamp {
  stops: Array<{ position: number; color: TypedColor }>
  interpolationSpace: ColorSpace
}

interface NonColorCue {
  symbol?: string
  marker?: MarkerToken
  dash?: DashToken
  hatch?: HatchToken
}

type FontStackRef =
  | InstalledResourceRef
  | { resources: InstalledResourceRef[]; genericFallback?: string }
```

Mode axes such as `colorScheme`, `contrast`, `density`, and `scale` remain
orthogonal. The array order is the resolution order, so there is no second
`resolutionOrder` representation or invalid permutation. V1 deliberately has no
cross-axis `combinations` language: a caller appends an explicit fragment for a
rare interaction until multiple holdout brands prove packaged conditionals are
common. Duplicate axis IDs, missing defaults, unknown values, and unknown
selections are errors. Host-derived selections are materialized in the request
digest rather than remaining ambient context.

`StyleSpec` is a compatibility facade and the Level 2 fragment format, not a
second resolver. Widen the existing public `StyleInput` stack rather than adding
a parallel `appearance` option:

```ts
interface BrandSelection {
  pack: ExtensionIdentity<'brand-pack'>['id']
  version?: SemverRange
  modes?: Record<string, string>
}

type StyleStackInput = StyleInput | AppearanceFragment | BrandSelection

interface RenderOptions {
  style?: StyleStackInput | StyleStackInput[]
}
```

Every entry is validated and normalized to an `AppearanceFragment`, then merged
left to right before source styling and explicit render overrides. A BrandPack
is selected only by installed namespaced ID; an inline one-off is already an
`AppearanceFragment`. This preserves the one public concept and one combination
rule established by the Style rollout while keeping “make corners 8px” at the
low floor. CLI, MCP, editor, and future surfaces project this same field.

`validateBrandPack`, `registerBrandPack`, `getBrandPack`, and
`knownBrandPacks` own one kind-specific BrandPack registry and reuse the shared
identity, collision, version and snapshot helpers. Style and BrandPack
registries feed one generated installed-appearance discovery projection; they
do not share a heterogeneous backing map or create uncoordinated discovery lists.
Loading or validating JSON never registers executable code. The base B2 schema
has no Treatment selector. If B4 is promoted, an additive schema revision adds
one ordered `treatments?: TreatmentRef[]` leaf; a reference can select only code
the host already installed and allowlisted. V1 has a schema version and
validator, not a migration framework; the first real breaking schema change
must promote a migration design through `TODO.md`.

The Design Tokens Community Group 2025.10 reports are an interchange input, not
the runtime schema. A pure `fromDtcg(document, mapping)` importer resolves aliases,
checks cycles/types, maps explicit token paths into semantic slots, and emits an
ordinary fragment or pack plus provenance. It never guesses meaning from group
names. The renderer therefore consumes concrete typed values instead of carrying
a second alias graph, resolver-context language, or vendor extensions.

Typed colors retain color space and alpha in
`ResolvedAppearance`; `ResolvedRenderRequest` declares the target output profile,
conversion and gamut policy so SVG and PNG make the same conversion.
Foreground/background pairs and non-color cues are first-class. A brand supplies
qualitative series or a color ramp; chart families own domain, sampling,
midpoint, and overflow policy because those are data semantics, not brand
semantics.

`FontStackRef` resolves only through installed resources. The frozen render
snapshot records selected resource hashes, face index, weight/style, glyph
coverage, and a metrics/shaping fingerprint. Ambient system-font lookup is not
a portable identity unless exact selected faces and hashes enter the snapshot.

Packs compose only through the caller's explicit `style` stack—there is no
hidden `extends` graph. Arrays are atomic replacement leaves; resource
requirements are derived from concrete fragment references rather than repeated
in a second list. If B4 is promoted, its ordered Treatment list is also an atomic
leaf and duplicate IDs are validation errors rather than a bespoke option-update
merge rule.

JSON `null` is rejected in v1 rather than acquiring an accidental clear/reset
meaning; omission means inherit. A later reset operation requires an explicit
typed sentinel and composition laws. V1 bindings are equality matches over
normalized class, tag, status, category and namespaced metadata fields. V1
constraints are a closed catalog with `warn | error` actions. CSS selectors,
tree queries, arbitrary predicates, renderer-private fields, general constraint
expressions, and automatic rewriting remain outside the declarative language
until separately justified.

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
- a third-party installed package can bundle license-compatible fonts and, only
  if B4 is promoted, trusted Treatments through the same kind-specific identity,
  discovery and conformance conventions used by first-party packages;
- standalone untrusted JSON remains intentionally unable to embed executable
  code, markup, callbacks, fonts, or arbitrary URLs. It may reference only
  installed, host-allowlisted resources and extensions.

By B3, a declarative custom brand can exceed a current built-in face in semantic
roles, status/category slots, modes, bindings and constraints. If a proved effect
promotes B4, installed third-party and first-party Treatments receive the same
narrow decoration contract. B5 proves and ships built-in equivalence. Custom
compositor packaging is outside this branding roadmap; the remaining intentional
differences are host trust and installed resources, not private styling fields.

| Capability | Public custom style now | Built-in style now | Target custom API |
|---|---|---|---|
| generated palette channels, global font, stroke/fill/backdrop | native | native | preserved as the Level 2 compatibility floor |
| node/edge/group typography and paint | unavailable | private `InternalStyleFace` | public stable core roles |
| role padding, radii, widths and edge bend | only coarse global render options | private face scalars | public role geometry using shared measurement/render values |
| title, legend, axis, technical and future-family roles | family-specific or unavailable | no universal built-in contract | core plus namespaced roles with required fallback |
| surface/text ramps and sans/mono pairing | unavailable | flat colors and one main font; partial private overrides | named semantic tokens consumed consistently by adapters |
| status/category strong+soft slots and bindings | authored family-local styles | unavailable | declarative normalized bindings over Scene channels |
| light/dark/high-contrast/density modes | separate names/caller stacks | separate names/caller stacks | orthogonal mode axes with deterministic resolution |
| elevation and signature material effects | boolean shadow or whole backend work | renderer/private implementation | declarative elevation tokens; a typed Treatment only if B4 is promoted |
| constraints | advisory `intent`/`mono` only | no enforcement advantage | resolver/Scene `warn | error` constraints |
| distribution and design-token ingestion | style JSON, `fromShikiTheme`, caller fonts | repository registration and bundled fonts | namespaced packs, a DTCG-to-fragment importer, and installed resources |
| new compositor | backend registration; declarative style data cannot select host code | core can wire an ID | outside this branding roadmap; A1 removed `StyleSpec.backend` and kept trusted host selection separate |

Promoting `InternalStyleFace` alone would close only part of rows two and three.
It would not provide modes, semantic bindings, token ramps, constraints,
packaging, transport parity or forward-compatible family roles; if B4 is
promoted, it would not provide Treatments either.

### Semantic role vocabulary

The public roles should be fewer and more stable than Mermaid's family-specific
syntax. Family adapters map concrete marks into this core vocabulary:

| Role group | V1 core candidates | Examples across families |
|---|---|---|
| document | `page`, `title`, `label`, `annotation`, `legend`, `axis`, `grid` | diagram/chart titles, notes, labels, axes and grids |
| structure | `container`, `entity`, `relation`, `dataMark` | subgraphs and Architecture groups; nodes/records; connectors; bars/points/slices |
| semantic emphasis | `technicalLabel`, `status`, `progress` | code-like labels, Gantt/GitGraph state and progress |

Family nouns such as `actor`, `service`, `task`, `event`, `message`, `lifeline`,
`bar`, `slice`, `lane`, and `domain` remain namespaced roles unless independent
brand evidence proves a stable cross-family distinction. Section A already
admits stable built-in roles plus namespaced `SceneRole` identifiers. Section B
adds one core fallback and brand-slot semantics to each namespaced role; it does
not turn the core vocabulary into an inventory of every Mermaid concept.

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
cascade and final mark paint/geometry. `ResolvedAppearance` carries the compiled
closed-catalog rules; token constraints run after appearance resolution, while
final Scene constraints run after any post-positioning decorations and before
the backend. They return stable diagnostic codes identifying the resolved
role/mark that violated each rule.

`BrandConstraint` is a discriminated union of those named, typed core rules—not
an expression AST or extension language. Adding a rule requires the same
cross-brand evidence, composition law, and conformance path as adding a primitive.

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

### Conditional Treatment evidence gate

A **Treatment** is the name reserved for trusted, host-installed code that adds
one proved signature decoration to an already positioned Scene. It exists only
to avoid forcing a genuinely decorative long-tail effect into either a universal
primitive or a replacement backend.

B4 is not an API commitment. Until a concrete effect passes B4's primitive-
versus-backend evidence gate, there is no public Treatment field, descriptor,
registry, selection path, pipeline, or conformance claim. If the gate passes,
B4 must preserve positioned geometry, semantic identity, accessibility, hit
geometry, determinism, strict output security, and monotonic final bounds; the
smallest protocol that proves those invariants is designed then. The B4 phase
below is the sole owner of that decision and its acceptance criteria.

### One resolved appearance

Every surface compiles the style stack, selected modes, bindings, constraints,
and explicit overrides into one immutable internal `ResolvedAppearance`. Layout
reads only geometry-affecting resolved values; Scene lowering and backends read
paint values from the same object. If B4 is promoted, selected installed
Treatments are a separate ordered request capability carried by the BrandPack
leaf, not another appearance merge language. No renderer re-merges raw fragments.

`ResolvedAppearance` is a runtime-owned abstract data type, not an accepted,
persisted, or independently negotiated schema. Consumers receive
capability-scoped readonly views for geometry, paint, resources, or constraints
rather than depending on physical fields. Test digests carry an internal format
tag for observable equivalence without freezing private layout.

Global brand styling is a default, not a replacement for authored Mermaid
semantics. The intended paint precedence is:

```
engine defaults < style stack (Look/Palette/fragment/BrandSelection) < source theme/config
  < authored class/style/linkStyle < explicit render overrides
```

If B4 is promoted, Treatments consume already styled, positioned marks and may
add typed decoration only. Brand constraints inspect the final outcome and
report policy separately rather than silently erasing authored styling.

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

## Pinned Mermaid family envelope

The machine-readable upstream manifest records the full official public surface,
including core, first-party external, compatibility aliases, maturity, and
inventory-only entries. `FamilyDescriptor` and the generated capability report
join that upstream identity to current Agentic Mermaid behavior. This plan does
not repeat either roster or status table.

Reviewing the complete upstream syntax surface established the reusable pressure
set Section A must support consistently: graph and hierarchy semantics;
sequence/UML relationships; authored grids and fixed coordinates; quantitative
bands, areas, series, axes and legends; schedules and temporal markers;
indentation, CSV and grammar dialects; icons, images and external resources;
classes, inline styles and interaction metadata; universal config,
accessibility and comments; beta/graduated aliases; and first-party external
loading. Each pressure is represented by a typed primitive, a family-owned
semantic adapter, explicit source preservation/diagnosis, or an advertised
not-applicable state—never by routing an unfamiliar header to Flowchart.

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

The committed `UpstreamMermaidManifest` is generated from the pinned Mermaid
package, official docs navigation/pages (including pages missing from navigation),
config schema, detector registry, beta policy, external first-party registrations,
and harvested upstream fixtures. Every public family owns exactly one hashed
official syntax page; generated heading-level feature and deduplicated example
inventories cover supported and unsupported families alike; introduction and
deprecation are either a cited version or explicitly `not-declared`; external
first-party entries are validated separately from the core detector registry.
The manifest records the Mermaid version and source commit/SHA. Runtime detection
consumes a compact generated family projection, not this semantic audit corpus.
On dependency upgrade, CI reports:

- families or dialects added/removed;
- new or changed headers and aliases;
- stable/beta/experimental status changes;
- added/removed syntax features and examples;
- config and theme-variable schema changes;
- new external asset, interaction, layout, or security behavior.

The manifest is an inventory and change detector, not proof of semantic parity.
Every claimed native cell still needs executable evidence.

### One family descriptor

One canonical `FamilyDescriptor` subsumes the former `FamilyPlugin` plus
`BUILTIN_FAMILY_METADATA` authority; no second registry is layered over it. The
legacy metadata API is only a generated compatibility projection of descriptors;
independently authored metadata and copied projections are deleted. Each
descriptor declares:

- stable internal ID, official upstream ID, headers/aliases, maturity/version;
- detector and collision priority;
- minimal example and official fixture references;
- parser/preservation/mutation/verification hooks;
- config section/key/no-op inventory and the family diagnostic entry point;
- layout and semantic Scene lowering;
- semantic roles/channels and brand-consumption map;
- accessibility/security/asset policies;
- capability states and evidence references.

Canonical authority does not mean a physical god object. `FamilyDescriptor` is
a declarative manifest plus references to stable operations; parser, layout and
backend representations stay hidden behind those behavioral interfaces. Generic
backends/output adapters consume Scene; a family-specific output projection is
an exceptional namespaced capability with an explicit diagnostic, not a required
SVG/PNG/terminal hook on every family.

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

- Persisted authoring formats are versioned: the `StyleSpec` compatibility input
  now, and `BrandPack` once B2 exists. The small readonly interfaces exposed to
  installed extensions are versioned too. `ResolvedAppearance` remains internal
  and is not independently negotiated.
- Human-friendly names and version ranges are authoring inputs. A
  reproducibility record locks the exact pack, backend, core/Scene/config
  contracts, resources/content hashes, frozen capability decision, and—when B4
  exists—selected Treatment identities. Replaying without that snapshot is
  best-effort.
- Extension kinds share only
  `ExtensionIdentity { id, kind, version, compatibility, provenance }` plus
  namespacing/collision helpers. `FamilyDescriptor`, `BackendDescriptor`,
  `ResourceManifest`, and—once B2 exists—`BrandPack` remain
  kind-specific typed views backed by separate registries;
  `TreatmentDescriptor` joins them only if B4 is promoted. Families
  are keyed dispatch, resources are data, backends are selected compositors, and
  only an activated B4 Treatment set forms an ordered pipeline. Registration
  collisions fail; replacement is explicit; every render freezes the relevant
  typed snapshots.
- The family + backend + output + host-policy capability set is negotiated before
  layout/render. The Treatment stack joins that negotiation only when B4 exists.
  A missing required capability is a structured error; a missing preferred
  capability follows one declared lossy/projected fallback with a diagnostic;
  optional unknown capabilities remain inert and discoverable.
- Family IDs, role IDs, config keys and open `CapabilityId` strings are
  namespaced; B2 adds `brand-pack:` IDs and B4 adds `treatment:` IDs only if
  promoted. Capability requirements are `required | preferred | optional` and
  may carry numeric limits; a closed enum must not make an unknown future ID
  unrepresentable.
- The existing backend API retains its executable backend/Scene admission gate.
  Its versioned, frozen matrix directly proves deterministic `drawNode`
  and document SVG, one safe SVG envelope, and one exact witness for every
  first-party core primitive/feature/operation claim. The discoverable report
  pins Scene and output-security contract versions and marks namespaced extension
  claims explicitly unverified when no core witness exists. This is bounded SVG
  conformance, not family-scale visual, bounds, hit-testing, performance, or PNG
  pixel certification. PNG inherits admitted SVG through separately tested
  canonical secured rasterizers.
- If B4 is promoted, publish its broader versioned Treatment conformance suite.
  That suite should pin core/interface/resource versions and hashes and test
  routing, opaque behavior, mark/role acceptance, style composition, pass order,
  accessibility, hit/bounds behavior, security, resource integrity, failure
  isolation, unknown optional capabilities and discovery. Every advertised
  capability cites passing fixture IDs and the pinned runtime/environment;
  structural assertions are paired with reference renders and explicit fuzzy
  thresholds where exact bytes are inappropriate.
- Conformance includes greasing fixtures for unknown optional capability/config/
  role values and required-unknown failures so extension paths do not ossify
  around only today's registrations.
- Discovery and negotiation preserve unknown namespaced capability IDs; unknown
  required features fail with one structured unsupported list. Declarative v1
  schemas reject all unknown fields, including would-be extension payloads, so a
  typo cannot become inert configuration. A future extension field requires a
  separately versioned schema decision.
- Deprecations remain accepted and diagnosed for a published compatibility
  window. V1 has no migration registry; promote one only for an observed breaking
  persisted-format change.
- External icons, images, links, fonts, and callbacks use explicit capability and
  security policies. Offline/strict output never fetches ambient resources.
- Installed resources use a content-addressed manifest with logical ID, package
  path, media type, SHA-256 digest, byte size, license and required/optional
  status. Reject traversal, symlinks, MIME mismatch and declared limits; a
  readonly resolver exposes only verified resources.
- Every first- or third-party backend result passes through one fail-closed
  `OutputSecurityPolicy`: active content is rejected in every mode and strict
  mode additionally rejects every external reference. Raw Mermaid `themeCSS`
  is diagnosed before rendering because selectors can escape an imported SVG;
  declarative StyleSpec is the safe replacement. The gate validates without
  rewriting XML, approved resources are embedded or integrity-checked, and
  backend trust never bypasses it.

#### Extension trust tiers

Trust is independent of capability and expressiveness:

| Tier | Content and authority |
|---|---|
| Declarative | Appearance fragments, BrandPacks and resource manifests are data only. They may select installed, allowlisted IDs but never import, download, execute or escalate host policy. |
| Trusted in-process | Backends, and Treatments only if B4 is promoted, run after explicit host installation and allowlisting. They remain subject to typed input/output, resource, determinism, budget and output-security contracts. |
| Future untrusted code | Requires a separate worker/process or WASI-style capability sandbox with explicit imports plus CPU, memory, time and output budgets. A runtime permission flag is not treated as a hostile-code sandbox. |

### Native-family adoption boundary

Section A6 supplies recognition, preservation, negotiation and conformance; it
does not create a shadow adoption queue. Native-family growth is owned only by
`BUILD-6` and each promoted family must pass the citizenship, syntax, primitive,
backend, output and extension contracts then in force. Priority is decided from
current demand, maturity and evidence when work is promoted. Inventory-only
entries remain compatibility inputs unless a focused root TODO explicitly makes
one product work.

## Internal-consistency contract

Internal consistency is a deliverable, not incidental refactoring.

One declaration should enter one registry-driven pipeline:

```
detect -> lossless envelope -> family parse -> semantic normalize
  -> resolve request/appearance + token constraints -> layout -> PositionedScene
  -> final bounds/viewBox + Scene constraints
  -> generic backend/output adapter
  -> OutputSecurityPolicy -> output validation/projection
```

If B4's evidence gate is later passed, its single typed, post-positioning
addition step is inserted between `PositionedScene` and final bounds. Section A
deliberately ships no generic addition registry, selector, or pipeline.

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
  subpaths/closedness, exact path marker-mid vertices distinct from routed or
  curve-control points, per-contour marker anchors and endpoint tangents, label
  anchors and hit geometry;
- bend geometry (`bendRadius`) separately from stroke-corner paint;
- stroke width, color/opacity, dash array/offset, `lineCap`, `lineJoin`,
  `miterLimit`, path-length calibration, paint order and optional non-scaling
  policy;
- typed start/mid/end marker archetypes or geometry, `viewBox`, `refX`/`refY`,
  overflow, `markerUnits`, fill/stroke/context paint, scale, orientation, bounds
  and stable resource identity;
- label paint, typography, visual ownership, halo and the marker/label
  clearance required by layout;
- a typed terminal evidence projection and stable diagnostics for features a
  character grid cannot represent. Family cell-grid routing remains
  family-owned; topology defects such as `TERM-1` and `TERM-2` are not disguised as
  primitive parity.

Bounds and hit testing include cap extension, half stroke width, acute miter
spikes, marker bounds, filters/shadows, and declared Treatment displacement only
when B4 exists.
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

Before Section A, `tufte` meant both a palette in `THEMES` and a full Look in
the style registry; built-in Look registration silently overwrote the palette
entry. This represented the broader historical overlap between “theme,”
“palette,” and “style.” Section A introduced explicit kinds and
collision-safe names such as `palette:tufte` and `look:tufte`. The bare
`tufte` alias selects the historically observable full Look during a
published compatibility window, with discovery showing its canonical ID and
the formerly shadowed palette becoming directly addressable. New registrations
must be namespaced and cannot silently replace another kind or owner.

This cleanup happens before BrandPack naming. Otherwise the pack registry would
institutionalize the same ambiguity at a larger scale.

### Canonical authorities

| Concern | Canonical authority | Derived consumers |
|---|---|---|
| upstream Mermaid inventory | `UpstreamMermaidManifest` | upgrade diff, compatibility/adoption review, syntax fixtures, maturity labels |
| shipped family and capabilities | `FamilyDescriptor` registry | types/narrowers, routing, CLI/MCP/editor/site/docs, citizenship matrix |
| public brand/style fields | one typed field manifest + JSON Schema | the single `style` stack, `StyleSpec` compatibility input, `BrandPack`, validator, docs, and generated controls for every enrolled surface |
| semantic roles/channels | core role registry + family adapter declarations | Scene types, brand consumption matrix, constraints, and Treatments only if B4 exists |
| render request | one normalized `ResolvedRenderRequest`, shared-field manifest and output projection descriptors | SVG, PNG, ASCII/Unicode, CLI, Code Mode, MCP, editor, website |
| appearance resolution | one pure `resolveAppearance` | measurement, layout, Scene lowering, all render backends |
| Scene and primitives | versioned Scene/Connector schema plus bounds, identity, hit-testing and ordering invariants | layout, backends, accessibility and conformance suites; B4 reuses the invariants if promoted |
| extension identity | shared identity/namespacing helpers plus the Style registry's typed Palette/Look views and separate family/backend/resource registries; B2 adds a separate BrandPack registry and B4 may add Treatment | collision-safe registration, one generated discovery projection, negotiation and frozen typed snapshots; no generic extension pipeline or cross-kind heterogeneous backing map |
| capability decisions | declarations on kind-specific descriptors plus existing conformance evidence | generated preflight result, diagnostics, fallback/error policy, matrices and product claims |
| conformance evidence | the existing characterization catalog and citizenship/style/backend suites, extended with stable capability IDs | generated implementation reports and release claims without a second fixture catalog |
| output security | one `OutputSecurityPolicy` | every backend/output adapter and editor insertion path |
| examples | family descriptor minimal example + a shared example manifest | editor, website, docs, evals, contact sheets |
| live work | root `TODO.md`; landing/completion evidence may enter `docs/project/archive/` only with explicit status and no unchecked work | issues/PRs; this plan supplies dependency and acceptance evidence, not a second checklist |

### Consistency invariants

- vocabulary in this plan, public docs, types, diagnostics, and capability JSON
  uses the glossary above;
- every declared family header routes identically through every enrolled
  parsing/render surface;
- every public field has one descriptor projected into TypeScript, runtime
  validation, JSON Schema, docs, and every enrolled surface. Runtime admission is
  identical across transports; schemas encode every portable structural
  constraint and name any recursive/security validator that cannot be expressed
  exactly in standard JSON Schema rather than silently weakening it;
- every render surface records each shared field as `forwarded`,
  `host-enforced`, or `unavailable`; the latter has a stable diagnostic and
  host enforcement is visible in the effective receipt—never silent omission
  or rewriting;
- equivalent forwarded fixtures entering through the library, CLI, Code Mode,
  local/hosted MCP, editor and website adapters produce the same shared
  resolved-request and resolved-appearance digests; host-enforced fixtures
  produce the declared constrained digests, and output-only fields are excluded
  by a checked manifest, not hand-picked by each test;
- layout and rendering consume identical resolved typography/spacing/shape
  values;
- all family adapters account for every core role they emit and every public
  primitive they consume;
- SVG preserves DOM identity and accessibility metadata. PNG rasterizes the
  same secured semantic geometry and branded appearance and carries the same
  logical request receipt, but DOM identity and ARIA are not representable in
  pixels and are explicitly not claimed as PNG payload features;
- every backend result passes the same output-security validator; trusted code
  has no direct route around the final security boundary;
- ASCII/Unicode derives a `ResolvedTerminalStyle` from the same brand roles and
  bindings, preserving hierarchy/emphasis/status meaning and diagnosing visual
  primitives that the selected color mode cannot represent;
- registry projections use deterministic order and generated counts;
- generated freshness tests are paired with semantic invariants;
- family-specific behavior stays family-specific. Consolidation removes duplicate
  protocol and mechanics, not distinct domain metaphors or layout algorithms.

## Deletion-first rule

This is a replacement program, not an abstraction-accumulation program. A phase
is incomplete until its superseded authority is deleted in the same change or
has one compatibility owner, removal release/date, diagnostic, and test proving
new code cannot depend on it. A new public option, registry, IR, resolver,
pipeline, fixture catalog, or manifest must name what it replaces; otherwise it
requires a separately promoted evidence-backed TODO item.

Track negative as well as positive evidence: raw `StyleSpec`/theme reads below
the resolver, copied request fields, parser/detector switches, duplicate registry
entries, family-local marker XML, `RawMark` escapes, manual schema declarations,
and active roadmap documents must trend down. Generated files count as fewer
authorities only when their source manifest and semantic invariant are singular.

| Phase | Required subtraction before exit |
|---|---|
| A0–A1 | remove incorrect capability claims and copied discovery lists; remove `StyleSpec.backend` from declarative authoring; make legacy aliases diagnosed and time-bounded |
| A2 | delete PNG's manual shared-field forwarding and source reparse; remove raw appearance re-resolution below the waist; reduce `THEMES` and legacy style/color records to generated compatibility projections |
| A3–A4 | delete connector/marker reconstruction from SVG strings, parallel family detectors and independently-authored metadata, duplicate universal-envelope parsing, and independent render/layout positioning paths as their typed replacements land |
| A5–A7 | replace—not supplement—the strip-only SVG security path; delete copied schemas/tables/counts and any second fixture/capability catalog; archive completed execution plans |
| B0–B1 | add no `appearance` option or second stack; prove the public role surface with representative built-ins while private forms remain derived compatibility inputs |
| B2–B4 | add no runtime DTCG alias engine, migration registry, mode-combination language, semantic/paint Treatment phases, or custom-backend packaging without separately promoted evidence |
| B5 | migrate each built-in to the lowest sufficient public tier and delete the private path it formerly required |

## Consolidation record and remaining opportunities

### In this plan and its documentation set

1. Keep this document as the only active decision and dependency order for brand
   primitives. Keep the Cupertino example in the custom-style cookbook as a
   public-API probe, never as a built-in or a second plan.
2. Treat [`archive/styles-rollout.md`](./archive/styles-rollout.md) as the executed
   history of Style + Palette, not a second active brand roadmap.
3. Keep
   [`archive/remove-role-styling-plan.md`](./archive/remove-role-styling-plan.md)
   as historical rationale. The new semantic brand-role layer is a redesigned
   global interface, not resurrection of arbitrary per-element role objects.
4. Keep the qualitative family hallmarks and visual evidence in
   [`mermaid-family-fidelity-audit.md`](../design/mermaid-family-fidelity-audit.md)
   human-reviewed, while tests derive its required row presence from the family
   registry. Machine capability claims live only in the generated capability
   report.
5. Extend the existing citizenship matrix instead of creating a second brand
   support matrix: add brand-role consumption and output parity as checked
   capability/evidence fields.
6. Put promoted implementation items in root `TODO.md` with stable IDs; the plan
   explains dependencies and acceptance criteria but does not track duplicate
   checkboxes.

### In Agentic Mermaid

Section A already consolidated family routing, render-request transport,
positioned artifacts, StyleSpec and RenderOptions definitions, appearance
resolution, universal source envelopes, extension identity, font/style/palette
catalogues, CSS named colors, strict output security, and resource provenance.
The compatibility names that remain are generated views, not alternate owners.

Residual implementation opportunities and their priorities live only in root
[`TODO.md`](../../TODO.md): Section B is owned by `BUILD-31`, and proven
mechanical duplication is owned under
[Consolidation / dedup backlog](../../TODO.md#consolidation--dedup-backlog).
This plan retains dependency and acceptance invariants, not another ranked work
queue.

Do not consolidate family parsers into a universal grammar, family layouts into a
universal layout algorithm, or family palette semantics into one cycling rule.
The reusable waist is protocol, roles, resolution, and mechanics; family meaning
remains behind adapters.

This work builds on the completed post-PR-149 consolidation pass and leaves the
remaining `CONS-*` work solely in `TODO.md`; it does not reopen that historical
roadmap. Section A's registry, positioned-artifact, transport and authority
gates remain regression contracts. Section B adds only named-style/public-style
equivalence and complete brand-role fallback evidence.

## Execution plan: Section A before Section B

The plan has two product boundaries rather than interleaved “brand” and
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
A5 + B0 -> B1 semantic Styles + sentinel built-in equivalence
A6(protocol) + B1 -> B2 BrandPacks
B1 + B2 -> B3 bindings/constraints
A3 + A5 + B1 + B2 -> B4 post-positioning Treatments (conditional)
A7 + B2 + B3 -> B5 migration, usability and release evidence
B4 -> B5 only when an evidence-backed Treatment was implemented
```

Section A does not wait for BrandPacks. Section B does not wait for every missing
Mermaid family, but each newly registered family must use the Section A protocol
and pass the current Section B sentinel contract available at that time.
These are implementation prerequisites; public release of a B capability also
requires its relevant A5 parity gates. `A6(protocol)` means recognition,
version negotiation, namespaces and conformance—not completion of native-family
adoption work, which remains solely owned by `BUILD-6`.
“A before B” is dependency direction, not waterfall: holdout brands and real
authoring work in B may reveal a recurring missing primitive, but promotion back
into A requires cross-family evidence, a behavioral contract, compatibility
review and conformance tests rather than a brand-specific shortcut.

### Phase-to-TODO ownership

`TODO.md` is the only status-bearing backlog. The phases below are dependency
and acceptance boundaries, not another checklist; the documentation-only
Cupertino example and other brand research supply probe evidence only.

| Plan boundary | Status owner | Independent scope retained |
|---|---|---|
| A0–A7 | PR #163 implementation and [`Section A landing record`](./archive/section-a-rendering-contract-2026-07.md) | referenced `CONS-*`, `SRC-*`, `TERM-*`, security, family-adoption and evidence items keep any work beyond Section A |
| B0–B5 | active `BUILD-31` | documentation-only Cupertino/holdout acceptance evidence; native-family adoption remains `BUILD-6` |

The graph above defines hard phase dependencies. Reused IDs in the table retain
their independent scope, status, and evidence; `BUILD-31` coordinates Section B
without absorbing or silently closing them.

Newly shipped surfaces such as those proposed by `BUILD-27`, `BUILD-28`, and
`BUILD-29` join the A2/A5
transport contract when they land; they do not create parallel brand inputs or
block the current program.

## Section A — correctness, parity, consolidation, and essential primitives

Section A's implementation is carried by PR #163. The
[landing record](./archive/section-a-rendering-contract-2026-07.md) preserves
its evidence and execution history; Git history, rather than mirrored status
prose, determines whether that implementation is present on `main`.

Root `TODO.md` is the sole status-bearing backlog. This table preserves the
permanent contract and names executable evidence; it does not create phase
checklists or imply that independently owned work is complete.

### Permanent Section A contract

| Boundary | Permanent invariant | Generated or machine-evidence authority | Ongoing TODO owner and independent scope |
|---|---|---|---|
| A0 — truth and characterization | Claims use the applicable checked state vocabulary for their dimension; family syntax, transport, output, backend and realization states are never mixed into one ambiguous scale. Registries, current precedence, routing, fields and capability behavior are characterized before they change. | Generated Section A capability report; `section-a-capability-report.test.ts`; `section-a-render-contract.test.ts`. | New gaps are promoted only in `TODO.md`; characterization evidence in the landing archive is not a backlog. |
| A1 — identities and registries | Shared `ExtensionIdentity` rules feed typed, kind-specific family, backend, resource, Palette and Look registries; external executable families and backends declare compatible core ranges before hooks run, Scene consumers also declare Scene ranges, and deterministic discovery exposes only committed registrations. Compatibility aliases such as bare `tufte` are diagnosed and time-bounded rather than silently shadowing canonical names. | Registry descriptors and generated discovery projections; `extension-registries.test.ts`; `style-spec-authority.test.ts`; `family-registration-conformance.test.ts`. | Alias removal is owned by `COMPAT-1`; future extension work remains root-TODO work; BrandPack and conditional Treatment registries belong to Section B. |
| A2 — request and appearance waist | One immutable `ResolvedRenderRequest` and one internal `ResolvedAppearance` normalize precedence once; checked shared/output field descriptors project validation and receipts into every transport and output adapter, with every shared-field×surface cell declared `forwarded`, `host-enforced`, or `unavailable`. Family-specific fields also declare applicability: a supplied field must affect that family or emit a stable `RENDER_OPTION_NOT_APPLICABLE` diagnostic instead of changing identity silently. | RenderOptions/StyleSpec generated artifacts, the generated shared-field×surface matrix, applicability diagnostics, and request/appearance digests; `render-options-authority.test.ts`; `section-a-transport-parity.test.ts`. | New surfaces from `BUILD-27`, `BUILD-28`, and `BUILD-29` must enroll in this contract when they land; they do not reopen or block Section A. |
| A3 — essential primitives | Versioned typed Scene marks make connectors, routes, markers, hit geometry, identity and accessibility semantic inputs; terminal projections declare each lossy or unsupported feature instead of reconstructing graphical output. | Scene/Connector schema, capability report and conformance fixtures; `scene-connector-contract.test.ts`; `terminal-projection-security.test.ts`. | Family cell-grid topology remains solely owned by `TERM-1` and `TERM-2`; Section A does not claim terminal pixel or topology parity. |
| A4 — families and positioned artifacts | `FamilyDescriptor` is the open, namespaced family authority for detection, parsing, examples, roles, capabilities and lowering; built-ins and extensions use one lossless envelope and one positioned artifact/projection without core switches. A native layout claim must prove finite positive positioned/projected bounds and at least one semantic item on its canonical example. | Descriptor registry and generated family projections; `section-a-family-descriptor-conformance.test.ts`; `family-registration-conformance.test.ts`; `positioned-artifact-convergence.test.ts`. | Native adoption remains `BUILD-6`; config-rule consolidation remains `CONS-44`; minimal-example deduplication remains `CONS-27`. |
| A5 — subsystem, backend and output parity | Every generated shared-field×surface and output×transport classification cell has an explicit evidence-linked state; every available forwarded or host-enforced request path has a comparable effective receipt. Every registered family and backend has separate registry-wide conformance evidence. External families are staged against one bounded example, run native claims twice through canonical parse/serialize, meaningful layout, strict SVG, portable PNG pre-raster, every terminal encoding/color mode, Scene and verify paths, and roll back on failure, reentrancy or nondeterminism; `native` requires a passed witness. Backend witnesses and browser callback outputs are allocation-bounded before parsing or rewriting. Hosted security and font-import policy is host-owned across SVG, PNG, ASCII and Code Mode layout. Graphical outputs share geometry, one output-security policy, fonts/resources and color policy, while admitted external terminal output reports projection limits rather than claiming pixel parity. | Generated capability/parity report; transport, backend, family-registration, hosted-execute render-policy, browser-PNG, website-receipt and editor-security conformance suites. | Each new surface, backend, family or output must enroll before advertising parity; `TERM-1`, `TERM-2`, and host-dependent font inputs retain their narrower scopes. |
| A6 — upstream and extension evolution | A pinned upstream manifest recognizes and losslessly preserves pinned-but-unsupported syntax; the open parser preserves unknown future headers and avoids Flowchart fallback. Namespaced identities/capabilities remain forward-compatible with structured unknown-feature diagnostics. | Upstream manifest/diff and compact generated runtime index; `upstream-family-manifest.test.ts`; `extension-registries.test.ts`; claim-keyed backend witnesses. | Native implementation remains solely `BUILD-6`; inventory or preservation never creates a shadow adoption queue. |
| A7 — subtraction and evidence | Generated projections replace copied rosters, schemas, counts and routing authorities; one evidence catalogue and the landing archive preserve proof, while actionable status exists only in `TODO.md`. | Machine-readable Section A report, docs-consolidation contract and artifact freshness checks. | Remaining `CONS-11`, `CONS-16`, `CONS-26`, `CONS-30`, `CONS-40`, `CONS-41`, `CONS-43`, and `CONS-45` work keeps its independent TODO scope; Section A does not silently close it. |

The evidence column identifies authorities that future changes must keep fresh;
the landing record may retain exact commands, retired-authority evidence and PR
provenance, but it may not acquire unchecked work.

The detailed A0–A7 execution narrative was deliberately removed from this active
plan. Permanent invariants already live in the canonical-authority,
internal-consistency and deletion-first sections above; implementation history lives
only in the landing archive, and future work lives only in `TODO.md`.

## Section B — richer custom Styles and branding

### B0 — inline appearance fragments and the low floor

- Add a partial JSON-safe `AppearanceFragment` accepted inline or in a stack,
  without requiring a name, package or version.
- Preserve existing one-name, Look + Palette, inline `StyleSpec` and JSON-file
  workflows as compatibility inputs to the same algebra and the same public
  `RenderOptions.style` field; do not add `appearance`.
- Expose common shape/container corner radius and connector bend/cap/join/width/
  dash/marker defaults at this level, subject to semantic applicability and
  authored-source precedence.
- Generate TypeScript, validator, JSON Schema, docs, and controls for every
  enrolled surface in the generated field×surface matrix from one field manifest.

Exit: changing global sharp/rounded shape and connector character is a small
inline customization, not a versioned BrandPack project.

Deletion gate: every appearance input enters one `style` stack and one field
manifest; no second public option, validator, resolver or transport schema lands.

### B1 — semantic Style roles and public built-in equivalence

- Expose public brand slots and brand-neutral typography, spacing, radii, border,
  elevation, surface/text, status and category properties for the A3 role
  registry; geometry-affecting values remain shared by measurement and paint.
- Add a new core role only with cross-family or holdout evidence. B1 maps brand
  tokens to roles but does not create a second semantic-role system.
- Export representative built-in Looks as ordinary public source records and use
  them as sentinels proving that public semantic roles can compile through the
  Section A contracts. Private compiled forms may remain only as derived
  compatibility inputs until the full B5 migration.
- Require deterministic PNG font coverage or a stable named fallback diagnostic.

Exit: an external public record can express the semantic-role power exercised by
the representative built-in sentinels, and those sentinels pass through the same
Section A contracts.

Deletion gate: the sentinel built-ins have no private-only expressive leaf;
compiled forms are derived from their public records. B5 alone owns all-built-in
equivalence and final deletion of `InternalStyleFace`/`styleFaceOf`.

### B2 — BrandPacks, modes, resources, and token ingestion

- Finalize and version the BrandPack envelope and its separate `brand-pack:`
  registry after the fragment algebra and role consumption are proven; project
  it into the shared installed-appearance discovery surface rather than the
  Style registry's backing map.
- Add an ordered array of orthogonal `colorScheme`, `contrast`, `density`, and
  `scale` axes with explicit selection; defer cross-axis combinations.
- Add a pure DTCG importer that emits concrete Agentic Mermaid fragments plus
  provenance, not vendor fields or a runtime alias engine.
- Define installed font/icon/resource references, offline behavior, integrity,
  and host allowlists. Declarative JSON never installs dependencies, embeds code,
  or performs ambient fetches. Defer migrations until an observed schema break.

Exit: a BrandPack is portable and reproducible through every enrolled surface in
the generated field×surface matrix wherever installed-resource capability
permits; unavailable host resources produce the same structured diagnostics.

Deletion gate: v1 contains no dependency solver, migration registry, general
token-definition graph, `$extensions` payload, or second BrandPack inheritance
rule; mode order has one representation.

### B3 — semantic bindings and brand constraints

- Add ordered equality bindings over normalized class, tag, status, category
  and namespaced metadata; exclude CSS selectors, tree queries, arbitrary
  predicates and renderer-private state.
- Add resolver-time constraints from a closed catalog and post-cascade/
  post-positioning Scene constraints with stable mark/role diagnostics. V1
  actions are `warn | error`, not silent rewriting.
- Publish binding precedence, specificity, unmatched/conflict and constraint
  composition laws with property tests.

Exit: a brand author can express the same domain meaning across unrelated
families without enumerating family adapters or embedding source-specific CSS.

Deletion gate: no selector engine, arbitrary predicate/expression language, or
automatic paint/geometry rewriter is introduced.

### B4 — post-positioning Treatments, the controlled code extension

- Proceed only when a concrete signature effect cannot be expressed as a B0–B3
  primitive/binding and does not justify a backend.
- If that gate passes, keep a separate, kind-specific Treatment registry; an
  illustrative descriptor identity is `id: 'treatment:acme/corner-brackets'`.
  This naming rule does not pre-create the registry or commit v1 to B4.
- Add the trusted, host-allowlisted ordered addition pipeline over the existing
  positioned Scene, including monotonic bounds expansion, z-order, generated
  identity, hit geometry, failure isolation, and seed partitioning.
- Add exactly one ordered `treatments?: TreatmentRef[]` BrandPack leaf in an
  additive schema revision; do not add a second render option or host-only
  selection language.
- Migrate that effect without adding a semantic phase, repaint phase, new
  pre-layout Scene IR, or custom compositor package.
- Ship composition, security, accessibility, SVG/PNG and future-family
  conformance tests.

Exit: signature effects compose without bloating the declarative schema or
bypassing the Section A primitive/backend contracts.

Deletion gate: B4 has exactly one post-positioning addition phase; if the probe
does not require it, B4 is not implemented.

### B5 — built-in migration, usability, and brand release evidence

- Reimplement each built-in Look/Palette at the lowest sufficient public tier:
  ordinary records for ordinary styles, a Treatment only when B4 was implemented
  for a proved signature decoration, and installed resources only where genuinely
  required. Delete private expressiveness after equivalence gates pass.
- Publish the authoring ladder, BrandPack cookbook, capability/role matrices and
  migration guidance for legacy Style/theme names; publish the primitive-versus-
  Treatment guide only if B4 exists.
- Run sentinel and holdout brands across registered families, backends, SVG,
  PNG and terminal projection, plus low-floor usability and small-size visual
  review.

Exit: built-ins dogfood exactly the abstractions external authors receive, and
broad branding claims are supported by conformance and human evidence.

Deletion gate: selecting each built-in by name and importing its public record
are equivalent, and every superseded private path is removed or has a dated
compatibility expiry.

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
  fragment and reusable JSON pack. If B4 exists, a signature-effect task also
  has a host-allowlisted Treatment path. Choosing a simpler path never requires
  understanding the levels above it.
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
- submit one serialized fixture through every enrolled transport surface; compare
  shared resolved-request digest, resolved-appearance digest, diagnostics and
  capability decisions;
- assert every first-party registered backend consumes every applicable Scene
  mark/primitive with equal semantic, geometry, identity, accessibility,
  security, resource and diagnostic behavior; intentional visual projection is
  recorded rather than compared for pixel equality;
- assert every connector preserves endpoints, direction, markers, label/hit
  geometry and dash/cap/join/bend semantics through positioned layout and every
  graphical backend/output; terminal projection records each graphical trait as
  represented, lossy, or unsupported with a stable diagnostic. Stable inspectable
  identity remains an SVG/positioned-artifact contract rather than a PNG-pixel
  claim;
- cover multiple subpaths, `Z` versus an explicit final `L`, zero-length paths,
  odd/even dash arrays and offsets, acute miter bounds/clipping, mid and
  bidirectional markers, roughened-marker tangents, transforms, non-scaling
  stroke, marker overflow and SVG/PNG projection in connector conformance;
- assert local/hosted SVG and PNG visual and logical-receipt parity, conditional
  deterministic bytes, font fallback and strict security; assert identity,
  ARIA and reference safety on SVG, and color-profile, raster integrity and
  resource provenance on PNG;
- assert ASCII/Unicode consumes the same semantic role/binding selections and
  returns the specified projection diagnostics for every non-representable
  primitive and color mode;
- if B4 exists, assert external Treatment ordering, purity, seed partitioning,
  failure isolation, role fallback, and new-family behavior. Passing an
  individual suite does not imply universal composability: every selected stage
  proves its emitted marks/roles/capabilities are accepted by the next through
  pairwise contract and sentinel end-to-end tests. Acceptance with no effect and
  no declared realization state/diagnostic is a conformance failure.

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
  declarative styles/packs. If B4 exists, its trusted host-registered Treatments
  are executable code, but packs may activate only allowlisted IDs and
  Treatments may emit only typed, validated Scene marks and safe values.
- No brand-specific public fields such as `cornerBrackets: true`.
- No second public `appearance` option, runtime DTCG token engine, speculative
  migration registry, or cross-axis mode-combination language in v1.
- No custom-backend packaging or backend marketplace in this branding roadmap;
  in-process `HostBackendPolicy` remains a separate, non-serializable expert
  escape hatch.
- No universal grammar, layout algorithm, router, or family palette rule.
- No claim that ASCII/Unicode is pixel-, font-, or geometry-equivalent to
  graphical output. A5 supplies a separately specified appearance/diagnostic
  projection and typed connector evidence from the same resolved request;
  family cell-grid topology remains independently tested, with known defects
  owned by `TERM-1` and `TERM-2`. Non-representable primitives remain diagnosed rather
  than simulated misleadingly.
- No automatic native rendering of unstable families merely because Mermaid's
  detector recognizes their header.

## Deferred: cross-family motion

Motion remains a separate vocabulary after the static resolution and extension
protocols are stable. Vercel and CF demonstrate that easing, duration, sequencing,
and reduced-motion behavior can be brand identity, while current product value is
primarily deterministic static SVG/PNG and terminal output. Future motion tokens
must compile from the same semantic roles, consume the authored Flowchart
animation metadata that Section A preserves as a safe static projection,
obey `prefers-reduced-motion`, avoid runtime JavaScript where possible, and use
the same capability/forward-compatibility model. Nothing in the static brand
schema should preclude that layer.

## Sources

- Pinned Mermaid documentation navigation and family list —
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
- Pinned Mermaid core registration and detector orchestration —
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
