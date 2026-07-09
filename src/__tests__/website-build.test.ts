import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { EDITOR_EXAMPLES } from '../../editor/examples.ts'
import { samples as RICH_EXAMPLES } from '../../scripts/site/samples-data.ts'
import { createWebsiteWorker } from '../../website/src/worker-core.ts'
import { CLEAN_PAGE_ROUTES, DYNAMIC_CLEAN_REDIRECT_LINES, staticRedirectLines } from '../../website/src/site-routes.ts'
import { HOSTED_FONT_FACES, HOSTED_FONT_FILES } from '../font-manifest.ts'

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
  return EDITOR_EXAMPLES.map((example) => example.id)
}

function exampleSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function richExampleId(sample: { title: string }, index: number) {
  return `rich-${index + 1}-${exampleSlug(sample.title)}`
}

function readJsonGlobal<T>(script: string, name: string): T {
  const marker = `var ${name} = `
  const start = script.indexOf(marker)
  expect({ name, present: start >= 0 }).toEqual({ name, present: true })
  const valueStart = start + marker.length
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = valueStart; i < script.length; i++) {
    const ch = script[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') depth--
    else if (ch === ';' && depth === 0) return JSON.parse(script.slice(valueStart, i)) as T
  }
  throw new Error(`could not parse generated ${name} JSON global`)
}

function staticCleanRoutesFromGeneratedPages() {
  return files()
    .filter((f) => f.endsWith('/index.html'))
    .map((f) => f.replace(/\/index\.html$/, ''))
    .filter((route) => route !== '' && !/^warnings\/[^/]+$/.test(route) && !/^errors\/[^/]+$/.test(route))
    .sort()
}

async function websiteWorker(): Promise<{ fetch: (request: Request, env: any) => Promise<Response> }> {
  return createWebsiteWorker({
    executeHarness: 'test-harness',
    renderPng: async () => new Uint8Array(),
    deployVersion: 'test-deploy',
  })
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

    const aboutSlash = await worker.fetch(new Request('https://agentic-mermaid.dev/about'), env(() => new Response('about')))
    expect(aboutSlash.status).toBe(308)
    expect(aboutSlash.headers.get('location')).toBe('https://agentic-mermaid.dev/about/')

    assetFetches = 0
    for (const gone of ['/families', '/families/', '/docs/families', '/docs/source-level', '/docs/config', '/docs/react', '/docs/vocabulary', '/security', '/skills', '/evidence', '/releases']) {
      const removedRedirect = await worker.fetch(new Request(`https://agentic-mermaid.dev${gone}`), env(() => new Response('not found', { status: 404 })))
      expect({ gone, status: removedRedirect.status, location: removedRedirect.headers.get('location') }).toEqual({ gone, status: 404, location: null })
    }
    expect(assetFetches).toBe(11)

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

    const wellKnownMcp = await worker.fetch(new Request('https://agentic-mermaid.dev/.well-known/mcp'), env(() => new Response('should not run')))
    expect(wellKnownMcp.status).toBe(405)
    expect(((await wellKnownMcp.json()) as any).error.message).toContain('stateless')
    expect(assetFetches).toBe(0)

    const wellKnownInitialize = await worker.fetch(new Request('https://agentic-mermaid.dev/.well-known/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }),
    }), env(() => new Response('should not run')))
    expect(wellKnownInitialize.status).toBe(200)
    const wellKnownPayload = await wellKnownInitialize.json() as any
    expect(wellKnownPayload.result.serverInfo.name).toBe('agentic-mermaid-mcp')
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
    const preload = readRepo('src/__tests__/website-public.preload.ts')
    expect(preload).toContain('buildFingerprint')
    expect(preload).toContain('FINGERPRINT_PATHS')
    expect(preload).toContain("'--public-only'")
    for (const rel of ['docs/schemas/style-spec.schema.json', 'docs/assets/style-cookbook', 'examples/styles', 'skills/agentic-mermaid-diagram-workflow', 'Instructions_for_agents.md']) {
      expect(preload).toContain(`'${rel}'`)
    }
  })

  test('required human and machine routes are generated', () => {
    const routes = [
      'index.html', 'editor/index.html', 'about/index.html', 'docs/getting-started/index.html',
      'docs/index.html', 'docs/api/index.html', 'docs/cli/index.html',
      'docs/mcp/index.html', 'docs/ascii/index.html', 'docs/theming/index.html',
      'docs/custom-styles/index.html', 'docs/quality/index.html', 'docs/fork-differences/index.html',
      'warnings/index.html', 'errors/index.html', 'examples/index.html', 'comparisons/index.html',
      'llms.txt', 'llms.md', '.well-known/llms.txt', 'agent-instructions.md', 'capabilities.json', 'examples/index.json', 'schemas/style-spec.schema.json',
      '.well-known/mcp.json', '.well-known/mcp/server-card.json', '.well-known/ai-catalog.json',
      'sitemap.xml',
      'skills/agentic-mermaid-diagram-workflow/SKILL.md', '_headers', '_redirects',
    ]
    for (const route of routes) expect({ route, exists: existsSync(join(SITE, route)) }).toEqual({ route, exists: true })
    // Removed: React + Config folded into the API doc, Vocabulary into Getting
    // started, Evidence into Quality, Releases demoted to capabilities.json,
    // and Skills / Security / Source-level pruned. The site has not launched, so
    // these routes are simply gone — no backwards-compat redirects.
    const consolidated = ['docs/config/index.html', 'docs/react/index.html', 'docs/vocabulary/index.html', 'evidence/index.html', 'releases/index.html', 'skills/index.html', 'security/index.html', 'docs/source-level/index.html', 'docs/families/index.html']
    for (const route of consolidated) expect({ route, exists: existsSync(join(SITE, route)) }).toEqual({ route, exists: false })
    expect(existsSync(join(SITE, 'install/index.html'))).toBe(false)
    expect(existsSync(join(SITE, 'agents/index.html'))).toBe(false)
    expect(existsSync(join(SITE, 'agents/harnesses/index.html'))).toBe(false)
    expect(existsSync(join(SITE, 'agents/workflow/index.html'))).toBe(false)
  })

  test('sitemap.xml lists exactly the live HTML pages and no machine artifacts', () => {
    const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!)
    expect(new Set(locs).size).toBe(locs.length)                  // no duplicate URLs
    for (const loc of locs) expect({ loc, ok: loc.startsWith('https://agentic-mermaid.dev/') }).toEqual({ loc, ok: true })
    expect(locs).toContain('https://agentic-mermaid.dev/')        // homepage
    expect(locs).toContain('https://agentic-mermaid.dev/docs/api/')
    expect(locs).toContain('https://agentic-mermaid.dev/docs/custom-styles/')
    for (const gone of ['/security/', '/skills/', '/docs/source-level/', '/docs/families/', '/evidence/', '/releases/', '/docs/react/', '/docs/config/', '/docs/vocabulary/']) {
      expect({ gone, listed: locs.includes(`https://agentic-mermaid.dev${gone}`) }).toEqual({ gone, listed: false })
    }
    // machine artifacts (json/md/txt/xml) must never appear as sitemap URLs
    for (const loc of locs) expect({ loc, machine: /\.(json|md|txt|xml)$/.test(loc) }).toEqual({ loc, machine: false })
    // exactly one <loc> per emitted index.html page
    const pageCount = files().filter((r) => r === 'index.html' || r.endsWith('/index.html')).length
    expect(locs.length).toBe(pageCount)
  })

  test('robots.txt is not shipped from the repo (Cloudflare serves the managed one)', () => {
    expect(existsSync(join(SITE, 'robots.txt'))).toBe(false)
  })

  test('every warning and error page has a Markdown sibling with prose', () => {
    const codes = readdirSync(join(SITE, 'warnings')).filter((n) => existsSync(join(SITE, 'warnings', n, 'index.html')))
    expect(codes.length).toBeGreaterThanOrEqual(22)
    for (const code of codes) {
      const md = read(`warnings/${code}/index.md`)
      expect({ code, ok: md.startsWith(`# ${code}`) && md.includes('am verify') }).toEqual({ code, ok: true })
    }
    for (const id of ['parse-error', 'mutation-error', 'render-error', 'verify-failed']) {
      const md = read(`errors/${id}/index.md`)
      expect({ id, ok: md.includes('## How to recover') }).toEqual({ id, ok: true })
    }
  })

  test('capabilities.json warning codes carry what/triggers/fix prose as clean text', () => {
    const cap = JSON.parse(read('capabilities.json'))
    const sample = cap.warningCodes.find((w: { code: string }) => w.code === 'LABEL_OVERFLOW')
    expect(Boolean(sample)).toBe(true)
    for (const field of ['what', 'triggers', 'fix'] as const) {
      expect({ field, filled: typeof sample[field] === 'string' && sample[field].length > 20 }).toEqual({ field, filled: true })
    }
    expect(sample.fix.includes('<code>')).toBe(false)             // Markdown, not page HTML
  })

  test('the four error pages are differentiated, not shared boilerplate', () => {
    const body = (id: string) => read(`errors/${id}/index.html`).replace(/[\s\S]*<\/section>/, '').replace(/<\/main>[\s\S]*/, '')
    const bodies = ['parse-error', 'mutation-error', 'render-error', 'verify-failed'].map(body)
    expect(new Set(bodies).size).toBe(4)
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

  test('public site and editor ship the diagram fonts used by built-in looks', () => {
    const styles = read('styles.css')
    const editor = read('editor/index.html')
    expect(readRepo('website/source/assets/styles.css')).not.toContain('@font-face')
    for (const font of HOSTED_FONT_FACES) {
      const publicFace = `@font-face { font-family: '${font.family}'; src: url('/fonts/${font.file}') format('truetype'); font-weight: ${font.weight}; font-style: ${font.style}; font-display: swap; }`
      expect(styles).toContain(publicFace)
      expect(editor).toContain(publicFace)
    }
    for (const file of HOSTED_FONT_FILES) {
      const rel = `fonts/${file}`
      expect({ rel, exists: existsSync(join(SITE, rel)) }).toEqual({ rel, exists: true })
    }
    const editorScript = read(editorScriptRel(editor))
    const presetFonts = readJsonGlobal<Array<{ name: string; value: string; group: string }>>(editorScript, 'EDITOR_PRESET_FONTS')
    const hostedFamilies = Array.from(new Set(HOSTED_FONT_FACES.map((font) => font.family)))
    expect(presetFonts.filter((font) => font.group === 'Self-hosted').map((font) => font.value)).toEqual(hostedFamilies)
    const allowedSystem = new Set(['system-ui', 'Arial', 'Georgia', 'Courier New'])
    for (const font of presetFonts) {
      expect({ font: font.value, hostedOrSystem: hostedFamilies.includes(font.value) || allowedSystem.has(font.value) }).toEqual({ font: font.value, hostedOrSystem: true })
    }
    expect(editorScript).not.toContain('Poppins')
    const editorBuilder = readFileSync(join(REPO, 'scripts/site/editor.ts'), 'utf8')
    const websiteBuilder = readFileSync(join(REPO, 'website/build.ts'), 'utf8')
    expect(editorBuilder).toContain("AM_EDITOR_FONT_PREFIX || 'assets/fonts/'")
    expect(websiteBuilder).toContain("AM_EDITOR_FONT_PREFIX: '/fonts/'")
  })

  test('generated public text assets do not depend on external font imports', () => {
    const scanned = files().filter((f) => /\.(html|svg|css|md|txt|json)$/.test(f))
    const offenders = scanned.filter((f) => /fonts\.googleapis\.com|fonts\.gstatic\.com|@import\s+url\(['"]https:\/\/fonts/i.test(read(f)))
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
      expect(html).toContain('<link rel="alternate" type="application/json" href="/.well-known/mcp.json">')
      expect(html).toContain('<link rel="mcp-server" type="application/mcp-server-card+json" href="/.well-known/mcp/server-card.json">')
      expect(html).toContain('<link rel="ai-catalog" type="application/json" href="/.well-known/ai-catalog.json">')
    }
    expect(home).not.toContain('id="home-agent-pointer"')
    expect(home).not.toContain('id="home-agent-prompt"')
    expect(home).toContain('class="page-actions" aria-label="Primary paths"')
    expect(home).toContain('Use with an agent')
    expect(home).toContain('Try editor')
    expect(home).toContain('Install locally')
    expect(home).not.toContain('Copy agent prompt')
    const homeMain = home.slice(home.indexOf('<main'))
    expect(homeMain.indexOf('Use with an agent')).toBeLessThan(homeMain.indexOf('Try editor'))
    expect(homeMain.indexOf('Try editor')).toBeLessThan(homeMain.indexOf('Install locally'))
    expect(home).toContain('href="/editor/?empty=1">Try editor</a>')
    expect(homeMain.indexOf('data-copy-text="Fetch https://agentic-mermaid.dev/start.md and follow it."')).toBeLessThan(homeMain.indexOf('href="/editor/?empty=1"'))
    expect(homeMain.indexOf('href="/editor/?empty=1"')).toBeLessThan(homeMain.indexOf('href="/docs/getting-started/"'))
    expect(home).not.toContain('Give this to an agent')
    expect(home).not.toContain('This prompt is intentionally complete')
    expect(home).not.toContain('agent-prompt-first')
    expect(home).not.toContain('copy-prompt-card')
    expect(home).not.toContain('copy-prompt-primary')
    expect(home).not.toContain('Copy agent prompt')
    expect(home).not.toContain('class="agent-prompt')
    expect(home).not.toContain('&lt;replace with the requested diagram goal or edit&gt;')
    expect(home).not.toContain('contents of https://agentic-mermaid.dev/start.md')
    expect(home).not.toContain('Do not assume this repository is checked out')
    expect(home).not.toContain('the hosted MCP at `https://agentic-mermaid.dev/mcp`')
    expect(home).not.toContain('Mutation ops use a `kind` discriminator')
    expect(home).not.toContain('return an object with `{ source }`')
    expect(home).toContain('Beautiful diagrams,')
    expect(home).toContain('made with your agent')
    expect(home).toContain('choose a style and palette')
    expect(home).toContain('edits verified before they come back to you')
    expect(home).toContain('Strengths')
    expect(home).toContain('Polished output, deterministic source, agent-safe edits.')
    expect(home).toContain('Beautiful renders')
    expect(home).not.toContain('The problem')
    expect(home).not.toContain('Plain Mermaid handoff')
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
    expect(home).toContain('Prompt, style, verify')
    expect(home).toContain('publication-figure')
    expect(home).toContain('brand palette')
    expect(home).not.toContain('id="local-setup"')
    expect(home).toContain('Install locally in <a href="/docs/getting-started/">Getting started</a>')
    // The prompt is fetch-only; the full start.md panel is intentionally absent.
    expect(home).not.toContain('<details class="prompt-details">')
    expect(home.indexOf('data-copy-text="Fetch https://agentic-mermaid.dev/start.md and follow it."')).toBeLessThan(home.indexOf('id="quick-start-title"'))
    expect(home.indexOf('id="machine-context-title"')).toBeGreaterThan(home.indexOf('One source, three styles'))
    expect(gettingStarted).toContain('do not copy a long prompt from this page')
    expect(gettingStarted).toContain('Give it three things: your task, the Mermaid source, and one bootstrap line')
    expect(gettingStarted).toContain('Paste the task, paste the Mermaid source, then add this line')
    expect(gettingStarted).toContain('Fetch https://agentic-mermaid.dev/start.md and follow it.')
    expect(gettingStarted).toContain('That line is the only prompt to copy from this page')
    expect(gettingStarted).toContain('Copy this line on the homepage')
    expect(gettingStarted).toContain('Agent style/palette recipe')
    expect(gettingStarted).toContain('Keep appearance out of the Mermaid source')
    expect(gettingStarted).toContain("style: ['ops-schematic', 'nord-light']")
    expect(gettingStarted).toContain('--style ops-schematic,nord-light')
    expect(gettingStarted).toContain('Hosted MCP render_svg arguments')
    expect(gettingStarted).toContain('Style and Palette; in API, CLI, and MCP calls, agents can send the stack directly.')
    // Fetch flow: the primary CTA points at a hosted bootstrap that is actually
    // served and byte-identical to the source the eval treats as the canonical
    // protocol. The homepage does not inline a second copy.
    expect(home).toContain('Fetch https://agentic-mermaid.dev/start.md and follow it.')
    const served = read('start.md')
    expect(served).toContain('# Skill: Create or edit a Mermaid diagram with Agentic Mermaid')
    expect(served).toContain('## Step 1 — Establish one channel')
    expect(served).toContain('## Return')
    expect(served.trim()).toBe(readFileSync(join(REPO, 'website/source/start.md'), 'utf8').trim())
    expect(read('docs/getting-started/index.html')).toContain('From a prompt and style choice to a verified local render')
    expect(home).toContain('/examples/index.json')
    expect(home).toContain('/skills/agentic-mermaid-diagram-workflow/SKILL.md')
    expect(home).not.toContain('/schemas/index.json')
    expect(home).not.toContain('/recipes/index.json')
    expect(home).not.toContain('/agent-manifest.json')
    expect(home).not.toContain('/harnesses.json')
    expect(home).toContain('One source, three styles')
    expect(home).toContain('id="home-style-showcase-title"')
    expect(home).toContain('Seed changes only sketch noise; node positions and edge routes stay fixed.')
    expect(home).toContain('Each card uses the same Mermaid source with different render options')
    expect(home).toContain('Agents pass style, palette, and seed in the render call')
    expect(home).toContain('href="/examples/#examples-style-palette-combinations"')
    expect(home.match(/class="home-style-card"/g)?.length).toBe(3)
    expect(home).toContain('<li><span>Style</span><code>watercolor</code></li>')
    expect(home).toContain('<li><span>Palette</span><code>paper</code></li>')
    expect(home).toContain('<li><span>Seed</span><code>4</code></li>')
    expect(home).toContain('<li><span>Style</span><code>ops-schematic</code></li>')
    expect(home).toContain('<li><span>Palette</span><code>nord-light</code></li>')
    expect(home).toContain('<li><span>Seed</span><code>8</code></li>')
    expect(home).toContain('home-style-watercolor-svg-title')
    expect(home).toContain('home-style-ops-schematic-svg-title')
    expect(home).toContain('15</strong> built-in styles')
    expect(home).toContain('JSON</strong> custom styles')
    expect(home).not.toContain('class="unicode-diagram"')
    expect(examples).toContain('<p class="example-prompt"><span>Prompt</span>')
    expect(examples).toContain('<p class="example-trace"><span>Trace</span> <code>asFlowchart')
    const editorScript = editorScriptRel(editor)
    expect(existsSync(join(SITE, editorScript))).toBe(true)
    expect(read(editorScript)).toContain('createPopupController')
    expect(read(editorScript)).toContain('URLSearchParams(window.location.search).get(\'example\')')
    expect(read(editorScript)).not.toContain('buildAgentTaskPrompt')
    expect(editor).not.toContain('Copy agent prompt')
    expect(editor).not.toContain('id="copy-agent-prompt-btn"')
    expect(editor).toContain('class="app-brand" aria-label="Agentic Mermaid Editor home"')
    // Right half is labelled "Palette" (visible + a11y); code ids stay theme-*.
    expect(editor).toContain('<span class="axis-label" aria-hidden="true">Palette</span>')
    expect(editor).toContain('<span class="sr-only">Diagram palette: </span><span class="axis-value" id="theme-btn-label">Default</span>')
    expect(editor).toContain('id="theme-dropdown-menu" role="listbox" aria-label="Palette"')
    // Style and Palette are fused into one split pill (both dropdown ids preserved).
    expect(editor).toContain('class="axis-pill" role="group" aria-label="Diagram style and palette"')
    expect(editor).toContain('id="style-dropdown-btn"')
    expect(editor).toContain('id="theme-dropdown-btn"')
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
    const styles = read('styles.css')
    expect(docs).not.toContain('tufte-docs')
    expect(docs).not.toContain('/* ---- /docs in the Tufte idiom')
    expect(docs).toContain('class="doc"')
    expect(docs).toContain('Docs index')
    expect(editor).toContain('class="app-brand"')
    expect(editor).toContain('--t-bg: #F8F4F0')
    expect(editor).toContain('--control-bg: var(--surface)')
    expect(editor).toContain('top: var(--examples-top, 60px)')
    expect(editor).toContain('left: var(--examples-left, 16px)')
    expect(styles).toContain('surface primitives: panels share one shell')
    expect(styles).toContain(':where(.surface-panel, .quick-start, .agent-hero-primary, .copy-prompt-card')
    expect(styles).toContain(':where(.surface-panel-clip, .copy-prompt-card, .tabbed-card, .example-render, .comparison-panel)')
    expect(styles).toContain(':where(.media-frame, figure .plate, .gallery .plate)')
    expect(editor).toContain(':where(.examples-sidebar, .config-panel, .shortcuts-dialog-panel')
    expect(editor).not.toContain('border: 1px solid var(--control-border);\n  border-radius: var(--radius-lg);\n  background: var(--popover-bg);\n  box-shadow: var(--shadow-popover);\n  opacity: 0;')
    expect(editor).not.toContain('overflow-y: auto;\n  background: var(--popover-bg);\n  border: 1px solid var(--control-border);')
    expect(editor).not.toContain('backdrop-filter: blur(10px);\n  border: 1px solid var(--control-border);')
    expect(editor).not.toContain('flex: 0 0 284px')
    expect(editor).not.toContain('rgba(255,255,255,0.07)')
    expect(editor).not.toContain('id="pan-btn" type="button" title="Pan (hold to drag)" aria-label="Pan preview">')
  })

  test('home hero is baked artwork; the themeable demo asset keeps its var tokens', () => {
    // The hero once rendered with var(--bg/--fg/--accent) and silently re-themed
    // when the chrome accent moved to Pine. The design contract is the reverse:
    // diagram themes colour the artwork, the shell never does. Baked terracotta
    // ink with shell-ground halos in the hero; live var() tokens only in the
    // standalone themeable demo.
    const home = read('index.html')
    const hero = home.match(/<div class="plate dia-plate">[\s\S]*?<\/svg>/)?.[0] ?? ''
    expect(hero).toContain('#9A4A24')
    expect(/var\(--(accent|bg|fg)[,)]/.test(hero)).toBe(false)
    const themeable = read('diagrams/workflow-themeable.svg')
    expect(themeable).toContain('var(--accent')
    expect(themeable).toContain('var(--fg)')
  })

  test('masthead exposes examples, repository, and the editor with no footer chrome', () => {
    for (const rel of ['index.html', 'docs/index.html', 'about/index.html', 'examples/index.html', 'skills/agentic-mermaid-diagram-workflow/index.html']) {
      const html = read(rel)
      const masthead = html.match(/<header class="masthead"[\s\S]*?<\/header>/)?.[0] ?? ''
      expect(masthead).toContain('href="/examples/"')
      expect(masthead).toContain('href="/comparisons/"')
      expect(masthead).toContain('href="/about/"')
      expect(masthead).toContain('<a class="link-editor" href="/editor/?empty=1">Open editor</a>')
      expect(masthead).not.toContain('href="/editor/">Open editor</a>')
      const docsIndex = masthead.indexOf('href="/docs/"')
      const githubIndex = masthead.indexOf('href="https://github.com/adewale/agentic-mermaid"')
      const editorIndex = masthead.indexOf('href="/editor/?empty=1"')
      expect(docsIndex).toBeGreaterThanOrEqual(0)
      expect(githubIndex).toBeGreaterThan(docsIndex)
      expect(editorIndex).toBeGreaterThan(githubIndex)
      expect(html).not.toContain('<a href="/install/">Install</a>')
      expect(html).not.toContain('<a href="/agents/">Agents</a>')
      expect(html).not.toContain('class="crumb"')
      expect(html).not.toContain('Agentic Mermaid</a> /')
      expect(html).not.toContain('class="theme-switch"')
      expect(html).not.toContain('<footer')
      expect(html).not.toContain('class="footlinks"')
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
    const expectedRedirects = [...staticRedirectLines(), ...DYNAMIC_CLEAN_REDIRECT_LINES]
    expect(read('_redirects').trim().split('\n')).toEqual(expectedRedirects)
    expect([...CLEAN_PAGE_ROUTES].sort()).toEqual(staticCleanRoutesFromGeneratedPages())
    for (const route of CLEAN_PAGE_ROUTES) expect(existsSync(join(SITE, route, 'index.html'))).toBe(true)
    expect(read('_redirects')).toContain('/why /about/ 308')
    expect(read('_redirects')).toContain('/gallery /examples/ 308')
    expect(read('_redirects')).not.toContain('/docs/families /examples/ 308')
    expect(read('_redirects')).not.toContain('/docs/families/ /examples/ 308')
    expect(read('_redirects')).not.toContain('/families /examples/ 308')
    expect(read('_redirects')).not.toContain('/families/ /examples/ 308')
    expect(read('_redirects')).not.toContain('/agents')
    expect(read('_redirects')).not.toContain('agents-workflow')
    expect(read('_redirects')).not.toContain('.html')
    expect(read('_redirects')).not.toContain('/home')
    const styles = read('styles.css')
    expect(styles).toContain('.masthead .links .link-editor')
    expect(styles).not.toContain('footlinks')
    expect(styles).not.toContain('footer {')
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
    expect(styles).not.toContain('.unicode-diagram')
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
    expect(comparisons.match(/class="comparison-grid" data-comparison-lightbox-panel/g)?.length).toBe(12)
    expect(comparisons.match(/data-comparison-editor-href="\/editor\/#/g)?.length).toBe(12)
    expect(comparisons).not.toContain('comparison-source-actions')
    expect(comparisons).not.toContain('class="comparison-panel" data-comparison-engine="mermaid" data-comparison-lightbox-panel')
    expect(comparisons).not.toContain('comparison-focus')
    expect(comparisons).not.toContain('data-comparison-focus')
    expect(comparisons).not.toContain('Copy source')
    expect(comparisons).not.toContain('data-comparison-source-copy')
    expect(comparisons).not.toContain('data-copy-target="comparison-source-')
    expect(comparisons.match(/class="comparison-takeaway"/g)?.length).toBe(12)
    expect(comparisons).toContain('Read this page as evidence, not a shootout')
    expect(comparisons).toContain('id="comparison-style-matrix-title"')
    expect(comparisons).toContain('Style and palette support')
    expect(comparisons).toContain('This section uses one small source and shows where each renderer expects appearance controls to live.')
    expect(comparisons).toContain('id="comparison-style-demo-mermaid"')
    expect(comparisons).toContain('comparison-style-demo-grid')
    expect(comparisons).toContain('comparison-style-beautiful-svg-title')
    expect(comparisons).toContain('comparison-style-agentic-svg-title')
    expect(comparisons).toContain("style: ['watercolor', 'paper']")
    expect(comparisons).toContain('Host-owned runtime config')
    expect(comparisons).toContain('Render-call palette options')
    expect(comparisons).toContain('Composable style stack')
    expect(comparisons).toContain('edit typed source, verify it, then pass style and palette render options')
    expect(comparisons.indexOf('id="comparison-style-matrix-title"')).toBeGreaterThan(comparisons.lastIndexOf('id="gantt"'))
    expect(comparisons).not.toContain('>Focus view</button>')
    expect(comparisons).toContain('lightboxOpenLabel')
    expect(comparisons).toContain('data-comparison-dialog')
    expect(comparisons).toContain('comparison-detail-controls')
    expect(comparisons).toContain('comparison-pair-control')
    expect(comparisons).toContain('comparison-zoom-control')
    expect(comparisons).toContain('comparison-source-tools')
    expect(comparisons).toContain('data-comparison-source-editor')
    expect(comparisons).toContain('data-comparison-pair')
    expect(comparisons).toContain('data-comparison-zoom')
    expect(comparisons).toContain('data-zoom-step')
    expect(comparisons).toContain('data-zoom-reset')
    expect(comparisons).toContain('fitWidthForPanel')
    expect(comparisons).toContain('shortLandscape')
    expect(comparisons).toContain('editorHrefForSection')
    expect(comparisons).toContain('updateSourceControls')
    expect(comparisons).toContain('openComparison')
    expect(comparisons).toContain('setLightboxTriggers')
    expect(comparisons).toContain('data-comparison-open')
    expect(comparisons).toContain('Open larger comparison')
    expect(comparisons).toContain("button.addEventListener('click'")
    expect(comparisons).toContain("group.addEventListener('click'")
    expect(comparisons).toContain("group.addEventListener('keydown'")
    expect(comparisons).toContain("value: 'agentic-mermaid'")
    expect(comparisons).toContain("value: 'agentic-beautiful'")
    expect(comparisons).toContain("value: 'mermaid-beautiful'")
    expect(comparisons).toContain("role: 'tab'")
    expect(comparisons).toContain("'data-detail-tab': 'compare'")
    expect(comparisons).toContain("'data-detail-tab': 'first'")
    expect(comparisons).toContain("'data-detail-tab': 'second'")
    for (const id of ['flowchart', 'state', 'sequence', 'class', 'er', 'xychart', 'timeline', 'journey', 'architecture', 'pie', 'quadrant', 'gantt']) {
      expect(comparisons).toContain(`id="${id}"`)
      expect(comparisons).toContain(`id="comparison-mermaid-${id}"`)
      expect(comparisons).toContain(`comparison-agentic-${id}-svg-title`)
      const section = comparisons.match(new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?<\\/section>`))?.[0] ?? ''
      expect(section).toContain('data-comparison-engine="mermaid"')
      expect(section).toContain('data-comparison-engine="agentic"')
      expect(section).toContain('data-comparison-editor-href="/editor/#')
      expect(section).not.toContain('>Open in Editor</a>')
    }
    expect(comparisons).toContain('Source([Source]) --&gt; Parse[Parse]')
    expect(comparisons).toContain('Render --&gt; Cache[(Cache)]')
    expect(comparisons).not.toContain('Start([Start]) --&gt; Parse[Parse]')
    expect(comparisons).toContain('group app(cloud)[Application]')
    expect(comparisons).not.toContain('group client(cloud)[Client]')
    for (const id of ['flowchart', 'state', 'sequence', 'class', 'er', 'xychart']) {
      const section = comparisons.match(new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?<\\/section>`))?.[0] ?? ''
      expect(section).toContain('data-comparison-engine="beautiful"')
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
    const styles = read('styles.css')
    expect(styles).toContain('--comparison-panel-zoom-width')
    expect(styles).toContain('.comparison-mermaid { width: 100%;')
    expect(styles).toContain('.comparison-panel[data-comparison-engine="mermaid"] .comparison-render svg')
    expect(styles).toContain('.comparison-zoom-row')
    expect(styles).toContain('.comparison-source-tools')
    expect(styles).toContain('.comparison-style-matrix')
    expect(styles).toContain('.comparison-open')
    expect(styles).toContain('.comparison-style-demo-grid')
    expect(styles).toContain('.home-style-showcase-grid')
    expect(styles).toContain('.home-style-card { min-width: 0; display: grid; grid-template-rows: 300px 1fr;')
    expect(styles).not.toContain('.contrast-col-mutate { border-color: color-mix')
    expect(read('index.html')).not.toContain('contrast-col-mutate')
    expect(styles).not.toContain('.comparison-source-actions')
    expect(styles).toContain('@media (max-height: 480px) and (orientation: landscape)')
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto')
    expect(styles).toContain('overflow-x: visible')
    expect(styles).toContain('.comparison-case > .comparison-grid[data-comparison-lightbox-panel]')
    expect(styles).toContain('cursor: zoom-in')
    expect(styles).not.toContain('.comparison-grid .comparison-panel[data-comparison-lightbox-panel]')
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
    expect(examples).not.toContain('Role style presets')
    expect(examples).not.toContain('id="styled-flowchart"')
    const styles = read('styles.css')
    expect(styles).toContain('.example-prompt, .example-trace')
    expect(examples).toContain('class="example-jump"')
    expect(examples).toContain('Jump to a diagram family')
    const jump = examples.match(/<nav class="example-jump"[\s\S]*?<\/nav>/)?.[0] ?? ''
    expect(jump).not.toContain('examples-role-style-presets-jump')
    expect(jump).toContain('<p class="example-jump-title" id="examples-style-palette-combinations-jump">Style × palette combinations</p>')
    expect(jump).toContain('<p class="example-jump-title" id="examples-rich-gallery-jump">Rich shared example gallery</p>')
    for (const id of ['flowchart', 'state', 'architecture', 'sequence', 'class', 'er', 'timeline', 'journey', 'xychart', 'pie', 'quadrant', 'gantt']) {
      expect(examples).toContain(`<article class="example-sample" id="style-palette-${id}">`)
      expect(jump).toContain(`href="#style-palette-${id}"`)
    }
    expect(examples).toContain('Agents pass this as render options; they do not edit Mermaid source just to change appearance.')
    expect(examples).toContain("<code>style: ['ops-schematic', 'nord-light'], seed: 8</code>")
    expect(examples).toContain('Open styled</a>')
    expect(examples).toContain('<h2 id="examples-rich-gallery">Rich shared example gallery</h2>')
    expect(examples).toContain('Build-time proof from the shared examples corpus.')
    expect(jump).not.toContain('class="example-jump-more"')
    expect(examples).not.toContain('id="example-filter"')
    expect(examples).not.toContain('data-example-filter')
    expect(styles).not.toContain('.example-tools')
    expect(styles).not.toContain('.example-jump-more')
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
    expect(editor).not.toContain('<span>Copy agent prompt</span>')
    expect(editor).not.toContain('<span>Agent prompt</span>')
    expect(editor).not.toContain('id="seed-shuffle-btn"')
    expect(editor).not.toContain('Re-roll style ink')
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
    for (const rel of ['capabilities.json', 'examples/index.json', '.well-known/mcp.json', '.well-known/mcp/server-card.json', '.well-known/ai-catalog.json']) {
      const json = JSON.parse(read(rel))
      expect({ rel, generatedFrom: Boolean(json.generatedFrom) }).toEqual({ rel, generatedFrom: true })
    }
    for (const rel of ['agent-manifest.json', 'harnesses.json', 'recipes/index.json', 'skills/index.json', 'schemas/index.json']) {
      expect({ rel, exists: existsSync(join(SITE, rel)) }).toEqual({ rel, exists: false })
    }
    expect(existsSync(join(SITE, 'skills/agentic-mermaid-diagram-workflow/SKILL.md'))).toBe(true)
    expect(read('llms.txt')).toContain('/skills/agentic-mermaid-diagram-workflow/SKILL.md')
    expect(read('llms.txt')).toContain('[MCP server card](https://agentic-mermaid.dev/.well-known/mcp/server-card.json)')
    expect(read('llms.md')).toBe(read('llms.txt'))
    expect(read('.well-known/llms.txt')).toBe(read('llms.txt'))
    expect(read('llms.txt')).not.toContain('/agent-manifest.json')
    expect(read('llms.txt')).not.toContain('/recipes/index.json')
    const mcpCard = JSON.parse(read('.well-known/mcp/server-card.json'))
    expect(mcpCard.serverUrl).toBe('https://agentic-mermaid.dev/mcp')
    expect(mcpCard.wellKnownUrl).toBe('https://agentic-mermaid.dev/.well-known/mcp')
    expect(mcpCard.transport).toBe('streamable-http')
    expect(mcpCard.tools.map((tool: any) => tool.name)).toEqual(['execute', 'render_svg', 'render_ascii', 'render_png', 'verify', 'describe', 'mutate', 'build'])
    expect(mcpCard.tools.every((tool: any) => tool.annotations?.destructiveHint === false)).toBe(true)
    expect(mcpCard.tools.every((tool: any) => tool.parameters && typeof tool.parameters === 'object')).toBe(true)
    expect(read('.well-known/mcp.json')).toContain('"serverUrl": "https://agentic-mermaid.dev/mcp"')
    const aiCatalog = JSON.parse(read('.well-known/ai-catalog.json'))
    expect(aiCatalog.entries.map((entry: any) => entry.type)).toContain('application/mcp-server-card+json')
    expect(aiCatalog.entries.map((entry: any) => entry.url)).toContain('https://agentic-mermaid.dev/.well-known/mcp/server-card.json')
    const capabilities = JSON.parse(read('capabilities.json'))
    expect(capabilities.families.map((family: any) => family.id)).toContain('flowchart')
    expect(capabilities.warningCodes.map((warning: any) => warning.tier)).toContain('structural')
    const examplesIndex = JSON.parse(read('examples/index.json'))
    expect(examplesIndex.examples.map((example: any) => example.id)).toEqual(editorExampleIds())
    const editorRuntime = read(editorScriptRel(read('editor/index.html')))
    expect(editorRuntime.indexOf('var EDITOR_EXAMPLES = ')).toBeGreaterThanOrEqual(0)
    expect(editorRuntime.indexOf('var EDITOR_EXAMPLES = ')).toBeLessThan(editorRuntime.indexOf('function cloneEditorConfig'))
    expect(readJsonGlobal<unknown>(editorRuntime, 'EDITOR_EXAMPLES')).toEqual(JSON.parse(JSON.stringify(EDITOR_EXAMPLES)))
    expect(examplesIndex.richExamples).toEqual(RICH_EXAMPLES.map((sample, index) => ({
      id: richExampleId(sample, index),
      category: sample.category ?? 'Examples',
      title: sample.title,
      description: sample.description,
      source: String(sample.source ?? '').trim(),
      options: sample.options ?? {},
      renderUrl: `/examples/#${richExampleId(sample, index)}`,
      editorUrl: expect.stringContaining('/editor/#'),
    })))
    expect(examplesIndex.richExamples.some((example: any) => example.category === 'Style + Palette')).toBe(true)
    const examplesHtml = read('examples/index.html')
    expect(examplesHtml).toContain('Build-time proof: rendered from the same source the editor loads.')
    expect(examplesHtml).toContain('Build-time proof from the shared examples corpus.')
    expect(examplesHtml).toContain('--accent:#1A7351')
    expect(examplesHtml).not.toContain('Role style presets')
    expect(examplesHtml).not.toContain('semantic role')
    for (const example of examplesIndex.examples) {
      const renderAnchor = example.renderUrl.split('#')[1]
      const docsAnchor = example.docs.split('#')[1]
      expect(example.renderUrl.startsWith('/examples/#')).toBe(true)
      expect(examplesHtml).toContain(`id="${renderAnchor}"`)
      expect(example.docs.startsWith('/examples/#')).toBe(true)
      expect(examplesHtml).toContain(`id="${docsAnchor}"`)
      expect(example.editorUrl).toContain('/editor/?example=')
    }
  })

  test('custom style docs publish schema, examples, and screenshots', () => {
    const schema = JSON.parse(read('schemas/style-spec.schema.json'))
    expect(schema.$id).toBe('https://agentic-mermaid.dev/schemas/style-spec.schema.json')
    const page = read('docs/custom-styles/index.html')
    expect(page).toContain('/schemas/style-spec.schema.json')
    expect(page).toContain('/examples/styles/transit-route-map.style.json')
    expect(page).toContain('/docs/assets/style-cookbook/transit-route-map.png')
    for (const rel of [
      'examples/styles/transit-route-map.style.json',
      'examples/styles/mid-century-report.style.json',
      'examples/styles/star-chart-atlas.style.json',
      'docs/assets/style-cookbook/transit-route-map.png',
      'docs/assets/style-cookbook/mid-century-report.png',
      'docs/assets/style-cookbook/star-chart-atlas.png',
    ]) {
      expect({ rel, exists: existsSync(join(SITE, rel)) }).toEqual({ rel, exists: true })
    }
  })

  test('MCP claims cover the hosted endpoint without a stale public harness manifest', () => {
    expect(existsSync(join(SITE, 'harnesses.json'))).toBe(false)
    const publicText = files().filter((f) => /\.(html|json|md|txt)$/.test(f)).map(read).join('\n')
    expect(publicText).toContain('execute</code>, <code>render_png</code>, and <code>describe</code>')
    expect(publicText).toContain('https://agentic-mermaid.dev/mcp')
    expect(publicText).toContain('https://agentic-mermaid.dev/.well-known/mcp')
    expect(publicText).toContain('https://agentic-mermaid.dev/.well-known/mcp/server-card.json')
    expect(publicText).toContain('render_svg')
    expect(publicText).toContain('render_ascii')
    // The 501 placeholder era is over; no page may still claim it.
    expect(publicText).not.toContain('returns a 501')
    expect(publicText).not.toContain('render verify describe mutate')
    expect(publicText).not.toContain('The skill never runs Code Mode')
  })

  test('published npm release copy is present', () => {
    const publicText = files().filter((f) => /\.(html|json|md|txt)$/.test(f)).map(read).join('\n')
    expect(publicText).toContain('npm i agentic-mermaid')
    expect(publicText).not.toContain('The npm package is not yet published; install from source.')
  })

  test('audit fixes keep hidden UI inert, shortcuts scoped, and mobile tables responsive', () => {
    const editor = read('editor/index.html')
    const editorRuntime = read(editorScriptRel(editor))
    const editorAll = editor + '\n' + editorRuntime
    const styles = read('styles.css')
    const theme = read('theme.js')
    const copyFeedback = readRepo('shared/browser/copy-feedback.js').trimEnd()
    const home = read('index.html')
    expect(editor).toContain('id="examples-sidebar" aria-label="Example diagrams" aria-hidden="true" inert')
    expect(editor).toContain('id="config-view" role="dialog" aria-modal="false" aria-label="Diagram settings" hidden aria-hidden="true" inert')
    expect(editorAll).toContain('setExamplesSidebarOpen(false);')
    expect(editorAll).toContain('setSettingsOpen(false);')
    expect(editorAll).not.toContain("e.key.toLowerCase() === 'c'")
    expect(editorAll).not.toContain('aria-keyshortcuts="Meta+C Control+C"')
    expect(theme).not.toContain('am-theme')
    expect(theme.startsWith(copyFeedback)).toBe(true)
    expect(editorAll).toContain(copyFeedback)
    expect(theme.match(/function setCopyFeedback/g)?.length).toBe(1)
    expect(editorAll.match(/function setCopyFeedback/g)?.length).toBe(1)
    expect(readRepo('editor/js/helpers.js')).not.toContain('function setCopyFeedback')
    expect(theme).toContain("name + ' copied to clipboard.'")
    // Copy feedback must reserve the button's resting width before swapping in the
    // shorter "Copied" label, so the hero's flex neighbours don't slide sideways.
    expect(theme).toContain("btn.style.minWidth = Math.ceil(btn.getBoundingClientRect().width)")
    expect(theme).toContain("btn.style.minWidth = ''")
    // The editor's shared copy feedback reserves width the same way for labelled
    // copy buttons before swapping in the shorter feedback text.
    expect(editorAll).toContain("btn.style.minWidth = Math.ceil(btn.getBoundingClientRect().width)")
    // The Share and "?" buttons are gone from the topbar; copy-link lives on in
    // the export dropdown and the cheat sheet is reached by the "?" key alone.
    expect(editor).not.toContain('id="share-btn"')
    expect(editor).not.toContain('id="shortcuts-btn"')
    expect(editor).toContain('id="copy-link-btn"')
    // "?" opens the cheat sheet without a trigger button, and it renders as a
    // Gmail-style scrim + panel (aria-modal, backdrop click closes).
    expect(editorAll).toContain("shortcutsReturnFocus = document.activeElement")
    expect(editor).toContain('id="shortcuts-dialog" role="dialog" aria-modal="true"')
    expect(editor).toContain('class="shortcuts-dialog-panel"')
    expect(styles).toContain('@media (forced-colors: active)')
    expect(styles).toContain('.warning-table thead { display: none; }')
    expect(read('warnings/index.html')).toContain('<td data-label="Code">')
    expect(read('warnings/index.html')).toContain('data-warning-filter')
    expect(read('warnings/index.html')).toContain('Fix structural first')
    expect(read('docs/getting-started/index.html')).toContain('Self-hosting over stdio is the default path')
    expect(editor).toContain('aria-haspopup="dialog"')
    expect(editor).toContain('id="export-dropdown" role="dialog" aria-modal="false" aria-label="Export options"')
    expect(editor).not.toContain('role="menu" aria-label="Export options"')
    expect(editorAll).not.toContain("setAttribute('role', 'menuitem')")
    expect(editor).toContain('id="font-popup" role="dialog" aria-modal="false" aria-label="Font picker"')
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
    expect(duplicateEdge).toContain('Minimal reproducer')
    expect(duplicateEdge).toContain('Open this reproducer in the editor')
    expect(duplicateEdge).toContain('open a blank editor')
    const warningsIndex = read('warnings/index.html')
    expect(warningsIndex).toContain('class="tier-badge tier-structural"')
    expect(warningsIndex).toContain('class="sev-badge sev-warning"')
    expect(read('examples/index.html')).toContain('class="example-jump"')
    for (const rel of ['index.html', 'docs/index.html', 'editor/index.html', 'warnings/NODE_OVERLAP/index.html']) {
      const html = read(rel)
      expect({ rel, og: html.includes('property="og:title"') }).toEqual({ rel, og: true })
      expect({ rel, tw: html.includes('name="twitter:card"') }).toEqual({ rel, tw: true })
      expect({ rel, canonical: html.includes('<link rel="canonical" href="https://agentic-mermaid.dev/') }).toEqual({ rel, canonical: true })
      expect({ rel, image: html.includes('<meta property="og:image" content="https://agentic-mermaid.dev/og-image.png">') }).toEqual({ rel, image: true })
    }
    const homeJsonLd = read('index.html').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1]
    expect(Boolean(homeJsonLd)).toBe(true)
    const graph = JSON.parse(homeJsonLd!)['@graph']
    expect(graph.map((node: any) => node['@type'])).toEqual(expect.arrayContaining(['Organization', 'SoftwareApplication', 'Service', 'WebPage', 'FAQPage']))
    expect(graph.find((node: any) => node['@type'] === 'Organization').contactPoint.url).toBe('https://github.com/adewale/agentic-mermaid/issues')
    expect(graph.find((node: any) => node['@type'] === 'Organization').address.addressCountry).toBe('US')
    expect(graph.find((node: any) => node['@type'] === 'WebPage').speakable.cssSelector).toContain('h1')
    // The editor verdict is truthful copy, not the old overclaim.
    const editorScript = read(editorScriptRel())
    expect(editorScript).toContain('Verified: no warnings')
    expect(editorScript).not.toContain('Verified: safe to export')
    expect(editorScript).toContain('Diagram too large for text rendering')
  })

  test('public llms.txt omits repo-only backlog and eval surfaces', () => {
    const text = read('llms.txt')
    expect(text).toStartWith('# Agentic Mermaid\n\n> Agent-native Mermaid runtime:')
    expect(text).toContain('[Agent bootstrap](https://agentic-mermaid.dev/start.md)')
    expect(text).toContain('[Capabilities](https://agentic-mermaid.dev/capabilities.json)')
    expect(text).toContain('Use Agentic Mermaid when an agent needs to create, edit, verify, describe, or render Mermaid diagrams')
    expect(text).toContain('## Start Here')
    expect(text).toContain('## Optional')
    expect(text).not.toContain('TODO.md')
    expect(text).not.toContain('skill-evals/')
    expect(text).toContain('/capabilities.json')
  })

  test('audit fixes give public proof diagrams accessible names and immutable editor assets', () => {
    const home = read('index.html')
    const examples = read('examples/index.html')
    const workerCore = readFileSync(join(REPO, 'website/src/worker-core.ts'), 'utf8')
    expect(home).toContain('role="img" aria-labelledby="edit-loop-svg-title edit-loop-svg-desc"')
    expect(home).toContain('<title id="edit-loop-svg-title">Agentic Mermaid edit loop</title>')
    expect(examples).toContain('role="img" aria-labelledby="example-flowchart-basic-svg-title example-flowchart-basic-svg-desc"')
    expect(examples).toContain('<title id="example-flowchart-basic-svg-title">Flowchart diagram</title>')
    expect(examples).toContain('aria-labelledby="example-timeline-basic-svg-title example-timeline-basic-svg-desc"')
    expect(examples).toContain('aria-labelledby="example-journey-basic-svg-title example-journey-basic-svg-desc"')
    expect(examples).not.toContain('aria-labelledby="tl-')
    expect(examples).not.toContain('aria-labelledby="journey-')
    expect(read('_headers')).not.toContain('Cache-Control')
    expect(workerCore).toContain("headers.delete('Cache-Control')")
    expect(workerCore).toContain("/^\\/(?:editor\\/editor-[a-f0-9]{12}|vendor\\/mermaid-[a-f0-9]{12}\\.min)\\.js$/i.test(pathname)")
    expect(workerCore).toContain("public, max-age=31536000, immutable")
    expect(read('shader-mark.js')).toContain('runs a short sweep only on direct hover/focus')
    expect(read('shader-mark.js')).not.toContain('requestAnimationFrame(frame);\n    }\n    requestAnimationFrame(frame);')
  })
})
