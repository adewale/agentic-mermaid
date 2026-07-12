/**
 * Browser E2E tests for the live editor, using Playwright with bun:test.
 *
 * These open the editor (built by scripts/site/editor.ts — the same generator
 * the Cloudflare site ships) in a real browser and verify:
 * - The editor renders diagrams (incl. fork-added families) through the bundle
 * - Theme registry, examples sidebar, mobile pane tabs, and topbar behavior
 * - Visual-regression baselines for styled renders
 *
 * Requires: Playwright browsers installed (`bunx playwright install chromium`).
 * Run:  bun run test:browser
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { join } from 'path'
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright'
import { BUILTIN_FAMILY_METADATA } from '../src/agent/families.ts'
import { serveWithAvailablePort } from './test-port.ts'

const ROOT = join(import.meta.dir, '..')
const PREFERRED_PORT = 4567
let BASE = ''
const SCREENSHOT_DIR = join(ROOT, 'e2e', 'screenshots')
// Browser font rasterization differs between local macOS and GitHub's Linux runners.
// Structural SVG assertions catch the exact regression; this tolerance keeps
// screenshot checks focused on gross visual drift rather than text antialiasing.
const ROUNDED_FILL_SCREENSHOT_MAX_DIFF = 0.05
const ARCHITECTURE_ROUNDED_FILL_SOURCE = `architecture-beta
  group edge(cloud)[Edge Layer]
  group core(server)[Core Services]
  service web(server)[Web App] in edge
  service api(server)[API] in core
  service db(database)[Postgres] in core
  web:R --> L:api
  api:R --> L:db`
const ROUNDED_FILL_CONFIG = { style: 'status-dashboard' } as const

// ---------------------------------------------------------------------------
// Browser + page references
// ---------------------------------------------------------------------------

let browser: Browser
let context: BrowserContext
let page: Page
let cdpSession: CDPSession | null = null

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for the live editor preview to show a successful SVG render. */
async function waitForEditorRender(timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const status = document.getElementById('status-text')?.textContent
      return status === 'OK' && document.querySelector('#preview-inner svg') !== null
    },
    undefined,
    { timeout: timeoutMs },
  )
}

/**
 * Navigate to the local app without waiting for the page's load event.
 *
 * The generated editor page runs large module scripts and renders many SVGs
 * before `load` can fire. On GitHub's slower Chromium runners that makes
 * Playwright's default `page.goto(..., waitUntil: "load")` flaky and leaves the
 * shared page in a pending-navigation state after one timeout. These tests wait
 * for app-specific readiness (`waitForEditorRender` or a selector) after
 * navigation, so committing the response is the useful boundary.
 *
 * The page also embeds many SVGs whose Google Font imports can keep Chromium's
 * previous document in a loading state even after the app reports that rendering
 * is done. Use a fresh Page for each explicit navigation while keeping the same
 * BrowserContext, so localStorage persists but a stuck prior document cannot
 * block the next response from committing on slower GitHub runners.
 */
async function gotoApp(url: string): Promise<void> {
  const previous = page
  const viewport = previous?.viewportSize() ?? null
  try { await cdpSession?.send('Page.stopLoading') } catch {}
  page = await context.newPage()
  if (viewport) await page.setViewportSize(viewport)
  cdpSession = await context.newCDPSession(page)
  if (previous && !previous.isClosed()) {
    void previous.close({ runBeforeUnload: false }).catch(() => {})
  }

  const response = await page.goto(url, { waitUntil: 'commit', timeout: 60_000 })
  if (!response || !response.ok()) {
    throw new Error(`Failed to navigate to ${url}: ${response?.status() ?? 'no response'}`)
  }
}

function editorHash(source: string, config = ROUNDED_FILL_CONFIG, theme = 'salmon'): string {
  return Buffer.from(JSON.stringify({ source, theme, config }), 'utf8').toString('base64')
}

async function gotoEditorWithWarmFonts(query: string, hash: string): Promise<void> {
  await gotoApp(`${BASE}/editor?empty=1`)
  await page.waitForSelector('#code-editor', { timeout: 30_000 })
  await page.evaluate(() => document.fonts?.ready)
  await gotoApp(`${BASE}/editor${query}#${hash}`)
  await waitForEditorRender(60_000)
  await page.evaluate(() => document.fonts?.ready)
}

async function comparePngScreenshots(
  currentPath: string,
  baselinePath: string,
  channelThreshold = 5,
): Promise<{ width: number; height: number; diffPixels: number; totalPixels: number; diffRatio: number; maxChannelDelta: number; dimensionMismatch: boolean }> {
  const [currentBytes, baselineBytes] = await Promise.all([
    Bun.file(currentPath).arrayBuffer(),
    Bun.file(baselinePath).arrayBuffer(),
  ])
  const currentDataUrl = `data:image/png;base64,${Buffer.from(currentBytes).toString('base64')}`
  const baselineDataUrl = `data:image/png;base64,${Buffer.from(baselineBytes).toString('base64')}`

  return page.evaluate(
    async ({ currentDataUrl, baselineDataUrl, channelThreshold }) => {
      function loadImage(src: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error('Failed to load screenshot image'))
          img.src = src
        })
      }

      const [current, baseline] = await Promise.all([
        loadImage(currentDataUrl),
        loadImage(baselineDataUrl),
      ])
      if (current.width !== baseline.width || current.height !== baseline.height) {
        return {
          width: current.width,
          height: current.height,
          diffPixels: Number.POSITIVE_INFINITY,
          totalPixels: 0,
          diffRatio: Number.POSITIVE_INFINITY,
          maxChannelDelta: Number.POSITIVE_INFINITY,
          dimensionMismatch: true,
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width = current.width
      canvas.height = current.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(current, 0, 0)
      const currentData = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(baseline, 0, 0)
      const baselineData = ctx.getImageData(0, 0, canvas.width, canvas.height).data

      let diffPixels = 0
      let maxChannelDelta = 0
      for (let i = 0; i < currentData.length; i += 4) {
        const dr = Math.abs(currentData[i]! - baselineData[i]!)
        const dg = Math.abs(currentData[i + 1]! - baselineData[i + 1]!)
        const db = Math.abs(currentData[i + 2]! - baselineData[i + 2]!)
        const da = Math.abs(currentData[i + 3]! - baselineData[i + 3]!)
        const maxDelta = Math.max(dr, dg, db, da)
        maxChannelDelta = Math.max(maxChannelDelta, maxDelta)
        if (maxDelta > channelThreshold) diffPixels++
      }

      const totalPixels = current.width * current.height
      return {
        width: current.width,
        height: current.height,
        diffPixels,
        totalPixels,
        diffRatio: diffPixels / totalPixels,
        maxChannelDelta,
        dimensionMismatch: false,
      }
    },
    { currentDataUrl, baselineDataUrl, channelThreshold },
  )
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: ReturnType<typeof Bun.serve>

beforeAll(async () => {
  // The live editor is built by scripts/site/editor.ts — the same generator the
  // Cloudflare site uses — so these tests exercise the shipped editor. Build the
  // standalone editor.html if it isn't already present.
  const editorPath = join(ROOT, 'editor.html')
  if (!(await Bun.file(editorPath).exists())) {
    const proc = Bun.spawn(['bun', 'run', join(ROOT, 'scripts/site/editor.ts')], {
      cwd: ROOT, stdout: 'inherit', stderr: 'inherit',
    })
    await proc.exited
  }

  // Ensure screenshot dir exists
  await Bun.spawn(['mkdir', '-p', SCREENSHOT_DIR]).exited

  // Serve the editor at /editor plus root public/ assets.
  const served = serveWithAvailablePort({
    preferredPort: PREFERRED_PORT,
    async fetch(req) {
      const url = new URL(req.url)
      const route = url.pathname === '/editor' ? 'editor.html' : url.pathname
      const filePath = join(ROOT, route)
      const file = Bun.file(filePath)
      if (await file.exists()) return new Response(file)
      const pubFile = Bun.file(join(ROOT, 'public', url.pathname))
      if (await pubFile.exists()) return new Response(pubFile)
      return new Response('Not found', { status: 404 })
    },
  })
  server = served.server
  BASE = served.base

  // Launch Playwright browser and warm up the editor.
  browser = await chromium.launch()
  context = await browser.newContext()
  page = await context.newPage()
  cdpSession = await context.newCDPSession(page)

  await gotoApp(`${BASE}/editor`)
  await waitForEditorRender(60_000)
}, 120_000)

afterAll(async () => {
  // Cleanup: reset to default theme before closing
  try {
    await page.evaluate(() => {
      localStorage.removeItem('mermaid-theme')
      localStorage.removeItem('bm-editor-theme')
    })
  } catch {}

  try { await browser?.close() } catch {}
  server?.stop()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('browser: live editor integration', () => {

  it('opens /editor to the default loop diagram on the Kiln Stone chrome', async () => {
    await gotoApp(`${BASE}/editor`)
    await page.waitForSelector('#code-editor', { timeout: 30_000 })
    await waitForEditorRender(60_000)

    // The editor opens with its own parse -> verify -> serialize loop already
    // rendered, so the loop "just works" on first paint instead of a blank canvas.
    expect(await page.inputValue('#code-editor')).toContain('flowchart TD')
    expect(await page.evaluate(() => document.querySelector('#preview-inner svg') !== null)).toBe(true)
    // Chrome is the Kiln Stone brand (light), independent of the diagram theme.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--t-bg').trim())).toBe('#F8F4F0')
    // The default diagram theme is applied automatically, so nothing is persisted.
    expect(await page.evaluate(() => localStorage.getItem('bm-editor-theme'))).toBeNull()
  }, 60_000)

  it('mobile editor uses pane tabs instead of clipping the workspace', async () => {
    // Restore the desktop viewport even on failure — gotoApp carries the
    // previous page's viewport forward, so a leak here cascades into every
    // later test that expects the desktop layout.
    try {
      await page.setViewportSize({ width: 390, height: 844 })
      await gotoApp(`${BASE}/editor`)
      // Mobile first-run opens on Preview so the rendered diagram and the
      // verify bar are the first thing a phone visitor sees.
      await page.waitForSelector('#panel-right', { state: 'visible', timeout: 30_000 })

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      expect(await page.locator('#mode-preview').isVisible()).toBe(true)
      expect(await page.evaluate(() => getComputedStyle(document.getElementById('panel-left')!).display)).toBe('none')
      expect(await page.evaluate(() => getComputedStyle(document.getElementById('panel-right')!).display)).toBe('flex')

      await page.click('#mode-source')
      expect(await page.evaluate(() => getComputedStyle(document.getElementById('panel-left')!).display)).toBe('flex')
      await page.waitForSelector('#code-editor', { state: 'visible', timeout: 30_000 })
    } finally {
      await page.setViewportSize({ width: 1280, height: 720 })
    }
  }, 60_000)

  it('retargets preview zoom and pauses a focused toast without blocking its eventual dismissal', async () => {
    await gotoApp(`${BASE}/editor`)
    await page.waitForSelector('#code-editor', { timeout: 30_000 })
    await waitForEditorRender(60_000)

    await page.click('#zoom-label')
    await page.waitForFunction(() => document.getElementById('zoom-label')?.textContent === '100%', undefined, { timeout: 10_000 })
    await page.click('#zoom-in-btn')
    await page.click('#zoom-in-btn')
    await page.click('#zoom-in-btn')
    await page.waitForFunction(() => document.getElementById('zoom-label')?.textContent === '195%', undefined, { timeout: 10_000 })

    await page.click('#pan-btn')
    await page.evaluate(() => {
      const body = document.getElementById('preview-body')!
      const pointer = (type: string, pointerId: number, clientX: number, clientY: number) => body.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId, pointerType: 'touch', clientX, clientY,
      }))
      pointer('pointerdown', 1, 120, 160)
      pointer('pointerdown', 2, 220, 160)
      pointer('pointermove', 2, 300, 160)
      pointer('pointerup', 2, 300, 160)
      pointer('pointerup', 1, 120, 160)
    })
    await page.waitForFunction(() => Number.parseInt(document.getElementById('zoom-label')?.textContent || '0', 10) > 195, undefined, { timeout: 10_000 })

    // The generated editor runs from a local HTTP origin, so clipboard access
    // intentionally fails and exercises the same user-visible toast path.
    await page.click('#copy-text-output-btn')
    await page.locator('#toast.show').waitFor({ state: 'visible', timeout: 10_000 })
    await page.locator('#toast').focus()
    // Programmatic activation preserves focus on the status node, exercising
    // replacement while a reader is still holding the pause.
    await page.evaluate(() => (document.getElementById('copy-text-output-btn') as HTMLButtonElement).click())
    await new Promise((resolve) => setTimeout(resolve, 150))
    await new Promise((resolve) => setTimeout(resolve, 2600))
    expect(await page.locator('#toast').evaluate((el) => el.classList.contains('show'))).toBe(true)
    await page.locator('#zoom-label').focus()
    await page.waitForFunction(() => !document.getElementById('toast')?.classList.contains('show'), undefined, { timeout: 4_000 })

    await page.click('#export-chevron-btn')
    await page.keyboard.press('Escape')
    expect(await page.locator('#export-dropdown').evaluate((el) => ({ inert: (el as HTMLElement).inert, closing: el.classList.contains('closing') }))).toEqual({ inert: true, closing: true })
    await page.waitForFunction(() => !document.getElementById('export-dropdown')?.classList.contains('closing'), undefined, { timeout: 1_000 })
  }, 60_000)

  it('lets an ordinary pointer grab preview momentum and suppresses coast under reduced motion', async () => {
    async function preparePannablePreview() {
      await gotoApp(`${BASE}/editor`)
      await page.waitForSelector('#code-editor', { timeout: 30_000 })
      await waitForEditorRender(60_000)
      await page.click('#zoom-label')
      await page.waitForFunction(() => document.getElementById('zoom-label')?.textContent === '100%', undefined, { timeout: 10_000 })
      for (let i = 0; i < 6; i++) await page.click('#zoom-in-btn')
      await page.waitForFunction(() => Number.parseInt(document.getElementById('zoom-label')?.textContent || '0', 10) >= 380, undefined, { timeout: 10_000 })
      await page.click('#pan-btn')
    }
    async function flingLeft(stationaryBeforeReleaseMs = 0) {
      const box = await page.locator('#preview-body').boundingBox()
      expect(box).not.toBeNull()
      const x = box!.x + box!.width * 0.6
      const y = box!.y + box!.height * 0.5
      await page.mouse.move(x, y)
      await page.mouse.down()
      await new Promise((resolve) => setTimeout(resolve, 24))
      await page.mouse.move(x - 140, y)
      if (stationaryBeforeReleaseMs) await new Promise((resolve) => setTimeout(resolve, stationaryBeforeReleaseMs))
      await page.mouse.up()
    }

    await preparePannablePreview()
    await flingLeft()
    await new Promise((resolve) => setTimeout(resolve, 40))
    const beforeGrab = await page.locator('#preview-body').evaluate((el) => (el as HTMLElement).scrollLeft)
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(await page.locator('#preview-body').evaluate((el) => (el as HTMLElement).scrollLeft)).toBeGreaterThan(beforeGrab)
    // A release after a deliberate stationary hold must not reuse old drag velocity.
    await preparePannablePreview()
    await flingLeft(150)
    const afterStationaryRelease = await page.locator('#preview-body').evaluate((el) => (el as HTMLElement).scrollLeft)
    await new Promise((resolve) => setTimeout(resolve, 160))
    expect(await page.locator('#preview-body').evaluate((el) => (el as HTMLElement).scrollLeft)).toBe(afterStationaryRelease)

    // Start a fresh coast and grab it promptly, before it can reach its scroll bound.
    await preparePannablePreview()
    await flingLeft()
    await new Promise((resolve) => setTimeout(resolve, 16))
    await page.click('#pan-btn')
    const box = await page.locator('#preview-body').boundingBox()
    await page.mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height * 0.5)
    await page.mouse.down()
    await page.mouse.up()
    const afterGrab = await page.locator('#preview-body').evaluate((el) => (el as HTMLElement).scrollLeft)
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(await page.locator('#preview-body').evaluate((el) => (el as HTMLElement).scrollLeft)).toBe(afterGrab)

    try {
      await preparePannablePreview()
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await flingLeft()
      const afterRelease = await page.locator('#preview-body').evaluate((el) => (el as HTMLElement).scrollLeft)
      await new Promise((resolve) => setTimeout(resolve, 160))
      expect(await page.locator('#preview-body').evaluate((el) => (el as HTMLElement).scrollLeft)).toBe(afterRelease)
    } finally {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
    }
  }, 60_000)

  it('commits button zoom immediately under reduced motion', async () => {
    await gotoApp(`${BASE}/editor`)
    await page.waitForSelector('#code-editor', { timeout: 30_000 })
    await waitForEditorRender(60_000)
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.click('#zoom-label')
      await page.waitForFunction(() => document.getElementById('zoom-label')?.textContent === '100%', undefined, { timeout: 10_000 })
      await page.click('#zoom-in-btn')
      expect(await page.locator('#zoom-label').textContent()).toBe('125%')
      expect(await page.locator('#preview-inner svg').evaluate((el) => ({ transform: (el as HTMLElement).style.transform, width: (el as HTMLElement).style.width }))).toEqual({ transform: '', width: expect.stringMatching(/px$/) })
    } finally {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
    }
  }, 60_000)

  it('empty-state CTA opens a persistent examples sidebar', async () => {
    await gotoApp(`${BASE}/editor`)
    await page.waitForSelector('#code-editor', { timeout: 30_000 })

    // The editor opens with the default loop diagram; clearing the source drops
    // it to the blank-canvas empty state, which surfaces the load-example CTA.
    await page.fill('#code-editor', '')
    await page.waitForSelector('[data-action="load-example"]', { state: 'visible', timeout: 30_000 })

    expect(await page.evaluate(() => document.getElementById('examples-sidebar')?.classList.contains('open'))).toBe(false)
    await page.click('[data-action="load-example"]')
    await page.waitForFunction(
      () => document.getElementById('examples-sidebar')?.classList.contains('open') === true,
      undefined,
      { timeout: 10_000 },
    )

    await page.waitForFunction(
      () => (document.getElementById('examples-sidebar')?.getBoundingClientRect().width ?? 0) >= 280,
      undefined,
      { timeout: 10_000 },
    )
    const sidebarBox = await page.locator('#examples-sidebar').boundingBox()
    expect(sidebarBox).not.toBeNull()
    expect(sidebarBox!.width).toBeGreaterThanOrEqual(280)

    await page.click('#examples-sidebar .example-dropdown-item[data-example="flowchart-basic"]')
    await waitForEditorRender(60_000)
    expect(await page.inputValue('#code-editor')).toContain('flowchart TD')
    // Picking an example closes the sidebar so the rendered result is unobstructed.
    expect(await page.evaluate(() => document.getElementById('examples-sidebar')?.classList.contains('open'))).toBe(false)
  }, 120_000)

  it('opens /editor and renders fork-added diagram families through the bundled renderer', async () => {
    await gotoApp(`${BASE}/editor`)
    await page.waitForSelector('#code-editor', { timeout: 30_000 })

    const cases = [
      {
        source: `architecture-beta
  group app(cloud)[Application]
  service api(server)[Public API] in app
  service db(database)[Postgres] in app
  api:B --> T:db`,
        markers: ['Public API', 'Postgres', 'architecture-group'],
      },
      {
        source: `timeline
  title Product roadmap
  section Foundation
  2024 : Private alpha
       : Public beta`,
        markers: ['Product roadmap', 'Private alpha', 'timeline-period'],
      },
      {
        source: `journey
  title Onboarding
  section Discover
    Read docs: 4: User
    Try editor: 5: User, Developer`,
        markers: ['Onboarding', 'Try editor', 'journey-task'],
      },
      {
        source: `xychart-beta
  title "Editor Sales"
  x-axis [Widgets, Gadgets, Gizmos]
  bar [150, 230, 180]
  line [120, 210, 200]`,
        markers: ['Editor Sales', 'xychart-bar', 'xychart-line'],
      },
    ]

    for (const testCase of cases) {
      await page.fill('#code-editor', testCase.source)
      await page.waitForFunction(
        (markers: string[]) => {
          const html = document.querySelector('#preview-inner svg')?.outerHTML ?? ''
          return markers.every(marker => html.includes(marker))
        },
        testCase.markers,
        { timeout: 60_000 },
      )
      expect(await page.evaluate(
        (markers: string[]) => {
          const html = document.querySelector('#preview-inner svg')?.outerHTML ?? ''
          return markers.every(marker => html.includes(marker))
        },
        testCase.markers,
      )).toBe(true)
    }
  }, 120_000)

  it('uses local theme registry entries in the editor theme dropdown', async () => {
    await gotoApp(`${BASE}/editor`)
    await page.waitForSelector('#code-editor', { timeout: 30_000 })
    await page.fill('#code-editor', 'graph TD\n  A[Theme] --> B[Render]')
    await waitForEditorRender(60_000)

    const salmonBg = await page.evaluate(
      () => (window as unknown as { __mermaid: { THEMES: Record<string, { bg: string }> } })
        .__mermaid.THEMES.salmon.bg,
    )

    await page.click('#theme-dropdown-btn')
    await page.click('.theme-dropdown-item[data-theme="salmon"]')
    // Selecting a diagram theme recolors the rendered SVG, not the editor chrome:
    // the SVG picks up salmon's --bg while --t-bg stays the Paper brand chrome.
    await page.waitForFunction(
      (bg: string) => (document.querySelector('#preview-inner svg')?.getAttribute('style') ?? '').includes('--bg: ' + bg),
      salmonBg,
      { timeout: 30_000 },
    )
    await waitForEditorRender(60_000)

    expect(await page.evaluate(() => localStorage.getItem('bm-editor-theme'))).toBe('salmon')
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--t-bg').trim())).toBe('#F8F4F0')
  }, 120_000)

  it('examples sidebar keeps the selected theme and exposes blank reset without a floating source toolbar', async () => {
    await gotoApp(`${BASE}/editor`)
    await page.waitForSelector('#code-editor', { timeout: 30_000 })

    await page.click('#theme-dropdown-btn')
    await page.click('.theme-dropdown-item[data-theme="salmon"]')
    // The diagram recolors to salmon; the editor chrome stays Kiln Stone.
    await page.waitForFunction(
      () => (document.querySelector('#preview-inner svg')?.getAttribute('style') ?? '').includes('--bg: #FFFBF5'),
      undefined,
      { timeout: 30_000 },
    )

    expect(await page.locator('#source-toolbar').count()).toBe(0)
    expect(await page.locator('#example-dropdown-btn').count()).toBe(0)
    expect(await page.locator('#copy-source-btn').count()).toBe(1)

    await page.click('#export-chevron-btn')
    await page.waitForFunction(
      () => document.getElementById('export-dropdown')?.classList.contains('open') === true,
      undefined,
      { timeout: 10_000 },
    )
    expect(await page.locator('#copy-source-btn').isVisible()).toBe(true)
    // The editor opened with the default loop diagram rendered, so PNG export is enabled.
    expect(await page.locator('#export-png-btn').isDisabled()).toBe(false)

    await page.click('#examples-sidebar-btn')
    await page.waitForFunction(
      () => document.getElementById('examples-sidebar')?.classList.contains('open') === true,
      undefined,
      { timeout: 10_000 },
    )

    const diagramTypes = await page.evaluate(() => Array.from(
      new Set(Array.from(document.querySelectorAll('#examples-sidebar .example-dropdown-item'))
        .map(el => (el as HTMLElement).dataset.diagram)
        .filter(Boolean)),
    ).sort())

    expect(diagramTypes).toEqual(BUILTIN_FAMILY_METADATA.map(f => f.editorDiagramType).sort())

    const sidebarBox = await page.locator('#examples-sidebar').boundingBox()
    expect(sidebarBox).not.toBeNull()
    expect(sidebarBox!.width).toBeGreaterThanOrEqual(280)

    await page.click('#examples-sidebar .example-dropdown-item[data-example="state-basic"]')
    await page.waitForFunction(
      () => (document.querySelector('#preview-inner svg')?.outerHTML ?? '').includes('Processing'),
      undefined,
      { timeout: 60_000 },
    )
    expect(await page.inputValue('#code-editor')).toContain('stateDiagram-v2')
    // Chrome stays Kiln Stone; the example kept the salmon diagram theme (not overridden).
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--t-bg').trim())).toBe('#F8F4F0')
    expect(await page.evaluate(() => localStorage.getItem('bm-editor-theme'))).toBe('salmon')

    // Selecting the example closed the sidebar; re-open it to reach the blank reset.
    await page.click('#examples-sidebar-btn')
    await page.waitForFunction(
      () => document.getElementById('examples-sidebar')?.classList.contains('open') === true,
      undefined,
      { timeout: 10_000 },
    )
    await page.click('#examples-sidebar [data-action="clear-editor"]')
    expect(await page.inputValue('#code-editor')).toBe('')
    expect(await page.evaluate(() => document.getElementById('status-text')?.textContent)).toBe('Ready')
    expect(await page.evaluate(() => document.querySelector('#preview-inner svg') === null)).toBe(true)
  }, 120_000)

  it('topbar button dimensions do not shift when toggling day/dark mode', async () => {
    // #dark-light-btn is hidden below 760px; pin a desktop viewport so a prior
    // mobile test can't leave it hidden here.
    await page.setViewportSize({ width: 1280, height: 720 })
    await gotoApp(`${BASE}/editor`)
    await page.waitForSelector('#code-editor', { timeout: 30_000 })

    const before = await page.locator('#dark-light-btn').boundingBox()
    const themeBefore = await page.locator('#theme-dropdown-btn').boundingBox()
    await page.click('#dark-light-btn')
    const after = await page.locator('#dark-light-btn').boundingBox()
    const themeAfter = await page.locator('#theme-dropdown-btn').boundingBox()

    expect(before).not.toBeNull()
    expect(after).not.toBeNull()
    expect(themeBefore).not.toBeNull()
    expect(themeAfter).not.toBeNull()
    expect(after!.width).toBe(before!.width)
    expect(after!.height).toBe(before!.height)
    expect(themeAfter!.width).toBe(themeBefore!.width)
    expect(themeAfter!.height).toBe(themeBefore!.height)
  }, 60_000)

  it('loads source/config examples without overriding the selected theme', async () => {
    await gotoApp(`${BASE}/editor`)
    await page.waitForSelector('#code-editor', { timeout: 30_000 })
    // The chrome bg must not change with the diagram theme; capture it up front so
    // the assertion holds whether or not a prior test left the editor in dark mode.
    const chromeBg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--t-bg').trim())

    await page.click('#theme-dropdown-btn')
    await page.click('.theme-dropdown-item[data-theme="dracula"]')
    // Diagram theme becomes dracula (recolors the SVG); chrome stays Kiln Stone.
    await page.waitForFunction(
      () => (document.querySelector('#preview-inner svg')?.getAttribute('style') ?? '').includes('--bg: #282a36'),
      undefined,
      { timeout: 30_000 },
    )

    await page.click('#examples-sidebar-btn')
    await page.click('#examples-sidebar .example-dropdown-item[data-example="xychart-basic"]')

    await page.waitForFunction(
      () => {
        const svg = document.querySelector('#preview-inner svg')
        const html = svg?.outerHTML ?? ''
        return html.includes('Weekly renders')
          && html.includes('xychart-bar')
          && (svg?.getAttribute('style') ?? '').includes('--bg: #282a36')
      },
      undefined,
      { timeout: 60_000 },
    )

    // Source, config, and theme updates share one compressed hash but are
    // scheduled independently by the editor. Wait for the semantic hash state,
    // not merely the earlier SVG paint, so this test cannot race a config write.
    await page.waitForFunction(async () => {
      try {
        const hash = window.location.hash.slice(1)
        let state: { config?: { interactive?: boolean } | null; theme?: string }
        if (hash.startsWith('deflate:')) {
          let b64 = hash.slice('deflate:'.length).replace(/-/g, '+').replace(/_/g, '/')
          while (b64.length % 4) b64 += '='
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
          const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
          state = JSON.parse(await new Response(stream).text())
        } else {
          state = JSON.parse(decodeURIComponent(escape(atob(hash))))
        }
        return state.config?.interactive === true && state.theme === 'dracula'
      } catch {
        return false
      }
    }, undefined, { timeout: 30_000 })

    const hashState = await page.evaluate(async () => {
      // Mirrors sharing.js decodeSource: new hashes are deflate:-prefixed
      // base64url(deflate-raw); legacy hashes are plain base64.
      const hash = window.location.hash.slice(1)
      if (hash.startsWith('deflate:')) {
        let b64 = hash.slice('deflate:'.length).replace(/-/g, '+').replace(/_/g, '/')
        while (b64.length % 4) b64 += '='
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
        return JSON.parse(await new Response(stream).text())
      }
      return JSON.parse(decodeURIComponent(escape(atob(hash))))
    })

    expect(hashState.config).toMatchObject({ interactive: true })
    expect(hashState.config.style).toBeUndefined()
    expect(hashState.theme).toBe('dracula')
    // The diagram keeps the dracula theme; the editor chrome is unchanged by it.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--t-bg').trim())).toBe(chromeBg)
    expect(await page.evaluate(() => localStorage.getItem('bm-editor-theme'))).toBe('dracula')
  }, 120_000)

})

describe('browser: visual regression', () => {

  it('architecture rounded fills match screenshot baseline without decorative rails', async () => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await gotoEditorWithWarmFonts('?visual=architecture-rounded-fill', editorHash(ARCHITECTURE_ROUNDED_FILL_SOURCE))
    await page.waitForFunction(
      () => {
        const svg = document.querySelector('#preview-inner svg')
        return svg !== null
          && svg.querySelectorAll('.architecture-group-band').length === 2
          && svg.querySelectorAll('.architecture-group-outline').length === 2
          && svg.querySelectorAll('.architecture-service-outline').length === 3
      },
      undefined,
      { timeout: 60_000 },
    )
    await page.evaluate(() => document.fonts?.ready)

    const svgHtml = await page.locator('#preview-inner svg').evaluate(el => el.outerHTML)
    expect(svgHtml).toContain('<path class="architecture-group-band"')
    expect(svgHtml).toContain('<rect class="architecture-group-outline"')
    expect(svgHtml).toContain('<rect class="architecture-service-outline"')
    expect(svgHtml).not.toContain('architecture-service-accent')
    expect(svgHtml).not.toContain('architecture-icon-bg')
    expect(svgHtml).not.toContain('architecture-icon-fill')
    expect(svgHtml).not.toContain('<rect class="architecture-group-band"')

    const currentPath = join(SCREENSHOT_DIR, 'current-architecture-rounded-fill.png')
    const baselinePath = join(SCREENSHOT_DIR, 'baseline-architecture-rounded-fill.png')
    await page.locator('#preview-inner svg').screenshot({ path: currentPath, animations: 'disabled' })

    if (!(await Bun.file(baselinePath).exists())) {
      if (process.env.UPDATE_BASELINES) {
        await Bun.write(baselinePath, Bun.file(currentPath))
        console.log('  Created baseline: baseline-architecture-rounded-fill.png')
        return
      }
      throw new Error(
        'Missing baseline screenshot: baseline-architecture-rounded-fill.png. ' +
        'Run with UPDATE_BASELINES=1 to create it.',
      )
    }

    const diff = await comparePngScreenshots(currentPath, baselinePath)
    expect(diff.dimensionMismatch).toBe(false)
    expect(diff.diffRatio).toBeLessThanOrEqual(ROUNDED_FILL_SCREENSHOT_MAX_DIFF)
  }, 120_000)

  it('rounded header fills and slop-free cards match screenshot baselines', async () => {
    await page.setViewportSize({ width: 1280, height: 720 })
    const cases = [
      {
        name: 'flowchart-rounded-fill',
        source: `flowchart TD
  subgraph edge[Edge Layer]
    web[Web App]
  end
  subgraph core[Core Services]
    api[API]
    db[(Postgres)]
  end
  web --> api
  api --> db`,
        required: ['<g class="subgraph" data-id="edge"', '<path d="M', 'A10,10'],
        forbidden: ['rx="18" ry="18" fill="var(--_group-hdr)"'],
      },
      {
        name: 'class-rounded-fill',
        source: `classDiagram
  class WebApp {
    +render()
    +fetchData()
  }
  class ApiService {
    +request()
  }
  WebApp --> ApiService : calls`,
        required: ['<g class="class-node"', '<path d="M', 'A10,10'],
        forbidden: ['rx="16" ry="16" fill="var(--_group-hdr)"'],
      },
      {
        name: 'er-rounded-fill',
        source: `erDiagram
  CUSTOMER {
    string id PK
    string name
  }
  ORDER {
    string id PK
    string customer_id FK
  }
  CUSTOMER ||--o{ ORDER : places`,
        required: ['<g class="entity"', '<path d="M', 'A10,10'],
        forbidden: ['rx="16" ry="16" fill="var(--_group-hdr)"'],
      },
      {
        name: 'journey-rounded-fill',
        source: `journey
  title Product journey
  section Discover
    Try editor: 5: User
  section Deliver
    Deploy fix: 4: Engineer`,
        required: [
          '<rect class="journey-section-label-band journey-section-band-',
          '<line class="journey-baseline"',
          '<g class="journey-score-marker"',
        ],
        forbidden: ['journey-task-accent'],
      },
      {
        name: 'timeline-rounded-fill',
        source: `timeline
  title Product roadmap
  section Build
  2024 : Alpha
       : Beta
  section Launch
  2025 : GA`,
        required: ['<path class="timeline-section-band"'],
        forbidden: ['<rect class="timeline-section-band"', 'timeline-event-accent'],
      },
    ]

    for (const testCase of cases) {
      await gotoEditorWithWarmFonts(`?visual=${encodeURIComponent(testCase.name)}`, editorHash(testCase.source))
      await page.evaluate(() => document.fonts?.ready)
      const svgHtml = await page.locator('#preview-inner svg').evaluate(el => el.outerHTML)
      for (const snippet of testCase.required) expect(svgHtml).toContain(snippet)
      for (const snippet of testCase.forbidden) expect(svgHtml).not.toContain(snippet)

      const currentPath = join(SCREENSHOT_DIR, `current-${testCase.name}.png`)
      const baselinePath = join(SCREENSHOT_DIR, `baseline-${testCase.name}.png`)
      await page.locator('#preview-inner svg').screenshot({ path: currentPath, animations: 'disabled' })

      if (!(await Bun.file(baselinePath).exists())) {
        if (process.env.UPDATE_BASELINES) {
          await Bun.write(baselinePath, Bun.file(currentPath))
          console.log(`  Created baseline: baseline-${testCase.name}.png`)
          continue
        }
        throw new Error(
          `Missing baseline screenshot: baseline-${testCase.name}.png. ` +
          'Run with UPDATE_BASELINES=1 to create it.',
        )
      }

      const diff = await comparePngScreenshots(currentPath, baselinePath)
      expect(diff.dimensionMismatch).toBe(false)
      expect(diff.diffRatio).toBeLessThanOrEqual(ROUNDED_FILL_SCREENSHOT_MAX_DIFF)
    }
  }, 240_000)
})
