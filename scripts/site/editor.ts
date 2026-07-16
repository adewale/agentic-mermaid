/**
 * Generates editor.html – a live Mermaid editor similar to mermaid.live.
 *
 * Usage: bun run scripts/site/editor.ts
 *
 * The generated HTML is fully self-contained:
 *   - Bundles the mermaid renderer client-side
 *   - Live rendering on every keystroke (debounced)
 *   - URL hash sharing (base64-encoded source)
 *   - Theme switcher with all built-in themes
 *   - Sample presets by diagram category
 *   - Download SVG / Copy link
 *
 * Source files are organized in editor/:
 *   - editor/css/  – modular CSS components
 *   - editor/js/   – modular JS modules
 *   - editor/html/ – HTML partials (topbar, left-panel, right-panel)
 */

import { EDITOR_EXAMPLES } from '../../editor/examples.ts'
import { HOSTED_FONT_RESOURCES, hostedFontFaceCss } from '../../src/font-manifest.ts'
import { knownStyleDescriptors } from '../../src/scene/style-registry.ts'
import { EDITOR_SUPPORTED_FAMILY_LIST } from '../../src/editor-family-data.ts'
import { PNG_DEFAULT_SCALE } from '../../src/png-contract.ts'

// ── File helpers ──────────────────────────────────────────────────────────────

const editorDir = new URL('../../editor/', import.meta.url).pathname

async function readFile(relativePath: string): Promise<string> {
  const file = Bun.file(editorDir + relativePath)
  return file.text()
}

async function readSharedBrowserFile(relativePath: string): Promise<string> {
  return Bun.file(new URL(`../../shared/browser/${relativePath}`, import.meta.url)).text()
}

async function readCssFiles(fontPrefix: string): Promise<string> {
  const order = [
    'css/variables.css',
    'css/topbar.css',
    'css/panels.css',
    'css/code-editor.css',
    'css/preview.css',
    'css/config-panel.css',
    'css/color-picker.css',
    'css/font-picker.css',
    'css/export.css',
    'css/affordances.css',
    'css/misc.css',
  ]
  const parts = await Promise.all(order.map(f => readFile(f)))
  return hostedFontFaceCss(fontPrefix) + '\n\n' + parts.join('\n\n')
}

function editorExamplesDataJs(): string {
  return `var EDITOR_EXAMPLES = ${JSON.stringify(EDITOR_EXAMPLES, null, 2)};`
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
  return `var EDITOR_PRESET_FONTS = ${JSON.stringify([...hosted, ...system], null, 2)};`
}

async function readJsFiles(): Promise<string> {
  const order = [
    'js/helpers.js',
    'js/state.js',
    'js/elements.js',
    'js/sharing.js',
    'js/rendering.js',
    'js/motion.js',
    'js/zoom.js',
    'js/pan.js',
    'js/editor-helpers.js',
    'js/examples.js',
    'js/config-panel.js',
    'js/color-picker.js',
    'js/font-picker.js',
    'js/tabs.js',
    'js/buttons.js',
    'js/export.js',
    'js/resize.js',
    'js/toast.js',
    'js/dark-mode.js',
    'js/init.js',
  ]
  const [copyFeedback, ...parts] = await Promise.all([
    readSharedBrowserFile('copy-feedback.js'),
    ...order.map(f => readFile(f)),
  ])
  return [copyFeedback, editorExamplesDataJs(), editorFamilyDataJs(), editorFontDataJs(), ...parts].join('\n\n')
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Full looks only — palette-only styles ARE the themes and already have the
 *  theme picker; the style picker chooses the LOOK, the theme picker the
 *  palette, and render-option precedence stacks them (theme colors win). */
function styleItemsHtml(): string {
  const looks = knownStyleDescriptors().filter(descriptor => descriptor.kind === 'look')
  return looks.map((descriptor) => {
    const key = descriptor.inputName
    const label = descriptor.displayLabel
    const hint = descriptor.spec.blurb ? `${label}: ${descriptor.spec.blurb}` : label
    return `<button class="theme-dropdown-item${descriptor.isDefault ? ' active' : ''}" type="button" role="option" aria-selected="${descriptor.isDefault ? 'true' : 'false'}" data-style="${key}" title="${escapeHtmlAttr(hint)}" aria-label="${escapeHtmlAttr(hint)}">${label}</button>`
  }).join('\n      ')
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
  ].join('\n      ')
}

function pngScaleItemsHtml(): string {
  const scales = Array.from(new Set([1, PNG_DEFAULT_SCALE, 4])).sort((left, right) => left - right)
  return scales.map(scale => {
    const active = scale === PNG_DEFAULT_SCALE
    return `<button class="size-pill${active ? ' active' : ''}" type="button" data-scale="${scale}" aria-pressed="${active ? 'true' : 'false'}">${scale}&times;</button>`
  }).join('\n          ')
}

async function readHtmlPartials(themeItems: string): Promise<{
  topbar: string
  leftPanel: string
  rightPanel: string
}> {
  const [topbar, leftPanel, rightPanel] = await Promise.all([
    readFile('html/topbar.html'),
    readFile('html/left-panel.html'),
    readFile('html/right-panel.html'),
  ])
  return {
    topbar: topbar
      .replace('{{THEME_ITEMS}}', themeItems)
      .replace('{{STYLE_ITEMS}}', styleItemsHtml())
      .replace('{{PNG_DEFAULT_SCALE}}', String(PNG_DEFAULT_SCALE))
      .replace('{{PNG_SCALE_ITEMS}}', pngScaleItemsHtml()),
    leftPanel,
    rightPanel,
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function generateEditorHtml(): Promise<string> {
  const fontPrefix = process.env.AM_EDITOR_FONT_PREFIX || 'assets/fonts/'
  const buildResult = await Bun.build({
    entrypoints: [new URL('../../src/browser.ts', import.meta.url).pathname],
    target: 'browser',
    format: 'esm',
    minify: true,
  })
  if (!buildResult.success) {
    console.error('Bundle failed:', buildResult.logs)
    process.exit(1)
  }
  const bundleJs = await buildResult.outputs[0]!.text()
  console.log(`Browser bundle: ${(bundleJs.length / 1024).toFixed(1)} KB`)

  const themeItems = themeItemsHtml()

  const [css, appJs, html] = await Promise.all([
    readCssFiles(fontPrefix),
    readJsFiles(),
    readHtmlPartials(themeItems),
  ])

  return `<!DOCTYPE html>
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

<!-- Top bar -->
${html.topbar}

<!-- Main -->
<main class="main" id="editor-main" aria-label="Mermaid editor workspace">

  <!-- Persistent examples sidebar -->
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

  <!-- Left panel -->
${html.leftPanel}

  <!-- Resize handle -->
  <div class="resize-handle" id="resize-handle" role="separator" tabindex="0" aria-label="Resize source and preview panels" aria-orientation="vertical" aria-valuemin="280" aria-valuemax="75" aria-valuenow="42" aria-valuetext="Source panel width 42 percent"></div>

  <!-- Right panel -->
${html.rightPanel}

</main>

<div class="toast" id="toast" role="status" aria-live="polite"></div>

<!-- Bundled renderer -->
<script type="module">
${bundleJs}

${appJs}

</script>
</body>
</html>`
}

const result = await generateEditorHtml()
const outPath = new URL('../../editor.html', import.meta.url).pathname
await Bun.write(outPath, result)
console.log(`Written to ${outPath} (${(result.length / 1024).toFixed(1)} KB)`)
