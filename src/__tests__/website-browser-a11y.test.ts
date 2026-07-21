import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { chromium, type Browser, type Page } from 'playwright'
import { serveWithAvailablePort } from '../../e2e/test-port.ts'
import { decodeEditorStateHash } from '../../scripts/site/editor-state-url.ts'
import { EDITOR_EXAMPLES } from '../../editor/examples.ts'
import { renderWebsiteSVGWithReceipt } from '../../website/src/rendering.ts'
import { HOSTED_FONT_RESOURCES } from '../font-manifest.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { resolveEditorRenderOptions } from '../editor-render-options.ts'
import { SHARED_RENDER_OPTION_FIELDS, validateSerializableRenderOptions } from '../render-contract.ts'
import { knownStyleDescriptors } from '../scene/style-registry.ts'
import interSubsetManifestJson from '../../website/source/assets/fonts/inter/manifest.json'
import { WEBSITE_INTER_GLYPH_PROBES, type WebsiteInterSubsetManifest } from '../../scripts/site/website-font-subsets.ts'
import type { RenderOptions } from '../types.ts'

const REPO = join(import.meta.dir, '..', '..')
const SITE = join(REPO, 'website', 'public')
const INTER_SUBSET_MANIFEST = interSubsetManifestJson as unknown as WebsiteInterSubsetManifest

let server: ReturnType<typeof Bun.serve>
let browser: Browser
let baseUrl = ''

// This smoke suite needs a real Chromium and runs only in the explicit browser
// lane. Keeping it out of the coverage unit lane prevents browser/server work
// from becoming an opportunistic side effect of a locally installed Chromium.
// executablePath() resolves to the bundled Chromium; its presence is the proxy
// for "Playwright browsers are installed", since the headless shell that
// launch({headless:true}) actually starts is installed alongside it.
const haveBrowser = (() => {
  try { return existsSync(chromium.executablePath()) } catch { return false }
})()
const browserRequested = process.env.AM_BROWSER_TESTS === '1'
if (browserRequested && !haveBrowser) {
  throw new Error('AM_BROWSER_TESTS=1 requires the Playwright Chromium executable; install it before running this lane')
}
const describeBrowser = browserRequested ? describe : describe.skip

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

function deflatedEditorHash(payload: unknown) {
  return 'deflate:' + deflateRawSync(Buffer.from(JSON.stringify(payload), 'utf8')).toString('base64url')
}

function decodedEditorState(href: string): Record<string, unknown> {
  return decodeEditorStateHash(href.split('#')[1] ?? '') as unknown as Record<string, unknown>
}

function editorRenderOptions(state: Record<string, unknown>): RenderOptions {
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
  })
}

function appearanceLabel(kind: 'look' | 'palette', input: unknown): string {
  if (kind === 'look' && input === 'crisp') return 'Crisp'
  if (kind === 'palette' && !input) return 'Default'
  return knownStyleDescriptors().find(descriptor => descriptor.kind === kind && descriptor.inputName === input)?.displayLabel ?? ''
}

function fileForPath(pathname: string) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '')
  const candidate = rel && !rel.endsWith('/') ? rel : `${rel}index.html`
  const abs = normalize(join(SITE, candidate))
  if (!abs.startsWith(SITE)) return null
  if (existsSync(abs)) return abs
  const index = normalize(join(SITE, rel, 'index.html'))
  if (index.startsWith(SITE) && existsSync(index)) return index
  return null
}

async function namedControls(page: Page) {
  return page.evaluate(() => {
    function labelText(el: Element) {
      const id = el.getAttribute('id')
      if (!id) return ''
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`)
      return label?.textContent?.trim() || ''
    }
    function isVisible(el: Element) {
      if (el.closest('[inert], [aria-hidden="true"]')) return false
      const style = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    return Array.from(document.querySelectorAll('a[href], button, input, textarea, select, summary')).flatMap((el) => {
      if (!isVisible(el)) return []
      const name = [
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        labelText(el),
        el.textContent,
        el.getAttribute('placeholder'),
        el.getAttribute('value'),
      ].map((v) => (v || '').trim()).find(Boolean) || ''
      return name ? [] : [(el.getAttribute('id') || el.tagName.toLowerCase())]
    })
  })
}

async function brokenAriaControls(page: Page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('[aria-controls]')).flatMap((el) => {
    const id = el.getAttribute('aria-controls') || ''
    return document.getElementById(id) ? [] : [`${el.id || el.tagName.toLowerCase()} -> ${id}`]
  }))
}

async function withFreshBrowser<T>(run: (page: Page) => Promise<T>): Promise<T> {
  const isolatedBrowser = await chromium.launch({ headless: true })
  const page = await isolatedBrowser.newPage({ viewport: { width: 1280, height: 900 } })
  try {
    return await run(page)
  } finally {
    await page.close().catch(() => {})
    await isolatedBrowser.close({ reason: 'isolated accessibility test cleanup' }).catch(() => {})
  }
}

describeBrowser('website browser accessibility smoke', () => {
  // Hooks live inside the guarded describe so a browser-less run (CI `test` job)
  // skips them too — a file-level beforeAll runs even when its only describe is
  // skipped, and launching there is exactly what fails when Chromium is absent.
  beforeAll(async () => {
    const served = serveWithAvailablePort({
      preferredPort: 4720,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === '/__font-probe') return new Response('<!doctype html><html><body></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })
        const abs = fileForPath(url.pathname)
        if (!abs) return new Response('Not found', { status: 404 })
        return new Response(Bun.file(abs), { headers: { 'content-type': mime[extname(abs)] || 'application/octet-stream' } })
      },
    })
    server = served.server
    baseUrl = served.base
    browser = await chromium.launch({ headless: true })
  }, 120_000)

  afterAll(async () => {
    server?.stop(true)
    if (!browser) return
    await Promise.race([
      browser.close({ reason: 'website browser smoke cleanup' }).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ])
  }, 10_000)

  test('public routes have named controls, valid ARIA references, and no mobile horizontal overflow', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } })
    for (const route of ['/', '/examples/#gantt', '/examples/style-palette/', '/examples/corpus/', '/comparisons/', '/about/', '/docs/getting-started/', '/docs/', '/skills/agentic-mermaid-diagram-workflow/']) {
      await page.goto(baseUrl + route, { waitUntil: 'networkidle' })
      expect({ route, unnamed: await namedControls(page) }).toEqual({ route, unnamed: [] })
      expect({ route, broken: await brokenAriaControls(page) }).toEqual({ route, broken: [] })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect({ route, overflow }).toEqual({ route, overflow: 0 })
      if (route === '/comparisons/') {
        // Panels render lazily as they approach the viewport (IntersectionObserver
        // + sequential drain), so walk the page bottom-ward to queue every
        // registered family, then wait for the drain to finish.
        await page.evaluate(async () => {
          const step = window.innerHeight
          for (let y = 0; y <= document.documentElement.scrollHeight; y += step) {
            window.scrollTo(0, y)
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
        })
        await page.waitForFunction(
          expected => document.querySelectorAll('.comparison-mermaid[data-processed="true"]').length === expected,
          BUILTIN_FAMILY_METADATA.length + 1, // one per family + the style demo
          { timeout: 20_000 },
        )
        expect(await page.locator('.comparison-mermaid[data-processed="true"]').count()).toBe(BUILTIN_FAMILY_METADATA.length + 1)
        expect(await page.locator('.comparison-panel').count()).toBe(BUILTIN_FAMILY_METADATA.length * 2 + 6)
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.locator('[data-comparison-lightbox-panel]').first().click()
        expect(await page.locator('.comparison-dialog[open]').count()).toBe(1)
        expect(await page.locator('.comparison-dialog .comparison-panel').count()).toBeGreaterThanOrEqual(2)
        await page.locator('.comparison-dialog-close').click()
        // Close removes native modality on the event frame; any fade-out tail
        // is noninteractive and cannot hold focus or the background inert.
        expect(await page.locator('.comparison-dialog[open]').count()).toBe(0)
        await page.locator('[data-comparison-open]').first().click()
        expect(await page.locator('.comparison-dialog[open]').count()).toBe(1)
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => document.querySelector('.comparison-dialog[open]') === null)
        expect(await page.evaluate(() => document.activeElement === document.querySelector('[data-comparison-open]'))).toBe(true)
      }
      expect(await page.locator('.theme-switch').count()).toBe(0)
    }
    await page.close()
  }, 30_000)

  test('mobile hamburger exposes every destination and preserves no-JS navigation', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } })
    await page.goto(baseUrl + '/', { waitUntil: 'networkidle' })
    const menu = page.locator('.nav-menu')
    const toggle = page.locator('.nav-toggle')
    const navigation = page.locator('#site-navigation')
    const desktopNavigation = page.locator('.desktop-links')
    expect(await toggle.isVisible()).toBe(true)
    expect(await menu.evaluate((element) => element.hasAttribute('open'))).toBe(false)
    expect(await navigation.isHidden()).toBe(true)

    await toggle.click()
    expect(await menu.evaluate((element) => element.hasAttribute('open'))).toBe(true)
    expect(await navigation.isVisible()).toBe(true)
    expect(await navigation.locator('a').allTextContents()).toEqual([
      'About', 'Examples', 'Comparisons', 'Docs', 'GitHub', 'Open editor',
    ])
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)

    await page.keyboard.press('Escape')
    expect(await menu.evaluate((element) => element.hasAttribute('open'))).toBe(false)
    expect(await navigation.isHidden()).toBe(true)
    expect(await page.evaluate(() => document.activeElement === document.querySelector('.nav-toggle'))).toBe(true)

    await toggle.click()
    await page.locator('main').click({ position: { x: 2, y: 2 } })
    expect(await menu.evaluate((element) => element.hasAttribute('open'))).toBe(false)
    expect(await navigation.isHidden()).toBe(true)

    await page.setViewportSize({ width: 900, height: 900 })
    expect(await toggle.isHidden()).toBe(true)
    expect(await navigation.isHidden()).toBe(true)
    expect(await desktopNavigation.isVisible()).toBe(true)
    await page.close()

    const noJs = await browser.newContext({ viewport: { width: 390, height: 900 }, javaScriptEnabled: false })
    const noJsPage = await noJs.newPage()
    await noJsPage.goto(baseUrl + '/', { waitUntil: 'networkidle' })
    expect(await noJsPage.locator('.nav-toggle').isVisible()).toBe(true)
    expect(await noJsPage.locator('#site-navigation').isHidden()).toBe(true)
    await noJsPage.locator('.nav-toggle').click()
    expect(await noJsPage.locator('#site-navigation').isVisible()).toBe(true)
    expect(await noJsPage.locator('#site-navigation a').count()).toBe(6)
    await noJs.close()
  }, 30_000)

  test('every distinct Examples state shape crosses the real Editor resolver with complete render parity', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.addInitScript(() => {
      let mermaidValue: any
      Object.defineProperty(window, '__mermaid', {
        configurable: true,
        get() { return mermaidValue },
        set(value) {
          const original = value.renderMermaidSVGWithReceipt
          value.renderMermaidSVGWithReceipt = function(source: string, options: unknown) {
            const artifact = original(source, options)
            ;(window as any).__examplesEditorRender = { source, options, artifact }
            return artifact
          }
          mermaidValue = value
        },
      })
    })

    const cards: Array<{ id: string, source: string, href: string }> = []
    for (const route of ['/examples/', '/examples/style-palette/', '/examples/corpus/']) {
      await page.goto(baseUrl + route, { waitUntil: 'networkidle' })
      cards.push(...await page.locator('article.example-sample').evaluateAll(articles => articles.map((article) => ({
        id: article.id,
        source: article.querySelector('.example-source code')?.textContent?.trim() ?? '',
        href: article.querySelector<HTMLAnchorElement>('a.go')?.getAttribute('href') ?? '',
      }))))
    }
    expect(cards.length).toBeGreaterThan(150)
    expect(new Set(cards.map(card => card.id)).size).toBe(cards.length)

    // One live-browser startup per distinct state/config shape, plus the
    // longest payload and the formerly transparent card. The exhaustive unit
    // proof covers every card through the same production resolver.
    const selected = new Map<string, (typeof cards)[number]>()
    for (const card of cards) {
      const state = decodedEditorState(card.href)
      const config = (state.config ?? {}) as Record<string, unknown>
      const signature = JSON.stringify({
        style: state.style,
        palette: state.palette,
        config: Object.keys(config).sort().map(key => [key, Array.isArray(config[key]) ? 'array' : typeof config[key]]),
      })
      if (!selected.has(signature)) selected.set(signature, card)
    }
    const longest = cards.reduce((current, card) => card.href.length > current.href.length ? card : current)
    selected.set('longest-link', longest)
    const formerlyTransparent = cards.find(card => card.id === 'rich-agentic-mermaid')
    expect(formerlyTransparent).toBeDefined()
    selected.set('formerly-transparent', formerlyTransparent!)

    for (const card of selected.values()) {
      expect(card.href, `${card.id}: canonical Editor state URL`).toStartWith('/editor/#deflate:')
      const state = decodedEditorState(card.href)
      const expectedOptions = editorRenderOptions(state)
      const expectedArtifact = renderWebsiteSVGWithReceipt(card.source, expectedOptions)
      // Hash-only navigation within one Editor document does not reboot its
      // share-state loader. Cross an empty document so every case exercises a
      // genuine recipient startup, including the initialization-reset path.
      await page.goto('about:blank')
      await page.goto(baseUrl + card.href, { waitUntil: 'networkidle' })
      try {
        await page.waitForFunction(({ source, appearanceDigest }) => {
          const rendered = (window as any).__examplesEditorRender
          const preview = document.getElementById('preview-inner') as HTMLElement | null
          return rendered?.source === source
            && rendered.artifact?.receipt?.appearanceDigest === appearanceDigest
            && preview?.dataset.sharedRequestDigest === rendered.artifact.receipt.sharedRequestDigest
        }, { source: card.source, appearanceDigest: expectedArtifact.receipt.appearanceDigest }, { timeout: 15_000 })
      } catch (error) {
        const last = await page.evaluate(() => {
          const rendered = (window as any).__examplesEditorRender
          return {
            source: rendered?.source,
            options: rendered?.options,
            appearanceDigest: rendered?.artifact?.receipt?.appearanceDigest,
            error: document.querySelector('.preview-error')?.textContent?.trim(),
          }
        })
        throw new Error(`${card.id}: expected appearance ${expectedArtifact.receipt.appearanceDigest}; last render ${JSON.stringify(last)}`, { cause: error })
      }
      const actual = await page.evaluate(() => ({
        render: (window as any).__examplesEditorRender,
        source: (document.getElementById('code-editor') as HTMLTextAreaElement | null)?.value.trim(),
        hash: location.hash,
        styleLabel: document.getElementById('style-btn-label')?.textContent?.trim(),
        paletteLabel: document.getElementById('theme-btn-label')?.textContent?.trim(),
      }))
      expect(actual.source, `${card.id}: restored source`).toBe(card.source)
      // Browser CompressionStream and Node zlib may produce different valid
      // deflate bytes. Assert semantic state stability, then pin the browser's
      // own canonical hash after its first verified render.
      expect(decodedEditorState(actual.hash), `${card.id}: stable canonical state`).toEqual(state)
      expect(actual.render.options, `${card.id}: live production options`).toEqual(expectedOptions)
      expect(actual.render.artifact.receipt.appearanceDigest, `${card.id}: appearance receipt`).toBe(expectedArtifact.receipt.appearanceDigest)
      expect(actual.render.artifact.svg, `${card.id}: complete SVG artifact`).toBe(expectedArtifact.svg)
      expect(actual.styleLabel, `${card.id}: truthful Style control`).toBe(appearanceLabel('look', state.style))
      expect(actual.paletteLabel, `${card.id}: truthful Palette control`).toBe(appearanceLabel('palette', state.palette))
      const settledHash = await page.evaluate((expectedHash) => new Promise<string>((resolve, reject) => {
        let stableFrames = 0
        function observe() {
          if (location.hash !== expectedHash) {
            reject(new Error(`hash changed to ${location.hash}`))
            return
          }
          stableFrames += 1
          if (stableFrames >= 3) resolve(location.hash)
          else requestAnimationFrame(observe)
        }
        requestAnimationFrame(observe)
      }), actual.hash)
      expect(settledHash, `${card.id}: hash after initialization settles`).toBe(actual.hash)
    }
    await page.close()
  }, 240_000)

  test('Examples starts fragment-free and explicitly loads one validated section', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const fragmentRequests: string[] = []
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/examples/fragments/')) fragmentRequests.push(path)
    })
    await page.goto(baseUrl + '/examples/', { waitUntil: 'networkidle' })
    expect(fragmentRequests).toEqual([])
    expect(await page.locator('article.example-sample').count()).toBe(EDITOR_EXAMPLES.length)
    const section = page.locator('[data-example-fragment][data-example-kind="style-palette"]')
    const button = section.locator('[data-example-load]')
    expect(await button.isVisible()).toBe(true)
    await button.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); element.click() })
    await section.locator('[data-example-fragment-root="style-palette"]').waitFor({ state: 'attached' })
    expect(fragmentRequests).toHaveLength(1)
    expect(await section.getAttribute('data-example-state')).toBe('loaded')
    expect(await section.locator('[data-example-status]').textContent()).toBe('Examples loaded.')
    expect(await page.locator('article.example-sample').count()).toBe(EDITOR_EXAMPLES.length + BUILTIN_FAMILY_METADATA.length)
    await page.close()
  }, 30_000)

  test('Examples near-viewport intent loads at most one adjacent deferred section', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const requests: string[] = []
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/examples/fragments/')) requests.push(path)
    })
    await page.goto(baseUrl + '/examples/', { waitUntil: 'networkidle' })
    await page.locator('[data-example-fragment][data-example-kind="style-palette"]').scrollIntoViewIfNeeded()
    await page.locator('[data-example-fragment-root="style-palette"]').waitFor({ state: 'attached' })
    expect(requests).toHaveLength(1)
    expect(await page.locator('[data-example-fragment][data-example-kind="corpus"]').getAttribute('data-example-state')).toBe('idle')
    await page.close()
  }, 30_000)

  test('Examples resolves current and frozen numeric deep links only after loading', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(baseUrl + '/examples/#style-palette-flowchart', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => document.activeElement?.id === 'style-palette-flowchart')
    expect(new URL(page.url()).hash).toBe('#style-palette-flowchart')
    expect(await page.locator('#style-palette-flowchart').count()).toBe(1)

    await page.goto(baseUrl + '/examples/#rich-1-agentic-mermaid', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => document.activeElement?.id === 'rich-agentic-mermaid')
    expect(new URL(page.url()).hash).toBe('#rich-agentic-mermaid')
    expect(await page.locator('#rich-agentic-mermaid').count()).toBe(1)
    await page.close()

    const noJs = await browser.newContext({ viewport: { width: 390, height: 900 }, javaScriptEnabled: false })
    const noJsPage = await noJs.newPage()
    await noJsPage.goto(baseUrl + '/examples/#rich-1-agentic-mermaid', { waitUntil: 'networkidle' })
    const continuation = noJsPage.locator('#rich-1-agentic-mermaid a')
    expect(await continuation.isVisible()).toBe(true)
    expect(await continuation.getAttribute('href')).toBe('/examples/corpus/#rich-agentic-mermaid')
    expect(await noJsPage.locator('article.example-sample').count()).toBe(EDITOR_EXAMPLES.length)
    await noJsPage.goto(baseUrl + '/examples/style-palette/', { waitUntil: 'networkidle' })
    expect(await noJsPage.locator('article.example-sample').count()).toBe(BUILTIN_FAMILY_METADATA.length)
    await noJsPage.goto(baseUrl + '/examples/corpus/', { waitUntil: 'networkidle' })
    expect(await noJsPage.locator('article.example-sample').count()).toBeGreaterThan(100)
    await noJs.close()
  }, 60_000)

  test('Examples fragment failures are retryable and cross-origin fragment URLs fail before fetch', async () => {
    async function exerciseFailure(kind: 'abort' | 'status' | 'mime' | 'malformed' | 'active') {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      let attempts = 0
      await context.route(/\/examples\/fragments\/style-palette-[a-f0-9]{12}\.html$/, async route => {
        attempts++
        if (attempts > 1) { await route.continue(); return }
        if (kind === 'abort') await route.abort('failed')
        else if (kind === 'status') await route.fulfill({ status: 503, contentType: 'text/html', body: 'unavailable' })
        else if (kind === 'mime') await route.fulfill({ status: 200, contentType: 'application/json', body: '<section data-example-fragment-root="style-palette"></section>' })
        else if (kind === 'active') await route.fulfill({ status: 200, contentType: 'text/html', body: '<section data-example-fragment-root="style-palette"><script>throw new Error("unexpected")</script></section>' })
        else await route.fulfill({ status: 200, contentType: 'text/html', body: '<div data-example-fragment-root="wrong"></div>' })
      })
      const page = await context.newPage()
      await page.goto(baseUrl + '/examples/', { waitUntil: 'networkidle' })
      const section = page.locator('[data-example-fragment][data-example-kind="style-palette"]')
      const button = section.locator('[data-example-load]')
      await button.click()
      await page.waitForFunction(() => document.querySelector('[data-example-fragment][data-example-kind="style-palette"]')?.getAttribute('data-example-state') === 'failed')
      expect(await button.textContent(), kind).toBe('Retry loading examples')
      expect(await section.locator('[data-example-status]').textContent(), kind).toContain('Could not load examples')
      expect(new URL(page.url()).hash, kind).toBe('')
      expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-example-load')), kind).toBe(true)
      await button.click()
      await section.locator('[data-example-fragment-root="style-palette"]').waitFor({ state: 'attached' })
      expect(attempts, kind).toBe(2)
      expect(await section.getAttribute('data-example-state'), kind).toBe('loaded')
      await context.close()
    }
    await exerciseFailure('abort')
    await exerciseFailure('status')
    await exerciseFailure('mime')
    await exerciseFailure('malformed')
    await exerciseFailure('active')

    const context = await browser.newContext()
    const page = await context.newPage()
    const thirdPartyRequests: string[] = []
    page.on('request', request => { if (new URL(request.url()).origin !== baseUrl) thirdPartyRequests.push(request.url()) })
    await page.goto(baseUrl + '/examples/', { waitUntil: 'networkidle' })
    const section = page.locator('[data-example-fragment][data-example-kind="style-palette"]')
    await section.evaluate(element => element.setAttribute('data-example-fragment', 'https://example.com/examples/fragments/style-palette-deadbeefdead.html'))
    await section.locator('[data-example-load]').click()
    await page.waitForFunction(() => document.querySelector('[data-example-fragment][data-example-kind="style-palette"]')?.getAttribute('data-example-state') === 'failed')
    expect(thirdPartyRequests).toEqual([])
    await context.close()
  }, 60_000)

  test('Examples preserves ordinary navigation when interception or browser APIs are unavailable', async () => {
    const failedContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await failedContext.route(/\/examples\/fragments\/style-palette-[a-f0-9]{12}\.html$/, route => route.abort('failed'))
    const failedPage = await failedContext.newPage()
    await failedPage.goto(baseUrl + '/examples/', { waitUntil: 'networkidle' })
    await failedPage.locator('a[data-example-deferred="style-palette"]').first().click()
    await failedPage.waitForURL(/\/examples\/style-palette\/#style-palette-/)
    expect(await failedPage.locator('[data-example-fragment-root="style-palette"]').count()).toBe(1)
    await failedContext.close()

    const noObserver = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await noObserver.addInitScript(() => { Object.defineProperty(window, 'IntersectionObserver', { configurable: true, value: undefined }) })
    const noObserverPage = await noObserver.newPage()
    const requests: string[] = []
    noObserverPage.on('request', request => { if (new URL(request.url()).pathname.startsWith('/examples/fragments/')) requests.push(request.url()) })
    await noObserverPage.goto(baseUrl + '/examples/', { waitUntil: 'networkidle' })
    expect(requests).toEqual([])
    expect(await noObserverPage.locator('[data-example-load]').first().isVisible()).toBe(true)
    await noObserver.close()

    const throwingObserver = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await throwingObserver.addInitScript(() => {
      Object.defineProperty(window, 'IntersectionObserver', { configurable: true, value: function BrokenIntersectionObserver() { throw new Error('observer unavailable') } })
    })
    const throwingObserverPage = await throwingObserver.newPage()
    const pageErrors: string[] = []
    throwingObserverPage.on('pageerror', error => pageErrors.push(error.message))
    await throwingObserverPage.goto(baseUrl + '/examples/', { waitUntil: 'networkidle' })
    expect(await throwingObserverPage.locator('[data-example-load]').first().isVisible()).toBe(true)
    expect(pageErrors).toEqual([])
    await throwingObserver.close()

    const noFetch = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await noFetch.addInitScript(() => { Object.defineProperty(window, 'fetch', { configurable: true, value: undefined }) })
    const noFetchPage = await noFetch.newPage()
    await noFetchPage.goto(baseUrl + '/examples/', { waitUntil: 'networkidle' })
    expect(await noFetchPage.locator('[data-example-load]').first().isHidden()).toBe(true)
    await noFetchPage.locator('a[data-example-deferred="style-palette"]').first().click()
    await noFetchPage.waitForURL(/\/examples\/style-palette\/#style-palette-/)
    await noFetch.close()
  }, 60_000)

  test('design motion specimen supports keyboard and direct manipulation without reduced-motion coast', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } })
    const trackTransform = () => page.locator('.dz-motion-track').evaluate((el) => (el as HTMLElement).style.transform)
    async function dragLeft(stationaryBeforeReleaseMs = 0) {
      const strip = page.locator('[data-motion-strip]')
      await strip.scrollIntoViewIfNeeded()
      const box = await strip.boundingBox()
      expect(box).not.toBeNull()
      const x = box!.x + box!.width * 0.8
      const y = box!.y + box!.height / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      await new Promise((resolve) => setTimeout(resolve, 24))
      await page.mouse.move(x - box!.width * 0.5, y)
      if (stationaryBeforeReleaseMs) await new Promise((resolve) => setTimeout(resolve, stationaryBeforeReleaseMs))
      const beforeRelease = await trackTransform()
      await page.mouse.up()
      return beforeRelease
    }

    await page.goto(baseUrl + '/about/design/', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => Boolean((document.querySelector('.dz-motion-track') as HTMLElement | null)?.style.transform), undefined, { timeout: 2_000 })
    const strip = page.locator('[data-motion-strip]')
    await strip.focus()
    const beforeKeyboard = await trackTransform()
    await page.keyboard.press('ArrowRight')
    expect(await trackTransform()).not.toBe(beforeKeyboard)
    const beforeDrag = await trackTransform()
    const afterNormalRelease = await dragLeft()
    expect(afterNormalRelease).not.toBe(beforeDrag)
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(await trackTransform()).not.toBe(afterNormalRelease)

    // A release after holding still must not reuse the preceding drag velocity.
    await page.goto(baseUrl + '/about/design/', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => Boolean((document.querySelector('.dz-motion-track') as HTMLElement | null)?.style.transform), undefined, { timeout: 2_000 })
    const afterStationaryRelease = await dragLeft(150)
    await new Promise((resolve) => setTimeout(resolve, 180))
    expect(await trackTransform()).toBe(afterStationaryRelease)

    try {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(baseUrl + '/about/design/', { waitUntil: 'networkidle' })
      await page.waitForFunction(() => Boolean((document.querySelector('.dz-motion-track') as HTMLElement | null)?.style.transform), undefined, { timeout: 2_000 })
      const afterRelease = await dragLeft()
      await new Promise((resolve) => setTimeout(resolve, 180))
      expect(await trackTransform()).toBe(afterRelease)
    } finally {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.close()
    }
  }, 30_000)

  test('public typography keeps the Examples-width document column and safe code wrapping', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(baseUrl + '/', { waitUntil: 'networkidle' })
    const metrics = await page.evaluate(() => {
      const body = getComputedStyle(document.body)
      const doc = document.querySelector('.doc') as HTMLElement
      const codeBlock = document.querySelector('.channels pre') as HTMLElement
      const code = codeBlock.querySelector('code') as HTMLElement
      const h1 = document.querySelector('h1') as HTMLElement
      return {
        bodyLine: Number.parseFloat(body.lineHeight) / Number.parseFloat(body.fontSize),
        docWidth: doc.getBoundingClientRect().width,
        codeOverflowX: getComputedStyle(codeBlock).overflowX,
        codeLigatures: getComputedStyle(code).fontFeatureSettings,
        h1Tracking: Number.parseFloat(getComputedStyle(h1).letterSpacing),
      }
    })
    expect(metrics.bodyLine).toBeGreaterThanOrEqual(1.55)
    expect(metrics.bodyLine).toBeLessThanOrEqual(1.62)
    expect(metrics.docWidth).toBeGreaterThanOrEqual(1000)
    expect(metrics.docWidth).toBeLessThanOrEqual(1008)
    expect(metrics.codeOverflowX).toBe('auto')
    expect(metrics.codeLigatures).toContain('"liga" 0')
    expect(Math.abs(metrics.h1Tracking)).toBeLessThan(2)
    await page.close()
  }, 30_000)

  test('each Inter weight selects its covered subset and full-only TTF fallback', async () => {
    const covered = WEBSITE_INTER_GLYPH_PROBES.covered.join(' ')
    const fullOnly = WEBSITE_INTER_GLYPH_PROBES.fullOnly.join(' ')
    for (const output of INTER_SUBSET_MANIFEST.outputs) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      await page.goto(baseUrl + '/__font-probe')
      const fontRequests: string[] = []
      page.on('request', request => {
        const path = new URL(request.url()).pathname
        if (path.startsWith('/fonts/Inter-')) fontRequests.push(path)
      })
      await page.setContent(`<link rel="stylesheet" href="${baseUrl}/styles.css"><span style="font: ${output.weight} 16px Inter">${covered}</span>`)
      await page.evaluate(async () => { await document.fonts.ready })
      expect(fontRequests, `${output.weight} covered`).toEqual([`/fonts/${output.file}`])
      const fallbackRequest = page.waitForRequest(request => new URL(request.url()).pathname === `/fonts/${output.source}`)
      await page.evaluate(({ weight, text }) => {
        const span = document.createElement('span')
        span.style.font = `${weight} 16px Inter`
        span.textContent = text
        document.body.append(span)
      }, { weight: output.weight, text: fullOnly })
      await fallbackRequest
      await page.evaluate(async () => { await document.fonts.ready })
      expect(fontRequests, `${output.weight} full-only`).toEqual([`/fonts/${output.file}`, `/fonts/${output.source}`])
      await page.close()
    }
  }, 60_000)

  test('covered Inter subset and full-TTF glyphs have identical same-run Chromium pixels', async () => {
    const page = await browser.newPage({ viewport: { width: 3000, height: 500 } })
    await page.goto(baseUrl + '/__font-probe')
    const fontRequests: string[] = []
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/fonts/Inter-')) fontRequests.push(path)
    })
    const text = WEBSITE_INTER_GLYPH_PROBES.covered.join(' ')
    const faces = INTER_SUBSET_MANIFEST.outputs.map((output, index) => `
      @font-face { font-family: 'Subset${index}'; src: url('${baseUrl}/fonts/${output.file}') format('woff2'); font-weight: ${output.weight}; }
      @font-face { font-family: 'Full${index}'; src: url('${baseUrl}/fonts/${output.source}') format('truetype'); font-weight: ${output.weight}; }
    `).join('')
    const rows = INTER_SUBSET_MANIFEST.outputs.map((output, index) => `
      <div id="subset-${index}" style="font-family:Subset${index};font-weight:${output.weight}">${text}</div>
      <div id="full-${index}" style="font-family:Full${index};font-weight:${output.weight}">${text}</div>
    `).join('')
    await page.setContent(`<style>${faces} div { width:max-content; white-space:nowrap; font-size:24px; line-height:32px; font-variant-numeric:tabular-nums; color:#111; background:#fff; }</style>${rows}`)
    await page.evaluate(async () => { await document.fonts.ready })
    expect(fontRequests.sort()).toEqual(INTER_SUBSET_MANIFEST.outputs.flatMap(output => [
      `/fonts/${output.file}`, `/fonts/${output.source}`,
    ]).sort())
    for (let index = 0; index < INTER_SUBSET_MANIFEST.outputs.length; index++) {
      const subset = page.locator(`#subset-${index}`)
      const full = page.locator(`#full-${index}`)
      const subsetBox = await subset.boundingBox()
      const fullBox = await full.boundingBox()
      expect({ width: subsetBox?.width, height: subsetBox?.height }).toEqual({ width: fullBox?.width, height: fullBox?.height })
      expect(await subset.screenshot()).toEqual(await full.screenshot())
    }
    await page.close()
  }, 60_000)

  test('editor blank-start URL opens an empty canvas instead of the default or saved draft', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(baseUrl + '/editor/', { waitUntil: 'networkidle' })
    await page.evaluate(() => sessionStorage.setItem('bm-editor-draft', JSON.stringify({ source: 'flowchart TD\n  Draft --> Restored', config: {}, savedAt: Date.now() })))
    await page.goto(baseUrl + '/editor/?empty=1', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => document.querySelector('#preview-placeholder'))
    expect(await page.locator('#code-editor').inputValue()).toBe('')
    expect(await page.locator('#preview-placeholder .placeholder-title').textContent()).toContain('No diagram yet')
    await page.close()
  }, 30_000)

  test('examples editor-state links survive editor initialization and load their source', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(baseUrl + '/examples/', { waitUntil: 'networkidle' })
    const link = page.locator('.example-sample a[href^="/editor/#deflate:"]').first()
    const article = link.locator('xpath=ancestor::article[1]')
    const expectedSource = (await article.locator('.example-source code').textContent())?.trim() ?? ''
    expect(expectedSource.length).toBeGreaterThan(0)

    await link.click()
    await page.locator('#code-editor').waitFor({ state: 'visible' })
    await page.waitForFunction(
      source => (document.querySelector('#code-editor') as HTMLTextAreaElement | null)?.value.trim() === source,
      expectedSource,
    )
    expect(await page.evaluate(() => location.hash.startsWith('#deflate:'))).toBe(true)
    expect((await page.locator('#code-editor').inputValue()).trim()).toBe(expectedSource)
    await page.close()
  }, 30_000)

  test('editor corrupt share hashes fail closed instead of loading plausible content', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(baseUrl + '/editor/?example=flowchart-basic#deflate:bad', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent?.includes('Nothing was loaded'))
    expect(await page.locator('#code-editor').inputValue()).toBe('')
    expect(await page.locator('#preview-placeholder .placeholder-title').textContent()).toContain('No diagram yet')
    expect(await page.evaluate(() => ({ search: location.search, hash: location.hash }))).toEqual({ search: '', hash: '' })
    await page.close()
  }, 30_000)

  test('editor aborts oversized expanded share links and reports the limit', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const hash = deflatedEditorHash({ source: 'flowchart TD\n  ' + 'A'.repeat(300 * 1024) })
    expect(hash.length).toBeLessThan(1_000)
    await page.goto(baseUrl + '/editor/#' + hash, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent?.includes('too large to open safely'))
    expect(await page.locator('#code-editor').inputValue()).toBe('')
    expect(await page.evaluate(() => location.hash)).toBe('')
    await page.close()
  }, 30_000)

  test('editor reports a missing DecompressionStream without legacy fallback', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.addInitScript(() => {
      Object.defineProperty(window, 'DecompressionStream', { configurable: true, value: undefined })
    })
    const hash = deflatedEditorHash({ source: 'flowchart TD\n  Shared --> Safely' })
    await page.goto(baseUrl + '/editor/#' + hash, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent?.includes('missing DecompressionStream'))
    expect(await page.locator('#code-editor').inputValue()).toBe('')
    expect(await page.evaluate(() => location.hash)).toBe('')
    await page.close()
  }, 30_000)

  test('editor rejects oversized saved drafts before parsing and clears them', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(baseUrl + '/editor/?empty=1', { waitUntil: 'networkidle' })
    await page.evaluate(() => sessionStorage.setItem('bm-editor-draft', 'x'.repeat(256 * 1024 + 1)))
    await page.goto(baseUrl + '/editor/', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent?.includes('too large to restore safely'))
    expect(await page.evaluate(() => sessionStorage.getItem('bm-editor-draft'))).toBeNull()
    expect(await page.locator('#code-editor').inputValue()).toContain('Parse source')
    await page.close()
  }, 30_000)

  test('editor autosaves drafts only within the current tab session', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(baseUrl + '/editor/?empty=1', { waitUntil: 'networkidle' })
    const source = 'flowchart TD\n  Private --> Session'
    await page.locator('#code-editor').fill(source)
    await page.locator('#code-editor').dispatchEvent('input')
    await page.waitForFunction(() => sessionStorage.getItem('bm-editor-draft')?.includes('Private'))
    expect(await page.locator('#draft-privacy-btn').count()).toBe(0)
    expect(await page.evaluate(() => localStorage.getItem('bm-editor-draft'))).toBeNull()

    await page.evaluate(() => history.replaceState(null, '', '/editor/'))
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForFunction((expected) => (document.querySelector('#code-editor') as HTMLTextAreaElement | null)?.value === expected, source)
    expect(await page.evaluate(() => localStorage.getItem('bm-editor-draft'))).toBeNull()
    await page.close()
  }, 30_000)

  test('editor share config cannot weaken strict SVG insertion', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const hash = deflatedEditorHash({
      source: 'flowchart TD\n  Safe --> Preview',
      config: {
        security: 'default',
        embedFontImport: true,
        unknownHostOption: '<script>window.__shareConfigRan = true</script>',
        mermaidConfig: {
          themeCSS: '</style><script>window.__shareConfigRan = true</script><image href="https://evil.invalid/x"/>',
        },
      },
    })
    await page.goto(baseUrl + '/editor/#' + hash, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => ['OK', 'Error'].includes(document.querySelector('#status-text')?.textContent || ''))
    const result = await page.evaluate(() => {
      const preview = document.querySelector('#preview-inner')!
      const attributes = Array.from(preview.querySelectorAll('*')).flatMap((element) => Array.from(element.attributes))
      return {
        executed: (window as any).__shareConfigRan,
        status: document.querySelector('#status-text')?.textContent,
        hasSvg: !!preview.querySelector('svg'),
        activeElements: preview.querySelectorAll('script, foreignObject, object, embed, iframe').length,
        eventHandlers: attributes.filter((attribute) => /^on/i.test(attribute.name)).length,
        html: preview.innerHTML,
      }
    })
    expect(result.executed).toBeUndefined()
    expect(result.activeElements).toBe(0)
    expect(result.eventHandlers).toBe(0)
    expect(result.status).toBe('Error')
    expect(result.hasSvg).toBe(false)
    expect(result.html).toContain('Raw Mermaid themeCSS is not allowed in strict security mode')
    expect(result.html).not.toContain('evil.invalid')
    expect(result.html).not.toContain('fonts.googleapis.com')
    await page.close()
  }, 30_000)

  test('editor loads every self-hosted diagram font face it advertises', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(baseUrl + '/editor/?empty=1', { waitUntil: 'networkidle' })
    const results = await page.evaluate(async (faces) => {
      return Promise.all(faces.map(async (face) => {
        const response = await fetch(`/fonts/${face.file}`)
        const weights = face.weight.split(/\s+/)
        const requestedWeight = weights.includes('700') ? '700' : (weights[0] || '400')
        const descriptor = `${face.style} ${requestedWeight} 16px "${face.family}"`
        const loaded = await document.fonts.load(descriptor)
        return {
          family: face.family,
          file: face.file,
          weight: face.weight,
          style: face.style,
          requestedWeight,
          fetchOk: response.ok,
          checkOk: document.fonts.check(descriptor),
          loadedFaces: loaded.map((font) => ({ family: font.family.replace(/["']/g, ''), weight: font.weight, style: font.style, status: font.status })),
        }
      }))
    }, HOSTED_FONT_RESOURCES)
    for (const result of results) {
      expect(result).toMatchObject({ fetchOk: true, checkOk: true })
      expect(result.loadedFaces.some((font) => font.family === result.family && font.status === 'loaded' && font.style === result.style)).toBe(true)
    }
    await page.close()
  }, 30_000)

  test('SVG export embeds canonical full Inter TTFs and never public subsets', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(baseUrl + '/editor/?example=flowchart-basic', { waitUntil: 'networkidle' })
    await page.locator('#preview-inner svg').waitFor({ state: 'visible', timeout: 15_000 })
    await page.click('#export-chevron-btn')
    const downloadPromise = page.waitForEvent('download', { timeout: 15_000 })
    await page.click('#export-svg-btn')
    const download = await downloadPromise
    const path = await download.path()
    expect(typeof path).toBe('string')
    const svg = readFileSync(path!, 'utf8')
    const embedded = Array.from(svg.matchAll(/data:font\/ttf;base64,([A-Za-z0-9+/=]+)/g), match => Buffer.from(match[1]!, 'base64'))
    const hashes = embedded.map(bytes => createHash('sha256').update(bytes).digest('hex')).sort()
    const expected = INTER_SUBSET_MANIFEST.sources.map(source => source.sha256).sort()
    expect(hashes).toEqual(expected)
    expect(svg).not.toContain('data:font/woff2')
    expect(svg).not.toContain('.subset-')
    await page.close()
  }, 60_000)

  test('editor share links cannot inject active SVG through render config', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const payload = {
      source: 'xychart-beta\n  x-axis [A, B]\n  y-axis 0 --> 10\n  bar [1, 2]',
      config: {
        mermaidConfig: {
          themeCSS: '</style><svg id="share-link-xss" onload="window.__shareLinkXss=1"></svg><style>',
        },
      },
    }
    const hash = deflatedEditorHash(payload)
    await page.goto(baseUrl + '/editor/#' + hash, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => ['OK', 'Error'].includes(document.querySelector('#status-text')?.textContent || ''))
    const result = await page.evaluate(() => ({
      executed: (window as any).__shareLinkXss ?? null,
      marker: Boolean(document.querySelector('#share-link-xss')),
      hasSvg: Boolean(document.querySelector('#preview-inner svg')),
      status: document.querySelector('#status-text')?.textContent,
      html: document.querySelector('#preview-inner')?.innerHTML ?? '',
    }))
    expect(result).toMatchObject({ executed: null, marker: false, hasSvg: false, status: 'Error' })
    expect(result.html).toContain('Raw Mermaid themeCSS is not allowed in strict security mode')
    await page.close()
  }, 30_000)

  test('editor share links restore style state and styled label fonts', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const hash = deflatedEditorHash({
      source: 'flowchart LR\n  S[Source .mmd] --> P[parse]\n  P --> N[narrow]\n  N --> M[mutate]\n  M --> V{verify}\n  V -- ok --> R[serialize → render]\n  V -- warnings --> N',
      palette: 'paper',
      style: 'chalkboard',
    })
    await page.goto(baseUrl + '/editor/#' + hash, { waitUntil: 'networkidle' })
    await page.locator('#preview-inner svg text').first().waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForFunction(() => document.fonts.check('16px Caveat'))
    expect(await page.locator('#style-btn-label').textContent()).toBe('Chalkboard')
    expect(await page.locator('#theme-btn-label').textContent()).toBe('Paper')
    const labelFont = await page.locator('#preview-inner svg text').first().evaluate((el) => getComputedStyle(el).fontFamily)
    expect(labelFont).toContain('Caveat')
    await page.close()
  }, 30_000)

  test('editor share links apply compact schematic label typography in the browser', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const hash = deflatedEditorHash({
      source: 'flowchart TD\n  A[Start] --> B{Decision?}\n  B -->|Yes| C[Do the thing]\n  B -->|No| D[Skip it]\n  C --> E[End]\n  D --> E',
      palette: 'nord-light',
      style: 'ops-schematic',
      seed: 8,
    })
    await page.goto(baseUrl + '/editor/#' + hash, { waitUntil: 'networkidle' })
    await page.locator('#preview-inner svg text').first().waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForFunction(() => document.fonts.check('12px "Share Tech Mono"'))
    expect(await page.locator('#style-btn-label').textContent()).toBe('Compact Trace Map')
    expect(await page.locator('#theme-btn-label').textContent()).toBe('Nord Light')
    const label = await page.locator('#preview-inner svg text', { hasText: 'START' }).first().evaluate((el) => {
      const style = getComputedStyle(el)
      return { text: el.textContent, fontFamily: style.fontFamily, fontWeight: style.fontWeight, fontSize: style.fontSize }
    })
    expect(label.text).toBe('START')
    expect(label.fontFamily).toContain('Share Tech Mono')
    expect(Number.parseInt(label.fontWeight, 10)).toBeGreaterThanOrEqual(700)
    expect(label.fontSize).toBe('12px')
    await page.close()
  }, 30_000)

  test('editor mobile preview controls stay reachable at phone width', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } })
    await page.goto(baseUrl + '/editor/?example=flowchart-basic', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => (document.querySelector('#code-editor') as HTMLTextAreaElement | null)?.value.startsWith('flowchart TD'))
    await page.locator('#mode-preview').click()
    await page.locator('#preview-inner svg').waitFor({ state: 'visible', timeout: 10_000 })
    const metrics = await page.evaluate(() => {
      const selectors = [
        '.app-brand',
        '#examples-sidebar-btn',
        '#settings-btn',
        '#dark-light-btn',
        '#theme-dropdown-btn',
        '#export-main-btn',
        '#export-chevron-btn',
        '#mode-source',
        '#mode-preview',
        '#format-diagram',
        '#format-unicode',
        '#format-ascii',
        '#zoom-out-btn',
        '#zoom-label',
        '#zoom-in-btn',
        '#zoom-fit-btn',
        '#pan-btn',
        '#copy-text-output-btn',
      ]
      return selectors.map((selector) => {
        const el = document.querySelector(selector) as HTMLElement
        const rect = el.getBoundingClientRect()
        return { selector, left: rect.left, right: rect.right, width: rect.width, height: rect.height, viewport: document.documentElement.clientWidth }
      })
    })
    for (const metric of metrics) {
      expect(metric.left).toBeGreaterThanOrEqual(0)
      expect(metric.right).toBeLessThanOrEqual(metric.viewport)
      expect(metric.height).toBeGreaterThanOrEqual(44)
    }
    await page.close()
  }, 30_000)

  test('editor popovers are keyboard-operable, inert when closed, and restore focus', async () => {
    await withFreshBrowser(async page => {
      await page.goto(baseUrl + '/editor/?example=flowchart-basic', { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => (document.querySelector('#code-editor') as HTMLTextAreaElement | null)?.value.startsWith('flowchart TD'))
    await page.locator('#preview-inner svg').waitFor({ state: 'visible', timeout: 10_000 })

    expect(await namedControls(page)).toEqual([])
    expect(await brokenAriaControls(page)).toEqual([])
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('[aria-pressed]')).filter((el) => el.tagName !== 'BUTTON').map((el) => `${el.tagName.toLowerCase()}.${(el as HTMLElement).className}`))).toEqual([])

    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.classList.contains('skip-link'))).toBe(true)
    const focusOutline = await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle)
    expect(focusOutline).not.toBe('none')

    for (const spec of [
      { button: '#examples-sidebar-btn', popup: '#examples-sidebar' },
      { button: '#settings-btn', popup: '#config-view' },
      { button: '#theme-dropdown-btn', popup: '#theme-dropdown-menu' },
      { button: '#export-chevron-btn', popup: '#export-dropdown' },
    ]) {
      await page.locator(spec.button).focus()
      await page.keyboard.press('Enter')
      expect(await page.locator(spec.button).getAttribute('aria-expanded')).toBe('true')
      expect(await page.locator(spec.popup).getAttribute('inert')).toBeNull()
      await page.keyboard.press('Escape')
      expect(await page.locator(spec.button).getAttribute('aria-expanded')).toBe('false')
      expect(await page.locator(spec.popup).getAttribute('inert')).toBe('')
      expect(await page.evaluate((selector) => document.activeElement === document.querySelector(selector), spec.button)).toBe(true)
    }

    await page.locator('#examples-sidebar-btn').focus()
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true })))
    expect(await page.locator('#shortcuts-dialog').getAttribute('aria-hidden')).toBe('false')
    expect(await page.evaluate(() => document.getElementById('code-editor')?.closest('[inert]') !== null)).toBe(true)
    await page.evaluate(() => (document.getElementById('code-editor') as HTMLTextAreaElement).focus())
    expect(await page.evaluate(() => document.activeElement === document.querySelector('#shortcuts-dialog-close'))).toBe(true)
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement === document.querySelector('#shortcuts-dialog-close'))).toBe(true)
    await page.keyboard.press('Escape')
    expect(await page.locator('#shortcuts-dialog').getAttribute('aria-hidden')).toBe('true')
    expect(await page.evaluate(() => document.activeElement === document.querySelector('#examples-sidebar-btn'))).toBe(true)
    expect(await page.evaluate(() => document.getElementById('code-editor')?.closest('[inert]') === null)).toBe(true)
    expect(await page.evaluate(() => document.getElementById('shortcuts-dialog')?.parentElement !== document.body)).toBe(true)

    // Opening shortcuts closes peer popups, so focus must return to the peer's
    // usable trigger rather than an element that became inert with the popup.
    await page.locator('#settings-btn').click()
    await page.locator('#font-select-btn').focus()
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true })))
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => document.activeElement === document.querySelector('#settings-btn'))).toBe(true)

    await page.locator('#settings-btn').click()
    for (const spec of [
      { button: '#font-select-btn', popup: '#font-popup' },
      { button: '.color-edit-btn[data-cfg="bg"]', popup: '#color-popup' },
    ]) {
      await page.locator(spec.button).focus()
      await page.keyboard.press('Enter')
      expect(await page.locator(spec.button).getAttribute('aria-expanded')).toBe('true')
      expect(await page.locator(spec.popup).getAttribute('inert')).toBeNull()
      await page.keyboard.press('Escape')
      expect(await page.locator(spec.button).getAttribute('aria-expanded')).toBe('false')
      expect(await page.locator(spec.popup).getAttribute('inert')).toBe('')
      expect(await page.evaluate((selector) => document.activeElement === document.querySelector(selector), spec.button)).toBe(true)
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBe(0)
    })
  }, 30_000)
})
