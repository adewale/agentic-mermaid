# Brand primitives and forward-compatible family support — plan

Status: Section A landed on `main` in PR #163 (`4f9d376a`), and `radar-beta`
joined the registered family set in PR #161 (`dfaa48e2`). Mandatory Section B
B0–B3/B5 is implemented by the generated evidence and contracts below; B4 was
not promoted. Root `TODO.md` contains only remaining actionable work, so the
completed Section B item was removed rather than retained as a checked backlog
entry. Section A evidence lives in its
[landing record](./archive/section-a-rendering-contract-2026-07.md) and is
projected from the registries into the [generated capability
report](./section-a-capability-report.md). The upstream
compatibility baseline is the version-pinned
[`UpstreamMermaidManifest`](./upstream-mermaid-manifest.json), never a count or
roster copied into prose.

## Decision

Section A has supplied the request, Scene, role, resource, output, and extension
contracts on which richer customization can safely build. Section B therefore
narrows to the missing public styling product rather than inventing parallel
abstractions:

1. Keep **Look + Palette + `StyleSpec`** as the low floor and evolve that one
   versioned fragment format; do not add `AppearanceFragment` or a second public
   `appearance` option.
2. Add public **Brand primitives** by styling the existing `SceneRole` authority
   and semantic channels; do not add a parallel `BrandRole` taxonomy.
3. Close built-in privilege early: public records must express every current
   private `InternalStyleFace` value, and exporting then importing a built-in
   must be equivalent to selecting it by name.
4. Add **semantic bindings** so authored classes, categories, statuses, and
   metadata can select brand slots without embedding raw CSS or SVG. Bindings
   supply defaults before Mermaid-authored styling; final constraints inspect
   rather than repaint the Scene. Resolved values retain authority provenance:
   only internally derived defaults may be guarded or substituted, while
   concrete authored theme/config/element paint remains authoritative and is
   diagnosed rather than repaired.
5. Add a versioned **BrandPack** envelope only after a real consumer proves the
   need for repeated distribution, exact identity, and installed resources.
   Render requests pin exact versions and content digests; semver ranges belong
   only to installation or host negotiation.
6. Resolve global appearance once, then let family lowering consume a shared
   role-style resolver before it creates final `MarkPaint` and crisp SVG. A
   generic post-Scene repaint is forbidden because it would split semantic paint
   from the already serialized crisp representation.
7. Treat Mermaid family and syntax growth as a versioned protocol. A new header
   must be recognized and preserved or diagnosed without being silently routed
   to Flowchart, even before Agentic Mermaid can render it.
8. Consolidate sources of truth as part of the work. Brand extensibility is not
   credible while style fields, role traits, option transport, or capability
   claims can drift between code paths.

Post-positioning executable decorations, universal mode axes, wider-gamut output,
and an accessibility execution mode are outside active Section B. Each requires
its own observed need and promoted `TODO.md` item rather than dormant machinery.

This plan is the normative product and architecture decision. The three
[documentation-only public prototypes](../custom-style-cookbook.md#public-brand-inspired-prototypes--documentation-only)
are the highest non-built-in probe form: checked-in public `StyleSpec` files,
executable fixtures, and screenshot gates—not compatibility aliases, separate
plans, endorsements, or sources of scheduled work.
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
| **Brand primitives** | Role typography, spacing, shape, border, elevation, semantic category slots, and non-color visual cues expressed by `StyleSpec`; status remains deferred until a second unrelated family has a consumer witness. |
| **Semantic role** | An existing versioned `SceneRole` plus its centralized traits and brand fallback; never an element ID, selector, or second role taxonomy. |
| **Pack variant** | An optional pack-local named `StyleSpec` fragment selected explicitly by the caller. Variants do not create universal color, density, contrast, or scale axes. |
| **Semantic policy** | Ordered bindings from authored/domain meaning to brand slots plus closed-catalog constraints evaluated over resolved tokens or final Scene marks. |
| **Brand pack** | An evidence-gated, declarative distribution envelope containing an exact identity/version, ordered `StyleSpec` records, optional named variants, bindings/constraints, and references to resources already installed and verified through Section A. |
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
  reusable JSON `StyleSpec`; if BrandPack packaging is promoted, the same user
  can select an installed, exactly identified pack;
- a designer can set typography, spacing, radii, surfaces, connectors, status,
  and category appearance by semantic role without family-specific renderer
  knowledge;
- a designer can bind local domain meaning to semantic brand slots without raw
  CSS, SVG, or selectors;
- exporting and importing every built-in style is equivalent to selecting it by
  name;
- every entry point produces the same shared resolved-request and resolved-
  appearance digests for the same input; output-specific projections are explicit;
- SVG and PNG consume the same resolved request, while terminal output extends
  its existing `ResolvedTerminalStyle` projection with role/category cues
  and explicit degradation diagnostics;
- adding a family is primarily one adapter plus family-specific semantics, not a
  hunt through duplicated switches, schemas, docs, editors, and transports;
- upgrading Mermaid produces a machine-readable diff of added families, headers,
  syntax, config, theme variables, and maturity changes;
- every current or future family has explicit capability cells rather than an
  ambiguous boolean “supported” flag.

### User-visible outcome

Section B is visible as a more capable version of the existing `style` workflow,
not as a new rendering mode:

- **The same entry point remains.** Existing names, Look + Palette stacks, inline
  records, JSON files, CLI flags, MCP fields, editor controls, and API requests
  keep using `style`; existing records continue to render unchanged.
- **Custom styles gain built-in power.** Users can set semantic-role typography,
  padding, radii, borders, surfaces, and connector stroke/bend character that are
  currently private to first-party built-ins, plus shared category cues
  that the public global Style API does not yet provide.
- **One brand travels across families.** A role or binding such as
  `status:error` or `category:storage` produces the same brand intent in every
  family that declares the channel, with an actionable diagnostic where the
  role or channel is not applicable.
- **Authored Mermaid remains authoritative.** Global brand values are defaults;
  concrete family theme/config values, `classDef`, `style`, `linkStyle`, and
  other family-native styling continue to override them according to the
  documented cascade. Derived defaults may be guarded while they are being
  chosen; once authored paint wins, verification may diagnose but never repair,
  clamp, or substitute it.
- **Outputs stay honest.** SVG and PNG share geometry and paint. Terminal output
  preserves hierarchy, labels, symbols, line patterns, and available color while
  reporting typography, radius, elevation, or paint that cannot be represented.
- **Built-ins become portable.** Users can export a built-in as an ordinary
  public record, edit it, store it, and reproduce the named result without a
  private in-repository path.
- **Packaging remains optional.** A one-off or reusable JSON style never requires
  installation, a package name, or a version. BrandPack installation is added
  only if external use demonstrates that distribution and resource pinning are
  worth the additional product surface.

Section B does **not** expose arbitrary per-element selectors, executable style
code, universal mode axes, wider-gamut output, or a new accessibility/security
mode. Those omissions keep the common workflow small and deterministic.

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
   semantic role, hierarchy, emphasis, category selection, and
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
| Cupertino-inspired prototype | emilkowalski's apple-design skill and public Apple design guidance | The checked-in public `StyleSpec` proves borderless surfaces, shared elevation, role typography, radius/spacing discipline, and inspect-only constraints. It remains static, light-only, and never auto-registers. |
| Vercel-inspired prototype | vercel-labs/beautiful-mermaid and the Geist visual language | The checked-in public `StyleSpec` and XYChart fixture prove dark brand defaults, hairlines, deterministic bundled typography, category-bound series slots, and inspect-only constraints. Motion, live application chrome, and proprietary assets remain outside the static prototype. |
| Cloudflare Workers-inspired prototype | CF Workers design-system tokens | The checked-in public `StyleSpec` and Gantt fixture prove surface/text pairs, sans+mono roles, section-bound slots, visible no-color cues, and enforceable diagnostics. Tinted layered shadows, broader status scales, and signature motion remain research rather than a new execution seam. |

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
nontechnical criterion. The missing middle is public semantic role styling and
bindings. Conversely, a field for every discovered brand detail would create a
wide but non-compositional schema. General primitives enter the alphabet only
when they have brand-independent meaning and lawful merge semantics; one-off
details stay outside the API until a separate evidence-backed decision promotes
them.

### Research and standards basis

The plan treats the literature and industry practice as architectural evidence,
not name-dropping. The following findings change its boundaries and gates:

| Evidence | Consequence for this plan |
|---|---|
| Parnas's information-hiding criterion and program-family work | Section A hides likely-to-change parsing, layout, transport and rendering decisions behind stable behavioral contracts. Section B owns brand variability. Real brand probes discover commonality; holdout brands test whether it generalized. |
| Abstract data types and compositional systems | `ResolvedAppearance`, Scene primitives and kind-specific extension descriptors specify observable behavior and composition laws, not renderer representation. A stack is not compositional merely because it accepts many entries. |
| Software product-line and feature-model practice | Core assets and variability are explicit; exact identities, explicit caller-selected fragments, and compatibility constraints replace ambient or flattened combinations. A-before-B is dependency direction with iterative feedback, not a waterfall. |
| Open implementations and architectural-mismatch research | The plan offers a graduated ladder from ordinary `StyleSpec` records to semantic policy and, only after consumer evidence, a declarative BrandPack envelope. The existing backend API remains an expert escape hatch outside the branding roadmap. |
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
not delivery promises; production review across families, sizes, contrast variants,
fonts, and outputs usually costs more than writing the record.

| Level | Authoring path | Typical mechanical effort | Capability and intended user |
|---|---|---:|---|
| 0. Preset | choose a named Look or Palette | seconds | nontechnical user; no file or code |
| 1. Composition | stack Look + Palette and change a few fields in the editor or inline request | minutes | global colors, font, stroke, fill, backdrop and deterministic seed |
| 2. Reusable Style | save and validate a partial `StyleSpec` JSON record | tens of minutes; hours with visual review | the existing low floor, without registration or family knowledge |
| 3. Semantic Style | add consumed role typography, geometry, paint, and category slots to that same record | hours with cross-family review | designer/design-system owner; public parity with built-in styles |
| 4. Semantic policy | add census-proven category bindings and closed-catalog constraints | hours plus cross-family QA | domain-aware branding without selectors or renderer code |
| 5. BrandPack (evidence-gated) | package exact styles, variants and installed-resource references | hours to days | teams that have proved a repeated distribution/versioning need |

Levels 0–2 exist today, although Level 2 is less capable than built-in styles.
Levels 3–4 are the active Section B APIs. Level 5 is promoted only after a real
consumer demonstrates that ordinary version-controlled `StyleSpec` files are
insufficient. The existing backend API remains a separate expert escape hatch;
custom-backend packaging is not part of this roadmap. Existing named styles,
`StyleInput[]` stacks, inline records and style JSON files remain valid and use
the same resolver; a pack name or version is never required for low-floor or
semantic authoring.

These are capability tiers over one algebra, not incompatible schemas. B1 adds
optional semantic-role fields to the descriptor-driven `StyleSpec`; B3 may add a
closed semantic-policy subrecord with the same admission, merge, schema and
transport authority. If B4 packaging is promoted, a BrandPack contains an
ordered stack of those ordinary records rather than introducing another fragment
format.

The author-effort gate is therefore not merely “the schema validates.” An
unfamiliar user must be able to create a Palette, a role-rich style, and a
status-bound style without editing a family adapter. Advanced UI may be
progressively disclosed, but the same JSON must remain usable through every
public entry point.

### Composable inputs and runtime stages

The public conceptual model is:

```
Look / Palette / inline StyleSpec / [exact BrandSelection, if promoted]
                              |
                       resolveAppearance
                              v
                    ResolvedAppearance
                              |
      family lowering asks the shared role-style resolver
                              |
        role defaults < source theme/config < authored element styles
                              v
           final MarkPaint + crisp Scene serialization
                              |
                    inspect constraints
                              v
                       backend/output
```

The arrows show compilation stages, not another inheritance or merge order.
Look, Palette, and inline semantic fields are all ordinary partial `StyleSpec`
records in the existing left-to-right stack. Explicit global RenderOptions keep
their current checked precedence over style-stack and theme-variable defaults;
Mermaid-authored per-element styling remains the final local override.

The role-style resolver is an immutable capability-scoped view of the same
resolved request, not a second public record or merge engine. Family lowering
must obtain role defaults before constructing `MarkPaint` and `crisp`; changing
paint after Scene construction would violate the Section A fidelity contract.
The resolver retains whether each winning value came from a derived default,
the Style stack, source theme/config, an explicit option, or authored element
styling. Post-Scene constraints inspect final marks, provenance, and available
output/compositing context and return diagnostics but never rewrite paint or
geometry.

All declarative records remain partial, JSON-safe, and expressed in Agentic
Mermaid's semantic vocabulary. The schema stays deliberately smaller than a
general design-token or package manager.

#### What a BrandPack is and why it exists

A reusable `StyleSpec` answers “change these appearance values for this render
or project.” A **BrandPack** answers the narrower question “install and reproduce
this named collection, with exact resources, across tools.” Packaging is useful
only when ordinary version-controlled style JSON no longer supplies sufficient
distribution, discovery, or resource integrity.

A pack is unnecessary for one-off or reusable customization. It contains no
executable code, markup, callbacks, ambient URLs, dependency resolver, migration
program, or second inheritance system. Package installation and integrity live
at the host/package boundary; the declarative pack only references resources
already admitted through Section A.

The first envelope, if consumer evidence promotes B4, is intentionally small:

```ts
interface BrandPack {
  $schema: string
  identity: ExtensionIdentity<'brand-pack'> // exact version
  displayName?: string
  description?: string
  styles: StyleSpec[]                       // left-to-right
  variants?: Record<string, StyleSpec>      // pack-local, caller-selected
  requiredResources?: Array<{
    id: ExtensionIdentity<'resource'>['id']
    version: string
    sha256: string
  }>
}

interface BrandSelection {
  pack: ExtensionIdentity<'brand-pack'>['id']
  version: string
  digest: string
  variants?: string[]
}
```

A render request never resolves a semver range against an ambient registry.
Ranges may be accepted by installation or host negotiation, but request
resolution materializes one exact pack version, content digest, ordered variant
selection, and resource snapshot. Variant order is caller order. V1 defines no
universal `colorScheme`, `contrast`, `density`, or `scale` axes and no
cross-variant condition language: callers can already append an explicit
`StyleSpec`, while compactness and raster scale remain render/output controls.

`StyleSpec` remains the persisted public fragment format. Its centralized field
descriptors continue to generate TypeScript, runtime validation, JSON Schema,
docs, merge behavior, and enrolled surface projections. B1 adds optional role
and semantic-token fields there; it does not demote the current format to a
“legacy facade.” Additive fields retain compatibility. Any genuinely breaking
wire change requires an explicit format-version migration decision rather than
being hidden inside this completed section.

The public option remains:

```ts
interface RenderOptions {
  style?: StyleInput | StyleInput[]
}
```

If B4 packaging is promoted, `BrandSelection` becomes one additional exact input
kind in that same stack. Inline and file-backed styles remain `StyleSpec`—there
is no anonymous pack, parallel `appearance` option, or second merge rule. Every
entry is admitted and merged left to right before family lowering, and CLI, MCP,
editor, website, and future surfaces project the same field.

Only promoted packaging adds `validateBrandPack`, `registerBrandPack`,
`getBrandPack`, and `knownBrandPacks`. They own a kind-specific registry using
Section A identity, collision, compatibility, snapshot, and resource helpers;
they do not share a heterogeneous backing map with Styles. Loading or validating
JSON never installs dependencies or executable code. V1 has a schema version
and validator, not a migration framework.

The Design Tokens Community Group format may become a pure import adapter after
a consumer supplies a concrete mapping. Such an adapter resolves aliases,
checks cycles/types, maps explicit token paths, and emits an ordinary
`StyleSpec` or promoted BrandPack plus provenance. It never guesses semantics
from group names, retains a runtime alias graph, or blocks semantic Style work.

Section B keeps the existing safe CSS color inputs and fixed sRGB graphical/PNG
output policy. Terminal projection continues to canonicalize representable
colors to sRGB and diagnose safe but unrepresentable values. Wider-gamut output,
new color-space objects, profile selection, and gamut negotiation require a
separate product and compatibility decision.

Fonts and icons reference the existing Section A resource identities and
resolver. No `FontStackRef`, BrandPack-specific loader, ambient URL, or duplicate
resource manifest is introduced. The frozen request records exact selected
resource hashes and provenance through the existing contract.

Packs, if promoted, compose only through the caller's explicit `style` stack;
there is no hidden `extends` graph. JSON `null` remains rejected rather than
acquiring accidental clear/reset meaning; omission means inherit. A later reset
operation requires an explicit typed sentinel and composition laws. Bindings are equality matches over normalized category values; class, tag,
status, route, and namespaced metadata remain deferred until their census and
consumer witnesses exist. Constraints are a closed catalog with `warn | error` actions.
CSS selectors, tree queries, arbitrary predicates, renderer-private fields,
general expressions, and automatic rewriting remain outside the declarative
language.

### No built-in privilege

Today a built-in can use private `InternalStyleFace` fields that a custom
`StyleSpec` cannot: text/node/edge/group typography, padding, radius, line
width, fill/border/stroke colors, edge bend radius, group font and header fill.
Built-ins may also rely on preinstalled fonts and automatic registration. That
is an implementation privilege, not an intended product tier.

The target contract is:

- every built-in Look has an exportable public `StyleSpec`, and compiling that
  record is behaviorally equivalent to selecting the built-in by name;
- private compiled structures may remain for performance, but must be derived
  from public fields and may not add expressive power;
- current private face values migrate to existing `SceneRole`s and centralized
  brand primitives, not to arbitrary per-element style objects;
- standalone untrusted JSON remains unable to embed executable code, markup,
  callbacks, font bytes, or arbitrary URLs; promoted packs may reference only
  resources already installed and allowlisted through Section A;
- custom compositor packaging remains outside this roadmap. The intentional
  differences are host trust and installed resources, never private styling
  fields reserved for first-party code.

B2 completes all-built-in equivalence instead of postponing it until packaging.
By B3, a declarative custom style can exceed today's private faces through
semantic category slots, bindings, and constraints. B5 supplies usability
and release evidence; it is not the first point at which private expressiveness
is removed.

| Capability | Public custom style now | Built-in style now | Target custom API |
|---|---|---|---|
| generated palette channels, global font, stroke/fill/backdrop | native | native | preserved as the Level 2 compatibility floor |
| node/edge/group typography and paint | unavailable | private `InternalStyleFace` | public properties keyed by existing `SceneRole`/fallback traits |
| role padding, radii, widths and edge bend | only coarse global render options | private face scalars | public applicable role geometry shared by measurement and rendering |
| title, legend, axis and future-family roles | family-specific or unavailable | no universal built-in contract | existing built-in/namespaced roles with deterministic brand fallback |
| surface/text pairs and sans/mono pairing | unavailable | flat colors and one main font; partial private overrides | named semantic tokens consumed consistently by adapters |
| category slots and bindings | authored family-local styles | unavailable | normalized declarative category bindings; status waits for a second unrelated consumer |
| contextual variants | separate names/caller stacks | separate names/caller stacks | explicit caller stacks; pack-local named variants only if packaging is promoted |
| elevation | shared boolean `shadow` plus family-owned depth cues | no private face leaf | keep shared shadow; do not admit per-role elevation until Scene bounds and every backend can consume it coherently |
| constraints | advisory `intent`/`mono` only | no enforcement advantage | token/final-Scene `warn | error` diagnostics, never rewriting |
| distribution and token ingestion | style JSON, `fromShikiTheme`, caller fonts | repository registration and bundled fonts | retain style JSON; exact packs/resources and a pure importer only after consumer evidence |
| new compositor | backend registration; declarative style data cannot select host code | core can wire an ID | outside this branding roadmap; trusted host selection remains separate |

Publishing role fields closes the built-in privilege but does not by itself add
semantic bindings, constraints, packaging, transport evidence, or complete
future-family fallback. Those remain separately gated so the public Style schema
is not burdened with speculative package or execution machinery.

### Existing Scene roles are the styling authority

Section A already defines the versioned `SceneRole` vocabulary,
`SCENE_ROLE_DESCRIPTORS`, and centralized role traits used by identity,
accessibility, sketching, and backend policy. Section B extends that authority;
it does not copy its role list into a `BrandRole` union or create brand-only role
registration.

Each role descriptor gains only the styling information the common resolver
needs:

- the applicable style properties for its mark kinds;
- its default brand fallback;
- whether geometry-affecting values such as radius, padding, or bend radius are
  meaningful;
- which semantic channels may refine its slot.

Built-in roles continue to carry their current family meaning. Namespaced roles
receive a deterministic safe fallback based on declared traits/mark kind; their
local string never accidentally acquires the semantics of a similarly named
built-in. A new core role still requires evidence from at least two unrelated
families or holdout brands. Generated docs and matrices derive from the role
descriptors rather than a prose roster.

Role style properties are brand-neutral and closed: implemented typography,
spacing, applicable shape geometry, paint, border/stroke, and role-specific
non-color cues. A leaf is exposed only where its role descriptor names a real
measurement/render projection. V1 deliberately rejects dormant per-role
`lineHeight` and `elevation`, rejects per-role `fontFamily` except where a
family-owned text surface consumes it, and admits `cue` only for roles with a
visible graphical/terminal projection. Shared `font` and `shadow` remain the
cross-family controls until stronger coherent primitives exist. They are never
element IDs, CSS selectors, or arbitrary SVG properties. Marker archetypes remain family/relationship semantics; branding
may affect applicable marker paint or scale but cannot globally replace arrow,
diamond, inheritance, or other semantic marker kinds.

### Semantic channels and bindings

Scene marks already carry typed `importance`, `value`, `category`, `status`,
`progress`, `route`, and `emphasis` channels. Before B3 exposes bindings, a
generated registry-wide census must show which registered families populate
each channel, its normalized values, and its fallback/not-applicable behavior.
A channel with no stable cross-family meaning remains family-owned.

Bindings map authored meaning, not SVG selectors, to brand slots. V1 admits
only normalized Scene `category` equality because that channel has typed
emitters and renderer witnesses across unrelated families in this phase.
`status` is emitted by several families but remains family-owned until at least
two unrelated adapters consume the same normalized values. Class names, tags,
route values, and namespaced metadata remain family-owned until their census,
normalization, authored-precedence, and diagnostic contracts have executable
cross-family evidence; unknown channel names fail strict admission.

`emphasis` remains family-owned state rather than a V1 binding selector. Brand
policy may style an already-emphasized mark through applicable paint, weight, or
non-color defaults, but cannot create/remove the target, alter quantitative
geometry, suppress meaningful text, or outrank source/config-authored emphasis.

For example, a normalized category slot selects the same brand defaults on
applicable Pie, Radar, XY, Sequence, ER, Gantt, and Journey marks; a role
restriction projects only meaningful leaves. Tests use registered families;
unsupported future families are not acceptance dependencies.
Bindings are ordered, declarative, and safe under strict security. Later
matching bindings win per leaf; an unmatched value deterministically projects
nothing; a role-restricted slot projects only descriptor-applicable leaves; and
dangling or wholly inapplicable restricted slots fail final-stack admission.
These outcomes are property-tested rather than inferred from family switches.

A binding chooses a role/token default during family lowering. It never mutates
an already serialized Scene and never outranks an authored Mermaid `classDef`,
`style`, or `linkStyle` declaration.

### Brand constraints and accessibility boundary

Constraints are diagnostics, not renderer switches or automatic repair. Token-
only rules can run while resolving appearance. Scene rules such as “accent may
not be a large-area fill,” final contrast, or “technical labels use mono” inspect
final mark paint and geometry after the authored cascade and before backend
output. They return stable codes identifying the role/mark and `warn | error`
action; they do not repaint, relayout, or erase authored intent.

`BrandConstraint` is a discriminated union of named typed rules, not an
expression AST or extension language. Adding a rule requires cross-brand
evidence, a composition law, and conformance evidence.

Section B does not introduce an `AccessibilityProfile` or overload security's
`strict` mode. Style admission checks only context-independent concrete token
pairs. Render-dependent contrast runs after request/family resolution against a
concrete effective foreground/background pair and records `measurable`,
`unmeasurable`, or `not-applicable`; transparent, unresolved, or host-dependent
backdrops never produce a fabricated ratio. Actual rendered contrast, non-color
category meaning, SVG semantics, and product accessibility claims remain
in the existing verification, quality, and output contracts. A future fail-
closed accessibility render policy requires a separate public API decision.

### Deferred signature effects

Executable post-positioning decorations are not a Section B phase. No concrete
signature effect has shown that a declarative primitive is insufficient while a
backend is excessive, so Section B adds no Treatment field, registry, selector,
pipeline, schema leaf, or conformance suite. If such evidence appears, it must
be promoted as a separate root TODO and designed against the then-current Scene,
bounds, identity, accessibility, determinism, resource, and output-security
contracts.

### One resolved appearance and one pre-serialization role resolver

Every surface compiles the global style stack and explicit global overrides
into the existing immutable `ResolvedAppearance`. Optional bindings and
constraints compile into an immutable policy view carried by the same resolved
request. No renderer re-merges raw `StyleSpec` records.

Per-mark appearance is necessarily finalized later: family lowering supplies a
`SceneRole` and semantic channels to the shared role-style resolver, overlays the
result as a default beneath authored family styling, and constructs `MarkPaint`
and crisp serialization from that one final value. Layout asks the same resolver
for geometry-affecting values before positioning. A post-Scene pass may inspect
constraints but may not repaint, because Scene marks already contain both final
semantic paint and exact crisp serialization.

`ResolvedAppearance` remains a runtime-owned internal format, not an accepted or
persisted schema. Consumers receive capability-scoped readonly views for
geometry, paint, resources, bindings, or constraints rather than depending on
physical fields. Digests prove observable equivalence without freezing private
layout.

Global resolution retains the existing checked precedence:

```
defaults < style stack (left to right) < themeVariables < explicit color options
```

Within each mark, the resolved role/binding result is a default; authored
Mermaid `classDef`, `style`, `linkStyle`, and equivalent family-native styling
remain the final local override. Constraints report the final outcome separately
rather than silently erasing authored styling.

The composition laws are public API:

1. **Identity:** an empty `StyleSpec` changes nothing.
2. **Associativity:** regrouping a stack does not change the result.
3. **Right bias at leaves:** later defined values win only where they overlap.
4. **Locality:** independent subrecords do not erase one another.
5. **Undefined is absence:** `undefined` never clears a prior value.
6. **Idempotence:** applying the same replacement record twice is equivalent to
   once.
7. **Exact pack expansion:** if BrandPacks are promoted, resolving an exact pack
   and variants is equivalent to inserting their documented ordered
   `StyleSpec` records into the caller's stack.
8. **Family coherence:** every consumed role/channel has one resolved value, an
   explicit deterministic fallback, or a documented not-applicable state.
9. **Determinism and purity:** source + resolved request + seed + frozen registry,
   extension, resource, and capability snapshot fixes output.
10. **Authority preservation:** the winning value retains its provenance;
    concrete authored theme/config/element values remain value-authoritative and
    constraints cannot relabel them as derived defaults or repair them.
11. **Layout/render coherence:** every metric-affecting typography component—font
    and resource/fallback identity, size, weight, style, letter spacing, line
    height, transform, and wrapping policy—is resolved once and shared by
    measurement, collision/admission, knockout/halo geometry, bounds, crisp
    serialization, and styled rendering.
12. **Crisp/semantic coherence:** final `MarkPaint` and crisp serialization are
    constructed from the same cascade; neither is patched independently.
13. **Output parity:** SVG and PNG consume the same resolved request; terminal
    output derives its declared semantic projection; unsupported output features
    fail or warn explicitly.
14. **JSON safety:** declarative records contain no executable code, markup, or
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

- Persisted authoring starts with the versioned `StyleSpec`; a `BrandPack`
  format exists only if B4 packaging is promoted. Small readonly extension
  interfaces are versioned too. `ResolvedAppearance` remains internal and is not
  independently negotiated.
- Human-friendly names and version ranges may be installation inputs. Every
  resolved request and reproducibility record locks exact style/pack identities,
  backend, core/Scene/config contracts, resources/content hashes, selected
  variants, and frozen capability decision. Replaying without that snapshot is
  best-effort.
- Extension kinds share only
  `ExtensionIdentity { id, kind, version, compatibility, provenance }` plus
  namespacing/collision helpers. `FamilyDescriptor`, `BackendDescriptor`, and
  `ResourceManifest` remain kind-specific typed views; a promoted `BrandPack`
  receives its own typed registry. Families are keyed dispatch, resources are
  data, backends are selected compositors, and Styles/packs are declarative stack
  expansion—there is no generic extension pipeline. Registration collisions
  fail; replacement is explicit; every render freezes relevant typed snapshots.
- The family + backend + output + host-policy capability set is negotiated before
  layout/render. If packaging exists, required pack resources join that existing
  negotiation. Missing required capability/resource is a structured error; a
  missing preferred capability follows one declared lossy/projected fallback
  with a diagnostic; optional unknown capabilities remain inert and discoverable.
- Family IDs, role IDs, config keys and open `CapabilityId` strings are
  namespaced; B4 adds `brand-pack:` IDs only if packaging is promoted. Capability
  requirements are `required | preferred | optional` and may carry numeric
  limits; a closed enum must not make an unknown future ID unrepresentable.
- The existing backend API retains its executable backend/Scene admission gate.
  Its versioned, frozen matrix directly proves deterministic `drawNode`
  and document SVG, one safe SVG envelope, and one exact witness for every
  first-party core primitive/feature/operation claim. The discoverable report
  pins Scene and output-security contract versions and marks namespaced extension
  claims explicitly unverified when no core witness exists. This is bounded SVG
  conformance, not family-scale visual, bounds, hit-testing, performance, or PNG
  pixel certification. PNG inherits admitted SVG through separately tested
  canonical secured rasterizers.
- If B4 packaging is promoted, publish a versioned BrandPack conformance suite
  that pins exact identities and resource hashes and tests validation, stack
  expansion, variants, discovery, missing-resource behavior, transport parity,
  security, and reproducibility. Every advertised capability cites passing
  fixture IDs and the pinned runtime/environment; structural assertions are
  paired with reference renders and explicit fuzzy thresholds where exact bytes
  are inappropriate.
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
| Declarative | `StyleSpec`, promoted BrandPacks, and resource manifests are data only. They may reference installed, allowlisted IDs but never import, download, execute, or escalate host policy. |
| Trusted in-process | Backends run after explicit host installation and allowlisting. They remain subject to typed input/output, resource, determinism, budget, and output-security contracts. |
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
  -> resolve request/appearance/policy + token constraints
  -> shared role-style resolver -> family layout/lowering -> PositionedScene
  -> final bounds/viewBox + inspect-only Scene constraints
  -> generic backend/output adapter
  -> OutputSecurityPolicy -> output validation/projection
```

Role geometry and paint are resolved before final Scene serialization. Section B
adds no generic post-positioning addition, repaint, selector, or execution
pipeline.

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
spikes, marker bounds, and supported filters/shadows.
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
“palette,” and “style.” Section A first exposed the collision as
`palette:tufte` and `look:tufte`; the final product decision retains only the
full `look:tufte` resource. The duplicate light palette, its legacy `tufte`
theme, and the ambiguous bare Style input are retired and rejected. The distinct
`tufte-dark` palette is unchanged. PR #172 records the repository owner's
explicit breaking-compatibility decision to complete that retirement before the
previously announced window; the changelog names the migration rather than
silently reassigning an input. New registrations must be namespaced and cannot
silently replace another kind or owner.

This cleanup happens before BrandPack naming. Otherwise the pack registry would
institutionalize the same ambiguity at a larger scale.

### Canonical authorities

| Concern | Canonical authority | Derived consumers |
|---|---|---|
| upstream Mermaid inventory | `UpstreamMermaidManifest` | upgrade diff, compatibility/adoption review, syntax fixtures, maturity labels |
| shipped family and capabilities | `FamilyDescriptor` registry | types/narrowers, routing, CLI/MCP/editor/site/docs, citizenship matrix |
| public brand/style fields | the existing `StyleSpec` field descriptors + generated JSON Schema | the single `style` stack, validator, docs, and generated controls for every enrolled surface; a promoted BrandPack expands to the same records |
| semantic roles/channels | `SCENE_ROLE_DESCRIPTORS`/centralized role traits + family channel declarations | Scene types, role-style applicability/fallback, brand consumption census, bindings, and constraints |
| render request | one normalized `ResolvedRenderRequest`, shared-field manifest and output projection descriptors | SVG, PNG, ASCII/Unicode, CLI, Code Mode, MCP, editor, website |
| appearance resolution | one pure `resolveAppearance` plus one capability-scoped role-style resolver | measurement, family layout/lowering, final Scene paint, and terminal projection |
| Scene and primitives | versioned Scene/Connector schema plus bounds, identity, hit-testing and ordering invariants | layout, backends, accessibility and conformance suites; no Section B post-positioning execution stage |
| extension identity | shared identity/namespacing helpers plus the Style registry's typed Palette/Look views and separate family/backend/resource registries; B4 may add a separate BrandPack registry | collision-safe registration, one generated discovery projection, negotiation and frozen typed snapshots; no generic extension pipeline or cross-kind heterogeneous backing map |
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
| B0 | add no fragment alias or second stack; characterize current private-face behavior and family channel coverage before changing the wire format |
| B1 | extend `StyleSpec` and existing role descriptors only; add no `appearance` option, `BrandRole`, post-Scene repaint, or semantic marker replacement |
| B2 | migrate every built-in to public records and delete private expressive leaves or retain only compiled values mechanically derived from those records |
| B3 | add no selector engine, expression language, automatic rewrite, or family-local policy registry |
| B4 | add no pack registry, DTCG runtime, universal mode algebra, resource loader, or migration framework until external consumer evidence promotes the minimal envelope |
| B5 | add evidence and usability documentation, not another styling authority or deferred private migration |

## Consolidation record and remaining opportunities

### In this plan and its documentation set

1. Keep this document as the only active decision and dependency order for brand
   primitives. Keep the Cupertino-, Vercel-, and Cloudflare Workers-inspired
   examples in the custom-style cookbook as public-API prototypes, never as
   built-ins or a second plan.
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
[`TODO.md`](../../TODO.md): completed Section B no longer has a backlog entry,
and proven mechanical duplication is owned under
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
gates remain regression contracts. Section B adds public role-style equivalence,
channel bindings, inspect-only constraints, and complete fallback evidence; it
does not reopen Section A's rendering architecture.

## Execution plan: Section A foundation, then Section B

Section A has landed and remains the permanent correctness/parity contract.
Section B may extend its existing `StyleSpec`, role traits, and request views but
may not create a second layout, Scene, backend, output, resource, or capability
path.

```
Section A — landed correctness and parity foundation
A0 truth -> A1 identities -> A2 request/appearance waist -> A3 primitives
         -> A4 family/positioned protocol -> A5 first-party parity
         -> A6 forward compatibility -> A7 consolidation evidence

Section B — public customization
A3 + A5 + A7 -> B0 characterize current style/role/channel behavior
B0 -> B1 public semantic role Styles
B1 -> B2 all-built-in public equivalence and private-face removal
B1 + B2 -> B3 bindings and inspect-only constraints
A6 + B2 + B3 + external consumer evidence -> B4 optional BrandPack packaging
B2 + B3 -> B5 usability and release evidence
B4 joins B5 only when packaging was actually promoted
```

Section B does not wait for every missing Mermaid family. Each newly registered
family must use the Section A protocol and pass the current Section B role,
fallback, and channel contract available at that time. Public release of a B
capability also requires its relevant A5 parity gates. Native-family adoption
remains solely owned by `BUILD-6`.

Holdout brands and real authoring may reveal a recurring missing primitive, but
promotion requires cross-family evidence, a behavioral contract, compatibility
review, and conformance tests rather than a brand-specific shortcut. BrandPack
packaging is similarly evidence-gated: Section B can ship useful semantic Styles
and policy without creating a registry merely to complete a phase diagram.

### Phase-to-TODO ownership

`TODO.md` is the only status-bearing backlog. The phases below are dependency
and acceptance boundaries, not another checklist; the three documentation-only
brand-inspired prototypes supply public-API evidence only.

| Plan boundary | Status owner | Independent scope retained |
|---|---|---|
| A0–A7 | PR #163 implementation and [`Section A landing record`](./archive/section-a-rendering-contract-2026-07.md) | referenced `CONS-*`, `SRC-*`, `TERM-*`, security, family-adoption and evidence items keep any work beyond Section A |
| B0–B3, B5 | completed Section B scope | documentation-only Cupertino-, Vercel-, and Cloudflare Workers-inspired prototype evidence; native-family adoption remains `BUILD-6` |
| B4 | not promoted; requires a new evidence-backed TODO after external consumer evidence | ordinary `StyleSpec` files remain the default distribution path; no pack registry was required to complete B1–B3/B5 |

The graph above defines hard phase dependencies. Reused IDs in the table retain
their independent scope, status, and evidence; this plan coordinates Section B
without absorbing or silently closing them.

Newly shipped surfaces such as those proposed by `BUILD-27`, `BUILD-28`, and
`BUILD-29` join the A2/A5
transport contract when they land; they do not create parallel brand inputs or
block the current program.

## Section A — correctness, parity, consolidation, and essential primitives

Section A landed in PR #163 at merge `4f9d376a`. The
[landing record](./archive/section-a-rendering-contract-2026-07.md) preserves
its evidence and execution history; the table below records permanent contracts,
not live implementation status.

Root `TODO.md` is the sole status-bearing backlog. This table preserves the
permanent contract and names executable evidence; it does not create phase
checklists or imply that independently owned work is complete.

### Permanent Section A contract

| Boundary | Permanent invariant | Generated or machine-evidence authority | Ongoing TODO owner and independent scope |
|---|---|---|---|
| A0 — truth and characterization | Claims use the applicable checked state vocabulary for their dimension; family syntax, transport, output, backend and realization states are never mixed into one ambiguous scale. Registries, current precedence, routing, fields and capability behavior are characterized before they change. | Generated Section A capability report; `section-a-capability-report.test.ts`; `section-a-render-contract.test.ts`. | New gaps are promoted only in `TODO.md`; characterization evidence in the landing archive is not a backlog. |
| A1 — identities and registries | Shared `ExtensionIdentity` rules feed typed, kind-specific family, backend, resource, Palette and Look registries; external executable families and backends declare compatible core ranges before hooks run, Scene consumers also declare Scene ranges, and deterministic discovery exposes only committed registrations. Light Tufte is solely `look:tufte`; its duplicate palette and ambiguous bare input are retired. The remaining `default` compatibility alias is diagnosed and time-bounded rather than silently shadowing canonical names. | Registry descriptors and generated discovery projections; `extension-registries.test.ts`; `style-spec-authority.test.ts`; `family-registration-conformance.test.ts`. | Remaining `default` alias removal is owned by `COMPAT-1`; future extension work remains root-TODO work; an evidence-promoted BrandPack registry belongs to Section B B4. |
| A2 — request and appearance waist | One immutable `ResolvedRenderRequest` and one internal `ResolvedAppearance` normalize precedence once; checked shared/output field descriptors project validation and receipts into every transport and output adapter, with every shared-field×surface cell declared `forwarded`, `host-enforced`, or `unavailable`. Family-specific fields also declare applicability: a supplied field must affect that family or emit a stable `RENDER_OPTION_NOT_APPLICABLE` diagnostic instead of changing identity silently. | RenderOptions/StyleSpec generated artifacts, the generated shared-field×surface matrix, applicability diagnostics, and request/appearance digests; `render-options-authority.test.ts`; `section-a-transport-parity.test.ts`. | New surfaces from `BUILD-27`, `BUILD-28`, and `BUILD-29` must enroll in this contract when they land; they do not reopen or block Section A. |
| A3 — essential primitives | Versioned typed Scene marks make connectors, routes, markers, hit geometry, identity and accessibility semantic inputs; terminal projections declare each lossy or unsupported feature instead of reconstructing graphical output. | Scene/Connector schema, capability report and conformance fixtures; `scene-connector-contract.test.ts`; `terminal-projection-security.test.ts`. | Family cell-grid topology remains solely owned by `TERM-1` and `TERM-2`; Section A does not claim terminal pixel or topology parity. |
| A4 — families and positioned artifacts | `FamilyDescriptor` is the open, namespaced family authority for detection, parsing, examples, roles, capabilities and lowering; built-ins and extensions use one lossless envelope and one positioned artifact/projection without core switches. A native layout claim must prove finite positive positioned/projected bounds and at least one semantic item on its canonical example. | Descriptor registry and generated family projections; `section-a-family-descriptor-conformance.test.ts`; `family-registration-conformance.test.ts`; `positioned-artifact-convergence.test.ts`. | Native adoption remains `BUILD-6`; config-rule consolidation remains `CONS-44`; minimal-example deduplication remains `CONS-27`. |
| A5 — subsystem, backend and output parity | Every generated shared-field×surface and output×transport classification cell has an explicit evidence-linked state; every available forwarded or host-enforced request path has a comparable effective receipt. Every registered family and backend has separate registry-wide conformance evidence. External families are staged against one bounded example, run native claims twice through canonical parse/serialize, meaningful layout, strict SVG, portable PNG pre-raster, every terminal encoding/color mode, Scene and verify paths, and roll back on failure, reentrancy or nondeterminism; `native` requires a passed witness. Backend witnesses and browser callback outputs are allocation-bounded before parsing or rewriting. Hosted security and font-import policy is host-owned across SVG, PNG, ASCII and Code Mode layout. Graphical outputs share geometry, one output-security policy, fonts/resources and color policy, while admitted external terminal output reports projection limits rather than claiming pixel parity. | Generated capability/parity report; transport, backend, family-registration, hosted-execute render-policy, browser-PNG, website-receipt and editor-security conformance suites. | Each new surface, backend, family or output must enroll before advertising parity; `TERM-1`, `TERM-2`, and host-dependent font inputs retain their narrower scopes. |
| A6 — upstream and extension evolution | A pinned upstream manifest recognizes and losslessly preserves pinned-but-unsupported syntax; the open parser preserves unknown future headers and avoids Flowchart fallback. Namespaced identities/capabilities remain forward-compatible with structured unknown-feature diagnostics. | Upstream manifest/diff and compact generated runtime index; `upstream-family-manifest.test.ts`; `extension-registries.test.ts`; claim-keyed backend witnesses. | Native implementation remains solely `BUILD-6`; inventory or preservation never creates a shadow adoption queue. |
| A7 — subtraction and evidence | Generated projections replace copied rosters, schemas, counts and routing authorities; one evidence catalogue and the landing archive preserve proof, while actionable status exists only in `TODO.md`. | Machine-readable Section A report, docs-consolidation contract and artifact freshness checks. | Remaining `CONS-11`, `CONS-16`, `CONS-26`, `CONS-30`, `CONS-41`, `CONS-43`, and `CONS-45` work keeps its independent TODO scope; Section A does not silently close it. |

The evidence column identifies authorities that future changes must keep fresh;
the landing record may retain exact commands, retired-authority evidence and PR
provenance, but it may not acquire unchecked work.

The detailed A0–A7 execution narrative was deliberately removed from this active
plan. Permanent invariants already live in the canonical-authority,
internal-consistency and deletion-first sections above; implementation history lives
only in the landing archive, and future work lives only in `TODO.md`.

## Section B — richer custom Styles and branding

### B0 — characterize the existing low floor

- Treat the current partial, JSON-safe `StyleSpec` as the fragment format; do not
  add a synonymous public type.
- Record every private `InternalStyleFace` leaf, which built-ins use it, and the
  exact public field/role needed to reproduce it. Derive this census from the
  runtime private-face projection authority so an author-only leaf cannot hide
  behind TypeScript-only declarations.
- Generate a registered-family census of emitted `SceneRole`s and populated
  semantic channels, including `radar-beta`, graphical backends, and terminal
  projection behavior.
- Inventory existing automatic paint guards and family-specific paint
  diagnostics. For each, record the effective pair, authority provenance,
  output/compositing context, and measurable/unmeasurable/not-applicable result.
- Lock current Style-stack, theme/config, explicit-option, and element-authored
  precedence with discriminating tests before changing resolution. The Radar
  witness must prove that derived ink may be guarded while explicit
  `themeVariables.radar.axisColor` is preserved and diagnosed; transparent
  output must not claim a ratio against a guessed backdrop.

Exit: each private style value and each registered family role/channel has a
public migration target, fallback/not-applicable state, and executable witness.

Deletion gate: B0 adds no public type, option, registry, resolver, or schema.

### B1 — public semantic role Styles

- Extend the existing Style field descriptors with consumed role typography,
  spacing, applicable radii/bend geometry, border/stroke, surface/text paint,
  semantic color pairs, and visible non-color cues. Reject leaves whose
  measurement, graphical, or terminal projection would otherwise be inert;
  shared `shadow` remains the elevation surface in V1.
- Extend `SCENE_ROLE_DESCRIPTORS`/central role traits with style applicability and
  deterministic brand fallback; do not add `BrandRole` or copied role lists.
- Add one shared role-style resolver used by measurement and family lowering
  before final `MarkPaint` and crisp serialization. Preserve winning-value
  provenance and the authored Mermaid cascade as the final per-element
  override.
- Resolve each descriptor-approved typography tuple once. Require
  non-default-weight, wrap-prone witnesses proving measurement, collision boxes,
  knockout/halo geometry, bounds, crisp output, and styled backends use
  identical values. Do not advertise family/font/line-height leaves until that
  complete tuple exists for the applicable role.
- Keep connector marker archetype semantic and family-owned. Only applicable
  paint, width, dash, cap/join, bend, and marker scale may be branded.
- Extend the existing terminal projection and degradation diagnostics instead of
  adding a second terminal theme authority.
- Prove representative distinctive built-ins through public records before
  general migration.

Exit: an inline or file-backed `StyleSpec` can express the role styling currently
available only to representative first-party built-ins across SVG, PNG, and the
declared terminal projection. Pie `highlightSlice` preserves its family-owned
target, byte-identical slice paths, value/category/emphasis channels, meaningful
text, and non-color cue under deliberately conflicting role defaults.

Deletion gate: no `appearance` option, parallel role taxonomy, family-local brand
resolver, or post-Scene repaint lands; sentinel built-ins have no private-only
expressive leaf.

### B2 — all-built-in equivalence and private-face removal

- Export every built-in Look as an ordinary public `StyleSpec`; selecting the
  name and importing the export must resolve to equivalent geometry, paint,
  diagnostics, resources, and output behavior.
- Move every literal private face value into the public source record. A private
  compiled structure may remain only when mechanically derived from admitted
  public fields and unable to add expressive power.
- Enroll every registered family and first-party backend in role applicability,
  fallback, layout/render coherence, SVG/PNG, and terminal tests.
- Reuse existing resource/font identities and stable fallback diagnostics.

Exit: external records possess all styling power used by built-ins, and every
built-in dogfoods the public role surface.

Deletion gate: no built-in registration contains an author-only face leaf;
`InternalStyleFace`/`styleFaceOf` is deleted or reduced to a purely derived
compiled representation with tests preventing private input.

### B3 — semantic bindings and inspect-only constraints

- Publish the family/channel census before admitting cross-family binding claims.
- Add ordered equality bindings over normalized `category`.
  Defer status, class, tag, route, and namespaced metadata until the same census and
  renderer-witness bar is met; exclude CSS selectors, tree queries, arbitrary
  predicates, and renderer-private state.
- Apply bindings as role/token defaults during family lowering, beneath authored
  `classDef`, `style`, `linkStyle`, and equivalent family-native styling.
- Add token-time and final-Scene constraints from a closed catalog with stable
  mark/role diagnostics. V1 actions are `warn | error`; constraints never repaint,
  relayout, or claim to be an accessibility execution profile. Contrast rules
  require a concrete effective pair and expose measurable/unmeasurable/not-
  applicable evidence instead of guessing a host backdrop.
- Derive every constraint code, payload shape, tier/severity, recovery prose,
  transport declaration, and verified firing example from one authority (or
  explicitly classify a non-reproducible engine tripwire).
- Centralize rule evaluation. Family descriptors may declare applicability and
  meaningful paint-pair ownership, but family adapters do not own policy engines
  or require a growing central family switch; existing family-local checks are
  characterization inputs to this migration.
- Publish binding precedence, deterministic unmatched/no-op, ordered conflict,
  not-applicable, and constraint composition laws with property tests. Bindings cannot select or override
  family-owned emphasis targets.

Exit: a brand author can express the same normalized domain meaning across
applicable unrelated families without enumerating adapters or embedding CSS.
Deliberately conflicting Pie role/category bindings still preserve the authored
highlight target, quantitative geometry, semantic `emphasis`, and non-color cue.

Deletion gate: no selector engine, expression language, automatic rewriter,
parallel accessibility mode, or family-local policy registry is introduced.

### B4 — optional BrandPack packaging after consumer evidence

Proceed only when a real external consumer shows that ordinary repository-owned
`StyleSpec` files cannot adequately provide repeated distribution, discovery,
version pinning, or installed-resource integrity.

If promoted:

- add the minimal exact-version BrandPack envelope and separate `brand-pack:`
  registry described above;
- expand its ordered styles and caller-selected named variants into the existing
  `style` stack;
- pin exact pack version, content digest, variant order, and Section A resource
  hashes in the resolved request and receipts;
- use existing resource admission, offline, integrity, host-allowlist, discovery,
  and snapshot contracts;
- add a pure DTCG adapter only if that consumer supplies a concrete mapping that
  cannot be served by existing conversion tooling.

Exit when promoted: a pack selected through any enrolled surface reproduces the
same exact stack/resources and diagnostics. If evidence does not promote B4,
B1–B3 and B5 ship without a pack registry.

Deletion gate: no render-time semver range, dependency solver, universal mode
axes, cross-variant condition language, runtime token graph, duplicate resource
loader, migration framework, executable code, or second inheritance rule.

### B5 — usability and brand release evidence

- Publish the preset → stack → semantic Style → semantic-policy authoring ladder,
  field/role/channel matrices, built-in export workflow, and migration guidance
  for legacy Style/theme names.
- If B4 is promoted, add a separate concise BrandPack installation and exact-
  selection guide; do not make it prerequisite reading for ordinary Styles.
- Run sentinel and holdout brands across registered families, backends, SVG,
  PNG, and terminal projection, plus low-floor usability and small-size visual
  review. The Pie family-owned-emphasis fixture must retain its graphical and
  terminal non-color cue.
- Verify all library, CLI, Code Mode, MCP, editor, website, and installed-package
  declarations expose the same schema, validation, diagnostics, and receipts.

Exit: unfamiliar users can customize role appearance and semantic category
meaning through the existing `style` workflow, and broad branding claims are
supported by conformance and unfamiliar-consumer evidence.

Deletion gate: evidence and docs derive from the same field/role/channel
authorities; no copied capability table, private built-in path, or packaging
requirement is introduced.

## Evidence and gates

### Brand expressiveness

- **Holdout-brand test:** reproduce at least three brands not used to design the
  schema across all registered families, SVG and PNG, without core changes.
- **Sentinel brand:** every token is deliberately distinctive so a no-op or
  wrong role is obvious; render it for every current and newly added family.
- **Semantic binding:** the same normalized category selects the same slot across
  structural, temporal, domain, and chart families.
- **Family-owned emphasis fixture — pinned baseline:** Pie `highlightSlice`
  already proves byte-identical slice geometry, `category`/`value`/`emphasis`
  channels, final `MarkPaint` across crisp/styled backends, derived meaningful
  text contrast, and a terminal non-color cue. This baseline is pinned by the
  existing Pie/Closing-The-Gap suites and generated receipt.
- **Family-owned emphasis fixture — B1/B3 extension:** apply deliberately
  conflicting role/category defaults and prove the target, geometry, semantic
  channels, meaningful text, and non-color cue remain family-authoritative.
  Authored low-contrast text remains unchanged and is diagnosed; only renderer-
  derived fixture text may be contrast-guarded.
- **Constraint tests:** positive and negative examples for accent area, contrast,
  mono role, not-applicable channels, and unmatched bindings. Contrast cases
  include opaque measurable pairs, transparent/host-dependent backgrounds,
  unresolved CSS paint, alpha compositing, authored low contrast, and derived
  low contrast.
- **Unfamiliar-consumer low-floor test:** give an unfamiliar human or
  fresh-context agent consumer only the public authoring guide and CLI help,
  ask for a branded multi-family sheet, and measure time, corrections, and
  whether core code or a family adapter was required.
- **Progressive-authoring test:** the same task has a documented preset, inline
  record, and reusable `StyleSpec` JSON path. If B4 packaging is promoted, it
  also has an exactly pinned pack path. Choosing a simpler path never requires
  understanding the levels above it.
- **No-family-knowledge test:** brand authors do not enumerate registered
  families or edit adapters to style core roles. Unmatched equality bindings
  deterministically project nothing; fallback-only exact roles reject every
  leaf at schema/runtime admission instead of accepting an inert record.
- **No-built-in-privilege test:** export each first-party Look, resolve it as an
  ordinary public record in a clean registry, and compare semantic output and
  accepted visual tolerance with selection by built-in name.

### Composition and consistency

- property-test every composition law, including nested partial records,
  role fallbacks, binding arrays, and exact pack expansion if B4 is promoted;
- assert all public fields have schema, validator, docs, transport, resolver,
  consumption, and unsupported-diagnostic coverage;
- assert a named built-in and its public resolved/exported representation are
  behaviorally equivalent, including private implementation defaults;
- assert all current family headers route identically on every entry point;
- assert measurement, collision/admission, knockout/halo geometry, layout,
  Scene bounds, crisp serialization and styled rendering agree after complete
  typography/spacing overrides, including at least one non-default weight and
  wrap-prone label per applicable text-role class;
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
- if B4 packaging exists, assert exact identity/digest selection, variant order,
  resource integrity, missing-resource behavior, frozen registry snapshots,
  discovery, and transport parity. Selecting a range or accepting a pack with no
  observable stack/resource effect is a conformance failure.

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
  declarative styles or promoted packs.
- No brand-specific public fields such as `cornerBrackets: true`, and no generic
  post-positioning decoration or repaint pipeline in Section B.
- No second public `appearance` option, `AppearanceFragment`, `BrandRole`, runtime
  DTCG token engine, speculative migration registry, universal mode axes, or
  cross-variant condition language in v1.
- No new typed color-space/profile negotiation or wider-gamut output in Section
  B; the existing safe CSS and sRGB output contracts remain authoritative.
- No accessibility execution mode in Section B. Admission checks and final
  accessibility diagnostics extend existing verify/quality/output contracts.
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
