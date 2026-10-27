import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chromium, type Browser } from 'playwright'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
        if (path === '/') return new Response('<!doctype html><html><body><p id="host">Host control</p></body></html>', { headers: { 'Content-Type': 'text/html' } })
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
      const before = document.head.innerHTML + getComputedStyle(document.body).cssText
      const svg = await api.renderZenUMLSVG('zenuml\ntitle Demo\nAlice->John: Hello John\nJohn->Alice: Great!', { backendURL: '/frame.js', timeoutMs: 10_000 })
      const after = document.head.innerHTML + getComputedStyle(document.body).cssText
      const failure = async (source: string, backendURL: string) => {
        try {
          await api.renderZenUMLSVG(source, { backendURL, timeoutMs: 1000 })
          return 'unexpected-success'
        } catch (error) {
          return (error as { code: string }).code
        }
      }
      return { svg, before, after, invalid: await failure('zenuml\nif (', '/frame.js'), missing: await failure('zenuml\nA->B: hi', '/missing.js'), frames: document.querySelectorAll('iframe').length }
    })
    expect(result.svg).toContain('viewBox=')
    for (const label of ['Demo', 'Alice', 'John', 'Hello John', 'Great!']) expect(result.svg).toContain(label)
    expect(result.before).toBe(result.after)
    expect(result.invalid).toBe('INVALID_SOURCE')
    expect(result.missing).toBe('BACKEND_UNAVAILABLE')
    expect(result.frames).toBe(0)
    await page.close()
  }, 30_000)
})
