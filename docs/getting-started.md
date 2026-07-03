# Getting started (library)

A 5-minute guide for using `agentic-mermaid` as a plain rendering library: turn a
Mermaid string into **SVG**, **PNG**, or **ASCII/Unicode**. No agents, no server,
no browser — every function below runs synchronously in Node, Bun, or the browser.

> Editing diagrams with the typed parse → mutate → verify → serialize API is a
> separate surface — see the [agent API cookbook](./agent-api-cookbook.md). You do
> not need any of that just to render.

## Install

The npm package is not yet published — install from source for now:

```bash
git clone https://github.com/adewale/beautiful-mermaid
cd beautiful-mermaid && bun install && bun run build
```

Once published, install it directly (the import paths below are unchanged):

```bash
npm install agentic-mermaid
# or: bun add agentic-mermaid / pnpm add agentic-mermaid
```

## Render to SVG

`renderMermaidSVG` takes Mermaid source and returns a self-contained SVG string.
It supports all 12 diagram families (flowchart, sequence, class, ER, state, gantt,
pie, …) — just pass the source.

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

`PngOptions`: `scale` (default `2`, for retina), `background`, and
`fitTo: { width?, height? }`.

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

Theme from two colors, or spread one of the 21 built-in themes. Colors are applied
as CSS variables, so the SVG stays self-contained.

```ts
import { renderMermaidSVG, THEMES } from 'agentic-mermaid'

// Two-color theme
const dark = renderMermaidSVG('flowchart TD\n  A --> B', {
  bg: '#1a1b26',
  fg: '#a9b1d6',
})

// A built-in theme (zinc-light, tokyo-night, nord, dracula, catppuccin-mocha, …)
const themed = renderMermaidSVG('flowchart TD\n  A --> B', {
  ...THEMES['tokyo-night'],
})

// Transparent background, for embedding on any page
const transparent = renderMermaidSVG('flowchart TD\n  A --> B', {
  transparent: true,
})
```

Common `RenderOptions`: `bg`, `fg`, `font`, `transparent`, and `security`. See
[`theming.md`](./theming.md) for custom themes and Shiki/VS Code theme import.

### Untrusted input

If the Mermaid source is not yours, render with `security: 'strict'`. It disables
the web-font `@import` and strips any external-fetch references from the output, so
the SVG cannot phone home.

```ts
import { renderMermaidSVG } from 'agentic-mermaid'

const safe = renderMermaidSVG(userProvidedSource, { security: 'strict' })
```

## In the browser and in frameworks

`renderMermaidSVG` is synchronous and needs no DOM, so you can render during a
component's render pass and drop the string straight into the markup. In React,
memoize it to avoid re-rendering on every paint:

```tsx
import { useMemo } from 'react'
import { renderMermaidSVG } from 'agentic-mermaid'

function Diagram({ code }: { code: string }) {
  const svg = useMemo(() => renderMermaidSVG(code), [code])
  return <div dangerouslySetInnerHTML={{ __html: svg }} />
}
```

See [`react.md`](./react.md) for the zero-flash, live-theme-switching setup.

## Which import path?

| You want | Import from |
|---|---|
| SVG | `agentic-mermaid` |
| ASCII / Unicode | `agentic-mermaid` |
| PNG (native rasterizer) | `agentic-mermaid/agent` |
| Themes (`THEMES`, `fromShikiTheme`) | `agentic-mermaid` |
| Everything in one path | `agentic-mermaid/agent` |
| Typed editing (parse/mutate/verify) | `agentic-mermaid/agent` |

`agentic-mermaid/agent` re-exports the renderers too, so if you would rather use a
single import path for all formats, import everything from there.

## Prefer the command line?

The same renderers ship as the `am` CLI — no code required:

```bash
am render diagram.mmd --format svg
am render diagram.mmd --format png --output diagram.png
am render diagram.mmd --ascii
```

Run `am --help` for the full command set.

## Next steps

- [`diagram-families.md`](./diagram-families.md) — every supported family with examples.
- [`theming.md`](./theming.md) — custom themes and Shiki import.
- [`api.md`](./api.md) — the full option and function reference.
- [`agent-api-cookbook.md`](./agent-api-cookbook.md) — typed editing (parse → mutate → verify → serialize).
