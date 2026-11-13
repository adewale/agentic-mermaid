# Getting started

Render Mermaid source to SVG, PNG or terminal text. The examples below use
`agentic-mermaid/agent`, one entry for rendering and typed editing in Node 22+
or Bun 1.4.0+. Browser rendering has a separate asynchronous entry, shown below.

For editing operations, continue with the [editing cookbook](agent-api-cookbook.md).

## Install

```bash
npm install agentic-mermaid
# or: bun add agentic-mermaid / pnpm add agentic-mermaid
```

### Repository development

For repository development, install from source:

```bash
git clone https://github.com/adewale/agentic-mermaid
cd agentic-mermaid && bun install && bun run build
```

## Render to SVG

`renderMermaidSVG` takes Mermaid source and returns a self-contained SVG string.
It supports every registered diagram family (including flowchart, sequence,
class, ER, state, Gantt, Mindmap, and GitGraph) — just pass the source.

```ts
import { writeFileSync } from 'node:fs'
import { renderMermaidSVG } from 'agentic-mermaid/agent'

const svg = renderMermaidSVG(`flowchart TD
  Start --> Stop`)

writeFileSync('diagram.svg', svg)
```

## Render to PNG

PNG rendering uses a bundled native rasterizer, so `renderMermaidPNG` lives on the
`agentic-mermaid/agent` entry point. It returns a `Uint8Array` of PNG bytes.

```ts
import { writeFileSync } from 'node:fs'
import { renderMermaidPNG } from 'agentic-mermaid/agent'

const png = renderMermaidPNG(`flowchart TD
  Start --> Stop`, {
  fitTo: { width: 1200 }, // constrain output width (optional)
  background: '#ffffff',  // PNG has no transparency by default
})

writeFileSync('diagram.png', png)
```

Portable PNG controls are `scale` (default `2`, for retina), `background`,
the mutually exclusive `fitTo: { width? }` / `fitTo: { height? }`, and
`minLabelPx` (legibility floor, default `9`; `0` disables the
`BELOW_READABLE_SIZE` warning); the same controls are available through the
browser adapter, CLI, and local/hosted MCP.
Node/Bun additionally accepts trusted-host `fontDirs`, `loadSystemFonts`, and
the library-only `onWarning` callback.

## Render to ASCII / Unicode

Great for terminals, code reviews, and plain-text logs. Unicode box-drawing is the
default; pass `{ useAscii: true }` for pure ASCII.

```ts
import { renderMermaidASCII } from 'agentic-mermaid/agent'

const unicode = renderMermaidASCII('flowchart LR\n  A --> B')
const ascii = renderMermaidASCII('flowchart LR\n  A --> B', { useAscii: true })

console.log(unicode)
```

See [`ascii.md`](./ascii.md) for supported families and cell-to-region metadata.

## Theming

Build a palette from two colors, or select one discovered through
`knownStyleDescriptors()` or `am styles`. Colors are applied
as CSS variables, so the SVG stays self-contained.

```ts
import { renderMermaidSVG } from 'agentic-mermaid/agent'

// Two-color palette
const dark = renderMermaidSVG('flowchart TD\n  A --> B', {
  bg: '#1a1b26',
  fg: '#a9b1d6',
})

// A built-in palette (zinc-light, tokyo-night, nord, dracula, catppuccin-mocha, …)
const themed = renderMermaidSVG('flowchart TD\n  A --> B', {
  style: 'tokyo-night',
})

// Transparent background, for embedding on any page
const transparent = renderMermaidSVG('flowchart TD\n  A --> B', {
  transparent: true,
})
```

Common `RenderOptions`: `bg`, `fg`, `font`, `transparent`, and `security`. See
[`theming.md`](./theming.md) for custom Palettes and Shiki/VS Code theme import.

### Untrusted input

If the Mermaid source is not yours, render with `security: 'strict'`. It disables
the web-font `@import` and rejects output with external-fetch references. See
[the security boundary](../SECURITY.md) for the guarantees and limits.

```ts
import { renderMermaidSVG } from 'agentic-mermaid/agent'

const userProvidedSource = 'flowchart TD\n  A --> B' // replace with input from your application
const safe = renderMermaidSVG(userProvidedSource, { security: 'strict' })
```

## In the browser and in frameworks

Use the browser ESM entry in client components. It avoids the Node/native entry
and loads only the selected diagram family:

```ts
import { renderMermaidSVGAsync } from 'agentic-mermaid/browser/lazy'

const svg = await renderMermaidSVGAsync('flowchart LR\n  A --> B', {
  security: 'strict',
  idPrefix: 'example-diagram', // use a unique prefix per inline diagram
})
```

The returned string is not a DOM-insertion API. Follow [`browser.md`](./browser.md)
for parsed-XML insertion and CSP policy, or the complete [`React component`](./react.md)
for cancellation, unique IDs, error handling and live theme switching. For a
server component or build step, the synchronous `agentic-mermaid` entry remains
the simpler choice.

## Other runtimes and advanced imports

| Runtime or task | Entry |
| --- | --- |
| Node/Bun rendering and typed editing, including native PNG | `agentic-mermaid/agent` |
| Browser rendering with deferred family loading | `agentic-mermaid/browser/lazy` |
| Typed editing in a browser or Worker, without native PNG | `agentic-mermaid/agent/core` |
| Style utilities such as `fromShikiTheme`, or renderer host adapters | `agentic-mermaid` |

The root entry remains supported. The agent entry re-exports the synchronous
renderers but does not include every root utility. See the
[API reference](api.md) for the full exports and the [browser guide](browser.md)
for runtime-specific integration.

## Prefer the command line?

The same renderers ship as the `am` CLI — no code required. After the local
install above, create a source file:

```bash
cat > diagram.mmd <<'MMD'
flowchart LR
  A --> B --> C
MMD
```

Use the package runner so the command resolves without a global install:

```bash
npx --no-install agentic-mermaid render diagram.mmd --format svg
npx --no-install agentic-mermaid render diagram.mmd --format png --output diagram.png
npx --no-install agentic-mermaid render diagram.mmd --format ascii
```

Run `npx --no-install agentic-mermaid --help` for the full command set. Inside
an npm script, the shorter `am …` binary name is available automatically.

## Next steps

- [`diagram-families.md`](./diagram-families.md) — every supported family with examples.
- [`theming.md`](./theming.md) — custom themes and Shiki import.
- [`api.md`](./api.md) — the full option and function reference.
- [`agent-api-cookbook.md`](./agent-api-cookbook.md) — typed editing (parse → narrow → mutate → verify → serialize).
