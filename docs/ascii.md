# ASCII and terminal output

Agentic Mermaid can render Mermaid diagrams as terminal text. Unicode box drawing is the default; 7-bit ASCII is available for logs, email, CI output, and constrained terminals.

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

```ts
renderMermaidASCII(source, {
  useAscii: true,
  paddingX: 4,
  paddingY: 2,
  boxBorderPadding: 1,
  colorMode: 'none',
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
| `mermaidConfig` | `MermaidRuntimeConfig` | — | Mermaid-style runtime config. |

## ASCII with metadata

Agents and TUIs can use `renderMermaidASCIIWithMeta` to map terminal cells back to diagram regions:

```ts
import { renderMermaidASCIIWithMeta } from 'agentic-mermaid/agent'

const { ascii, regions } = renderMermaidASCIIWithMeta(source)
```

`regions` includes boxes, labels, and other interactive spans suitable for click mapping.

## Reversing simple flowcharts

```ts
import { asciiToMermaid } from 'agentic-mermaid/agent'

const source = asciiToMermaid(ascii)
```

This is best-effort and lossy. It is useful for simple linear flowcharts, not for reconstructing arbitrary Mermaid source.

## Supported families

ASCII/Unicode output is available from the public entrypoints for:

- flowchart/state
- sequence
- class
- ER
- timeline
- journey
- XY chart
- architecture

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
