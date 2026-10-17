# ASCII and terminal output

Agentic Mermaid can render Mermaid diagrams as terminal text. Unicode box drawing is the default; 7-bit ASCII is available for logs, email, CI output, and constrained terminals.

Built-in terminal families use a [shared terminal compositor](https://github.com/adewale/agentic-mermaid/blob/main/docs/project/terminal-composition.md)
for owned cell geometry. ASCII/Unicode alphabet selection and plain, ANSI or
terminal HTML encoding derive from that drawing. SVG/PNG retain separate pixel
geometry; family placement and routing retain their own constraints.

## Quick start

```ts
import { renderMermaidASCII } from 'agentic-mermaid/agent'

const unicode = renderMermaidASCII(`flowchart LR
  API --> DB`)
const ascii = renderMermaidASCII(`flowchart LR
  API --> DB`, { useAscii: true })
```

CLI:

```bash
am render diagram.mmd --format ascii
am render diagram.mmd --format unicode
```

## Options

`AsciiRenderOptions` extends the canonical shared `RenderOptions` used by SVG
and PNG, so Style stacks, colors, font choice, security policy, and other
shared request fields enter through the same boundary. Call
`sharedRenderOptionsJsonSchema()` for the machine-readable shared field set.
The options below are terminal-specific.

```ts
renderMermaidASCII(source, {
  useAscii: true,
  paddingX: 4,
  paddingY: 2,
  boxBorderPadding: 1,
  colorMode: 'none',
  targetWidth: 80,
})
```

| Option | Type | Default | Meaning |
|---|---|---:|---|
| `useAscii` | `boolean` | `false` | Use `+`, `-`, `|` instead of Unicode box drawing. |
| `paddingX` | `number` | `5` | Horizontal spacing between boxes. |
| `paddingY` | `number` | `5` | Vertical spacing between layers. |
| `boxBorderPadding` | `number` | `1` | Padding inside node boxes. |
| `colorMode` | `string` | `'auto'` | `'none'`, `'auto'`, `'ansi16'`, `'ansi256'`, `'truecolor'`, or `'html'`. |
| `theme` | `Partial<AsciiTheme>` | — | Override terminal colors. |
| `maxWidth` | `number` | — | Deprecated best-effort label wrapping; the canvas may exceed it. |
| `targetWidth` | `number` | — | Hard maximum in terminal display cells; impossible geometry throws `AsciiWidthError` with code `ASCII_TARGET_WIDTH_IMPOSSIBLE`. |

HTML is an escaped terminal projection, selected programmatically with
`renderMermaidASCII(source, { colorMode: 'html' })`. It is not a standalone
`am render --format` value; CLI discovery advertises only directly supported
artifact formats.

## ASCII with metadata

Agents and TUIs can use `renderMermaidASCIIWithMeta` to map terminal cells back to diagram regions:

```ts
import { renderMermaidASCIIWithMeta } from 'agentic-mermaid/agent'

const { ascii, regions, actions, warnings, routeParity } = renderMermaidASCIIWithMeta(source)
```

For built-in native terminal output, `regions` comes from the drawing retained
by that render. `canvasRow`, column bounds and `rowSpan` describe a primary text
occurrence or an explicitly allocated container/route rectangle. That rectangle
can include empty cells. Use `ownedCellSpans` for exact occupied cells, including
authored spaces and wide-character continuations; `occludedCellSpans`, when
present, describes relationship coverage hidden behind opaque marks. Repeated
labels retain separate element identities, and parent references include
`parentId` and `parentKind`. These fields support cell-based hit testing without
searching the rendered label text.

`projectedText` preserves deliberately empty rows of its primary logical text
occurrence, including leading and trailing rows. Separate occurrences do not
acquire newlines merely because they are far apart on the canvas. Empty rows
retain provenance without inventing occupied cells.

Family parsing retains authored identities and endpoints. Shared display
preparation neutralizes C0/C1 controls before pixel or cell fitting, while typed
IDs, connector references and action targets remain exact. XML attribute
serialization separately preserves identity whitespace. Sankey's CSV parser
receives physical authored rows, including blank rows inside quoted labels.

`actions` contains inert action metadata only; a host decides whether and how to
handle it. `routeParity` records route intent and projection limits; it does not
certify identical SVG/terminal paths or guarantee that every family layout can
fit. Terminal drawing does not consume SVG route certificates directly.

Inspect `warnings` for refused geometry and feature-specific projection losses.
An edge region with ports is not evidence that its label was painted: check its
owned/projected text and any collision diagnostic. Compound graph placement
keeps child containers atomic within their parent; parallel/reciprocal allocation
reserves physical ports and complete labels before routing. Bounded allocation
can still fail, and a diagnostic must not be treated as a successful route.
String-only extension hooks report `TERMINAL_OWNERSHIP_UNAVAILABLE`; metadata
does not invent regions from their text.

## Reversing simple flowcharts

```ts
import { asciiToMermaid } from 'agentic-mermaid/agent'

const result = asciiToMermaid(ascii)
if (result.ok) {
  const source = result.value // reconstructed Mermaid source
}
```

`asciiToMermaid` returns a `Result<string, ParseError[]>`: `result.value` holds the
Mermaid source on success, and `result.error` lists parse errors (e.g. `NO_BOXES`)
otherwise. This is best-effort and lossy. It is useful for simple linear flowcharts,
not for reconstructing arbitrary Mermaid source.

## Supported families

Family support is registry-driven rather than maintained as a second list in
this guide. Run `am capabilities --json` for live discovery.

Style appearance is projected to terminal colors and glyphs. Use a
receipt-bearing render API to compare its `appearanceDigest` with graphical
outputs, and inspect projection diagnostics when a graphical feature has no
terminal equivalent. `colorMode: 'auto'` disables color for non-TTY output,
`TERM=dumb`, and `NO_COLOR` before considering color-depth hints.

PNG output is separate: use `renderMermaidPNG(source)` or `am render --format png --output file.png` when a raster artifact is required.

## XY charts

XY charts render to a compact terminal plot:

```ts
const chart = renderMermaidASCII(`xychart-beta
  title "Latency"
  x-axis [p50, p95, p99]
  y-axis "ms" 0 --> 500
  line [50, 180, 420]`)
```

Use SVG or PNG for publication-quality chart artifacts; use ASCII/Unicode for terminal summaries and agent-visible evidence.
