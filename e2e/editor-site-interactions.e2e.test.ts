/**
 * Editor and site interaction contracts that need a real browser: keyboard
 * routing, modal inertness, layout stability, text-pane fitting, the strict
 * SVG insertion sink, and PNG export provenance. They replace assertions that
 * used to pin the bundled editor's source text.
 *
 * Serves the generated website/public tree (run-browser-contracts.ts builds it
 * first). Renderer seams are wrapped through the documented `window.__mermaid`
 * adapter, the same technique editor-style-switch.test.ts uses.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { chromium, type Browser, type Page } from 'playwright'
import { PNG_DEFAULT_SCALE } from '../src/png-contract.ts'
import { serveWithAvailablePort } from './test-port.ts'

const SITE = join(import.meta.dir, '..', 'website', 'public')
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
}

let server: ReturnType<typeof Bun.serve>
let browser: Browser
let base = ''

function fileForPath(pathname: string): string | null {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '')
  const candidate = rel && !rel.endsWith('/') ? rel : `${rel}index.html`
  for (const path of [candidate, join(rel, 'index.html')]) {
    const abs = normalize(join(SITE, path))
    if (abs.startsWith(SITE) && existsSync(abs) && !abs.endsWith('/')) return abs
  }
  return null
}

function shareHash(payload: unknown): string {
  return 'deflate:' + deflateRawSync(Buffer.from(JSON.stringify(payload), 'utf8')).toString('base64url')
}

async function waitForVerifiedRender(page: Page) {
  await page.waitForFunction(() => document.getElementById('status-text')?.textContent === 'OK', undefined, { timeout: 20_000 })
}

/** Record every message the editor toast presents from now on. */
async function recordToasts(page: Page) {
  await page.evaluate(() => {
    const toast = document.getElementById('toast')!
    const seen: string[] = []
    ;(window as any).__toasts = seen
    new MutationObserver(() => { if (toast.classList.contains('show')) seen.push(toast.textContent ?? '') })
      .observe(toast, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  })
}

/**
 * Wrap one renderer entry point on the adapter the bundle installs. `wrapper`
 * is the source of `function(original) { return function(...) {...} }`,
 * injected as an init script so it needs no eval under the page's CSP.
 */
async function wrapAdapter(page: Page, name: string, wrapper: string) {
  await page.addInitScript({
    content: `(function () {
      var adapter;
      var wrap = ${wrapper};
      Object.defineProperty(window, '__mermaid', {
        configurable: true,
        get: function () { return adapter; },
        set: function (value) { value[${JSON.stringify(name)}] = wrap(value[${JSON.stringify(name)}]); adapter = value; },
      });
    })();`,
  })
}

describe('editor and site interactions in a real browser', () => {
  beforeAll(async () => {
    if (!existsSync(join(SITE, 'editor', 'index.html'))) throw new Error('website/public is missing — run `bun run website` first')
    const served = serveWithAvailablePort({
      preferredPort: 4781,
      fetch(request) {
        const abs = fileForPath(new URL(request.url).pathname)
        if (!abs) return new Response('Not found', { status: 404 })
        return new Response(Bun.file(abs), { headers: { 'content-type': MIME[extname(abs)] ?? 'application/octet-stream' } })
      },
    })
    server = served.server
    base = served.base
    browser = await chromium.launch({ headless: true })
  }, 120_000)

  afterAll(async () => {
    server?.stop(true)
    await browser?.close()
  })

  test('"?" opens an aria-modal cheat sheet over an inert background, but is plain text in the source', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(`${base}/editor/?example=flowchart-basic`, { waitUntil: 'networkidle' })
    await waitForVerifiedRender(page)
    const inertness = () => page.evaluate(() => Array.from(document.body.children).map(child => `${child.id || child.tagName}:${(child as HTMLElement).inert}`))
    const restingInertness = await inertness()

    await page.locator('#code-editor').focus()
    await page.keyboard.press('End')
    await page.keyboard.type('?')
    expect(await page.locator('#code-editor').inputValue()).toEndWith('?')
    expect(await page.locator('#shortcuts-dialog').getAttribute('aria-hidden')).toBe('true')

    await page.locator('#settings-btn').focus()
    await page.keyboard.press('?')
    const open = await page.evaluate(() => {
      const dialog = document.getElementById('shortcuts-dialog')!
      return {
        role: dialog.getAttribute('role'),
        modal: dialog.getAttribute('aria-modal'),
        hidden: dialog.getAttribute('aria-hidden'),
        focusInside: dialog.contains(document.activeElement),
        interactiveBackground: Array.from(document.body.children).filter(child => child !== dialog && !(child as HTMLElement).inert).map(child => child.id || child.tagName),
      }
    })
    expect(open).toEqual({ role: 'dialog', modal: 'true', hidden: 'false', focusInside: true, interactiveBackground: [] })

    await page.keyboard.press('Escape')
    expect(await page.locator('#shortcuts-dialog').getAttribute('aria-hidden')).toBe('true')
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('settings-btn')
    await page.waitForFunction((resting) => {
      const now = Array.from(document.body.children).map(child => `${child.id || child.tagName}:${(child as HTMLElement).inert}`)
      return JSON.stringify(now) === JSON.stringify(resting)
    }, restingInertness)

    // The export popover is a dialog of plain buttons, not an ARIA menu.
    await page.locator('#export-chevron-btn').click()
    expect(await page.locator('#export-dropdown [role="menuitem"], #export-dropdown [role="menu"]').count()).toBe(0)
    await page.close()
  }, 60_000)

  test('Cmd/Ctrl+C in the source is the browser copy, never an app-level SVG copy', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.addInitScript(() => {
      const writes: string[] = []
      ;(window as any).__appClipboardWrites = writes
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => { writes.push(text) },
          write: async () => { writes.push('<clipboard item>') },
        },
      })
    })
    await page.goto(`${base}/editor/?example=flowchart-basic`, { waitUntil: 'networkidle' })
    await waitForVerifiedRender(page)
    await recordToasts(page)
    await page.locator('#code-editor').focus()
    await page.keyboard.press('ControlOrMeta+A')
    for (const chord of ['Control+c', 'Meta+c', 'Control+Shift+c']) await page.keyboard.press(chord)
    // Any app handler would have written synchronously and toasted within one
    // toast replacement interval; allow that interval to elapse in-page.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)))
    const observed = await page.evaluate(() => ({
      writes: (window as any).__appClipboardWrites as string[],
      copyToasts: ((window as any).__toasts as string[]).filter(message => /cop(?:y|ied)/i.test(message)),
    }))
    expect(observed).toEqual({ writes: [], copyToasts: [] })
    await page.close()
  }, 60_000)

  test('copy feedback keeps the homepage copy button width while its label changes', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } })
    })
    await page.goto(`${base}/`, { waitUntil: 'networkidle' })
    const button = page.locator('button[data-copy-text]').first()
    const measure = () => button.evaluate(element => ({ width: element.getBoundingClientRect().width, label: element.textContent?.trim() ?? '' }))
    const resting = await measure()
    await button.click()
    await page.waitForFunction(() => document.querySelector('button[data-copy-text]')?.getAttribute('data-copy-state') === 'ok')
    const copied = await measure()
    expect(copied.label).toBe('Copied')
    expect(copied.label).not.toBe(resting.label)
    expect(Math.abs(copied.width - resting.width)).toBeLessThan(1)
    await page.waitForFunction(() => !document.querySelector('button[data-copy-text]')?.hasAttribute('data-copy-state'), undefined, { timeout: 5_000 })
    const restored = await measure()
    expect(restored.label).toBe(resting.label)
    expect(Math.abs(restored.width - resting.width)).toBeLessThan(1)
    await page.close()
  }, 60_000)

  test('a wide Unicode rendering is scaled down to fit the text pane', async () => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 800 } })
    // Seven stages are wider than the pane at the base size but fit above the
    // 6.5px legibility floor.
    const source = 'flowchart LR\n  ' + Array.from({ length: 7 }, (_, i) => `S${i}[Stage ${i}]`).join(' --> ')
    await page.goto(`${base}/editor/#${shareHash({ source })}`, { waitUntil: 'networkidle' })
    await waitForVerifiedRender(page)
    await page.locator('#format-unicode').click()
    await page.waitForFunction(() => document.getElementById('unicode-output')?.textContent?.includes('Stage 6'), undefined, { timeout: 15_000 })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const fit = await page.evaluate(() => {
      const output = document.getElementById('unicode-output')!
      const wrap = document.getElementById('unicode-output-wrap')!
      return {
        overflow: wrap.scrollWidth - wrap.clientWidth,
        fontSize: parseFloat(getComputedStyle(output).fontSize),
        baseFontSize: parseFloat(getComputedStyle(wrap).fontSize),
      }
    })
    expect(fit.overflow).toBeLessThanOrEqual(0)
    expect(fit.fontSize).toBeLessThan(fit.baseFontSize)
    expect(fit.fontSize).toBeGreaterThanOrEqual(6.5)
    await page.close()
  }, 60_000)

  test('the preview accepts exactly one verified SVG document from the renderer', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.addInitScript(() => { (window as any).__smuggledRan = 0 })
    await wrapAdapter(page, 'renderMermaidSVGWithReceipt', `function(original) {
      return function(source, options) {
        var artifact = original(source, options);
        if (source.indexOf('Smuggle') >= 0) {
          return Object.assign({}, artifact, { svg: artifact.svg + '<p id="smuggled-by-renderer">smuggled</p>' });
        }
        if (source.indexOf('Handler') >= 0) {
          return Object.assign({}, artifact, { svg: artifact.svg.replace('<svg ', '<svg onmouseover="window.__smuggledRan = 1" ') });
        }
        return artifact;
      };
    }`)
    await page.goto(`${base}/editor/?empty=1`, { waitUntil: 'networkidle' })
    const render = async (source: string) => {
      // A sentinel status proves the OK/Error read below belongs to this render.
      await page.evaluate(() => { document.getElementById('status-text')!.textContent = 'awaiting-test-render' })
      await page.locator('#code-editor').fill(source)
      await page.waitForFunction(() => ['OK', 'Error'].includes(document.getElementById('status-text')?.textContent ?? ''), undefined, { timeout: 20_000 })
      return page.evaluate(() => {
        const preview = document.getElementById('preview-inner')!
        return {
          status: document.getElementById('status-text')?.textContent,
          childTags: Array.from(preview.children).map(child => child.localName),
          smuggled: document.getElementById('smuggled-by-renderer') !== null,
          handlers: Array.from(preview.querySelectorAll('*')).flatMap(element => Array.from(element.attributes)).filter(attribute => /^on/i.test(attribute.name)).length,
          error: preview.querySelector('.preview-error-detail')?.textContent ?? '',
        }
      })
    }

    await expect(render('flowchart TD\n  Clean --> Output')).resolves.toMatchObject({ status: 'OK', childTags: ['svg'], smuggled: false, handlers: 0 })
    const smuggled = await render('flowchart TD\n  Smuggle --> Trailing')
    expect(smuggled).toMatchObject({ status: 'Error', smuggled: false, handlers: 0 })
    expect(smuggled.childTags).not.toContain('svg')
    expect(smuggled.error).toContain('Renderer returned malformed SVG')
    const handler = await render('flowchart TD\n  Handler --> Attribute')
    expect(handler).toMatchObject({ status: 'Error', smuggled: false, handlers: 0 })
    expect(handler.childTags).not.toContain('svg')
    expect(handler.error).toContain('Unsafe SVG output blocked: inline-event-handler')
    expect(await page.evaluate(() => (window as any).__smuggledRan)).toBe(0)
    await page.close()
  }, 60_000)

  test('PNG export records unreachable fonts in its receipt and renders at the default scale', async () => {
    const exportPng = async (blockFonts: boolean) => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
      if (blockFonts) await page.route('**/fonts/**', route => route.abort())
      await wrapAdapter(page, 'renderMermaidPNGInBrowserWithReceipt', `function(original) {
        return function(source, options, output, rasterize) {
          return original(source, options, output, rasterize).then(function(artifact) {
            window.__pngExport = { output: output, diagnostics: artifact.diagnostics.map(function(d) { return d.code; }), fontSources: artifact.runtime.fontSources.slice(), receipt: artifact.receipt.output };
            return artifact;
          });
        };
      }`)
      const hash = shareHash({ source: 'flowchart LR\n  Hand --> Drawn', palette: 'paper', style: 'chalkboard' })
      await page.goto(`${base}/editor/#${hash}`, { waitUntil: 'networkidle' })
      await waitForVerifiedRender(page)
      const svgSize = await page.evaluate(() => {
        const svg = document.querySelector('#preview-inner svg')!
        const viewBox = svg.getAttribute('viewBox')!.split(/\s+/).map(Number)
        return { width: viewBox[2]!, height: viewBox[3]! }
      })
      await page.locator('#export-chevron-btn').click()
      const download = page.waitForEvent('download', { timeout: 30_000 })
      await page.locator('#export-png-btn').click()
      const png = readFileSync((await (await download).path())!)
      const recorded = await page.evaluate(() => (window as any).__pngExport)
      await page.close()
      return { recorded, svgSize, pixels: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } }
    }

    const blocked = await exportPng(true)
    expect(blocked.recorded).toMatchObject({ output: { scale: PNG_DEFAULT_SCALE }, fontSources: ['unavailable'], receipt: 'png' })
    expect(blocked.recorded.diagnostics).toContain('EDITOR_FONT_FETCH_FAILED')
    // Raster dimensions round up to whole pixels.
    expect(Math.abs(blocked.pixels.width - blocked.svgSize.width * PNG_DEFAULT_SCALE)).toBeLessThanOrEqual(1)
    expect(Math.abs(blocked.pixels.height - blocked.svgSize.height * PNG_DEFAULT_SCALE)).toBeLessThanOrEqual(1)

    const reachable = await exportPng(false)
    expect(reachable.recorded.fontSources).toEqual(['embedded-data-uri', 'unavailable'])
    expect(reachable.recorded.diagnostics).not.toContain('EDITOR_FONT_FETCH_FAILED')
  }, 120_000)
})
