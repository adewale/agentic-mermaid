# Fonts in custom styles

A custom style chooses a font family; the environment that renders the
diagram supplies the actual face. The public `StyleSpec` deliberately keeps
those responsibilities separate:

```json
{
  "$schema": "https://agentic-mermaid.dev/schemas/style-spec.schema.json",
  "name": "acme-report",
  "font": "'Acme Sans', Inter, system-ui",
  "colors": {
    "bg": "#fffdf8",
    "fg": "#171512",
    "accent": "#1d4ed8"
  },
  "stroke": "crisp"
}
```

`font` is a CSS family name or family stack. It does not load a file, register
a browser `FontFace`, or tell the PNG rasterizer where to find one. This keeps
the same style usable across SVG and PNG while each output surface resolves
fonts in its own way.

For the rest of the Style model — inline specs, registration, stacking, and
validation — see [Authoring styles](./style-authoring.md).

## Quick recipe

Save the JSON above as `acme-report.style.json`. For an SVG that declares the
family without making an external font request:

```bash
am render diagram.mmd \
  --format svg \
  --style acme-report.style.json \
  --security strict \
  --output diagram.svg
```

For a PNG, point the local rasterizer at a directory containing the matching
font faces:

```bash
am render diagram.mmd \
  --format png \
  --style acme-report.style.json \
  --font-dirs ./fonts \
  --output diagram.png
```

The same workflow through the library is:

```ts
import { readFileSync, writeFileSync } from 'node:fs'
import {
  renderMermaidPNG,
  renderMermaidSVG,
  validateStyleSpec,
} from 'agentic-mermaid/agent'

const source = readFileSync('diagram.mmd', 'utf8')
const style = JSON.parse(readFileSync('acme-report.style.json', 'utf8'))
const problems = validateStyleSpec(style)
if (problems.length) throw new Error(problems.join('\n'))

const svg = renderMermaidSVG(source, {
  style,
  security: 'strict',
})
writeFileSync('diagram.svg', svg)

const png = renderMermaidPNG(source, {
  style,
  fontDirs: ['./fonts'],
})
writeFileSync('diagram.png', png)
```

## Which font value wins

For `renderMermaidSVG`, font selection follows this precedence, from strongest
to weakest:

1. The render call's explicit `font` option.
2. Mermaid `fontFamily` configuration.
3. Mermaid `themeVariables.fontFamily` configuration.
4. The resolved Style stack's `font` field.
5. The default, Inter.

`renderMermaidPNG` has no separate `font` option. Select its family through the
Style or Mermaid configuration in the source; `fontDirs` makes faces available
to the rasterizer but does not choose the family.

Within a Style stack, later entries win. For example, `[style, 'dracula']`
keeps the inline/file-loaded Style's font because `dracula` is a palette-only
Style; a later Style that defines `font` would replace it. A file's `name`
field does not register it automatically — call `registerStyle(style)` before
using that name in a library stack.

`validateStyleSpec` checks that `font` is a string. It cannot prove that the
family is installed, present under `fontDirs`, or available to a browser.

## Resolution by output surface

| Surface | Where the face comes from | Custom-font control |
|---|---|---|
| SVG library/CLI | Browser, viewing application, or host-page CSS | `font`, `embedFontImport`, `security` |
| PNG library/CLI | Bundled faces, `fontDirs`, optionally OS fonts | `fontDirs`, `loadSystemFonts` / `--system-fonts` |
| Live editor | Faces available to the editor page and browser | Font picker; no `fontDirs` |
| MCP `render_png` | Fonts built into that MCP runtime | No `fontDirs` input; use library/CLI for custom directories |
| ASCII, Unicode, JSON layout | Terminal/layout output has no font face | Style fonts do not apply |

### SVG

SVG output always declares the selected family through the root `--font` CSS
custom property and a `font-family` rule. The SVG renderer does not read
`fontDirs`.

By default, a single plain family name such as `Acme Sans` produces a Google
Fonts `@import`. Class and ER diagrams can also import JetBrains Mono for their
monospace labels. Set `embedFontImport: false`, or use `security: 'strict'`, to
omit all of those requests while keeping the family declaration:

```ts
const svg = renderMermaidSVG(source, {
  style: { font: 'Acme Sans' },
  embedFontImport: false,
})
```

CSS variable references and family stacks are declared as-is and do not
produce an import for the selected family:

```ts
renderMermaidSVG(source, {
  style: { font: "'Acme Sans', Inter, system-ui" },
})

renderMermaidSVG(source, {
  font: 'var(--brand-font, Inter)',
})
```

The class/ER JetBrains Mono import still applies unless `embedFontImport` is
false or strict security is enabled.

If the selected family is unavailable when the SVG is viewed, normal CSS
fallback applies. A family stack makes that fallback explicit.

Raw SVG declares the family through `var(--font, ...)`. Some static SVG
rasterizers, including resvg and librsvg, do not resolve CSS custom properties.
Use `renderMermaidPNG` for Agentic Mermaid's built-in workaround, or resolve
the font variable to a concrete `font-family` before feeding raw SVG to another
static rasterizer.

### Host-page and browser fonts

An inline SVG can use a face registered by its host document. A stylesheet can
map an installed face:

```css
@font-face {
  font-family: "Acme Sans";
  src: local("Acme Sans Regular"), local("AcmeSans-Regular");
  font-weight: 400;
}
```

Browser applications can also register bytes selected by the user:

```ts
const face = new FontFace('Acme Sans', await file.arrayBuffer(), {
  weight: '400',
})
await face.load()
document.fonts.add(face)
await document.fonts.load('400 14px "Acme Sans"')
```

Register one `FontFace` or `@font-face` rule per required weight, or accept the
browser's synthesized/fallback face for weights that are missing.

Register the face in the same document that displays the SVG, and wait for it
before displaying or raster-capturing the result. A raw SVG export still only
declares the family; it does not serialize a dynamically registered `FontFace`.
The public live editor can use faces already available to its page/browser,
but it has no filesystem `fontDirs` option or arbitrary font-file input.

### PNG

`renderMermaidPNG` renders offline with `@resvg/resvg-js`. It loads:

1. The bundled Inter faces used by the text-metrics model.
2. DejaVu Sans as a per-glyph fallback for symbols Inter lacks.
3. The bundled faces referenced by built-in Styles: Caveat, EB Garamond,
   Architects Daughter, and Share Tech Mono.
4. Any directories supplied through `fontDirs`.
5. OS-installed fonts only when `loadSystemFonts: true` is requested.

The CLI equivalents are `--font-dirs <dir[,dir...]>` and `--system-fonts`.
Prefer a dedicated `fontDirs` directory when reproducible output matters.
System-font loading makes the result depend on the machine's installed faces.

The family stored inside the font file must match the intended family token in
the Style's `font` value — normally the first family in its stack. Supply the
weights the diagram uses; Agentic Mermaid commonly emits 400, 500, 600, and
700. If an unbundled requested family cannot be resolved, PNG rasterization
uses Inter, with DejaVu available for per-glyph fallback.

## Diagnostics and layout limits

`PNG_FONT_COVERAGE` warns when no loaded face contains a character, such as a
CJK or emoji code point. It is a glyph-coverage check, not a family-presence
check. If `Acme Sans` is missing but Inter covers every Latin character, the
render can fall back without a coverage warning. Confirm custom-family output
visually or with a font-specific render fixture.

Diagram geometry uses an Inter-compatible proportional text estimate. Loading
a custom face changes the painted glyphs, not that layout model. A materially
wider face can therefore overflow a box even when it loaded correctly. Test
long labels across the diagram families the Style targets, and give brand
Styles enough padding for their chosen face.

## Troubleshooting

**The custom family is not visible in PNG.** Check the font's internal family
name, include the directory through `fontDirs`, supply the required weights,
and make sure Mermaid `fontFamily` configuration in the source is not
overriding the Style.

**The SVG requests a font from the network.** Render with
`security: 'strict'` or `embedFontImport: false`.

**The SVG looks different in another viewer.** The other environment did not
resolve the same family or selected a different fallback. Use a deliberate
family stack and make the required face available to that viewer.

**PNG warns about CJK or emoji.** Add a face covering those code points through
`fontDirs`, or opt into `loadSystemFonts` when machine-dependent output is
acceptable.

## Related documentation

- [Authoring styles](./style-authoring.md) — Style fields, stacks, registration,
  validation, and the quality rubric.
- [Custom style cookbook](./custom-style-cookbook.md) — complete JSON examples
  and screenshots.
- [API reference](./api.md) — `RenderOptions` and `PngOptions`.
- [Security posture](../SECURITY.md) — strict SVG and external-reference
  guarantees.
- [PNG determinism](./quality.md#png-determinism) — bundled fonts and the
  reproducibility tradeoff of system fonts.
- [Bundled font inventory](../assets/fonts/FONT-LICENSES.md) — the faces shipped
  with the package.
