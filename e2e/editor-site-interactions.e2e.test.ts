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
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { chromium, type Browser, type Page, type Route } from 'playwright'
import '../src/scene/builtin-backends.ts'
import { PNG_DEFAULT_SCALE } from '../src/png-contract.ts'
import { getFamily, knownBuiltinFamilies } from '../src/agent/families.ts'
import { renderAndVerifyMermaid } from '../src/agent/verify.ts'
import { renderMermaidASCIIWithReceipt } from '../src/ascii/index.ts'
import { serveWithAvailablePort } from './test-port.ts'

const SITE = join(import.meta.dir, '..', 'website', 'public')
const SCREENSHOTS = join(import.meta.dir, 'screenshots')
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
    if (abs.startsWith(SITE) && existsSync(abs) && statSync(abs).isFile()) return abs
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

  test.each([undefined, 'hand-drawn', 'watercolor'] as const)('every built-in can be the first deferred family, retaining verified SVG and native terminal output (%s)', async style => {
    for (const id of knownBuiltinFamilies()) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      try {
        await page.goto(`${base}/editor/?empty=1`)
        await page.waitForFunction(() => !!(window as any).__mermaid)
        const source = getFamily(id)!.example
        const options = { security: 'strict' as const, embedFontImport: false, style: [style ?? 'crisp', 'paper'], seed: 4 }
        const expected = renderAndVerifyMermaid(source, options)
        const actual = await page.evaluate(async ({ source, options }) => (window as any).__mermaid.renderMermaidSVGWithReceipt(source, options), { source, options })
        expect(actual.svg, id).toBe(expected.svg)
        expect(actual.receipt, id).toEqual(expected.receipt)
        expect(actual.verification, id).toEqual({ ok: expected.verification.ok, warnings: expected.verification.warnings, checks: expected.verification.checks })
        for (const useAscii of [false, true]) {
          const terminalOptions = { colorMode: 'none' as const, useAscii }
          const expectedTerminal = renderMermaidASCIIWithReceipt(source, terminalOptions)
          const terminal = await page.evaluate(async ({ source, terminalOptions }) => (window as any).__mermaid[terminalOptions.useAscii ? 'renderMermaidASCIIWithReceipt' : 'renderMermaidUnicodeWithReceipt'](source, terminalOptions), { source, terminalOptions })
          expect(terminal.text, id).toBe(expectedTerminal.text)
          expect(terminal.receipt, id).toEqual(expectedTerminal.receipt)
          expect(terminal.outputPolicy, id).toEqual(expectedTerminal.outputPolicy)
        }
        expect(page.workers()).toHaveLength(1)
      } finally { await page.close() }
    }
  }, 120_000)

  describe.each([
    ['Packet comment', 'packet', 'packet %% Header comment\n0-7: "Header"', 'Header'],
    ['Kanban comment', 'kanban', 'kanban %% Header comment\n  todo[To do]\n    parser[Build parser]', 'Build parser'],
    ['Requirement comment', 'requirement', 'requirementDiagram %% Header comment\n  requirement latency {\n    id: 1\n    text: Respond promptly\n    risk: high\n    verifymethod: test\n  }', 'Respond promptly'],
    ['Treemap comment', 'treemap', 'treemap %% Header comment\n"Product"\n  "Engineering": 60\n  "Design": 40', 'Engineering'],
    ['Block comment', 'block', 'block %% Header comment\n  columns 2\n  A["API"] B["Database"]\n  A --> B', 'Database'],
    ['Sequence entity', 'sequence', 'sequence&#68;iagram\nAlice->>Bob: Encoded header', 'Encoded header'],
    ['entity and comment', 'sequence', 'sequence&#68;iagram %% Header comment\nAlice->>Bob: Combined header', 'Combined header'],
    ['BOM, CRLF, frontmatter and init', 'packet', '\uFEFF---\r\ntitle: Packet wrapper\r\nconfig:\r\n  packet:\r\n    bitsPerRow: 16\r\n---\r\n%%{init: {"theme": "default"}}%%\r\nPACKET %% Header comment\r\n0-7: "Wrapped field"', 'Wrapped field'],
  ])('%s admission', (_name, family, source, label) => {
    test.each(['svg', 'unicode'] as const)('%s first, then warm, retains accepted source meaning and receipts', async first => {
      const page = await browser.newPage()
      try {
        await page.goto(`${base}/editor/?empty=1`)
        await page.waitForFunction(() => !!(window as any).__mermaid)
        const options = { security: 'strict' as const, embedFontImport: false, mermaidConfig: { packet: { bitsPerRow: 8 } } }
        const expectedSvg = renderAndVerifyMermaid(source, options)
        const expectedText = renderMermaidASCIIWithReceipt(source, { ...options, colorMode: 'none' })
        expect(expectedSvg.svg).toContain(label)
        expect(expectedText.text).toContain(label)
        expect(expectedSvg.receipt.capabilityDecision.resolutions).toContainEqual(expect.objectContaining({ id: `family:${family}`, status: 'selected' }))
        const actual = await page.evaluate(async ({ source, options, first }) => {
          const api = (window as any).__mermaid
          const svg = () => api.renderMermaidSVGWithReceipt(source, options)
          const unicode = () => api.renderMermaidUnicodeWithReceipt(source, { ...options, colorMode: 'none' })
          // No ordinary example or successful render may warm this page first.
          const cold = await (first === 'svg' ? svg() : unicode())
          return { cold, svg: await svg(), unicode: await unicode(), warm: await (first === 'svg' ? svg() : unicode()) }
        }, { source, options, first })
        const checkSvg = (artifact: typeof actual.svg) => {
          expect(artifact.svg).toBe(expectedSvg.svg)
          expect(artifact.receipt).toEqual(expectedSvg.receipt)
          expect(artifact.verification).toEqual({ ok: expectedSvg.verification.ok, warnings: expectedSvg.verification.warnings, checks: expectedSvg.verification.checks })
        }
        const checkText = (artifact: typeof actual.unicode) => {
          expect(artifact.text).toBe(expectedText.text)
          expect(artifact.receipt).toEqual(expectedText.receipt)
          expect(artifact.outputPolicy).toEqual(expectedText.outputPolicy)
        }
        checkSvg(actual.svg)
        checkText(actual.unicode)
        if (first === 'svg') { checkSvg(actual.cold); checkSvg(actual.warm) }
        else { checkText(actual.cold); checkText(actual.warm) }
        expect(page.workers()).toHaveLength(1)
      } finally { await page.close() }
    }, 30_000)
  })

  test.each([
    ['Markdown fence', '```mermaid\nsequenceDiagram\nAlice->>Bob: Unsupported wrapper\n```', '```mermaid'],
    ['double-encoded header', 'sequence&amp;#68;iagram\nAlice->>Bob: Decode once', 'sequence&#68;iagram'],
    ['unowned header suffix', 'sequenceDiagramV2\nAlice->>Bob: Unknown dialect', 'sequenceDiagramV2'],
  ])('%s remains rejected cold and warm', async (_name, source, header) => {
    const page = await browser.newPage()
    try {
      await page.goto(`${base}/editor/?empty=1`)
      await page.waitForFunction(() => !!(window as any).__mermaid)
      expect(() => renderAndVerifyMermaid(source)).toThrow(`Unrecognized Mermaid header: "${header}"`)
      const actual = await page.evaluate(async source => {
        const api = (window as any).__mermaid
        const rejected = async () => {
          try { await api.renderMermaidSVGWithReceipt(source); return null }
          catch (error) { return (error as Error).message }
        }
        const cold = await rejected()
        await api.renderMermaidSVGWithReceipt('sequenceDiagram\nAlice->>Bob: Warm family')
        return { cold, warm: await rejected() }
      }, source)
      expect(actual.cold).toBe(`Unrecognized Mermaid header: "${header}"`)
      expect(actual.warm).toBe(actual.cold)
    } finally { await page.close() }
  }, 30_000)

  test('invalid source config wins over an unavailable cold family download', async () => {
    const page = await browser.newPage()
    try {
      await page.goto(`${base}/editor/?empty=1`)
      await page.waitForFunction(() => !!(window as any).__mermaid)
      await page.evaluate(() => (window as any).__mermaid.renderMermaidSVGWithReceipt('flowchart TD\nA --> B'))
      let blocked = 0
      await page.route('**/editor/runtime/**', route => { blocked++; return route.abort() })
      const renderError = (source: string) => page.evaluate(async source => {
        try { await (window as any).__mermaid.renderMermaidSVGWithReceipt(source); return null }
        catch (error) { return (error as Error).message }
      }, source)
      expect(await renderError('---\nconfig: [\n---\nsequenceDiagram\nAlice->>Bob: Message')).toStartWith('Mermaid frontmatter is not valid YAML:')
      expect(blocked).toBe(0)
      expect(await renderError('sequenceDiagram\nAlice->>Bob: Message')).toContain('Diagram code could not load')
      expect(blocked).toBeGreaterThan(0)
    } finally { await page.close() }
  }, 30_000)

  test('cached-family editing works without new modules and a failed family download retries on the next edit', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    try {
      await page.goto(`${base}/editor/?empty=1`)
      await page.locator('#code-editor').fill('flowchart LR\n A[First] --> B[Cached]')
      await waitForVerifiedRender(page)
      let blocked = 0
      await page.route('**/editor/runtime/**', route => { blocked++; return route.abort() })
      await page.locator('#code-editor').fill('flowchart LR\n A[Offline edit] --> B[Cached]')
      await page.waitForFunction(() => document.getElementById('status-text')?.textContent === 'OK' && document.getElementById('preview-inner')?.textContent?.includes('Offline edit'))
      expect(blocked).toBe(0)
      await page.locator('#code-editor').fill('sequenceDiagram\n Alice->>Bob: First download')
      await page.waitForFunction(() => document.getElementById('status-text')?.textContent === 'Error')
      expect(blocked).toBeGreaterThan(0)
      expect(await page.locator('.preview-error-detail').textContent()).toContain('Check your connection')
      expect(await page.locator('#runtime-recovery').isVisible()).toBe(true)
      await page.unroute('**/editor/runtime/**')
      await page.locator('#code-editor').fill('sequenceDiagram\n Alice->>Bob: Recovered download')
      await page.waitForFunction(() => document.getElementById('status-text')?.textContent === 'OK' && document.getElementById('preview-inner')?.textContent?.includes('Recovered download'))
      expect(page.workers()).toHaveLength(1)
      expect(await page.locator('#runtime-recovery').isVisible()).toBe(false)
    } finally { await page.close() }
  }, 60_000)

  test.each(['disabled', 'replaced'] as const)('a failed fitting download respects a %s request', async transition => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
    const source = 'pie title Delivery\n"Complete": 6\n"Remaining": 4'
    const held: Route[] = []
    let started!: () => void
    let failImports = false
    const importing = new Promise<void>(resolve => { started = resolve })
    try {
      await wrapAdapter(page, 'prepareEditorRenderOptions', `function(original) { return function() {
        window.__fittingPreparations = (window.__fittingPreparations || 0) + 1;
        return Promise.resolve(original.apply(this, arguments)).finally(function() { window.__fittingSettled = true; });
      }; }`)
      await page.goto(`${base}/editor/?empty=1`)
      await page.locator('#code-editor').fill(source)
      await waitForVerifiedRender(page)
      await page.route('**/editor/runtime/**', route => {
        if (failImports) return route.abort()
        held.push(route)
        started()
      })
      await page.locator('#settings-btn').click()
      await page.locator('#cfg-fit-labels').check()
      await importing
      if (transition === 'disabled') {
        await page.locator('#cfg-fit-labels').uncheck()
        await page.waitForFunction(() => document.getElementById('status-text')?.textContent === 'OK'
          && !!document.getElementById('preview-inner')?.dataset.sharedRequestDigest)
      } else {
        await page.locator('#code-editor').fill(source + '\n"Current": 1')
        await page.waitForFunction(() => (window as any).__fittingPreparations >= 2)
      }
      failImports = true
      await Promise.all(held.map(route => route.abort()))
      await page.waitForFunction(() => (window as any).__fittingSettled)
      if (transition === 'disabled') {
        expect(await page.locator('#status-text').textContent()).toBe('OK')
        expect(await page.locator('#runtime-recovery').isVisible()).toBe(false)
        expect(await page.locator('#export-svg-btn').isEnabled()).toBe(true)
      } else {
        await page.waitForFunction(() => document.getElementById('status-text')?.textContent === 'Error')
        expect(await page.locator('#runtime-recovery').isVisible()).toBe(true)
        expect(await page.locator('#export-svg-btn').isEnabled()).toBe(false)
      }
    } finally { await page.close() }
  })

  test.each([1280, 390])('reload recovery at %i px preserves unverified edits and settings without browser storage', async width => {
    let retired = false, documents = 0
    const served = serveWithAvailablePort({ preferredPort: 4801, fetch(request) {
      const pathname = new URL(request.url).pathname
      if (pathname === '/editor/') { documents++; retired = false }
      if (retired && pathname.startsWith('/editor/runtime/')) return new Response('Retired asset', { status: 404, headers: { 'cache-control': 'no-store' } })
      const file = fileForPath(pathname)
      return file ? new Response(Bun.file(file), { headers: { 'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'cache-control': extname(file) === '.js' ? 'public, max-age=31536000, immutable' : 'no-cache' } }) : new Response('Not found', { status: 404 })
    } })
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const initial = { source: 'flowchart LR\nA-->B', palette: 'nord', style: 'hand-drawn', seed: 17, config: { padding: 64 } }
    const source = 'sequenceDiagram\nAlice->>Bob: Keep latest β\n  '
    try {
      await page.addInitScript(() => {
        for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { configurable: true, get() { throw new DOMException('Storage blocked', 'SecurityError') } })
      })
      await page.goto(served.base + '/editor/?example=sequence&empty=1#' + shareHash(initial))
      await waitForVerifiedRender(page)
      if (width < 768) await page.locator('#mode-source').click()
      retired = true
      await page.locator('#code-editor').fill(source)
      await page.waitForFunction(() => document.getElementById('status-text')?.textContent === 'Error')
      if (width < 768) await page.locator('#mode-preview').click()
      expect(await page.locator('#runtime-recovery').isVisible()).toBe(true)
      expect(documents).toBe(1)
      expect(await page.locator('#verify-structural').textContent()).toBe('Not run')
      const errorBounds = await page.locator('.preview-runtime-error').boundingBox()
      expect(errorBounds!.x + errorBounds!.width).toBeLessThanOrEqual(width)
      mkdirSync(SCREENSHOTS, { recursive: true })
      await page.screenshot({ path: join(SCREENSHOTS, `current-runtime-recovery-${width}.png`), animations: 'disabled' })
      const loaded = page.waitForEvent('load')
      await page.locator('#reload-editor').click()
      await loaded
      await waitForVerifiedRender(page)
      expect(documents).toBe(2)
      expect(await page.locator('#code-editor').inputValue()).toBe(source)
      expect(await page.locator('#preview-inner svg').textContent()).toContain('Keep latest β')
      const encoded = new URL(page.url()).hash.slice('#deflate:'.length)
      const restored = JSON.parse(inflateRawSync(Buffer.from(encoded, 'base64url')).toString())
      expect(restored).toEqual({ ...initial, source })
      expect(await page.locator('.theme-dropdown-item[data-theme="nord"]').getAttribute('aria-selected')).toBe('true')
      expect(await page.locator('.theme-dropdown-item[data-style="hand-drawn"]').getAttribute('aria-selected')).toBe('true')
      expect(JSON.parse(await page.locator('#cfg-advanced-options').inputValue()).padding).toBe(64)
      expect(await page.locator('#runtime-recovery').isVisible()).toBe(false)
      await page.screenshot({ path: join(SCREENSHOTS, `current-runtime-restored-${width}.png`), animations: 'disabled' })
    } finally { await page.close(); served.server.stop(true) }
  }, 60_000)

  test('reload recovery stays on the current diagram when state encoding is unavailable', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const source = 'sequenceDiagram\nAlice->>Bob: Keep this draft'
    try {
      await page.goto(base + '/editor/?empty=1')
      await page.locator('#code-editor').fill('flowchart LR\nA-->B')
      await waitForVerifiedRender(page)
      await page.route('**/editor/runtime/**', route => route.abort())
      await page.locator('#code-editor').fill(source)
      await page.waitForFunction(() => document.getElementById('status-text')?.textContent === 'Error')
      const url = page.url()
      await page.evaluate(() => { Object.defineProperty(window, 'CompressionStream', { value: undefined, configurable: true }) })
      await page.locator('#reload-editor').click()
      await page.waitForFunction(() => document.getElementById('toast')?.textContent?.includes('Copy or export the source first'))
      expect(page.url()).toBe(url)
      expect(await page.locator('#code-editor').inputValue()).toBe(source)
      expect(await page.locator('#reload-editor').isEnabled()).toBe(true)
    } finally { await page.close() }
  }, 60_000)

  test('preview rendering uses one persistent worker and a late result cannot replace the newest verified source', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.clock.install()
    await wrapAdapter(page, 'renderMermaidSVGWithReceipt', `function(original) {
      window.__heldPreviews = {};
      return async function(source, options) {
        var artifact = await original(source, options);
        var key = source.indexOf('Earlier') >= 0 ? 'earlier' : source.indexOf('Slow') >= 0 ? 'slow' : null;
        if (key) {
          await new Promise(function(done) { window.__heldPreviews[key] = done; });
          delete window.__heldPreviews[key];
        }
        return artifact;
      };
    }`)
    await page.goto(`${base}/editor/?empty=1`, { waitUntil: 'networkidle' })
    const workerStarted = page.waitForEvent('worker')
    await page.locator('#code-editor').fill('flowchart LR\nEarlier --> Result')
    await workerStarted
    await page.waitForFunction(() => typeof (window as any).__heldPreviews.earlier === 'function')
    await page.locator('#code-editor').fill('flowchart LR\nNewest --> Verified')
    await page.waitForFunction(() => document.getElementById('status-text')?.textContent === 'OK' && document.getElementById('preview-inner')?.textContent?.includes('Newest'))
    await page.evaluate(() => (window as any).__heldPreviews.earlier())
    await page.waitForFunction(() => !(window as any).__heldPreviews.earlier)
    // The released promise and the editor's continuation finish before the next frame.
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => done())))
    expect(await page.locator('#preview-inner svg').textContent()).toContain('Newest')
    expect(await page.locator('#preview-inner svg').textContent()).not.toContain('Earlier')
    expect(await page.locator('#render-time').textContent()).toContain('Rendered and verified')
    expect(page.workers()).toHaveLength(1)
    await page.locator('#code-editor').fill('flowchart LR\nSlow --> Verified')
    await page.waitForFunction(() => typeof (window as any).__heldPreviews.slow === 'function')
    await page.clock.fastForward(500)
    await page.evaluate(() => (window as any).__heldPreviews.slow())
    await page.waitForFunction(() => document.getElementById('status-text')?.textContent === 'OK' && document.getElementById('preview-inner')?.textContent?.includes('Slow'))
    // Inspect the requested debounce, rather than a flaky wall-clock bound.
    // The delayed background response must not force a 300 ms pause on input.
    const delays = await page.evaluate(() => {
      const captured: number[] = [], original = window.setTimeout
      ;(window as any).setTimeout = (callback: TimerHandler, delay?: number, ...args: unknown[]) => {
        captured.push(delay ?? 0)
        return original(callback, delay, ...args)
      }
      try {
        const input = document.getElementById('code-editor') as HTMLTextAreaElement
        input.value = 'flowchart LR\nPrompt --> Verified'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      } finally { window.setTimeout = original }
      return captured
    })
    expect(delays[0]).toBeGreaterThanOrEqual(60)
    expect(delays[0]).toBeLessThan(300)
    await page.waitForFunction(() => document.getElementById('status-text')?.textContent === 'OK' && document.getElementById('preview-inner')?.textContent?.includes('Prompt'))
    await page.close()
  }, 60_000)

  test('docs replay is keyboard operable and needs no client renderer to show the verified edit', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const requested: string[] = []
    page.on('request', request => requested.push(request.url()))
    await page.goto(`${base}/docs/`, { waitUntil: 'networkidle' })
    const demo = page.locator('[data-edit-demo]')
    expect(await demo.locator('[data-edit-panel="0"]').isVisible()).toBe(true)
    mkdirSync(SCREENSHOTS, { recursive: true })
    await demo.screenshot({ path: join(SCREENSHOTS, 'current-docs-edit-before.png'), animations: 'disabled' })
    const apply = demo.getByRole('button', { name: 'Apply typed edit' })
    await apply.focus()
    await page.keyboard.press('Enter')
    expect(await apply.getAttribute('aria-pressed')).toBe('true')
    expect(await demo.locator('[data-edit-panel="1"] svg').textContent()).toContain('Approved')
    expect(await demo.getByRole('status').textContent()).toBe('Edited diagram verified: 0 warnings.')
    await demo.screenshot({ path: join(SCREENSHOTS, 'current-docs-edit-after.png'), animations: 'disabled' })
    expect(await demo.getByRole('link', { name: 'Open edited diagram in the editor' }).getAttribute('href')).toStartWith('/editor/#deflate:')
    expect(requested.some(url => /\/editor\/runtime\/|browser-preview-worker|browser-lazy/.test(url))).toBe(false)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.close()
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
    // A fake clock (flowing naturally until runFor) lets the test advance the
    // page's timers by an exact interval instead of sleeping on the runner.
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await context.clock.install()
    const page = await context.newPage()
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
    // toast replacement interval; fire every page timer due in that interval.
    await context.clock.runFor(250)
    const observed = await page.evaluate(() => ({
      writes: (window as any).__appClipboardWrites as string[],
      copyToasts: ((window as any).__toasts as string[]).filter(message => /cop(?:y|ied)/i.test(message)),
    }))
    expect(observed).toEqual({ writes: [], copyToasts: [] })
    await context.close()
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

  test.each(['access', 'operation'] as const)('the editor boots, edits and changes preferences when storage %s is denied', async failure => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(mode => {
      const deny = () => { throw new DOMException('storage denied', 'SecurityError') }
      if (mode === 'access') {
        for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, { configurable: true, get: deny })
      } else {
        for (const name of ['getItem', 'setItem', 'removeItem'] as const) Storage.prototype[name] = deny
      }
    }, failure)
    await page.goto(`${base}/editor/?example=flowchart-basic`, { waitUntil: 'networkidle' })
    await waitForVerifiedRender(page)
    await page.evaluate(() => { document.getElementById('status-text')!.textContent = 'awaiting-test-render' })
    await page.locator('#code-editor').fill('flowchart TD\n  Edited --> Safely')
    await waitForVerifiedRender(page)
    const labels = await page.locator('#preview-inner svg').textContent()
    expect(labels).toContain('Edited')
    expect(labels).toContain('Safely')
    const toggle = page.locator('#dark-light-btn')
    const previousLabel = await toggle.getAttribute('aria-label')
    await toggle.click()
    expect(await toggle.getAttribute('aria-label')).not.toBe(previousLabel)
    for (const [kind, value] of [['theme', 'paper'], ['theme', ''], ['style', 'hand-drawn'], ['style', 'crisp']] as const) {
      await page.evaluate(() => { document.getElementById('status-text')!.textContent = 'awaiting-test-render' })
      await page.locator(`#${kind}-dropdown-btn`).click()
      const choice = page.locator(`.theme-dropdown-item[data-${kind}="${value}"]`)
      await choice.click()
      expect(await choice.getAttribute('aria-selected'), `${kind}/${value || 'default'}`).toBe('true')
      await waitForVerifiedRender(page)
      expect(await page.locator('#preview-inner svg').textContent()).toContain('Edited')
    }
    expect(errors).toEqual([])
    await page.close()
  }, 60_000)

  test('the preview accepts exactly one verified SVG document from the renderer', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.addInitScript(() => { (window as any).__smuggledRan = 0 })
    await wrapAdapter(page, 'renderMermaidSVGWithReceipt', `function(original) {
      return async function(source, options) {
        var artifact = await original(source, options);
        if (source.indexOf('Smuggle') >= 0) {
          return Object.assign({}, artifact, { svg: artifact.svg + '<p id="smuggled-by-renderer">smuggled</p>' });
        }
        if (source.indexOf('Handler') >= 0) {
          return Object.assign({}, artifact, { svg: artifact.svg.replace('<svg ', '<svg onmouseover="window.__smuggledRan = 1" ') });
        }
        if (source.indexOf('ActiveScript') >= 0) {
          return Object.assign({}, artifact, { svg: artifact.svg.replace('</svg>', '<script>window.__smuggledRan = 1</script></svg>') });
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
    const script = await render('flowchart TD\n  ActiveScript --> Rejected')
    expect(script).toMatchObject({ status: 'Error', smuggled: false, handlers: 0 })
    expect(script.childTags).not.toContain('svg')
    expect(script.error).toContain('Unsafe SVG output blocked:')
    expect(await page.evaluate(() => (window as any).__smuggledRan)).toBe(0)
    await page.close()
  }, 60_000)

  test('C4 boundary navigation keeps canonical exports, source identities and interaction indices intact', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
    await wrapAdapter(page, 'renderMermaidSVGWithReceipt', `function(original) {
      return async function(source, options) {
        var artifact = await original(source, options);
        window.__c4Artifact = artifact;
        return artifact;
      };
    }`)
    const source = `C4Dynamic
System_Boundary("A\tB","Payments") {
  Container(api,"API","Go")
  ContainerDb(db,"Store","SQL")
}
Person(user,"Customer")
System(other,"Unrelated context")
RelIndex(42,api,db,"First")
Rel(api,db,"Second")
Rel_Back(user,api,"Replies")`
    await page.goto(`${base}/editor/#${shareHash({ source, palette: 'paper', style: 'crisp' })}`, { waitUntil: 'networkidle' })
    await waitForVerifiedRender(page)
    const snapshot = () => page.evaluate(() => ({
      svg: (window as any).__c4Artifact.svg,
      receipt: (window as any).__c4Artifact.receipt,
      viewBox: document.querySelector('#preview-inner svg')!.getAttribute('viewBox'),
      source: (document.getElementById('code-editor') as HTMLTextAreaElement).value,
    }))
    const before = await snapshot()
    expect(await page.locator('#c4-navigation').isVisible()).toBe(true)
    await page.locator('#c4-boundary-view').selectOption('A\tB')
    expect(await page.locator('#c4-boundary-view').inputValue()).toBe('A\tB')
    expect(await snapshot()).toEqual(before)
    const focused = await page.evaluate(() => {
      const frame = Array.from(document.querySelectorAll('#preview-inner g.c4-boundary')).find(element => element.getAttribute('data-id') === 'A\tB')!.getBoundingClientRect()
      const viewport = document.getElementById('preview-body')!.getBoundingClientRect()
      return frame.left >= viewport.left - 2 && frame.right <= viewport.right + 2 && frame.top >= viewport.top - 2 && frame.bottom <= viewport.bottom + 2
    })
    expect(focused).toBe(true)
    await page.locator('#export-chevron-btn').click()
    const download = page.waitForEvent('download', { timeout: 30_000 })
    await page.locator('#export-svg-btn').click()
    const exported = readFileSync((await (await download).path())!, 'utf8')
    expect(exported).toContain('data-id="other"')
    expect(exported).toContain('data-index="42"')
    expect(exported).toContain('Second')
    expect(exported).toContain('Replies')
    await page.locator('#export-chevron-btn').click()
    const sourceDownload = page.waitForEvent('download', { timeout: 30_000 })
    await page.locator('#export-source-btn').click()
    expect(readFileSync((await (await sourceDownload).path())!, 'utf8')).toBe(source)
    await page.locator('#format-unicode').click()
    expect(await page.locator('#c4-navigation').isVisible()).toBe(false)
    await page.locator('#format-diagram').click()
    expect(await page.locator('#c4-boundary-view').inputValue()).toBe('A\tB')
    await page.locator('#c4-boundary-view').selectOption('')
    expect(await snapshot()).toEqual(before)
    await page.evaluate(() => { document.getElementById('status-text')!.textContent = 'awaiting-test-render' })
    await page.locator('#code-editor').fill('flowchart LR\nA --> B')
    await waitForVerifiedRender(page)
    expect(await page.locator('#c4-navigation').isVisible()).toBe(false)
    await page.close()
  }, 60_000)

  describe('Packet inspection', () => {
    const source = '---\nconfig:\n  packet:\n    bitsPerRow: 8\n    bitOrder: descending\n    showBits: false\n---\npacket\n+3: "Mode"\n+12: "Authentication tag"'

    async function openPacket(page: Page) {
      await page.goto(`${base}/editor/#${shareHash({ source, palette: 'paper', style: 'crisp' })}`, { waitUntil: 'networkidle' })
      await waitForVerifiedRender(page)
    }

    test('SVG fields have one tab stop per authored field and support Enter and Space', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      try {
        await openPacket(page)
        const mode = page.locator('#preview-inner g[data-field-id="field-0"][tabindex="0"]')
        const authentication = page.locator('#preview-inner g[data-field-id="field-1"][tabindex="0"]')
        const select = page.getByLabel('Packet field', { exact: true })
        const details = page.locator('#packet-field-details')
        expect(await mode.count()).toBe(1)
        expect(await authentication.count()).toBe(1)
        await mode.focus()
        expect(await details.textContent()).toContain('Mode: bits 0–2 (3 bits)')
        await page.keyboard.press('Tab')
        expect(await authentication.evaluate(element => element === document.activeElement)).toBe(true)
        expect(await details.textContent()).toContain('bits 3–14 (12 bits); byte offsets 0–1, starting at bit 3')
        for (const key of ['Enter', 'Space']) {
          // Focus already inspects the field. Clear it without moving focus
          // so each activation key must restore the inspection itself.
          await select.selectOption('')
          expect(await page.locator('#preview-inner g[data-packet-inspected]').count()).toBe(0)
          expect(await authentication.evaluate(element => element === document.activeElement)).toBe(true)
          await page.keyboard.press(key)
          expect(await details.textContent()).toContain('bits 3–14 (12 bits); byte offsets 0–1, starting at bit 3')
          expect(await page.locator('#preview-inner g[data-field-id="field-1"][data-packet-inspected]').count()).toBe(2)
        }
        mkdirSync(SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: join(SCREENSHOTS, 'current-packet-inspection.png'), animations: 'disabled' })
        await page.keyboard.press('Shift+Tab')
        expect(await mode.evaluate(element => element === document.activeElement)).toBe(true)
        expect(await details.textContent()).toContain('Mode: bits 0–2 (3 bits)')
      } finally { await page.close() }
    }, 60_000)

    test('dropdown selection updates field details and every row fragment', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      try {
        await openPacket(page)
        const select = page.getByLabel('Packet field', { exact: true })
        const details = page.locator('#packet-field-details')
        expect(await select.locator('option').allTextContents()).toEqual(['Choose a field', 'Mode (0–2)', 'Authentication tag (3–14)'])
        // Native dropdown keyboard gestures differ by OS; commit the choice
        // through Playwright's select API to exercise our change handler.
        await select.selectOption('field-1')
        expect(await details.textContent()).toContain('bits 3–14 (12 bits); byte offsets 0–1, starting at bit 3')
        expect(await page.locator('#preview-inner g[data-field-id="field-1"][data-packet-inspected]').count()).toBe(2)
        await select.selectOption('field-0')
        expect(await details.textContent()).toContain('Mode: bits 0–2 (3 bits)')
        expect(await page.locator('#preview-inner g[data-field-id="field-0"][data-packet-inspected]').count()).toBe(1)
        expect(await page.locator('#preview-inner g[data-field-id="field-1"][data-packet-inspected]').count()).toBe(0)
        await select.selectOption('')
        expect(await details.textContent()).toBe('Select a field to inspect its bit range and byte offsets.')
        expect(await page.locator('#preview-inner g[data-packet-inspected]').count()).toBe(0)
      } finally { await page.close() }
    }, 60_000)

    test('selection survives switching between diagram and text panes', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      try {
        await openPacket(page)
        const select = page.getByLabel('Packet field', { exact: true })
        await select.selectOption('field-0')
        await page.locator('#format-unicode').click()
        expect(await select.isVisible()).toBe(false)
        await page.locator('#format-diagram').click()
        expect(await select.isVisible()).toBe(true)
        expect(await select.inputValue()).toBe('field-0')
        expect(await page.locator('#packet-field-details').textContent()).toContain('Mode: bits 0–2 (3 bits)')
      } finally { await page.close() }
    }, 60_000)

    test('inspection leaves the canonical artifact, source and SVG export intact', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
      try {
        await wrapAdapter(page, 'renderMermaidSVGWithReceipt', `function(original) {
          return async function(source, options) {
            var artifact = await original(source, options);
            window.__inspectedPacket = artifact;
            return artifact;
          };
        }`)
        await openPacket(page)
        const snapshot = () => page.evaluate(() => ({
          artifact: (window as any).__inspectedPacket,
          source: (document.getElementById('code-editor') as HTMLTextAreaElement).value,
        }))
        const before = await snapshot()
        await page.getByLabel('Packet field', { exact: true }).selectOption('field-1')
        expect(await page.locator('#preview-inner g[data-packet-inspected]').count()).toBe(2)
        expect(await snapshot()).toEqual(before)
        await page.locator('#export-chevron-btn').click()
        const download = page.waitForEvent('download', { timeout: 30_000 })
        await page.locator('#export-svg-btn').click()
        const exported = readFileSync((await (await download).path())!, 'utf8')
        expect(exported).toContain('data-field-label="Authentication tag"')
        expect(exported).not.toContain('data-packet-inspected')
        expect(exported).not.toContain('tabindex=')
      } finally { await page.close() }
    }, 60_000)
  })

  test('Kanban preview wrapping is explicit, follows scheduled viewport changes and preserves receipt parity', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
    await wrapAdapter(page, 'renderMermaidSVGWithReceipt', `function(original) {
      return async function(source, options) {
        var artifact = await original(source, options);
        window.__wrappedBoard = { artifact: artifact, options: options };
        return artifact;
      };
    }`)
    const source = 'kanban\nBacklog\n  a[Authored task]\nActive\n  b[Review API]\nReview\n  c[Verify]\nDone\n  d[Shipped]'
    await page.goto(`${base}/editor/#${shareHash({ source, palette: 'paper', style: 'crisp' })}`, { waitUntil: 'networkidle' })
    await waitForVerifiedRender(page)
    const wrap = page.getByLabel('Wrap board to preview width', { exact: true })
    expect(await wrap.isChecked()).toBe(false)
    const original = await page.evaluate(() => (window as any).__wrappedBoard.artifact.receipt.sharedRequestDigest)
    await wrap.check()
    await page.waitForFunction(() => (window as any).__wrappedBoard.options.kanban?.maxWidth > 0 && document.getElementById('status-text')?.textContent === 'OK')
    const width = await page.evaluate(() => (window as any).__wrappedBoard.options.kanban.maxWidth)
    expect(await page.locator('#zoom-label').textContent()).toBe('100%')
    expect(await page.locator('#kanban-wrap-note').isVisible()).toBe(true)
    expect(await page.locator('#preview-inner svg').evaluate(svg => Number(svg.getAttribute('viewBox')!.split(/\s+/)[2]))).toBeLessThanOrEqual(width)
    expect(await page.locator('#preview-inner [data-id="a"]').getAttribute('data-parent')).toBe('Backlog')
    mkdirSync(SCREENSHOTS, { recursive: true })
    await page.screenshot({ path: join(SCREENSHOTS, 'current-kanban-wrapped.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 1000, height: 900 })
    await page.waitForFunction(previous => (window as any).__wrappedBoard.options.kanban.maxWidth < previous && document.getElementById('status-text')?.textContent === 'OK', width)
    await page.locator('#format-unicode').click()
    await page.waitForFunction(() => !!document.getElementById('preview-inner')?.dataset.unicodeSharedRequestDigest)
    expect(await page.evaluate(() => {
      const data = document.getElementById('preview-inner')!.dataset
      return data.unicodeSharedRequestDigest === data.sharedRequestDigest
    })).toBe(true)
    expect(await page.locator('#unicode-output').textContent()).toContain('Authored task')
    await page.locator('#format-diagram').click()
    await wrap.uncheck()
    await page.waitForFunction(digest => (window as any).__wrappedBoard.artifact.receipt.sharedRequestDigest === digest && document.getElementById('status-text')?.textContent === 'OK', original)
    expect(await page.locator('#code-editor').inputValue()).toBe(source)
    await page.close()
  }, 60_000)

  test.each([320, 390, 1280])('export actions stay visible and keyboard reachable at %dpx', async width => {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    await page.goto(`${base}/editor/?example=flowchart-basic`, { waitUntil: 'networkidle' })
    await waitForVerifiedRender(page)
    await page.getByRole('button', { name: 'More export options', exact: true }).click()
    const sourceAction = page.getByRole('button', { name: 'Save Mermaid source', exact: true })
    await sourceAction.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    expect(await sourceAction.evaluate(element => element === document.activeElement)).toBe(true)
    const bounds = await page.getByRole('dialog', { name: 'Export options', exact: true }).boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    await page.keyboard.press('Escape')
    expect(await page.getByRole('button', { name: 'More export options', exact: true }).getAttribute('aria-expanded')).toBe('false')
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
