import { flowchartSubgraphs } from '../eval/shared/graph-fixtures.ts'
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
import { chromium, firefox, webkit, type Browser, type Page, type Route } from 'playwright'
import { BUILTIN_FAMILY_METADATA } from '../src/agent/families.ts'
import { registerStyle, resolveStyleStack, renderMermaidSVG, renderMermaidSVGWithReceipt, sharedRenderOptionsJsonSchema } from '../src/index.ts'
import { serveWithAvailablePort } from './test-port.ts'
import { compareScenes } from '../scripts/resolved-scene-oracle.ts'

const REPO = join(import.meta.dir, '..')
const BUNDLE = join(REPO, 'dist', 'browser.global.js')
const LAZY_ENTRY = join(REPO, 'dist', 'browser-lazy', 'index.js')
const LAZY_METAFILE = join(REPO, 'dist', 'metafile-esm.json')
const ZENUML_ENTRY = join(REPO, 'dist', 'zenuml.js')
const ZENUML_FRAME = join(REPO, 'dist', 'zenuml-frame.global.js')
const BUILD_TIMEOUT_MS = 300_000
/** The IIFE's `globalName`. Changing it is a breaking change for script-tag consumers. */
const GLOBAL = 'agenticMermaid'

// Exercise the vocabulary whose documentation prose is omitted only from the
// lazy build. Authored labels/accessibility and executable shape metadata must
// still cross both emitted browser boundaries without changing the receipt.
const SHAPE_METADATA_PARITY_CASES = [
  { name: 'aliases', source: 'flowchart LR\nA@{ shape: card, label: "Card" }\nB@{ shape: database, label: "Database" }\nA --> B' },
  { name: 'semantic geometry', source: 'flowchart LR\nA@{ shape: cloud, label: "Cloud" }\nB@{ shape: hourglass, label: "Hourglass" }\nC@{ shape: document, label: "Document" }\nA --> B --> C' },
  { name: 'unknown shape', source: 'flowchart LR\nA@{ shape: zigzag, label: "Unknown shape" }\nA --> B' },
  { name: 'authored descriptions', source: 'flowchart LR\naccTitle: Authored shape metadata\naccDescr: Authored description: Process\nA@{ shape: rect, label: "description: \'Process\'" }\nA --> B' },
] as const

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
  visit(join(REPO, 'scripts/build'))
  for (const file of ['package.json', 'bun.lock', 'tsup.config.ts', 'tsup.browser.config.ts', 'tsup.browser-lazy.config.ts', 'tsup.zenuml.config.ts']) visit(join(REPO, file))
  return newest
}

function ensureBrowserBundle(target: 'complete' | 'zenuml' = 'complete') {
  const outputs = target === 'zenuml' ? [ZENUML_ENTRY, ZENUML_FRAME] : [BUNDLE, LAZY_ENTRY, LAZY_METAFILE, ZENUML_ENTRY, ZENUML_FRAME]
  // Reuse a local dist only when it is newer than every input: a stale bundle
  // could otherwise fake parity with (or mask a break in) the current source.
  if (outputs.every(existsSync) && Math.min(...outputs.map(path => statSync(path).mtimeMs)) >= newestBuildInputMtime()) return
  const command = target === 'zenuml' ? 'build:zenuml' : 'build'
  const build = spawnSync('bun', ['run', command], { cwd: REPO, encoding: 'utf8', timeout: BUILD_TIMEOUT_MS })
  if (build.status !== 0 || !outputs.every(existsSync)) {
    throw new Error(`\`bun run ${command}\` did not produce ${outputs[0]} (status ${build.status}).\n${build.stderr ?? ''}`)
  }
}

function lazyImplementationChunk(input = 'node_modules/elkjs/'): string {
  const metafile = JSON.parse(readFileSync(LAZY_METAFILE, 'utf8')) as {
    outputs: Record<string, { inputs: Record<string, unknown> }>
  }
  const matches = Object.entries(metafile.outputs).filter(([, output]) =>
    Object.keys(output.inputs).some(path => path.includes(input)))
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

  test('preserves the complete public render-option schema in the IIFE', async () => {
    const schema = await page.evaluate(name => (globalThis as Record<string, any>)[name].sharedRenderOptionsJsonSchema(), GLOBAL)
    expect(schema).toEqual(sharedRenderOptionsJsonSchema())
  })

  test.each([
    { name: 'closed path reversed', d: 'M10 10h95v47h-95Z', other: 'M105 57V10H10V57Z', dash: [7, 5], equal: false },
    { name: 'closed path rotated', d: 'M10 10h95v47h-95Z', other: 'M105 57H10V10H105Z', dash: [7, 5], equal: false },
    { name: 'open path reversed', d: 'M10 10H105', other: 'M105 10H10', dash: [7, 5], equal: false },
    { name: 'commands rewritten', d: 'M10 10h95v47h-95Z', other: 'M10 10L105 10L105 57L10 57Z', dash: [7, 5], equal: true },
    { name: 'symmetric dashes reversed', d: 'M10 10H29', other: 'M29 10H10', dash: [7, 5], equal: true },
    { name: 'subpaths reordered', d: 'M10 10h19M10 30h17', other: 'M10 30h17M10 10h19', dash: [7, 5], equal: true },
    { name: 'subpath dashes reversed', d: 'M10 10h19M10 30h17', other: 'M29 10H10M27 30H10', dash: [7, 5], equal: false },
    { name: 'offset dashes reversed', d: 'M10 10H105', other: 'M105 10H10', dash: [7, 5], offset: 3, equal: false },
    { name: 'round caps reversed', d: 'M10 10H105', other: 'M105 10H10', dash: [7, 5], cap: 'round', equal: false },
    { name: 'nonuniform transform', d: 'M10 10h95v47h-95Z', other: 'M105 57V10H10V57Z', dash: [7, 5], sx: 2, sy: 0.5, equal: false },
    { name: 'solid path reversed', d: 'M10 10h95v47h-95Z', other: 'M105 57V10H10V57Z', dash: [], equal: true },
    { name: 'zero dash array', d: 'M10 10h95v47h-95Z', other: 'M105 57V10H10V57Z', dash: [0, 0], equal: true },
  ])('resolved-scene comparer checks painted dashes: $name', async ({ d, other, dash, equal, offset = 0, cap = 'butt', sx = 1, sy = 1 }) => {
    const reference: Parameters<typeof compareScenes>[1] = {
      version: 2, family: 'flowchart', width: 240, height: 140, svg: '', colors: {}, parts: [],
      frame: [{
        kind: 'path', d, matrix: [sx, 0, 0, sy, 4, 3],
        paint: {
          fill: 'none', fillOpacity: 1, stroke: '#000000', strokeOpacity: 1, strokeWidth: 2,
          opacity: 1, lineCap: cap, lineJoin: 'miter', miterLimit: 4, fillRule: 'nonzero',
          paintOrder: 'normal', dashArray: [...dash], dashOffset: offset,
        },
      }],
    }
    const candidate = structuredClone(reference)
    if (candidate.frame[0]!.kind === 'path') candidate.frame[0]!.d = other
    const differences = await compareScenes(page, candidate, reference)
    if (equal) expect(differences, `${d} vs ${other}`).toEqual([])
    else expect(differences, `${d} vs ${other}`).not.toEqual([])
  })

  test.each(['elk', 'agentic'] as const)('IIFE preserves shape metadata SVG, receipt and diagnostics (%s)', async backend => {
    for (const input of SHAPE_METADATA_PARITY_CASES) {
      const options = {
        security: 'strict' as const,
        graphLayout: { backend },
        mermaidConfig: { flowchart: { defaultRenderer: 'dagre' } },
      }
      const actual = await page.evaluate(({ name, source, options }) => {
        const diagnostics: unknown[] = []
        const rendered = (globalThis as Record<string, any>)[name].renderMermaidSVGWithReceipt(source, {
          ...options, onConfigDiagnostic: (value: unknown) => diagnostics.push(value),
        })
        return { svg: rendered.svg, receipt: JSON.parse(JSON.stringify(rendered.receipt)), diagnostics }
      }, { name: GLOBAL, source: input.source, options })
      const diagnostics: unknown[] = []
      const expected = renderMermaidSVGWithReceipt(input.source, {
        ...options, onConfigDiagnostic: value => diagnostics.push(value),
      })
      expect(diagnostics.length, `${input.name} must exercise config diagnostics`).toBeGreaterThan(0)
      expect(actual, input.name).toEqual({ svg: expected.svg, receipt: JSON.parse(JSON.stringify(expected.receipt)), diagnostics })
    }
  }, BUILD_TIMEOUT_MS)


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
    ensureBrowserBundle('zenuml')
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

  test('shipped native ESM renders full Looks and roles with no frame or backend URL', async () => {
    const page = await browser.newPage()
    const requests: string[] = [], failures: string[] = []
    page.on('request', request => requests.push(new URL(request.url()).pathname))
    page.on('pageerror', error => failures.push(error.message))
    await page.goto(base)
    const source = readFileSync(join(REPO, 'eval/layout-compare/fixtures/zenuml-native-checkout.mmd'), 'utf8')
    const styles = [
      ['patent-drawing', 'github-light'],
      ['hand-drawn', 'dracula'],
      ['watercolor', 'solarized-light'],
    ].map(stack => [...stack, { roles: { node: { fillColor: '#123456', fontSize: 22, paddingX: 18 }, edge: { strokeColor: '#ff0000' } } }])
    const expected = styles.map(style => renderMermaidSVG(source, { style, embedFontImport: false }))
    const result = await page.evaluate(async ({ source, styles }) => {
      const entry = '/dist/zenuml.js', api = await import(entry)
      const renderer = api.createZenUMLRenderer({ embedFontImport: false })
      const svgs: string[] = []
      try {
        for (const style of styles) {
          const svg = await renderer.render(source, { style })
          document.getElementById('output')!.innerHTML = svg
          if (!document.querySelector('[data-id="Buyer"]')) throw Error('Native participant ownership is missing')
          if (!document.getElementById('output')!.textContent?.includes('accepted')) throw Error('Conditional return text is missing')
          svgs.push(svg)
        }
        let invalid = false
        try { await renderer.render('zenuml\nif (') } catch { invalid = true }
        const recovered = await renderer.render('zenuml\nA->B: recovered')
        return { svgs, invalid, recovered: recovered.includes('recovered'), frames: document.querySelectorAll('iframe').length, native: api.ZENUML_CAPABILITIES.nativeScene }
      } finally { renderer.dispose() }
    }, { source, styles })
    expect(result.svgs).toEqual(expected)
    expect(result.invalid && result.recovered && result.native).toBe(true)
    expect(result.frames).toBe(0)
    expect(failures).toEqual([])
    expect(requests).not.toContain('/dist/zenuml-frame.global.js')
    expect(requests.some(path => /appearance-|elk-bundled/.test(path))).toBe(false)
    await page.close()
  }, 30_000)

  test('shipped native ESM deadlines release queued work while family modules are loading', async () => {
    const page = await browser.newPage()
    await page.goto(base)
    await page.evaluate(async () => {
      const entry = '/dist/zenuml.js', api = await import(entry)
      ;(globalThis as any).__zen = { renderer: api.createZenUMLRenderer() }
    })
    const held: Route[] = []
    let waiting = true
    await page.route('**/*.js', route => { if (waiting) held.push(route); else void route.continue() })
    const importing = page.waitForRequest(request => request.url().endsWith('.js'))
    await page.evaluate(() => {
      const state = (globalThis as any).__zen
      state.first = state.renderer.render('zenuml\nA->B: expired', { timeoutMs: 20 }).then(() => 'unexpected-success', (error: Error) => error.message)
      state.next = state.renderer.render('zenuml\nC->D: recovered', { timeoutMs: 5000 })
    })
    await importing
    expect(await page.evaluate(() => (globalThis as any).__zen.first)).toContain('deadline')
    waiting = false
    await Promise.all(held.map(route => route.continue()))
    expect(await page.evaluate(async () => {
      const state = (globalThis as any).__zen
      try { return (await state.next).includes('recovered') }
      finally { state.renderer.dispose() }
    })).toBe(true)
    expect(await page.locator('iframe').count()).toBe(0)
    await page.close()
  }, 30_000)

  test('shipped explicit upstream ESM loads palettes and its isolated session without a bundler or import map', async () => {
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
      const renderer = api.createUpstreamZenUMLRenderer({ backendURL: '/dist/zenuml-frame.global.js' })
      const backgrounds: string[] = []
      const source = 'zenuml\nAlice->Bob: hello'
      try {
        await api.renderUpstreamZenUMLSVG(source, { backendURL: '/dist/zenuml-frame.global.js' })
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

  test.each([undefined, 'hand-drawn', 'watercolor'] as const)('renders every family with exact strict-mode parity (%s)', async style => {
    const page = await browser.newPage()
    try {
      await page.goto(`${base}/blank.html`)
      for (const family of BUILTIN_FAMILY_METADATA) {
        const result = await page.evaluate(async ([entryUrl, source, style]) => {
          try {
            const api = await import(entryUrl)
            const result = await api.renderMermaidSVGWithReceiptAsync(source, { security: 'strict', ...(style ? { style } : {}) })
            return { svg: result.svg, receipt: result.receipt, error: null }
          } catch (error) {
            return { svg: null, receipt: null, error: String(error) }
          }
        }, [`${base}/dist/browser-lazy/index.js`, family.example, style] as const)
        expect(result.error, `${family.id} threw in the async browser entry`).toBeNull()
        const expected = renderMermaidSVGWithReceipt(family.example, { security: 'strict', ...(style ? { style } : {}) })
        expect(result.svg).toBe(expected.svg)
        expect(result.receipt).toEqual(expected.receipt)
      }
    } finally {
      await page.close()
    }
  }, BUILD_TIMEOUT_MS)

  test('checked options retain source diagnostics in the lazy artifact', async () => {
    const page = await browser.newPage()
    const cases = [
      { nodeSpacing: -1 },
      { graphLayout: { backend: 'elk', fallback: 'elk' } },
      { graphLayout: { backend: 'agentic', extra: true } },
      { graphLayout: { backend: 'wrong' } },
      { bg: 'url(https://example.invalid/image)' },
      { architecture: { visual: { junctionInnerRadius: 10, junctionOuterRadius: 5 } } },
    ]
    try {
      await page.goto(`${base}/blank.html`)
      const authored = { style: { blurb: 'Authored runtime style metadata', colors: { accent: '#0055AA' } } }
      const expected = renderMermaidSVGWithReceipt('flowchart TD\nA --> B', authored)
      const rendered = await page.evaluate(async ({ entryUrl, options }) => {
        const api = await import(entryUrl)
        return api.renderMermaidSVGWithReceiptAsync('flowchart TD\nA --> B', options)
      }, { entryUrl: `${base}/dist/browser-lazy/index.js`, options: authored })
      expect(rendered).toEqual(JSON.parse(JSON.stringify(expected)))
      for (const options of cases) {
        let expected: string | undefined
        try { renderMermaidSVG('flowchart TD\nA --> B', options as never) }
        catch (error) { expected = String(error) }
        expect(expected).toBeDefined()
        const actual = await page.evaluate(async ({ entryUrl, options }) => {
          const api = await import(entryUrl)
          try { await api.renderMermaidSVGAsync('flowchart TD\nA --> B', options); return undefined }
          catch (error) { return String(error) }
        }, { entryUrl: `${base}/dist/browser-lazy/index.js`, options })
        expect(actual).toBe(expected)
      }
    } finally { await page.close() }
  }, BUILD_TIMEOUT_MS)

  test.each(['elk', 'agentic'] as const)('lazy prose stripping preserves shape metadata SVG, receipt and diagnostics (%s)', async backend => {
    const page = await browser.newPage()
    try {
      await page.goto(`${base}/blank.html`)
      for (const input of SHAPE_METADATA_PARITY_CASES) {
        const options = {
          security: 'strict' as const,
          graphLayout: { backend },
          mermaidConfig: { flowchart: { defaultRenderer: 'dagre' } },
        }
        const actual = await page.evaluate(async ({ entryUrl, source, options }) => {
          const api = await import(entryUrl)
          const diagnostics: unknown[] = []
          const rendered = await api.renderMermaidSVGWithReceiptAsync(source, {
            ...options, onConfigDiagnostic: (value: unknown) => diagnostics.push(value),
          })
          return { svg: rendered.svg, receipt: JSON.parse(JSON.stringify(rendered.receipt)), diagnostics }
        }, { entryUrl: `${base}/dist/browser-lazy/index.js`, source: input.source, options })
        const diagnostics: unknown[] = []
        const expected = renderMermaidSVGWithReceipt(input.source, {
          ...options, onConfigDiagnostic: value => diagnostics.push(value),
        })
        expect(diagnostics.length, `${input.name} must exercise config diagnostics`).toBeGreaterThan(0)
        expect(actual, input.name).toEqual({ svg: expected.svg, receipt: JSON.parse(JSON.stringify(expected.receipt)), diagnostics })
        if (input.name === 'authored descriptions') {
          const text = await page.evaluate(svg => {
            const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
            return { description: document.querySelector('desc')?.textContent, text: document.documentElement.textContent }
          }, actual.svg)
          expect(text.description).toBe('Authored description: Process')
          expect(text.text).toContain("description: 'Process'")
        }
      }
    } finally { await page.close() }
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
      expect(requests).not.toContain(lazyImplementationChunk())
    } finally {
      await page.close()
    }
  })

  test.each(['elk', 'agentic'] as const)('%s-backed families fetch and reuse only the selected solver', async backend => {
    const page = await browser.newPage()
    const requests: string[] = []
    page.on('request', request => requests.push(new URL(request.url()).pathname.replace(/^\/dist\//, '')))
    try {
      await page.goto(`${base}/blank.html`)
      const sources = [
        'flowchart LR\n  A --> B',
        'flowchart TB\nsubgraph One\n A --> B\nend\nsubgraph Two\n C --> D\nend\nB -->|handoff| C',
        'stateDiagram-v2\nstate One {\nA --> B\n}\nstate Two {\nC --> D\n}\nB --> C : handoff',
        'classDiagram\nnamespace One {\nclass A\n}\nnamespace Two {\nclass B\n}\nA --> B : handoff',
        'architecture-beta\nservice a(server)[A]\nservice b(server)[B]\na:R --> L:b',
        'classDiagram\nclass Account {\n+String name\n}\nAccount --> Audit : records',
        'classDiagram\nnamespace Platform {\nclass A\nclass B\nA --> B : delegates\nnamespace Domain {\nclass User\n}\n}',
        'erDiagram\nCUSTOMER ||--o{ ORDER : places',
        'erDiagram\nsubgraph Accounts\n CUSTOMER ||--o{ ORDER : places\nend\nsubgraph Audit\n AUDIT\nend\nAccounts ||--|| Audit : reports\nORDER ||..o{ AUDIT : logs',
        'stateDiagram-v2\n  [*] --> Ready',
        'requirementDiagram\nrequirement fast {\ntext: Respond quickly\n}\nelement suite {\ntype: "test"\n}\nsuite - verifies -> fast',
      ]
      const svgs = await page.evaluate(async ({ entryUrl, backend, sources }) => {
        const api = await import(entryUrl)
        return Promise.all(sources.map(source => api.renderMermaidSVGAsync(source, { graphLayout: { backend } })))
      }, { entryUrl: `${base}/dist/browser-lazy/index.js`, backend, sources })
      expect(svgs).toEqual(sources.map(source => renderMermaidSVG(source, { graphLayout: { backend } })))
      expect(requests.filter(path => path === lazyImplementationChunk())).toHaveLength(backend === 'elk' ? 1 : 0)
      expect(requests.filter(path => path === lazyImplementationChunk('/layout/agentic-layered-core.ts'))).toHaveLength(backend === 'agentic' ? 1 : 0)
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
      expect(requests).not.toContain(lazyImplementationChunk())
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
      expect(requests.filter(path => path === lazyImplementationChunk())).toHaveLength(1)
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
  test.each(['native', 'cross-scope', 'large-cross-scope', 'frame-endpoint', 'compound', 'local-limit', 'refined-cycle'])('native graph placement fetches ELK only for an actual fallback (%s)', async mode => {
    const fallback = mode === 'local-limit'
    const page = await browser.newPage()
    const requests: string[] = []
    page.on('request', request => requests.push(new URL(request.url()).pathname.replace(/^\/dist\//, '')))
    const source = mode === 'refined-cycle' ? readFileSync(join(REPO, 'eval/layout-compare/fixtures/cyclic-labelled-15.mmd'), 'utf8')
      : mode === 'large-cross-scope' ? flowchartSubgraphs(12, 8)
      : mode === 'frame-endpoint' ? 'flowchart TD\nsubgraph Outer\n subgraph Inner\n  A["x#hearts;y"] --> B\n end\nend\nOutside --> Inner'
      // Ancestor-frame contacts stay native without materializing private ranks.
      : mode === 'compound' ? `---\ntitle: Deferred providers\n---\nflowchart LR\nsubgraph Outer\n A["x#hearts;y"]\nend\nOuter ${'-'.repeat(2049)}> A`
      : `flowchart TD\n${mode === 'cross-scope' ? 'Outside --> A\nsubgraph G[Group]\n' : ''}A["x#hearts;y"] ${mode === 'local-limit' ? '-'.repeat(2050) + '>' : '-->'} B${mode === 'cross-scope' ? '\nend' : ''}`
    const options = {
      graphLayout: { backend: 'agentic' as const, ...(fallback ? { fallback: 'elk' as const } : {}) },
      security: 'strict' as const, mermaidConfig: { flowchart: { nodeSpacing: -1 } },
    }
    try {
      await page.goto(`${base}/blank.html`)
      const result = await page.evaluate(async ({ entry, source, options }) => {
        const api = await import(entry)
        const diagnostics: unknown[] = []
        const rendered = await api.renderMermaidSVGWithReceiptAsync(source, {
          ...options, onConfigDiagnostic: (value: unknown) => diagnostics.push(value),
        })
        return { svg: rendered.svg, receipt: JSON.parse(JSON.stringify(rendered.receipt)), diagnostics }
      }, { entry: `${base}/dist/browser-lazy/index.js`, source, options })
      const diagnostics: unknown[] = []
      const expected = renderMermaidSVGWithReceipt(source, { ...options, onConfigDiagnostic: value => diagnostics.push(value) })
      expect(result).toEqual({ svg: expected.svg, receipt: JSON.parse(JSON.stringify(expected.receipt)), diagnostics })
      expect(requests.filter(path => path === lazyImplementationChunk())).toHaveLength(fallback ? 1 : 0)
      expect(requests.filter(path => path === lazyImplementationChunk('/layout/agentic-layered-core.ts'))).toHaveLength(1)
      if (mode === 'compound') for (const chunk of lazyYamlChunks()) expect(requests.filter(path => path === chunk)).toHaveLength(1)
      expect(result.receipt.layoutDecisions[0].selected).toBe(fallback ? 'elk' : 'agentic')
    } finally { await page.close() }
  })

  test('a failed native chunk rejects without ELK fallback and a fresh document can recover', async () => {
    const page = await browser.newPage()
    const requests: string[] = []
    const implementation = lazyImplementationChunk('/layout/agentic-layered-core.ts')
    const source = 'flowchart TD\n A[Source] --> B[Target]'
    const options = { graphLayout: { backend: 'agentic' as const, fallback: 'elk' as const }, security: 'strict' as const }
    let attempts = 0
    page.on('request', request => requests.push(new URL(request.url()).pathname.replace(/^\/dist\//, '')))
    await page.route(`**/dist/${implementation}`, route => ++attempts === 1 ? route.abort('failed') : route.continue())
    try {
      await page.goto(`${base}/blank.html`)
      const failure = await page.evaluate(async ({ entry, source, options }) => {
        const api = await import(entry)
        try { await api.renderMermaidSVGWithReceiptAsync(source, options); return null }
        catch (error) { return { name: error instanceof Error ? error.name : '', message: String(error) } }
      }, { entry: `${base}/dist/browser-lazy/index.js`, source, options })
      expect(failure).not.toBeNull()
      expect(failure!.name).toBe('TypeError')
      expect(attempts).toBe(1)
      expect(requests).not.toContain(lazyImplementationChunk())
      await page.reload()
      const recovered = await page.evaluate(async ({ entry, source, options }) => {
        const api = await import(entry)
        const result = await api.renderMermaidSVGWithReceiptAsync(source, options)
        return { svg: result.svg, receipt: result.receipt }
      }, { entry: `${base}/dist/browser-lazy/index.js`, source, options })
      const expected = renderMermaidSVGWithReceipt(source, options)
      expect(recovered).toEqual({ svg: expected.svg, receipt: expected.receipt })
      expect(attempts).toBe(2)
      expect(requests).not.toContain(lazyImplementationChunk())
    } finally { await page.close() }
  })


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
    expect(demoRequests).not.toContain(`/demo/${lazyImplementationChunk()}`)
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
