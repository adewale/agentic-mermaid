import { describe, expect, test } from 'bun:test'
import { parse } from 'acorn'
import { runInNewContext } from 'node:vm'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { EDITOR_EXAMPLES } from '../../editor/examples.ts'
import { samples as RICH_EXAMPLES } from '../../scripts/site/samples-data.ts'
import { decodeEditorStateHash, EDITOR_SHARE_STATE_KEYS } from '../../scripts/site/editor-state-url.ts'
import { createStyledExampleRenderState, WEBSITE_EXAMPLE_THEME } from '../../scripts/site/example-render-state.ts'
import { LEGACY_RICH_EXAMPLE_ALIASES } from '../../scripts/site/website-example-legacy-aliases.ts'
import { renderWebsiteSVG } from '../../website/src/rendering.ts'
import { createWebsiteWorker } from '../../website/src/worker-core.ts'
import { CLEAN_PAGE_ROUTES, DYNAMIC_CLEAN_REDIRECT_LINES, staticRedirectLines } from '../../website/src/site-routes.ts'
import { HOSTED_FONT_RESOURCES } from '../font-manifest.ts'
import { PNG_WASM_RUNTIME } from '../png-contract.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { resolveBuildGitSha } from '../../website/build-provenance.ts'
import { AI_CATALOG_RESOURCES } from '../../website/agent-resource-inventory.ts'
import { ensureWebsiteBuilt } from './website-public-fixture.ts'
import { evaluateBrowserScript, FakeDocument, manualTimers, runBrowserScriptInContext } from './browser-script-harness.ts'

ensureWebsiteBuilt()
import { HOSTED_TOOLS, SUPPORTED_PROTOCOL_VERSIONS } from '../mcp/hosted-server.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { SHARED_RENDER_OPTION_FIELDS, sharedRenderOptionsJsonSchema, validateSerializableRenderOptions } from '../render-contract.ts'
import { knownStyleDescriptors } from '../scene/style-registry.ts'
import { resolveEditorRenderOptions } from '../editor-render-options.ts'
import { useTestChildren } from './helpers/test-child.ts'

const runChild = useTestChildren(20_000)

const REPO = join(import.meta.dir, '..', '..')
const SITE = join(REPO, 'website', 'public')
const TEST_PNG_RECEIPT = { version: 2, output: 'png', sharedRequestDigest: 'test-shared', requestDigest: 'test-request', appearanceDigest: 'test-appearance', capabilityDecision: { version: 1, accepted: true, resolutions: [] } } as const

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

function examplesCatalogHtml() {
  return [read('examples/index.html'), read('examples/style-palette/index.html'), read('examples/corpus/index.html')].join('\n')
}

function exampleFragmentRels(index = read('examples/index.html')) {
  return Array.from(index.matchAll(/data-example-fragment="\/([^"]+)"/g), match => `${match[1]!}.html`)
}

function editorExampleIds() {
  return EDITOR_EXAMPLES.map((example) => example.id)
}

function exampleSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function richExampleId(sample: { title: string; anchor?: string }) {
  return `rich-${sample.anchor ?? exampleSlug(sample.title)}`
}

function richExampleArticle(html: string, sample: { title: string }) {
  const start = html.indexOf(`<article class="example-sample example-sample-palette" id="${richExampleId(sample)}"`)
  expect(start, `${sample.title} palette article`).toBeGreaterThanOrEqual(0)
  const end = html.indexOf('</article>', start)
  expect(end, `${sample.title} palette article end`).toBeGreaterThan(start)
  return html.slice(start, end)
}

function matches(source: string, pattern: RegExp) {
  return Array.from(source.matchAll(pattern))
}

function decodeEditorStateHref(href: string): Record<string, unknown> {
  const hash = href.split('#')[1] ?? ''
  return decodeEditorStateHash(hash) as unknown as Record<string, unknown>
}

function editorRenderOptionsFromState(state: Record<string, unknown>): Record<string, unknown> {
  return resolveEditorRenderOptions(state, {
    allowedFields: SHARED_RENDER_OPTION_FIELDS,
    validate: validateSerializableRenderOptions,
    resolvePaletteInput: (palette) => {
      if (typeof palette !== 'string' || !palette) return ''
      const descriptor = knownStyleDescriptors().find(candidate => {
        const localName = candidate.identity.id.slice(candidate.identity.id.indexOf(':') + 1)
        return candidate.kind === 'palette'
          && (candidate.inputName === palette || candidate.identity.id === palette || localName === palette)
      })
      return descriptor?.inputName ?? ''
    },
  }) as Record<string, unknown>
}

function removeWebsiteExampleAccessibleName(svg: string): string {
  return svg
    .replace(/^<svg\b([^>]*)>/, (_root, attrs: string) => `<svg${attrs.replace(/\s(?:role="img"|aria-(?:label|labelledby|describedby)="[^"]*")/g, '')}>`)
    .replace(/^(<svg\b[^>]*>)(?:\s*<(title|desc)\b[^>]*>[\s\S]*?<\/\2>)+/, '$1')
}

function sourcePeerLabels(category: string, source: string) {
  if (category === 'Pie') return matches(source, /^\s*"([^"]+)"\s*:/gm).map(match => match[1]!)
  if (category === 'Radar') return matches(source, /^\s*curve\s+\S+?\["([^"]+)"\]/gm).map(match => match[1]!)
  if (category === 'XY Chart') return matches(source, /^\s*(?:bar|line)\s+([A-Za-z][\w-]*)\s+\[/gm).map(match => match[1]!)
  if (category === 'Journey') {
    return Array.from(new Set(source.split('\n').flatMap((line) => {
      const match = line.match(/:\s*[1-5]\s*:\s*(.+)$/)
      return match ? match[1]!.split(',').map(actor => actor.trim()).filter(Boolean) : []
    })))
  }
  if (category === 'Mindmap') return matches(source, /^ {4}([^\s].*)$/gm).map(match => match[1]!.trim())
  if (category === 'GitGraph') {
    const mainOrder = Number(source.match(/^\s*mainBranchOrder:\s*(\d+)/m)?.[1])
    const ordered = matches(source, /^\s*branch\s+(\S+)\s+order:(\d+)/gm)
      .map(match => ({ label: match[1]!, order: Number(match[2]) }))
    ordered.push({ label: 'main', order: mainOrder })
    return ordered.sort((a, b) => a.order - b.order).map(entry => entry.label)
  }
  return []
}

function renderedPeerMapping(category: string, article: string): Array<[string, string]> {
  if (category === 'Pie') {
    return matches(article, /<path class="pie-slice"[^>]*\sdata-label="([^"]+)"[^>]*\sfill="(#[0-9a-f]{6})"/gi)
      .map(match => [match[1]!, match[2]!.toLowerCase()])
  }
  if (category === 'Radar') {
    return matches(article, /<path class="radar-area"[^>]*\sdata-curve="([^"]+)"[^>]*\sfill="(#[0-9a-f]{6})"/gi)
      .map(match => [match[1]!, match[2]!.toLowerCase()])
  }
  if (category === 'XY Chart') {
    const colors = new Map(matches(article, /--xychart-color-(\d+):\s*(#[0-9a-f]{6})/gi)
      .map(match => [Number(match[1]), match[2]!.toLowerCase()] as const))
    const colorIndexes = matches(article, /<path[^>]*class="xychart-line xychart-color-(\d+)"[^>]*data-role="series"/gi)
      .map(match => Number(match[1]))
    const labels = matches(article, /class="xychart-legend-label"[^>]*>([^<]+)<\/text>/g).map(match => match[1]!)
    expect(colorIndexes, 'XY rendered series/legend alignment').toHaveLength(labels.length)
    return labels.map((label, index) => [label, colors.get(colorIndexes[index]!)!])
  }
  if (category === 'Journey') {
    const legend = article.match(/<g class="journey-actor-legend">([\s\S]*?)<\/g>/)?.[1] ?? ''
    return matches(legend, /<circle class="journey-actor-dot journey-actor-\d+" data-actor="([^"]+)"[^>]*\sfill="(#[0-9a-f]{6})"/gi)
      .map(match => [match[1]!, match[2]!.toLowerCase()])
  }
  if (category === 'Mindmap') {
    return matches(article, /<path class="mindmap-edge"[^>]*stroke="(#[0-9a-f]{6})"[^>]*data-from="root" data-to="([^"]+)"/gi)
      .map(match => [match[2]!, match[1]!.toLowerCase()])
  }
  if (category === 'GitGraph') {
    return matches(article, /<line class="git-branch-line" data-branch="([^"]+)"[^>]*stroke="(#[0-9a-f]{6})"/gi)
      .map(match => [match[1]!, match[2]!.toLowerCase()])
  }
  return []
}

function readEmittedGlobal<T>(script: string, name: string): T {
  // Inspect the emitted declaration, independent of minifier whitespace, quotes
  // and object-key spelling, then evaluate only its data initializer.
  const program = parse(script, { ecmaVersion: 'latest', sourceType: 'module' })
  for (const statement of program.body) {
    if (statement.type !== 'VariableDeclaration') continue
    for (const declaration of statement.declarations) {
      if (declaration.id.type !== 'Identifier' || declaration.id.name !== name || !declaration.init) continue
      return runInNewContext(`(${script.slice(declaration.init.start, declaration.init.end)})`, {}, { timeout: 1000 }) as T
    }
  }
  throw new Error(`missing emitted ${name} data declaration`)
}

function staticCleanRoutesFromGeneratedPages() {
  return files()
    .filter((f) => f.endsWith('/index.html'))
    .map((f) => f.replace(/\/index\.html$/, ''))
    .filter((route) => route !== '' && !/^warnings\/[^/]+$/.test(route) && !/^errors\/[^/]+$/.test(route))
    .sort()
}

/** Run the shipped shader-mark.js against a WebGL double and a manual frame clock. */
function shaderMarkHarness(options: { reducedMotion: boolean }) {
  const document = new FakeDocument()
  const trigger = document.element('a', { href: '/' })
  document.element('span', { class: 'mark' }, trigger)
  let drawCalls = 0
  const gl = new Proxy({}, {
    get(_target, property) {
      if (property === 'getProgramParameter') return () => true
      if (property === 'drawArrays') return () => { drawCalls++ }
      if (typeof property === 'string' && /^[A-Z_]+$/.test(property)) return 1
      return () => ({})
    },
  })
  const createElement = document.createElement.bind(document)
  document.createElement = (tag: string) => Object.assign(createElement(tag), tag === 'canvas' ? { getContext: () => gl, width: 0, height: 0 } : {})
  let now = 0
  let nextFrame = 1
  const frames = new Map<number, (time: number) => void>()
  evaluateBrowserScript(read('shader-mark.js'), {
    document,
    window: { devicePixelRatio: 2, addEventListener() {} },
    matchMedia: () => ({ matches: options.reducedMotion }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (callback: (time: number) => void) => { frames.set(nextFrame, callback); return nextFrame++ },
    cancelAnimationFrame: (id: number) => { frames.delete(id) },
  }, 'null')
  return {
    trigger,
    draws: () => drawCalls,
    pendingFrames: () => frames.size,
    runUntilIdle() {
      let count = 0
      while (frames.size && count < 10_000) {
        now += 16
        const queued = [...frames.values()]
        frames.clear()
        for (const callback of queued) callback(now)
        count++
      }
      return count
    },
  }
}

async function websiteWorker(): Promise<{ fetch: (request: Request, env: any) => Promise<Response> }> {
  return createWebsiteWorker({
    executeHarness: 'test-harness',
    renderPng: async () => ({ png: new Uint8Array(), warnings: [], receipt: TEST_PNG_RECEIPT, runtime: PNG_WASM_RUNTIME }),
    deployVersion: 'test-deploy',
  })
}

describe('Workers Static Assets website contract', () => {
  test('library reference delivers API details and a page-specific Markdown alternative', () => {
    for (const rel of ['docs/api/', 'docs/api/advanced/']) {
      const html = read(`${rel}index.html`)
      const markdown = read(`${rel}index.md`)
      expect(html).toContain(`<link rel="alternate" type="text/markdown" href="/${rel}index.md">`)
      expect(html).toContain(`href="/${rel}index.md">Read as Markdown</a>`)
      expect(markdown).toStartWith('# ')
    }
    const html = read('docs/api/index.html')
    expect(html).toContain('renderResolvedScene')
    expect(html).toContain('id="errors-and-recovery"')
    expect(html).toContain('Does not run verification.')
    expect(html).toContain('latest release recorded')
    const markdown = read('docs/api/index.md')
    expect(markdown).toContain('[Rendering](#rendering)')
    expect(markdown).toContain('[advanced reference](/docs/api/advanced/')
    expect(markdown).toContain('error: ParseError[]')
  })

  test('build provenance never labels dirty or unverifiable bytes as exact HEAD', () => {
    const head = '0123456789abcdef'
    expect(resolveBuildGitSha({ head, status: '' })).toBe(head)
    expect(resolveBuildGitSha({ head, status: ' M website/build.ts' })).toBe(`${head}-dirty`)
    expect(resolveBuildGitSha({ head })).toBe(`${head}-unverified`)
    expect(resolveBuildGitSha({ status: '' })).toBe('development')
    expect(resolveBuildGitSha({ explicit: head, head, status: '' })).toBe(head)
    expect(() => resolveBuildGitSha({ explicit: 'release-sha', head, status: '' })).toThrow(/does not match/)
    expect(() => resolveBuildGitSha({ explicit: head, head, status: ' M file' })).toThrow(/dirty checkout/)
    expect(() => resolveBuildGitSha({ explicit: head, head })).toThrow(/cleanliness/)
  })

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
    expect(config.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(config.routes).toEqual([
      { pattern: 'agentic-mermaid.dev', custom_domain: true },
      { pattern: 'www.agentic-mermaid.dev', custom_domain: true },
    ])
    expect(config.workers_dev).toBe(false)
    expect(config.preview_urls).toBe(false)
    // Explicit full launch sampling makes the MCP cost-proxy event policy
    // reviewable instead of relying on the platform default.
    expect(config.observability).toEqual({ enabled: true, head_sampling_rate: 1 })
    expect(config.version_metadata).toEqual({ binding: 'CF_VERSION_METADATA' })
    // run_worker_first so the redirects/headers and the /mcp handler wrap asset
    // responses (the hosted MCP must reach the worker before Static Assets).
    expect(config.assets).toEqual({ directory: './public', binding: 'ASSETS', run_worker_first: true, not_found_handling: '404-page' })
    // Hosted MCP contract: the Worker Loader binding backs Code Mode execute.
    expect(config.worker_loaders).toEqual([{ binding: 'LOADER' }])
    const scripts = (JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts
    // Local development stays local: simulated bindings, loopback-only listener.
    const devArgs = scripts['website:dev']!.split(/\s+/)
    expect(devArgs).toContain('--local')
    expect(devArgs[devArgs.indexOf('--ip') + 1]).toBe('127.0.0.1')
    // Production changes only through the guarded deploy workflow transaction.
    const directProductionChanges = Object.entries(scripts).filter(([, script]) => /\bwrangler\s+(?:deploy|versions\s+deploy|rollback)\b/.test(script))
    expect(directProductionChanges).toEqual([])
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

    for (const [requestUrl, canonicalUrl] of [
      ['http://agentic-mermaid.dev/docs?ref=nav#top', 'https://agentic-mermaid.dev/docs?ref=nav#top'],
      ['http://www.agentic-mermaid.dev/docs?ref=nav#top', 'https://agentic-mermaid.dev/docs?ref=nav#top'],
      ['https://www.agentic-mermaid.dev/docs?ref=nav#top', 'https://agentic-mermaid.dev/docs?ref=nav#top'],
    ] as const) {
      const canonical = await worker.fetch(new Request(requestUrl), env(() => new Response('duplicate')))
      expect({ requestUrl, status: canonical.status, location: canonical.headers.get('location') }).toEqual({
        requestUrl,
        status: 301,
        location: canonicalUrl,
      })
    }
    expect(assetFetches).toBe(0)

    const slash = await worker.fetch(new Request('https://agentic-mermaid.dev/editor?empty=1'), env(() => new Response('editor')))
    expect(slash.status).toBe(308)
    expect(slash.headers.get('location')).toBe('https://agentic-mermaid.dev/editor/?empty=1')

    const aboutSlash = await worker.fetch(new Request('https://agentic-mermaid.dev/about'), env(() => new Response('about')))
    expect(aboutSlash.status).toBe(308)
    expect(aboutSlash.headers.get('location')).toBe('https://agentic-mermaid.dev/about/')

    for (const legacy of ['/getting-started', '/getting-started/']) {
      const response = await worker.fetch(new Request(`https://agentic-mermaid.dev${legacy}?ref=old#install`), env(() => new Response('not found', { status: 404 })))
      expect({ legacy, status: response.status, location: response.headers.get('location') }).toEqual({
        legacy,
        status: 308,
        location: 'https://agentic-mermaid.dev/docs/getting-started/?ref=old#install',
      })
    }

    for (const legacy of ['/warnings/index.md', '/warnings/index.md/']) {
      const response = await worker.fetch(new Request(`https://agentic-mermaid.dev${legacy}`), env(() => new Response('not found', { status: 404 })))
      expect({ legacy, status: response.status, location: response.headers.get('location') }).toEqual({
        legacy,
        status: 308,
        location: 'https://agentic-mermaid.dev/warning-codes.md',
      })
    }

    assetFetches = 0
    for (const gone of ['/families', '/families/', '/docs/families', '/docs/source-level', '/docs/config', '/docs/react', '/docs/vocabulary', '/security', '/skills', '/evidence', '/releases']) {
      const removedRedirect = await worker.fetch(new Request(`https://agentic-mermaid.dev${gone}`), env(() => new Response('not found', { status: 404 })))
      expect({ gone, status: removedRedirect.status, location: removedRedirect.headers.get('location') }).toEqual({ gone, status: 404, location: null })
    }
    expect(assetFetches).toBe(11)

    const html = await worker.fetch(new Request('https://agentic-mermaid.dev/'), env(() => new Response('<!doctype html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })))
    expect(html.status).toBe(200)
    expect(html.headers.get('content-security-policy')).toContain("default-src 'self'")
    // Executable script is same-origin only: no inline or eval'd script.
    const scriptSrc = (html.headers.get('content-security-policy') ?? '').split(';').map(directive => directive.trim()).filter(directive => /^script-src\s/.test(directive))
    expect(scriptSrc).toEqual(["script-src 'self'"])
    expect(html.headers.get('x-content-type-options')).toBe('nosniff')
    expect(html.headers.get('strict-transport-security')).toBe('max-age=31536000')
    expect(html.headers.get('cache-control')).toBe('no-cache')

    const js = await worker.fetch(new Request('https://agentic-mermaid.dev/editor/editor-abcdef123456.js'), env(() => new Response('export {}', { headers: { 'content-type': 'text/javascript; charset=utf-8' } })))
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')

    const emittedHashedAssets = files().filter(rel => /(?:^|\/)[^/]+-[a-f0-9]{12}(?:\.min)?\.(?:css|js|html|woff2)$/i.test(rel)).sort()
    expect(emittedHashedAssets).toEqual(expect.arrayContaining([
      expect.stringMatching(/^editor\/editor-[a-f0-9]{12}\.js$/),
      expect.stringMatching(/^examples-[a-f0-9]{12}\.css$/),
      expect.stringMatching(/^examples-[a-f0-9]{12}\.js$/),
      expect.stringMatching(/^examples\/fragments\/(?:style-palette|corpus)-[a-f0-9]{12}\.html$/),
      expect.stringMatching(/^generated\/inline-[a-f0-9]{12}\.js$/),
      expect.stringMatching(/^vendor\/mermaid-[a-f0-9]{12}\.min\.js$/),
    ]))
    for (const rel of emittedHashedAssets) {
      const contentType = rel.endsWith('.html') ? 'text/html' : rel.endsWith('.woff2') ? 'font/woff2' : rel.endsWith('.css') ? 'text/css' : 'text/javascript'
      const requestRel = rel.startsWith('examples/fragments/') ? rel.replace(/\.html$/, '') : rel
      const asset = await worker.fetch(new Request(`https://agentic-mermaid.dev/${requestRel}`), env(() => new Response('asset', { headers: { 'content-type': contentType } })))
      expect({ rel, cache: asset.headers.get('cache-control') }).toEqual({ rel, cache: 'public, max-age=31536000, immutable' })
      if (rel.startsWith('examples/fragments/')) expect(asset.headers.get('x-robots-tag'), rel).toBe('noindex, nofollow')
    }

    for (const [pathname, response] of [
      ['/examples/fragments/corpus-deadbeefdead', new Response('missing', { status: 404, headers: { 'content-type': 'text/html' } })],
      ['/editor/editor-abcdef123456.js', new Response('broken', { status: 500, headers: { 'content-type': 'text/javascript' } })],
      ['/editor/editor-abcdef123456.js', new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })],
      ['/editor/editor-abcdef123456.js', new Response('export {}', { headers: { 'content-type': 'text/javascript', 'set-cookie': 'session=unexpected' } })],
    ] as const) {
      const rejected = await worker.fetch(new Request(`https://agentic-mermaid.dev${pathname}`), env(() => response.clone()))
      expect({ pathname, status: rejected.status, cache: rejected.headers.get('cache-control') }).toEqual({ pathname, status: response.status, cache: 'no-store' })
    }

    const poisoned = await worker.fetch(new Request('https://agentic-mermaid.dev/editor/editor-abcdef123456.js'), env(() => new Response('broken', {
      status: 500,
      headers: {
        'content-type': 'text/javascript',
        'cdn-cache-control': 'public, max-age=999',
        'cloudflare-cdn-cache-control': 'public, max-age=888',
      },
    })))
    expect(poisoned.headers.get('cache-control')).toBe('no-store')
    expect(poisoned.headers.get('cdn-cache-control')).toBeNull()
    expect(poisoned.headers.get('cloudflare-cdn-cache-control')).toBeNull()

    const mixedCaseHtml = await worker.fetch(new Request('https://agentic-mermaid.dev/about/'), env(() => new Response('<!doctype html>', { headers: { 'content-type': 'Text/HTML; Charset=UTF-8' } })))
    expect(mixedCaseHtml.headers.get('content-security-policy')).toContain("default-src 'self'")

    for (const [pathname, contentType] of [
      ['/apple-touch-icon.png', 'image/png'],
      ['/favicon.ico', 'image/x-icon'],
      ['/fonts/Inter.subset.woff2', 'font/woff2'],
    ] as const) {
      const asset = await worker.fetch(new Request(`https://agentic-mermaid.dev${pathname}`), env(() => new Response('asset', { headers: { 'content-type': contentType } })))
      expect({ pathname, cache: asset.headers.get('cache-control') }).toEqual({ pathname, cache: 'public, max-age=3600' })
    }
    const unknownAsset = await worker.fetch(new Request('https://agentic-mermaid.dev/data.unknown'), env(() => new Response('asset', { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=999' } })))
    expect(unknownAsset.headers.get('cache-control')).toBe('no-cache')

    // /mcp is the live hosted MCP endpoint (stateless, POST-only) — no longer
    // the 501 placeholder. A GET is 405 and never touches Static Assets.
    assetFetches = 0
    const mcp = await worker.fetch(new Request('https://agentic-mermaid.dev/mcp'), env(() => new Response('should not run')))
    expect(mcp.status).toBe(405)
    // A pre-parse refusal carries no JSON-RPC envelope: `error` is the reason.
    expect(((await mcp.json()) as any).error).toContain('stateless')
    expect(mcp.headers.get('strict-transport-security')).toBe('max-age=31536000')
    expect(assetFetches).toBe(0)

    const wellKnownMcp = await worker.fetch(new Request('https://agentic-mermaid.dev/.well-known/mcp'), env(() => new Response('should not run')))
    expect(wellKnownMcp.status).toBe(405)
    expect(((await wellKnownMcp.json()) as any).error).toContain('stateless')
    expect(assetFetches).toBe(0)

    const wellKnownInitialize = await worker.fetch(new Request('https://agentic-mermaid.dev/.well-known/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'website-test', version: '0' } },
      }),
    }), env(() => new Response('should not run')))
    expect(wellKnownInitialize.status).toBe(200)
    const wellKnownPayload = await wellKnownInitialize.json() as any
    expect(wellKnownPayload.result.serverInfo.name).toBe('agentic-mermaid-hosted')
    expect(assetFetches).toBe(0)
  })

  test('homepage negotiates Markdown and advertises existing machine-readable surfaces', async () => {
    const worker = await websiteWorker()
    const fetchedPaths: string[] = []
    const env = {
      ASSETS: {
        fetch: async (request: Request) => {
          const pathname = new URL(request.url).pathname
          fetchedPaths.push(pathname)
          return pathname === '/index.md'
            ? new Response('# Agentic Mermaid', { headers: { 'content-type': 'text/markdown; charset=utf-8' } })
            : new Response('<!doctype html>', { headers: { 'content-type': 'text/html; charset=utf-8', vary: 'Origin' } })
        },
      },
    }

    const markdown = await worker.fetch(new Request('https://agentic-mermaid.dev/', {
      headers: { accept: 'text/html;q=0.5, text/markdown;q=0.9' },
    }), env as any)
    expect(fetchedPaths.at(-1)).toBe('/index.md')
    expect(markdown.headers.get('content-type')).toContain('text/markdown')
    expect((markdown.headers.get('vary') ?? '').toLowerCase().split(/\s*,\s*/)).toContain('accept')

    const html = await worker.fetch(new Request('https://agentic-mermaid.dev/', {
      headers: { accept: 'text/markdown;q=0, text/html' },
    }), env as any)
    expect(fetchedPaths.at(-1)).toBe('/')
    expect(html.headers.get('content-type')).toContain('text/html')
    expect((html.headers.get('vary') ?? '').toLowerCase().split(/\s*,\s*/)).toEqual(expect.arrayContaining(['origin', 'accept']))

    const links = (html.headers.get('link') ?? '').split(/,\s*(?=<)/)
    expect(links).toEqual(expect.arrayContaining([
      '</index.md>; rel="alternate"; type="text/markdown"',
      '</llms.txt>; rel="describedby"; type="text/plain"',
      '</sitemap.xml>; rel="index"; type="application/xml"',
      '</.well-known/mcp/server-card.json>; rel="service-desc"; type="application/json"',
      '</skills/agentic-mermaid-diagram-workflow/SKILL.md>; rel="describedby"; type="text/markdown"',
    ]))
    const registeredRelations = new Set(['alternate', 'describedby', 'index', 'service-desc'])
    for (const link of links) {
      expect(link).toMatch(/^<\/[^>]+>; rel="[a-z-]+"; type="[a-z0-9.+-]+\/[a-z0-9.+-]+"$/)
      expect(registeredRelations.has(link.match(/; rel="([a-z-]+)"/)?.[1] ?? '')).toBe(true)
      expect(existsSync(join(SITE, link.match(/^<\/([^>]+)>/)?.[1] ?? '__missing__'))).toBe(true)
    }
  })

  test('pages negotiate their actual Markdown assets with representation-specific headers', async () => {
    const worker = await websiteWorker()
    const fetched: Array<{ pathname: string; search: string; method: string }> = []
    const env = { ASSETS: { fetch: async (request: Request) => {
      const url = new URL(request.url)
      fetched.push({ pathname: url.pathname, search: url.search, method: request.method })
      const markdown = url.pathname.endsWith('.md')
      const rel = url.pathname.slice(1) + (markdown ? '' : 'index.html')
      return new Response(request.method === 'HEAD' ? null : read(rel), {
        headers: { 'content-type': markdown ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8', vary: 'Origin' },
      })
    } } }
    for (const route of ['/', '/docs/api/', '/docs/api/advanced/', '/warnings/LABEL_OVERFLOW/', '/errors/parse-error/']) {
      const markdownPath = route === '/' ? '/index.md' : `${route}index.md`
      for (const [accept, markdown] of [
        ['text/markdown', true],
        ['text/markdown;', true],
        ['text/markdown; ; charset=utf-8; ; q=1; , text/html;q=0.5', true],
        ['text/html;q=0.4, text/markdown;q=0.9', true],
        ['text/markdown;q=0.1, text/markdown;charset=utf-8;q=0.9, text/html;q=0.5', true],
        ['text/markdown;charset=utf-8;q=0.9, text/markdown;q=0.1, text/html;q=0.5', true],
        ['text/markdown;charset="UTF-8", text/html;q=0.5', true],
        ['text/markdown;charset=iso-8859-1, text/html;q=0.5', false],
        ['text/markdown;q=0.9, text/markdown;charset=utf-8;q=0, text/html;q=0.5', false],
        ['application/json; profile="x,text/markdown,bar", text/html;q=0.5', false],
        [String.raw`application/json; profile="x\",text/markdown; charset=utf-8,bar", text/html;q=0.5`, false],
        ['text/markdown;q=0.9999, text/html;q=0.5', false],
        ['text/markdown;q=0, text/html', false],
        ['text/*;q=0.5, text/markdown;q=0', false],
        ['text/html, text/markdown', false],
        ['*/*', false],
        ['', false],
      ] as const) {
        const response = await worker.fetch(new Request(`https://agentic-mermaid.dev${route}?version=source`, { headers: { accept } }), env as any)
        expect(fetched.at(-1)).toEqual({ pathname: markdown ? markdownPath : route, search: '?version=source', method: 'GET' })
        expect(response.status).toBe(200)
        expect(await response.text()).toBe(read(`${route.slice(1)}index.${markdown ? 'md' : 'html'}`))
        expect(response.headers.get('content-type')).toBe(`${markdown ? 'text/markdown' : 'text/html'}; charset=utf-8`)
        expect(response.headers.get('vary')?.toLowerCase().split(/\s*,\s*/)).toEqual(['origin', 'accept'])
        const alternatives = (response.headers.get('link') ?? '').split(/,\s*(?=<)/).filter(link => link.includes('rel="alternate"'))
        expect(alternatives).toEqual([`<${markdownPath}>; rel="alternate"; type="text/markdown"`])
        expect(response.headers.get('content-location')).toBe(markdown ? markdownPath : null)
        expect(response.headers.get('cache-control')).toBe(markdown ? 'public, max-age=300' : 'no-cache')
        expect(response.headers.get('access-control-allow-origin')).toBe(markdown ? '*' : null)
      }
      const head = await worker.fetch(new Request(`https://agentic-mermaid.dev${route}`, { method: 'HEAD', headers: { accept: 'text/markdown' } }), env as any)
      expect(fetched.at(-1)).toEqual({ pathname: markdownPath, search: '', method: 'HEAD' })
      expect(head.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
      expect(head.headers.get('content-location')).toBe(markdownPath)
      expect(await head.text()).toBe('')
      expect(read(`${route.slice(1)}index.html`)).toContain(`<link rel="alternate" type="text/markdown" href="${markdownPath}">`)
    }
  })

  test('Markdown negotiation preserves redirects, asset failures, conditional requests and method boundaries', async () => {
    const worker = await websiteWorker()
    const fetched: Request[] = []
    let status = 404
    const env = { ASSETS: { fetch: async (request: Request) => {
      fetched.push(request)
      return new Response(status === 304 ? null : 'asset result', {
        status, headers: { 'content-type': 'text/html', vary: '*', etag: '"md-version"', link: '</existing>; rel="help"' },
      })
    } } }
    const redirected = await worker.fetch(new Request('https://agentic-mermaid.dev/docs/api?x=1', { headers: { accept: 'text/markdown' } }), env as any)
    expect(redirected.status).toBe(308)
    expect(redirected.headers.get('location')).toBe('https://agentic-mermaid.dev/docs/api/?x=1')
    expect(fetched).toHaveLength(0)

    const missing = await worker.fetch(new Request('https://agentic-mermaid.dev/docs/api/', { headers: { accept: 'text/markdown' } }), env as any)
    expect(new URL(fetched.at(-1)!.url).pathname).toBe('/docs/api/index.md')
    expect(missing.status).toBe(404)
    expect(await missing.text()).toBe('asset result')
    expect(missing.headers.get('content-type')).toBe('text/html')
    expect(missing.headers.get('content-location')).toBeNull()
    expect(missing.headers.get('cache-control')).toBe('no-store')
    expect(missing.headers.get('vary')).toBe('*')
    expect(missing.headers.get('link')).toBe('</existing>; rel="help", </docs/api/index.md>; rel="alternate"; type="text/markdown"')

    status = 304
    const conditional = await worker.fetch(new Request('https://agentic-mermaid.dev/docs/api/', { headers: { accept: 'text/markdown', 'if-none-match': '"md-version"' } }), env as any)
    expect(fetched.at(-1)!.headers.get('if-none-match')).toBe('"md-version"')
    expect(conditional.status).toBe(304)
    expect(conditional.headers.get('etag')).toBe('"md-version"')
    expect(conditional.headers.get('content-location')).toBe('/docs/api/index.md')
    expect(await conditional.text()).toBe('')

    status = 405
    await worker.fetch(new Request('https://agentic-mermaid.dev/docs/api/', { method: 'POST', body: 'same body', headers: { accept: 'text/markdown' } }), env as any)
    expect(new URL(fetched.at(-1)!.url).pathname).toBe('/docs/api/')
    expect(fetched.at(-1)!.method).toBe('POST')
    expect(await fetched.at(-1)!.text()).toBe('same body')
    await worker.fetch(new Request('https://agentic-mermaid.dev/docs/getting-started/', { headers: { accept: 'text/markdown' } }), env as any)
    expect(new URL(fetched.at(-1)!.url).pathname).toBe('/docs/getting-started/')
    await worker.fetch(new Request('https://agentic-mermaid.dev/docs/api/index.md', { headers: { accept: 'text/html' } }), env as any)
    expect(new URL(fetched.at(-1)!.url).pathname).toBe('/docs/api/index.md')
  })



  test('required human and machine routes are generated', () => {
    const routes = [
      'index.html', 'editor/index.html', 'about/index.html', 'docs/getting-started/index.html',
      'docs/index.html', 'docs/api/index.html', 'docs/cli/index.html',
      'docs/mcp/index.html', 'docs/ascii/index.html', 'docs/theming/index.html',
      'docs/custom-styles/index.html', 'docs/quality/index.html', 'docs/fork-differences/index.html',
      'warnings/index.html', 'errors/index.html', 'examples/index.html', 'comparisons/index.html',
      'index.md', 'llms.txt', 'llms.md', '.well-known/llms.txt', 'agent-instructions.md', 'capabilities.json', 'examples/index.json', 'schemas/style-spec.schema.json', 'schemas/render-options.schema.json',
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

  test('served workflow skill closes repository-only references', () => {
    const source = readRepo('skills/agentic-mermaid-diagram-workflow/SKILL.md')
    const served = read('skills/agentic-mermaid-diagram-workflow/SKILL.md')
    const repoBlob = 'https://github.com/adewale/agentic-mermaid/blob/main'
    const refs = Array.from(source.matchAll(/`((?:docs\/|references\/upstream\/)[^`]*)`/g), match => match[1]!)

    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) {
      const target = ref.startsWith('docs/')
        ? `${repoBlob}/${ref}`
        : `${repoBlob}/skills/agentic-mermaid-diagram-workflow/${ref}`
      expect(served).toContain(`[${ref}](${target})`)
    }
    expect(Array.from(served.matchAll(/`(?:docs\/|references\/upstream\/)[^`]*`/g), match => match[0])).toEqual([])
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
    for (const warning of cap.warningCodes) for (const field of ['what', 'triggers', 'fix'] as const) {
      expect({ code: warning.code, field, filled: typeof warning[field] === 'string' && warning[field].length > 20 })
        .toEqual({ code: warning.code, field, filled: true })
    }
    expect(sample.fix.includes('<code>')).toBe(false)             // Markdown, not page HTML
  })


  test('all generated pages use the trident favicon assets', () => {
    const favicon = read('favicon.svg')
    expect(favicon).toContain('Agentic Mermaid')
    expect(favicon).toContain('points="14,8.5 14,23.5 24,39.5"')
    expect(existsSync(join(SITE, 'favicon.ico'))).toBe(true)
    expect(existsSync(join(SITE, 'apple-touch-icon.png'))).toBe(true)
    const offenders = files().filter((f) => f.endsWith('.html') && !f.startsWith('examples/fragments/') && !read(f).includes('href="/favicon.svg"'))
    expect(offenders).toEqual([])
  })

  test('public site and editor ship the diagram fonts used by built-in looks', () => {
    const styles = read('styles.css')
    const editor = read('editor/index.html')
    expect(readRepo('website/source/assets/styles.css')).not.toContain('@font-face')
    // Site CSS serves latin-subset woff2 first for the display faces (full TTF
    // fallback second); DejaVu (PNG parity face) stays TTF-only. The editor
    // page keeps the plain TTF faces — its export path embeds full fonts.
    const SUBSET = new Set(['Caveat.ttf', 'EBGaramond.ttf', 'ShareTechMono.ttf', 'ArchitectsDaughter.ttf'])
    for (const font of HOSTED_FONT_RESOURCES) {
      const publicFace = `@font-face { font-family: '${font.family}'; src: url('/fonts/${font.file}') format('truetype'); font-weight: ${font.weight}; font-style: ${font.style}; font-display: swap; }`
      const subsetFace = publicFace.replace(
        `src: url('/fonts/${font.file}') format('truetype');`,
        `src: url('/fonts/${font.file.replace(/\.ttf$/, '.subset.woff2')}') format('woff2'), url('/fonts/${font.file}') format('truetype');`,
      )
      expect(styles).toContain(SUBSET.has(font.file) ? subsetFace : publicFace)
      expect(editor).toContain(publicFace)
    }
    for (const file of SUBSET) {
      const rel = `fonts/${file.replace(/\.ttf$/, '.subset.woff2')}`
      expect({ rel, exists: existsSync(join(SITE, rel)) }).toEqual({ rel, exists: true })
    }
    for (const { file } of HOSTED_FONT_RESOURCES) {
      const rel = `fonts/${file}`
      expect({ rel, exists: existsSync(join(SITE, rel)) }).toEqual({ rel, exists: true })
    }
    const editorScript = read(editorScriptRel(editor))
    const presetFonts = readEmittedGlobal<Array<{ name: string; value: string; group: string }>>(editorScript, 'EDITOR_PRESET_FONTS')
    const hostedFamilies = Array.from(new Set(HOSTED_FONT_RESOURCES.map((font) => font.family)))
    expect(presetFonts.filter((font) => font.group === 'Self-hosted').map((font) => font.value)).toEqual(hostedFamilies)
    const allowedSystem = new Set(['system-ui', 'Arial', 'Georgia', 'Courier New'])
    for (const font of presetFonts) {
      expect({ font: font.value, hostedOrSystem: hostedFamilies.includes(font.value) || allowedSystem.has(font.value) }).toEqual({ font: font.value, hostedOrSystem: true })
    }
    expect(editorScript).not.toContain('Poppins')
  })

  test('the editor builder works from a checkout path containing a space', async () => {
    // URL.pathname percent-encodes the space, so a builder that resolves its
    // inputs through it cannot find them; the generated page must still bundle.
    const parent = mkdtempSync(join(tmpdir(), 'am editor builder '))
    try {
      const checkout = join(parent, 'agentic mermaid')
      for (const rel of ['editor', 'shared', 'scripts/site', 'scripts/build', 'package.json']) cpSync(join(REPO, rel), join(checkout, rel), { recursive: true })
      cpSync(join(REPO, 'src'), join(checkout, 'src'), { recursive: true, filter: path => !path.includes(`${join('src', '__tests__')}`) })
      symlinkSync(join(REPO, 'node_modules'), join(checkout, 'node_modules'))
      const out = join(parent, 'editor.html')
      const result = await runChild('bun', ['--preload', join(REPO, 'src/__tests__/site-probe.preload.ts'), join(checkout, 'scripts/site/editor.ts')], { cwd: checkout, env: { ...process.env, AM_TEST_REDIRECT_WRITE: out, AM_EDITOR_FONT_PREFIX: '' } })
      expect({ exitCode: result.status, stderr: result.stderr.toString() }).toEqual({ exitCode: 0, stderr: '' })
      const html = readFileSync(out, 'utf8')
      expect(html).toContain('window.__mermaid')
      // Without an explicit prefix the standalone editor serves fonts relative to itself.
      expect(html).toContain(`url('assets/fonts/${HOSTED_FONT_RESOURCES[0]!.file}')`)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  }, 60_000)

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

  test('agent entrypoints publish related discovery links and only equivalent alternates', async () => {
    const home = read('index.html')
    const editor = read('editor/index.html')
    for (const rel of ['index.html', 'docs/index.html', 'examples/index.html', 'editor/index.html']) {
      const html = read(rel)
      expect(html).toContain('<link rel="describedby" type="text/plain" href="/llms.txt">')
      expect(html).toContain('<link rel="describedby" type="application/json" href="/capabilities.json">')
      expect(html).toContain('<link rel="describedby" type="text/markdown" href="/agent-instructions.md">')
      expect(html).toContain('<link rel="service-desc" type="application/json" href="/.well-known/mcp.json">')
      expect(html).toContain('<link rel="mcp-server" type="application/mcp-server-card+json" href="/.well-known/mcp/server-card.json">')
      expect(html).toContain('<link rel="ai-catalog" type="application/json" href="/.well-known/ai-catalog.json">')
    }
    for (const [rel, markdownPath] of [
      ['index.html', '/index.md'],
      ['docs/api/index.html', '/docs/api/index.md'],
      ['docs/api/advanced/index.html', '/docs/api/advanced/index.md'],
      ['warnings/LABEL_OVERFLOW/index.html', '/warnings/LABEL_OVERFLOW/index.md'],
      ['errors/parse-error/index.html', '/errors/parse-error/index.md'],
      ['docs/index.html', null],
      ['docs/getting-started/index.html', null],
      ['editor/index.html', null],
      ['skills/agentic-mermaid-diagram-workflow/index.html', null],
      ['404.html', null],
    ] as const) {
      const alternatives: Array<{ type: string | null; href: string | null }> = []
      await new HTMLRewriter().on('head link[rel~="alternate"]', {
        element(element) { alternatives.push({ type: element.getAttribute('type'), href: element.getAttribute('href') }) },
      }).transform(new Response(read(rel))).text()
      expect({ page: rel, alternatives }).toEqual({
        page: rel, alternatives: markdownPath ? [{ type: 'text/markdown', href: markdownPath }] : [],
      })
      if (markdownPath) expect(existsSync(join(SITE, markdownPath.slice(1)))).toBe(true)
    }
    const homeMain = home.slice(home.indexOf('<main'))
    const bootstrap = homeMain.indexOf('data-copy-text="Fetch https://agentic-mermaid.dev/start.md and follow it."')
    const editorLink = homeMain.indexOf('href="/editor/?empty=1"')
    const setupLink = homeMain.indexOf('href="/docs/getting-started/"')
    expect(bootstrap).toBeGreaterThanOrEqual(0)
    expect(editorLink).toBeGreaterThan(bootstrap)
    expect(setupLink).toBeGreaterThan(editorLink)
    const gettingStarted = read('docs/getting-started/index.html')
    expect(gettingStarted).toContain('data-copy-name="MCP config"')
    expect(gettingStarted).toContain('Fetch https://agentic-mermaid.dev/start.md and follow it.')
    expect(read('start.md').trim()).toBe(readFileSync(join(REPO, 'website/source/start.md'), 'utf8').trim())
    expect(home).toContain('/examples/index.json')
    expect(home).toContain('/skills/agentic-mermaid-diagram-workflow/SKILL.md')
    const editorScript = editorScriptRel(editor)
    expect(existsSync(join(SITE, editorScript))).toBe(true)
    expect(statSync(join(SITE, 'editor/index.html')).size).toBeLessThan(250_000)
    expect(gzipSync(editor).byteLength).toBeLessThan(80_000)
    expect(read(editorScript).length).toBeLessThan(250_000)
    const runtime = read(editorScript).match(/import "\/(editor\/runtime\/browser-hosted-[a-z0-9]{8}\.js)"/)?.[1]
    expect(runtime).toBeDefined()
    expect(read(runtime!).length).toBeGreaterThan(1000)
  })

  test('every generated editor-state link uses the canonical codec and round-trips', () => {
    const editorStateKeys = new Set<string>(EDITOR_SHARE_STATE_KEYS)
    const generatedStateLinks = files()
      .filter(rel => /\.(?:html|json)$/.test(rel))
      .flatMap((rel) => matches(read(rel), /\/editor\/#deflate:[A-Za-z0-9_-]+/g).map(match => ({ rel, href: match[0] })))

    expect(generatedStateLinks.length).toBeGreaterThan(0)
    for (const { rel, href } of generatedStateLinks) {
      const state = decodeEditorStateHref(href)
      expect(typeof state.source, `${rel}: ${href.slice(0, 48)}...`).toBe('string')
      expect((state.source as string).trim().length, `${rel}: decoded source`).toBeGreaterThan(0)
      expect(Object.keys(state).filter(key => !editorStateKeys.has(key)), `${rel}: editor state keys`).toEqual([])
    }

    const nonCanonicalStateLinks = files()
      .filter(rel => /\.(?:html|json)$/.test(rel))
      .flatMap(rel => matches(read(rel), /\/editor\/#(?!deflate:)[^"'\s<]+/g).map(match => `${rel}: ${match[0]}`))
    expect(nonCanonicalStateLinks).toEqual([])
  })

  test('every Examples card Editor link reproduces its complete gallery SVG request', () => {
    const html = examplesCatalogHtml()
    const catalog = JSON.parse(read('examples/index.json'))
    const catalogEntries = [...catalog.examples, ...catalog.richExamples, ...catalog.stylePaletteExamples]
    const articles = matches(html, /<article class="example-sample[^"]*" id="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)
    expect(articles).toHaveLength(EDITOR_EXAMPLES.length + BUILTIN_FAMILY_METADATA.length + RICH_EXAMPLES.length)

    for (const articleMatch of articles) {
      const id = articleMatch[1]!
      const article = articleMatch[2]!
      const href = article.match(/<a class="go" href="(\/editor\/#deflate:[A-Za-z0-9_-]+)"/)?.[1]
      expect(href, `${id}: canonical Editor deep link`).toBeDefined()
      const state = decodeEditorStateHref(href!)
      expect(Object.prototype.hasOwnProperty.call(state, 'palette'), `${id}: explicit palette`).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(state, 'style'), `${id}: explicit style`).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(state, 'seed'), `${id}: explicit seed`).toBe(true)
      expect((state.config as Record<string, unknown>)?.compact, `${id}: compact parity`).toBe(true)

      const basic = catalog.examples.find((entry: any) => entry.renderUrl === `/examples/#${id}`)
      const idPrefix = `example-${basic?.id ?? id}-`
      const editorSvg = renderWebsiteSVG(state.source as string, {
        ...editorRenderOptionsFromState(state),
        security: 'strict',
        embedFontImport: false,
        idPrefix,
      } as any).replace(/[ \t]+$/gm, '')
      const gallerySvg = article.match(/<div class="example-svg"[^>]*>(<svg[\s\S]*?<\/svg>)<\/div>/)?.[1]
      expect(gallerySvg, `${id}: gallery SVG`).toBeDefined()
      const svgIds = [...gallerySvg!.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]!)
      expect(new Set(svgIds).size, `${id}: unique SVG ids`).toBe(svgIds.length)
      expect(removeWebsiteExampleAccessibleName(gallerySvg!), `${id}: exact Editor/gallery render parity`)
        .toBe(removeWebsiteExampleAccessibleName(editorSvg))

      // Every rendered card is listed in the JSON catalog, with a renderUrl
      // that lands on the page carrying the card and the card's Editor URL.
      const catalogEntry = catalogEntries.find((entry: any) => entry.renderUrl.endsWith(`#${id}`))
      expect({ id, listed: catalogEntry !== undefined }).toEqual({ id, listed: true })
      const page = `${catalogEntry.renderUrl.slice(1, catalogEntry.renderUrl.indexOf('#'))}index.html`
      const openingTag = articleMatch[0].slice(0, articleMatch[0].indexOf('>') + 1)
      expect({ id, page, onPage: read(page).includes(openingTag) }).toEqual({ id, page, onPage: true })
      expect(catalogEntry.editorUrl, `${id}: HTML/JSON Editor URL parity`).toBe(href)
    }
    expect(catalogEntries).toHaveLength(articles.length)
  })

  test('Examples keeps family proofs initial and projects exact retryable standalone fragments', () => {
    const index = read('examples/index.html')
    const stylePage = read('examples/style-palette/index.html')
    const corpusPage = read('examples/corpus/index.html')
    const fragments = exampleFragmentRels(index)
    expect(fragments).toHaveLength(2)
    expect(index).not.toMatch(/data-example-fragment="[^"]+\.html"/)
    expect(fragments).toEqual(expect.arrayContaining([
      expect.stringMatching(/^examples\/fragments\/style-palette-[a-f0-9]{12}\.html$/),
      expect.stringMatching(/^examples\/fragments\/corpus-[a-f0-9]{12}\.html$/),
    ]))
    const styleFragmentRel = fragments.find(rel => rel.includes('style-palette-'))!
    const corpusFragmentRel = fragments.find(rel => rel.includes('corpus-'))!
    const styleFragment = read(styleFragmentRel)
    const corpusFragment = read(corpusFragmentRel)
    for (const rel of [styleFragmentRel, corpusFragmentRel]) {
      expect(rel).toContain(createHash('sha256').update(read(rel)).digest('hex').slice(0, 12))
    }
    expect(stylePage).toContain(styleFragment)
    expect(corpusPage).toContain(corpusFragment)
    expect(styleFragment.match(/data-example-fragment-root="style-palette"/g)).toHaveLength(1)
    expect(corpusFragment.match(/data-example-fragment-root="corpus"/g)).toHaveLength(1)
    expect(index.match(/<article class="example-sample"/g)).toHaveLength(EDITOR_EXAMPLES.length)
    expect(styleFragment.match(/<article class="example-sample"/g)).toHaveLength(BUILTIN_FAMILY_METADATA.length)
    expect(corpusFragment.match(/<article class="example-sample/g)).toHaveLength(RICH_EXAMPLES.length)
    expect(index).not.toContain('<article class="example-sample" id="style-palette-flowchart">')
    expect(index).not.toContain('<article class="example-sample" id="rich-agentic-mermaid"')
    expect(gzipSync(index).byteLength).toBeLessThan(262_408 * 0.6)
    const loader = index.match(/<script src="\/(examples-[a-f0-9]{12}\.js)" defer><\/script>/)?.[1]
    expect(loader).toBeDefined()
    const loaderSource = read(loader!)
    expect(loader).toContain(createHash('sha256').update(loaderSource).digest('hex').slice(0, 12))
    const examplesCss = index.match(/<link rel="stylesheet" href="\/(examples-[a-f0-9]{12}\.css)">/)?.[1]
    expect(examplesCss).toBeDefined()
    expect(examplesCss).toContain(createHash('sha256').update(read(examplesCss!)).digest('hex').slice(0, 12))
    // The loader's behaviour (status/content-type/root validation, retry,
    // de-duplicated requests, navigation fallback) is exercised in a real
    // browser by website-browser-a11y.test.ts, not by grepping its source.
    expect(read('_redirects')).toContain('/examples/style-palette /examples/style-palette/ 308')
    expect(read('_redirects')).toContain('/examples/corpus /examples/corpus/ 308')
    expect(read('sitemap.xml')).toContain('<loc>https://agentic-mermaid.dev/examples/style-palette/</loc>')
    expect(read('sitemap.xml')).toContain('<loc>https://agentic-mermaid.dev/examples/corpus/</loc>')
  })

  test('styled example state keeps appearance in visible controls and strips hidden conflicts', () => {
    const request = createStyledExampleRenderState('flowchart TD\n  A --> B', {
      style: 'publication-figure',
      palette: 'paper',
      seed: 3,
    }, {
      style: ['watercolor', 'nord-light'],
      seed: 99,
      padding: 12,
      security: 'default',
      embedFontImport: true,
      idPrefix: 'host-only-',
    })
    expect(request.editorState).toEqual({
      source: 'flowchart TD\n  A --> B',
      palette: 'paper',
      style: 'publication-figure',
      seed: 3,
      config: { padding: 12, compact: true },
    })
    expect(editorRenderOptionsFromState(request.editorState as unknown as Record<string, unknown>)).toEqual({
      embedFontImport: false,
      security: 'strict',
      padding: 12,
      compact: true,
      style: ['publication-figure', 'paper'],
      seed: 3,
    })
  })

  test('the formerly transparent rich card has a portable painted canvas', () => {
    const article = read('examples/corpus/index.html').match(/<article class="example-sample" id="rich-agentic-mermaid"[\s\S]*?<\/article>/)?.[0] ?? ''
    const href = article.match(/href="(\/editor\/#deflate:[A-Za-z0-9_-]+)"/)?.[1]
    expect(href).toBeDefined()
    const state = decodeEditorStateHref(href!)
    expect((state.config as Record<string, unknown>).transparent).not.toBe(true)
    expect(article).toMatch(/<svg[^>]*style="[^"]*background:/)
  })

  test('homepage styled handoffs retain complete compact render state', () => {
    const homeLinks = matches(read('index.html'), /\/editor\/#deflate:[A-Za-z0-9_-]+/g).map(match => match[0])
    const styled = homeLinks.map(decodeEditorStateHref).filter(state => state.style && state.style !== 'crisp')
    expect(styled.length).toBeGreaterThan(3)
    for (const state of styled) {
      expect((state.config as Record<string, unknown>)?.compact).toBe(true)
      expect(editorRenderOptionsFromState(state).style).toEqual([state.style, state.palette])
    }
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

  test('masthead exposes examples, repository, and the editor and trust links', () => {
    for (const rel of ['index.html', 'docs/index.html', 'about/index.html', 'examples/index.html', 'skills/agentic-mermaid-diagram-workflow/index.html']) {
      const html = read(rel)
      const masthead = html.match(/<header class="masthead"[\s\S]*?<\/header>/)?.[0] ?? ''
      expect(masthead).toContain('<details class="nav-menu"><summary class="nav-toggle">')
      expect(masthead).toContain('<nav id="site-navigation" class="links" aria-label="Primary navigation">')
      expect(masthead).not.toContain('aria-expanded=')
      expect(masthead).not.toContain('class="nav-toggle" hidden')
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
      // One quiet trust footer per page: version, license, issues, changelog.
      const footer = html.match(/<footer class="site-footer"[\s\S]*?<\/footer>/)?.[0] ?? ''
      expect(footer).toContain('https://github.com/adewale/agentic-mermaid/issues')
      expect(footer).toContain('CHANGELOG.md')
      expect(footer).toContain('href="/about/design/"')
      expect(footer).toContain('LICENSE')
      expect(html.split('<footer').length).toBe(2)
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
    expect(read('_headers')).toContain('Strict-Transport-Security: max-age=31536000')
    expect(read('_redirects')).toContain('/getting-started /docs/getting-started/ 308')
    expect(read('_redirects')).toContain('/getting-started/ /docs/getting-started/ 308')
    expect(read('_redirects')).toContain('/warnings/index.md /warning-codes.md 308')
    expect(read('_redirects')).toContain('/warnings/index.md/ /warning-codes.md 308')
    expect(read('_redirects')).not.toContain('/docs/families /examples/ 308')
    expect(read('_redirects')).not.toContain('/docs/families/ /examples/ 308')
    expect(read('_redirects')).not.toContain('/families /examples/ 308')
    expect(read('_redirects')).not.toContain('/families/ /examples/ 308')
    expect(read('_redirects')).not.toContain('/agents')
    expect(read('_redirects')).not.toContain('agents-workflow')
    expect(read('_redirects')).not.toContain('.html')
    expect(read('_redirects')).not.toContain('/home')
  })


  test('comparisons page renders available engines and omits unsupported Beautiful Mermaid panels', () => {
    const comparisons = read('comparisons/index.html')
    const mermaidRuntime = files().filter((f) => /^vendor\/mermaid-[a-f0-9]{12}\.min\.js$/.test(f))
    const comparisonScriptRel = comparisons.match(/<script src="\/(generated\/inline-[a-f0-9]{12}\.js)"><\/script>/)?.[1]
    expect(comparisonScriptRel).toBeDefined()
    expect(read(comparisonScriptRel!).length, 'comparison script ships').toBeGreaterThan(0)
    expect(mermaidRuntime.length).toBe(1)
    expect(comparisons).toContain(`data-mermaid-runtime="/${mermaidRuntime[0]}"`)
    expect(comparisons.match(/class="comparison-case(?: |")/g)?.length).toBe(BUILTIN_FAMILY_METADATA.length)
    expect(comparisons.match(/class="comparison-panel"/g)?.length).toBe(BUILTIN_FAMILY_METADATA.length * 2 + 6)
    expect(comparisons.match(/class="comparison-grid" data-comparison-lightbox-panel/g)?.length).toBe(BUILTIN_FAMILY_METADATA.length)
    expect(comparisons.match(/data-comparison-editor-href="\/editor\/#/g)?.length).toBe(BUILTIN_FAMILY_METADATA.length)
    // The lightbox's pair/view/zoom controls, source link and keyboard opening
    // are exercised in a real browser (website-browser-a11y.test.ts), not by
    // grepping the bundled script for its private identifiers.
    for (const { id } of BUILTIN_FAMILY_METADATA) {
      expect(comparisons).toContain(`id="${id}"`)
      expect(comparisons).toContain(`id="comparison-mermaid-${id}"`)
      expect(comparisons).toContain(`comparison-agentic-${id}-svg-title`)
      const section = comparisons.match(new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?<\\/section>`))?.[0] ?? ''
      expect(section).toContain('data-comparison-engine="mermaid"')
      expect(section).toContain('data-comparison-engine="agentic"')
      expect(section).toContain('data-comparison-editor-href="/editor/#')
      const href = section.match(/data-comparison-editor-href="([^"]+)"/)?.[1]
      expect(href, `${id}: comparison Editor state`).toBeDefined()
      const state = decodeEditorStateHref(href!)
      expect(editorRenderOptionsFromState(state), `${id}: comparison appearance parity`).toEqual({
        embedFontImport: false,
        security: 'strict',
        ...WEBSITE_EXAMPLE_THEME,
        compact: true,
      })
    }
    expect(comparisons).toContain('A[Start] --&gt; B{Decision?}')
    expect(comparisons).toContain('B --&gt;|Yes| C[Do the thing]')
    expect(comparisons).toContain('group app(cloud)[Application]')
    for (const id of ['flowchart', 'state', 'sequence', 'class', 'er', 'xychart']) {
      const section = comparisons.match(new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?<\\/section>`))?.[0] ?? ''
      expect(section).toContain('data-comparison-engine="beautiful"')
      expect(section).not.toContain('comparison-note')
    }
    for (const id of ['timeline', 'journey', 'architecture', 'pie', 'quadrant', 'gantt', 'mindmap', 'gitgraph']) {
      const section = comparisons.match(new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?<\\/section>`))?.[0] ?? ''
      expect(section).not.toContain('<h3>Beautiful Mermaid</h3>')
      expect(section).toContain('comparison-note')
    }
    expect(comparisons).toContain('Beautiful Mermaid does not render this family')
    // Lazy, per-panel Mermaid rendering is asserted in the browser lane
    // (website-browser-a11y.test.ts: few panels processed at load, all after a walk).
    expect(comparisons).not.toContain('fonts.googleapis.com')
    expect(comparisons).not.toContain('@import url(')
  })

  test('rich gallery promotes the selected Mindmap and GitGraph corpus scenarios', () => {
    const promotions = [
      ['Mindmap', 'Mindmap: Incident Response Command Map', 'eval/mindmap-gitgraph-content-corpus/mindmap/wide-incident-response.mmd'],
      ['Mindmap', 'Mindmap: Multilingual Global Launch', 'eval/mindmap-gitgraph-content-corpus/mindmap/multilingual-long-content.mmd'],
      ['Mindmap', 'Mindmap: Explicit Tidy Tree', 'eval/mindmap-gitgraph-content-corpus/mindmap/tidy-tree-explicit.mmd'],
      ['GitGraph', 'GitGraph: Monorepo Delivery Lanes', 'eval/mindmap-gitgraph-content-corpus/gitgraph/many-lanes-and-ordering.mmd'],
      ['GitGraph', 'GitGraph: Merge Backports', 'eval/mindmap-gitgraph-content-corpus/gitgraph/merge-cherry-pick-backports.mmd'],
      ['GitGraph', 'GitGraph: CI/CD Promotion', 'eval/mindmap-gitgraph-content-corpus/gitgraph/cicd-promotion-pipeline.mmd'],
    ] as const
    const expectedTitlesByCategory = new Map(['Mindmap', 'GitGraph'].map((category) => [
      category,
      promotions.filter(([candidate]) => candidate === category).map(([, title]) => title),
    ]))

    for (const [category, titles] of expectedTitlesByCategory) {
      expect(RICH_EXAMPLES.filter((sample) => sample.category === category).map((sample) => sample.title)).toEqual(titles)
    }

    const examplesIndex = JSON.parse(read('examples/index.json'))
    const examplesHtml = read('examples/corpus/index.html')
    for (const [category, title, fixture] of promotions) {
      const expectedSource = readRepo(fixture).trimEnd()
      const sample = RICH_EXAMPLES.find((candidate) => candidate.title === title)
      expect(sample, title).toEqual(expect.objectContaining({ category, title, source: expectedSource }))
      expect(examplesIndex.richExamples.find((candidate: any) => candidate.title === title), `${title} catalog entry`).toEqual(
        expect.objectContaining({ category, title, source: expectedSource }),
      )
      expect(examplesHtml, `${title} rendered article`).toContain(`<h4>${title}</h4>`)
    }
    const examplesMain = read('examples/index.html')
    expect(examplesMain).toContain('<strong>Mindmap</strong><span>3 shared examples</span>')
    expect(examplesMain).toContain('<strong>GitGraph</strong><span>3 shared examples</span>')
  })

  test('rich gallery exposes one source-verified high-cardinality palette example per controlled family', () => {
    const expected = new Map([
      ['Pie', ['Pie: Platform Workload Portfolio', 10, 'peer slices']],
      ['Radar', ['Radar: Delivery Team Profiles', 8, 'peer curves']],
      ['XY Chart', ['XY: Service Health Portfolio', 8, 'peer series']],
      ['Journey', ['Journey: Cross-functional Release Readiness', 10, 'peer actors']],
      ['Mindmap', ['Mindmap: Incident Response Command Map', 13, 'first-level branches']],
      ['GitGraph', ['GitGraph: Monorepo Delivery Lanes', 12, 'delivery lanes']],
    ] as const)
    const examplesIndex = JSON.parse(read('examples/index.json'))
    const examplesHtml = examplesCatalogHtml()
    const examplesMain = read('examples/index.html')
    expect(examplesMain).toContain('<p class="example-jump-title" id="examples-high-cardinality-palettes-jump">High-cardinality peer palettes</p>')
    const paletteJump = examplesMain.match(/<section class="example-jump-section" aria-labelledby="examples-high-cardinality-palettes-jump">([\s\S]*?)<\/section>/)?.[1] ?? ''
    expect(paletteJump.match(/class="example-jump-card"/g)).toHaveLength(expected.size)
    for (const [category, [title, count, kind]] of expected) {
      const candidates = RICH_EXAMPLES.filter(sample => sample.category === category && sample.palettePeers)
      expect(candidates.length, `${category} designated palette examples`).toBeGreaterThanOrEqual(1)
      const sample = candidates.find(candidate => candidate.title === title)
      expect(sample, title).toEqual(expect.objectContaining({
        category,
        title,
        palettePeers: { count, kind },
      }))
      expect(count, `${title} crosses the legacy boundary`).toBeGreaterThan(6)
      const sourceLabels = sourcePeerLabels(category, sample!.source)
      expect(sourceLabels, `${title} source-derived peers`).toHaveLength(count)
      expect(examplesIndex.richExamples.find((candidate: any) => candidate.title === title), `${title} catalog metadata`).toEqual(
        expect.objectContaining({
          id: richExampleId(sample!),
          category,
          title,
          palettePeers: { count, kind },
          renderUrl: `/examples/corpus/#${richExampleId(sample!)}`,
        }),
      )
      expect(paletteJump, `${title} jump href`).toContain(`href="/examples/corpus/#${richExampleId(sample!)}"`)
      expect(examplesHtml, `${title} palette proof`).toContain(`Palette proof: ${count} ${kind}`)
      const mapping = renderedPeerMapping(category, richExampleArticle(examplesHtml, sample!))
      const article = richExampleArticle(examplesHtml, sample!)
      expect(article, `${title} keyboard-scroll target`).toContain(
        `class="example-svg" tabindex="0" aria-label="${title} diagram. Scroll horizontally to inspect every peer."`,
      )
      expect(mapping.map(([label]) => label), `${title} rendered source-order mapping`).toEqual(sourceLabels)
      expect(mapping, `${title} rendered category-color mapping`).toHaveLength(count)
      expect(new Set(mapping.map(([, color]) => color)).size, `${title} distinct rendered colors`).toBe(count)
      expect(mapping.every(([, color]) => /^#[0-9a-f]{6}$/.test(color)), `${title} concrete rendered colors`).toBe(true)
    }
    expect(new Set(RICH_EXAMPLES.map(sample => richExampleId(sample))).size, 'stable rich example ids').toBe(RICH_EXAMPLES.length)
    expect(richExampleId({ title: 'Mindmap: Incident Response Command Map' })).toBe('rich-mindmap-incident-response-command-map')
    expect(Object.keys(LEGACY_RICH_EXAMPLE_ALIASES).length).toBeGreaterThan(0)
    for (const [legacy, canonical] of Object.entries(LEGACY_RICH_EXAMPLE_ALIASES)) {
      expect(read('examples/index.html'), legacy).toContain(`id="${legacy}" data-example-alias data-example-kind="corpus" data-example-canonical="${canonical}"`)
      expect(read('examples/corpus/index.html'), legacy).toContain(`id="${legacy}" data-example-alias data-example-kind="corpus" data-example-canonical="${canonical}"`)
      expect(examplesHtml, canonical).toContain(`id="${canonical}"`)
    }
    const styles = read('styles.css')
    expect(styles).toContain('.example-sample-palette .example-sample-grid { grid-template-columns: minmax(0, 1fr); }')
    expect(styles).toContain('.example-render-palette .example-svg svg { width: auto; max-width: none; margin-inline: auto; }')
    expect(styles).toContain('.example-render-palette .example-svg svg.xychart { width: 700px; }')
  })

  test('examples pages carry an agent task, trace, and render anchor for every family', () => {
    const examples = read('examples/index.html')
    const allExamples = examplesCatalogHtml()
    // Registry-exact: adding a family without a prompt/trace or supported render
    // must fail this generated-site citizenship gate.
    for (const family of BUILTIN_FAMILY_METADATA) {
      const start = examples.indexOf(`<article class="example-sample" id="${family.id}">`)
      expect(start, `${family.id} article`).toBeGreaterThanOrEqual(0)
      const end = examples.indexOf('</article>', start)
      const article = examples.slice(start, end)
      expect(article, `${family.id} prompt`).toContain('<p class="example-prompt"><span>Prompt</span>')
      expect(article, `${family.id} trace`).toContain('<p class="example-trace"><span>Trace</span>')
      expect(article, `${family.id} narrower`).toContain(`<code>${family.narrower} · mutate(`)
    }
    expect(examples.match(/<p class="example-prompt"><span>Prompt<\/span>/g)).toHaveLength(BUILTIN_FAMILY_METADATA.length)
    expect(examples.match(/<p class="example-trace"><span>Trace<\/span>/g)).toHaveLength(BUILTIN_FAMILY_METADATA.length)
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
    for (const { id } of BUILTIN_FAMILY_METADATA) {
      expect(allExamples).toContain(`<article class="example-sample" id="style-palette-${id}">`)
      expect(examples).not.toContain(`<article class="example-sample" id="style-palette-${id}">`)
      expect(jump).toContain(`href="/examples/style-palette/#style-palette-${id}"`)
    }
    expect(allExamples).toContain('Agents pass this as render options; they do not edit Mermaid source just to change appearance.')
    expect(allExamples).toContain("<code>style: ['ops-schematic', 'nord-light'], seed: 8</code>")
    expect(allExamples).toContain('Open styled</a>')
    expect(allExamples).toContain('<h2 id="examples-rich-gallery">Rich shared example gallery</h2>')
    expect(allExamples).toContain('Build-time proof from the shared examples corpus.')
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
    // The generated-site browser suite opens settings and verifies focus/inert state.
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
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { timeout: 20_000, killSignal: 'SIGKILL', cwd: REPO, encoding: 'utf8' }).trim()
    const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=normal'], { timeout: 20_000, killSignal: 'SIGKILL', cwd: REPO, encoding: 'utf8' })
    const expectedGitSha = resolveBuildGitSha({ head, status })
    for (const rel of ['capabilities.json', 'examples/index.json', '.well-known/mcp.json', '.well-known/mcp/server-card.json', '.well-known/ai-catalog.json']) {
      const json = JSON.parse(read(rel))
      expect({ rel, generatedFrom: Boolean(json.generatedFrom) }).toEqual({ rel, generatedFrom: true })
      expect({ rel, gitSha: json.generatedFrom.gitSha }).toEqual({ rel, gitSha: expectedGitSha })
      expect({ rel, buildTime: json.generatedFrom.buildTime }).not.toEqual({ rel, buildTime: 'development' })
      expect(Number.isNaN(Date.parse(json.generatedFrom.buildTime))).toBe(false)
    }
    // The deploy transaction that stamps and verifies these catalogs is
    // exercised in deploy-workflow-transaction.test.ts.
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
    // The published discovery document must advertise exactly what /mcp admits.
    // These were separately maintained literals until the version list became
    // single-source; a bump to one without the other tells clients we do not
    // support a version we in fact serve, or vice versa.
    expect(mcpCard.protocolVersions).toEqual([...SUPPORTED_PROTOCOL_VERSIONS])
    expect(mcpCard.tools.map((tool: any) => tool.name)).toEqual(['execute', 'describe_sdk', 'render_svg', 'render_ascii', 'render_png', 'verify', 'describe', 'mutate', 'build'])
    expect(mcpCard.tools.every((tool: any) => typeof tool.title === 'string' && tool.title.trim().length > 0)).toBe(true)
    expect(mcpCard.tools.every((tool: any) => tool.annotations?.destructiveHint === false)).toBe(true)
    // Each tool's schema ships once, exactly as tools/list advertises it (its
    // $defs travel with it), and the machine-read manifests are not indented.
    const mcpManifest = JSON.parse(read('.well-known/mcp.json'))
    for (const document of [mcpCard, mcpManifest]) {
      expect(document.tools.map((tool: any) => ({ name: tool.name, inputSchema: tool.inputSchema, parameters: tool.parameters })))
        .toEqual(HOSTED_TOOLS.map(tool => ({ name: tool.name, inputSchema: tool.inputSchema, parameters: undefined })))
    }
    for (const rel of ['.well-known/mcp/server-card.json', '.well-known/mcp.json']) {
      expect({ rel, minified: read(rel) === `${JSON.stringify(JSON.parse(read(rel)))}\n` }).toEqual({ rel, minified: true })
    }
    expect(mcpManifest.serverUrl).toBe('https://agentic-mermaid.dev/mcp')
    expect(mcpManifest.tools.map((tool: any) => ({ name: tool.name, title: tool.title }))).toEqual(
      mcpCard.tools.map((tool: any) => ({ name: tool.name, title: tool.title })),
    )
    expect(JSON.parse(read('schemas/render-options.schema.json'))).toEqual(sharedRenderOptionsJsonSchema())
    const aiCatalog = JSON.parse(read('.well-known/ai-catalog.json'))
    expect(aiCatalog.entries.find((entry: any) => entry.identifier === 'urn:air:agentic-mermaid.dev:warnings')).toMatchObject({
      type: 'text/markdown',
      url: 'https://agentic-mermaid.dev/warning-codes.md',
    })
    expect(existsSync(join(SITE, 'warning-codes.md'))).toBe(true)
    expect(existsSync(join(SITE, 'warnings/index.md'))).toBe(false)
    expect(aiCatalog.entries.map((entry: any) => ({
      identifier: entry.identifier,
      type: entry.type,
      path: new URL(entry.url).pathname,
    }))).toEqual(AI_CATALOG_RESOURCES)
    expect(new Set(aiCatalog.entries.map((entry: any) => entry.identifier)).size).toBe(aiCatalog.entries.length)
    expect(new Set(aiCatalog.entries.map((entry: any) => entry.url)).size).toBe(aiCatalog.entries.length)
    for (const resource of AI_CATALOG_RESOURCES) expect(existsSync(join(SITE, resource.path.slice(1)))).toBe(true)
    const capabilities = JSON.parse(read('capabilities.json'))
    expect(capabilities.families.map((family: any) => family.id)).toContain('flowchart')
    expect(capabilities.warningCodes.map((warning: any) => warning.tier)).toContain('structural')
    const examplesIndex = JSON.parse(read('examples/index.json'))
    expect(examplesIndex.examples.map((example: any) => example.id)).toEqual(editorExampleIds())
    const editorRuntime = read(editorScriptRel(read('editor/index.html')))
    expect(readEmittedGlobal<unknown>(editorRuntime, 'EDITOR_EXAMPLES')).toEqual(JSON.parse(JSON.stringify(EDITOR_EXAMPLES)))
    expect(examplesIndex.richExamples).toEqual(RICH_EXAMPLES.map((sample) => ({
      id: richExampleId(sample),
      category: sample.category ?? 'Examples',
      title: sample.title,
      description: sample.description,
      source: String(sample.source ?? '').trim(),
      options: sample.options ?? {},
      ...(sample.palettePeers ? { palettePeers: sample.palettePeers } : {}),
      renderUrl: `/examples/corpus/#${richExampleId(sample)}`,
      editorUrl: expect.stringContaining('/editor/#'),
    })))
    expect(examplesIndex.richExamples.some((example: any) => example.category === 'Style + Palette')).toBe(true)
    const examplesHtml = examplesCatalogHtml()
    expect(examplesHtml).toContain('Build-time proof: rendered from the same source and options the editor loads.')
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
      expect(example.editorUrl).toContain('/editor/#deflate:')
    }
  })

  test('custom style docs publish schema, examples, and screenshots', () => {
    const schema = JSON.parse(read('schemas/style-spec.schema.json'))
    const catalog = JSON.parse(read('examples/styles/catalog.json')) as {
      sample: string
      examples: Array<{ style: string; screenshot: string }>
    }
    expect(schema.$id).toBe('https://agentic-mermaid.dev/schemas/style-spec.schema.json')
    const page = read('docs/custom-styles/index.html')
    expect(page).toContain('/schemas/style-spec.schema.json')
    expect(page).toContain('/examples/styles/transit-route-map.style.json')
    expect(page).toContain('/examples/styles/cupertino-prototype.style.json')
    expect(page).toContain('not registered or advertised as a built-in Style')
    expect(page).toContain('Level 3: semantic role defaults')
    expect(page).toContain('Level 4: category bindings and inspect-only constraints')
    expect(page).toContain('am verify diagram.mmd --style brand.style.json')
    expect(page).not.toContain('role typography, spacing, radii and designed modes remain Section B evidence')
    expect(page).toContain('/docs/assets/style-cookbook/transit-route-map.png')
    expect(page).toContain('/docs/assets/style-cookbook/cupertino-prototype.png')
    expect(page).toContain('not an Apple product')
    expect(page).toContain('<h2>Custom fonts</h2>')
    expect(page).toContain('--font-dirs ./fonts')
    expect(page).toContain('Local MCP <code>render_png</code> accepts <code>fontDirs</code> and <code>loadSystemFonts</code>')
    expect(page).toContain('Hosted MCP has no filesystem font input')
    const catalogFiles = catalog.examples.flatMap(entry => [
      `examples/styles/${entry.style}`,
      `docs/assets/style-cookbook/${entry.screenshot}`,
    ])
    for (const rel of [`examples/styles/${catalog.sample}`, ...catalogFiles]) {
      expect({ rel, exists: existsSync(join(SITE, rel)) }).toEqual({ rel, exists: true })
    }
  })

  test('MCP claims cover the hosted endpoint without a stale public harness manifest', () => {
    expect(existsSync(join(SITE, 'harnesses.json'))).toBe(false)
    const publicText = files().filter((f) => /\.(html|json|md|txt)$/.test(f)).map(read).join('\n')
    expect(publicText).toContain('execute</code>, <code>describe_sdk</code>, <code>render_png</code>, and <code>describe</code>')
    const mcpPage = read('docs/mcp/index.html')
    expect(mcpPage).toContain('Hosted tools: <code>execute</code>, <code>describe_sdk</code>, <code>render_svg</code>')
    expect(mcpPage).toContain('The local MCP tools are <code>execute</code>, <code>describe_sdk</code>, <code>render_png</code>, and <code>describe</code>')
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


  test('hidden controls and dialogs publish accessible initial semantics', () => {
    const editor = read('editor/index.html')
    // Runtime behaviour of these controls (the "?" dialog, Cmd/Ctrl+C in the
    // source, copy-button width) is exercised in a real browser by
    // e2e/editor-site-interactions.e2e.test.ts and website-browser-a11y.test.ts;
    // the shipped copy-feedback script is exercised below.
    expect(editor).toContain('id="examples-sidebar" aria-label="Example diagrams" aria-hidden="true" inert')
    expect(editor).toContain('id="config-view" role="dialog" aria-modal="false" aria-label="Diagram settings" hidden aria-hidden="true" inert')
    expect(editor).not.toContain('aria-keyshortcuts="Meta+C Control+C"')
    // The Share and "?" buttons are gone from the topbar; copy-link lives on in
    // the export dropdown and the cheat sheet is reached by the "?" key alone.
    expect(editor).not.toContain('id="share-btn"')
    expect(editor).not.toContain('id="shortcuts-btn"')
    expect(editor).toContain('id="copy-link-btn"')
    expect(editor).toContain('id="shortcuts-dialog" role="dialog" aria-modal="true"')
    expect(read('warnings/index.html')).toContain('<td data-label="Code">')
    expect(read('warnings/index.html')).toContain('data-warning-filter')
    expect(editor).toContain('aria-haspopup="dialog"')
    expect(editor).toContain('id="export-dropdown" role="dialog" aria-modal="false" aria-label="Export options"')
    expect(editor).not.toContain('role="menu" aria-label="Export options"')
    expect(editor).toContain('id="font-popup" role="dialog" aria-modal="false" aria-label="Font picker"')
    expect(editor).toContain('role="dialog" aria-modal="false" aria-labelledby="color-popup-title" aria-hidden="true"')
    expect(editor).toContain('class="status-left" role="status" aria-live="polite" aria-atomic="true"')
    expect(editor).toContain('id="verify-bar" role="status" aria-live="polite" aria-atomic="true"')
  })

  test('shipped copy feedback holds the button width while its label changes, then restores it', async () => {
    // Drive the shipped theme.js (shared copy feedback + site wiring) through a
    // click on a copy button. The layout double sizes the button from its label
    // unless a min-width reserves more, as a flex item would be.
    const timers = manualTimers()
    const document = new FakeDocument()
    const widget = document.element('div', { 'data-copy-widget': '' })
    const button = document.element('button', { class: 'primary-action', 'data-copy-text': 'Fetch https://agentic-mermaid.dev/start.md', 'data-copy-name': 'Agent prompt' }, widget)
    document.element('span', { class: 'copy-prompt-icon' }, button)
    const label = document.element('span', {}, button, [document.createTextNode('Use with an agent')])
    const status = document.element('p', { role: 'status' }, widget)
    button.layout = () => ({ width: Math.max(Number.parseFloat(button.style.minWidth || '0') || 0, 24 + 7.3 * label.textContent.length) })
    const copied: string[] = []
    runBrowserScriptInContext(read('theme.js'), {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      document,
      navigator: { clipboard: { writeText: async (text: string) => { copied.push(text) } } },
    }, 'website/public/theme.js')
    const restingWidth = button.getBoundingClientRect().width
    button.click()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(copied).toEqual(['Fetch https://agentic-mermaid.dev/start.md'])
    expect(label.textContent).toBe('Copied')
    expect(button.dataset.copyState).toBe('ok')
    expect(status.textContent).toBe('Agent prompt copied to clipboard.')
    expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(restingWidth)
    expect(button.getBoundingClientRect().width).toBeLessThan(restingWidth + 1)
    timers.flush()
    expect(label.textContent).toBe('Use with an agent')
    expect(button.dataset.copyState).toBeUndefined()
    expect(status.textContent).toBe('')
    expect(button.style.minWidth).toBe('')
    expect(button.getBoundingClientRect().width).toBe(restingWidth)
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
    const advertisedWarnings = JSON.parse(read('capabilities.json')).warningCodes as Array<{ code: string; example?: string }>
    for (const warning of advertisedWarnings.filter(warning => warning.example)) {
      const warningHtml = read(`warnings/${warning.code}/index.html`)
      const href = warningHtml.match(/href="(\/editor\/#deflate:[A-Za-z0-9_-]+)"/)?.[1]
      expect(href, `${warning.code}: Editor reproducer link`).toBeDefined()
      const state = decodeEditorStateHref(href!)
      expect(state.source, `${warning.code}: linked source`).toBe(warning.example!)
      const renderOptions = editorRenderOptionsFromState(state)
      expect({ code: warning.code, fires: verifyMermaid(state.source as string, { renderOptions }).warnings.some(actual => actual.code === warning.code) })
        .toEqual({ code: warning.code, fires: true })
      expect(warningHtml).toContain('Minimal reproducer')
    }
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
    expect(graph.map((node: any) => node['@type'])).toEqual(expect.arrayContaining(['Organization', 'SoftwareApplication', 'Service', 'WebPage']))
    // FAQPage markup lives only on /about/, the page whose visible FAQ it
    // describes (Google requires the Q&A to be on-page; site-wide duplication
    // risks the markup being ignored).
    expect(graph.map((node: any) => node['@type'])).not.toContain('FAQPage')
    const aboutJsonLd = read('about/index.html').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1]
    const aboutGraph = JSON.parse(aboutJsonLd!)['@graph']
    expect(aboutGraph.map((node: any) => node['@type'])).toContain('FAQPage')
    expect(read('about/index.html')).toContain('Frequently asked questions')
    expect(graph.find((node: any) => node['@type'] === 'Organization').contactPoint.url).toBe('https://github.com/adewale/agentic-mermaid/issues')
    expect(graph.find((node: any) => node['@type'] === 'Organization').address.addressCountry).toBe('US')
    expect(graph.find((node: any) => node['@type'] === 'WebPage').speakable.cssSelector).toContain('h1')
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
    const hostedLine = text.match(/Hosted MCP endpoint[^\n]+with ([^.]+)\./)?.[1] ?? ''
    expect(hostedLine.split(/,\s*/)).toEqual(HOSTED_TOOLS.map(tool => tool.name))
  })

  test('production CSP forbids inline executable scripts and generated pages externalize them', () => {
    const headers = read('_headers')
    expect(headers).toContain("script-src 'self'")
    expect(headers).not.toContain("script-src 'self' 'unsafe-inline'")
    for (const rel of files().filter(candidate => candidate.endsWith('.html'))) {
      expect({ rel, executableInlineScript: /<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>/i.test(read(rel)) })
        .toEqual({ rel, executableInlineScript: false })
    }
    expect(read('comparisons/index.html')).toMatch(/<script src="\/generated\/inline-[a-f0-9]{12}\.js"><\/script>/)
    expect(read('warnings/index.html')).toMatch(/<script src="\/generated\/inline-[a-f0-9]{12}\.js"><\/script>/)
  })

  test('audit fixes give public proof diagrams accessible names and immutable editor assets', () => {
    const home = read('index.html')
    const examples = read('examples/index.html')
    expect(home).toContain('role="img" aria-labelledby="edit-loop-svg-title edit-loop-svg-desc"')
    expect(home).toContain('<title id="edit-loop-svg-title">Agentic Mermaid edit loop</title>')
    expect(examples).toContain('role="img" aria-labelledby="example-flowchart-basic-svg-title example-flowchart-basic-svg-desc"')
    expect(examples).toContain('<title id="example-flowchart-basic-svg-title">Flowchart diagram</title>')
    expect(examples).toContain('aria-labelledby="example-timeline-basic-svg-title example-timeline-basic-svg-desc"')
    expect(examples).toContain('aria-labelledby="example-journey-basic-svg-title example-journey-basic-svg-desc"')
    expect(examples).not.toContain('aria-labelledby="tl-')
    expect(examples).not.toContain('aria-labelledby="journey-')
    // Cache policy is the worker's alone; its behaviour (immutable hashed
    // assets, no-cache HTML, stripped upstream cache headers) is asserted on
    // real responses in the Worker-first routing test above.
    expect(read('_headers')).not.toContain('Cache-Control')
  })

  test('the brand mark paints once and animates only for a bounded sweep on hover or focus', () => {
    const mark = shaderMarkHarness({ reducedMotion: false })
    expect(mark.draws()).toBeGreaterThan(0)
    expect(mark.pendingFrames()).toBe(0)
    for (const event of ['pointerenter', 'pointerleave', 'focusin', 'focusout']) {
      mark.trigger.dispatch(event)
      expect({ event, animating: mark.pendingFrames() }).toEqual({ event, animating: 1 })
      const frames = mark.runUntilIdle()
      expect({ event, settled: mark.pendingFrames(), bounded: frames > 10 && frames < 300 }).toEqual({ event, settled: 0, bounded: true })
    }

    const reduced = shaderMarkHarness({ reducedMotion: true })
    reduced.trigger.dispatch('pointerenter')
    expect(reduced.pendingFrames()).toBe(0)
    expect(reduced.draws()).toBeGreaterThan(0)
  })
})
