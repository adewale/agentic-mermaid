import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const REPO = join(import.meta.dir, '..', '..')
const SITE = join(REPO, 'website', 'public')

function read(rel: string) {
  return readFileSync(join(SITE, rel), 'utf8')
}

function readRepo(rel: string) {
  return readFileSync(join(REPO, rel), 'utf8')
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

async function websiteWorker(): Promise<{ fetch: (request: Request, env: any) => Promise<Response> }> {
  return (await import('../../website/src/worker.ts')).default
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

  test('Wrangler uses Worker-first Static Assets custom-domain config', () => {
    expect(existsSync(join(REPO, 'website/wrangler.toml'))).toBe(false)
    const jsonc = readFileSync(join(REPO, 'website/wrangler.jsonc'), 'utf8')
    const config = JSON.parse(jsonc.replace(/^\s*\/\/.*$/gm, ''))
    expect(config.compatibility_date).toBe('2026-06-27')
    expect(config.routes).toEqual([
      { pattern: 'agentic-mermaid.dev', custom_domain: true },
      { pattern: 'www.agentic-mermaid.dev', custom_domain: true },
    ])
    expect(config.workers_dev).toBe(false)
    expect(config.preview_urls).toBe(false)
    expect(config.observability).toEqual({ enabled: true })
    expect(config.version_metadata).toEqual({ binding: 'CF_VERSION_METADATA' })
    // run_worker_first so the redirects/headers and the /mcp handler wrap asset
    // responses (the hosted MCP must reach the worker before Static Assets).
    expect(config.assets).toEqual({ directory: './public', binding: 'ASSETS', run_worker_first: true })
    // Hosted MCP contract: the Worker Loader binding backs Code Mode execute.
    expect(config.worker_loaders).toEqual([{ binding: 'LOADER' }])
    expect(readFileSync(join(REPO, 'package.json'), 'utf8')).toContain('wrangler@latest dev --port 9095 --ip 127.0.0.1')
  })

  test('Worker-first routing canonicalizes hosts, preserves path redirects, and wraps assets with headers', async () => {
    const worker = await websiteWorker()
    let assetFetches = 0
    const env = (response: () => Response) => ({
      ASSETS: {
        fetch: async () => {
          assetFetches++
          return response()
        },
      },
    })

    const www = await worker.fetch(new Request('https://www.agentic-mermaid.dev/docs?ref=nav#top'), env(() => new Response('duplicate')))
    expect(www.status).toBe(301)
    expect(www.headers.get('location')).toBe('https://agentic-mermaid.dev/docs?ref=nav#top')
    expect(assetFetches).toBe(0)

    const slash = await worker.fetch(new Request('https://agentic-mermaid.dev/editor?empty=1'), env(() => new Response('editor')))
    expect(slash.status).toBe(308)
    expect(slash.headers.get('location')).toBe('https://agentic-mermaid.dev/editor/?empty=1')

    const html = await worker.fetch(new Request('https://agentic-mermaid.dev/'), env(() => new Response('<!doctype html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })))
    expect(html.status).toBe(200)
    expect(html.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(html.headers.get('x-content-type-options')).toBe('nosniff')
    expect(html.headers.get('cache-control')).toBe('no-cache')

    const js = await worker.fetch(new Request('https://agentic-mermaid.dev/editor/editor-abcdef123456.js'), env(() => new Response('export {}', { headers: { 'content-type': 'text/javascript; charset=utf-8' } })))
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')

    // /mcp is the live hosted MCP endpoint (stateless, POST-only) — no longer
    // the 501 placeholder. A GET is 405 and never touches Static Assets.
    assetFetches = 0
    const mcp = await worker.fetch(new Request('https://agentic-mermaid.dev/mcp'), env(() => new Response('should not run')))
    expect(mcp.status).toBe(405)
    expect(((await mcp.json()) as any).error.message).toContain('stateless')
    expect(assetFetches).toBe(0)
  })

  test('Workers website source no longer depends on mockups', () => {
    expect(existsSync(join(REPO, 'website/source/pages/home.html'))).toBe(true)
    expect(existsSync(join(REPO, 'website/source/assets/styles.css'))).toBe(true)
    const checkedFiles = ['website/build.ts', 'website/README.md', 'package.json', '.github/workflows/ci.yml', 'eval/agent-usage/homepage-prompt.ts']
    for (const rel of checkedFiles) {
      const text = readRepo(rel)
      expect({ rel, hasMockupDependency: /mockups\/(?:site-gen|home\.html)|join\([^\n]*['"]mockups['"]|\bMOCKUPS\b|readMock\b|copyMockFile\b/.test(text) }).toEqual({ rel, hasMockupDependency: false })
    }
    expect(readRepo('package.json')).toContain('"site:check": "bun run website:check"')
  })

  test('required human and machine routes are generated', () => {
    const routes = [
      'index.html', 'editor/index.html', 'about/index.html', 'docs/getting-started/index.html', 'docs/families/index.html',
      'docs/index.html', 'docs/api/index.html', 'docs/source-level/index.html', 'docs/cli/index.html',
      'docs/mcp/index.html', 'docs/ascii/index.html', 'docs/theming/index.html',
      'docs/config/index.html', 'docs/react/index.html', 'docs/quality/index.html',
      'docs/fork-differences/index.html', 'docs/vocabulary/index.html',
      'warnings/index.html', 'errors/index.html', 'examples/index.html', 'comparisons/index.html', 'evidence/index.html',
      'security/index.html', 'releases/index.html', 'skills/index.html',
      'llms.txt', 'agent-instructions.md', 'capabilities.json', 'examples/index.json',
      'skills/agentic-mermaid-diagram-workflow/SKILL.md', '_headers', '_redirects',
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

  test('public html has no placeholder links or breadcrumb slugs', () => {
    const placeholderLinks = files().filter((f) => f.endsWith('.html') && read(f).includes('href="#"'))
    const crumbs = files().filter((f) => f.endsWith('.html') && read(f).includes('class="crumb"'))
    expect(placeholderLinks).toEqual([])
    expect(crumbs).toEqual([])
  })

  test('agent-first surfaces expose prompts, traces, and discovery links', () => {
    const home = read('index.html')
    const examples = read('examples/index.html')
    const editor = read('editor/index.html')
    for (const rel of ['index.html', 'docs/index.html', 'examples/index.html', 'editor/index.html']) {
      const html = read(rel)
      expect(html).toContain('<link rel="alternate" type="text/plain" href="/llms.txt">')
      expect(html).toContain('<link rel="alternate" type="application/json" href="/capabilities.json">')
      expect(html).toContain('<link rel="alternate" type="text/markdown" href="/agent-instructions.md">')
    }
    expect(home).toContain('id="home-agent-prompt"')
    expect(home).toContain('class="page-actions" aria-label="Primary paths"')
    expect(home).toContain('Use with an agent')
    expect(home).toContain('Try editor')
    expect(home).toContain('Install locally')
    expect(home).toContain('Copy agent prompt')
    const homeMain = home.slice(home.indexOf('<main'))
    expect(homeMain.indexOf('Use with an agent')).toBeLessThan(homeMain.indexOf('Try editor'))
    expect(homeMain.indexOf('Try editor')).toBeLessThan(homeMain.indexOf('Install locally'))
    expect(home).toContain('href="/editor/?empty=1">Try editor</a>')
    expect(homeMain.indexOf('data-copy-target="home-agent-pointer"')).toBeLessThan(homeMain.indexOf('href="/editor/?empty=1"'))
    expect(homeMain.indexOf('href="/editor/?empty=1"')).toBeLessThan(homeMain.indexOf('href="/docs/getting-started/"'))
    expect(home).not.toContain('Give this to an agent')
    expect(home).not.toContain('This prompt is intentionally complete')
    expect(home).toContain('copy-prompt-card')
    expect(home).toContain('copy-prompt-primary')
    expect(home).toContain('Copy agent prompt')
    expect(home).toContain('&lt;replace with the requested diagram goal or edit&gt;')
    expect(home).toContain('Context:')
    expect(home).toContain('Do not assume this repository is checked out')
    expect(home).toContain('one channel available to you')
    expect(home).toContain('the hosted MCP at `https://agentic-mermaid.dev/mcp`')
    expect(home).toContain('For a new diagram, author Mermaid source directly')
    expect(home).toContain('Mutation ops use a `kind` discriminator')
    expect(home).toContain('return an object with `{ source }`')
    expect(home).toContain('In Trace, name the channel and the calls/ops you actually ran')
    expect(home).toContain('Agentic Mermaid treats Mermaid source as the durable interface')
    // Setup moved off the homepage: the MCP config card lives on Getting
    // started, and home carries a single pointer line instead of a section.
    const gettingStarted = read('docs/getting-started/index.html')
    expect(gettingStarted).toContain('data-copy-name="MCP config"')
    expect(gettingStarted).toContain('Copy MCP config')
    expect(gettingStarted).toContain('Run from the cloned repo root')
    expect(home).not.toContain('data-copy-name="MCP config"')
    expect(home).not.toContain('class="copy-btn"')
    expect(home).toContain('<span>parseMermaid</span><span>asFlowchart</span><span>mutate(add_edge)</span><span>verifyMermaid</span><span>serializeMermaid</span>')
    expect(home).toContain('aria-label="Agent entrypoints"')
    expect(home).toContain('Agent quick start')
    expect(home).toContain('Parse, mutate, verify')
    expect(home).not.toContain('id="local-setup"')
    expect(home).toContain('Install locally in <a href="/docs/getting-started/">Getting started</a>')
    // The prompt is collapsed behind a disclosure; the copy bar stays visible.
    expect(home).toContain('<details class="prompt-details">')
    expect(home.indexOf('id="home-agent-prompt"')).toBeLessThan(home.indexOf('id="quick-start-title"'))
    expect(home.indexOf('id="machine-context-title"')).toBeGreaterThan(home.indexOf('One source, five outputs'))
    expect(gettingStarted).toContain('Get the agent prompt on the homepage')
    expect(read('docs/getting-started/index.html')).toContain('From Mermaid source to a verified local render')
    expect(home).toContain('/examples/index.json')
    expect(home).toContain('/skills/agentic-mermaid-diagram-workflow/SKILL.md')
    expect(home).not.toContain('/schemas/index.json')
    expect(home).not.toContain('/recipes/index.json')
    expect(home).not.toContain('/agent-manifest.json')
    expect(home).not.toContain('/harnesses.json')
    expect(home).toContain('One source, five outputs')
    expect(home).toContain('class="unicode-diagram"')
    expect(examples).toContain('<p class="example-prompt"><span>Prompt</span>')
    expect(examples).toContain('<p class="example-trace"><span>Trace</span> <code>asFlowchart')
    const editorScript = editorScriptRel(editor)
    expect(existsSync(join(SITE, editorScript))).toBe(true)
    expect(read(editorScript)).toContain('buildAgentTaskPrompt')
    expect(read(editorScript)).toContain('Create or edit a Mermaid diagram')
    expect(read(editorScript)).toContain('Do not assume this repository is checked out')
    expect(read(editorScript)).toContain('return an object with `{ source }`')
    expect(read(editorScript)).toContain('In Trace, name the channel and exact calls/ops used')
    expect(read(editorScript)).toContain('source-level fallback')
    expect(read(editorScript)).toContain('createPopupController')
    expect(read(editorScript)).toContain('URLSearchParams(window.location.search).get(\'example\')')
    expect(editor).toContain('id="copy-agent-prompt-btn"')
    expect(editor).toContain('class="app-brand" aria-label="Agentic Mermaid Editor home"')
    expect(editor).toContain('<span class="sr-only">Diagram theme: </span><span id="theme-btn-label">Default</span>')
    expect(editor).not.toContain('aria-label="Agentic Mermaid homepage"')
    expect(editor).not.toContain('aria-label="Diagram theme"')
    expect(editor).toContain('id="copy-text-output-btn" type="button" title="Copy SVG markup" aria-label="Copy SVG markup"')
    expect(editor).not.toContain('title="Copy Mermaid source" aria-label="Copy Mermaid source"')
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
    expect(editor).toContain('--t-bg: #F8F4F0')
    expect(editor).toContain('--control-bg: var(--surface)')
    expect(editor).toContain('top: var(--examples-top, 60px)')
    expect(editor).toContain('left: var(--examples-left, 16px)')
    expect(editor).not.toContain('flex: 0 0 284px')
    expect(editor).not.toContain('rgba(255,255,255,0.07)')
    expect(editor).not.toContain('id="pan-btn" type="button" title="Pan (hold to drag)" aria-label="Pan preview">')
  })

  test('home hero is baked Paper artwork; the themeable demo asset keeps its var tokens', () => {
    // The hero once rendered with var(--bg/--fg/--accent) and silently re-themed
    // when the chrome accent moved to Pine. The design contract is the reverse:
    // diagram themes colour the artwork, the shell never does. Baked terracotta
    // in the hero; live var() tokens only in the standalone themeable demo.
    const home = read('index.html')
    const hero = home.match(/<div class="plate dia-plate">[\s\S]*?<\/svg>/)?.[0] ?? ''
    expect(hero).toContain('#9A4A24')
    expect(/var\(--(accent|bg|fg)[,)]/.test(hero)).toBe(false)
    const themeable = read('diagrams/workflow-themeable.svg')
    expect(themeable).toContain('var(--accent')
    expect(themeable).toContain('var(--fg)')
  })

  test('masthead exposes examples and the editor without repository chrome', () => {
    for (const rel of ['index.html', 'docs/index.html', 'about/index.html', 'examples/index.html', 'skills/agentic-mermaid-diagram-workflow/index.html']) {
      const html = read(rel)
      const masthead = html.match(/<header class="masthead"[\s\S]*?<\/header>/)?.[0] ?? ''
      expect(masthead).toContain('href="/examples/"')
      expect(masthead).toContain('href="/comparisons/"')
      expect(masthead).toContain('href="/about/"')
      expect(masthead).toContain('<a class="link-editor" href="/editor/?empty=1">Open editor</a>')
      expect(masthead).not.toContain('href="/editor/">Open editor</a>')
      expect(masthead).not.toContain('github.com')
      expect(html).not.toContain('<a href="/install/">Install</a>')
      expect(html).not.toContain('<a href="/agents/">Agents</a>')
      expect(html).not.toContain('class="crumb"')
      expect(html).not.toContain('Agentic Mermaid</a> /')
      expect(html).not.toContain('class="theme-switch"')
      // Gallery and Families were consolidated out of the top-level nav.
      expect(masthead).not.toContain('href="/gallery/"')
      expect(masthead).not.toContain('href="/families/"')
    }
    const examplesMasthead = read('examples/index.html').match(/<header class="masthead"[\s\S]*?<\/header>/)?.[0] ?? ''
    expect(examplesMasthead).toContain('href="/examples/"')
    expect(examplesMasthead).toContain('aria-current="page"')
    const comparisonsMasthead = read('comparisons/index.html').match(/<header class="masthead"[\s\S]*?<\/header>/)?.[0] ?? ''
    expect(comparisonsMasthead).toContain('href="/comparisons/"')
    expect(comparisonsMasthead).toContain('aria-current="page"')
    expect(read('about/index.html')).toContain('<a aria-current="page" href="/about/">About</a>')
    expect(read('docs/index.html')).toContain('<a aria-current="page" href="/docs/">Docs</a>')
    expect(read('_redirects')).not.toContain('/agents')
    expect(read('_redirects')).not.toContain('agents-workflow')
    expect(read('_redirects')).not.toContain('.html')
    expect(read('_redirects')).not.toContain('/home')
    const styles = read('styles.css')
    expect(styles).toContain('.masthead .links .link-editor')
    expect(styles).not.toContain('.crumb')
    expect(styles).not.toContain('Legacy components')
    expect(styles).not.toContain('.nav {')
    expect(styles).not.toContain('.card { background: var(--surface)')
    expect(styles).not.toContain('.theme-switch')
    expect(styles).not.toContain('.theme-menu')
  })

  test('typography uses shared measure, leading, labels, and safe wrapping tokens', () => {
    const styles = read('styles.css')
    expect(styles).toContain('--lh-body: 1.6;')
    expect(styles).toContain('--lh-code: 1.68;')
    expect(styles).toContain('line-height: var(--lh-body)')
    expect(styles).toContain('--prose-max: 46.25rem;')
    expect(styles).toContain('--wide-max: 960px;')
    expect(styles).toContain('--wide-width: min(var(--wide-max), calc(100vw - var(--page-gutter) - var(--page-gutter)));')
    expect(styles).toContain('--content-max: calc(var(--wide-max) + var(--page-gutter) + var(--page-gutter));')
    expect(styles).toContain('--page-gutter: 24px;')
    expect(styles).toContain('--dur-ui: 0.2s;')
    expect(styles).toContain('--dur-control: 0.16s;')
    expect(styles).toContain('960px content span')
    expect(styles).toContain('.doc { max-width: var(--content-max);')
    expect(styles).toContain('.meta-label, .agent-kicker')
    expect(styles).toContain('overflow-wrap: break-word')
    expect(styles).toContain('.unicode-diagram { overflow-x: auto; -webkit-overflow-scrolling: touch; }')
    expect(styles).not.toContain('overflow-wrap: anywhere')
    expect(styles).not.toContain('transition: background-color 0.2s ease')
    expect(styles).not.toContain('transition: opacity 0.35s ease')
    expect(styles).not.toContain('text-transform: uppercase')
    expect(styles).not.toMatch(/font-size: (?:11|12|13|14)px/)
  })

  test('comparisons page renders available engines and omits unsupported Beautiful Mermaid panels', () => {
    const comparisons = read('comparisons/index.html')
    const mermaidRuntime = files().filter((f) => /^vendor\/mermaid-[a-f0-9]{12}\.min\.js$/.test(f))
    expect(mermaidRuntime.length).toBe(1)
    expect(comparisons).toContain(`data-mermaid-runtime="/${mermaidRuntime[0]}"`)
    expect(comparisons.match(/class="comparison-case(?: |")/g)?.length).toBe(12)
    expect(comparisons.match(/class="comparison-panel"/g)?.length).toBe(30)
    expect(comparisons.match(/<button class="comparison-focus"/g)?.length).toBe(12)
    expect(comparisons.match(/class="comparison-takeaway"/g)?.length).toBe(12)
    expect(comparisons).toContain('Read this page as evidence, not a shootout')
    expect(comparisons).not.toContain('>Focus view</button>')
    expect(comparisons).toContain('aria-label="Open Flowchart comparison larger"')
    expect(comparisons).toContain('data-comparison-dialog')
    for (const id of ['flowchart', 'state', 'sequence', 'class', 'er', 'xychart', 'timeline', 'journey', 'architecture', 'pie', 'quadrant', 'gantt']) {
      expect(comparisons).toContain(`id="${id}"`)
      expect(comparisons).toContain(`id="comparison-mermaid-${id}"`)
      expect(comparisons).toContain(`comparison-agentic-${id}-svg-title`)
    }
    for (const id of ['flowchart', 'state', 'sequence', 'class', 'er', 'xychart']) {
      const section = comparisons.match(new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?<\\/section>`))?.[0] ?? ''
      expect(section).toContain('<h3>Beautiful Mermaid</h3>')
      expect(section).not.toContain('comparison-note')
    }
    for (const id of ['timeline', 'journey', 'architecture', 'pie', 'quadrant', 'gantt']) {
      const section = comparisons.match(new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?<\\/section>`))?.[0] ?? ''
      expect(section).not.toContain('<h3>Beautiful Mermaid</h3>')
      expect(section).toContain('comparison-note')
    }
    expect(comparisons).toContain('Beautiful Mermaid does not render this family')
    expect(comparisons).toContain('loadMermaidRuntime')
    expect(comparisons).toContain("mermaid.run({ querySelector: '.comparison-mermaid' })")
    expect(comparisons).not.toContain('comparison-empty')
    expect(comparisons).not.toContain('fonts.googleapis.com')
    expect(comparisons).not.toContain('@import url(')
    expect(comparisons).not.toContain('principled decision')
  })

  test('examples page carries the agent task and a per-family render anchor', () => {
    const examples = read('examples/index.html')
    // The consolidated Examples page absorbed the gallery: each supported family
    // is anchored by family id and pairs an agent prompt with its trace.
    for (const id of ['flowchart', 'er', 'journey', 'architecture', 'gantt']) {
      expect(examples).toContain(`<article class="example-sample" id="${id}">`)
    }
    expect(examples).toContain('<p class="example-prompt"><span>Prompt</span> Add a verification milestone before release')
    expect(examples).toContain('<p class="example-trace"><span>Trace</span> <code>asGantt · mutate(add_task) · verify</code>')
    // Role-style presets keep their own id and carry no structural agent task.
    expect(examples).toContain('<article class="example-sample" id="styled-flowchart">')
    const styled = examples.slice(examples.indexOf('id="styled-flowchart"'))
    expect(styled.slice(0, styled.indexOf('</article>'))).not.toContain('class="example-prompt"')
    const styles = read('styles.css')
    expect(styles).toContain('.example-prompt, .example-trace')
    expect(examples).toContain('id="example-filter"')
    expect(examples).toContain('data-example-filter')
  })

  test('editor mode switch is not a pseudo-tabset', () => {
    const editor = read('editor/index.html')
    // Source is the permanent left workspace. The view switch is a mobile-only
    // Source/Preview control (role="group", not an ARIA tabset); Style is no
    // longer a peer tab — it moved to a Settings overlay (#config-view).
    expect(editor).toContain('class="mode-switch view-switch" data-segmented-control role="group"')
    expect(editor).not.toContain('left-panel-switch')
    expect(editor).not.toContain('mobile-view-switch')
    expect(editor).not.toContain('data-left-panel')
    expect(editor).toContain('id="settings-btn"')
    expect(editor).toContain('<span>Copy agent prompt</span>')
    expect(editor).not.toContain('<span>Agent prompt</span>')
    expect(editor).toContain('id="config-view" role="dialog" aria-modal="false" aria-label="Diagram settings" hidden aria-hidden="true" inert')
    const editorRuntime = read(editorScriptRel(editor))
    expect(editorRuntime).toContain('positionSettingsPanel')
    expect(editorRuntime).toContain("className: 'visible'")
    expect(editor).toContain('data-mobile-panel="preview"')
    expect(editor).toContain('id="examples-sidebar-btn"')
    expect(editor).toContain('id="resize-handle" role="separator"')
    expect(editor).toContain('aria-valuetext="Source panel width 42 percent"')
    expect(editor).toContain('id="pan-btn" type="button" title="Pan (hold to drag)" aria-label="Pan preview" aria-pressed="false"')
    expect(editor).not.toContain('aria-label="Editor panes"')
    expect(editor).not.toContain('id="mode-source" type="button" role="tab"')
    expect(editor).not.toContain('id="mode-preview" type="button" role="tab"')
    expect(editor).not.toContain('id="examples-sidebar-btn" type="button" aria-pressed="false" aria-expanded="false" aria-controls="examples-sidebar">Examples</button>\n  </nav>')
  })

  test('focused agent artifacts are generated and stale machine catalogs are absent', () => {
    for (const rel of ['capabilities.json', 'examples/index.json']) {
      const json = JSON.parse(read(rel))
      expect({ rel, generatedFrom: Boolean(json.generatedFrom) }).toEqual({ rel, generatedFrom: true })
    }
    for (const rel of ['agent-manifest.json', 'harnesses.json', 'recipes/index.json', 'skills/index.json', 'schemas/index.json']) {
      expect({ rel, exists: existsSync(join(SITE, rel)) }).toEqual({ rel, exists: false })
    }
    expect(existsSync(join(SITE, 'skills/agentic-mermaid-diagram-workflow/SKILL.md'))).toBe(true)
    expect(read('llms.txt')).toContain('/skills/agentic-mermaid-diagram-workflow/SKILL.md')
    expect(read('llms.txt')).not.toContain('/agent-manifest.json')
    expect(read('llms.txt')).not.toContain('/recipes/index.json')
    const capabilities = JSON.parse(read('capabilities.json'))
    expect(capabilities.families.map((family: any) => family.id)).toContain('flowchart')
    expect(capabilities.warningCodes.map((warning: any) => warning.tier)).toContain('structural')
    const examplesIndex = JSON.parse(read('examples/index.json'))
    expect(examplesIndex.examples.map((example: any) => example.id)).toEqual(editorExampleIds())
    const examplesHtml = read('examples/index.html')
    expect(examplesHtml).toContain('id="styled-xychart"')
    expect(examplesHtml).toContain('Build-time proof: rendered from the same source the editor loads.')
    expect(examplesHtml).toContain('--accent:#1A7351')
    expect(examplesHtml).toContain('one fixed review theme so the proof stays visually comparable')
    expect(examplesHtml).not.toContain('#f97316')
    expect(examplesHtml).not.toContain('#3b82f6')
    for (const example of examplesIndex.examples) {
      const renderAnchor = example.renderUrl.split('#')[1]
      const familyId = example.docs.split('#')[1]
      expect(example.renderUrl.startsWith('/examples/#')).toBe(true)
      expect(examplesHtml).toContain(`id="${renderAnchor}"`)
      expect(example.docs.startsWith('/docs/families/#')).toBe(true)
      expect(read('docs/families/index.html')).toContain(`id="${familyId}"`)
      expect(example.editorUrl).toContain('/editor/?example=')
    }
  })

  test('MCP claims cover the hosted endpoint without a stale public harness manifest', () => {
    expect(existsSync(join(SITE, 'harnesses.json'))).toBe(false)
    const publicText = files().filter((f) => /\.(html|json|md|txt)$/.test(f)).map(read).join('\n')
    expect(publicText).toContain('execute</code>, <code>render_png</code>, and <code>describe</code>')
    expect(publicText).toContain('https://agentic-mermaid.dev/mcp')
    expect(publicText).toContain('render_svg')
    expect(publicText).toContain('render_ascii')
    // The 501 placeholder era is over; no page may still claim it.
    expect(publicText).not.toContain('returns a 501')
    expect(publicText).not.toContain('render verify describe mutate')
    expect(publicText).not.toContain('The skill never runs Code Mode')
  })

  test('unverified npm publication does not produce npm install copy', () => {
    const publicText = files().filter((f) => /\.(html|json|md|txt)$/.test(f)).map(read).join('\n')
    expect(publicText).not.toContain('npm i agentic-mermaid')
    expect(publicText).not.toContain('npx agentic-mermaid-mcp')
  })

  test('audit fixes keep hidden UI inert, shortcuts scoped, and mobile tables responsive', () => {
    const editor = read('editor/index.html')
    const editorRuntime = read(editorScriptRel(editor))
    const editorAll = editor + '\n' + editorRuntime
    const styles = read('styles.css')
    const theme = read('theme.js')
    const home = read('index.html')
    expect(editor).toContain('id="examples-sidebar" aria-label="Example diagrams" aria-hidden="true" inert')
    expect(editor).toContain('id="config-view" role="dialog" aria-modal="false" aria-label="Diagram settings" hidden aria-hidden="true" inert')
    expect(editorAll).toContain('setExamplesSidebarOpen(false);')
    expect(editorAll).toContain('setSettingsOpen(false);')
    expect(editorAll).not.toContain("e.key.toLowerCase() === 'c'")
    expect(editorAll).not.toContain('aria-keyshortcuts="Meta+C Control+C"')
    expect(editorAll).toContain('/^xychart(?:-beta)?\\b/.test(first)')
    expect(theme).not.toContain('am-theme')
    expect(theme).toContain("name + ' copied to clipboard.'")
    expect(styles).toContain('@media (forced-colors: active)')
    expect(styles).toContain('.warning-table thead { display: none; }')
    expect(read('warnings/index.html')).toContain('<td data-label="Code">')
    expect(read('warnings/index.html')).toContain('data-warning-filter')
    expect(read('warnings/index.html')).toContain('Fix structural first')
    expect(read('docs/getting-started/index.html')).toContain('Self-hosting over stdio is the default path')
    expect(editor).toContain('aria-haspopup="menu"')
    expect(editor).toContain('role="dialog" aria-modal="false" aria-labelledby="color-popup-title" aria-hidden="true"')
    expect(editor).toContain('class="status-left" role="status" aria-live="polite" aria-atomic="true"')
    expect(editor).toContain('id="verify-bar" role="status" aria-live="polite" aria-atomic="true"')
    expect(editorAll).toContain('ensurePreviewSvgAccessibility')
    expect(editorAll).toContain('fitUnicodeOutput')
    expect(editorAll).toContain('ensureTextOutputs')
    expect(editorAll).toContain('markTextOutputsDirty')
  })

  test('warning pages carry real per-code content, badges, and social metadata ships site-wide', () => {
    // The lead is per-code prose, never the old "${tier} ${severity} warning."
    // template that produced "geometric warning warning." on 21 pages.
    const nodeOverlap = read('warnings/NODE_OVERLAP/index.html')
    expect(nodeOverlap).toContain('is a geometric warning:')
    expect(nodeOverlap).not.toContain('warning warning.')
    expect(read('warnings/EMPTY_DIAGRAM/index.html')).toContain('is a structural error:')
    const unsupportedSyntax = read('warnings/UNSUPPORTED_SYNTAX/index.html')
    expect(unsupportedSyntax).toContain('syntax: "empty_layout"')
    expect(unsupportedSyntax).toContain('0×0 canvas with no nodes, edges, or groups')
    expect(read('agent-instructions.md')).toContain('syntax: "empty_layout"')
    // Firing demos are build-time verified; DUPLICATE_EDGE reliably fires.
    const duplicateEdge = read('warnings/DUPLICATE_EDGE/index.html')
    expect(duplicateEdge).toContain('See it fire')
    expect(duplicateEdge).toContain('Open in the editor and watch it clear')
    const warningsIndex = read('warnings/index.html')
    expect(warningsIndex).toContain('class="tier-badge tier-structural"')
    expect(warningsIndex).toContain('class="sev-badge sev-warning"')
    expect(read('examples/index.html')).toContain('class="example-toc"')
    for (const rel of ['index.html', 'docs/index.html', 'editor/index.html', 'warnings/NODE_OVERLAP/index.html']) {
      const html = read(rel)
      expect({ rel, og: html.includes('property="og:title"') }).toEqual({ rel, og: true })
      expect({ rel, tw: html.includes('name="twitter:card"') }).toEqual({ rel, tw: true })
    }
    // The editor verdict is truthful copy, not the old overclaim.
    const editorScript = read(editorScriptRel())
    expect(editorScript).toContain('Verified: no warnings')
    expect(editorScript).not.toContain('Verified: safe to export')
    expect(editorScript).toContain('Diagram too large for text rendering')
  })

  test('public llms.txt omits repo-only backlog and eval surfaces', () => {
    const text = read('llms.txt')
    expect(text).not.toContain('TODO.md')
    expect(text).not.toContain('evals/')
    expect(text).toContain('/capabilities.json')
  })

  test('audit fixes give public proof diagrams accessible names and immutable editor assets', () => {
    const home = read('index.html')
    const examples = read('examples/index.html')
    const worker = readFileSync(join(REPO, 'website/src/worker.ts'), 'utf8')
    expect(home).toContain('role="img" aria-labelledby="edit-loop-svg-title edit-loop-svg-desc"')
    expect(home).toContain('<title id="edit-loop-svg-title">Agentic Mermaid edit loop</title>')
    expect(examples).toContain('role="img" aria-labelledby="example-flowchart-basic-svg-title example-flowchart-basic-svg-desc"')
    expect(examples).toContain('<title id="example-flowchart-basic-svg-title">Flowchart diagram</title>')
    expect(examples).toContain('aria-labelledby="example-timeline-basic-svg-title example-timeline-basic-svg-desc"')
    expect(examples).toContain('aria-labelledby="example-journey-basic-svg-title example-journey-basic-svg-desc"')
    expect(examples).not.toContain('aria-labelledby="tl-')
    expect(examples).not.toContain('aria-labelledby="journey-')
    expect(read('_headers')).not.toContain('Cache-Control')
    expect(worker).toContain("headers.delete('Cache-Control')")
    expect(worker).toContain("/^\\/(?:editor\\/editor-[a-f0-9]{12}|vendor\\/mermaid-[a-f0-9]{12}\\.min)\\.js$/i.test(pathname)")
    expect(worker).toContain("public, max-age=31536000, immutable")
    expect(read('shader-mark.js')).toContain('runs a short sweep only on direct hover/focus')
    expect(read('shader-mark.js')).not.toContain('requestAnimationFrame(frame);\n    }\n    requestAnimationFrame(frame);')
  })
})
