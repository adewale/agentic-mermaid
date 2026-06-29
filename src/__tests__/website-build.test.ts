import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const REPO = join(import.meta.dir, '..', '..')
const SITE = join(REPO, 'website', 'public')

function read(rel: string) {
  return readFileSync(join(SITE, rel), 'utf8')
}

function files(dir = SITE, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name)
    const rel = prefix ? `${prefix}/${name}` : name
    return statSync(abs).isDirectory() ? files(abs, rel) : [rel]
  })
}

function editorScriptRel(editorHtml = read('editor/index.html')) {
  const rel = editorHtml.match(/<script type="module" src="\/(editor\/editor-[a-f0-9]{12}\.js)"><\/script>/)?.[1]
  expect(Boolean(rel)).toBe(true)
  return rel!
}

function editorExampleIds() {
  const src = readFileSync(join(REPO, 'editor/js/examples.js'), 'utf8')
  const start = src.indexOf('var EDITOR_EXAMPLES = [')
  const end = src.indexOf('];', start)
  return [...src.slice(start, end).matchAll(/\bid:\s*'([^']+)'/g)].map((m) => m[1]!)
}

describe('Workers Static Assets website contract', () => {
  test('Cloudflare MCP config follows the official agent setup endpoints', () => {
    const expected = {
      cloudflare: 'https://mcp.cloudflare.com/mcp',
      'cloudflare-docs': 'https://docs.mcp.cloudflare.com/mcp',
      'cloudflare-bindings': 'https://bindings.mcp.cloudflare.com/mcp',
      'cloudflare-builds': 'https://builds.mcp.cloudflare.com/mcp',
      'cloudflare-observability': 'https://observability.mcp.cloudflare.com/mcp',
    }
    for (const rel of ['.cursor/mcp.json', '.vscode/mcp.json']) {
      const config = JSON.parse(readFileSync(join(REPO, rel), 'utf8'))
      expect(Object.keys(config.mcpServers).sort()).toEqual(Object.keys(expected).sort())
      for (const [name, url] of Object.entries(expected)) {
        expect(config.mcpServers[name]).toEqual({ url })
      }
    }
  })

  test('Wrangler uses the JSONC Static Assets config', () => {
    expect(existsSync(join(REPO, 'website/wrangler.toml'))).toBe(false)
    const config = JSON.parse(readFileSync(join(REPO, 'website/wrangler.jsonc'), 'utf8'))
    expect(config.compatibility_date).toBe('2026-06-27')
    expect(config.assets).toEqual({ directory: './public', binding: 'ASSETS' })
    expect(readFileSync(join(REPO, 'package.json'), 'utf8')).toContain('wrangler@latest dev --port 9095 --ip 127.0.0.1')
  })

  test('required human and machine routes are generated', () => {
    const routes = [
      'index.html', 'editor/index.html', 'gallery/index.html', 'families/index.html',
      'docs/index.html', 'docs/api/index.html', 'docs/source-level/index.html', 'docs/cli/index.html',
      'docs/mcp/index.html', 'docs/ascii/index.html', 'docs/theming/index.html',
      'docs/config/index.html', 'docs/react/index.html', 'docs/quality/index.html',
      'docs/fork-differences/index.html', 'docs/vocabulary/index.html',
      'warnings/index.html', 'errors/index.html', 'examples/index.html', 'evidence/index.html',
      'security/index.html', 'releases/index.html', 'skills/index.html',
      'llms.txt', 'agent-instructions.md', 'capabilities.json', 'agent-manifest.json',
      'harnesses.json', 'examples/index.json', 'recipes/index.json', 'skills/index.json',
      'schemas/index.json', '_headers', '_redirects',
    ]
    for (const route of routes) expect({ route, exists: existsSync(join(SITE, route)) }).toEqual({ route, exists: true })
    expect(existsSync(join(SITE, 'install/index.html'))).toBe(false)
    expect(existsSync(join(SITE, 'agents/index.html'))).toBe(false)
    expect(existsSync(join(SITE, 'agents/harnesses/index.html'))).toBe(false)
    expect(existsSync(join(SITE, 'agents/workflow/index.html'))).toBe(false)
  })

  test('all generated pages use the trident favicon assets', () => {
    const favicon = read('favicon.svg')
    expect(favicon).toContain('Agentic Mermaid')
    expect(favicon).toContain('points="14,8.5 14,23.5 24,39.5"')
    expect(existsSync(join(SITE, 'favicon.ico'))).toBe(true)
    expect(existsSync(join(SITE, 'apple-touch-icon.png'))).toBe(true)
    const offenders = files().filter((f) => f.endsWith('.html') && !read(f).includes('href="/favicon.svg"'))
    expect(offenders).toEqual([])
  })

  test('public html has no placeholder links', () => {
    const offenders = files().filter((f) => f.endsWith('.html') && read(f).includes('href="#"'))
    expect(offenders).toEqual([])
  })

  test('agent-first surfaces expose prompts, traces, and discovery links', () => {
    const home = read('index.html')
    const gallery = read('gallery/index.html')
    const editor = read('editor/index.html')
    for (const rel of ['index.html', 'docs/index.html', 'gallery/index.html', 'editor/index.html']) {
      const html = read(rel)
      expect(html).toContain('<link rel="alternate" type="text/plain" href="/llms.txt">')
      expect(html).toContain('<link rel="alternate" type="application/json" href="/agent-manifest.json">')
      expect(html).toContain('<link rel="alternate" type="text/markdown" href="/agent-instructions.md">')
    }
    expect(home).toContain('id="home-agent-prompt"')
    expect(home).toContain('Copy the agent contract')
    expect(home).toContain('copy-prompt-card')
    expect(home).toContain('copy-prompt-primary')
    expect(home).toContain('Copy prompt')
    expect(home).toContain('Replace this with your edit request and include the Mermaid source')
    expect(home).toContain('Agentic Mermaid renders one Mermaid source as SVG, PNG, ASCII, Unicode, and JSON layout')
    expect(home).toContain('data-copy-name="MCP config"')
    expect(home).toContain('Copy MCP config')
    expect(home).toContain('Run from the cloned repo root')
    expect(home).not.toContain('class="copy-btn"')
    expect(home).toContain('parseMermaid → asFlowchart → mutate(add_edge) → verifyMermaid → serializeMermaid')
    expect(home).toContain('aria-label="Agent entrypoints"')
    expect(home).toContain('How the edit loop stays safe')
    expect(home).toContain('id="local-setup"')
    expect(home).toContain('/schemas/index.json')
    expect(home).toContain('/examples/index.json')
    expect(home).toContain('/recipes/index.json')
    expect(home).toContain('One source, five outputs')
    expect(home).toContain('class="unicode-diagram"')
    expect(gallery).toContain('<p class="gallery-prompt"><span>Prompt</span>')
    expect(gallery).toContain('<p class="gallery-ops"><span>Trace</span> <code>asFlowchart')
    const editorScript = editorScriptRel(editor)
    expect(existsSync(join(SITE, editorScript))).toBe(true)
    expect(read(editorScript)).toContain('buildAgentTaskPrompt')
    expect(read(editorScript)).toContain('createPopupController')
    expect(read(editorScript)).toContain('URLSearchParams(window.location.search).get(\'example\')')
    expect(editor).toContain('id="copy-agent-task-btn"')
    expect(editor).not.toContain('Browser bundle:')
    expect(statSync(join(SITE, 'editor/index.html')).size).toBeLessThan(250_000)
    expect(gzipSync(read('editor/index.html')).byteLength).toBeLessThan(80_000)
    expect(read(editorScript).length).toBeGreaterThan(1_000_000)
  })

  test('docs and editor reuse the shared visual primitive set', () => {
    const docs = read('docs/index.html')
    const editor = read('editor/index.html')
    expect(docs).not.toContain('tufte-docs')
    expect(docs).not.toContain('/* ---- /docs in the Tufte idiom')
    expect(docs).toContain('class="doc"')
    expect(docs).toContain('Docs index')
    expect(editor).toContain('class="app-brand"')
    expect(editor).toContain('--t-bg: #F5F0E4')
    expect(editor).toContain('--control-bg: var(--surface)')
    expect(editor).toContain('top: var(--examples-top, 60px)')
    expect(editor).toContain('left: var(--examples-left, 16px)')
    expect(editor).not.toContain('flex: 0 0 284px')
    expect(editor).not.toContain('rgba(255,255,255,0.07)')
    expect(editor).not.toContain('id="pan-btn" type="button" title="Pan (hold to drag)" aria-label="Pan preview">')
  })

  test('masthead exposes examples and the editor without repository chrome', () => {
    for (const rel of ['index.html', 'docs/index.html', 'gallery/index.html', 'examples/index.html', 'skills/agentic-mermaid-diagram-workflow/index.html']) {
      const html = read(rel)
      const masthead = html.match(/<header class="masthead"[\s\S]*?<\/header>/)?.[0] ?? ''
      expect(masthead).toContain('href="/examples/"')
      expect(masthead).toContain('<a class="link-editor" href="/editor/">Open editor</a>')
      expect(masthead).not.toContain('github.com')
      expect(html).not.toContain('<a href="/install/">Install</a>')
      expect(html).not.toContain('<a href="/agents/">Agents</a>')
      expect(html).not.toContain('class="theme-switch"')
      expect(html).not.toContain('<a href="/editor/">Editor</a><a href="/gallery/">')
    }
    const examplesMasthead = read('examples/index.html').match(/<header class="masthead"[\s\S]*?<\/header>/)?.[0] ?? ''
    expect(examplesMasthead).toContain('href="/examples/"')
    expect(examplesMasthead).toContain('aria-current="page"')
    expect(read('gallery/index.html')).toContain('<a href="/gallery/" aria-current="page">Gallery</a>')
    expect(read('docs/index.html')).toContain('<a href="/docs/" aria-current="page">Docs</a>')
    expect(read('_redirects')).not.toContain('/agents')
    expect(read('_redirects')).not.toContain('agents-workflow')
    expect(read('_redirects')).not.toContain('.html')
    expect(read('_redirects')).not.toContain('/home')
    const styles = read('styles.css')
    expect(styles).toContain('.masthead .links .link-editor')
    expect(styles).not.toContain('.theme-switch')
    expect(styles).not.toContain('.theme-menu')
  })

  test('typography uses shared measure, leading, labels, and safe wrapping tokens', () => {
    const styles = read('styles.css')
    expect(styles).toContain('--lh-body: 1.6;')
    expect(styles).toContain('--lh-code: 1.68;')
    expect(styles).toContain('line-height: var(--lh-body)')
    expect(styles).toContain('--measure: 80ch;')
    expect(styles).toContain('.doc { max-width: var(--measure);')
    expect(styles).toContain('.meta-label, .agent-kicker')
    expect(styles).toContain('overflow-wrap: break-word')
    expect(styles).toContain('.unicode-diagram { overflow-x: hidden; }')
    expect(styles).not.toContain('overflow-wrap: anywhere')
    expect(styles).not.toContain('text-transform: uppercase')
    expect(styles).not.toMatch(/font-size: (?:11|12|13|14)px/)
  })

  test('gallery keeps dense diagrams readable with titles above diagrams', () => {
    const gallery = read('gallery/index.html')
    const styles = read('styles.css')
    const wideAnchors = new Map([['er', 'ER'], ['journey', 'Journey'], ['architecture', 'Architecture'], ['xychart', 'XY chart'], ['gantt', 'Gantt']])
    for (const [id, label] of wideAnchors) {
      expect(gallery).toContain(`<figure class="gallery-wide" id="${id}">\n      <figcaption><b>${label}</b>`)
      expect(gallery).toContain(`<figcaption><b>${label}</b>`)
      expect(gallery.indexOf(`<figcaption><b>${label}</b>`)).toBeLessThan(gallery.indexOf(`aria-label="${label} diagram"`))
    }
    expect(gallery).toContain('<figure class="gallery-compact gallery-span" id="class">\n      <figcaption><b>Class</b>')
    expect(gallery.indexOf('<figcaption><b>Class</b>')).toBeLessThan(gallery.indexOf('aria-label="Class diagram"'))
    expect(styles).toContain('.gallery .gallery-wide, .gallery .gallery-span { grid-column: 1 / -1; }')
    expect(styles).toContain('.gallery figcaption { margin: 0 0 11px; font-size: 0.9375rem; line-height: 1.42; }')
    expect(styles).toContain('.gallery-page { max-width: min(1120px, calc(100vw - 48px)); }')
    expect(styles).toContain('.gallery .plate svg, .gallery .plate img { display: block; width: 100%; max-width: 100%; height: auto; margin: 0 auto; }')
  })

  test('editor mode switch is not a pseudo-tabset', () => {
    const editor = read('editor/index.html')
    expect(editor).toContain('class="mode-switch left-panel-switch"')
    expect(editor).toContain('class="mode-switch mobile-view-switch"')
    expect(editor).toContain('data-left-panel="code"')
    expect(editor).toContain('data-left-panel="config"')
    expect(editor).toContain('data-mobile-panel="preview"')
    expect(editor).toContain('id="examples-sidebar-btn"')
    expect(editor).toContain('id="resize-handle" role="separator"')
    expect(editor).toContain('aria-valuetext="Source panel width 42 percent"')
    expect(editor).toContain('id="pan-btn" type="button" title="Pan (hold to drag)" aria-label="Pan preview" aria-pressed="false"')
    expect(editor).not.toContain('aria-label="Editor panes"')
    expect(editor).not.toContain('id="mode-source" type="button" role="tab"')
    expect(editor).not.toContain('id="mobile-mode-preview" type="button" role="tab"')
    expect(editor).not.toContain('id="examples-sidebar-btn" type="button" aria-pressed="false" aria-expanded="false" aria-controls="examples-sidebar">Examples</button>\n  </nav>')
  })

  test('machine json includes generatedFrom and specific schema entries', () => {
    for (const rel of ['capabilities.json', 'agent-manifest.json', 'harnesses.json', 'examples/index.json', 'recipes/index.json', 'skills/index.json']) {
      const json = JSON.parse(read(rel))
      expect({ rel, generatedFrom: Boolean(json.generatedFrom) }).toEqual({ rel, generatedFrom: true })
    }
    const schemaIndex = JSON.parse(read('schemas/index.json'))
    for (const tool of schemaIndex.mcpTools) {
      expect(tool.schema.startsWith('/schemas/')).toBe(true)
      expect(existsSync(join(SITE, tool.schema))).toBe(true)
    }
    const schema = JSON.parse(read('schemas/capabilities.schema.json'))
    expect(schema.required).toContain('families')
    expect(schema.required).toContain('generatedFrom')
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.families.items.required).toContain('mutationOps')
    expect(schema.properties.warningCodes.items.properties.tier.enum).toEqual(['structural', 'geometric', 'lint'])
    const examplesIndex = JSON.parse(read('examples/index.json'))
    expect(examplesIndex.examples.map((example: any) => example.id)).toEqual(editorExampleIds())
    expect(read('examples/index.html')).toContain('id="styled-xychart"')
    expect(read('examples/index.html')).toContain('Rendered during the website build from the same source the editor loads.')
    for (const example of examplesIndex.examples) {
      const galleryId = example.galleryUrl.split('#')[1]
      const familyId = example.docs.split('#')[1]
      expect(read('gallery/index.html')).toContain(`id="${galleryId}"`)
      expect(read('families/index.html')).toContain(`id="${familyId}"`)
      expect(example.editorUrl).toContain('/editor/?example=')
    }
    const examplesSchema = JSON.parse(read('schemas/examples.schema.json'))
    expect(examplesSchema.properties.examples.items.required).toContain('source')
  })

  test('MCP claims match the shipped local-first server surface', () => {
    const manifest = JSON.parse(read('agent-manifest.json'))
    expect(manifest.localMcp.tools).toEqual(['execute', 'render_png', 'describe'])
    expect(manifest.hostedExecution.mcp.available).toBe(false)
    expect(manifest.hostedExecution.mcp.tools).toEqual([])
    expect(manifest.hostedExecution.mcp.localToolSurface).toEqual(['execute', 'render_png', 'describe'])
    expect(manifest.hostedExecution.mcp.futureHostedConstraint).toContain('Do not enable execute(code)')
    const publicText = files().filter((f) => /\.(html|json|md|txt)$/.test(f)).map(read).join('\n')
    expect(publicText).not.toContain('render verify describe mutate')
    expect(publicText).not.toContain('The skill never runs Code Mode')
  })

  test('unverified npm publication does not produce npm install copy', () => {
    const manifest = JSON.parse(read('agent-manifest.json'))
    if (manifest.package.npmStatus === 'unverified') {
      const publicText = files().filter((f) => /\.(html|json|md|txt)$/.test(f)).map(read).join('\n')
      expect(publicText).not.toContain('npm i agentic-mermaid')
      expect(publicText).not.toContain('npx agentic-mermaid-mcp')
    }
  })

  test('audit fixes keep hidden UI inert, shortcuts scoped, and mobile tables responsive', () => {
    const editor = read('editor/index.html')
    const editorRuntime = read(editorScriptRel(editor))
    const editorAll = editor + '\n' + editorRuntime
    const styles = read('styles.css')
    const theme = read('theme.js')
    const harnesses = JSON.parse(read('harnesses.json'))
    const home = read('index.html')
    expect(editor).toContain('id="examples-sidebar" aria-label="Example diagrams" aria-hidden="true" inert')
    expect(editorAll).toContain('setExamplesSidebarOpen(false);')
    expect(editorAll).not.toContain("e.key.toLowerCase() === 'c'")
    expect(editorAll).not.toContain('aria-keyshortcuts="Meta+C Control+C"')
    expect(editorAll).toContain('/^xychart(?:-beta)?\\b/.test(first)')
    expect(theme).not.toContain('am-theme')
    expect(theme).toContain("name + ' copied to clipboard.'")
    expect(styles).toContain('@media (forced-colors: active)')
    expect(styles).toContain('.warning-table thead { display: none; }')
    expect(read('warnings/index.html')).toContain('<td data-label="Code">')
    expect(harnesses.recommended).toBe('self-hosted')
    expect(harnesses.server.command).toBe('bun')
    expect(harnesses.clients.map((c: any) => c.id)).toContain('claude-code')
    expect(home).toContain('Self-hosting over stdio is the default path')
    expect(editor).toContain('aria-haspopup="menu"')
    expect(editor).toContain('role="dialog" aria-modal="false" aria-labelledby="color-popup-title" aria-hidden="true"')
    expect(editorAll).toContain('ensurePreviewSvgAccessibility')
    expect(editorAll).toContain('fitUnicodeOutput')
  })

  test('public llms.txt omits repo-only backlog and eval surfaces', () => {
    const text = read('llms.txt')
    expect(text).not.toContain('TODO.md')
    expect(text).not.toContain('evals/')
    expect(text).toContain('/capabilities.json')
  })
})
