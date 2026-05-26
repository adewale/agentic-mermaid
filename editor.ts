/**
 * Generates editor.html — a live Mermaid editor similar to mermaid.live.
 *
 * Usage: bun run editor.ts
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
 *   - editor/css/  — modular CSS components
 *   - editor/js/   — modular JS modules
 *   - editor/html/ — HTML partials (topbar, left-panel, right-panel)
 */

import { THEMES } from './src/theme.ts'

const THEME_LABELS: Record<string, string> = {
  'zinc-dark': 'Zinc Dark',
  'tokyo-night': 'Tokyo Night',
  'tokyo-night-storm': 'Tokyo Storm',
  'tokyo-night-light': 'Tokyo Light',
  'catppuccin-mocha': 'Catppuccin',
  'catppuccin-latte': 'Latte',
  'nord': 'Nord',
  'nord-light': 'Nord Light',
  'dracula': 'Dracula',
  'github-light': 'GitHub',
  'github-dark': 'GitHub Dark',
  'solarized-light': 'Solarized',
  'solarized-dark': 'Solar Dark',
  'one-dark': 'One Dark',
  'salmon': 'Salmon',
  'salmon-dark': 'Salmon Dark',
  'tufte': 'Tufte',
  'tufte-dark': 'Tufte Dark',
}


// ── File helpers ──────────────────────────────────────────────────────────────

const editorDir = new URL('./editor/', import.meta.url).pathname

async function readFile(relativePath: string): Promise<string> {
  const file = Bun.file(editorDir + relativePath)
  return file.text()
}

async function readCssFiles(): Promise<string> {
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
    'css/misc.css',
  ]
  const parts = await Promise.all(order.map(f => readFile(f)))
  return parts.join('\n\n')
}

async function readJsFiles(): Promise<string> {
  const order = [
    'js/helpers.js',
    'js/state.js',
    'js/elements.js',
    'js/sharing.js',
    'js/rendering.js',
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
  const parts = await Promise.all(order.map(f => readFile(f)))
  return parts.join('\n\n')
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
    topbar: topbar.replace('{{THEME_ITEMS}}', themeItems),
    leftPanel,
    rightPanel,
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function generateEditorHtml(): Promise<string> {
  const buildResult = await Bun.build({
    entrypoints: [new URL('./src/browser.ts', import.meta.url).pathname],
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

  const themeItems = [
    `<button class="theme-dropdown-item active" type="button" role="option" data-theme="">Default</button>`,
    ...Object.keys(THEMES).map(
      key => `<button class="theme-dropdown-item" type="button" role="option" data-theme="${key}"><span class="theme-swatch" style="background:${THEMES[key].bg}"></span>${THEME_LABELS[key] ?? key}</button>`
    ),
  ].join('\n      ')

  const [css, appJs, html] = await Promise.all([
    readCssFiles(),
    readJsFiles(),
    readHtmlPartials(themeItems),
  ])

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Beautiful Mermaid — Live Editor</title>
  <link rel="icon" type="image/svg+xml" href="favicon.svg" />
  <link rel="icon" type="image/x-icon" href="favicon.ico" />
  <link rel="apple-touch-icon" href="apple-touch-icon.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
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
  <aside class="examples-sidebar" id="examples-sidebar" aria-label="Example diagrams" aria-hidden="true">
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
  <div class="resize-handle" id="resize-handle"></div>

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
const outPath = new URL('./editor.html', import.meta.url).pathname
await Bun.write(outPath, result)
console.log(`Written to ${outPath} (${(result.length / 1024).toFixed(1)} KB)`)
