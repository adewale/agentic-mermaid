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

Either way the reader downloads two inline SVGs rather than a renderer, so the
diagram still shows up with JavaScript disabled and inside an RSS reader.

## Browser bundle

When the source is not known until the page runs, load the prebuilt IIFE. The
ESM entry would need a bundler or an import map; this file needs neither:

```html
<script
  src="https://unpkg.com/agentic-mermaid@0.3.0/dist/browser.global.js"
  integrity="sha384-YcMQSsCGfs4ZfuWkYNET2L2z0f+YNPJftR5krUhTWrHDQ9cUcsRRp5ux5zbBYKd9"
  crossorigin="anonymous"></script>
<script>
  const svg = agenticMermaid.renderMermaidSVG('timeline\n  title Roadmap\n  2026 : Ship', {
    style: 'zinc-dark',
    security: 'strict',
  })
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') {
    throw new Error('renderer returned invalid SVG')
  }
  document.querySelector('#diagram').replaceChildren(
    document.importNode(parsed.documentElement, true),
  )
</script>
```

The global is **`agenticMermaid`** and carries the same render surface as the
package entry — `renderMermaidSVG`, `renderMermaidASCII`, style helpers.

Keep `security: 'strict'` for authored or user-provided source, and insert the
accepted result as parsed XML nodes as shown above. Do not assign renderer output
to `innerHTML`: strict rendering and DOM insertion are separate trust boundaries.
The integrity value pins the reviewed bytes as well as the version. When the
package version changes, recompute it with:

```bash
openssl dgst -sha384 -binary dist/browser.global.js | openssl base64 -A
```

For a strict Content Security Policy, either self-host the bundle under
`script-src 'self'` or allow the pinned CDN origin (for example
`script-src 'self' https://unpkg.com`). Put the initializer in an external
same-origin file, or authorize it with a nonce or hash; do not add
`'unsafe-inline'` just for this example.

**The bundle ships from v0.3.0.** Earlier releases are ESM-only and have no
`dist/browser.global.js`, so an unversioned CDN URL 404s against them. Pin the
version as above rather than tracking `latest`: it fixes that, and it stops a
future major from changing the file under a page you are not watching.

### Browser support

**Chrome 97, Firefox 104, Safari 15.4, Edge 97** and newer.

`Array.prototype.findLast` sets that floor. It is a runtime method, so lowering
the build target will not help: esbuild rewrites syntax and leaves method calls
as they are. The bundle also calls `Array.prototype.at`, `Object.hasOwn`, and
`String.prototype.replaceAll`, all of which ship earlier than `findLast`. To
support older browsers, load polyfills for those four before the bundle.

CI runs the contract against the current Playwright Chromium, Firefox, and
WebKit engines. The historical version floors above are derived from runtime API
availability; this project does not execute those legacy browser releases in CI.

The bundle contains no WebAssembly and makes no network request at load, so it
works offline and needs no cross-origin isolation.

**If you already run a bundler, do not use this file.** Import the package
normally; your bundler will tree-shake, which the IIFE cannot:

```js
import { renderMermaidSVG } from 'agentic-mermaid'
```

### Weight

`dist/browser.global.js` is 2.85 MB raw, **873 KB gzip**. Most of that is the ELK
layout engine. Because a page whose diagrams never change pays that cost on every
cold visit for nothing, the build-time path above is the recommendation.

### Self-hosting it

unpkg and jsDelivr already do the right thing. If you serve the file yourself,
send `Content-Type: text/javascript; charset=utf-8`, and compress it — 2.85 MB
uncompressed against 873 KB gzipped is the difference your readers pay.

Declare the encoding in at least one of the two places. The bundle contains
non-ASCII characters inside a Unicode character class, and a classic
`<script src>` whose response omits `charset` is decoded using the host
document's encoding. If neither the response nor the page says UTF-8, the
browser picks a legacy encoding and the file throws

```txt
SyntaxError: Invalid regular expression: Range out of order in character class
```

before any of your code runs, with nothing in the stack trace pointing at the
encoding. A page with `<meta charset="utf-8">` is already safe; a hand-written
page with no `<head>` metadata is the one that breaks.

### Rolling your own bundle

You should not need to. If you do, two traps fail quietly enough to cost an
afternoon:

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
renderMermaidSVG(src, THEMES['zinc-dark'])              // upstream
renderMermaidSVG(src, { style: 'zinc-dark' })           // Agentic Mermaid
```

See [`fork-differences.md`](./fork-differences.md) for the full list of
divergences, and [`theming.md`](./theming.md) for the Style model.
