import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { chromium, type Browser, type Page } from 'playwright'
import { HOSTED_FONT_FACES } from '../font-manifest.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'

const REPO = join(import.meta.dir, '..', '..')
const SITE = join(REPO, 'website', 'public')

let server: ReturnType<typeof Bun.serve>
let browser: Browser
let baseUrl = ''

// This smoke suite needs a real Chromium. The CI `test` job runs the unit suite
// without installing Playwright browsers (only the separate e2e job does), so
// skip when none is installed — the same way the cross-runtime determinism tests
// skip without node/resvg — rather than failing the suite on a missing browser.
// executablePath() resolves to the bundled Chromium; its presence is the proxy
// for "Playwright browsers are installed", since the headless shell that
// launch({headless:true}) actually starts is installed alongside it.
const haveBrowser = (() => {
  try { return existsSync(chromium.executablePath()) } catch { return false }
})()
const describeBrowser = haveBrowser ? describe : describe.skip

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

function legacyEditorHash(payload: unknown) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
}

function deflatedEditorHash(payload: unknown) {
  return 'deflate:' + deflateRawSync(Buffer.from(JSON.stringify(payload), 'utf8')).toString('base64url')
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
    return Array.from(document.querySelectorAll('a[href], button, input, textarea, select')).flatMap((el) => {
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

describeBrowser('website browser accessibility smoke', () => {
  // Hooks live inside the guarded describe so a browser-less run (CI `test` job)
  // skips them too — a file-level beforeAll runs even when its only describe is
  // skipped, and launching there is exactly what fails when Chromium is absent.
  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        const abs = fileForPath(url.pathname)
        if (!abs) return new Response('Not found', { status: 404 })
        return new Response(Bun.file(abs), { headers: { 'content-type': mime[extname(abs)] || 'application/octet-stream' } })
      },
    })
    baseUrl = `http://${server.hostname}:${server.port}`
    browser = await chromium.launch({ headless: true })
  }, 30_000)

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
    for (const route of ['/', '/examples/#gantt', '/comparisons/', '/about/', '/docs/getting-started/', '/docs/', '/skills/agentic-mermaid-diagram-workflow/']) {
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

  test('editor blank-start URL opens an empty canvas instead of the default or saved draft', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(baseUrl + '/editor/', { waitUntil: 'networkidle' })
    await page.evaluate(() => localStorage.setItem('bm-editor-draft', JSON.stringify({ source: 'flowchart TD\n  Draft --> Restored', config: {}, savedAt: Date.now() })))
    await page.goto(baseUrl + '/editor/?empty=1', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => document.querySelector('#preview-placeholder'))
    expect(await page.locator('#code-editor').inputValue()).toBe('')
    expect(await page.locator('#preview-placeholder .placeholder-title').textContent()).toContain('No diagram yet')
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
    await page.evaluate(() => {
      localStorage.removeItem('bm-editor-draft-mode')
      localStorage.setItem('bm-editor-draft', 'x'.repeat(256 * 1024 + 1))
    })
    await page.goto(baseUrl + '/editor/', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent?.includes('too large to restore safely'))
    expect(await page.evaluate(() => localStorage.getItem('bm-editor-draft'))).toBeNull()
    expect(await page.locator('#code-editor').inputValue()).toContain('Parse source')
    await page.close()
  }, 30_000)

  test('editor exposes private autosave and moves draft content to session storage', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(baseUrl + '/editor/?empty=1', { waitUntil: 'networkidle' })
    const privacy = page.locator('#draft-privacy-btn')
    expect((await privacy.textContent())?.trim()).toBe('Autosave: this browser')
    expect(await privacy.getAttribute('aria-label')).toContain('stored in plaintext in this browser')

    const source = 'flowchart TD\n  Private --> Session'
    await page.locator('#code-editor').fill(source)
    await page.locator('#code-editor').dispatchEvent('input')
    await page.waitForFunction(() => localStorage.getItem('bm-editor-draft')?.includes('Private'))
    await privacy.click()
    await page.waitForFunction(() => sessionStorage.getItem('bm-editor-draft')?.includes('Private'))
    expect(await privacy.getAttribute('aria-pressed')).toBe('true')
    expect((await privacy.textContent())?.trim()).toBe('Autosave: private')
    expect(await page.evaluate(() => ({
      persistentDraft: localStorage.getItem('bm-editor-draft'),
      mode: localStorage.getItem('bm-editor-draft-mode'),
    }))).toEqual({ persistentDraft: null, mode: 'session' })

    await page.evaluate(() => history.replaceState(null, '', '/editor/'))
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForFunction((expected) => (document.querySelector('#code-editor') as HTMLTextAreaElement | null)?.value === expected, source)
    expect(await page.locator('#draft-privacy-btn').getAttribute('aria-pressed')).toBe('true')
    expect(await page.evaluate(() => localStorage.getItem('bm-editor-draft'))).toBeNull()
    await page.close()
  }, 30_000)

  test('editor share config cannot weaken strict SVG insertion', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const hash = legacyEditorHash({
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
    if (result.hasSvg) {
      expect(result.status).toBe('OK')
      expect(result.html).not.toContain('evil.invalid')
      expect(result.html).not.toContain('fonts.googleapis.com')
    } else {
      expect(result.status).toBe('Error')
      expect(result.html).toContain('Unsafe SVG output')
    }
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
    }, HOSTED_FONT_FACES)
    for (const result of results) {
      expect(result).toMatchObject({ fetchOk: true, checkOk: true })
      expect(result.loadedFaces.some((font) => font.family === result.family && font.status === 'loaded' && font.style === result.style)).toBe(true)
    }
    await page.close()
  }, 30_000)

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
    const hash = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    await page.goto(baseUrl + '/editor/#' + hash, { waitUntil: 'networkidle' })
    await page.locator('#preview-inner svg').waitFor({ state: 'visible', timeout: 10_000 })
    const result = await page.evaluate(() => ({
      executed: (window as any).__shareLinkXss ?? null,
      marker: Boolean(document.querySelector('#share-link-xss')),
    }))
    expect(result).toEqual({ executed: null, marker: false })
    await page.close()
  }, 30_000)

  test('editor share links restore style state and styled label fonts', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const hash = 'deflate:PY5BDoIwEEWvMumaegAXnkAIgYRNZTHCIARoybRIkLD1AB7Rk5iWxOV_7yf_b8KamSsSZ9EMZqlaZAfX7KYBcpUHBadxrEuQ8gKpmpAtlV6ngSRKI7NZAkoCitU4O3RHKw6o2J7EXbPuHhUgJZg-iExZ4g6H7kXwfX-ASdfE5b-2IOtOP-yxJSLhWhr92QknYhEJ69bB56rFob8b5FrsPw'
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
    const hash = 'deflate:RY6xDoIwFEV_5eXNdDcMGqGsLriYykDKkzZCS9pnjKH8uykOjuec5OauGP0raMISH5N_a9MHhqu8O4CzarkP3IEQR6hWSdpG691py7HKNt0oJqiV9MCGgI11Y_evF59AqvZpF7C8-3rfalTjhp3lj7FANjTnE86HQUx2NIwFRv5MWfoliqgNzT1bnT3RgOVh-wI'
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(baseUrl + '/editor/?example=flowchart-basic', { waitUntil: 'networkidle' })
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
      expect(await page.locator(spec.popup).evaluate((el) => (el as HTMLElement).inert)).toBe(false)
      await page.keyboard.press('Escape')
      expect(await page.locator(spec.button).getAttribute('aria-expanded')).toBe('false')
      expect(await page.locator(spec.popup).evaluate((el) => (el as HTMLElement).inert)).toBe(true)
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
      expect(await page.locator(spec.popup).evaluate((el) => (el as HTMLElement).inert)).toBe(false)
      await page.keyboard.press('Escape')
      expect(await page.locator(spec.button).getAttribute('aria-expanded')).toBe('false')
      expect(await page.locator(spec.popup).evaluate((el) => (el as HTMLElement).inert)).toBe(true)
      expect(await page.evaluate((selector) => document.activeElement === document.querySelector(selector), spec.button)).toBe(true)
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBe(0)
    await page.close()
  }, 30_000)
})
