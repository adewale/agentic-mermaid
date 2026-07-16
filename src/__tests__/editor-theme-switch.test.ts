/**
 * Editor theme switcher — behavioral contract for the chrome/artwork split.
 *
 * The theme dropdown changes what the diagram RENDERS as; it must never retint
 * the app shell, whose Kiln brand (Stone ground, Pine accent) follows only the
 * user's light/dark toggle. This drives the real editor bundle in Chromium:
 * switch Paper → tokyo-night → Paper and assert the diagram's arrowheads track
 * the render theme while the chrome triplet stays pinned to the brand.
 *
 * Serves website/public like website-browser-a11y.test.ts. It runs only in the
 * explicit `test:browser` lane so the coverage unit lane never starts browser
 * servers. Set AM_CHROMIUM=/path/to/chrome there to use a system Chromium when
 * the pinned Playwright browser build is absent (e.g. sandboxed containers).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { serveWithAvailablePort } from '../../e2e/test-port.ts'

const REPO = join(import.meta.dir, '..', '..')
const SITE = join(REPO, 'website', 'public')

let server: ReturnType<typeof Bun.serve>
let browser: Browser
let baseUrl = ''

const chromiumExecutable = (() => {
  const override = process.env.AM_CHROMIUM
  // An explicit override that points nowhere is a broken opt-in — fail loudly
  // rather than describe.skip, or a typo'd path masquerades as a green run.
  if (override) {
    if (!existsSync(override)) throw new Error(`AM_CHROMIUM is set but no executable exists at: ${override}`)
    return override
  }
  try { return existsSync(chromium.executablePath()) ? undefined : null } catch { return null }
})()
const describeBrowser = chromiumExecutable !== null && process.env.AM_BROWSER_TESTS === '1'
  ? describe
  : describe.skip

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
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

// Shipped hexes, as computed rgb() strings. Paper/tokyo-night come from the
// registered palettes; the pine values come from the chrome triplets in rendering.js.
const PAPER_ARROW = 'rgb(154, 74, 36)'        // #9A4A24
const TOKYO_ARROW = 'rgb(122, 162, 247)'      // #7AA2F7
const PINE_LIGHT = '#1B6E52'
const PINE_DARK = '#6FC2A2'

/**
 * Wait until the preview's arrowheads render in `want`, then return.
 *
 * One primitive for every diagram-state wait, including the very first render:
 * "the arrow is terracotta" IS the readiness condition, so there is no separate
 * existence wait. Deliberately waitForFunction, never waitForSelector — the
 * arrowhead lives inside <marker> defs, which have no bounding box, so
 * Playwright's selector engine considers it permanently invisible and a
 * default visibility wait would hang on an already-correct render.
 */
async function expectArrowFill(page: Page, want: string) {
  await page.waitForFunction(
    (fill) => {
      const poly = document.querySelector('.preview-inner svg marker polygon')
      return poly !== null && getComputedStyle(poly).fill === fill
    },
    want,
    { timeout: 30_000 },
  )
}

async function chrome(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement
    return {
      accent: root.style.getPropertyValue('--t-accent').trim().toUpperCase(),
      bg: root.style.getPropertyValue('--t-bg').trim().toUpperCase(),
      scheme: root.getAttribute('data-scheme'),
    }
  })
}

async function pickTheme(page: Page, key: string) {
  await page.click('#theme-dropdown-btn')
  await page.click(`.theme-dropdown-item[data-theme="${key}"]`)
}

describeBrowser('editor theme switcher re-themes the diagram, never the chrome', () => {
  beforeAll(async () => {
    const served = serveWithAvailablePort({
      preferredPort: 4600,
      fetch(req) {
        const url = new URL(req.url)
        const abs = fileForPath(url.pathname)
        if (!abs) return new Response('Not found', { status: 404 })
        return new Response(Bun.file(abs), { headers: { 'content-type': mime[extname(abs)] || 'application/octet-stream' } })
      },
    })
    server = served.server
    baseUrl = served.base
    // null (no usable browser) never reaches here: describeBrowser skips first.
    browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable ?? undefined })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    server?.stop(true)
  })

  test('Paper → tokyo-night → Paper tracks in the artwork while the chrome stays Kiln', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(baseUrl + '/editor/', { waitUntil: 'networkidle' })

    // Default render theme is Paper: terracotta arrowheads, light Kiln chrome.
    await expectArrowFill(page, PAPER_ARROW)
    expect(await chrome(page)).toEqual({ accent: PINE_LIGHT, bg: '#F8F4F0', scheme: 'light' })

    // Switching to a dark render theme re-themes the diagram…
    await pickTheme(page, 'tokyo-night')
    await expectArrowFill(page, TOKYO_ARROW)
    // …while the shell keeps the light Kiln brand: the user's colour-mode
    // toggle owns the chrome scheme, the diagram theme never does.
    expect(await chrome(page)).toEqual({ accent: PINE_LIGHT, bg: '#F8F4F0', scheme: 'light' })

    // And back: the artwork returns to terracotta, the chrome never moved.
    await pickTheme(page, 'paper')
    await expectArrowFill(page, PAPER_ARROW)
    expect(await chrome(page)).toEqual({ accent: PINE_LIGHT, bg: '#F8F4F0', scheme: 'light' })

    // The dark-mode toggle is what re-grounds the chrome (to Charcoal + dark
    // pine) — and doing so must not touch the Paper-themed artwork.
    await page.click('#dark-light-btn')
    await page.waitForFunction(
      (want) => document.documentElement.style.getPropertyValue('--t-accent').trim().toUpperCase() === want,
      PINE_DARK,
      { timeout: 5_000 },
    )
    expect((await chrome(page)).scheme).toBe('dark')
    await expectArrowFill(page, PAPER_ARROW)
    await page.close()
  }, 60_000)

  test('verification is the authority gate for export, copy, and share links', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(baseUrl + '/editor/', { waitUntil: 'networkidle' })
    await expectArrowFill(page, PAPER_ARROW)
    await page.waitForFunction(() => location.hash.length > 1)

    const copied = await page.evaluate(async () => {
      const g = window as any
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text: string) => { g.__editorAuditCopied = text } },
      })
      document.getElementById('copy-text-output-btn')!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
      const beforeMutation = g.__editorAuditCopied
      document.querySelector('#preview-inner svg')!.setAttribute('data-dom-mutated', 'yes')
      document.getElementById('copy-text-output-btn')!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
      return { beforeMutation, afterMutation: g.__editorAuditCopied }
    })
    expect(copied.afterMutation).toBe(copied.beforeMutation)
    expect(copied.afterMutation).not.toContain('data-dom-mutated')

    const validHash = await page.evaluate(() => location.hash)
    await page.fill('#code-editor', 'flowchart TD')
    await page.waitForFunction(() => document.getElementById('verify-summary')?.textContent?.includes('Fix structural'))
    expect(await page.locator('#preview-inner svg').count()).toBe(1)
    expect(await page.locator('#export-svg-btn').isDisabled()).toBe(true)
    expect(await page.locator('#preview-inner').getAttribute('data-shared-request-digest')).toBeNull()
    for (const format of ['unicode', 'ascii']) {
      await page.click(`[data-canvas-format="${format}"]`)
      await page.evaluate(() => document.getElementById('copy-text-output-btn')!.click())
      expect(await page.evaluate(() => (window as any).__editorAuditCopied)).toBe(copied.afterMutation)
      expect(await page.locator(`#${format}-output`).textContent()).toContain('Render and verify')
    }
    await page.evaluate(() => document.getElementById('copy-link-btn')!.click())
    expect(await page.evaluate(() => location.hash)).toBe(validHash)
    expect(await page.evaluate(() => (window as any).__editorAuditCopied)).toBe(copied.afterMutation)
    await page.close()
  }, 60_000)

  test('storage-denied browsers still boot and render the default diagram', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.addInitScript(() => {
      for (const name of ['getItem', 'setItem', 'removeItem']) {
        Object.defineProperty(Storage.prototype, name, {
          configurable: true,
          value() { throw new DOMException('storage denied', 'SecurityError') },
        })
      }
    })
    await page.goto(baseUrl + '/editor/', { waitUntil: 'networkidle' })
    await expectArrowFill(page, PAPER_ARROW)
    expect(await page.locator('#status-text').textContent()).toBe('OK')
    await page.close()
  }, 60_000)
})
