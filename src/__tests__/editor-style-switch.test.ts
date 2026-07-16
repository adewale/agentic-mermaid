/**
 * Editor style switcher — behavioral contract for the style/theme split.
 *
 * The style dropdown changes the diagram's LOOK (mark treatment: crisp,
 * hand-drawn, watercolor, …); the theme dropdown changes its PALETTE; render
 * precedence stacks them (explicit theme colors win over the style's own
 * palette). Like the theme switcher, a style change re-renders the artwork
 * only — the Kiln chrome never moves.
 *
 * Serves website/public in the explicit `test:browser` lane and skips the
 * coverage unit lane. AM_CHROMIUM overrides the pinned browser executable.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { chromium, type Browser, type Page } from 'playwright'
import { serveWithAvailablePort } from '../../e2e/test-port.ts'
import { DEFAULT_ARCHITECTURE_VISUAL } from '../architecture/config.ts'
import { inspectPngColorProfile, inspectPngDimensions } from '../output-color-profile.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import {
  SECTION_A_TRANSPORT_FIXTURE,
  sectionATransportReceiptProjection,
} from './helpers/section-a-transport-fixture.ts'

const REPO = join(import.meta.dir, '..', '..')
const SITE = join(REPO, 'website', 'public')

let server: ReturnType<typeof Bun.serve>
let browser: Browser
let baseUrl = ''

async function newIsolatedPage(viewport: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext({ viewport })
  return context.newPage()
}

const chromiumExecutable = (() => {
  const override = process.env.AM_CHROMIUM
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

/** Look-specific furniture is the observable treatment signal. A Palette-only
 *  crisp render may still carry the common page backdrop. */
async function waitForBackdrop(page: Page, want: string | null) {
  await page.waitForFunction(
    (backdrop) => {
      const svg = document.querySelector('.preview-inner svg')
      if (!svg) return false
      // Styled renders carry a common page rect. Match the requested furniture,
      // or assert no look-specific furniture exists.
      return backdrop === null
        ? svg.querySelector('[data-backdrop]:not([data-backdrop="page"])') === null
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

function shareHash(payload: unknown) {
  return 'deflate:' + deflateRawSync(Buffer.from(JSON.stringify(payload), 'utf8')).toString('base64url')
}

const STYLE_STACK_SHARE = {
  source: `xychart
  title "Styled Adoption"
  x-axis [Mon, Tue, Wed, Thu, Fri]
  y-axis "Renders" 0 --> 100
  bar [25, 42, 58, 74, 88]
  line [18, 35, 52, 70, 95]`,
  palette: 'zinc-light',
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
    const served = serveWithAvailablePort({
      preferredPort: 4660,
      fetch(req) {
        const url = new URL(req.url)
        const abs = fileForPath(url.pathname)
        if (!abs) return new Response('Not found', { status: 404 })
        return new Response(Bun.file(abs), { headers: { 'content-type': mime[extname(abs)] || 'application/octet-stream' } })
      },
    })
    server = served.server
    baseUrl = served.base
    browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable ?? undefined })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    server?.stop(true)
  })

  test('crisp → hand-drawn → crisp: look changes, chrome and layout ownership hold', async () => {
    const page = await newIsolatedPage({ width: 1440, height: 900 })
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
    const page = await newIsolatedPage({ width: 1440, height: 900 })
    await page.goto(baseUrl + '/editor/?empty=1#' + shareHash(STYLE_STACK_SHARE), { waitUntil: 'networkidle' })

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
    const page = await newIsolatedPage({ width: 1440, height: 900 })
    await page.goto(baseUrl + '/editor/?empty=1#' + shareHash(RESTORED_CONFIG_SHARE), { waitUntil: 'networkidle' })
    await page.waitForFunction(() => {
      const svg = document.querySelector('.preview-inner svg') as SVGSVGElement | null
      const preview = document.querySelector('.preview-inner') as HTMLElement | null
      return svg
        && getComputedStyle(svg).getPropertyValue('--bg').trim().toUpperCase() === '#112233'
        && preview?.dataset.sharedRequestDigest
        && preview.dataset.renderRequestDigest
        && preview.dataset.appearanceDigest
    }, null, { timeout: 15_000 })

    await page.click('#settings-btn')
    expect((await page.locator('#cfg-bg-label').textContent())?.trim().toUpperCase()).toBe('#112233')
    expect((await page.locator('#font-select-label').textContent())?.trim()).toBe('Caveat')
    expect(await page.locator('#cfg-padding').inputValue()).toBe('48')

    await page.locator('#cfg-padding').fill('36')
    await page.locator('#cfg-padding').dispatchEvent('input')
    await page.waitForFunction(() => {
      const svg = document.querySelector('.preview-inner svg') as SVGSVGElement | null
      return svg && getComputedStyle(svg).getPropertyValue('--bg').trim().toUpperCase() === '#112233'
    }, null, { timeout: 15_000 })
    expect((await page.locator('#cfg-bg-label').textContent())?.trim().toUpperCase()).toBe('#112233')
    await page.close()
  }, 60_000)

  test('advanced RenderOptions round-trip through the canonical schema and reject unknown fields', async () => {
    const page = await newIsolatedPage({ width: 1440, height: 900 })
    await page.goto(baseUrl + '/editor/?empty=1', { waitUntil: 'networkidle' })
    await page.locator('#code-editor').fill('flowchart TD\n  A[Alpha] --> B[Beta]')
    await page.locator('#code-editor').dispatchEvent('input')
    await page.waitForFunction(() => !!document.querySelector('.preview-inner svg'), null, { timeout: 15_000 })

    await page.click('#settings-btn')
    const schemaProjection = await page.evaluate(() => {
      const schema = (window as any).__mermaid.SHARED_RENDER_OPTIONS_JSON_SCHEMA
      const summary = document.getElementById('cfg-advanced-schema')
      return {
        runtime: Object.keys(schema.properties),
        editor: String(summary?.getAttribute('title') || '').split(', ').filter(Boolean),
      }
    })
    expect(schemaProjection.editor).toEqual(schemaProjection.runtime)

    const advanced = {
      border: '#123456',
      nodeSpacing: 37,
      gantt: { dependencyArrows: true, criticalPath: true },
      architecture: { visual: { ...DEFAULT_ARCHITECTURE_VISUAL, serviceCornerRadius: 9 } },
    }
    await page.locator('#cfg-advanced-options').fill(JSON.stringify(advanced))
    const hashBeforeApply = await page.evaluate(() => window.location.hash)
    await page.click('#cfg-advanced-apply')
    await expect(page.locator('#cfg-advanced-status').textContent()).resolves.toContain('Applied 4 canonical options')
    expect(await page.locator('#cfg-advanced-options').getAttribute('aria-invalid')).toBe('false')
    expect(JSON.parse(await page.locator('#cfg-advanced-options').inputValue())).toEqual(advanced)
    await page.waitForFunction(previous => window.location.hash !== previous, hashBeforeApply, { timeout: 15_000 })
    const appliedHash = await page.evaluate(() => window.location.hash)

    await page.locator('#cfg-advanced-options').fill('{"notARealRenderOption":true}')
    await page.click('#cfg-advanced-apply')
    expect(await page.locator('#cfg-advanced-options').getAttribute('aria-invalid')).toBe('true')
    expect(await page.locator('#cfg-advanced-status').textContent()).toContain('unknown render option')
    expect(await page.evaluate(() => window.location.hash)).toBe(appliedHash)

    // The share hash is a transport, not a write-only cache: reloading must
    // retain every canonical field, including nested family options that the
    // old editor-local allowlist silently dropped.
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForFunction(() => {
      const preview = document.getElementById('preview-inner') as HTMLElement | null
      return Boolean(preview?.dataset.sharedRequestDigest && preview.dataset.appearanceDigest)
    }, null, { timeout: 15_000 })
    await page.click('#settings-btn')
    expect(JSON.parse(await page.locator('#cfg-advanced-options').inputValue())).toEqual(advanced)
    const reloadedReceipt = await page.evaluate(() => {
      const preview = document.getElementById('preview-inner') as HTMLElement
      return {
        sharedRequestDigest: preview.dataset.sharedRequestDigest,
        appearanceDigest: preview.dataset.appearanceDigest,
      }
    })
    const expected = renderMermaidSVGWithReceipt('flowchart TD\n  A[Alpha] --> B[Beta]', {
      ...advanced,
      style: 'paper',
      embedFontImport: false,
      security: 'strict',
    }).receipt
    expect(reloadedReceipt).toEqual({
      sharedRequestDigest: expected.sharedRequestDigest,
      appearanceDigest: expected.appearanceDigest,
    })
    await page.close()
  }, 60_000)

  test('browser PNG export passes its receipt gate, declares sRGB, and reports font failures', async () => {
    const page = await newIsolatedPage({ width: 1440, height: 900 })
    await page.route('**/fonts/**', route => route.abort())
    await page.goto(baseUrl + '/editor/', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => {
      const preview = document.querySelector('.preview-inner') as HTMLElement | null
      return !!document.querySelector('.preview-inner svg') && !!preview?.dataset.sharedRequestDigest
    }, null, { timeout: 15_000 })

    const digestBeforeFont = await page.locator('.preview-inner').getAttribute('data-shared-request-digest')
    await page.click('#settings-btn')
    await page.locator('#cfg-advanced-options').fill('{"font":"Caveat"}')
    await page.click('#cfg-advanced-apply')
    await expect(page.locator('#cfg-advanced-status').textContent()).resolves.toContain('Applied 1 canonical option')
    await page.waitForFunction(previous => {
      const preview = document.querySelector('.preview-inner') as HTMLElement | null
      return !!preview?.dataset.sharedRequestDigest && preview.dataset.sharedRequestDigest !== previous
    }, digestBeforeFont, { timeout: 15_000 })
    await page.click('#settings-close-btn')

    expect(await page.locator('.size-pill.active').getAttribute('data-scale')).toBe('2')
    await page.click('#export-chevron-btn')
    await page.selectOption('#png-fit-mode', 'width')
    await page.locator('#png-fit-value').fill('96')
    await page.selectOption('#png-background-mode', 'explicit')
    await page.locator('#png-background-color').fill('#123456')

    const downloadPromise = page.waitForEvent('download', { timeout: 15_000 })
    await page.click('#export-png-btn')
    let download
    try {
      download = await downloadPromise
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; editor status: ${await page.locator('#toast').textContent()}`)
    }
    const path = await download.path()
    expect(path).not.toBeNull()
    const png = new Uint8Array(await Bun.file(path!).arrayBuffer())
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(inspectPngDimensions(png).width).toBe(96)
    const profile = inspectPngColorProfile(png)
    expect(profile.profile).toBe('srgb')
    expect(profile.cICP).toEqual([1, 13, 0, 1])
    expect(profile.hasICC).toBe(false)
    await expect(page.locator('#toast').textContent()).resolves.toContain('font warning')
    await page.close()
  }, 60_000)

  test('scheduling a replacement render immediately revokes stale export authority', async () => {
    const page = await newIsolatedPage({ width: 1440, height: 900 })
    await page.goto(baseUrl + '/editor/', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => {
      const preview = document.getElementById('preview-inner') as HTMLElement | null
      return !!preview?.dataset.sharedRequestDigest
        && !(document.getElementById('export-main-btn') as HTMLButtonElement).disabled
    }, null, { timeout: 15_000 })
    const state = await page.evaluate(() => {
      const editor = document.getElementById('code-editor') as HTMLTextAreaElement
      editor.value += '\n%% authority-revocation probe'
      editor.dispatchEvent(new Event('input', { bubbles: true }))
      const preview = document.getElementById('preview-inner') as HTMLElement
      return {
        svgStillVisible: !!preview.querySelector('svg'),
        digest: preview.dataset.sharedRequestDigest,
        exportDisabled: (document.getElementById('export-main-btn') as HTMLButtonElement).disabled,
      }
    })
    expect(state).toEqual({ svgStillVisible: true, digest: undefined, exportDisabled: true })
    await page.close()
  }, 60_000)

  test('browser and editor retain comparable SVG, Unicode, and ASCII receipts', async () => {
    const page = await newIsolatedPage({ width: 1440, height: 900 })
    await page.goto(baseUrl + '/editor/?empty=1', { waitUntil: 'networkidle' })
    await page.locator('#code-editor').fill('sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Ready')
    await page.locator('#code-editor').dispatchEvent('input')
    await page.waitForFunction(() => {
      const api = (window as any).__mermaid
      const preview = document.getElementById('preview-inner') as HTMLElement | null
      return typeof api?.renderMermaidASCIIWithReceipt === 'function'
        && typeof api?.renderMermaidUnicodeWithReceipt === 'function'
        && !!preview?.dataset.sharedRequestDigest
    }, null, { timeout: 15_000 })

    await page.click('#format-unicode')
    await page.waitForFunction(() => {
      const preview = document.getElementById('preview-inner') as HTMLElement | null
      return !!preview?.dataset.unicodeSharedRequestDigest
        && !!preview.dataset.asciiSharedRequestDigest
    }, null, { timeout: 15_000 })

    const receipts = await page.evaluate(() => {
      const preview = document.getElementById('preview-inner') as HTMLElement
      return {
        svg: {
          shared: preview.dataset.sharedRequestDigest,
          request: preview.dataset.renderRequestDigest,
          appearance: preview.dataset.appearanceDigest,
        },
        unicode: {
          shared: preview.dataset.unicodeSharedRequestDigest,
          request: preview.dataset.unicodeRenderRequestDigest,
          appearance: preview.dataset.unicodeAppearanceDigest,
        },
        ascii: {
          shared: preview.dataset.asciiSharedRequestDigest,
          request: preview.dataset.asciiRenderRequestDigest,
          appearance: preview.dataset.asciiAppearanceDigest,
        },
      }
    })
    expect(new Set([receipts.svg.shared, receipts.unicode.shared, receipts.ascii.shared]).size).toBe(1)
    expect(new Set([receipts.svg.appearance, receipts.unicode.appearance, receipts.ascii.appearance]).size).toBe(1)
    expect(new Set([receipts.svg.request, receipts.unicode.request, receipts.ascii.request]).size).toBe(3)
    await expect(page.locator('#unicode-output').textContent()).resolves.toContain('Alice')
    await page.click('#format-ascii')
    await expect(page.locator('#ascii-output').textContent()).resolves.toContain('Alice')
    await page.close()
  }, 60_000)

  test('the canonical six-surface sentinel retains the complete receipt through the editor adapter', async () => {
    const { source, options } = SECTION_A_TRANSPORT_FIXTURE
    const library = renderMermaidSVGWithReceipt(source, options)
    const page = await newIsolatedPage({ width: 1440, height: 900 })
    await page.addInitScript(() => {
      let mermaidValue: any
      Object.defineProperty(window, '__mermaid', {
        configurable: true,
        get() { return mermaidValue },
        set(value) {
          const original = value.renderMermaidSVGWithReceipt
          value.renderMermaidSVGWithReceipt = function(source: string, options: unknown) {
            const artifact = original(source, options)
            ;(window as any).__sectionAEditorRender = { source, options, artifact }
            return artifact
          }
          mermaidValue = value
        },
      })
    })
    const share = shareHash({
      source,
      palette: 'paper',
      style: 'hand-drawn',
      seed: options.seed,
      config: { padding: options.padding },
    })
    await page.goto(baseUrl + '/editor/#' + share, { waitUntil: 'networkidle' })
    await page.waitForFunction((expectedSource) => {
      const rendered = (window as any).__sectionAEditorRender
      return rendered?.source === expectedSource
        && rendered.artifact?.receipt?.graphicalProjectionDigest
        && document.getElementById('preview-inner')?.querySelector('svg')
    }, source, { timeout: 15_000 })

    const editorRender = await page.evaluate(() => (window as any).__sectionAEditorRender)
    expect(editorRender.source).toBe(source)
    expect(editorRender.options).toEqual(options)
    const editorArtifact = editorRender.artifact
    expect(editorArtifact.svg).toBe(library.svg)
    expect(sectionATransportReceiptProjection(editorArtifact.receipt))
      .toEqual(sectionATransportReceiptProjection(library.receipt))
    await page.close()
  }, 60_000)

  test('newer renders win over slower in-flight renders', async () => {
    const page = await newIsolatedPage({ width: 1440, height: 900 })
    await page.addInitScript(() => {
      let mermaidValue: any
      Object.defineProperty(window, '__mermaid', {
        configurable: true,
        get() { return mermaidValue },
        set(value) {
          const original = value.renderMermaidSVGWithReceipt
          value.renderMermaidSVGWithReceipt = async function(source: string, options: unknown) {
            if (source.includes('Slow')) {
              ;(window as any).__amSlowRenderStarted = true
              await new Promise((resolve) => { ;(window as any).__amReleaseSlowRender = resolve })
              const svg = original(source, options)
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
    const page = await newIsolatedPage({ width: 390, height: 844 })
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
