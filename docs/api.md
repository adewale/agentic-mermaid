# API reference

Agentic Mermaid exposes these library surfaces:

- `agentic-mermaid` — runtime-neutral renderer API for SVG, ASCII/Unicode,
  and host-injected browser PNG output.
- `agentic-mermaid/agent` — agent-native API with
  parse/narrow/mutate/verify/serialize plus SVG, native Node/Bun PNG, and ASCII
  output helpers.
- `agentic-mermaid/capabilities` — audit/discovery reports and the full pinned upstream semantic manifest; intentionally separate from renderer bundles.
- `agentic-mermaid/resources` — trusted Node-host verification/resolution for installed content-addressed resources; intentionally absent from browser bundles.

Use `agentic-mermaid/agent` when you want one import path for agents.

### Canonical requests and comparable receipts

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

## Output helpers

### SVG

```ts
import { renderMermaidSVG } from 'agentic-mermaid/agent'

const svg = renderMermaidSVG(`flowchart TD
  A --> B`, { security: 'strict' })
```

`renderMermaidSVG(input, options?)` accepts a Mermaid source string or any open
`ParsedDiagram` envelope returned by `parseRegisteredMermaid` and returns an SVG
string.

### PNG

```ts
import { writeFileSync } from 'node:fs'
import { renderMermaidPNG } from 'agentic-mermaid/agent'

const png = renderMermaidPNG(`flowchart TD
  A --> B`, {
  fitTo: { width: 1200 },
  background: '#fff',
})

writeFileSync('diagram.png', png)
```

`renderMermaidPNG(input, options?)` accepts a Mermaid source string or any open
`ParsedDiagram` envelope returned by `parseRegisteredMermaid` and returns
`Uint8Array` PNG bytes. SVG, ASCII/Unicode, layout, native PNG, and browser PNG
accept the same parsed-or-source input contract; an unregistered preserved
envelope round-trips exactly and returns its stable capability diagnostic rather
than falling through to Flowchart.

`PngOptions` extends the shared `RenderOptions` contract used by SVG. The
canonical machine-readable field set is returned by
`sharedRenderOptionsJsonSchema()`; the table below contains only PNG-specific
controls:

| Option | Type | Default | Availability and meaning |
|---|---|---:|---|
| `scale` | `number` | `2` | Portable: native/browser library, CLI, and local/hosted MCP. Zoom multiplier when `fitTo` is not set. |
| `background` | `string` | artifact background, then white | Portable on the same surfaces. Safe explicit PNG background color. |
| `fitTo` | `{ width?: number; height?: number }` | — | Portable on the same surfaces. Constrain output to exactly one positive width or height. |
| `fontDirs` | `string[]` | — | Trusted native-host input: Node/Bun library, CLI, and local MCP only. Extra font directories for unbundled families and scripts the bundled fonts do not cover. CLI: `--font-dirs <dirs>` (comma-separated). |
| `loadSystemFonts` | `boolean` | `false` | Trusted native-host input on the same native surfaces. Trades cross-machine determinism for glyph coverage. CLI: `--system-fonts`. |
| `onWarning` | `(w: PngFontWarning) => void` | stderr | Native library callback only. Receives `PNG_FONT_COVERAGE` warnings; callbacks never enter serializable requests or receipts. |

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

#### Trusted host-selected graphical backends

Executable backends are bound by the host, never selected by `RenderOptions` or
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

### ASCII / Unicode

```ts
import { renderMermaidASCII } from 'agentic-mermaid/agent'

const unicode = renderMermaidASCII(`flowchart LR
  A --> B`)
const ascii = renderMermaidASCII(`flowchart LR
  A --> B`, { useAscii: true })
```

`renderMermaidASCII(input, options?)` accepts a Mermaid source string or any open
`ParsedDiagram` envelope returned by `parseRegisteredMermaid` and returns terminal
text.

`AsciiRenderOptions` also extends the same shared `RenderOptions` contract.
Terminal-only controls and the explicit losses involved in projecting a
graphical appearance onto terminal cells are documented in
[`ascii.md`](./ascii.md).
`colorMode: 'html'` returns an escaped terminal projection through this same
function; it is not a separate CLI output format or a `renderMermaidHTML` API.

`AsciiRenderOptions`:

| Option | Type | Default | Meaning |
|---|---|---:|---|
| `useAscii` | `boolean` | `false` | Use 7-bit ASCII instead of Unicode box drawing. |
| `paddingX` | `number` | `5` | Horizontal spacing. |
| `paddingY` | `number` | `5` | Vertical spacing. |
| `boxBorderPadding` | `number` | `1` | Inner box padding. |
| `colorMode` | `string` | `'auto'` | `'none'`, `'auto'`, `'ansi16'`, `'ansi256'`, `'truecolor'`, or `'html'`. |
| `theme` | `Partial<AsciiTheme>` | — | Override ASCII colors. |
| `targetWidth` | `number` | unset | Hard maximum line width in terminal display cells. Uses grapheme-safe fitting; impossible geometry throws `AsciiWidthError`. |
| `maxWidth` | `number` | unset | Deprecated best-effort label wrapping. It does **not** guarantee the output width. Do not combine with `targetWidth`. |
| `onProjectionDiagnostic` | `(diagnostic: TerminalProjectionDiagnostic) => void` | — | Host callback for explicit graphical-to-terminal projection losses; non-serializable and excluded from receipts. |

`AsciiWidthError` has code `ASCII_TARGET_WIDTH_IMPOSSIBLE` plus
`requestedWidth`, `requiredWidth`, `family`, and `reason` (`MINIMUM_GEOMETRY`,
`UNBREAKABLE_GRAPHEME`, or `INVALID_WIDTH`). The same fields are returned by
CLI JSON and hosted MCP errors. CLI: `am render diagram.mmd --format unicode
--target-width 80`; hosted `render_ascii`: `{ source, targetWidth: 80 }`.
Omitting both width options preserves the unconstrained output path.

## Shared render options

SVG, PNG, ASCII, and Unicode adapters accept this serializable `RenderOptions`
field set. The built-in-family column exposes family applicability; the
terminal column records whether text output consumes a field, projects it with
an explicit diagnostic, or declares it inapplicable. Output-specific controls
remain in their respective sections.

<!-- BEGIN GENERATED SHARED RENDER OPTIONS -->
| Option | Type | Effective default | Meaning | Built-in families | Terminal |
|---|---|---|---|---|---|
| `bg` | `string` | `#FFFFFF` | Background color or CSS variable. | all | consumed |
| `fg` | `string` | `#27272A` | Primary foreground and text color. | all | consumed |
| `line` | `string` | derived | Connector and secondary-line color. | all | consumed |
| `accent` | `string` | derived | Arrowhead, highlight, and data accent color. | all | consumed |
| `muted` | `string` | derived | Secondary text and label color. | all | projected — terminal themes have no dedicated muted-text role |
| `surface` | `string` | derived | Node and group surface color. | all | projected — terminal cells do not paint graphical surfaces |
| `border` | `string` | derived | Node and group border color. | all | consumed |
| `font` | `string` | `Inter` | CSS font family or stack. | all | projected — the host terminal owns the font face |
| `style` | `StyleInput \| StyleInput[]` | `crisp` | Registered Style/Palette name, inline StyleSpec, or left-to-right stack. | all | consumed |
| `padding` | `number` | `40` | Canvas padding in SVG user units. | flowchart, state, architecture | not-applicable — terminal output uses paddingX, paddingY, and boxBorderPadding |
| `nodeSpacing` | `number` | `24` | Horizontal spacing between sibling nodes. | flowchart, state, class, er, architecture | not-applicable — terminal layout has a cell-grid spacing contract |
| `layerSpacing` | `number` | `40` | Vertical spacing between graph layers. | flowchart, state, class, er, architecture | not-applicable — terminal layout has a cell-grid spacing contract |
| `wrappingWidth` | `number` | unset | Flowchart measured-label wrapping budget in pixels. | flowchart | not-applicable — terminal output uses maxWidth or targetWidth |
| `componentSpacing` | `number` | extension-defined | Spacing between disconnected graph components for compatible extension families; no built-in family currently consumes it. | none — extension-defined | not-applicable — terminal layout has a cell-grid spacing contract |
| `transparent` | `boolean` | `false` | Omit the painted SVG canvas background. | all | projected — terminal output has no painted canvas background |
| `interactive` | `boolean` | `false` | Enable hover tooltips for supported chart data points. | xychart, pie, quadrant | projected — terminal output is a static semantic projection |
| `shadow` | `boolean` | `false` | Paint explicit drop shadows on node shapes. | flowchart, state, sequence, timeline, class, er, journey, xychart, pie, quadrant, gantt, mindmap, gitgraph | projected — elevation projects to borders and labels |
| `class` | `{ hierarchicalNamespaces?: boolean }` | `hierarchicalNamespaces: true` | Class-diagram rendering controls. | class | not-applicable — this option configures graphical class layout |
| `architecture` | `{ visual?: ArchitectureVisualOverrides }` | built-in metrics | Sparse architecture renderer visual metric and paint overrides. | architecture | not-applicable — this option configures graphical architecture rendering |
| `timeline` | `{ maxWidth?: number }` | `maxWidth`: unset | Timeline layout controls. | timeline | not-applicable — terminal output uses maxWidth or targetWidth |
| `journey` | `{ experienceCurve?: boolean }` | `experienceCurve: true` | User-journey graphical controls. | journey | not-applicable — experience curves are graphical-only |
| `gantt` | `{ dependencyArrows?: boolean; criticalPath?: boolean }` | both `false` | Gantt dependency and critical-path overlays. | gantt | not-applicable — graphical Gantt connector emphasis is not represented in cells |
| `mermaidConfig` | `MermaidRuntimeConfig` | source config | Mermaid-style recursive runtime configuration. | all | consumed |
| `embedFontImport` | `boolean` | `false` | Embed the Google Fonts import in SVG styles; PNG forces this off for offline rasterization. | all | not-applicable — terminal output embeds no web-font import |
| `compact` | `boolean` | `false` | Compact SVG serialization while preserving agent hooks. | all | not-applicable — compact controls SVG serialization |
| `idPrefix` | `string` | unset | Non-empty namespace for generated SVG definition IDs and local references. | all | not-applicable — terminal output has no SVG definition ids |
| `security` | `'default' \| 'strict'` | `default` | Active SVG content is rejected in every mode; strict additionally rejects every external reference. Raw Mermaid themeCSS is rejected in both modes. | all | not-applicable — terminal text has its own control-character and HTML-color safety projection |
| `ganttToday` | `string` | unset | Explicit deterministic date for the Gantt today marker. | gantt | consumed |
| `seed` | `number` | `0` | Deterministic re-roll seed for stochastic Styles. | all | not-applicable — terminal glyph geometry is deterministic and has no stochastic ink |
<!-- END GENERATED SHARED RENDER OPTIONS -->

`Built-in families: all` means the field is family-neutral. `none —
extension-defined` means no built-in currently consumes it. An external
`FamilyDescriptor` opts into any family-scoped field it consumes through its
frozen `applicableRenderOptions` array; an omitted or empty declaration means
none, and authored values receive `RENDER_OPTION_NOT_APPLICABLE` in the render
receipt.

`onConfigDiagnostic?: (diagnostic: ConfigDiagnostic) => void` is deliberately
outside the serializable field set. Library callers can collect qualified
`INEFFECTIVE_CONFIG` warnings without changing output bytes; CLI, MCP, editor,
and JSON Schema surfaces return diagnostics as data instead of accepting a
function.

### SVG semantic identity and accessibility

All built-in families expose the same inspectable element contract:

- every source-semantic Scene mark has a deterministic `data-id` and closed
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

## Agent edit API

```ts
import {
  parseRegisteredMermaid,
  asFlowchart,
  mutate,
  verifyMermaid,
  analyzeMermaid,
  analyzeMermaidSource,
  describeMermaidFacts,
  checkMermaid,
  serializeMermaid,
} from 'agentic-mermaid/agent'
```

Core functions:

| Function | Purpose |
|---|---|
| `parseRegisteredMermaid(source)` | Parse Mermaid source to `Result<ValidDiagram, ParseError[]>`. |
| Family narrower | Narrow to a mutable family or return `null`; obtain the current generated name from `am capabilities --json`. |
| `mutate(d, op)` | Apply a kind-discriminated typed mutation. |
| `verifyMermaid(d)` | Return structural warnings and layout evidence. |
| `analyzeMermaid(d)` / `analyzeMermaidSource(source)` | Return deterministic non-rendering analysis: feedback edges, source-only action records, and Gantt critical-path/slack summary when available. |
| `describeMermaidFacts(d)` / `checkMermaid(d, spec)` | Return deterministic semantic fact lines, or check required/forbidden facts such as `edge Processing -> [*] : done`, `member Duck +quack()`, `task Docs start after core`. |
| `serializeMermaid(d)` | Emit source only after verifying. |
| `layoutMermaid(d)` | Return layout JSON for quality/inspection; `layoutMermaid(d, { debug: true })` includes graph route certificates, family edge-route certificates (class/ER/architecture/sequence), region-containment certificates (timeline/charts), and semantic region/action sidecars (`cluster`, `lane`, `band`, `compartment`, `plot`, `ring`). Edge certificates include exact ports plus side/slot/role port assignments where applicable. |
| `renderMermaidWithActions(d, request)` | Render SVG, PNG, ASCII, or Unicode and return one inert action/hit-region sidecar for admitted Flowchart/Class/Gantt interactions and Sequence actor-menu links. An SVG href is `embedded-inert` only when matching inert metadata is present in the returned SVG; PNG/terminal actions, strict-mode hrefs, and all callbacks are `sidecar-only` and never execute. Terminal artifacts also return projection `warnings`, and terminal render failure throws instead of returning an empty success artifact. |
| `measureQuality(layout, colors?)` / `checkQuality(layout, bounds?, colors?)` | Perceptual quality metrics, including fail-closed contrast (`null` when requested paints are unresolved), nearest-node spacing, and element density. Rendered audits can supply exact foreground/background associations through `textPairs`. |
| `describeMermaid(d, { format })` | Prose, AX-tree, or facts summary (`format: "text" | "json" | "facts"`). |

The family registry is the operation authority. Use `am capabilities --json`
for the current roster and field schemas, or call `describeOps(family)` and
`opSignatures(family)` at runtime. The generated SDK declaration projects the
same descriptors; this reference deliberately does not copy an exhaustive
family/operation table.

Opaque fallback bodies (any unmodeled syntax) are source-level-only: edit source deliberately, then parse and verify again.

## Capability and extension discovery

Import `createSectionACapabilityReport()` from
`agentic-mermaid/capabilities`. It returns the JSON-safe, registry-derived
request/backend/output/family/Scene matrix. `am capabilities --json` →
`sectionA` intentionally exposes only its version, pin, digest, counts,
no-absent status, and directions to this full report. Validate a stored snapshot with
`validateSectionACapabilityReport(report)`. The generated human projection is
[`project/section-a-capability-report.md`](./project/section-a-capability-report.md).
Keeping this audit surface on a separate entry point prevents the full
characterization and upstream syntax corpora from entering renderer/browser
bundles.

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

This is the current authoritative inventory. Field-level `RenderOptions` and
`StyleSpec` details remain in their generated tables above rather than being
copied here.

| Level | Public seam | What it can change | Boundary and availability |
|---|---|---|---|
| Mermaid-authored appearance | frontmatter/init config, theme variables, family style statements such as classes and link styles | Syntax-defined colors, labels, family geometry, and interaction metadata where the family advertises support | Source-level and family-dependent. Raw `themeCSS` is recognized but diagnosed at the render boundary because its selectors and markup can escape an imported SVG; use `StyleSpec` instead. |
| One-off render overrides | `RenderOptions` | Palette channels, font family, spacing/geometry controls, deterministic seed, security, accessibility-related output options, and a Style stack | The generated field×surface matrix marks each serializable shared field `forwarded`, `host-enforced`, or `unavailable`. Hosted SVG and editor SVG enforce strict security with external font imports disabled; effective receipts reflect those constraints. Host callbacks are library-only and never enter receipts. |
| One-off declarative style | inline `StyleSpec` or a left-to-right `StyleInput[]` stack | Safe palette, font, stroke/fill treatment, backdrop, exact semantic-role defaults, named semantic slots, V1 `category` bindings, non-color cues, and inspect-only contrast/accent-area/mono-role constraints | JSON-safe and executable-code-free. Bindings supply defaults beneath authored family paint and semantics; constraints diagnose final effective paint without repainting or relayout. This is the lowest-complexity custom Style path. |
| Named Palette/Look | `registerStyle`, `getStyle`, `knownStyleDescriptors` | Installs a versioned `palette:` or `look:` name backed by exactly the same `StyleSpec` accepted inline | Descriptors expose one `kind` (`look` or `palette`), explicit `isDefault`, and one stable `inputName`. In-process host registry. A CLI/MCP/server sees a registration only when that host installs it at startup. |
| Theme conversion | `fromShikiTheme` | Converts a Shiki-compatible editor theme into diagram colors | Pure library helper; the result is ordinary declarative color input. |
| Live host retheming | CSS custom-property values in graphical color/font inputs | Lets a host page switch SVG palette and font values without re-rendering | SVG/browser-only and limited to safe property values; this is not a raw CSS rule or selector hook. Static outputs need values resolved under their rasterization environment to remain reproducible. |
| Terminal output projection | `AsciiRenderOptions` (`useAscii`, `paddingX`, `paddingY`, `boxBorderPadding`, `colorMode`, `theme`, `targetWidth`/`maxWidth`, `onProjectionDiagnostic`) | Selects Unicode/ASCII encoding, cell spacing, width policy, ANSI/HTML colors, terminal-only theme overrides, and projection-loss reporting | Output-adapter customization, not a second shared Style system. Serializable fields have transport-specific availability; the diagnostic callback is host-only and remains outside receipts. |
| Fonts and installed resources | `font`, Node PNG `fontDirs`/`loadSystemFonts`/`onWarning`, browser `BrowserPngRasterizer`, `ResourceManifest`, and `agentic-mermaid/resources` → `NodeResourceResolver` | Selects a safe font stack, supplies host-dependent raster fonts, reports missing glyph coverage, or verifies bounded installed bytes | Font family names do not install fonts. Browser and warning callbacks remain outside serializable options and every digest. Node `fontDirs`/`loadSystemFonts` are trusted host inputs outside shared `RenderOptions` and the shared/appearance digests, but their resolved PNG output policy is included in the output-specific request digest; runtime provenance still marks host-dependent resources explicitly. Manifests require path, size, media-type, digest, and licence evidence and never fall back to network access. |
| Graphical backend | `registerBackend`, `runBackendConformance`, `createMermaidRenderer`, `createMermaidPNGRenderer`, `createMermaidBrowserPNGRenderer` (each with a host-only `backendPolicy`) | Serializes the typed Scene contract with a different drawing implementation for SVG, native Node/Bun PNG, and injected-rasterizer browser PNG | Trusted in-process host only. Host registrations must explicitly declare compatible core and Scene ranges; identity/compatibility admission precedes executable conformance. Registration then must pass bounded, deterministic, semantic, well-formed, secure SVG conformance plus an exact witness for every first-party core primitive/feature/operation claim; namespaced extension claims without a core witness remain explicitly unverified. All listed factories use the same admitted and secured graphical request; PNG adapters do not reparse or rerender source. Serializable styles and `RenderOptions` cannot select arbitrary executable backends. |
| Diagram family | `registerFamily`, `getFamilyConformanceReport`, `parseRegisteredMermaid`, `projectPositionedView` | Adds a namespaced language with detection, parse/preservation, verification, layout, Scene/SVG, terminal, and discovery claims | Every versioned `family:<owner/name>` descriptor declares a compatible core range and supplies one bounded canonical `example`. It also lists consumed family-scoped shared fields in `applicableRenderOptions`; omission means none, unknown or duplicate fields fail registration, and the frozen declaration appears in the capability report. Registration stages the frozen candidate, runs native claims twice through canonical parse/serialize, non-empty positive-bounds layout, strict SVG, portable PNG pre-raster, terminal, Scene and verify paths, and rolls back on failure, reentrancy or nondeterminism. Discovery reports `native` only beside a passed per-capability witness. Native tuples still require layout + `projectPositioned`, Scene requires layout + `lowerScene`, and extension verification requires its hook plus executable SVG. An external Scene family additionally declares a compatible Scene range, and its example witnesses every positive role/primitive cell. Built-in-only unions stay closed; extension bodies use the open envelope. Remote transports gain the family only when their trusted host installs it. |
| Scene semantics | `SceneDoc`, typed connectors/markers/hit geometry, namespaced `SceneRole` | Lets a family/backend exchange identity, relationship, accessibility, geometry, and terminal-projection intent | This is a versioned typed contract, not a raw SVG hook. Unknown namespaced roles deliberately receive inert identity-only traits and cannot acquire core behavior by local-name collision. There is no public arbitrary primitive/trait mutation registry. |
| Browser PNG host adapter | `renderMermaidPNGInBrowserWithReceipt(..., rasterize)` or reusable `createMermaidBrowserPNGRenderer({ rasterize, backendPolicy? })` | Supplies Canvas/OffscreenCanvas rasterization and reports font provenance | Trusted callback receives only the admitted, secured canonical SVG; the library re-applies the PNG color-profile gate and retains the same logical receipt as the native PNG path. |
| Identity plumbing | `canonicalExtensionId`, `parseExtensionId`, `createExtensionIdentity`, `registerExtension`, `ExtensionCollisionError` | Gives kind-specific registries stable names, parsing, versions, provenance, compatibility ranges, and collision rejection | Low-level plumbing, not a stand-alone extension registry or rendering hook. Stable short inputs belong to kind-specific descriptors. |

There is currently no BrandPack registry, public role-trait registration,
arbitrary SVG/CSS hook, or Treatment hook. Semantic slots and the closed V1
`category` binding API are ordinary `StyleSpec` fields; other Scene channels are
not publicly bindable without new executable family witnesses. B4 remains the
unpromoted, evidence-gated BrandPack distribution envelope only. A future
Treatment seam is a separate decision and is not implied by B4.

## CLI

```bash
am render diagram.mmd --format svg > diagram.svg
am render diagram.mmd --format png --output diagram.png --fit-width 1200 --bg '#fff'
am render diagram.mmd --format ascii > diagram.txt
am render diagram.mmd --format layout --certificates > layout-with-routes.json
am verify diagram.mmd
am describe diagram.mmd --format facts
am mutate diagram.mmd --op '{"kind":"add_node","id":"Cache","label":"Cache"}' --json
am capabilities --json
am init-agent --dir . --json
```

PNG is single-input and requires `--output` so binary bytes are never accidentally printed to a terminal. Portable controls are `--scale`, `--bg`, and the mutually exclusive `--fit-width`/`--fit-height`; native-host font controls are `--font-dirs` and `--system-fonts`. `am init-agent` writes a non-clobbering agent-agnostic onboarding bundle (`AGENTS.md`, root `skills/`, and `.mcp.json`) into a consumer repo.

## MCP

The published package exposes Node-runnable bins: `am`, `agentic-mermaid`, and `agentic-mermaid-mcp`.

Local `agentic-mermaid-mcp` is Code Mode-first and exposes:

- `execute(code)` — primary Code Mode tool with global `mermaid.*` SDK.
- `describe_sdk({ family, detail })` — version-matched compact signatures or exact mutation fields for one family.
- `render_png` — narrow helper returning base64 PNG bytes, or managed file/URL artifacts via `output: "file"|"url"`; accepts portable `scale`/`background`/`fitTo`, plus local-only `fontDirs`/`loadSystemFonts`, and returns configuration/font-coverage warnings with every output mode.
- `describe` — narrow summary helper; pass `format: "facts"` for deterministic semantic fact lines.

Use Code Mode for multi-step parse/narrow/mutate/verify/serialize loops. Use `render_png` or host/library code for binary PNG output. The default transport is stdio; `agentic-mermaid-mcp --transport http --host 127.0.0.1 --port 3000` starts the HTTP/SSE transport. HTTP mode serves managed artifacts from `/artifacts/<name>` with MIME type, byte count, and SHA-256 metadata in tool responses. Non-loopback HTTP binding requires `--auth-token`; that bearer token protects `/rpc`, `/sse`, `/message`, and `/artifacts/*`.

A hosted Streamable HTTP endpoint also runs at `https://agentic-mermaid.dev/mcp`. It is MCP JSON-RPC only (not REST), stateless, public/unauthenticated, and capped at 64 KB inputs. Hosted tools are `execute`, `describe_sdk`, `render_svg`, `render_ascii`, `render_png`, `verify`, `describe`, `mutate`, and `build`; `describe_sdk` returns compact signatures or exact mutation fields for one family, hosted `execute` uses a Cloudflare Dynamic Worker isolate with no network, and hosted `render_png` returns base64 only while retaining portable `scale`/`background`/`fitTo`. Prefer local CLI/library/MCP for sensitive diagrams, offline work, larger inputs, native font controls, or file/URL PNG artifacts. See [`mcp-http-transport.md`](./mcp-http-transport.md) for JSON-RPC examples and option details.
