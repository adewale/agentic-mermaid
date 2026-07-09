/**
 * Editor style switcher — behavioral contract for the style/theme split.
 *
 * The style dropdown changes the diagram's LOOK (mark treatment: crisp,
 * hand-drawn, watercolor, …); the theme dropdown changes its PALETTE; render
 * precedence stacks them (explicit theme colors win over the style's own
 * palette). Like the theme switcher, a style change re-renders the artwork
 * only — the Kiln chrome never moves.
 *
 * Serves website/public and skips the same way as editor-theme-switch.test.ts
 * when Playwright's Chromium is not installed (AM_CHROMIUM overrides).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'
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

/** Topbar control anchors. A style change must not move these controls; the
 *  style/palette split has fixed-width halves so a longer look label fills
 *  reserved space instead of reflowing the wrap-prone topbar. */
async function topbarSlots(page: Page) {
  return page.evaluate(() => {
    const at = (id: string) => {
      const el = document.getElementById(id)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y) }
    }
    return { theme: at('theme-dropdown-btn'), style: at('style-dropdown-btn'), examples: at('examples-sidebar-btn') }
  })
}

function legacyShareHash(payload: unknown) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
}

const STYLE_STACK_SHARE = {
  source: `xychart
  title "Styled Adoption"
  x-axis [Mon, Tue, Wed, Thu, Fri]
  y-axis "Renders" 0 --> 100
  bar [25, 42, 58, 74, 88]
  line [18, 35, 52, 70, 95]`,
  theme: 'zinc-light',
  style: 'publication-figure',
  config: {
    // Shared rich-example links can carry RenderOptions.style in config. It
    // used to overwrite the dropdown's named style in buildOptions(), so
    // picking Hand-drawn kept rendering as the config style with no sketch
    // backdrop.
    style: 'publication-figure',
    interactive: true,
  },
}

const RESTORED_CONFIG_SHARE = {
  source: `flowchart TD
  A[Alpha] --> B[Beta]`,
  config: {
    bg: '#112233',
    fg: '#F8FAFC',
    accent: '#66CCAA',
    font: 'Caveat',
    padding: 48,
    editorEdgeStroke: 2.5,
    editorNodeStroke: 3,
  },
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

  test('crisp → hand-drawn → crisp: look changes, chrome and layout ownership hold', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(baseUrl + '/editor/', { waitUntil: 'networkidle' })

    // Crisp default: no styled backdrop and no style-seed toolbar affordance.
    await waitForBackdrop(page, null)
    expect(await page.locator('#seed-shuffle-btn').count()).toBe(0)
    const kiln = await chrome(page)
    const slotsBefore = await topbarSlots(page)

    // Pick the hand-drawn look: the paper-ruled backdrop appears, but the
    // style switch still does not reflow the topbar.
    await page.click('#style-dropdown-btn')
    await page.click('.theme-dropdown-item[data-style="hand-drawn"]')
    await waitForBackdrop(page, 'paper-ruled')
    expect(await page.locator('#seed-shuffle-btn').count()).toBe(0)
    expect(await topbarSlots(page)).toEqual(slotsBefore)

    // The chrome never moved: styles are artwork-only, exactly like themes.
    expect(await chrome(page)).toEqual(kiln)

    // Back to crisp: styled shell gone.
    await page.click('#style-dropdown-btn')
    await page.click('.theme-dropdown-item[data-style="crisp"]')
    await waitForBackdrop(page, null)
  }, 60_000)

  test('shared config style still responds to the Style dropdown', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(baseUrl + '/editor/?empty=1#' + legacyShareHash(STYLE_STACK_SHARE), { waitUntil: 'networkidle' })

    await page.waitForFunction(() => {
      const editor = document.getElementById('code-editor') as HTMLTextAreaElement | null
      const label = document.getElementById('style-btn-label')
      const svg = document.querySelector('.preview-inner svg')
      return editor?.value.includes('Styled Adoption')
        && label?.textContent?.includes('Report Figure')
        && svg
        && !svg.querySelector('[data-backdrop="paper-ruled"]')
    }, null, { timeout: 15_000 })

    await page.click('#style-dropdown-btn')
    await page.click('.theme-dropdown-item[data-style="hand-drawn"]')
    await waitForBackdrop(page, 'paper-ruled')
    expect((await page.locator('#style-btn-label').textContent())?.trim()).toBe('Hand-drawn')
    await page.close()
  }, 60_000)

  test('shared config hydrates Settings and survives the first settings edit', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(baseUrl + '/editor/?empty=1#' + legacyShareHash(RESTORED_CONFIG_SHARE), { waitUntil: 'networkidle' })
    await page.waitForFunction(() => {
      const svg = document.querySelector('.preview-inner svg') as SVGSVGElement | null
      return svg && getComputedStyle(svg).getPropertyValue('--bg').trim().toUpperCase() === '#112233'
    }, null, { timeout: 15_000 })

    await page.click('#settings-btn')
    expect((await page.locator('#cfg-bg-label').textContent())?.trim().toUpperCase()).toBe('#112233')
    expect((await page.locator('#font-select-label').textContent())?.trim()).toBe('Caveat')
    expect(await page.locator('#cfg-padding').inputValue()).toBe('48')
    expect(await page.locator('#cfg-edge-stroke').inputValue()).toBe('2.5')
    expect(await page.locator('#cfg-node-stroke').inputValue()).toBe('3')

    await page.locator('#cfg-padding').fill('36')
    await page.locator('#cfg-padding').dispatchEvent('input')
    await page.waitForFunction(() => {
      const svg = document.querySelector('.preview-inner svg') as SVGSVGElement | null
      return svg && getComputedStyle(svg).getPropertyValue('--bg').trim().toUpperCase() === '#112233'
    }, null, { timeout: 15_000 })
    expect((await page.locator('#cfg-bg-label').textContent())?.trim().toUpperCase()).toBe('#112233')
    await page.close()
  }, 60_000)

  test('newer renders win over slower in-flight renders', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.addInitScript(() => {
      let mermaidValue: any
      Object.defineProperty(window, '__mermaid', {
        configurable: true,
        get() { return mermaidValue },
        set(value) {
          const original = value.renderMermaidSVGAsync
          value.renderMermaidSVGAsync = async function(source: string, options: unknown) {
            if (source.includes('Slow')) {
              ;(window as any).__amSlowRenderStarted = true
              await new Promise((resolve) => { ;(window as any).__amReleaseSlowRender = resolve })
              const svg = await original(source, options)
              ;(window as any).__amSlowRenderReturned = true
              return svg
            }
            return original(source, options)
          }
          mermaidValue = value
        },
      })
    })
    await page.goto(baseUrl + '/editor/?empty=1', { waitUntil: 'networkidle' })
    await page.waitForSelector('#code-editor')
    await page.locator('#code-editor').fill('flowchart TD\n  Slow[Slow] --> Done[Done]')
    await page.locator('#code-editor').dispatchEvent('input')
    await page.waitForFunction(() => (window as any).__amSlowRenderStarted === true, null, { timeout: 15_000 })
    await page.locator('#code-editor').fill('flowchart TD\n  Fast[Fast] --> Done[Done]')
    await page.locator('#code-editor').dispatchEvent('input')
    await page.waitForFunction(() => document.querySelector('.preview-inner svg')?.textContent?.includes('Fast'), null, { timeout: 15_000 })
    await page.evaluate(() => (window as any).__amReleaseSlowRender())
    await page.waitForFunction(() => (window as any).__amSlowRenderReturned === true, null, { timeout: 15_000 })
    const text = await page.locator('.preview-inner svg').textContent()
    expect(text).toContain('Fast')
    expect(text).not.toContain('Slow')
    await page.close()
  }, 60_000)

  test('style switch does not reflow the wrap-prone mobile topbar (portrait)', async () => {
    // Portrait is the worst case: the topbar wraps to several rows, so style
    // changes must not introduce or reveal any extra toolbar control.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto(baseUrl + '/editor/', { waitUntil: 'networkidle' })
    await waitForBackdrop(page, null)
    expect(await page.locator('#seed-shuffle-btn').count()).toBe(0)
    const before = await topbarSlots(page)

    await page.click('#style-dropdown-btn')
    await page.click('.theme-dropdown-item[data-style="hand-drawn"]')
    await waitForBackdrop(page, 'paper-ruled')
    expect(await page.locator('#seed-shuffle-btn').count()).toBe(0)
    expect(await topbarSlots(page)).toEqual(before)
    await page.close()
  }, 60_000)
})
