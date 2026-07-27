# Browser and static sites

Two supported ways to get a diagram onto a web page. Pick by one question: **is
the diagram source known before the page is served?**

| Your case | Use | JS shipped |
|---|---|---|
| Source is fixed at publish time — blog post, docs page, README | [Pre-render before delivery](#framework-neutral-pre-rendering) | none |
| Source is authored or edited in the page — editor, playground, user input | [Async family-loaded renderer](#async-family-loaded-esm) | 41 KB initial; 162 KB for a first Timeline render, gzip |
| One classic script with a synchronous global matters more than transfer | [Compatibility bundle](#classic-one-file-compatibility-bundle) | 896 KB gzip |

Most sites are the first row. `renderMermaidSVG` is synchronous and needs no DOM,
so a static site never has to ship the renderer to a reader.

## Framework-neutral pre-rendering

Pre-rendering is not tied to Alpine, React, or any other UI framework. The
integration boundary is a pure function:

```txt
Mermaid source + explicit render options -> secured inline SVG
```

Call that function wherever content becomes publishable: a static-site build
hook, Markdown transform, server-rendered route, CMS publish job, or cached
first request. The framework-specific adapter only decides how to pass source
in and how to mark the renderer's result as trusted markup.

### 1. Define one renderer for the whole site

Use CSS custom properties when light and dark mode change only the palette. One
SVG then serves both modes, so the page ships neither the renderer nor a second
copy of the diagram:

```ts
// lib/render-diagram.ts
import { renderMermaidSVG, type RenderOptions } from 'agentic-mermaid'

const webDiagramOptions = {
  bg: 'var(--diagram-bg)',
  fg: 'var(--diagram-fg)',
  line: 'var(--diagram-line)',
  accent: 'var(--diagram-accent)',
  muted: 'var(--diagram-muted)',
  surface: 'var(--diagram-surface)',
  border: 'var(--diagram-border)',
  font: 'Inter, system-ui, sans-serif',
  embedFontImport: false,
  security: 'strict',
} satisfies RenderOptions

export function renderDiagram(source: string): string {
  return renderMermaidSVG(source, webDiagramOptions)
}
```

Keep geometry-affecting options such as font, padding, wrapping width, and the
Look part of a Style fixed in that function. This makes output deterministic
and prevents a theme toggle from invalidating the layout that was measured at
render time.

### 2. Render at the content boundary

The call is the same in any framework or template system:

```ts
const diagramSvg = renderDiagram(article.diagramSource)
```

Place `diagramSvg` inside a wrapper using the framework's reviewed safe-HTML
escape hatch. Trust only the result of `renderDiagram`; never mark the original
Mermaid source, an arbitrary SVG string, or a client-supplied cache entry as
safe. If the source is user-authored, retain `security: 'strict'` and enforce
normal request/body limits before rendering.

```html
<figure class="mermaid-diagram">
  <!-- insert diagramSvg here as trusted server/build output -->
</figure>
```

The adapter belongs to the application because frameworks deliberately use
different trusted-markup types. The rendering policy above remains shared.

Alpine can own surrounding UI without owning rendering. For example, a server
or build step can replace the illustrative `{{ diagramSvg | safe }}` expression
with the reviewed result from `renderDiagram`:

```html
<div x-data="{ dark: false }" :class="{ dark }">
  <button type="button" @click="dark = !dark">Toggle diagram palette</button>
  <figure class="mermaid-diagram">
    {{ diagramSvg | safe }}
  </figure>
</div>
```

That Alpine component toggles inherited CSS variables; it does not ship or run
Agentic Mermaid in the reader's browser. The same pattern works with React,
Vue, Svelte, server templates, or plain HTML.

### 3. Let the page own the palette

```css
.mermaid-diagram {
  --diagram-bg: #ffffff;
  --diagram-fg: #27272a;
  --diagram-line: #71717a;
  --diagram-accent: #2563eb;
  --diagram-muted: #52525b;
  --diagram-surface: #f4f4f5;
  --diagram-border: #a1a1aa;
}

.dark .mermaid-diagram { /* replace `.dark` with the site's theme selector */
  --diagram-bg: #18181b;
  --diagram-fg: #f4f4f5;
  --diagram-line: #a1a1aa;
  --diagram-accent: #60a5fa;
  --diagram-muted: #d4d4d8;
  --diagram-surface: #27272a;
  --diagram-border: #71717a;
}

.mermaid-diagram > svg {
  display: block;
  height: auto;
  max-width: 100%;
}
```

Changing these inherited properties updates the inline SVG without Alpine,
JavaScript, a mutation observer, or a re-render.

### 4. Put it in the right lifecycle

| Content lifecycle | Adapter location | Cache policy |
|---|---|---|
| Files in a repository | Markdown/static-site build transform | Build artifact |
| Server-rendered application | Server component, loader, or template helper | Memoize by render key |
| CMS content | Publish webhook/job; first request is a fallback | Store SVG or cache by render key |
| Browser editor or user input that must preview immediately | [Browser renderer](#browser-bundle) | Cache loaded runtime chunks |

A render key should cover the exact source bytes, Agentic Mermaid version,
render options, and any external Style definition. Do not include the active
light/dark palette values when they are supplied by CSS variables: they do not
change the SVG artifact. Invalidate stored SVG when any covered input changes.

### When to emit two SVGs

Use two pre-rendered variants only when the modes intentionally change geometry
or renderer behavior: for example different fonts, wrapping widths, padding,
or Looks such as crisp versus hand-drawn. Render each variant with fixed
options and let CSS choose between them. A palette-only theme toggle should use
one SVG and CSS variables as above.

### CLI-only build

For a site without a JavaScript build script, generate files directly:

```bash
am render diagram.mmd --format svg --style zinc-light --output dist/diagram-light.svg
am render diagram.mmd --format svg --style zinc-dark  --output dist/diagram-dark.svg
```

Inline or include those files through the site's normal asset pipeline. The
diagram works with JavaScript disabled and in consumers such as RSS readers
that never execute the application runtime.

## Browser bundle

When the source is not known until the page runs, use one of the two browser
artifacts below. Both use the same renderer and final SVG security boundary.

### Async family-loaded ESM

This is the default for editors, playgrounds, and user-authored previews in
modern browsers. It is framework-neutral: the package exposes one async
function, and native ESM loads the selected family on demand.

```js
import { renderMermaidSVGAsync } from 'agentic-mermaid/browser/lazy'

const svg = await renderMermaidSVGAsync(source, {
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
```

Without a bundler, import the emitted ESM entry directly. Its relative dynamic
imports resolve to the adjacent family chunks on unpkg or a self-hosted origin:

```html
<script type="module">
  import { renderMermaidSVGAsync } from
    'https://unpkg.com/agentic-mermaid@0.3.1/dist/browser-lazy/index.js'
  // call renderMermaidSVGAsync(...) as above
</script>
```

An Alpine adapter only changes who supplies the source and when the pure async
function runs. It should still insert parsed XML nodes rather than assigning
`innerHTML`:

```html
<div x-data="diagramPreview" x-init="draw()">
  <textarea x-model="source" @input.debounce.150ms="draw()"></textarea>
  <p x-text="status" role="status"></p>
  <div x-ref="output"></div>
</div>
<script type="module">
  import Alpine from 'alpinejs'
  import { renderMermaidSVGAsync } from 'agentic-mermaid/browser/lazy'

  Alpine.data('diagramPreview', () => ({
    source: 'timeline\n  2026 : Ship',
    status: '',
    generation: 0,
    async draw() {
      const generation = ++this.generation
      this.status = 'rendering'
      try {
        const svg = await renderMermaidSVGAsync(this.source, { security: 'strict' })
        if (generation !== this.generation) return
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
        if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') {
          throw new Error('renderer returned invalid SVG')
        }
        this.$refs.output.replaceChildren(document.importNode(doc.documentElement, true))
        this.status = 'rendered'
      } catch (error) {
        if (generation !== this.generation) return
        this.status = `render failed: ${error}`
      }
    },
  }))
  Alpine.start()
</script>
```

This complete bootstrap registers the component before Alpine starts, so it
cannot miss the `alpine:init` lifecycle event. In an application that already
owns Alpine startup, register `Alpine.data(...)` in that existing pre-start
bootstrap instead. Agentic Mermaid does not depend on Alpine; this is only an
adapter example.
Loaded modules are cached by the browser, so repeated renders do not re-fetch a
family or ELK.

### Classic one-file compatibility bundle

Use the prebuilt IIFE when a single classic script and synchronous global are
requirements. This file needs no ESM support, bundler, or import map:

```html
<script
  src="https://unpkg.com/agentic-mermaid@0.3.1/dist/browser.global.js"
  integrity="sha384-gBg9BeQORQqph8GL4oWD6yHJhhlHLkcKJrQ2OegmybQkqE7WiEtayrchfxPTZ61k"
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

The repository's generated `/demo/` page is a vanilla-JavaScript integration
test, not an Alpine application. It loads the lazy ESM graph and proves through
browser request assertions that its Timeline render fetches neither ELK nor the
classic all-family artifact. The Alpine examples in this recipe are optional
adapters around the same framework-neutral rendering contract. The classic
artifact remains covered separately by the all-family browser contract.

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

**The bundle has shipped since v0.3.0; the reviewed bytes above are v0.3.1.**
Earlier releases are ESM-only and have no `dist/browser.global.js`, so those
versioned URLs 404. Pin a version and its matching integrity value as above
rather than tracking `latest`: it also stops a future release from changing the
file under a page you are not watching.

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

**If you already run a bundler, do not use the classic file merely as an input
to that bundler.** For an async preview, keep the lazy boundary explicit:

```js
import { renderMermaidSVGAsync } from 'agentic-mermaid/browser/lazy'
```

The root ESM import is the complete synchronous API and should not be treated
as a small per-family browser build.

### Weight

Measured after the production build; compressed totals sum each fetched file
independently, matching HTTP transfer rather than compressing concatenated
chunks as one imaginary response:

| Cold path | Raw | gzip | Brotli |
|---|---:|---:|---:|
| Lazy entry before a render | 128 KB | 41 KB | 37 KB |
| Lazy entry + first Timeline render (non-ELK) | 529 KB | 162 KB | 143 KB |
| Lazy entry + first Flowchart render (ELK) | 2.17 MB | 661 KB | 529 KB |
| Classic all-in-one compatibility file | 2.99 MB | 896 KB | 705 KB |

For the Timeline used by the live demo, the family-loaded path cuts cold
gzip transfer by about **82%**. ELK-backed diagrams save less because layout is
the dominant cost, but they still avoid unrelated families and reuse one ELK
download. Run `bun run scripts/build/browser-lazy-report.ts --json` for the
recorded budget and request count of every family.

Before BUILD-31, `/demo/` loaded the 2,984,829 raw / 895,155 gzip / 704,945
Brotli-byte classic bundle. It now uses the lazy Timeline path: 529,673 raw /
162,026 gzip / 143,043 Brotli renderer bytes on the first render. That removes
733,129 gzip bytes, an **81.9%** reduction. The current classic compatibility
artifact is still available at 2,986,062 raw / 896,741 gzip / 705,889 Brotli
bytes and is tested separately.

### All-family browser delivery architecture

`agentic-mermaid/browser/lazy` implements the split below. The existing
`browser.global.js` remains the synchronous, self-contained compatibility
artifact and therefore still contains every registered family, ASCII renderer,
Style backend, and ELK.

The smaller entry is asynchronous and split by capability:

```txt
small browser entry
  -> source-envelope normalizer + family catalog
  -> selected family runtime chunk
       -> shared SVG/Scene/style/security core
       -> shared ELK chunk, only for ELK-backed families
```

That design supports every registered built-in family without making every page
pay for every built-in family. A page with several diagrams downloads the common
core once, each family runtime at most once, and ELK only if a selected family
needs it. Runtime-installed extension families continue to use the full package
entry; the closed lazy catalog cannot infer a third party's module URL.

The implementation uses real dependency boundaries rather than a second entry
file around the root export:

1. **Separate catalog from runtime hooks.** Family ids, header detection,
   maturity, capabilities, and canonical examples must live in a browser-safe
   catalog that imports no parser, layout, SVG, ASCII, or agent hooks. Today the
   complete registry imports those hooks, which pulls the whole graph into a
   nominally render-only bundle.
2. **Keep one source-normalization authority.** The loader must handle BOMs,
   frontmatter, init directives, comments, and accessibility directives with
   the same contract as server rendering. Refactor that contract so detection
   can use catalog metadata; do not introduce a second regex-only browser
   parser whose classification can drift.
3. **Use an exhaustive literal loader manifest.** Map every built-in family id
   to `() => import(...)`, checked against the catalog's `BuiltinFamilyId` type.
   Literal imports let bundlers produce chunks; exhaustiveness makes adding a
   family fail CI until its browser runtime is enrolled.
4. **Make the family runtime SVG-specific.** Its contract needs request
   normalization, layout, Scene lowering or crisp SVG rendering, and
   diagnostics. Leave ASCII, PNG rasterization, structured mutation,
   verification, and agent examples out of this browser entry unless a caller
   explicitly imports those capabilities.
5. **Share expensive engines by need, not by family.** ELK should be one cached
   async chunk used by the ELK-backed families, not duplicated into each family
   chunk. Non-ELK families should have no path to it.
6. **Preserve output parity and security.** The lazy result must be byte-for-byte
   equivalent to the existing renderer for the same resolved request and pass
   through the same final SVG security policy. Loading code later must not
   create a second rendering implementation.

The public shape is the SVG-only
`renderMermaidSVGAsync(source, options): Promise<string>`. The full
classic-script global remains available for users who value one synchronous
file over transfer size; there is no combinatorial bundle per family.

The acceptance gate checks the network graph, not just a smaller entry
filename:

- one canonical example from every registered built-in family renders with exact parity;
- a non-ELK example fetches no ELK chunk;
- two ELK-backed families reuse one ELK chunk;
- adding a registered built-in family without a loader is a type/test failure;
- initial and per-family request-count, raw, gzip, and Brotli budgets are
  recorded separately.

`bun run build:browser:lazy` generates the exhaustive catalog, builds the
chunks, and fails on dependency or size drift. `bun test
src/__tests__/browser-lazy.test.ts` proves all-family byte parity in-process;
`bun test e2e/browser-bundle.e2e.test.ts --timeout 600000` proves the emitted
HTTP module graph, strict-mode parity, non-ELK exclusion, and shared ELK caching
in Chromium.

CSS-variable theming stays above this loading design. A palette toggle still
changes one SVG without re-rendering; code splitting solves authoring-time
renderer cost, not theming.

### Self-hosting it

unpkg and jsDelivr already do the right thing. If you serve the file yourself,
send `Content-Type: text/javascript; charset=utf-8`, and compress it — 2.99 MB
uncompressed against 896 KB gzipped is the difference your readers pay.

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
