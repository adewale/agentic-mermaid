import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'

const REPO = join(import.meta.dir, '..', '..')
const SITE = join(REPO, 'website', 'public')

let server: ReturnType<typeof Bun.serve>
let browser: Browser
let baseUrl = ''

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
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
})

afterAll(async () => {
  await browser?.close()
  server?.stop(true)
})

describe('website browser accessibility smoke', () => {
  test('public routes have named controls, valid ARIA references, and no mobile horizontal overflow', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } })
    for (const route of ['/', '/examples/', '/gallery/', '/families/#gantt', '/docs/', '/skills/agentic-mermaid-diagram-workflow/']) {
      await page.goto(baseUrl + route, { waitUntil: 'networkidle' })
      expect({ route, unnamed: await namedControls(page) }).toEqual({ route, unnamed: [] })
      expect({ route, broken: await brokenAriaControls(page) }).toEqual({ route, broken: [] })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect({ route, overflow }).toEqual({ route, overflow: 0 })
      if (route === '/') {
        const unicodeOverflow = await page.locator('.unicode-diagram').evaluate((el) => el.scrollWidth - el.clientWidth)
        expect({ route, unicodeOverflow }).toEqual({ route, unicodeOverflow: 0 })
      }
      expect(await page.locator('.theme-switch').count()).toBe(0)
    }
    await page.close()
  })

  test('public typography keeps a measured document column and safe code wrapping', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(baseUrl + '/', { waitUntil: 'networkidle' })
    const metrics = await page.evaluate(() => {
      const body = getComputedStyle(document.body)
      const doc = document.querySelector('.doc') as HTMLElement
      const lead = document.querySelector('.home-main > .lead') as HTMLElement
      const code = document.querySelector('.agent-prompt code') as HTMLElement
      const h1 = document.querySelector('h1') as HTMLElement
      const unicode = document.querySelector('.unicode-diagram') as HTMLElement
      return {
        bodyLine: Number.parseFloat(body.lineHeight) / Number.parseFloat(body.fontSize),
        docWidth: doc.getBoundingClientRect().width,
        leadWidth: lead.getBoundingClientRect().width,
        codeWrap: getComputedStyle(code).overflowWrap,
        codeLigatures: getComputedStyle(code).fontFeatureSettings,
        h1Tracking: Number.parseFloat(getComputedStyle(h1).letterSpacing),
        unicodeOverflow: unicode.scrollWidth - unicode.clientWidth,
        unicodeCodeSize: getComputedStyle(unicode.querySelector('code') as HTMLElement).fontSize,
      }
    })
    expect(metrics.bodyLine).toBeGreaterThanOrEqual(1.55)
    expect(metrics.bodyLine).toBeLessThanOrEqual(1.62)
    expect(metrics.docWidth).toBeGreaterThan(760)
    expect(metrics.docWidth).toBeLessThanOrEqual(920)
    expect(metrics.leadWidth).toBeLessThan(metrics.docWidth)
    expect(metrics.codeWrap).toBe('break-word')
    expect(metrics.codeLigatures).toContain('"liga" 0')
    expect(metrics.unicodeOverflow).toBe(0)
    expect(Number.parseFloat(metrics.unicodeCodeSize)).toBeLessThan(11.5)
    expect(Math.abs(metrics.h1Tracking)).toBeLessThan(2)
    await page.close()
  })

  test('editor popovers are keyboard-operable, inert when closed, and restore focus', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(baseUrl + '/editor/?example=flowchart-basic', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => (document.querySelector('#code-editor') as HTMLTextAreaElement | null)?.value.startsWith('flowchart TD'))
    await page.locator('#preview-inner svg').waitFor({ state: 'visible', timeout: 10_000 })

    expect(await namedControls(page)).toEqual([])
    expect(await brokenAriaControls(page)).toEqual([])

    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.classList.contains('skip-link'))).toBe(true)
    const focusOutline = await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle)
    expect(focusOutline).not.toBe('none')

    for (const spec of [
      { button: '#examples-sidebar-btn', popup: '#examples-sidebar' },
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

    await page.locator('#mode-style').click()
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
  })
})
