/**
 * Editor style switcher — behavioral contract for the style/theme split.
 *
 * The style dropdown changes the diagram's LOOK (mark treatment: crisp,
 * hand-drawn, watercolor, …); the theme dropdown changes its PALETTE; render
 * precedence stacks them (explicit theme colors win over the style's own
 * palette). Like the theme switcher, a style change re-renders the artwork
 * only — the Kiln chrome never moves. The 🎲 seed button re-rolls styled ink
 * deterministically and never appears on the crisp default.
 *
 * Serves website/public and skips the same way as editor-theme-switch.test.ts
 * when Playwright's Chromium is not installed (AM_CHROMIUM overrides).
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

const chromiumExecutable = (() => {
  const override = process.env.AM_CHROMIUM
  if (override) {
    if (!existsSync(override)) throw new Error(`AM_CHROMIUM is set but no executable exists at: ${override}`)
    return override
  }
  try { return existsSync(chromium.executablePath()) ? undefined : null } catch { return null }
})()
const describeBrowser = chromiumExecutable === null ? describe.skip : describe

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

/** The styled scene shell is the observable "a look is active" signal: the
 *  hand-drawn look draws its paper-ruled backdrop, crisp never does. */
async function waitForBackdrop(page: Page, want: string | null) {
  await page.waitForFunction(
    (backdrop) => {
      const svg = document.querySelector('.preview-inner svg')
      if (!svg) return false
      // Styled renders carry several data-backdrop elements (the page rect is
      // "page"); match the specific furniture, or assert none exists at all.
      return backdrop === null
        ? svg.querySelector('[data-backdrop]') === null
        : svg.querySelector(`[data-backdrop="${backdrop}"]`) !== null
    },
    want,
    { timeout: 15_000 },
  )
}

async function chrome(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement
    return {
      accent: root.style.getPropertyValue('--t-accent').trim().toUpperCase(),
      bg: root.style.getPropertyValue('--t-bg').trim().toUpperCase(),
    }
  })
}

async function svgInk(page: Page) {
  // Fingerprint the sketch geometry (path data), which the seed re-rolls.
  return page.evaluate(() => {
    const svg = document.querySelector('.preview-inner svg')
    return Array.from(svg?.querySelectorAll('path') ?? []).map(p => p.getAttribute('d') ?? '').join('|').length
      + ':' + (svg?.innerHTML.length ?? 0)
  })
}

/** Topbar control anchors. A style change reveals the seed button; because that
 *  button reserves its slot even while inactive, none of these controls may move
 *  when a look is picked. Before the slot was reserved the theme/style dropdowns
 *  slid ~48px on desktop and the theme dropdown jumped a whole row on portrait. */
async function topbarSlots(page: Page) {
  return page.evaluate(() => {
    const at = (id: string) => {
      const el = document.getElementById(id)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y) }
    }
    return { theme: at('theme-dropdown-btn'), style: at('style-dropdown-btn'), share: at('share-btn') }
  })
}

describeBrowser('editor style switcher restyles the artwork, never the chrome', () => {
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
    browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable ?? undefined })
  }, 30_000)

  afterAll(async () => {
    await browser?.close()
    server?.stop(true)
  })

  test('crisp → hand-drawn → seed shuffle → crisp: look and ink change, chrome and layout ownership hold', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(baseUrl + '/editor/', { waitUntil: 'networkidle' })

    // Crisp default: no styled backdrop, seed button hidden.
    await waitForBackdrop(page, null)
    expect(await page.isHidden('#seed-shuffle-btn')).toBe(true)
    const kiln = await chrome(page)
    const slotsBefore = await topbarSlots(page)

    // Pick the hand-drawn look: the paper-ruled backdrop appears and the
    // seed control becomes meaningful.
    await page.click('#style-dropdown-btn')
    await page.click('.theme-dropdown-item[data-style="hand-drawn"]')
    await waitForBackdrop(page, 'paper-ruled')
    expect(await page.isVisible('#seed-shuffle-btn')).toBe(true)

    // Revealing the seed button must not reflow the topbar: its slot is reserved
    // while inactive, so every control stays exactly where it was.
    expect(await topbarSlots(page)).toEqual(slotsBefore)

    // The seed re-rolls the ink: sketch geometry changes on shuffle.
    const inkBefore = await svgInk(page)
    await page.click('#seed-shuffle-btn')
    await page.waitForFunction(
      (prev) => {
        const svg = document.querySelector('.preview-inner svg')
        const now = Array.from(svg?.querySelectorAll('path') ?? []).map(p => p.getAttribute('d') ?? '').join('|').length
          + ':' + (svg?.innerHTML.length ?? 0)
        return now !== prev
      },
      inkBefore,
      { timeout: 15_000 },
    )

    // The chrome never moved: styles are artwork-only, exactly like themes.
    expect(await chrome(page)).toEqual(kiln)

    // Back to crisp: styled shell gone, seed control hidden again.
    await page.click('#style-dropdown-btn')
    await page.click('.theme-dropdown-item[data-style="crisp"]')
    await waitForBackdrop(page, null)
    expect(await page.isHidden('#seed-shuffle-btn')).toBe(true)
  }, 60_000)

  test('style switch does not reflow the wrap-prone mobile topbar (portrait)', async () => {
    // Portrait is the worst case: the topbar wraps to several rows, so an
    // unreserved seed button shifted the whole wrap — the theme dropdown jumped
    // a full row (~284px) when a style was picked. The reserved slot holds it.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto(baseUrl + '/editor/', { waitUntil: 'networkidle' })
    await waitForBackdrop(page, null)
    expect(await page.isHidden('#seed-shuffle-btn')).toBe(true)
    const before = await topbarSlots(page)

    await page.click('#style-dropdown-btn')
    await page.click('.theme-dropdown-item[data-style="hand-drawn"]')
    await waitForBackdrop(page, 'paper-ruled')
    expect(await page.isVisible('#seed-shuffle-btn')).toBe(true)
    expect(await topbarSlots(page)).toEqual(before)
    await page.close()
  }, 60_000)
})
