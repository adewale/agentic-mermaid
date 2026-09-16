# Getting started (library)

A 5-minute guide for using `agentic-mermaid` as a plain rendering library: turn a
Mermaid string into **SVG**, **PNG**, or **ASCII/Unicode**. The server examples
below run synchronously in Node or Bun; browser clients use the asynchronous ESM
entry shown later.

> Editing diagrams with the typed parse → mutate → verify → serialize API is a
> separate surface — see the [agent API cookbook](./agent-api-cookbook.md). You do
> not need any of that just to render.

## Install

```bash
npm install agentic-mermaid
# or: bun add agentic-mermaid / pnpm add agentic-mermaid
```

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
import { renderMermaidSVG } from 'agentic-mermaid'

const svg = renderMermaidSVG(`flowchart TD
  Start --> Stop`)

console.log(svg) // "<svg ...>...</svg>"
```

Write it to a file in Node/Bun:

```ts
import { writeFileSync } from 'node:fs'
import { renderMermaidSVG } from 'agentic-mermaid'

writeFileSync('diagram.svg', renderMermaidSVG('flowchart LR\n  A --> B --> C'))
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

Portable PNG controls are `scale` (default `2`, for retina), `background`, and
the mutually exclusive `fitTo: { width? }` / `fitTo: { height? }`; the same
controls are available through the browser adapter, CLI, and local/hosted MCP.
Node/Bun additionally accepts trusted-host `fontDirs`, `loadSystemFonts`, and
the library-only `onWarning` callback.

## Render to ASCII / Unicode

Great for terminals, code reviews, and plain-text logs. Unicode box-drawing is the
default; pass `{ useAscii: true }` for pure ASCII.

```ts
import { renderMermaidASCII } from 'agentic-mermaid'

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
import { renderMermaidSVG } from 'agentic-mermaid'

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
the web-font `@import` and strips any external-fetch references from the output, so
the SVG cannot phone home.

```ts
import { renderMermaidSVG } from 'agentic-mermaid'

const safe = renderMermaidSVG(userProvidedSource, { security: 'strict' })
```

## In the browser and in frameworks

Use the browser ESM entry in client components. It avoids the Node/native entry
and loads only the selected diagram family:

```tsx
import { useEffect, useState } from 'react'
import { renderMermaidSVGAsync } from 'agentic-mermaid/browser/lazy'

function Diagram({ code }: { code: string }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    setSvg('')
    setError('')
    renderMermaidSVGAsync(code, { security: 'strict' }).then(
      result => {
        if (current) setSvg(result)
      },
      cause => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause))
      },
    )
    return () => { current = false }
  }, [code])
  if (error) return <pre role="alert">{error}</pre>
  if (!svg) return <div aria-busy="true" />
  return <div dangerouslySetInnerHTML={{ __html: svg }} />
}
```

See [`react.md`](./react.md) for error handling and live theme switching. For a
server component or build step, the synchronous `agentic-mermaid` entry remains
the simpler choice.

## Which import path?

| You want | Import from |
|---|---|
| SVG (Node/Bun, server, or build step) | `agentic-mermaid` |
| SVG (browser client bundle) | `agentic-mermaid/browser/lazy` |
| ASCII / Unicode | `agentic-mermaid` |
| PNG (native rasterizer) | `agentic-mermaid/agent` |
| Palettes (`knownStyleDescriptors`, `fromShikiTheme`) | `agentic-mermaid` |
| Everything in one path (Node/Bun) | `agentic-mermaid/agent` |
| Typed editing (Node/Bun) | `agentic-mermaid/agent` |
| Typed editing (browser/workerd) | `agentic-mermaid/agent/core` |

`agentic-mermaid/agent` re-exports the renderers too, so Node/Bun applications
can use it as one import path for all formats. Browser and workerd code should
use `agentic-mermaid/agent/core`, which excludes the native PNG implementation.

## Prefer the command line?

The same renderers ship as the `am` CLI — no code required. After the local
install above, use the package runner so the command resolves without a global
install:

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
- [`agent-api-cookbook.md`](./agent-api-cookbook.md) — typed editing (parse → mutate → verify → serialize).
