/**
 * Generates editor.html – a live Mermaid editor similar to mermaid.live.
 *
 * Usage: bun run scripts/site/editor.ts
 *
 * The generated HTML is fully self-contained:
 *   - Bundles the mermaid renderer client-side
 *   - Live rendering on every keystroke (debounced)
 *   - Canonical deflate/base64url URL hash sharing for source + editor state
 *   - Theme switcher with all built-in themes
 *   - Sample presets by diagram category
 *   - Download SVG / Copy link
 *
 * Source files are organized in editor/:
 *   - editor/css/  – modular CSS components
 *   - editor/js/   – modular JS modules
 *   - editor/html/ – HTML partials (topbar, left-panel, right-panel)
 */

import { runtimeRenderContractPlugin } from '../build/runtime-render-contract.ts'
import { minifyBrowserRuntime } from '../build/runtime-minify.ts'
import { browserOptimizerRecipe, compactBunBrowserModules } from '../build/compact-browser-modules.ts'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { editorExamplesDataJs } from './editor-example-data.ts'
import { HOSTED_FONT_RESOURCES, hostedFontFaceCss } from '../../src/font-manifest.ts'
import { knownStyleDescriptors } from '../../src/scene/style-registry.ts'
import { EDITOR_SUPPORTED_FAMILY_LIST } from '../../src/editor-family-data.ts'
import { PNG_DEFAULT_SCALE } from '../../src/png-contract.ts'

// ── File helpers ──────────────────────────────────────────────────────────────

const editorDir = fileURLToPath(new URL('../../editor/', import.meta.url))

async function readFile(relativePath: string): Promise<string> {
  const file = Bun.file(join(editorDir, relativePath))
  const contents = await file.text()
  return contents
}

async function readCssFiles(fontPrefix: string, hosted: boolean): Promise<string> {
  const order = ['css/variables.css', 'css/topbar.css', 'css/panels.css', 'css/code-editor.css', 'css/preview.css', ...(hosted ? ['css/runtime-recovery.css'] : []), 'css/config-panel.css', 'css/color-picker.css', 'css/font-picker.css', 'css/export.css', 'css/affordances.css', 'css/diagram-tools.css', 'css/misc.css']
  const parts = await Promise.all(order.map(f => readFile(f)))
  const result = await Bun.build({
    entrypoints: ['editor-css'],
    target: 'browser',
    minify: true,
    plugins: [
      {
        name: 'editor-css',
        setup(build) {
          build.onResolve({ filter: /^editor-css$/ }, () => ({ path: 'editor.css', namespace: 'editor-css' }))
          build.onLoad({ filter: /.*/, namespace: 'editor-css' }, () => ({ contents: parts.join('\n\n'), loader: 'css' }))
        },
      },
    ],
  })
  if (!result.success) throw new AggregateError(result.logs, 'Editor stylesheet bundle failed')
  // Keep resource URLs under the existing host policy, outside CSS bundling.
  return hostedFontFaceCss(fontPrefix) + '\n' + (await result.outputs[0]!.text())
}

function editorFamilyDataJs(): string {
  return `var SUPPORTED_FAMILY_LIST = ${JSON.stringify(EDITOR_SUPPORTED_FAMILY_LIST)};`
}

function editorFontDataJs(): string {
  const hostedFamilies = Array.from(new Set(HOSTED_FONT_RESOURCES.map(font => font.family)))
  const hosted = hostedFamilies.map(family => ({ name: family, value: family, group: 'Self-hosted' }))
  const system = [
    { name: 'System UI', value: 'system-ui', group: 'System' },
    { name: 'Arial', value: 'Arial', group: 'System' },
    { name: 'Georgia', value: 'Georgia', group: 'System' },
    { name: 'Courier New', value: 'Courier New', group: 'System' },
  ]
  return `var EDITOR_PRESET_FONTS = ${JSON.stringify([...hosted, ...system])};`
}

async function readJsFiles(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(editorDir, 'js/entry.js')],
    target: 'browser',
    format: 'iife',
    minify: { whitespace: true, syntax: false, identifiers: false },
  })
  if (!result.success) throw new AggregateError(result.logs, 'Editor application bundle failed')
  // Compress the complete application module so catalog literals and their
  // consumers share one scope; keep every catalog value available to the UI.
  return minifyBrowserRuntime([editorExamplesDataJs(), editorFamilyDataJs(), editorFontDataJs(), await result.outputs[0]!.text()].join('\n'))
}

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Full looks only — palette-only styles ARE the themes and already have the
 *  theme picker; the style picker chooses the LOOK, the theme picker the
 *  palette, and render-option precedence stacks them (theme colors win). */
function styleItemsHtml(): string {
  const looks = knownStyleDescriptors().filter(descriptor => descriptor.kind === 'look')
  return looks
    .map(descriptor => {
      const key = descriptor.inputName
      const label = descriptor.displayLabel
      const hint = descriptor.spec.blurb ? `${label}: ${descriptor.spec.blurb}` : label
      return `<button class="theme-dropdown-item${descriptor.isDefault ? ' active' : ''}" type="button" role="option" aria-selected="${descriptor.isDefault ? 'true' : 'false'}" data-style="${key}" title="${escapeHtmlAttr(hint)}" aria-label="${escapeHtmlAttr(hint)}">${label}</button>`
    })
    .join('\n')
}

function themeItemsHtml(): string {
  const palettes = knownStyleDescriptors().filter(descriptor => descriptor.kind === 'palette')
  return [
    `<button class="theme-dropdown-item active" type="button" role="option" aria-selected="true" data-theme="">Default</button>`,
    ...palettes.map(descriptor => {
      // The editor stores this stable palette input and contributes it to the
      // same style stack used by every other surface.
      const key = descriptor.inputName
      const label = descriptor.displayLabel
      const swatch = descriptor.spec.colors?.bg ?? 'transparent'
      return `<button class="theme-dropdown-item" type="button" role="option" aria-selected="false" data-theme="${key}"><span class="theme-swatch" style="background:${swatch}"></span>${label}</button>`
    }),
  ].join('\n')
}

function pngScaleItemsHtml(): string {
  const scales = Array.from(new Set([1, PNG_DEFAULT_SCALE, 4])).sort((left, right) => left - right)
  return scales
    .map(scale => {
      const active = scale === PNG_DEFAULT_SCALE
      return `<button class="size-pill${active ? ' active' : ''}" type="button" data-scale="${scale}" aria-pressed="${active ? 'true' : 'false'}">${scale}&times;</button>`
    })
    .join('\n')
}

async function readHtmlPartials(
  themeItems: string,
  hosted: boolean,
): Promise<{
  topbar: string
  leftPanel: string
  rightPanel: string
}> {
  // Compact static markup before inserting catalogs or runtime code. Preserve
  // preformatted and raw-text elements, including any literal comment text.
  const readPartial = async (path: string): Promise<string> => (await readFile(path)).replace(
    /<(pre|textarea|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->|^[\t ]+/gim,
    (markup, rawTag) => rawTag ? markup : '',
  )
  const [topbar, leftPanel, rightPanel] = await Promise.all([
    readPartial('html/topbar.html'),
    readPartial('html/left-panel.html'),
    readPartial('html/right-panel.html'),
  ])
  return {
    topbar: topbar.replace('{{THEME_ITEMS}}', themeItems).replace('{{STYLE_ITEMS}}', styleItemsHtml()).replace('{{PNG_DEFAULT_SCALE}}', String(PNG_DEFAULT_SCALE)).replace('{{PNG_SCALE_ITEMS}}', pngScaleItemsHtml()),
    leftPanel,
    rightPanel: rightPanel.replace('{{RUNTIME_RECOVERY}}', hosted ? await readFile('html/runtime-recovery.html') : ''),
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function sourceOnlyFamilyRegistry(): ReturnType<typeof runtimeRenderContractPlugin> {
  return {
    name: 'source-only-editor-family-registry',
    setup(build) {
      // Closed editor workers accept source/options/output operations. Their
      // loaders install source hooks through the ordinary validated registry.
      build.onResolve({ filter: /(?:^|\/)families\.ts$/ }, args => {
        const original = fileURLToPath(new URL('../../src/agent/families.ts', import.meta.url))
        return join(args.resolveDir, args.path) === original ? { path: fileURLToPath(new URL('../../src/agent/family-registry.ts', import.meta.url)) } : undefined
      })
    },
  }
}

async function generateEditorHtml(): Promise<string> {
  const fontPrefix = process.env.AM_EDITOR_FONT_PREFIX || 'assets/fonts/'
  const runtimeDirectory = process.env.AM_EDITOR_RUNTIME_DIR
  const metafilePath = runtimeDirectory ? undefined : process.env.AM_EDITOR_BUILD_METAFILE
  let workerUrl: string | undefined
  if (runtimeDirectory) {
    const workerBuild = await Bun.build({
      entrypoints: [fileURLToPath(new URL('../../src/browser-preview-worker.ts', import.meta.url))],
      target: 'browser',
      format: 'esm',
      minify: true,
      splitting: true,
      outdir: runtimeDirectory,
      naming: { entry: '[name]-[hash].js', chunk: 'chunk-[hash].js' },
      plugins: [
        // This worker accepts render/verify/terminal requests only. The
        // main-thread adapter owns option inspection and validation.
        runtimeRenderContractPlugin({ schemaDocumentation: false, conformanceObservations: false, sourceOnlySceneAdmission: true }),
        sourceOnlyFamilyRegistry(),
        {
          name: 'hosted-worker-dependencies',
          setup(build) {
            build.onResolve({ filter: /(?:^|\/)elk-constructor\.ts$/ }, () => ({ path: fileURLToPath(new URL('../../src/elk-constructor.lazy.ts', import.meta.url)) }))
          build.onResolve({ filter: /(?:^|\/)indexed-forest\.ts$/ }, () => ({ path: fileURLToPath(new URL('../../src/experimental/indexed-forest.lazy.ts', import.meta.url)) }))
          build.onResolve({ filter: /(?:^|\/)agentic-layered\.ts$/ }, args => args.kind === 'dynamic-import' ? undefined
            : { path: fileURLToPath(new URL('../../src/layout/agentic-layered.lazy.ts', import.meta.url)) })
          },
        },
      ],
    })
    const workerEntry = workerBuild.outputs.find(output => output.kind === 'entry-point')
    if (!workerBuild.success || !workerEntry) throw new AggregateError(workerBuild.logs, 'Preview worker build failed')
    workerUrl = `/editor/runtime/${basename(workerEntry.path)}`
  }
  // Both delivery modes use the same source-only family registry and admission
  // projections. The private worker still offers preview, terminal and PNG;
  // the public Node/Scene/IIFE entries keep their complete contracts.
  const runtimePlugins: Array<ReturnType<typeof runtimeRenderContractPlugin>> = [
    runtimeRenderContractPlugin({ schemaDocumentation: false, conformanceObservations: false, familyEditorMetadata: Boolean(runtimeDirectory), sourceOnlySceneAdmission: true }),
    sourceOnlyFamilyRegistry(),
    ...(!runtimeDirectory ? [{
      name: 'standalone-worker-families',
      setup(build: Parameters<ReturnType<typeof runtimeRenderContractPlugin>['setup']>[0]) {
        build.onResolve({ filter: /(?:^|\/)verified-loaders\.ts$/ }, args => {
          const original = fileURLToPath(new URL('../../src/browser-lazy/generated/verified-loaders.ts', import.meta.url))
          return join(args.resolveDir, args.path) === original ? { path: fileURLToPath(new URL('../../src/browser-preview-eager-families.ts', import.meta.url)) } : undefined
        })
      },
    }] : []),
  ]
  let bundleJs: string, sourceRuntimeBytes: number | undefined
  let runtimeMetafile: unknown
  if (runtimeDirectory) {
    const buildResult = await Bun.build({
      entrypoints: [fileURLToPath(new URL('../../src/browser-hosted.ts', import.meta.url))],
      plugins: runtimePlugins,
      target: 'browser', format: 'esm', minify: true,
      banner: `/* browser optimizer recipe ${browserOptimizerRecipe()} */`,
      define: { AM_PREVIEW_WORKER_URL: JSON.stringify(workerUrl) },
      splitting: true, outdir: runtimeDirectory,
      naming: { entry: '[name]-[hash].js', chunk: 'chunk-[hash].js' },
    })
    if (!buildResult.success) throw new AggregateError(buildResult.logs, 'Hosted editor runtime build failed')
    await compactBunBrowserModules(buildResult.outputs)
    // Bun materializes outputs when outdir is set. Writing a file-backed
    // BuildArtifact onto its own path would truncate the emitted module.
    const entry = buildResult.outputs.find(output => output.kind === 'entry-point')
    if (!entry) throw new Error('Hosted editor runtime entry not found')
    bundleJs = `import ${JSON.stringify(`/editor/runtime/${basename(entry.path)}`)};`
  } else {
    const buildResult = await Bun.build({
      entrypoints: [fileURLToPath(new URL('../../src/browser-standalone.ts', import.meta.url))],
      plugins: runtimePlugins,
      // SWC owns syntax/identifier compression once; retain Bun's whitespace pass.
      target: 'browser', format: 'esm', minify: { whitespace: true, syntax: false, identifiers: false },
      metafile: Boolean(metafilePath),
    })
    if (!buildResult.success) throw new AggregateError(buildResult.logs, 'Standalone editor runtime build failed')
    // Compress the complete inline module after omitting unpublished
    // conformance observations and unused schema prose. Retain validation,
    // both solvers and the terminal adapter; keep legal comments and escape
    // script delimiters.
    const source = await buildResult.outputs[0]?.text()
    if (!source) throw new Error('Standalone editor runtime build produced no module')
    runtimeMetafile = buildResult.metafile
    sourceRuntimeBytes = new TextEncoder().encode(source).byteLength
    bundleJs = await minifyBrowserRuntime(source)
    if (!bundleJs) throw new Error('Standalone runtime compression produced no module')
  }
  console.log(`Browser bundle: ${(bundleJs.length / 1024).toFixed(1)} KB`)

  const themeItems = themeItemsHtml()

  const [css, appJs, html] = await Promise.all([readCssFiles(fontPrefix, Boolean(runtimeDirectory)), readJsFiles(), readHtmlPartials(themeItems, Boolean(runtimeDirectory))])

  // The standalone runtime is also the worker source; keep app DOM code separate.
  const document = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content" />
<title>Agentic Mermaid – Live Editor</title>
<link rel="icon" type="image/svg+xml" href="favicon.svg" />
<link rel="icon" type="image/x-icon" href="favicon.ico" />
<link rel="apple-touch-icon" href="apple-touch-icon.png" />
<style>
${css}
</style>
</head>
<body>

${html.topbar}

<main class="main" id="editor-main" aria-label="Mermaid editor workspace">

<aside class="examples-sidebar" id="examples-sidebar" aria-label="Example diagrams" aria-hidden="true" inert>
<div class="examples-sidebar-inner">
<div class="examples-sidebar-header">
<span>Examples</span>
<button class="toolbar-btn" id="examples-sidebar-close" type="button" title="Close examples sidebar" aria-label="Close examples sidebar">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<line x1="18" y1="6" x2="6" y2="18"/>
<line x1="6" y1="6" x2="18" y2="18"/>
</svg>
</button>
</div>
<div class="examples-sidebar-list" id="examples-sidebar-list"></div>
</div>
</aside>

${html.leftPanel}

<div class="resize-handle" id="resize-handle" role="separator" tabindex="0" aria-label="Resize source and preview panels" aria-orientation="vertical" aria-valuemin="280" aria-valuemax="75" aria-valuenow="42" aria-valuetext="Source panel width 42 percent"></div>

${html.rightPanel}

</main>

<div class="toast" id="toast" role="status" aria-live="polite"></div>

${runtimeDirectory ? '' : `<script type="module" id="editor-runtime">\n${bundleJs}\n</script>`}
<script type="module">
${runtimeDirectory ? bundleJs : ''}

${appJs}

</script>
</body>
</html>`
  if (metafilePath) {
    const htmlBytes = new TextEncoder().encode(document)
    await Bun.write(metafilePath, JSON.stringify({
      schemaVersion: 1,
      runtime: `Bun ${Bun.version}`,
      bundler: `Bun ${Bun.version}`,
      scope: 'Standalone editor; module contributions describe the Bun bundle before SWC compression. No bundled source is included.',
      sourceRuntimeBytes,
      compressedRuntimeBytes: new TextEncoder().encode(bundleJs).byteLength,
      htmlBytes: htmlBytes.byteLength,
      htmlGzipBytes: gzipSync(htmlBytes, { level: 9 }).byteLength,
      appScriptBytes: new TextEncoder().encode(appJs).byteLength,
      styleBytes: new TextEncoder().encode(css).byteLength,
      metafile: runtimeMetafile,
    }))
  }
  return document
}

const result = await generateEditorHtml()
const outPath = fileURLToPath(new URL('../../editor.html', import.meta.url))
await Bun.write(outPath, result)
console.log(`Written to ${outPath} (${(result.length / 1024).toFixed(1)} KB)`)
