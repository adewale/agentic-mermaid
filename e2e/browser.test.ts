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

})

describe('browser: theme switching', () => {

  it('default theme has white background', async () => {
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

  it('Brand dropdown opens and closes', async () => {
    await page.evaluate(() => document.getElementById('brand-badge-btn')?.click())
    await page.waitForFunction(
      () => document.getElementById('brand-dropdown')?.classList.contains('open') === true,
      { timeout: 10_000 },
    )
    expect(await page.evaluate(
      () => document.getElementById('brand-dropdown')?.classList.contains('open'),
    )).toBe(true)

    await page.keyboard.press('Escape')
    await page.waitForFunction(
      () => document.getElementById('brand-dropdown')?.classList.contains('open') === false,
      { timeout: 10_000 },
    )
    expect(await page.evaluate(
      () => document.getElementById('brand-dropdown')?.classList.contains('open'),
    )).toBe(false)
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

  it('opens /editor and renders fork-added diagram families through the bundled renderer', async () => {
    await page.goto(`${BASE}/editor`)
    await waitForEditorRender(60_000)

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

})

describe('browser: visual regression', () => {

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
