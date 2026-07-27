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
 * added to the registry later is covered here without editing this file. The
 * count guard below is what makes that real: it fails if the registry is ever
 * read as empty, which would otherwise turn the whole suite into a silent no-op.
 *
 * Requires: Playwright browsers installed
 * (`bunx playwright install chromium firefox webkit`).
 * Run:  bun run test:browser
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright'
import { BUILTIN_FAMILY_METADATA } from '../src/agent/families.ts'
import { renderMermaidSVG } from '../src/index.ts'
import { serveWithAvailablePort } from './test-port.ts'

const REPO = join(import.meta.dir, '..')
const BUNDLE = join(REPO, 'dist', 'browser.global.js')
const LAZY_ENTRY = join(REPO, 'dist', 'browser-lazy', 'index.js')
const LAZY_METAFILE = join(REPO, 'dist', 'metafile-esm.json')
const BUILD_TIMEOUT_MS = 300_000
/** The IIFE's `globalName`. Changing it is a breaking change for script-tag consumers. */
const GLOBAL = 'agenticMermaid'
/** Every family carries a canonical `example`; a registry smaller than this means something is wrong. */
const MIN_EXPECTED_FAMILIES = 10

function ensureBrowserBundle() {
  if (existsSync(BUNDLE) && existsSync(LAZY_ENTRY) && existsSync(LAZY_METAFILE)) return
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
    const surface = await page.evaluate(name => {
      const api = (globalThis as Record<string, any>)[name]
      return {
        present: Boolean(api),
        renderMermaidSVG: typeof api?.renderMermaidSVG,
        renderMermaidASCII: typeof api?.renderMermaidASCII,
        exportCount: api ? Object.keys(api).length : 0,
      }
    }, GLOBAL)
    expect(surface.present).toBe(true)
    expect(surface.renderMermaidSVG).toBe('function')
    expect(surface.renderMermaidASCII).toBe('function')
    expect(surface.exportCount).toBeGreaterThan(50)
  })

  // B2. Registry-driven, so future families enroll without touching this file.
  test('registry is non-empty, so the per-family checks below are not vacuous', () => {
    expect(BUILTIN_FAMILY_METADATA.length).toBeGreaterThanOrEqual(MIN_EXPECTED_FAMILIES)
    for (const family of BUILTIN_FAMILY_METADATA) {
      expect(family.example?.trim().length ?? 0, `${family.id} must declare a canonical example`).toBeGreaterThan(0)
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
            return { svg: await api.renderMermaidSVGAsync(source, { security: 'strict' }), error: null }
          } catch (error) {
            return { svg: null, error: String(error) }
          }
        }, [`${base}/dist/browser-lazy/index.js`, family.example] as const)
        expect(result.error, `${family.id} threw in the async browser entry`).toBeNull()
        expect(result.svg).toBe(renderMermaidSVG(family.example, { security: 'strict' }))
      }
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
      await page.evaluate(async entryUrl => {
        const api = await import(entryUrl)
        await api.renderMermaidSVGAsync('timeline\n  title Small\n  2026 : Ship')
      }, `${base}/dist/browser-lazy/index.js`)
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
      await page.evaluate(async entryUrl => {
        const api = await import(entryUrl)
        await api.renderMermaidSVGAsync('flowchart LR\n  A --> B')
        await api.renderMermaidSVGAsync('stateDiagram-v2\n  [*] --> Ready')
      }, `${base}/dist/browser-lazy/index.js`)
      expect(requests.filter(path => path === lazyElkChunk())).toHaveLength(1)
    } finally {
      await page.close()
    }
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
    expect(demoRequests).not.toContain(`/demo/${lazyElkChunk()}`)
    expect(demoRequests).not.toContainEqual(expect.stringMatching(/^\/demo\/browser-[a-f0-9]{12}\.js$/))

    const requestedFamilyChunks = demoRequests.filter(path =>
      /^\/demo\/browser-lazy\/chunks\/(?:architecture|class|er|flowchart|gantt|gitgraph|journey|mindmap|pie|quadrant|radar|sequence|state|timeline|xychart)-/.test(path))
    expect(requestedFamilyChunks).toEqual([expect.stringMatching(/\/timeline-[A-Z0-9]{8}\.js$/)])
  })

  test('keeps strict rendering and parsed-node insertion in the generated initializer', () => {
    const html = readFileSync(join(PUBLIC, 'demo', 'index.html'), 'utf8')
    const initializer = Array.from(html.matchAll(/<script type="module" src="\/(generated\/inline-[a-f0-9]{12}\.js)"><\/script>/g), match => readFileSync(join(PUBLIC, match[1]!), 'utf8')).find(source => source.includes("var SOURCE = document.getElementById('demo-source').textContent"))
    expect(initializer, 'demo initializer emitted as a generated external script').toBeDefined()
    expect(initializer).toMatch(/import \{ renderMermaidSVGAsync \} from '\/demo\/browser-lazy\/index-[a-f0-9]{12}\.js'/)
    expect(initializer).toContain('await renderMermaidSVGAsync')
    expect(initializer).toContain("security: 'strict'")
    expect(initializer).toContain("new DOMParser().parseFromString(svg, 'image/svg+xml')")
    expect(initializer).toContain('target.replaceChildren(document.importNode(parsed.documentElement, true))')
    expect(initializer).not.toMatch(/\.innerHTML\s*=/)
  })

  test('re-renders when the style changes', async () => {
    const before = await demoPage.locator('#demo-diagram').innerHTML()
    await demoPage.selectOption('#demo-style', 'hand-drawn')
    await demoPage.waitForFunction(() => document.getElementById('demo-status')?.textContent === 'rendered in-browser')
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
