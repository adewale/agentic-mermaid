import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chromium, type Browser } from 'playwright'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeSvg } from './helpers/svg-normalize.ts'
const browserTests = process.env.AM_BROWSER_TESTS === '1' ? describe : describe.skip
let browser: Browser, server: ReturnType<typeof Bun.serve>, directory: string

browserTests('optional ZenUML browser backend', () => {
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'am-zenuml-test-'))
    const result = await Bun.build({ entrypoints: [join(import.meta.dir, '../zenuml/index.ts')], outdir: directory, target: 'browser' })
    if (!result.success) throw Error(result.logs.join('\n'))
    const frame = await Bun.build({ entrypoints: [join(import.meta.dir, '../zenuml/frame.ts')], outdir: directory, target: 'browser', format: 'iife' })
    if (!frame.success) throw Error(frame.logs.join('\n'))
    server = Bun.serve({
      port: 0,
      fetch: request => {
        const path = new URL(request.url).pathname
        if (path === '/') return new Response('<!doctype html><html><body><style>.message-label{font:31px monospace}</style><p class="message-label" id="host">Host control</p><div id="output"></div></body></html>', { headers: { 'Content-Type': 'text/html' } })
        if (path === '/frame.js') return new Response(Bun.file(join(directory, 'frame.js')), { headers: { 'Content-Type': 'text/javascript' } })
        if (path === '/index.js') return new Response(Bun.file(join(directory, 'index.js')), { headers: { 'Content-Type': 'text/javascript' } })
        return new Response('missing', { status: 404 })
      },
    })
    browser = await chromium.launch()
  })
  afterAll(async () => {
    await browser?.close()
    server?.stop(true)
    if (directory) rmSync(directory, { recursive: true, force: true })
  })
  test('awaited SVG, invalid-source and missing-backend outcomes leave host styles and frames unchanged', async () => {
    const page = await browser.newPage()
    await page.goto(`http://localhost:${server.port}`)
    const result = await page.evaluate(async () => {
      const entry = '/index.js'
      const api = await import(entry)
      const before = document.head.innerHTML + getComputedStyle(document.getElementById('host')!).font
      const svg = await api.renderZenUMLSVG('zenuml\ntitle Demo\nAlice->John: Hello John, how are you?\nJohn->Alice: Great!\nAlice->John: See you later!', { backendURL: '/frame.js', timeoutMs: 10_000 })
      document.getElementById('output')!.style.width = '200px'
      document.getElementById('output')!.innerHTML = svg
      const bounds = document.querySelector('#output svg')!.getBoundingClientRect()
      const after = document.head.innerHTML + getComputedStyle(document.getElementById('host')!).font
      const failure = async (source: string, backendURL: string) => {
        try {
          await api.renderZenUMLSVG(source, { backendURL, timeoutMs: 1000 })
          return 'unexpected-success'
        } catch (error) {
          return (error as { code: string }).code
        }
      }
      return { svg, before, after, renderedWidth: bounds.width, renderedHeight: bounds.height, invalid: await failure('zenuml\nif (', '/frame.js'), missing: await failure('zenuml\nA->B: hi', '/missing.js'), malformed: await failure('zenuml\nA->B: hi', 'http://['), frames: document.querySelectorAll('iframe').length }
    })
    // Reviewed rendering golden: guard the pinned backend's actors, messages,
    // geometry and paints independently of source admission and CSS isolation.
    const golden = join(import.meta.dir, 'testdata/styled/zenuml-demo.svg')
    if (process.env.UPDATE_STYLED_BASELINE === '1') await Bun.write(golden, result.svg + '\n')
    else expect(normalizeSvg(result.svg)).toBe(normalizeSvg(await Bun.file(golden).text()))
    expect(result.svg).toContain('viewBox=')
    for (const label of ['Demo', 'Alice', 'John', 'Hello John', 'Great!']) expect(result.svg).toContain(label)
    expect(result.before).toBe(result.after)
    expect(result.renderedWidth).toBeLessThanOrEqual(200)
    expect(result.renderedHeight).toBeGreaterThan(0)
    expect(result.invalid).toBe('INVALID_SOURCE')
    expect(result.missing).toBe('BACKEND_UNAVAILABLE')
    expect(result.malformed).toBe('BACKEND_UNAVAILABLE')
    expect(result.frames).toBe(0)
    await page.close()
  }, 30_000)
})
