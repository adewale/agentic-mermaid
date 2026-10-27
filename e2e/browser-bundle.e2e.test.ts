/**
 * Browser bundle contract (BUILD-30).
 *
 * The published `./browser` IIFE is the only artifact a `<script src>` consumer
 * can use: there is no resolver in a plain script tag, so nothing about the ESM
 * entries or the exports map protects this path. This file is that protection.
 *
 * It drives `dist/browser.global.js` in real browser engines and asserts:
 *   B1  the global exists and carries the render surface — the exact failure the
 *       PR-118 consumer hit, where a hand-rolled bundle built clean and left the
 *       global `undefined`
 *   B2  every registered family renders, and renders byte-identically to the
 *       source build — the bundle is a faithful build, not a lossy one
 *   B3  no node: builtin leaked into the artifact
 *
 * B2 enumerates BUILTIN_FAMILY_METADATA rather than a fixture list, so a family
 * added to the registry later is covered here without editing this file.
 *
 * Requires: Playwright browsers installed
 * (`bunx playwright install chromium firefox webkit`).
 * Run:  bun run test:browser
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright'
import { BUILTIN_FAMILY_METADATA } from '../src/agent/families.ts'
import { registerStyle, resolveStyleStack, renderMermaidSVG, renderMermaidSVGWithReceipt } from '../src/index.ts'
import { serveWithAvailablePort } from './test-port.ts'

const REPO = join(import.meta.dir, '..')
const BUNDLE = join(REPO, 'dist', 'browser.global.js')
const LAZY_ENTRY = join(REPO, 'dist', 'browser-lazy', 'index.js')
const LAZY_METAFILE = join(REPO, 'dist', 'metafile-esm.json')
const ZENUML_ENTRY = join(REPO, 'dist', 'zenuml.js')
const ZENUML_FRAME = join(REPO, 'dist', 'zenuml-frame.global.js')
const BUILD_TIMEOUT_MS = 300_000
/** The IIFE's `globalName`. Changing it is a breaking change for script-tag consumers. */
const GLOBAL = 'agenticMermaid'

/** Newest modification time among the bundle's build inputs: production
 *  source, the tsup configs, and package.json. Tests are not inputs, and
 *  `generated/` directories are written by the build itself. */
function newestBuildInputMtime(): number {
  let newest = 0
  const visit = (path: string): void => {
    const stat = statSync(path)
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) if (entry !== '__tests__' && entry !== 'generated') visit(join(path, entry))
    } else {
      newest = Math.max(newest, stat.mtimeMs)
    }
  }
  visit(join(REPO, 'src'))
  for (const file of ['package.json', 'tsup.config.ts', 'tsup.browser.config.ts', 'tsup.browser-lazy.config.ts', 'tsup.zenuml.config.ts']) visit(join(REPO, file))
  return newest
}

function ensureBrowserBundle() {
  const outputs = [BUNDLE, LAZY_ENTRY, LAZY_METAFILE, ZENUML_ENTRY, ZENUML_FRAME]
  // Reuse a local dist only when it is newer than every input: a stale bundle
  // could otherwise fake parity with (or mask a break in) the current source.
  if (outputs.every(existsSync) && Math.min(...outputs.map(path => statSync(path).mtimeMs)) >= newestBuildInputMtime()) return
  const build = spawnSync('bun', ['run', 'build'], { cwd: REPO, encoding: 'utf8', timeout: BUILD_TIMEOUT_MS })
  if (build.status !== 0 || !existsSync(BUNDLE)) {
    throw new Error(`\`bun run build\` did not produce ${BUNDLE} (status ${build.status}).\n${build.stderr ?? ''}`)
  }
}

function lazyElkChunk(): string {
  const metafile = JSON.parse(readFileSync(LAZY_METAFILE, 'utf8')) as {
    outputs: Record<string, { inputs: Record<string, unknown> }>
  }
  const matches = Object.entries(metafile.outputs).filter(([, output]) =>
    Object.keys(output.inputs).some(input => input.includes('node_modules/elkjs/')))
  expect(matches.length).toBe(1)
  return matches[0]![0].replace(/^dist\//, '')
}

function lazyYamlChunks(): string[] {
  const metafile = JSON.parse(readFileSync(LAZY_METAFILE, 'utf8')) as {
    outputs: Record<string, { inputs: Record<string, unknown> }>
  }
  const matches = Object.entries(metafile.outputs).filter(([, output]) =>
    Object.keys(output.inputs).some(input => input.includes('node_modules/yaml/') || input === 'src/shared/mermaid-yaml-runtime.ts'))
  expect(matches.length).toBeGreaterThan(0)
  return matches.map(([path]) => path.replace(/^dist\//, ''))
}

describe('browser bundle', () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    ensureBrowserBundle()
    browser = await chromium.launch()
    page = await browser.newPage()
    await page.setContent('<!doctype html><html><body></body></html>')
    await page.addScriptTag({ path: BUNDLE })
  }, BUILD_TIMEOUT_MS)

  afterAll(async () => {
    await browser?.close()
  })

  // B1. The PR-118 failure mode: a bundle that builds and exports nothing.
  test('exposes the render surface on the global', async () => {
    expect(BUILTIN_FAMILY_METADATA.length).toBeGreaterThan(0)
    const surface = await page.evaluate(name => {
      const api = (globalThis as Record<string, any>)[name]
      return {
        present: Boolean(api),
        renderMermaidSVG: typeof api?.renderMermaidSVG,
        renderMermaidASCII: typeof api?.renderMermaidASCII,
      }
    }, GLOBAL)
    expect(surface.present).toBe(true)
    expect(surface.renderMermaidSVG).toBe('function')
    expect(surface.renderMermaidASCII).toBe('function')
  })


  test('XML DOM preserves whitespace identities and relation accessibility across SVG styles', async () => {
    const source = 'sankey-beta\n"A\nB",X,1\n"A B",Y,2\n"A\tB",Z,3\n"A\rB",CR,4\n"A\tB",Z,5\n"link:A\tB->Z",Other,6\n"A\n\nB",Blank,7'
    for (const style of [undefined, 'hand-drawn']) {
      const actual = await page.evaluate(({ name, source, style }) => {
        const svg = (globalThis as Record<string, any>)[name].renderMermaidSVG(source, { embedFontImport: false, ...(style ? { style } : {}) })
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
        return {
          errors: doc.querySelectorAll('parsererror').length,
          nodes: [...doc.querySelectorAll('[data-role="bar"]')].map(element => element.getAttribute('data-id')),
          edges: [...doc.querySelectorAll('[data-role="edge"]')].map(element => ({ id: element.getAttribute('data-id'), from: element.getAttribute('data-from'), to: element.getAttribute('data-to'), label: element.getAttribute('aria-label') })),
          identities: [...doc.querySelectorAll('[data-id]')].map(element => element.getAttribute('data-id')),
        }
      }, { name: GLOBAL, source, style })
      expect(actual.errors).toBe(0)
      expect(actual.nodes).toEqual(['A\nB', 'X', 'A B', 'Y', 'A\tB', 'Z', 'A\rB', 'CR', 'link:A\tB->Z', 'Other', 'A\n\nB', 'Blank'])
      expect(actual.edges).toEqual([
        { id: 'link:A\nB->X', from: 'A\nB', to: 'X', label: 'A\nB to X' },
        { id: 'link:A B->Y', from: 'A B', to: 'Y', label: 'A B to Y' },
        { id: 'link:A\tB->Z#1', from: 'A\tB', to: 'Z', label: 'A\tB to Z' },
        { id: 'link:A\rB->CR', from: 'A\rB', to: 'CR', label: 'A\rB to CR' },
        { id: 'link:A\tB->Z#1#1', from: 'A\tB', to: 'Z', label: 'A\tB to Z' },
        { id: 'link:link:A\tB->Z->Other', from: 'link:A\tB->Z', to: 'Other', label: 'link:A\tB->Z to Other' },
        { id: 'link:A\n\nB->Blank', from: 'A\n\nB', to: 'Blank', label: 'A\n\nB to Blank' },
      ])
      expect(new Set(actual.identities).size).toBe(actual.identities.length)
    }
  })

  for (const family of BUILTIN_FAMILY_METADATA) {
    test(`renders ${family.id} identically to the source build`, async () => {
      const result = await page.evaluate(
        ([name, source]) => {
          try {
            return { svg: (globalThis as Record<string, any>)[name].renderMermaidSVG(source), error: null }
          } catch (error) {
            return { svg: null, error: String(error) }
          }
        },
        [GLOBAL, family.example] as const,
      )
      expect(result.error, `${family.id} threw in the browser`).toBeNull()
      expect(result.svg).toContain('<svg')
      // Byte-equality against the source build. Layout is deterministic and text
      // metrics are contract-driven, so any divergence here is the bundle
      // dropping or substituting something, not browser rasterization.
      expect(result.svg).toBe(renderMermaidSVG(family.example))
    })
  }

  // B3. `platform: 'browser'` should make this impossible at build time; assert
  // it on the shipped bytes anyway, since that is what consumers download.
  test('ships no node: builtin imports', () => {
    const source = readFileSync(BUNDLE, 'utf8')
    expect(source).not.toMatch(/(?:require\(|from\s*)["']node:/)
  })
})

describe('directly served optional ZenUML ESM', () => {
  let browser: Browser, server: ReturnType<typeof serveWithAvailablePort>['server'], base: string
  beforeAll(async () => {
    ensureBrowserBundle()
    const served = serveWithAvailablePort({
      preferredPort: 4742,
      fetch(request) {
        const path = new URL(request.url).pathname
        if (path === '/') return new Response('<!doctype html><body><div id="output"></div></body>', { headers: { 'content-type': 'text/html' } })
        if (path.startsWith('/dist/') && !path.includes('..')) return new Response(Bun.file(join(REPO, path)), { headers: { 'content-type': 'text/javascript' } })
        return new Response('not found', { status: 404 })
      },
    })
    server = served.server
    base = served.base
    browser = await chromium.launch()
  }, BUILD_TIMEOUT_MS)
  afterAll(async () => { await browser?.close(); server?.stop(true) })

  test('shipped ESM loads palettes and session rendering without a bundler or import map', async () => {
    const page = await browser.newPage()
    const requests: string[] = [], failures: string[] = []
    page.on('request', request => requests.push(new URL(request.url()).pathname))
    page.on('pageerror', error => failures.push(error.message))
    await page.goto(base)
    const disposeStyle = registerStyle({ name: 'palette:test/zenuml-host', colors: { bg: '#123456', fg: '#ffffff' } })
    let inlineStyle
    try { inlineStyle = resolveStyleStack('palette:test/zenuml-host')! } finally { disposeStyle() }
    const result = await page.evaluate(async inlineStyle => {
      const entry = '/dist/zenuml.js', api = await import(entry)
      const renderer = api.createZenUMLRenderer({ backendURL: '/dist/zenuml-frame.global.js' })
      const backgrounds: string[] = []
      const source = 'zenuml\nAlice->Bob: hello'
      try {
        await api.renderZenUMLSVG(source, { backendURL: '/dist/zenuml-frame.global.js' })
        const initialPaletteRequests = performance.getEntriesByType('resource').filter(entry => entry.name.includes('/zenuml/chunks/appearance-')).length
        let separateRegistration = 'unexpected-success'
        try { await renderer.render(source, { style: 'palette:test/zenuml-host' }) }
        catch (error) { separateRegistration = (error as { code: string }).code }
        for (const style of ['github-light', 'dracula', inlineStyle]) {
          document.getElementById('output')!.innerHTML = await renderer.render(source, { style })
          backgrounds.push(getComputedStyle(document.querySelector('.frame-border-inner')!).fill)
        }
        return { backgrounds, initialPaletteRequests, separateRegistration, text: document.getElementById('output')!.textContent, frames: document.querySelectorAll('iframe').length }
      } finally { renderer.dispose() }
    }, inlineStyle)
    expect(result.backgrounds).toEqual(['rgb(255, 255, 255)', 'rgb(40, 42, 54)', 'rgb(18, 52, 86)'])
    expect(result.text).toContain('hello')
    expect(result.initialPaletteRequests).toBe(0)
    expect(result.separateRegistration).toBe('UNSUPPORTED_APPEARANCE')
    expect(result.frames).toBe(1)
    expect(await page.locator('iframe').count()).toBe(0)
    expect(failures).toEqual([])
    expect(requests).toContain('/dist/zenuml-frame.global.js')
    expect(requests.some(path => path.startsWith('/dist/zenuml/chunks/appearance-'))).toBe(true)
    await page.close()
  }, 30_000)
})

// The exhaustive byte-parity matrix stays in Chromium so adding a family does
// not triple an already broad suite. These smoke contracts exercise the other
// two browser engines CI promises for the current Playwright release.
describe('current cross-engine browser support', () => {
  let server: ReturnType<typeof serveWithAvailablePort>['server']
  let base = ''

  beforeAll(() => {
    ensureBrowserBundle()
    const served = serveWithAvailablePort({
      preferredPort: 4741,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === '/classic.html') {
          return new Response(
            '<!doctype html><meta charset="utf-8"><script src="/dist/browser.global.js"></script>',
            { headers: { 'content-type': 'text/html; charset=utf-8' } },
          )
        }
        if (url.pathname === '/dist/browser.global.js') {
          return new Response(Bun.file(BUNDLE), {
            headers: { 'content-type': 'text/javascript; charset=utf-8' },
          })
        }
        return new Response('not found', { status: 404 })
      },
    })
    server = served.server
    base = served.base
  }, BUILD_TIMEOUT_MS)

  afterAll(() => {
    server?.stop(true)
  })

  for (const [engineName, engine] of [
    ['Firefox', firefox],
    ['WebKit', webkit],
  ] as const) {
    test(
      `${engineName} exposes the global and renders SVG`,
      async () => {
        const engineBrowser = await engine.launch()
        try {
          const enginePage = await engineBrowser.newPage()
          const requestedPaths: string[] = []
          enginePage.on('request', request => requestedPaths.push(new URL(request.url()).pathname))
          await enginePage.goto(`${base}/classic.html`, { waitUntil: 'load' })
          const result = await enginePage.evaluate(
            ([name, source]) => {
              const api = (globalThis as Record<string, any>)[name]
              return {
                renderMermaidSVG: typeof api?.renderMermaidSVG,
                svg: api?.renderMermaidSVG(source),
              }
            },
            [GLOBAL, 'timeline\n  title Cross-engine\n  2026 : Ship'] as const,
          )
          expect(result.renderMermaidSVG).toBe('function')
          expect(result.svg).toContain('<svg')
          expect(result.svg).toContain('Cross-engine')
          expect(requestedPaths).toContain('/dist/browser.global.js')
        } finally {
          await engineBrowser.close()
        }
      },
      BUILD_TIMEOUT_MS,
    )
  }
})

// BUILD-31: native ESM loading is tested over HTTP because file evaluation or
// source-level imports do not exercise the emitted dynamic-import graph.
describe('async family-loaded browser renderer', () => {
  let server: ReturnType<typeof serveWithAvailablePort>['server']
  let base = ''
  let browser: Browser

  beforeAll(async () => {
    ensureBrowserBundle()
    const served = serveWithAvailablePort({
      preferredPort: 4721,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === '/blank.html') return new Response('<!doctype html><meta charset="utf-8">', {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
        if (!url.pathname.startsWith('/dist/browser-lazy/')) return new Response('not found', { status: 404 })
        const file = Bun.file(join(REPO, url.pathname))
        return (await file.exists())
          ? new Response(file, { headers: { 'content-type': 'text/javascript; charset=utf-8' } })
          : new Response('not found', { status: 404 })
      },
    })
    server = served.server
    base = served.base
    browser = await chromium.launch()
  }, BUILD_TIMEOUT_MS)

  afterAll(async () => {
    server?.stop(true)
    await browser?.close()
  })

  for (const [engineName, engine] of [
    ['Firefox', firefox],
    ['WebKit', webkit],
  ] as const) {
    test(`${engineName} loads the native ESM graph and renders Timeline`, async () => {
      const engineBrowser = await engine.launch()
      try {
        const page = await engineBrowser.newPage()
        await page.goto(`${base}/blank.html`)
        const svg = await page.evaluate(async entryUrl => {
          const api = await import(entryUrl)
          return api.renderMermaidSVGAsync('timeline\n  title Lazy cross-engine\n  2026 : Ship', {
            security: 'strict',
          })
        }, `${base}/dist/browser-lazy/index.js`)
        expect(svg).toContain('<svg')
        expect(svg).toContain('Lazy cross-engine')
      } finally {
        await engineBrowser.close()
      }
    }, BUILD_TIMEOUT_MS)
  }

  test('renders every family with exact strict-mode parity', async () => {
    const page = await browser.newPage()
    try {
      await page.goto(`${base}/blank.html`)
      for (const family of BUILTIN_FAMILY_METADATA) {
        const result = await page.evaluate(async ([entryUrl, source]) => {
          try {
            const api = await import(entryUrl)
            const result = await api.renderMermaidSVGWithReceiptAsync(source, { security: 'strict' })
            return { svg: result.svg, receipt: result.receipt, error: null }
          } catch (error) {
            return { svg: null, receipt: null, error: String(error) }
          }
        }, [`${base}/dist/browser-lazy/index.js`, family.example] as const)
        expect(result.error, `${family.id} threw in the async browser entry`).toBeNull()
        const expected = renderMermaidSVGWithReceipt(family.example, { security: 'strict' })
        expect(result.svg).toBe(expected.svg)
        expect(result.receipt).toEqual(expected.receipt)
      }
    } finally {
      await page.close()
    }
  }, BUILD_TIMEOUT_MS)

  test('the emitted Pie family decodes full named references in a real browser', async () => {
    const source = 'pie\n  "A#NotEqualTilde;B" : 1\n  "C#notit;D" : 2\n'
    const page = await browser.newPage()
    try {
      await page.goto(`${base}/blank.html`)
      const svg = await page.evaluate(async ([entryUrl, pieSource]) => {
        const api = await import(entryUrl)
        return api.renderMermaidSVGAsync(pieSource, { security: 'strict' })
      }, [`${base}/dist/browser-lazy/index.js`, source] as const)
      expect(svg).toBe(renderMermaidSVG(source, { security: 'strict' }))
      expect(svg).toContain('A≂̸B')
      expect(svg).toContain('C¬it;D')
    } finally {
      await page.close()
    }
  }, BUILD_TIMEOUT_MS)

  test('a non-ELK family fetches no ELK code', async () => {
    const page = await browser.newPage()
    const requests: string[] = []
    page.on('request', request => requests.push(new URL(request.url()).pathname.replace(/^\/dist\//, '')))
    try {
      await page.goto(`${base}/blank.html`)
      const svg = await page.evaluate(async entryUrl => {
        const api = await import(entryUrl)
        return api.renderMermaidSVGAsync('timeline\n  title Small\n  2026 : Ship')
      }, `${base}/dist/browser-lazy/index.js`)
      expect(svg).toContain('<svg')
      expect(svg).toContain('Small')
      expect(requests).not.toContain(lazyElkChunk())
    } finally {
      await page.close()
    }
  })

  test('ELK-backed families fetch and reuse one shared ELK chunk', async () => {
    const page = await browser.newPage()
    const requests: string[] = []
    page.on('request', request => requests.push(new URL(request.url()).pathname.replace(/^\/dist\//, '')))
    try {
      await page.goto(`${base}/blank.html`)
      const svgs = await page.evaluate(async entryUrl => {
        const api = await import(entryUrl)
        return [
          await api.renderMermaidSVGAsync('flowchart LR\n  A --> B'),
          await api.renderMermaidSVGAsync('stateDiagram-v2\n  [*] --> Ready'),
        ]
      }, `${base}/dist/browser-lazy/index.js`)
      expect(svgs).toEqual([
        renderMermaidSVG('flowchart LR\n  A --> B'),
        renderMermaidSVG('stateDiagram-v2\n  [*] --> Ready'),
      ])
      expect(requests.filter(path => path === lazyElkChunk())).toHaveLength(1)
    } finally {
      await page.close()
    }
  })

  test('ordinary diagrams fetch no YAML and a wrapped named-reference cycle loads every demanded provider once', async () => {
    const page = await browser.newPage()
    const requests: string[] = []
    page.on('request', request => requests.push(new URL(request.url()).pathname.replace(/^\/dist\//, '')))
    try {
      await page.goto(`${base}/blank.html`)
      const forest = 'flowchart LR\n  A[Start] --> B[End]'
      const result = await page.evaluate(async ([entryUrl, source]) => {
        const api = await import(entryUrl)
        return api.renderMermaidSVGAsync(source, { security: 'strict' })
      }, [`${base}/dist/browser-lazy/index.js`, forest] as const)
      expect(result).toBe(renderMermaidSVG(forest, { security: 'strict' }))
      expect(requests).not.toContain(lazyElkChunk())
      const sequence = 'sequenceDiagram\n  Alice->>Bob: Ready'
      const plainSequence = await page.evaluate(async ([entryUrl, source]) => {
        const api = await import(entryUrl)
        return api.renderMermaidSVGAsync(source, { security: 'strict' })
      }, [`${base}/dist/browser-lazy/index.js`, sequence] as const)
      expect(plainSequence).toBe(renderMermaidSVG(sequence, { security: 'strict' }))
      for (const chunk of lazyYamlChunks()) expect(requests).not.toContain(chunk)

      const cycle = '---\ntitle: YAML demand\n---\nflowchart LR\n  A["x#hearts;y"] --> B[End]\n  B --> A'
      const resumed = await page.evaluate(async ([entryUrl, source]) => {
        const api = await import(entryUrl)
        const diagnostics: string[] = []
        let reads = 0
        const options = {
          security: 'strict',
          get mermaidConfig() { reads++; return { flowchart: { defaultRenderer: 'dagre' } } },
          onConfigDiagnostic: (item: { field: string }) => diagnostics.push(item.field),
        }
        const first = await api.renderMermaidSVGWithReceiptAsync(source, options)
        const repeated = await api.renderMermaidSVGAsync(source, { security: 'strict' })
        return { first, repeated, diagnostics, reads }
      }, [`${base}/dist/browser-lazy/index.js`, cycle] as const)
      expect(resumed.first.svg).toBe(renderMermaidSVG(cycle, { security: 'strict' }))
      expect(resumed.repeated).toBe(resumed.first.svg)
      expect(resumed.first.svg).toContain('x♥y')
      expect(resumed.first.receipt.layoutCertification?.status).toBe('passed')
      expect(resumed.diagnostics).toEqual(['flowchart.defaultRenderer'])
      expect(resumed.reads).toBe(1)
      expect(requests.filter(path => path === lazyElkChunk())).toHaveLength(1)
      for (const chunk of lazyYamlChunks()) expect(requests.filter(path => path === chunk)).toHaveLength(1)
    } finally {
      await page.close()
    }
  })

  for (const [syntax, source] of [
    ['init directive', '%%{init: {"theme": "base"}}%%\nsequenceDiagram\n  Alice->>Bob: Configured'],
    ['flowchart metadata', 'flowchart LR\n  A@{ shape: rect, label: "Meta &amp; data" } --> B'],
    ['sequence metadata', 'sequenceDiagram\n  participant A@{ "type": "database", "alias": "Metadata" }\n  A->>B: Ready'],
    ['Kanban metadata boundaries', 'kanban\nTodo\n  t[Work]@{assigned: Alice, ticket: ID-42}\nDone'],
    ['invalid frontmatter', '---\ntitle: [unclosed\n---\nsequenceDiagram\n  A->>B: Refused'],
    ['invalid metadata', 'sequenceDiagram\n  participant A@{ "type": [unclosed }\n  A->>B: Refused'],
  ] as const) {
    test(`first-use ${syntax} retains synchronous output or error after loading YAML`, async () => {
      const page = await browser.newPage()
      const requests: string[] = []
      page.on('request', request => requests.push(new URL(request.url()).pathname.replace(/^\/dist\//, '')))
      try {
        await page.goto(`${base}/blank.html`)
        const actual = await page.evaluate(async ([entryUrl, source]) => {
          const api = await import(entryUrl)
          try {
            const result = await api.renderMermaidSVGWithReceiptAsync(source, { security: 'strict' })
            return { svg: result.svg, receipt: result.receipt }
          } catch (error) { return { error: String(error) } }
        }, [`${base}/dist/browser-lazy/index.js`, source] as const)
        let expected
        try {
          const result = renderMermaidSVGWithReceipt(source, { security: 'strict' })
          expected = { svg: result.svg, receipt: result.receipt }
        } catch (error) { expected = { error: String(error) } }
        expect(actual).toEqual(expected)
        for (const chunk of lazyYamlChunks()) expect(requests.filter(path => path === chunk)).toHaveLength(1)
      } finally { await page.close() }
    })
  }

  test('the emitted lazy artifact rejects hostile strict-mode theme CSS', async () => {
    const page = await browser.newPage()
    try {
      await page.goto(`${base}/blank.html`)
      const result = await page.evaluate(async entryUrl => {
        const api = await import(entryUrl)
        try {
          const svg = await api.renderMermaidSVGAsync('timeline\n  2026 : Ship', {
            security: 'strict',
            themeCSS: 'svg { background-image: url(https://attacker.invalid/pixel) }',
          })
          return { svg, error: null }
        } catch (error) {
          return { svg: null, error: String(error) }
        }
      }, `${base}/dist/browser-lazy/index.js`)
      expect(result.svg).toBeNull()
      expect(result.error).toMatch(/themeCSS|strict|security/i)
    } finally {
      await page.close()
    }
  })
})

// B4. The published /demo/ page, loaded as a browser loads it. The lazy-entry
// tests above prove the artifact works in isolation; this proves the real page
// wires it up and actually keeps the all-family compatibility file and ELK off
// the Timeline request path.
describe('demo page', () => {
  const PUBLIC = join(REPO, 'website', 'public')
  let server: ReturnType<typeof serveWithAvailablePort>['server']
  let base = ''
  let demoBrowser: Browser
  let demoPage: Page
  const pageErrors: string[] = []
  const demoRequests: string[] = []

  beforeAll(async () => {
    if (!existsSync(join(PUBLIC, 'demo', 'index.html'))) {
      throw new Error('website/public/demo/index.html missing — run `bun run website` first')
    }
    const served = serveWithAvailablePort({
      preferredPort: 4671,
      async fetch(request) {
        const url = new URL(request.url)
        const rel = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname
        const file = Bun.file(join(PUBLIC, rel))
        return (await file.exists()) ? new Response(file) : new Response('not found', { status: 404 })
      },
    })
    server = served.server
    base = served.base
    demoBrowser = await chromium.launch()
    demoPage = await demoBrowser.newPage()
    demoPage.on('pageerror', error => pageErrors.push(String(error)))
    demoPage.on('request', request => demoRequests.push(new URL(request.url()).pathname))
    await demoPage.goto(`${base}/demo/`, { waitUntil: 'networkidle' })
  })

  afterAll(async () => {
    server?.stop(true)
    await demoBrowser?.close()
  })

  test('renders the diagram from the lazy ESM graph on first paint', async () => {
    const state = await demoPage.evaluate(() => ({
      status: document.getElementById('demo-status')?.textContent ?? '',
      svg: Boolean(document.querySelector('#demo-diagram svg')),
      content: document.getElementById('demo-diagram')?.innerHTML.includes('LinkedIn') ?? false,
    }))
    expect(state).toEqual({ status: 'rendered in-browser', svg: true, content: true })
    expect(pageErrors).toEqual([])
  })

  test('fetches Timeline but neither ELK nor the classic all-family bundle', () => {
    expect(demoRequests).toContainEqual(expect.stringMatching(/^\/demo\/browser-lazy\/index-[a-f0-9]{12}\.js$/))
    expect(demoRequests).toContainEqual(expect.stringMatching(/^\/demo\/browser-lazy\/chunks\/timeline-[A-Z0-9]{8}\.js$/))
    expect(demoRequests).not.toContain(`/demo/${lazyElkChunk()}`)
    expect(demoRequests).not.toContainEqual(expect.stringMatching(/^\/demo\/browser-[a-f0-9]{12}\.js$/))

    const families = new Set(BUILTIN_FAMILY_METADATA.map(family => family.id))
    const requestedFamilyChunks = demoRequests.filter(path => {
      const match = /^\/demo\/browser-lazy\/chunks\/([a-z0-9]+)-[A-Z0-9]{8}\.js$/.exec(path)
      return match && families.has(match[1] as typeof BUILTIN_FAMILY_METADATA[number]['id'])
    })
    expect(requestedFamilyChunks).toEqual([expect.stringMatching(/\/timeline-[A-Z0-9]{8}\.js$/)])
  })

  test('the initializer renders page source strictly and inserts only one parsed SVG document', async () => {
    const withDemo = async (options: { source?: string; renderer?: string }) => {
      const page = await demoBrowser.newPage()
      const requests: string[] = []
      page.on('request', request => requests.push(request.url()))
      if (options.source !== undefined) {
        await page.route(`${base}/demo/`, async route => {
          const response = await route.fetch()
          const escaped = options.source!.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          const body = (await response.text()).replace(/(<code id="demo-source">)[\s\S]*?(<\/code>)/, `$1${escaped}$2`)
          await route.fulfill({ response, body })
        })
      }
      if (options.renderer !== undefined) {
        await page.route(/\/demo\/browser-lazy\/index-[a-f0-9]{12}\.js$/, route => route.fulfill({
          contentType: 'text/javascript',
          body: `export async function renderMermaidSVGAsync() { return ${JSON.stringify(options.renderer)} }`,
        }))
      }
      try {
        await page.goto(`${base}/demo/`, { waitUntil: 'networkidle' })
        await page.waitForFunction(() => /^render(?:ed in-browser| failed)/.test(document.getElementById('demo-status')?.textContent ?? ''))
        return await page.evaluate(requested => {
          const target = document.getElementById('demo-diagram')!
          return {
            status: document.getElementById('demo-status')!.textContent ?? '',
            children: Array.from(target.children).map(child => child.localName),
            // Non-strict output carries author links as <a href> or host-activated data-href nodes.
            links: Array.from(target.querySelectorAll('a, [data-href], [role="link"]')).map(link => link.getAttribute('href') ?? link.getAttribute('data-href') ?? link.localName),
            injected: (window as any).__demoInjected ?? null,
            smuggledImages: document.querySelectorAll('#demo-diagram img').length,
            attackerRequests: requested.filter(url => url.includes('attacker.invalid')).length,
          }
        }, requests)
      } finally {
        await page.close()
      }
    }

    // Strict mode drops author-supplied navigation targets from page source.
    const linked = await withDemo({ source: 'flowchart LR\n  A --> B\n  click A href "https://attacker.invalid/phish"' })
    expect(linked).toMatchObject({ status: 'rendered in-browser', children: ['svg'], links: [], attackerRequests: 0 })

    // Renderer output is parsed as one SVG document, never as HTML: trailing
    // markup is refused instead of being inserted (and its handler never runs).
    const smuggling = await withDemo({ renderer: '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg><img src="data:," onerror="window.__demoInjected = 1">' })
    expect(smuggling).toMatchObject({ injected: null, smuggledImages: 0 })
    expect(smuggling.status).toStartWith('render failed:')
    expect(smuggling.children).not.toContain('svg')
    const clean = await withDemo({ renderer: '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>' })
    expect(clean).toMatchObject({ status: 'rendered in-browser', children: ['svg'], injected: null })
  })

  test('re-renders when the style changes', async () => {
    const before = await demoPage.locator('#demo-diagram').innerHTML()
    await demoPage.selectOption('#demo-style', 'hand-drawn')
    await demoPage.waitForFunction(previous => document.getElementById('demo-status')?.textContent === 'rendered in-browser'
      && document.getElementById('demo-diagram')?.innerHTML !== previous, before)
    const state = await demoPage.evaluate(() => ({
      status: document.getElementById('demo-status')?.textContent ?? '',
      svg: Boolean(document.querySelector('#demo-diagram svg')),
      html: document.getElementById('demo-diagram')?.innerHTML ?? '',
    }))
    expect(state.status).toBe('rendered in-browser')
    expect(state.svg).toBe(true)
    expect(state.html).not.toBe(before)
    expect(pageErrors).toEqual([])
  })
})
