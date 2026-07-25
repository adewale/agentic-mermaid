# Browser and static sites

Two supported ways to get a diagram onto a web page. Pick by one question: **is
the diagram source known before the page is served?**

| Your case | Use | JS shipped |
|---|---|---|
| Source is fixed at publish time — blog post, docs page, README | [Pre-render at build time](#pre-render-at-build-time) | none |
| Source is authored or edited in the page — editor, playground, user input | [Browser bundle](#browser-bundle) | ~873 KB gzip |

Most sites are the first row. `renderMermaidSVG` is synchronous and needs no DOM,
so a static site never has to ship the renderer to a reader.

## Pre-render at build time

Call the library from whatever already builds your site. Emit one SVG per theme
and let CSS choose, so a theme toggle is instant and needs no re-render:

```ts
// scripts/render-diagrams.ts
import { writeFileSync } from 'node:fs'
import { renderMermaidSVG } from 'agentic-mermaid'

const source = `timeline
  title History of Social Media
  2002 : LinkedIn
  2004 : Facebook : Google
  2006 : Twitter`

const light = renderMermaidSVG(source, { style: 'zinc-light' })
const dark = renderMermaidSVG(source, { style: 'zinc-dark' })

writeFileSync(
  'dist/timeline.html',
  `<div class="diagram">
     <div class="diagram-light">${light}</div>
     <div class="diagram-dark">${dark}</div>
   </div>`,
)
```

```css
.diagram-dark { display: none }
.dark .diagram-light { display: none }   /* `.dark` = your dark-mode class */
.dark .diagram-dark { display: block }
```

Or from the CLI, with no build script at all:

```bash
am render diagram.mmd --format svg --style zinc-light --output dist/diagram-light.svg
am render diagram.mmd --format svg --style zinc-dark  --output dist/diagram-dark.svg
```

Either way the reader downloads two inline SVGs instead of a renderer, the
diagram survives JS being disabled, and it appears in RSS and in feed readers.

## Browser bundle

When the source genuinely is not known until the page runs, load the prebuilt
IIFE. It is self-contained — no bundler, no import map, no build step:

```html
<script src="https://unpkg.com/agentic-mermaid/dist/browser.global.js"></script>
<script>
  const svg = agenticMermaid.renderMermaidSVG('timeline\n  title Roadmap\n  2026 : Ship', {
    style: 'zinc-dark',
  })
  document.querySelector('#diagram').innerHTML = svg
</script>
```

The global is **`agenticMermaid`** and carries the same render surface as the
package entry — `renderMermaidSVG`, `renderMermaidASCII`, style helpers.

**If you already run a bundler, do not use this file.** Import the package
normally; your bundler will tree-shake, which the IIFE cannot:

```js
import { renderMermaidSVG } from 'agentic-mermaid'
```

### Weight

`dist/browser.global.js` is 2.85 MB raw, **873 KB gzip**. Most of that is the
ELK layout engine. That is a real cost for a page whose diagrams never change —
which is why the build-time path above is the default recommendation, not a
footnote.

### Rolling your own bundle

You do not need to, but if you must, two traps are worth naming because both
fail quietly:

- **Do not combine `--global-name=X` with `window.X = …` in your entry file.**
  esbuild emits `var X = (() => { … })()`, and at top-level script scope that
  `var` *is* `window.X`. Your assignment runs first, then the IIFE's return
  value — `undefined`, if your entry exports nothing — overwrites it. The build
  succeeds and the global is empty. Use `export * from 'agentic-mermaid'` in the
  entry and let `--global-name` do the work.
- **`dist/` is a build artifact and is not in the git repository.** Install from
  npm, or run `bun install && bun run build` in a clone before pointing a
  bundler at `dist/`.

## Coming from Beautiful Mermaid

Upstream's `THEMES` export does not exist here; it was replaced by the composable
Style/Palette system. The theme names survive as style names:

```js
renderMermaidSVG(src, { theme: THEMES['zinc-dark'] })   // upstream
renderMermaidSVG(src, { style: 'zinc-dark' })           // Agentic Mermaid
```

See [`fork-differences.md`](./fork-differences.md) for the full list of
divergences, and [`theming.md`](./theming.md) for the Style model.
