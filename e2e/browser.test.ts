/**
 * Browser tests using agent-browser.
 *
 * These tests open the generated index.html in a real browser and verify:
 * - All diagrams render (SVG + ASCII)
 * - Theme switching works and persists across reloads
 * - Interactive features (dropdowns, edit dialog) function correctly
 *
 * Requires: `agent-browser` CLI installed globally.
 * Run:  bun run test:browser
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { join } from 'path'

const ROOT = join(import.meta.dir, '..')
const PORT = 4567 // Avoid collision with dev server on 3456
const BASE = `http://localhost:${PORT}`
const SESSION = 'bm-test-' + Date.now()
const SCREENSHOT_DIR = join(ROOT, 'e2e', 'screenshots')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run an agent-browser command with explicit args array, return parsed JSON. */
async function ab(args: string[]): Promise<any> {
  const fullArgs = ['agent-browser', '--session', SESSION, ...args, '--json']
  const proc = Bun.spawn(fullArgs, { stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  await proc.exited
  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error(`agent-browser failed (args: ${fullArgs.join(' ')}): ${stdout}`)
  }
}

/** Execute JS in the page and return the unwrapped result. */
async function evaluate(js: string): Promise<any> {
  const b64 = Buffer.from(js).toString('base64')
  const result = await ab(['eval', '-b', b64])
  if (!result.success) {
    throw new Error(`eval failed: ${JSON.stringify(result)}`)
  }
  // agent-browser eval returns { success, data: { origin, result } }
  const data = result.data
  if (data && typeof data === 'object' && 'result' in data) return data.result
  return data
}

/** Wait for diagrams to finish rendering. */
async function waitForRender(timeoutMs = 30_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const timing = await evaluate(
      'document.getElementById("total-timing")?.textContent || ""'
    )
    if (typeof timing === 'string' && timing.includes('rendered in')) return
    await Bun.sleep(500)
  }
  throw new Error('Timed out waiting for diagrams to render')
}

/** Take a screenshot to a named file. */
async function takeScreenshot(name: string): Promise<string> {
  const path = join(SCREENSHOT_DIR, `${name}.png`)
  const result = await ab(['screenshot', path])
  if (!result.success) {
    throw new Error(`screenshot failed: ${JSON.stringify(result)}`)
  }
  return path
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: ReturnType<typeof Bun.serve>

beforeAll(async () => {
  // Ensure index.html exists
  const indexPath = join(ROOT, 'index.html')
  if (!(await Bun.file(indexPath).exists())) {
    const proc = Bun.spawn(['bun', 'run', join(ROOT, 'index.ts')], {
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
      const filePath = join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname)
      const file = Bun.file(filePath)
      if (await file.exists()) return new Response(file)
      // Try public/ for static assets
      const pubFile = Bun.file(join(ROOT, 'public', url.pathname))
      if (await pubFile.exists()) return new Response(pubFile)
      return new Response('Not found', { status: 404 })
    },
  })

  // Open the page and wait for rendering
  await ab(['open', BASE])
  await waitForRender(60_000)
}, 120_000)

afterAll(async () => {
  try { await ab(['close']) } catch {}
  server?.stop()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('browser: page loads and renders', () => {

  it('page title is correct', async () => {
    const result = await ab(['get', 'title'])
    const title = result.data?.title ?? ''
    expect(title).toContain('Beautiful Mermaid')
  }, 60_000)

  it('all SVG diagrams rendered (no empty containers)', async () => {
    const count = await evaluate('document.querySelectorAll(".svg-container svg").length')
    expect(count).toBeGreaterThanOrEqual(90)
  }, 60_000)

  it('all ASCII panels rendered', async () => {
    const count = await evaluate(
      'Array.from(document.querySelectorAll(\'[id^="ascii-"]\')).filter(el => el.textContent.trim().length > 0).length'
    )
    expect(count).toBeGreaterThanOrEqual(80)
  }, 60_000)

  it('no render errors visible', async () => {
    const errors = await evaluate('document.querySelectorAll(".render-error").length')
    expect(errors).toBe(0)
  }, 60_000)

  it('timing banner shows completion', async () => {
    const text = await evaluate('document.getElementById("total-timing")?.textContent || ""')
    expect(text).toContain('rendered in')
  }, 60_000)

})

describe('browser: theme switching', () => {

  it('default theme has white background', async () => {
    // Ensure we're on default
    await evaluate('document.querySelector(\'[data-theme=""]\').click()')
    await Bun.sleep(300)
    const bg = await evaluate(
      'getComputedStyle(document.body).getPropertyValue("--t-bg").trim()'
    )
    expect(bg).toBe('#FFFFFF')
  }, 60_000)

  it('clicking Dracula pill switches to dark theme', async () => {
    // applyTheme re-renders all 93 SVGs async — CSS vars update immediately
    // but agent-browser eval may block until page is idle
    await evaluate('document.querySelector(\'[data-theme="dracula"]\').click()')
    const bg = await evaluate(
      'getComputedStyle(document.body).getPropertyValue("--t-bg").trim()'
    )
    expect(bg).toBe('#282a36')
  }, 120_000)

  it('theme is persisted to localStorage', async () => {
    const saved = await evaluate('localStorage.getItem("mermaid-theme")')
    expect(saved).toBe('dracula')
  }, 60_000)

  it('theme persists across page reload', async () => {
    await ab(['open', BASE])
    await waitForRender(60_000)

    const bg = await evaluate(
      'getComputedStyle(document.body).getPropertyValue("--t-bg").trim()'
    )
    expect(bg).toBe('#282a36')

    const saved = await evaluate('localStorage.getItem("mermaid-theme")')
    expect(saved).toBe('dracula')
  }, 90_000)

  it('switching back to Default restores white', async () => {
    await evaluate('document.querySelector(\'[data-theme=""]\').click()')
    const bg = await evaluate(
      'getComputedStyle(document.body).getPropertyValue("--t-bg").trim()'
    )
    expect(bg).toBe('#FFFFFF')

    const saved = await evaluate('localStorage.getItem("mermaid-theme")')
    expect(saved).toBeNull()
  }, 120_000)

})

describe('browser: dropdowns', () => {

  it('More themes dropdown opens and closes', async () => {
    await evaluate('document.getElementById("theme-more-btn")?.click()')
    await Bun.sleep(200)
    expect(await evaluate(
      'document.getElementById("theme-more-dropdown")?.classList.contains("open")'
    )).toBe(true)

    await ab(['press', 'Escape'])
    await Bun.sleep(200)
    expect(await evaluate(
      'document.getElementById("theme-more-dropdown")?.classList.contains("open")'
    )).toBe(false)
  }, 60_000)

  it('Contents dropdown opens, shows links, and closes', async () => {
    await evaluate('document.getElementById("contents-btn")?.click()')
    await Bun.sleep(200)

    expect(await evaluate(
      'document.getElementById("mega-menu")?.classList.contains("open")'
    )).toBe(true)

    const linkCount = await evaluate('document.querySelectorAll("#mega-menu a").length')
    expect(linkCount).toBeGreaterThan(0)

    await ab(['press', 'Escape'])
    await Bun.sleep(200)
    expect(await evaluate(
      'document.getElementById("mega-menu")?.classList.contains("open")'
    )).toBe(false)
  }, 60_000)

  it('Brand dropdown opens and closes', async () => {
    await evaluate('document.getElementById("brand-badge-btn")?.click()')
    await Bun.sleep(200)
    expect(await evaluate(
      'document.getElementById("brand-dropdown")?.classList.contains("open")'
    )).toBe(true)

    await ab(['press', 'Escape'])
    await Bun.sleep(200)
    expect(await evaluate(
      'document.getElementById("brand-dropdown")?.classList.contains("open")'
    )).toBe(false)
  }, 60_000)

})

describe('browser: edit dialog', () => {

  it('edit dialog opens, edits, saves, and re-renders', async () => {
    // Ensure clean page state
    await ab(['open', BASE])
    await waitForRender(60_000)

    // Click the first edit button
    const idx = await evaluate(
      'var btn = document.querySelector(".edit-btn[data-sample]"); ' +
      'if (btn) { btn.click(); parseInt(btn.dataset.sample, 10) } else -1'
    )
    if (idx < 0) return

    // The click triggers openEditDialog which is synchronous
    expect(await evaluate(
      'document.getElementById("edit-overlay")?.classList.contains("open") || false'
    )).toBe(true)

    // Verify textarea has content
    const sourceLen = await evaluate(
      '(document.getElementById("edit-dialog-textarea")?.value || "").length'
    )
    expect(sourceLen).toBeGreaterThan(10)

    // Edit source and save
    await evaluate(
      'var ta = document.getElementById("edit-dialog-textarea"); ' +
      'if (ta) { ta.value = "graph TD\\n  X[Edited] --> Y[Works]"; }'
    )
    await evaluate(
      'var btn = document.getElementById("edit-dialog-save"); if (btn) btn.click()'
    )

    // Wait for dialog close and async re-render
    const closed = await evaluate(
      '!document.getElementById("edit-overlay")?.classList.contains("open")'
    )
    expect(closed).toBe(true)

    const hasEdited = await evaluate(
      '(document.getElementById("svg-' + idx + '")?.innerHTML || "").includes("Edited")'
    )
    expect(hasEdited).toBe(true)
  }, 120_000)

  it('cancel closes the dialog', async () => {
    // Open the dialog first
    await evaluate(
      'var btn = document.querySelector(".edit-btn[data-sample]"); if (btn) btn.click()'
    )
    await Bun.sleep(500)

    await evaluate(
      'var btn = document.getElementById("edit-dialog-cancel"); if (btn) btn.click()'
    )
    expect(await evaluate(
      '!document.getElementById("edit-overlay")?.classList.contains("open")'
    )).toBe(true)
  }, 120_000)

})

describe('browser: random theme button', () => {

  it('random theme button changes the theme', async () => {
    // Fresh page load on default theme
    await ab(['open', BASE])
    await waitForRender(60_000)

    const bgBefore = await evaluate(
      'getComputedStyle(document.body).getPropertyValue("--t-bg").trim()'
    )
    expect(bgBefore).toBe('#FFFFFF')

    // Click random — this triggers a theme change + 93 re-renders
    await evaluate('document.getElementById("random-theme-btn")?.click()')
    // The CSS var updates synchronously, but agent-browser eval may wait for page idle
    const bgAfter = await evaluate(
      'getComputedStyle(document.body).getPropertyValue("--t-bg").trim()'
    )
    expect(bgAfter).not.toBe('#FFFFFF')
  }, 120_000)

})

describe('browser: visual regression', () => {

  it('default theme screenshot matches baseline', async () => {
    // Fresh page load — no pending re-renders
    await ab(['open', BASE])
    await waitForRender(60_000)

    const currentPath = await takeScreenshot('current-default')
    const baselinePath = join(SCREENSHOT_DIR, 'baseline-default.png')

    if (!(await Bun.file(baselinePath).exists())) {
      await Bun.write(baselinePath, Bun.file(currentPath))
      console.log('  Created baseline: baseline-default.png')
      return
    }

    const diffResult = await ab(['diff', 'screenshot', '--baseline', baselinePath])
    const mismatch = diffResult.data?.mismatchPercentage ?? 0
    expect(mismatch).toBeLessThan(1)
  }, 120_000)

  it('dracula theme screenshot matches baseline', async () => {
    // Fresh page load, then switch to Dracula and wait for re-render
    await ab(['open', BASE])
    await waitForRender(60_000)
    await evaluate('document.querySelector(\'[data-theme="dracula"]\').click()')
    // Wait for the 93-diagram async re-render to finish
    await Bun.sleep(2000)

    const currentPath = await takeScreenshot('current-dracula')
    const baselinePath = join(SCREENSHOT_DIR, 'baseline-dracula.png')

    if (!(await Bun.file(baselinePath).exists())) {
      await Bun.write(baselinePath, Bun.file(currentPath))
      console.log('  Created baseline: baseline-dracula.png')
      return
    }

    const diffResult = await ab(['diff', 'screenshot', '--baseline', baselinePath])
    const mismatch = diffResult.data?.mismatchPercentage ?? 0
    expect(mismatch).toBeLessThan(1)
  }, 120_000)

  it('cleanup: reset to default theme', async () => {
    await evaluate('localStorage.removeItem("mermaid-theme")')
  }, 60_000)

})
