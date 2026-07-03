/**
 * Editor theme switcher — behavioral contract for the chrome/artwork split.
 *
 * The theme dropdown changes what the diagram RENDERS as; it must never retint
 * the app shell, whose Kiln brand (Stone ground, Pine accent) follows only the
 * user's light/dark toggle. This drives the real editor bundle in Chromium:
 * switch Paper → tokyo-night → Paper and assert the diagram's arrowheads track
 * the render theme while the chrome triplet stays pinned to the brand.
 *
 * Serves website/public like website-browser-a11y.test.ts, and skips the same
 * way when Playwright's Chromium is not installed (CI's unit job).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'

const REPO = join(import.meta.dir, '..', '..')
const SITE = join(REPO, 'website', 'public')

let server: ReturnType<typeof Bun.serve>
let browser: Browser
let baseUrl = ''

const haveBrowser = (() => {
  try { return existsSync(chromium.executablePath()) } catch { return false }
})()
const describeBrowser = haveBrowser ? describe : describe.skip

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
// render THEMES; the pine values from the chrome triplets in rendering.js.
const PAPER_ARROW = 'rgb(154, 74, 36)'        // #9A4A24
const TOKYO_ARROW = 'rgb(122, 162, 247)'      // #7AA2F7
const PINE_LIGHT = '#1B6E52'
const PINE_DARK = '#6FC2A2'

async function arrowFill(page: Page) {
  return page.evaluate(() => {
    const poly = document.querySelector('.preview-inner svg marker polygon')
    return poly ? getComputedStyle(poly).fill : ''
  })
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
    await browser?.close()
    server?.stop(true)
  })

  test('Paper → tokyo-night → Paper tracks in the artwork while the chrome stays Kiln', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(baseUrl + '/editor/', { waitUntil: 'networkidle' })
    // 'attached', not the default 'visible': <marker> content has no bounding
    // box, so a visibility wait never resolves even once the render is in.
    await page.waitForSelector('.preview-inner svg marker polygon', { state: 'attached', timeout: 15_000 })

    // Default render theme is Paper: terracotta arrowheads, light Kiln chrome.
    expect(await arrowFill(page)).toBe(PAPER_ARROW)
    expect(await chrome(page)).toEqual({ accent: PINE_LIGHT, bg: '#F8F4F0', scheme: 'light' })

    // Switching to a dark render theme re-themes the diagram…
    await pickTheme(page, 'tokyo-night')
    await page.waitForFunction(
      (want) => {
        const poly = document.querySelector('.preview-inner svg marker polygon')
        return poly !== null && getComputedStyle(poly).fill === want
      },
      TOKYO_ARROW,
      { timeout: 10_000 },
    )
    // …while the shell keeps the light Kiln brand: the user's colour-mode
    // toggle owns the chrome scheme, the diagram theme never does.
    expect(await chrome(page)).toEqual({ accent: PINE_LIGHT, bg: '#F8F4F0', scheme: 'light' })

    // And back: the artwork returns to terracotta, the chrome never moved.
    await pickTheme(page, 'paper')
    await page.waitForFunction(
      (want) => {
        const poly = document.querySelector('.preview-inner svg marker polygon')
        return poly !== null && getComputedStyle(poly).fill === want
      },
      PAPER_ARROW,
      { timeout: 10_000 },
    )
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
    await page.waitForFunction(
      (want) => {
        const poly = document.querySelector('.preview-inner svg marker polygon')
        return poly !== null && getComputedStyle(poly).fill === want
      },
      PAPER_ARROW,
      { timeout: 10_000 },
    )
    await page.close()
  }, 60_000)
})
