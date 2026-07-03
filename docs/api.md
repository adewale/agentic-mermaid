# API reference

Agentic Mermaid exposes two library surfaces:

- `agentic-mermaid` — renderer-focused public API for SVG and ASCII/Unicode output.
- `agentic-mermaid/agent` — agent-native API with parse/narrow/mutate/verify/serialize plus SVG, PNG, and ASCII output helpers.

Use `agentic-mermaid/agent` when you want one import path for agents.

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

`PngOptions`:

| Option | Type | Default | Meaning |
|---|---|---:|---|
| `scale` | `number` | `2` | Zoom multiplier when `fitTo` is not set. |
| `background` | `string` | `'white'` | PNG background color. |
| `fitTo` | `{ width?: number; height?: number }` | — | Constrain output to a width or height. |

PNG rasterization uses offline `@resvg/resvg-js` with bundled DejaVu fonts for deterministic same-machine output.

### ASCII / Unicode

```ts
import { renderMermaidASCII } from 'agentic-mermaid/agent'

const unicode = renderMermaidASCII(`flowchart LR
  A --> B`)
const ascii = renderMermaidASCII(`flowchart LR
  A --> B`, { useAscii: true })
```

`renderMermaidASCII(input, options?)` accepts a Mermaid source string or `ValidDiagram` and returns terminal text.

`AsciiRenderOptions`:

| Option | Type | Default | Meaning |
|---|---|---:|---|
| `useAscii` | `boolean` | `false` | Use 7-bit ASCII instead of Unicode box drawing. |
| `paddingX` | `number` | `5` | Horizontal spacing. |
| `paddingY` | `number` | `5` | Vertical spacing. |
| `boxBorderPadding` | `number` | `1` | Inner box padding. |
| `colorMode` | `string` | `'auto'` | `'none'`, `'auto'`, `'ansi16'`, `'ansi256'`, `'truecolor'`, or `'html'`. |
| `theme` | `Partial<AsciiTheme>` | — | Override ASCII colors. |
| `mermaidConfig` | `MermaidRuntimeConfig` | — | Mermaid-style runtime config. |
| `ganttToday` | `string` | unset | Explicit "today" for the Gantt `todayMarker`; same deterministic clock behavior as SVG. |

## SVG render options

`renderMermaidSVG` accepts `RenderOptions`:

| Option | Type | Default | Meaning |
|---|---|---:|---|
| `bg` | `string` | `#FFFFFF` | Background color or CSS variable. |
| `fg` | `string` | `#27272A` | Foreground color or CSS variable. |
| `line` | `string?` | — | Edge/connector color. |
| `accent` | `string?` | — | Arrow heads and highlights. |
| `muted` | `string?` | — | Secondary text/labels. |
| `surface` | `string?` | — | Node fill tint. |
| `border` | `string?` | — | Node stroke color. |
| `font` | `string` | `Inter` | Font family. |
| `style` | `string \| StyleSpec \| (string \| StyleSpec)[]` | — | How the diagram looks: a registered style name (`'hand-drawn'`, `'tufte'`, any theme palette like `'dracula'`), an inline `StyleSpec`, or a stack merged left→right (`['hand-drawn', 'dracula']`). A role-overrides-only object is a valid style and keeps the byte-identical crisp path. See `docs/style-authoring.md`. |
| `seed` | `number` | `0` | Deterministic re-roll for stochastic styles — shuffles ink wobble, never layout. |
| `transparent` | `boolean` | `false` | Transparent SVG background. |
| `padding` | `number` | `40` | Canvas padding. |
| `nodeSpacing` | `number` | `24` | Horizontal sibling spacing. |
| `layerSpacing` | `number` | `40` | Vertical layer spacing. |
| `componentSpacing` | `number` | `24` | Disconnected component spacing. |
| `interactive` | `boolean` | `false` | XY chart hover tooltips. |
| `shadow` | `boolean` | `false` | Explicit drop shadows. |
| `mermaidConfig` | `MermaidRuntimeConfig` | — | Runtime Mermaid config. |
| `embedFontImport` | `boolean` | `true` | Include Google Fonts `@import`; set false for offline SVG/PNG. |
| `compact` | `boolean` | `false` | Compact SVG output while preserving agent hooks. |
| `idPrefix` | `string` | `''` | Namespace generated SVG def ids. |
| `security` | `'default' | 'strict'` | `'default'` | `strict` disables external-fetch references. |
| `ganttToday` | `string` | unset | Explicit "today" for the Gantt `todayMarker` (date in the diagram's `dateFormat` or ISO `YYYY-MM-DD`). Gantt never reads the wall clock; without this the marker is not drawn. |

A `StyleSpec` may also carry per-role overrides (a role-only object is
itself a valid style):

| Role | Fields |
|---|---|
| `style.text` | `fontSize`, `fontWeight`, `letterSpacing` |
| `style.node` | `fontSize`, `fontWeight`, `letterSpacing`, `paddingX`, `paddingY`, `cornerRadius`, `lineWidth` |
| `style.edge` | `fontSize`, `fontWeight`, `letterSpacing`, `lineWidth`, `bendRadius` |
| `style.group` | `fontSize`, `fontWeight`, `letterSpacing`, `fontFamily`, `textTransform`, `paddingX`, `paddingY`, `cornerRadius`, `borderColor`, `lineWidth` |

## Agent edit API

```ts
import {
  parseMermaid,
  asFlowchart,
  mutate,
  verifyMermaid,
  analyzeMermaid,
  analyzeMermaidSource,
  serializeMermaid,
} from 'agentic-mermaid/agent'
```

Core functions:

| Function | Purpose |
|---|---|
| `parseMermaid(source)` | Parse Mermaid source to `Result<ValidDiagram, ParseError[]>`. |
| `asFlowchart(d)` / `asState(d)` / `asSequence(d)` / `asTimeline(d)` / `asClass(d)` / `asEr(d)` / `asJourney(d)` / `asArchitecture(d)` / `asXyChart(d)` / `asPie(d)` / `asQuadrant(d)` / `asGantt(d)` | Narrow to a mutable family or return `null`. |
| `mutate(d, op)` | Apply a kind-discriminated typed mutation. |
| `verifyMermaid(d)` | Return structural warnings and layout evidence. |
| `analyzeMermaid(d)` / `analyzeMermaidSource(source)` | Return deterministic non-rendering facts: feedback edges, source-only action records, and Gantt critical-path/slack summary when available. |
| `serializeMermaid(d)` | Emit source only after verifying. |
| `layoutMermaid(d)` | Return layout JSON for quality/inspection; `layoutMermaid(d, { debug: true })` includes graph route certificates, family edge-route certificates (class/ER/architecture/sequence), region-containment certificates (timeline/charts), and V1 region/action sidecars. Edge certificates include exact ports plus side/slot/role port assignments where applicable. |
| `measureQuality(layout)` / `checkQuality(layout)` | Perceptual quality metrics. |
| `describeMermaid(d, { format })` | Prose or AX-tree summary. |

Typed mutation families:

| Family | Narrower | Common ops |
|---|---|---|
| Flowchart | `asFlowchart` | `add_node`, `remove_node`, `rename_node`, `set_label`, `add_edge`, `remove_edge` |
| State | `asState` | `add_state`, `remove_state`, `rename_state`, `set_state_label`, `add_transition`, `remove_transition`, `set_transition_label`, `make_composite` |
| Sequence | `asSequence` | `add_participant`, `remove_participant`, `add_message`, `remove_message`, `set_message_text` |
| Timeline | `asTimeline` | `set_title`, `add_section`, `add_period`, `add_event`, remove/set variants |
| Class | `asClass` | `add_class`, `remove_class`, `rename_class`, `add_member`, `add_relation`, notes |
| ER | `asEr` | `add_entity`, `remove_entity`, `rename_entity`, `add_attribute`, `add_relation` |
| Journey | `asJourney` | `set_title`, `add_section`, `add_task`, `set_task_score`, `set_task_actors`, `rename_actor`, … |
| XY chart | `asXyChart` | `set_title`, `set_x_axis`, `set_y_axis`, `add_series`, `set_series_values`, `reorder_series`, … |
| Architecture | `asArchitecture` | `add_service`, `move_service`, `add_group`, `add_edge`, `rename_service`, … |
| Pie | `asPie` | `set_title`, `set_show_data`, `add_slice`, `remove_slice`, `rename_slice`, `set_slice_value`, `reorder_slice` |
| Quadrant | `asQuadrant` | `set_title`, `set_axis_labels`, `set_quadrant_label`, `add_point`, `remove_point`, `move_point`, `rename_point` |
| Gantt | `asGantt` | `set_title`, `add_section`, `rename_section`, `add_task`, `set_task_status`, `set_task_dates`, … |

Opaque fallback bodies (any unmodeled syntax) are source-level-only: edit source deliberately, then parse and verify again.

## CLI

```bash
am render diagram.mmd --format svg > diagram.svg
am render diagram.mmd --format png --output diagram.png
am render diagram.mmd --format ascii > diagram.txt
am render diagram.mmd --format json --certificates > layout-with-routes.json
am verify diagram.mmd
am mutate diagram.mmd --op '{"kind":"add_node","id":"Cache","label":"Cache"}' --json
am capabilities --json
am init-agent --dir . --json
```

PNG is single-input and requires `--output` so binary bytes are never accidentally printed to a terminal. `am init-agent` writes a non-clobbering agent-agnostic onboarding bundle (`AGENTS.md`, root `skills/`, and `.mcp.json`) into a consumer repo.

## MCP

The published package exposes Node-runnable bins: `am`, `agentic-mermaid`, and `agentic-mermaid-mcp`.

`agentic-mermaid-mcp` exposes:

- `execute(code)` — primary Code Mode tool with global `mermaid.*` SDK.
- `render_png` — narrow helper returning base64 PNG bytes, or managed file/URL artifacts via `output: "file"|"url"`.
- `describe` — narrow summary helper.

Use Code Mode for multi-step parse/narrow/mutate/verify/serialize loops. Use `render_png` or host/library code for binary PNG output. The default transport is stdio; `agentic-mermaid-mcp --transport http --host 127.0.0.1 --port 3000` starts the HTTP/SSE transport. HTTP mode serves managed artifacts from `/artifacts/<name>` with MIME type, byte count, and SHA-256 metadata in tool responses. Non-loopback HTTP binding requires `--auth-token`. See [`mcp-http-transport.md`](./mcp-http-transport.md) for JSON-RPC examples and option details.
