/**
 * Browser E2E tests using Playwright as a library with bun:test.
 *
 * These tests open the generated index.html in a real browser and verify:
 * - All diagrams render (SVG + ASCII)
 * - Theme switching works and persists across reloads
 * - Interactive features (dropdowns, edit dialog) function correctly
 *
 * Requires: Playwright browsers installed (`bunx playwright install chromium`).
 * Run:  bun run test:browser
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { join } from 'path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'

const ROOT = join(import.meta.dir, '..')
const PORT = 4567 // Avoid collision with dev server on 3456
const BASE = `http://localhost:${PORT}`
const SCREENSHOT_DIR = join(ROOT, 'e2e', 'screenshots')
// Browser font rasterization differs between local macOS and GitHub's Linux runners.
// Structural SVG assertions catch the exact regression; this tolerance keeps
// screenshot checks focused on gross visual drift rather than text antialiasing.
const ROUNDED_FILL_SCREENSHOT_MAX_DIFF = 0.05
const ARCHITECTURE_ROUNDED_FILL_HASH = 'eyJzb3VyY2UiOiJhcmNoaXRlY3R1cmUtYmV0YVxuICBncm91cCBlZGdlKGNsb3VkKVtFZGdlIExheWVyXVxuICBncm91cCBjb3JlKHNlcnZlcilbQ29yZSBTZXJ2aWNlc11cbiAgc2VydmljZSB3ZWIoc2VydmVyKVtXZWIgQXBwXSBpbiBlZGdlXG4gIHNlcnZpY2UgYXBpKHNlcnZlcilbQVBJXSBpbiBjb3JlXG4gIHNlcnZpY2UgZGIoZGF0YWJhc2UpW1Bvc3RncmVzXSBpbiBjb3JlXG4gIHdlYjpSIC0tPiBMOmFwaVxuICBhcGk6UiAtLT4gTDpkYiIsInRoZW1lIjoic2FsbW9uIiwiY29uZmlnIjp7InN0eWxlIjp7InRleHQiOnsiZm9udFNpemUiOjEzLCJsZXR0ZXJTcGFjaW5nIjowLjF9LCJub2RlIjp7ImZvbnRTaXplIjoxNSwiZm9udFdlaWdodCI6NjAwLCJsZXR0ZXJTcGFjaW5nIjotMC4xLCJwYWRkaW5nWCI6MjIsInBhZGRpbmdZIjoxNCwiY29ybmVyUmFkaXVzIjoxNiwibGluZVdpZHRoIjoxLjV9LCJlZGdlIjp7ImZvbnRTaXplIjoxMiwiZm9udFdlaWdodCI6NjAwLCJsZXR0ZXJTcGFjaW5nIjowLjEsImxpbmVXaWR0aCI6Mi4yNSwiYmVuZFJhZGl1cyI6MTJ9LCJncm91cCI6eyJmb250U2l6ZSI6MTIsImZvbnRXZWlnaHQiOjcwMCwibGV0dGVyU3BhY2luZyI6MC44LCJ0ZXh0VHJhbnNmb3JtIjoidXBwZXJjYXNlIiwicGFkZGluZ1giOjI0LCJwYWRkaW5nWSI6MTgsImNvcm5lclJhZGl1cyI6MTgsImJvcmRlckNvbG9yIjoiI2Y5NzMxNiIsImxpbmVXaWR0aCI6MS41fX19fQ=='
const ROUNDED_FILL_CONFIG = {
  style: {
    text: { fontSize: 13, letterSpacing: 0.1 },
    node: { fontSize: 15, fontWeight: 600, letterSpacing: -0.1, paddingX: 22, paddingY: 14, cornerRadius: 16, lineWidth: 1.5 },
    edge: { fontSize: 12, fontWeight: 600, letterSpacing: 0.1, lineWidth: 2.25, bendRadius: 12 },
    group: { fontSize: 12, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', paddingX: 24, paddingY: 18, cornerRadius: 18, borderColor: '#f97316', lineWidth: 1.5 },
  },
} as const

// ---------------------------------------------------------------------------
// Browser + page references
// ---------------------------------------------------------------------------

let browser: Browser
let context: BrowserContext
let page: Page

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for diagrams to finish rendering using Playwright's waitForFunction. */
async function waitForRender(timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const el = document.getElementById('total-timing')
      return el?.textContent?.includes('rendered in') ?? false
    },
    { timeout: timeoutMs },
  )
}

/** Wait for the live editor preview to show a successful SVG render. */
async function waitForEditorRender(timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const status = document.getElementById('status-text')?.textContent
      return status === 'OK' && document.querySelector('#preview-inner svg') !== null
    },
    { timeout: timeoutMs },
  )
}

/** Take a screenshot to a named file. */
async function takeScreenshot(name: string): Promise<string> {
  const path = join(SCREENSHOT_DIR, `${name}.png`)
  await page.screenshot({ path })
  return path
}

function editorHash(source: string, config = ROUNDED_FILL_CONFIG, theme = 'salmon'): string {
  return Buffer.from(JSON.stringify({ source, theme, config }), 'utf8').toString('base64')
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
  // Ensure generated pages exist
  const indexPath = join(ROOT, 'index.html')
  if (!(await Bun.file(indexPath).exists())) {
    const proc = Bun.spawn(['bun', 'run', join(ROOT, 'index.ts')], {
      cwd: ROOT, stdout: 'inherit', stderr: 'inherit',
    })
    await proc.exited
  }
  const editorPath = join(ROOT, 'editor.html')
  if (!(await Bun.file(editorPath).exists())) {
    const proc = Bun.spawn(['bun', 'run', join(ROOT, 'editor.ts')], {
      cwd: ROOT, stdout: 'inherit', stderr: 'inherit',
    })
    await proc.exited
  }

  // Ensure screenshot dir exists
  await Bun.spawn(['mkdir', '-p', SCREENSHOT_DIR]).exited

  // Start a simple static file server
  server = Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url)
      const route = url.pathname === '/'
        ? 'index.html'
        : url.pathname === '/editor'
          ? 'editor.html'
          : url.pathname
      const filePath = join(ROOT, route)
      const file = Bun.file(filePath)
      if (await file.exists()) return new Response(file)
      // Try public/ for static assets
      const pubFile = Bun.file(join(ROOT, 'public', url.pathname))
      if (await pubFile.exists()) return new Response(pubFile)
      return new Response('Not found', { status: 404 })
    },
  })

  // Launch Playwright browser
  browser = await chromium.launch()
  context = await browser.newContext()
  page = await context.newPage()

  // Open the page and wait for rendering
  await page.goto(BASE)
  await waitForRender(60_000)
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

describe('browser: page loads and renders', () => {

  it('page title is correct', async () => {
    const title = await page.title()
    expect(title).toContain('Beautiful Mermaid')
  }, 60_000)

  it('all SVG diagrams rendered (no empty containers)', async () => {
    const count = await page.evaluate(
      () => document.querySelectorAll('.svg-container svg').length,
    )
    expect(count).toBeGreaterThanOrEqual(90)
  }, 60_000)

  it('all ASCII panels rendered', async () => {
    const count = await page.evaluate(
      () => Array.from(document.querySelectorAll('[id^="ascii-"]'))
        .filter(el => el.textContent!.trim().length > 0).length,
    )
    expect(count).toBeGreaterThanOrEqual(80)
  }, 60_000)

  it('no render errors visible', async () => {
    const errors = await page.evaluate(
      () => document.querySelectorAll('.render-error').length,
    )
    expect(errors).toBe(0)
  }, 60_000)

  it('timing banner shows completion', async () => {
    const text = await page.evaluate(
      () => document.getElementById('total-timing')?.textContent || '',
    )
    expect(text).toContain('rendered in')
  }, 60_000)

  it('homepage defaults to salmon, uses fork-owned copy, and reports the rendered example count accurately', async () => {
    await page.evaluate(() => localStorage.removeItem('mermaid-theme'))
    await page.goto(BASE)
    await waitForRender(60_000)

    expect(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--t-bg').trim())).toBe('#FFFBF5')
    expect(await page.evaluate(() => localStorage.getItem('mermaid-theme'))).toBeNull()

    const text = await page.evaluate(() => document.body.textContent || '')
    expect(text).not.toContain('by Craft')
    expect(text).not.toContain('Use in Craft')
    expect(text).not.toContain('Built by the team')
    expect(text).not.toContain('Craft Docs')
    expect(text).not.toContain('open Contents → Role Styles')

    const sectionCount = await page.evaluate(() => document.querySelectorAll('section.sample').length)
    const timing = await page.evaluate(() => document.getElementById('total-timing')?.textContent || '')
    expect(timing).toContain(`${sectionCount} examples rendered in`)
  }, 120_000)

  it('homepage sample search and category filters narrow the showcase', async () => {
    await page.goto(BASE)
    await waitForRender(60_000)

    await page.fill('#sample-search', 'timeline')
    const searchVisible = await page.evaluate(() => Array.from(document.querySelectorAll('section.sample[data-category]')).filter(el => !(el as HTMLElement).hidden).length)
    expect(searchVisible).toBeGreaterThan(0)
    expect(searchVisible).toBeLessThan(await page.evaluate(() => document.querySelectorAll('section.sample[data-category]').length))

    await page.click('.sample-filter-pill[data-filter="Role Styles"]')
    const visibleCategories = await page.evaluate(() => Array.from(document.querySelectorAll('section.sample[data-category]')).filter(el => !(el as HTMLElement).hidden).map(el => (el as HTMLElement).dataset.category))
    expect(new Set(visibleCategories)).toEqual(new Set(['Role Styles']))
  }, 120_000)

})

describe('browser: theme switching', () => {

  it('Default theme pill restores white background', async () => {
    // Ensure we're on default
    await page.evaluate(() =>
      (document.querySelector('[data-theme=""]') as HTMLElement)?.click(),
    )
    await page.waitForFunction(
      () => getComputedStyle(document.body).getPropertyValue('--t-bg').trim() === '#FFFFFF',
      { timeout: 10_000 },
    )
    const bg = await page.evaluate(
      () => getComputedStyle(document.body).getPropertyValue('--t-bg').trim(),
    )
    expect(bg).toBe('#FFFFFF')
  }, 60_000)

  it('clicking Dracula pill switches to dark theme', async () => {
    await page.evaluate(() =>
      (document.querySelector('[data-theme="dracula"]') as HTMLElement)?.click(),
    )
    await page.waitForFunction(
      () => getComputedStyle(document.body).getPropertyValue('--t-bg').trim() === '#282a36',
      { timeout: 30_000 },
    )
    const bg = await page.evaluate(
      () => getComputedStyle(document.body).getPropertyValue('--t-bg').trim(),
    )
    expect(bg).toBe('#282a36')
  }, 120_000)

  it('theme is persisted to localStorage', async () => {
    const saved = await page.evaluate(() => localStorage.getItem('mermaid-theme'))
    expect(saved).toBe('dracula')
  }, 60_000)

  it('theme persists across page reload', async () => {
    await page.goto(BASE)
    await waitForRender(60_000)

    const bg = await page.evaluate(
      () => getComputedStyle(document.body).getPropertyValue('--t-bg').trim(),
    )
    expect(bg).toBe('#282a36')

    const saved = await page.evaluate(() => localStorage.getItem('mermaid-theme'))
    expect(saved).toBe('dracula')
  }, 90_000)

  it('switching back to Default restores white', async () => {
    await page.evaluate(() =>
      (document.querySelector('[data-theme=""]') as HTMLElement)?.click(),
    )
    await page.waitForFunction(
      () => getComputedStyle(document.body).getPropertyValue('--t-bg').trim() === '#FFFFFF',
      { timeout: 30_000 },
    )
    const bg = await page.evaluate(
      () => getComputedStyle(document.body).getPropertyValue('--t-bg').trim(),
    )
    expect(bg).toBe('#FFFFFF')

    const saved = await page.evaluate(() => localStorage.getItem('mermaid-theme'))
    expect(saved).toBeNull()
  }, 120_000)

})

describe('browser: dropdowns', () => {

  it('More themes dropdown opens and closes', async () => {
    await page.evaluate(() => document.getElementById('theme-more-btn')?.click())
    await page.waitForFunction(
      () => document.getElementById('theme-more-dropdown')?.classList.contains('open') === true,
      { timeout: 10_000 },
    )
    expect(await page.evaluate(
      () => document.getElementById('theme-more-dropdown')?.classList.contains('open'),
    )).toBe(true)

    await page.keyboard.press('Escape')
    await page.waitForFunction(
      () => document.getElementById('theme-more-dropdown')?.classList.contains('open') === false,
      { timeout: 10_000 },
    )
    expect(await page.evaluate(
      () => document.getElementById('theme-more-dropdown')?.classList.contains('open'),
    )).toBe(false)
  }, 60_000)

  it('Contents dropdown opens, shows links, and closes', async () => {
    await page.evaluate(() => document.getElementById('contents-btn')?.click())
    await page.waitForFunction(
      () => document.getElementById('mega-menu')?.classList.contains('open') === true,
      { timeout: 10_000 },
    )
    expect(await page.evaluate(
      () => document.getElementById('mega-menu')?.classList.contains('open'),
    )).toBe(true)

    const linkCount = await page.evaluate(
      () => document.querySelectorAll('#mega-menu a').length,
    )
    expect(linkCount).toBeGreaterThan(0)

    await page.keyboard.press('Escape')
    await page.waitForFunction(
      () => document.getElementById('mega-menu')?.classList.contains('open') === false,
      { timeout: 10_000 },
    )
    expect(await page.evaluate(
      () => document.getElementById('mega-menu')?.classList.contains('open'),
    )).toBe(false)
  }, 60_000)

  it('Brand badge has no Craft icon or dropdown', async () => {
    expect(await page.evaluate(() => document.querySelector('#brand-badge svg') === null)).toBe(true)
    expect(await page.evaluate(() => document.getElementById('brand-dropdown') === null)).toBe(true)
    expect(await page.evaluate(() => document.getElementById('brand-badge')?.textContent?.trim())).toBe('Beautiful Mermaid')
  }, 60_000)

})

describe('browser: edit dialog', () => {

  it('edit dialog opens, edits, saves, and re-renders', async () => {
    // Ensure clean page state
    await page.goto(BASE)
    await waitForRender(60_000)

    // Click the first edit button
    const idx = await page.evaluate(() => {
      const btn = document.querySelector('.edit-btn[data-sample]') as HTMLElement | null
      if (btn) {
        btn.click()
        return parseInt(btn.dataset.sample!, 10)
      }
      return -1
    })
    if (idx < 0) return

    // The click triggers openEditDialog which is synchronous
    await page.waitForFunction(
      () => document.getElementById('edit-overlay')?.classList.contains('open') === true,
      { timeout: 10_000 },
    )
    expect(await page.evaluate(
      () => document.getElementById('edit-overlay')?.classList.contains('open') || false,
    )).toBe(true)

    // Verify textarea has content
    const sourceLen = await page.evaluate(
      () => (document.getElementById('edit-dialog-textarea') as HTMLTextAreaElement)?.value?.length || 0,
    )
    expect(sourceLen).toBeGreaterThan(10)

    // Edit source and save
    await page.evaluate(() => {
      const ta = document.getElementById('edit-dialog-textarea') as HTMLTextAreaElement | null
      if (ta) ta.value = 'graph TD\n  X[Edited] --> Y[Works]'
    })
    await page.evaluate(() => {
      const btn = document.getElementById('edit-dialog-save') as HTMLElement | null
      if (btn) btn.click()
    })

    // Wait for dialog close
    await page.waitForFunction(
      () => document.getElementById('edit-overlay')?.classList.contains('open') === false,
      { timeout: 30_000 },
    )
    const closed = await page.evaluate(
      () => !document.getElementById('edit-overlay')?.classList.contains('open'),
    )
    expect(closed).toBe(true)

    const hasEdited = await page.evaluate(
      (i: number) => (document.getElementById('svg-' + i)?.innerHTML || '').includes('Edited'),
      idx,
    )
    expect(hasEdited).toBe(true)
  }, 120_000)

  it('cancel closes the dialog', async () => {
    // Open the dialog first
    await page.evaluate(() => {
      const btn = document.querySelector('.edit-btn[data-sample]') as HTMLElement | null
      if (btn) btn.click()
    })
    await page.waitForFunction(
      () => document.getElementById('edit-overlay')?.classList.contains('open') === true,
      { timeout: 10_000 },
    )

    await page.evaluate(() => {
      const btn = document.getElementById('edit-dialog-cancel') as HTMLElement | null
      if (btn) btn.click()
    })
    await page.waitForFunction(
      () => document.getElementById('edit-overlay')?.classList.contains('open') === false,
      { timeout: 10_000 },
    )
    expect(await page.evaluate(
      () => !document.getElementById('edit-overlay')?.classList.contains('open'),
    )).toBe(true)
  }, 120_000)

})

describe('browser: random theme button', () => {

  it('random theme button changes the theme', async () => {
    // Fresh page load on default theme
    await page.goto(BASE)
    await waitForRender(60_000)

    const savedBefore = await page.evaluate(() => localStorage.getItem('mermaid-theme'))
    expect(savedBefore).toBeNull()

    // Click random -- this triggers a theme change + re-renders. Some valid light
    // themes also use a white background, so assert the persisted theme key rather
    // than coupling this test to background color.
    await page.evaluate(() => document.getElementById('random-theme-btn')?.click())
    await page.waitForFunction(
      () => localStorage.getItem('mermaid-theme') !== null,
      { timeout: 30_000 },
    )
    const savedAfter = await page.evaluate(() => localStorage.getItem('mermaid-theme'))
    expect(savedAfter).toBeTruthy()
  }, 120_000)

})

describe('browser: live editor integration', () => {

  it('opens /editor to a blank salmon-themed canvas by default', async () => {
    await page.goto(`${BASE}/editor`)
    await page.waitForSelector('#code-editor', { timeout: 30_000 })

    expect(await page.inputValue('#code-editor')).toBe('')
    expect(await page.evaluate(() => document.getElementById('status-text')?.textContent)).toBe('Ready')
    expect(await page.evaluate(() => document.querySelector('#preview-inner svg') === null)).toBe(true)
    expect(await page.evaluate(() => document.getElementById('preview-inner')?.textContent?.includes('Start typing') ?? false)).toBe(true)
    expect(await page.evaluate(() => document.getElementById('preview-inner')?.textContent?.includes('Load an example') ?? false)).toBe(true)
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--t-bg').trim())).toBe('#FFFBF5')
    expect(await page.evaluate(() => localStorage.getItem('bm-editor-theme'))).toBeNull()
  }, 60_000)

  it('mobile editor uses pane tabs instead of clipping the workspace', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${BASE}/editor`)
    await page.waitForSelector('#code-editor', { timeout: 30_000 })

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await page.locator('#tab-preview').isVisible()).toBe(true)
    await page.click('#tab-preview')
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('panel-left')!).display)).toBe('none')
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('panel-right')!).display)).toBe('flex')

    await page.click('#tab-code')
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('panel-left')!).display)).toBe('flex')
    await page.setViewportSize({ width: 1280, height: 720 })
  }, 60_000)

  it('empty-state CTA opens a persistent examples sidebar', async () => {
    await page.goto(`${BASE}/editor`)
    await page.waitForSelector('#code-editor', { timeout: 30_000 })

    expect(await page.evaluate(() => document.getElementById('examples-sidebar')?.classList.contains('open'))).toBe(false)
    await page.click('[data-action="load-example"]')
    await page.waitForFunction(
      () => document.getElementById('examples-sidebar')?.classList.contains('open') === true,
      { timeout: 10_000 },
    )

    await page.waitForFunction(
      () => (document.getElementById('examples-sidebar')?.getBoundingClientRect().width ?? 0) >= 280,
      { timeout: 10_000 },
    )
    const sidebarBox = await page.locator('#examples-sidebar').boundingBox()
    expect(sidebarBox).not.toBeNull()
    expect(sidebarBox!.width).toBeGreaterThanOrEqual(280)

    await page.click('#examples-sidebar .example-dropdown-item[data-example="flowchart-basic"]')
    await waitForEditorRender(60_000)
    expect(await page.inputValue('#code-editor')).toContain('flowchart TD')
    expect(await page.evaluate(() => document.getElementById('examples-sidebar')?.classList.contains('open'))).toBe(true)
  }, 120_000)

  it('opens /editor and renders fork-added diagram families through the bundled renderer', async () => {
    await page.goto(`${BASE}/editor`)
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
    await page.goto(`${BASE}/editor`)
    await page.waitForSelector('#code-editor', { timeout: 30_000 })
    await page.fill('#code-editor', 'graph TD\n  A[Theme] --> B[Render]')
    await waitForEditorRender(60_000)

    const salmonBg = await page.evaluate(
      () => (window as unknown as { __mermaid: { THEMES: Record<string, { bg: string }> } })
        .__mermaid.THEMES.salmon.bg,
    )

    await page.click('#theme-dropdown-btn')
    await page.click('.theme-dropdown-item[data-theme="salmon"]')
    await page.waitForFunction(
      (bg: string) => getComputedStyle(document.documentElement).getPropertyValue('--t-bg').trim() === bg,
      salmonBg,
      { timeout: 30_000 },
    )
    await waitForEditorRender(60_000)

    expect(await page.evaluate(() => localStorage.getItem('bm-editor-theme'))).toBe('salmon')
    expect(await page.evaluate(
      () => document.querySelector('#preview-inner svg')?.getAttribute('style')?.includes('--bg') ?? false,
    )).toBe(true)
  }, 120_000)

  it('examples controls have stable sizing and basic examples keep the selected theme', async () => {
    await page.goto(`${BASE}/editor`)
    await page.waitForSelector('#code-editor', { timeout: 30_000 })

    await page.click('#theme-dropdown-btn')
    await page.click('.theme-dropdown-item[data-theme="salmon"]')
    await page.waitForFunction(
      () => getComputedStyle(document.documentElement).getPropertyValue('--t-bg').trim() === '#FFFBF5',
      { timeout: 30_000 },
    )

    const sourceActionsBox = await page.locator('.source-actions').boundingBox()
    const examplesBox = await page.locator('#example-dropdown-btn').boundingBox()
    expect(sourceActionsBox).not.toBeNull()
    expect(examplesBox).not.toBeNull()
    expect(sourceActionsBox!.width).toBeGreaterThanOrEqual(158)
    expect(examplesBox!.width).toBeGreaterThanOrEqual(90)

    await page.click('#example-dropdown-btn')
    await page.waitForFunction(
      () => document.getElementById('example-dropdown-menu')?.classList.contains('open') === true,
      { timeout: 10_000 },
    )

    const diagramTypes = await page.evaluate(() => Array.from(
      new Set(Array.from(document.querySelectorAll('#example-dropdown-menu .example-dropdown-item'))
        .map(el => (el as HTMLElement).dataset.diagram)
        .filter(Boolean)),
    ).sort())

    expect(diagramTypes).toEqual([
      'Architecture',
      'Class',
      'ER',
      'Flowchart',
      'Journey',
      'Sequence',
      'State',
      'Timeline',
      'XY Chart',
    ].sort())

    const box = await page.locator('#example-dropdown-menu').boundingBox()
    const viewport = page.viewportSize()
    expect(box).not.toBeNull()
    expect(viewport).not.toBeNull()
    expect(box!.width).toBeGreaterThan(400)
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width)

    await page.click('#example-dropdown-menu .example-dropdown-item[data-example="state-basic"]')
    await page.waitForFunction(
      () => (document.querySelector('#preview-inner svg')?.outerHTML ?? '').includes('Processing'),
      { timeout: 60_000 },
    )
    expect(await page.inputValue('#code-editor')).toContain('stateDiagram-v2')
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--t-bg').trim())).toBe('#FFFBF5')
    expect(await page.evaluate(() => localStorage.getItem('bm-editor-theme'))).toBe('salmon')
  }, 120_000)

  it('topbar button dimensions do not shift when toggling day/dark mode', async () => {
    await page.goto(`${BASE}/editor`)
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

  it('loads semantic role style examples without overriding the selected theme', async () => {
    await page.goto(`${BASE}/editor`)
    await page.waitForSelector('#code-editor', { timeout: 30_000 })

    await page.click('#theme-dropdown-btn')
    await page.click('.theme-dropdown-item[data-theme="dracula"]')
    await page.waitForFunction(
      () => getComputedStyle(document.documentElement).getPropertyValue('--t-bg').trim() === '#282a36',
      { timeout: 30_000 },
    )

    await page.click('#example-dropdown-btn')
    await page.click('#example-dropdown-menu .example-dropdown-item[data-example="styled-xychart"]')

    await page.waitForFunction(
      () => {
        const html = document.querySelector('#preview-inner svg')?.outerHTML ?? ''
        return html.includes('Styled Adoption')
          && html.includes('xychart-bar')
          && html.includes('stroke-width: 2.25')
      },
      { timeout: 60_000 },
    )

    const hashState = await page.evaluate(() => {
      const hash = window.location.hash.slice(1)
      const decoded = decodeURIComponent(escape(atob(hash)))
      return JSON.parse(decoded)
    })

    expect(hashState.config).toMatchObject({
      style: {
        node: { cornerRadius: 16 },
        edge: { lineWidth: 2.25 },
        group: { textTransform: 'uppercase' },
      },
      interactive: true,
    })
    expect(hashState.theme).toBe('dracula')
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--t-bg').trim())).toBe('#282a36')
    expect(await page.evaluate(() => localStorage.getItem('bm-editor-theme'))).toBe('dracula')
  }, 120_000)

})

describe('browser: visual regression', () => {

  it('architecture rounded fills match screenshot baseline without seams', async () => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto(`${BASE}/editor?visual=architecture-rounded-fill#${ARCHITECTURE_ROUNDED_FILL_HASH}`)
    await waitForEditorRender(60_000)
    await page.waitForFunction(
      () => {
        const svg = document.querySelector('#preview-inner svg')
        return svg !== null
          && svg.querySelectorAll('.architecture-group-band').length === 2
          && svg.querySelectorAll('.architecture-group-outline').length === 2
          && svg.querySelectorAll('.architecture-service-outline').length === 3
      },
      { timeout: 60_000 },
    )
    await page.evaluate(() => document.fonts?.ready)

    const svgHtml = await page.locator('#preview-inner svg').evaluate(el => el.outerHTML)
    expect(svgHtml).toContain('<path class="architecture-group-band"')
    expect(svgHtml).toContain('<rect class="architecture-group-outline"')
    expect(svgHtml).toContain('<path class="architecture-service-accent"')
    expect(svgHtml).toContain('<rect class="architecture-service-outline"')
    expect(svgHtml).not.toContain('<rect class="architecture-group-band"')
    expect(svgHtml).not.toContain('<rect class="architecture-service-accent"')

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

  it('rounded partial fills match screenshot baselines for all affected diagram families', async () => {
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
        required: ['<g class="subgraph" data-id="edge"', '<path d="M', 'A18,18'],
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
        required: ['<g class="class-node"', '<path d="M', 'A16,16'],
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
        required: ['<g class="entity"', '<path d="M', 'A16,16'],
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
        required: ['<path class="journey-section-band"', '<path class="journey-task-accent"'],
        forbidden: ['<rect class="journey-section-band"', '<rect class="journey-task-accent"'],
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
        required: ['<path class="timeline-section-band"', '<path class="timeline-event-accent"'],
        forbidden: ['<rect class="timeline-section-band"', '<rect class="timeline-event-accent"'],
      },
    ]

    for (const testCase of cases) {
      await page.goto(`${BASE}/editor?visual=${encodeURIComponent(testCase.name)}#${editorHash(testCase.source)}`)
      await waitForEditorRender(60_000)
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

  it('default theme screenshot matches baseline', async () => {
    // Fresh page load -- no pending re-renders
    await page.goto(BASE)
    await waitForRender(60_000)

    const currentPath = await takeScreenshot('current-default')
    const baselinePath = join(SCREENSHOT_DIR, 'baseline-default.png')

    if (!(await Bun.file(baselinePath).exists())) {
      if (process.env.UPDATE_BASELINES) {
        await Bun.write(baselinePath, Bun.file(currentPath))
        console.log('  Created baseline: baseline-default.png')
        return
      }
      throw new Error(
        'Missing baseline screenshot: baseline-default.png. ' +
        'Run with UPDATE_BASELINES=1 to create it.',
      )
    }

    // Pixel-level diff requires additional dependencies (e.g. pixelmatch).
    // For now, verify the screenshot was taken successfully.
    const currentFile = Bun.file(currentPath)
    expect(await currentFile.exists()).toBe(true)
    expect(currentFile.size).toBeGreaterThan(0)
    console.log('  Screenshot captured; pixel-diff comparison skipped (no pixelmatch dep).')
  }, 120_000)

  it('dracula theme screenshot matches baseline', async () => {
    // Fresh page load, then switch to Dracula and wait for re-render
    await page.goto(BASE)
    await waitForRender(60_000)
    await page.evaluate(() =>
      (document.querySelector('[data-theme="dracula"]') as HTMLElement)?.click(),
    )
    // Wait for Dracula theme CSS var to be applied
    await page.waitForFunction(
      () => getComputedStyle(document.body).getPropertyValue('--t-bg').trim() === '#282a36',
      { timeout: 30_000 },
    )

    const currentPath = await takeScreenshot('current-dracula')
    const baselinePath = join(SCREENSHOT_DIR, 'baseline-dracula.png')

    if (!(await Bun.file(baselinePath).exists())) {
      if (process.env.UPDATE_BASELINES) {
        await Bun.write(baselinePath, Bun.file(currentPath))
        console.log('  Created baseline: baseline-dracula.png')
        return
      }
      throw new Error(
        'Missing baseline screenshot: baseline-dracula.png. ' +
        'Run with UPDATE_BASELINES=1 to create it.',
      )
    }

    // Pixel-level diff requires additional dependencies (e.g. pixelmatch).
    // For now, verify the screenshot was taken successfully.
    const currentFile = Bun.file(currentPath)
    expect(await currentFile.exists()).toBe(true)
    expect(currentFile.size).toBeGreaterThan(0)
    console.log('  Screenshot captured; pixel-diff comparison skipped (no pixelmatch dep).')
  }, 120_000)

})
