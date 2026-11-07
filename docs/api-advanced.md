# Advanced library API

Configure host rendering, inspect receipts, and extend AM.

Start with the ordinary workflows in the [library reference](./api.md).

This page describes the same source checkout as the library reference. Check its
[version information](./api.md#versions) before using a feature from an installed package.

## Canonical requests and comparable receipts

Every first-party renderer enters through the same immutable internal request
boundary: source wrappers/config, the Style stack, colors, font, security, and
shared options are normalized once. Receipt-bearing variants make that boundary
observable without exporting its executable implementation types or changing
the existing convenience return types:

```ts
import {
  renderMermaidASCIIWithReceipt,
  renderMermaidPNGWithReceipt,
  renderMermaidSVGWithReceipt,
} from 'agentic-mermaid/agent'

const options = { style: 'hand-drawn', seed: 7, embedFontImport: false }
const svg = renderMermaidSVGWithReceipt(source, options)
const png = renderMermaidPNGWithReceipt(source, options)
const text = renderMermaidASCIIWithReceipt(source, { ...options, colorMode: 'none' })

console.assert(svg.receipt.sharedRequestDigest === png.receipt.sharedRequestDigest)
console.assert(svg.receipt.appearanceDigest === text.receipt.appearanceDigest)
```

Each `RenderRequestReceipt` contains `version`, `output`,
`sharedRequestDigest`, output-specific `requestDigest`, and
`appearanceDigest`. Its `diagnostics` array records stable request-resolution,
compatibility, applicability, projection, and output-policy decisions. In
particular, `RENDER_OPTION_NOT_APPLICABLE` makes an authored family-scoped
option that the selected family does not consume observable instead of letting
it change request identity silently. CLI JSON results and local/hosted MCP
render results expose the same receipt. Use `validateSerializableRenderOptions(value)` and
`sharedRenderOptionsJsonSchema()` for untrusted advanced option objects, or
`styleInputJsonSchema()` for a standalone convenience `style` field; unknown
fields, `null`, functions, prototype keys, and non-finite values are rejected.
Graphical receipts name an explicitly selected pixel `textMeasurement` profile
(`id` and `version`). Trusted hosts can select custom metrics through the
renderer factories described below; their callback never enters a receipt.

## PNG fonts, portability and rasterization

PNG rasterization uses offline `@resvg/resvg-js` with bundled fonts for
deterministic same-machine output: Inter (the default face — the same family
the SVG requests and the family `src/text-metrics.ts` is calibrated for, so
rasterized labels match their measured boxes), DejaVu Sans as a per-glyph
fallback for symbols Inter lacks, plus the faces the built-in styles
reference (Caveat, EB Garamond, Architects Daughter, Share Tech Mono — see
`assets/fonts/FONT-LICENSES.md`). A style whose `font` is neither bundled
nor supplied via `fontDirs` rasterizes with Inter. Characters no loaded font
covers (CJK, most emoji) draw as tofu boxes and raise a `PNG_FONT_COVERAGE`
warning naming the script and the escape hatches (`fontDirs` /
`loadSystemFonts`).

The raster-legibility gate measures literal absolute-pixel `font-size`
attributes on `text`, `tspan`, and `textPath` elements in the secured SVG.
This is exact for first-party built-in emitters. Extension SVG text is measured
only when the extension emits those literal attributes. The gate abstains when
CSS can override size or transforms, or when an SVG transform can change glyph
scale; translation and rotation are admitted because they preserve size. It
does not resolve extension-specific visibility, such as text templates under
`defs` or `display:none`, so such markup can conservatively over-report. The effective scale is
computed from the finalized integer raster height divided by the SVG `viewBox`
height, after projection rounding, because font sizes are expressed in user
units and the root is pinned with `preserveAspectRatio="none"`. For an extension
with no measurable literal size, absence of a
`BELOW_READABLE_SIZE` warning is therefore not proof that its labels are
readable. Callers that know the task, viewing distance, or display conditions
should select a task-specific floor rather than relying on the default.

The bytes-only browser convenience call returns only PNG bytes. Use
`renderMermaidPNGWithReceipt` on a bound browser renderer, or
`renderMermaidPNGInBrowserWithReceipt`, when the caller must inspect browser
diagnostics.

Note for third-party rasterizers: the SVG declares fonts as
`font-family: var(--font, 'Face')`, and static rasterizers (resvg, librsvg)
do not resolve CSS custom properties — `renderMermaidPNG` inlines the
resolved family before rasterizing; do the same if you feed the raw SVG to
your own pipeline.

For complete custom-Style recipes using `font`, `fontDirs`, browser faces, and
SVG font declarations, see [Fonts in custom styles](./custom-fonts.md).

PNG output declares the shared sRGB policy with `sRGB` and `cICP` metadata,
places `cICP` before image data, and deliberately emits no conflicting ICC
profile. SVG and PNG consume the same resolved graphical colors before
rasterization.

### Trusted host-selected graphical backends

Executable Scene painting backends are bound by the host, never selected by `RenderOptions` or
serialized Style data. These factories apply the same canonical request,
Scene-admission, SVG-security, receipt, PNG-output-policy, and color-profile
contracts as their default counterparts:

```ts
import {
  createMermaidBrowserPNGRenderer,
  createMermaidRenderer,
} from 'agentic-mermaid'
import { createMermaidPNGRenderer } from 'agentic-mermaid/agent'

const backendPolicy = { selectBackend: () => 'backend:acme/renderer' }
const svgRenderer = createMermaidRenderer({ backendPolicy })
const nodePngRenderer = createMermaidPNGRenderer({ backendPolicy })
const browserPngRenderer = createMermaidBrowserPNGRenderer({
  backendPolicy,
  rasterize: async (securedSvg, context) => ({
    png: await rasterizeWithCanvas(securedSvg, context.outputPolicy),
  }),
})
```

Register and conformance-check the named backend before constructing these
renderers. The Node/Bun factory reuses the built-in `@resvg/resvg-js` adapter;
the browser factory wraps a trusted injected rasterizer, which receives only
the admitted and secured SVG plus the complete resolved portable output policy.
Its rasterizer must apply `fitTo` and `background`, not only `scale`.
`renderMermaidSVG`, `renderMermaidPNG`, and
`renderMermaidPNGInBrowserWithReceipt` remain the compatible default-backend
entry points.

### Trusted host-selected pixel metrics

The same three factories accept `textMeasurement`, a named, versioned
`TextMeasurementProfile` with a synchronous `measure(input)` callback returning
the run's natural width in pixels. Inputs include displayed `text`,
`fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, and `monospace`. Letter
spacing and wrapping remain the library's responsibility. The host supplies
the font measurement implementation and makes its fonts available to the
selected SVG/PNG consumer; no Canvas or system-font measurement is enabled
implicitly. See [custom fonts](./custom-fonts.md#trusted-font-measurement-profiles)
for an example and reproducibility requirements.

An optional `measureInk(input)` callback can supply actual shaped advance and
baseline-relative ink bounds for supported fitted runs. These occupied bounds
are separate from allocation width and follow the same emitted fitting geometry
through Native and Scene paint inspection. Its fonts and shaping must match the
output consumer; omitted or unsupported measurements grant no new ink authority.

This is an in-process host option, separate from serializable `RenderOptions`,
Style data, Mermaid source, editor state, CLI, and MCP inputs. Bound renderers
capture the profile's name, version, and function once. Layout, prepared pixel
text, SVG advances, and both PNG adapters use those same metrics. Receipts
record its identity and include custom identity in request digests. Terminal
cell widths remain independent. Omitting the profile keeps the existing
deterministic Inter estimate, SVG output, and receipt shape unchanged.

## SVG semantic identity and accessibility

All built-in families expose the same inspectable element contract:

- every Scene part with source-facing semantics has a deterministic `data-id` and closed
  `data-role`; identity is unique within one SVG (layout furniture retains typed
  Scene identity without bloating the DOM);
- source relations use `data-from` and `data-to`; source `className` tokens stay
  on the identified element's `class` attribute;
- typed relations expose `role="graphics-symbol"`,
  `aria-roledescription="relation"`, and an `aria-label` derived from endpoints
  plus the authored relation label;
- public Scene types expose `SvgSemanticIdentity`,
  `SvgSemanticAccessibility`, and `SvgRelationSemantics`;
- `idPrefix` rewrites local DOM `id` references, not source-facing `data-id`.

Built-in concrete palettes are contrast-normalized at render time: normal text
roles meet WCAG AA 4.5:1 and meaningful relation lines/markers meet 3:1 against
the page background. Unresolved runtime CSS variables cannot be statically
certified and pass through unchanged. See
[`svg-semantic-contract.md`](./svg-semantic-contract.md) for the complete contract.

For JSON files, use
[`docs/schemas/style-spec.schema.json`](./schemas/style-spec.schema.json). The
same schema is exported from the npm package as
`agentic-mermaid/style-spec.schema.json`; see
[`custom-style-cookbook.md`](./custom-style-cookbook.md) for complete style
files and screenshots, and [`custom-fonts.md`](./custom-fonts.md) for font
resolution across output surfaces.

## Observe a native parser

The root library exports `withParserObservation(family, observer, parse)`. Wrap
one synchronous parser call to receive its actual consumed statements and
builder writes. Each event names its native kind, family and unit
(`statement`, `token` or `mutation`). Source coordinates explicitly distinguish
physical input from a parser's normalized view. Mutation operands are copied at
the call boundary, retaining identities, parent and membership fields.

```ts
import { parseRegisteredMermaid, withParserObservation } from 'agentic-mermaid'

const observations: import('agentic-mermaid').ParserObservation[] = []
const result = withParserObservation(
  'flowchart',
  event => observations.push(event),
  () => parseRegisteredMermaid('flowchart LR\nA --> B'),
)
```

Nested scopes restore their caller, including after an exception. An observer
callback does not implicitly observe a parser it invokes itself. Promise-returning
callbacks are rejected because the scope is synchronous. Observation is a
trusted in-process diagnostic API, outside serializable render options.

Native statement kinds and builder operations describe our implementations;
they are not Mermaid terminal kinds or its `yy` method protocol. Flowchart also
exposes consumed compound node/link fragments. Other native parsers expose
classified statements rather than a homologous token stream. The modern
assessment compares explicitly scoped semantic fields using independent
reference adapters and records unavailable comparisons honestly.

Flowchart/State positioned graphs also carry a `certification` receipt after
bounded final geometry checking. At most four deterministic candidates are
considered. Exhaustion throws `LayoutCertificationError` with code
`LAYOUT_CERTIFICATION_FAILED` and per-candidate reasons. This certifies hard graph
invariants, not an optimal layout. The common positioning boundary also vetoes
hard family-rubric violations in every native family's final projection.
Specialized family layouters get one attempt and fail explicitly; their checks
do not imply graph route guarantees or certify soft aesthetic quality.

The family registry is the operation authority. Use `am capabilities --json`
for the current roster and field schemas, or call `describeOps(family)` and
`opSignatures(family)` at runtime. The generated SDK declaration projects the
same descriptors; this reference deliberately does not copy an exhaustive
family/operation table.

### Preserved Sequence and XY label facts

Sequence facts include recognized messages inside preserved segments as
`preserved-message#<segment>.<statement> ...` and their title directives.
These identifiers do not change the typed `message#<index>` mutation indexes.
XY facts include authored point labels as `series#<index> point#<index> : <label>`;
the point index stays aligned with the data even when labels are sparse.
Consumers using `exact: true` must add these facts to their reviewed expected
inventory. Subset checks can keep their existing required facts. Do not build
an expected inventory by copying the output being checked.

### Class relation facts and `exact: true`

Class facts retain their existing class/member/relation lines and add endpoint
marker ownership and shaft style. A caller with a hardcoded complete fact set
must include these additions when using `exact: true`. For example:

```ts
const parsed = parseRegisteredMermaid('classDiagram\nPerson --|> Animal')
if (!parsed.ok) throw new Error('Invalid Class source')

const legacy = [
  'class Animal',
  'class Person',
  'family class',
  'relation Person inheritance Animal',
  'relation#0 Person inheritance Animal',
]
const expected = [
  ...legacy,
  'relation#0 Person inheritance Animal marker to',
  'relation#0 Person inheritance Animal line solid',
]
checkMermaid(parsed.value, { include: expected, exact: true }) // ok: true
```

Using `legacy` alone returns `ok: false` and lists the two new lines in
`unexpected`. The expanded expectation also rejects `Person <|-- Animal`,
because that relationship has `marker from`. Two-ended relationships add
`relation#0 from marker <kind>` and `relation#0 to marker <kind>` facts so
different marker kinds at the two ends remain distinguishable. Keep reviewed
expectations independent of the output being checked; deriving them from that
same output would accept its mistakes. Subset checks omit `exact: true` and
must still require the marker/shaft facts whose preservation matters.

### Authoring Class endpoint markers and shafts

Use `add_interface` to create a one-ended lollipop occurrence explicitly:

```ts
const op = {
  kind: 'add_interface', class: 'Service', label: 'Protocol',
  side: 'to', relationLabel: 'provides', lineStyle: 'solid',
} as const
```

Each operation creates a separate interface occurrence. Its `label` names the
interface; `relationLabel` names the connection. Ordinary classes with the same
spelling remain distinct. `add_relation` rejects one-ended lollipops between
ordinary class IDs and points callers to `add_interface`, since canonical
Mermaid source would otherwise change endpoint identity.

Class `add_relation` accepts optional `markerAt`, `fromKind`, `toKind` and
`lineStyle` fields. Existing calls that omit them retain the relation kind's
defaults. For example, this operation writes `Port ()..o Service`:

```ts
const op = {
  kind: 'add_relation', from: 'Port', to: 'Service',
  relKind: 'lollipop', markerAt: 'both', toKind: 'aggregation',
  lineStyle: 'dashed',
} as const
```

`markerAt` selects the active endpoints; endpoint kinds on inactive sides are
refused. The primary `relKind`, endpoint kinds and shaft must agree with the
relationship read back from the emitted source. Contradictory combinations
return `INVALID_OP` instead of silently changing kind on reload. Cardinalities,
labels and authored endpoint identities already present in parsed relationships
survive unrelated edits. Relationship label/cardinality line breaks export as
Mermaid `<br/>` markup so they remain on one source line. Direct `add_class`
copies initial members; member
authoring refuses blank/comment-form text, accessibility directives and physical
or entity-decoded line breaks rather than admitting text that disappears or
changes structure. The source reader still accepts diagram accessibility
directives; they cannot be authored through a member operation.

Opaque fallback bodies (any unmodeled syntax) are source-level-only: edit source deliberately, then parse and verify again.

## Capability and extension discovery

`am capabilities --json` reports the live family registry. (The Section A
capability report and its `createSectionACapabilityReport()` audit module are no
longer published.)

Canonical extension identities are kind-qualified (`look:`, `palette:`,
`backend:`, `family:`, `role:`, and `resource:`), versioned, provenance-bearing,
and collision-safe. New graphical backends declare feature/operation-level
Scene primitive capability claims; the registry rejects an empty, duplicate,
cross-target, or otherwise invalid claim set. Every external backend, and every
external family that supplies `lowerScene`, must also declare an explicit
compatible `identity.compatibility.scene` range (Scene v2: `^2.0.0`). The host
checks that range before running backend conformance or other executable
witnesses; only the internal built-in enrollment path receives compatibility
defaults.

### Current customization and extension inventory

This is the current authoritative inventory. See the
[render-options table](./api.md#render-options) and
[StyleSpec reference](./style-authoring.md) for field details.

| Level | Public seam | What it can change | Boundary and availability |
|---|---|---|---|
| Mermaid-authored appearance | frontmatter/init config, theme variables, family style statements such as classes and link styles | Syntax-defined colors, labels, family geometry, and interaction metadata where the family advertises support | Source-level and family-dependent. Raw `themeCSS` is recognized but diagnosed at the render boundary because its selectors and markup can escape an imported SVG; use `StyleSpec` instead. |
| One-off render overrides | `RenderOptions` | Palette channels, font family, spacing/geometry controls, deterministic seed, security, accessibility-related output options, and a Style stack | The generated field×surface matrix marks each serializable shared field `forwarded`, `host-enforced`, or `unavailable`. Hosted SVG and editor SVG enforce strict security with external font imports disabled; effective receipts reflect those constraints. Host callbacks are library-only and never enter receipts. |
| One-off declarative style | inline `StyleSpec` or a left-to-right `StyleInput[]` stack | Safe palette, font, stroke/fill treatment, backdrop, exact semantic-role defaults, named semantic slots, V1 `category` bindings, non-color cues, and inspect-only contrast/accent-area/mono-role constraints | JSON-safe and executable-code-free. Bindings supply defaults beneath authored family paint and semantics; constraints diagnose final effective paint without repainting or relayout. This is the lowest-complexity custom Style path. |
| Named Palette/Look | `registerStyle`, `getStyle`, `knownStyleDescriptors` | Installs a versioned `palette:` or `look:` name backed by exactly the same `StyleSpec` accepted inline | Descriptors expose one `kind` (`look` or `palette`), explicit `isDefault`, and one stable `inputName`. In-process host registry. A CLI/MCP/server sees a registration only when that host installs it at startup. |
| Theme conversion | `fromShikiTheme` | Converts a Shiki-compatible editor theme into diagram colors | Pure library helper; the result is ordinary declarative color input. |
| Live host retheming | CSS custom-property values in graphical color/font inputs | Lets a host page switch SVG palette and font values without re-rendering | SVG/browser-only and limited to safe property values; this is not a raw CSS rule or selector hook. Static outputs need values resolved under their rasterization environment to remain reproducible. |
| Terminal output projection | `AsciiRenderOptions` (`useAscii`, `paddingX`, `paddingY`, `boxBorderPadding`, `colorMode`, `theme`, `targetWidth`/`maxWidth`, `onProjectionDiagnostic`) | Selects Unicode/ASCII encoding, cell spacing, width policy, ANSI/HTML colors, terminal-only theme overrides, and projection-loss reporting | Output-adapter customization, not a second shared Style system. Serializable fields have transport-specific availability; the diagnostic callback is host-only and remains outside receipts. |
| Fonts and installed resources | `font`, Node PNG `fontDirs`/`loadSystemFonts`/`onWarning`, browser `BrowserPngRasterizer`, `ResourceManifest`, and repository host tooling via `NodeResourceResolver` | Selects a safe font stack, supplies host-dependent raster fonts, reports missing glyph coverage, or verifies bounded installed bytes | Font family names do not install fonts. Browser and warning callbacks remain outside serializable options and every digest. Node `fontDirs`/`loadSystemFonts` are trusted host inputs outside shared `RenderOptions` and the shared/appearance digests, but their resolved PNG output policy is included in the output-specific request digest; runtime provenance still marks host-dependent resources explicitly. Manifests require path, size, media-type, digest, and licence evidence and never fall back to network access. |
| Graphical backend | `registerBackend`, `runBackendConformance`, `createMermaidRenderer`, `createMermaidPNGRenderer`, `createMermaidBrowserPNGRenderer` (each with a host-only `backendPolicy`) | Serializes the typed Scene contract with a different drawing implementation for SVG, native Node/Bun PNG, and injected-rasterizer browser PNG | Trusted in-process host only. Host registrations must explicitly declare compatible core and Scene ranges; identity/compatibility admission precedes executable conformance. Registration then must pass bounded, deterministic, semantic, well-formed, secure SVG conformance plus an exact witness for every first-party core Scene primitive/feature/operation claim; namespaced extension claims without a core witness remain explicitly unverified. All listed factories use the same admitted and secured graphical request; PNG adapters do not reparse or rerender source. Serializable styles and `RenderOptions` cannot select arbitrary executable backends. |
| Diagram family | `registerFamily`, `getFamilyConformanceReport`, `parseRegisteredMermaid`, `projectPositionedView` | Adds a namespaced language with detection, parse/preservation, verification, layout, Scene/SVG, terminal, and discovery claims | Every versioned `family:<owner/name>` descriptor declares a compatible core range and supplies one bounded canonical `example`. It also lists consumed family-scoped shared fields in `applicableRenderOptions`; omission means none, unknown or duplicate fields fail registration, and the frozen declaration appears in the capability report. Registration stages the frozen candidate, runs native claims twice through canonical parse/serialize, non-empty positive-bounds layout, strict SVG, portable PNG pre-raster, terminal, Scene and verify paths, and rolls back on failure, reentrancy or nondeterminism. Discovery reports `native` only beside a passed per-capability witness. Native tuples still require layout + `projectPositioned`, Scene requires layout + `lowerScene`, and extension verification requires its hook plus executable SVG. An external Scene family additionally declares a compatible Scene range, and its example witnesses every positive role/primitive cell. Built-in-only unions stay closed; extension bodies use the open envelope. Remote transports gain the family only when their trusted host installs it. |
| Scene semantics | `SceneDoc`, typed connectors/markers/hit geometry, namespaced `SceneRole` | Lets a family/backend exchange identity, relationship, accessibility, geometry, and terminal-projection intent | This is a versioned typed contract, not a raw SVG hook. Unknown namespaced roles deliberately receive inert identity-only traits and cannot acquire core behavior by local-name collision. There is no public arbitrary Scene primitive/trait mutation registry. |
| Browser PNG host adapter | `renderMermaidPNGInBrowserWithReceipt(..., rasterize)` or reusable `createMermaidBrowserPNGRenderer({ rasterize, backendPolicy? })` | Supplies Canvas/OffscreenCanvas rasterization and reports font provenance | Trusted callback receives only the admitted, secured canonical SVG; the library re-applies the PNG color-profile gate and retains the same logical receipt as the native PNG path. |
| Identity plumbing | `canonicalExtensionId`, `parseExtensionId`, `createExtensionIdentity`, `registerExtension`, `ExtensionCollisionError` | Gives kind-specific registries stable names, parsing, versions, provenance, compatibility ranges, and collision rejection | Low-level plumbing, not a stand-alone extension registry or rendering hook. Stable short inputs belong to kind-specific descriptors. |

There is currently no BrandPack registry, public role-trait registration,
arbitrary SVG/CSS hook, or Treatment hook. Semantic slots and the closed V1
`category` binding API are ordinary `StyleSpec` fields; other Scene channels are
not publicly bindable without new executable family witnesses. B4 remains the
unpromoted, evidence-gated BrandPack distribution envelope only. A future
Treatment seam is a separate decision and is not implied by B4.

## Graph layout hints

Flowchart and State graphical renders accept explicit deterministic preferences:

```ts
const options = {
  layoutHints: {
    ranks: { UI: 0, API: 1, Cache: 2, DB: 3 },
    adjacent: [['Cache', 'DB']],
    shortEdges: ['API->Cache'],
  },
}
```

Ranks are ordered ELK partitions, with unlisted nodes in partition zero; they
are not absolute pixel positions. Adjacency prefers consecutive sibling model
order within one container. Short-edge preferences use authored IDs or
`from->to` / `from->to#k` occurrence IDs. All references are checked; unknown
identities and conflicting adjacency groups fail explicitly. These preferences
never delete relationships, remain subject to geometry certification, and do not
guarantee a shortest route or fixed positions. Retain render options beside the
Mermaid source; hints participate in request digests, editor config, and receipts.
