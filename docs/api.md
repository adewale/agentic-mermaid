# API reference

Agentic Mermaid exposes four library surfaces:

- `agentic-mermaid` — renderer-focused public API for SVG and ASCII/Unicode output.
- `agentic-mermaid/agent` — agent-native API with parse/narrow/mutate/verify/serialize plus SVG, PNG, and ASCII output helpers.
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
`appearanceDigest`. CLI JSON results and local/hosted MCP render results expose
the same receipt. Use `validateSerializableRenderOptions(value)` and
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

`renderMermaidSVG(input, options?)` accepts a Mermaid source string or `ValidDiagram` and returns an SVG string.

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

`renderMermaidPNG(input, options?)` accepts a Mermaid source string or `ValidDiagram` and returns `Uint8Array` PNG bytes.

`PngOptions` extends the shared `RenderOptions` contract used by SVG. The
canonical machine-readable field set is returned by
`sharedRenderOptionsJsonSchema()`; the table below contains only PNG-specific
controls:

| Option | Type | Default | Meaning |
|---|---|---:|---|
| `scale` | `number` | `2` | Zoom multiplier when `fitTo` is not set. |
| `background` | `string` | `'white'` | PNG background color. |
| `fitTo` | `{ width?: number; height?: number }` | — | Constrain output to a width or height. |
| `fontDirs` | `string[]` | — | Extra font directories: custom styles that reference unbundled families, and scripts the bundled fonts don't cover (CJK, emoji). CLI: `--font-dirs <dirs>` (comma-separated). |
| `loadSystemFonts` | `boolean` | `false` | Also load OS-installed fonts. Trades cross-machine determinism for glyph coverage; coverage warnings are skipped (system coverage is unknown). CLI: `--system-fonts`. |
| `onWarning` | `(w: PngFontWarning) => void` | stderr | Receives `PNG_FONT_COVERAGE` warnings (characters no loaded font covers, grouped per script). Without a handler they are written to stderr — tofu is never silent. |

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

### ASCII / Unicode

```ts
import { renderMermaidASCII } from 'agentic-mermaid/agent'

const unicode = renderMermaidASCII(`flowchart LR
  A --> B`)
const ascii = renderMermaidASCII(`flowchart LR
  A --> B`, { useAscii: true })
```

`renderMermaidASCII(input, options?)` accepts a Mermaid source string or `ValidDiagram` and returns terminal text.

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

`AsciiWidthError` has code `ASCII_TARGET_WIDTH_IMPOSSIBLE` plus
`requestedWidth`, `requiredWidth`, `family`, and `reason` (`MINIMUM_GEOMETRY`,
`UNBREAKABLE_GRAPHEME`, or `INVALID_WIDTH`). The same fields are returned by
CLI JSON and hosted MCP errors. CLI: `am render diagram.mmd --format unicode
--target-width 80`; hosted `render_ascii`: `{ source, targetWidth: 80 }`.
Omitting both width options preserves the unconstrained output path.

## Shared render options

SVG, PNG, ASCII, and Unicode adapters accept this serializable `RenderOptions`
field set. The terminal column records whether text output consumes a field,
projects it with an explicit diagnostic, or declares it inapplicable. Output-
specific controls remain in their respective sections.

<!-- BEGIN GENERATED SHARED RENDER OPTIONS -->
| Option | Type | Effective default | Meaning | Terminal |
|---|---|---|---|---|
| `bg` | `string` | `#FFFFFF` | Background color or CSS variable. | consumed |
| `fg` | `string` | `#27272A` | Primary foreground and text color. | consumed |
| `line` | `string` | derived | Connector and secondary-line color. | consumed |
| `accent` | `string` | derived | Arrowhead, highlight, and data accent color. | consumed |
| `muted` | `string` | derived | Secondary text and label color. | projected — terminal themes have no dedicated muted-text role |
| `surface` | `string` | derived | Node and group surface color. | projected — terminal cells do not paint graphical surfaces |
| `border` | `string` | derived | Node and group border color. | consumed |
| `font` | `string` | `Inter` | CSS font family or stack. | projected — the host terminal owns the font face |
| `style` | `StyleInput \| StyleInput[]` | `crisp` | Registered Style/Palette name, inline StyleSpec, or left-to-right stack. | consumed |
| `padding` | `number` | `40` | Canvas padding in SVG user units. | not-applicable — terminal output uses paddingX, paddingY, and boxBorderPadding |
| `nodeSpacing` | `number` | `24` | Horizontal spacing between sibling nodes. | not-applicable — terminal layout has a cell-grid spacing contract |
| `layerSpacing` | `number` | `40` | Vertical spacing between graph layers. | not-applicable — terminal layout has a cell-grid spacing contract |
| `wrappingWidth` | `number` | unset | Flowchart measured-label wrapping budget in pixels. | not-applicable — terminal output uses maxWidth or targetWidth |
| `componentSpacing` | `number` | `nodeSpacing` (`24`) | Spacing between disconnected graph components. | not-applicable — terminal layout has a cell-grid spacing contract |
| `transparent` | `boolean` | `false` | Omit the painted SVG canvas background. | projected — terminal output has no painted canvas background |
| `interactive` | `boolean` | `false` | Enable hover tooltips for supported chart data points. | projected — terminal output is a static semantic projection |
| `shadow` | `boolean` | `false` | Paint explicit drop shadows on node shapes. | projected — elevation projects to borders and labels |
| `class` | `{ hierarchicalNamespaces?: boolean }` | `hierarchicalNamespaces: true` | Class-diagram rendering controls. | not-applicable — this option configures graphical class layout |
| `architecture` | `{ visual?: ArchitectureVisualConfig }` | built-in metrics | Architecture renderer visual metrics and paint overrides. | not-applicable — this option configures graphical architecture rendering |
| `timeline` | `{ maxWidth?: number }` | `maxWidth`: unset | Timeline layout controls. | not-applicable — terminal output uses maxWidth or targetWidth |
| `journey` | `{ experienceCurve?: boolean }` | `experienceCurve: true` | User-journey graphical controls. | not-applicable — experience curves are graphical-only |
| `gantt` | `{ dependencyArrows?: boolean; criticalPath?: boolean }` | both `false` | Gantt dependency and critical-path overlays. | not-applicable — graphical Gantt connector emphasis is not represented in cells |
| `mermaidConfig` | `MermaidRuntimeConfig` | source config | Mermaid-style recursive runtime configuration. | consumed |
| `embedFontImport` | `boolean` | `true` (SVG) | Embed the Google Fonts import in SVG styles; PNG forces this off for offline rasterization. | not-applicable — terminal output embeds no web-font import |
| `compact` | `boolean` | `false` | Compact SVG serialization while preserving agent hooks. | not-applicable — compact controls SVG serialization |
| `idPrefix` | `string` | `''` | Namespace generated SVG definition IDs and local references. | not-applicable — terminal output has no SVG definition ids |
| `security` | `'default' \| 'strict'` | `default` | Active SVG content is rejected in every mode; strict additionally rejects every external reference. Raw Mermaid themeCSS is rejected in both modes. | not-applicable — terminal text has its own control-character and HTML-color safety projection |
| `ganttToday` | `string` | unset | Explicit deterministic date for the Gantt today marker. | consumed |
| `seed` | `number` | `0` | Deterministic re-roll seed for stochastic Styles. | not-applicable — terminal glyph geometry is deterministic and has no stochastic ink |
<!-- END GENERATED SHARED RENDER OPTIONS -->

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
  parseMermaid,
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
| `parseMermaid(source)` | Parse Mermaid source to `Result<ValidDiagram, ParseError[]>`. |
| Family narrower | Narrow to a mutable family or return `null`; obtain the current generated name from `am capabilities --json`. |
| `mutate(d, op)` | Apply a kind-discriminated typed mutation. |
| `verifyMermaid(d)` | Return structural warnings and layout evidence. |
| `analyzeMermaid(d)` / `analyzeMermaidSource(source)` | Return deterministic non-rendering analysis: feedback edges, source-only action records, and Gantt critical-path/slack summary when available. |
| `describeMermaidFacts(d)` / `checkMermaid(d, spec)` | Return deterministic semantic fact lines, or check required/forbidden facts such as `edge Processing -> [*] : done`, `member Duck +quack()`, `task Docs start after core`. |
| `serializeMermaid(d)` | Emit source only after verifying. |
| `layoutMermaid(d)` | Return layout JSON for quality/inspection; `layoutMermaid(d, { debug: true })` includes graph route certificates, family edge-route certificates (class/ER/architecture/sequence), region-containment certificates (timeline/charts), and V1 region/action sidecars. Edge certificates include exact ports plus side/slot/role port assignments where applicable. |
| `measureQuality(layout)` / `checkQuality(layout)` | Perceptual quality metrics. |
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
request/backend/output/family/Scene matrix also exposed as
`am capabilities --json` → `sectionA`. Validate a stored snapshot with
`validateSectionACapabilityReport(report)`. The generated human projection is
[`project/section-a-capability-report.md`](./project/section-a-capability-report.md).
Keeping this audit surface on a separate entry point prevents the full
characterization and upstream syntax corpora from entering renderer/browser
bundles.

Canonical extension identities are kind-qualified (`look:`, `palette:`,
`backend:`, `family:`, `role:`, and `resource:`), versioned, provenance-bearing,
and collision-safe. New graphical backends declare feature/operation-level
Scene primitive capability claims; the registry rejects an empty, duplicate,
cross-target, or otherwise invalid claim set.

### Current customization and extension inventory

This is the current authoritative inventory. Field-level `RenderOptions` and
`StyleSpec` details remain in their generated tables above rather than being
copied here.

| Level | Public seam | What it can change | Boundary and availability |
|---|---|---|---|
| Mermaid-authored appearance | frontmatter/init config, theme variables, family style statements such as classes and link styles | Syntax-defined colors, labels, family geometry, and interaction metadata where the family advertises support | Source-level and family-dependent. Raw `themeCSS` is recognized but diagnosed at the render boundary because its selectors and markup can escape an imported SVG; use `StyleSpec` instead. |
| One-off render overrides | `RenderOptions` | Palette channels, font family, spacing/geometry controls, deterministic seed, security, accessibility-related output options, and a Style stack | Serializable shared fields flow through library, CLI, Code Mode, MCP, editor, and website only where the generated transport matrix advertises them. Host callbacks are library-only and never enter receipts. |
| One-off declarative style | inline `StyleSpec` or a left-to-right `StyleInput[]` stack | Safe palette, font, stroke/fill treatment, backdrop, and the other generated StyleSpec fields | JSON-safe and executable-code-free. This is the lowest-complexity custom Style path. |
| Named palette/look | `registerStyle`, `getStyle`, `knownStyleDescriptors`, compatibility aliases | Installs a versioned `palette:` or `look:` name backed by exactly the same `StyleSpec` accepted inline | In-process host registry. A CLI/MCP/server sees it only when that host installs the registration at startup; serialized requests cannot install code or mutate registries. Built-in Styles use this registry too. |
| Theme conversion | `fromShikiTheme` | Converts a Shiki-compatible editor theme into diagram colors | Pure library helper; the result is ordinary declarative color input. |
| Fonts and installed resources | `font`, Node PNG `fontDirs`/`loadSystemFonts`, browser `BrowserPngRasterizer`, `ResourceManifest`, and `agentic-mermaid/resources` → `NodeResourceResolver` | Selects a safe font stack, supplies host-dependent raster fonts, or verifies bounded installed bytes | Font family names do not install fonts. Browser callbacks and Node directories are trusted host inputs and remain outside serializable options/digests; manifests require path, size, media-type, digest, and licence evidence and never fall back to network access. |
| Graphical backend | `registerBackend`, `runBackendConformance`, `createMermaidRenderer({ backendPolicy })` | Serializes the typed Scene contract with a different drawing implementation | Trusted in-process host only. Registration must pass deterministic, semantic, well-formed, secure SVG smoke conformance. PNG support is inherited only through the canonical secured SVG raster path. Serializable styles cannot select arbitrary executable backends. |
| Diagram family | `registerFamily`, `parseRegisteredMermaid`, `projectPositionedView` | Adds a namespaced language with detection, parse/preservation, verification, layout, Scene/SVG, terminal, and discovery claims | Versioned `family:<owner/name>` descriptor with collision and evidence checks. Built-in-only unions stay closed; extension bodies use the open envelope. Remote transports gain the family only when their trusted host installs it. |
| Scene semantics | `SceneDoc`, typed connectors/markers/hit geometry, namespaced `SceneRole` | Lets a family/backend exchange identity, relationship, accessibility, geometry, and terminal-projection intent | This is a versioned typed contract, not a raw SVG hook. Unknown namespaced roles deliberately receive inert identity-only traits and cannot acquire core behavior by local-name collision. There is no public arbitrary primitive/trait mutation registry. |
| Browser PNG host adapter | `renderMermaidPNGInBrowserWithReceipt(..., rasterize)` | Supplies Canvas/OffscreenCanvas rasterization and reports font provenance | Trusted callback receives only the secured canonical SVG; the library re-applies the PNG color-profile gate and retains a comparable request receipt. |
| Identity and compatibility plumbing | `createExtensionIdentity`, `canonicalExtensionId`, `registerCompatibilityAlias` | Gives kind-specific registries stable names, versions, provenance, compatibility ranges, and time-bounded aliases | Low-level plumbing, not a stand-alone extension registry or rendering hook. Each kind-specific registry remains authoritative. |

There is currently no BrandPack registry, semantic-binding API, public role-trait
registration, arbitrary SVG/CSS hook, or Treatment hook. Those are Section B
decisions; B4 adds a Treatment seam only if a concrete effect cannot be expressed
as a primitive or backend.

## CLI

```bash
am render diagram.mmd --format svg > diagram.svg
am render diagram.mmd --format png --output diagram.png
am render diagram.mmd --format ascii > diagram.txt
am render diagram.mmd --format json --certificates > layout-with-routes.json
am verify diagram.mmd
am describe diagram.mmd --format facts
am mutate diagram.mmd --op '{"kind":"add_node","id":"Cache","label":"Cache"}' --json
am capabilities --json
am init-agent --dir . --json
```

PNG is single-input and requires `--output` so binary bytes are never accidentally printed to a terminal. `am init-agent` writes a non-clobbering agent-agnostic onboarding bundle (`AGENTS.md`, root `skills/`, and `.mcp.json`) into a consumer repo.

## MCP

The published package exposes Node-runnable bins: `am`, `agentic-mermaid`, and `agentic-mermaid-mcp`.

Local `agentic-mermaid-mcp` is Code Mode-first and exposes:

- `execute(code)` — primary Code Mode tool with global `mermaid.*` SDK.
- `describe_sdk({ family, detail })` — version-matched compact signatures or exact mutation fields for one family.
- `render_png` — narrow helper returning base64 PNG bytes, or managed file/URL artifacts via `output: "file"|"url"`; accepts `fontDirs`/`loadSystemFonts` and returns configuration/font-coverage warnings with every output mode.
- `describe` — narrow summary helper; pass `format: "facts"` for deterministic semantic fact lines.

Use Code Mode for multi-step parse/narrow/mutate/verify/serialize loops. Use `render_png` or host/library code for binary PNG output. The default transport is stdio; `agentic-mermaid-mcp --transport http --host 127.0.0.1 --port 3000` starts the HTTP/SSE transport. HTTP mode serves managed artifacts from `/artifacts/<name>` with MIME type, byte count, and SHA-256 metadata in tool responses. Non-loopback HTTP binding requires `--auth-token`; that bearer token protects `/rpc`, `/sse`, `/message`, and `/artifacts/*`.

A hosted Streamable HTTP endpoint also runs at `https://agentic-mermaid.dev/mcp`. It is MCP JSON-RPC only (not REST), stateless, public/unauthenticated, and capped at 64 KB inputs. Hosted tools are `execute`, `describe_sdk`, `render_svg`, `render_ascii`, `render_png`, `verify`, `describe`, `mutate`, and `build`; `describe_sdk` returns compact signatures or exact mutation fields for one family, hosted `execute` uses a Cloudflare Dynamic Worker isolate with no network, and hosted `render_png` returns base64 only. Prefer local CLI/library/MCP for sensitive diagrams, offline work, larger inputs, or file/URL PNG artifacts. See [`mcp-http-transport.md`](./mcp-http-transport.md) for JSON-RPC examples and option details.
