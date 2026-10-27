import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chromium, type Browser, type Route } from 'playwright'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeSvg } from './helpers/svg-normalize.ts'
const browserTests = process.env.AM_BROWSER_TESTS === '1' ? describe : describe.skip
let browser: Browser, server: ReturnType<typeof Bun.serve>, directory: string
// Authored independent witness: two nested call levels, conditional replies,
// alias identity, and the final async message returning to the original actor.
const checkout = readFileSync(join(import.meta.dir, 'testdata/zenuml-checkout.mmd'), 'utf8')

browserTests('explicit upstream ZenUML browser backend', () => {
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'am-zenuml-test-'))
    const result = await Bun.build({ entrypoints: [join(import.meta.dir, '../zenuml/upstream.ts')], outdir: directory, target: 'browser', splitting: true })
    if (!result.success) throw Error(result.logs.join('\n'))
    const frame = await Bun.build({ entrypoints: [join(import.meta.dir, '../zenuml/frame.ts')], outdir: directory, target: 'browser', format: 'iife' })
    if (!frame.success) throw Error(frame.logs.join('\n'))
    server = Bun.serve({
      port: 0,
      fetch: request => {
        const path = new URL(request.url).pathname
        if (path === '/') return new Response('<!doctype html><html><body><style>.message-label{font:31px monospace}</style><p class="message-label" id="host">Host control</p><div id="output"></div></body></html>', { headers: { 'Content-Type': 'text/html' } })
        if (path === '/trusted') return new Response('<!doctype html><html><body></body></html>', { headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "require-trusted-types-for 'script'" } })
        if (path === '/frame.js') return new Response(Bun.file(join(directory, 'frame.js')), { headers: { 'Content-Type': 'text/javascript' } })
        if (path === '/index.js') return new Response(Bun.file(join(directory, 'upstream.js')), { headers: { 'Content-Type': 'text/javascript' } })
        if (/^\/[\w-]+\.js$/.test(path) && existsSync(join(directory, path.slice(1)))) return new Response(Bun.file(join(directory, path.slice(1))), { headers: { 'Content-Type': 'text/javascript' } })
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
      const svg = await api.renderUpstreamZenUMLSVG('zenuml\ntitle Demo\nAlice->John: Hello John, how are you?\nJohn->Alice: Great!\nAlice->John: See you later!', { backendURL: '/frame.js', timeoutMs: 10_000 })
      document.getElementById('output')!.style.width = '200px'
      document.getElementById('output')!.innerHTML = svg
      const bounds = document.querySelector('#output svg')!.getBoundingClientRect()
      const after = document.head.innerHTML + getComputedStyle(document.getElementById('host')!).font
      const failure = async (source: string, backendURL: string, style?: string) => {
        try {
          await api.renderUpstreamZenUMLSVG(source, { backendURL, timeoutMs: 1000, ...(style ? { style } : {}) })
          return 'unexpected-success'
        } catch (error) {
          return (error as { code: string }).code
        }
      }
      return { svg, before, after, unsupportedStyle: await failure('zenuml\nA->B: hi', '/frame.js', 'hand-drawn'), renderedWidth: bounds.width, renderedHeight: bounds.height, invalid: await failure('zenuml\nif (', '/frame.js'), missing: await failure('zenuml\nA->B: hi', '/missing.js'), malformed: await failure('zenuml\nA->B: hi', 'http://['), frames: document.querySelectorAll('iframe').length }
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
    expect(result.unsupportedStyle).toBe('UNSUPPORTED_APPEARANCE')
    expect(result.invalid).toBe('INVALID_SOURCE')
    expect(result.missing).toBe('BACKEND_UNAVAILABLE')
    expect(result.malformed).toBe('BACKEND_UNAVAILABLE')
    expect(result.frames).toBe(0)
    await page.close()
  }, 30_000)

  test('complex owned calls and replies remain visible through palette changes and paint-only style composition', async () => {
    const page = await browser.newPage()
    await page.goto(`http://localhost:${server.port}`)
    const results = await page.evaluate(async source => {
      const entry = '/index.js', api = await import(entry)
      const renderer = api.createUpstreamZenUMLRenderer({ backendURL: '/frame.js' })
      const hostBefore = document.head.innerHTML + getComputedStyle(document.getElementById('host')!).font
      const snapshots = []
      const observe = (svg: string) => {
        document.getElementById('output')!.innerHTML = svg
        const root = document.querySelector<SVGSVGElement>('#output > svg')!
        const viewport = root.getBoundingClientRect()
        const paint = (selector: string, property: 'fill' | 'stroke') => getComputedStyle(root.querySelector(selector)!).getPropertyValue(property)
        const participants = [...root.querySelectorAll('.participant')].map(element => {
          const box = element.querySelector('rect')!
          return { id: element.getAttribute('data-participant'), label: element.querySelector('.participant-label')!.textContent, center: Number(box.getAttribute('x')) + Number(box.getAttribute('width')) / 2 }
        })
        const routes = (selector: string) => [...root.querySelectorAll(selector)].map(element => {
          const line = element.querySelector('line')!
          return { label: element.querySelector('text')!.textContent, x1: Number(line.getAttribute('x1')), x2: Number(line.getAttribute('x2')), y: Number(line.getAttribute('y1')) }
        })
        return { svg, participants, messages: routes('.message'), replies: routes('.return'),
          fragment: root.querySelector('.fragment')!.textContent,
          fragmentBounds: root.querySelector('.fragment-border')!.getBoundingClientRect().toJSON(),
          replyBounds: [...root.querySelectorAll('.return-label')].map(element => element.getBoundingClientRect().toJSON()),
          clippedText: [...root.querySelectorAll('text')].filter(element => {
            const r = element.getBoundingClientRect()
            return r.left < viewport.left - 0.5 || r.top < viewport.top - 0.5 || r.right > viewport.right + 0.5 || r.bottom > viewport.bottom + 0.5
          }).map(element => element.textContent),
          background: paint('.frame-border-inner', 'fill'), foreground: paint('.frame-title', 'fill'),
          nodeFill: paint('.participant-box', 'fill'), nodeText: paint('.participant-label', 'fill'), nodeBorder: paint('.participant-box', 'stroke'),
          edge: paint('.message-line', 'stroke'), arrow: paint('.arrow-head path', 'stroke'), edgeText: paint('.message-label', 'fill'),
          groupFill: paint('.fragment-header', 'fill'), groupText: paint('.fragment-label', 'fill'), groupBorder: paint('.fragment-border', 'stroke'),
          fragmentIcon: paint('.fragment > svg path', 'stroke'), frames: document.querySelectorAll('iframe').length }
      }
      try {
        for (const style of ['github-light', 'dracula']) snapshots.push(observe(await renderer.render(source, { style })))
        const composed = observe(await renderer.render(source, { style: ['github-light', { roles: {
          node: { fillColor: '#ffeebb', borderColor: '#445566', textColor: '#102030' },
          edge: { strokeColor: '#334455', textColor: '#112233' },
          group: { fillColor: '#cceeff', borderColor: '#556677', textColor: '#223344' },
        } }] }))
        const mutable = { roles: { node: { fillColor: '#aabbcc' } } }
        const captured = renderer.render(source, { style: mutable })
        mutable.roles.node.fillColor = '#ff0000'
        const capturedPaint = observe(await captured).nodeFill
        const exotic = new Date()
        const rejected = renderer.render(source, { style: exotic })
        Object.setPrototypeOf(exotic, Object.prototype)
        const exoticCode = await rejected.then(() => 'unexpected-success', (error: { code: string }) => error.code)
        const reset = observe(await renderer.render(source))
        return { snapshots, composed, capturedPaint, exoticCode, reset, hostUnchanged: hostBefore === document.head.innerHTML + getComputedStyle(document.getElementById('host')!).font }
      } finally { renderer.dispose() }
    }, checkout)
    for (const [index, result] of results.snapshots.entries()) {
      expect(result.participants.map(p => [p.id, p.label])).toEqual([['Buyer', 'Customer'], ['API', 'API'], ['Store', 'Store']])
      expect(result.messages.map(m => m.label)).toEqual(['placeOrder()', 'reserve()', 'accepted'])
      expect(result.replies.map(m => m.label)).toEqual(['confirmation', 'unavailable'])
      const [buyer, api, store] = result.participants.map(p => p.center)
      for (const [route, from, to] of [[result.messages[0]!, buyer!, api!], [result.messages[1]!, api!, store!], [result.messages[2]!, api!, buyer!], ...result.replies.map(r => [r, api!, buyer!] as const)] as const) {
        expect(Math.abs(route.x1 - from)).toBeLessThanOrEqual(8)
        expect(Math.abs(route.x2 - to)).toBeLessThanOrEqual(8)
        expect(Math.sign(route.x2 - route.x1)).toBe(Math.sign(to - from))
      }
      expect(result.messages[0]!.y).toBeLessThan(result.messages[1]!.y)
      expect(result.messages[1]!.y).toBeLessThan(result.replies[0]!.y)
      expect(result.replies[1]!.y).toBeLessThan(result.messages[2]!.y)
      for (const label of ['Alt', 'inStock', '[else]']) expect(result.fragment).toContain(label)
      for (const bounds of result.replyBounds) {
        expect(bounds.top).toBeGreaterThan(result.fragmentBounds.top)
        expect(bounds.bottom).toBeLessThan(result.fragmentBounds.bottom)
      }
      expect(result.clippedText).toEqual([])
      expect(result.frames).toBe(1)
      expect(result.arrow).toBe(result.edge)
      expect(result.fragmentIcon).toBe(result.groupText)
      const golden = join(import.meta.dir, `testdata/styled/zenuml-checkout.${index === 0 ? 'github-light' : 'dracula'}.svg`)
      if (process.env.UPDATE_STYLED_BASELINE === '1') await Bun.write(golden, result.svg + '\n')
      else expect(normalizeSvg(result.svg)).toBe(normalizeSvg(await Bun.file(golden).text()))
    }
    // Authored palette literals, independent of the adapter's derived tones.
    expect(results.snapshots.map(r => [r.background, r.foreground])).toEqual([
      ['rgb(255, 255, 255)', 'rgb(31, 35, 40)'], ['rgb(40, 42, 54)', 'rgb(248, 248, 242)'],
    ])
    expect(results.composed).toMatchObject({ nodeFill: 'rgb(255, 238, 187)', nodeBorder: 'rgb(68, 85, 102)', nodeText: 'rgb(16, 32, 48)', edge: 'rgb(51, 68, 85)', edgeText: 'rgb(17, 34, 51)', groupFill: 'rgb(204, 238, 255)', groupBorder: 'rgb(85, 102, 119)', groupText: 'rgb(34, 51, 68)' })
    expect(results.capturedPaint).toBe('rgb(170, 187, 204)')
    expect(results.exoticCode).toBe('UNSUPPORTED_APPEARANCE')
    expect(results.reset).toMatchObject({ background: 'rgb(255, 255, 255)', nodeFill: 'rgb(255, 255, 255)', edge: 'rgb(0, 0, 0)' })
    expect(results.hostUnchanged).toBe(true)
    expect(await page.locator('iframe').count()).toBe(0)
    await page.close()
  }, 30_000)

  test('session requests preserve ordering, recover after errors and release active and queued work on disposal', async () => {
    const page = await browser.newPage()
    await page.goto(`http://localhost:${server.port}`)
    const result = await page.evaluate(async () => {
      const entry = '/index.js', api = await import(entry)
      const renderer = api.createUpstreamZenUMLRenderer({ backendURL: '/frame.js', timeoutMs: 10_000 })
      const outcome = async (operation: Promise<string>) => {
        try { return { svg: await operation } } catch (error) { return { code: (error as { code: string }).code } }
      }
      const requests = [renderer.render('zenuml\nA->B: first'), renderer.render('zenuml\nif ('), renderer.render('zenuml\nC->D: third', { style: 'dracula' }), renderer.render('zenuml\nE->F: fourth')]
      const outcomes = await Promise.all(requests.map(outcome))
      const sameFrame = document.querySelector('iframe')!
      const unsupported = await outcome(renderer.render('zenuml\nA->B: test', { style: { roles: { node: { fontSize: 40 } } } }))
      const timedOut = await outcome(renderer.render('zenuml\nA->B: deadline', { timeoutMs: 0.01 }))
      const recovered = await renderer.render('zenuml\nNewA->NewB: recovered')
      const replacedAfterTimeout = sameFrame !== document.querySelector('iframe')
      const warmedFrame = document.querySelector('iframe')
      let maximumFrames = 0, staleResults = 0
      for (let index = 0; index < 65; index++) {
        const svg = await renderer.render(`zenuml\nA->B: message_${index}`)
        if (!svg.includes(`>message_${index}<`)) staleResults++
        maximumFrames = Math.max(maximumFrames, document.querySelectorAll('iframe').length)
      }
      const rotated = warmedFrame !== document.querySelector('iframe')
      const active = outcome(renderer.render('zenuml\nP->Q: active'))
      const queued = outcome(renderer.render('zenuml\nR->S: queued'))
      renderer.dispose()
      const cancelled = await Promise.all([active, queued])
      const disposed = await outcome(renderer.render('zenuml\nT->U: disposed'))
      const bounded = api.createUpstreamZenUMLRenderer({ backendURL: '/frame.js' })
      const pending = Array.from({ length: 32 }, () => outcome(bounded.render('zenuml\nA->B: pending')))
      const excess = await outcome(bounded.render('zenuml\nA->B: excess'))
      bounded.dispose()
      await Promise.all(pending)
      return { outcomes, unsupported, timedOut, recovered, replacedAfterTimeout, maximumFrames, staleResults, rotated, cancelled, disposed, excess, frames: document.querySelectorAll('iframe').length }
    })
    expect(result.outcomes[0]!.svg).toContain('first')
    expect(result.outcomes[1]!.code).toBe('INVALID_SOURCE')
    expect(result.outcomes[2]!.svg).toContain('third')
    expect(result.outcomes[2]!.svg).not.toContain('first')
    expect(result.outcomes[3]!.svg).toContain('fourth')
    expect(result.outcomes[3]!.svg).not.toContain('third')
    expect(result.unsupported.code).toBe('UNSUPPORTED_APPEARANCE')
    expect(result.timedOut.code).toBe('BACKEND_UNAVAILABLE')
    expect(result.recovered).toContain('recovered')
    expect(result.replacedAfterTimeout).toBe(true)
    expect(result.maximumFrames).toBe(1)
    expect(result.staleResults).toBe(0)
    expect(result.rotated).toBe(true)
    expect(result.cancelled.map(r => r.code)).toEqual(['BACKEND_UNAVAILABLE', 'BACKEND_UNAVAILABLE'])
    expect(result.disposed.code).toBe('BACKEND_UNAVAILABLE')
    expect(result.excess.code).toBe('BACKEND_UNAVAILABLE')
    expect(result.frames).toBe(0)
    await page.close()
  }, 30_000)

  test('reentrant option getters reserve FIFO position and queue capacity before calling user code', async () => {
    const page = await browser.newPage()
    await page.goto(`http://localhost:${server.port}`)
    const result = await page.evaluate(async () => {
      const entry = '/index.js', api = await import(entry)
      const bounded = []
      const outcome = (operation: Promise<string>) => operation.then(() => 'success', (error: { message: string }) => error.message)
      for (const field of ['style', 'timeoutMs']) {
        const renderer = api.createUpstreamZenUMLRenderer({ backendURL: '/frame.js' })
        const calls: Promise<string>[] = []
        const reenter = () => {
          for (let index = 0; index < 32; index++) calls.push(outcome(renderer.render(`zenuml\nA->B: nested_${index}`)))
        }
        const options = field === 'style'
          ? { style: Object.defineProperty({}, 'roles', { enumerable: true, get() { reenter(); return { node: { fillColor: '#aabbcc' } } } }) }
          : Object.defineProperty({}, 'timeoutMs', { get() { reenter(); return 1000 } })
        calls.push(outcome(renderer.render('zenuml\nA->B: outer', options)))
        renderer.dispose()
        const messages = await Promise.all(calls)
        bounded.push({ limited: messages.filter(message => message.includes('32 pending')).length, disposed: messages.filter(message => message.includes('disposed')).length })
      }
      const renderer = api.createUpstreamZenUMLRenderer({ backendURL: '/frame.js' })
      try {
        const order: string[] = [], calls: Promise<void>[] = []
        const style = Object.defineProperty({}, 'roles', { enumerable: true, get() {
          calls.push(renderer.render('zenuml\nA->B: nested').then(() => { order.push('nested') }))
          return { node: { fillColor: '#aabbcc' } }
        } })
        calls.push(renderer.render('zenuml\nA->B: outer', { style }).then(() => { order.push('outer') }))
        await Promise.all(calls)
        const rejected = await outcome(renderer.render('zenuml\nA->B: invalid', { style: Object.defineProperty({}, 'roles', { enumerable: true, get() { throw Error('rejected getter') } }) }))
        const valid = await renderer.render('zenuml\nA->B: after rejection')
        return { bounded, order, rejected, recovered: valid.includes('after rejection') }
      } finally { renderer.dispose() }
    })
    expect(result.bounded).toEqual([{ limited: 1, disposed: 32 }, { limited: 1, disposed: 32 }])
    expect(result.order).toEqual(['outer', 'nested'])
    expect(result.rejected).toContain('rejected getter')
    expect(result.recovered).toBe(true)
    expect(await page.locator('iframe').count()).toBe(0)
    await page.close()
  }, 30_000)

  test('disposal rejects queued work while optional palette admission is waiting for its module', async () => {
    const page = await browser.newPage()
    await page.goto(`http://localhost:${server.port}`)
    await page.evaluate(async () => {
      const entry = '/index.js', api = await import(entry)
      const state = globalThis as unknown as { renderer: { render(source: string, options: object): Promise<string>; dispose(): void }; pending: Promise<string> }
      state.renderer = api.createUpstreamZenUMLRenderer({ backendURL: '/frame.js' })
    })
    const held: Route[] = []
    await page.route('**/*.js', route => { held.push(route) })
    const importing = page.waitForRequest(request => request.url().endsWith('.js'))
    await page.evaluate(() => {
      const state = globalThis as unknown as { renderer: { render(source: string, options: object): Promise<string> }; pending: Promise<string> }
      state.pending = state.renderer.render('zenuml\nA->B: pending', { style: 'dracula' }).then(() => 'unexpected-success', (error: { code: string }) => error.code)
    })
    await importing
    const result = await page.evaluate(async () => {
      const state = globalThis as unknown as { renderer: { dispose(): void }; pending: Promise<string> }
      state.renderer.dispose()
      return { outcome: await state.pending, frames: document.querySelectorAll('iframe').length }
    })
    expect(held.length).toBeGreaterThan(0)
    expect(result).toEqual({ outcome: 'BACKEND_UNAVAILABLE', frames: 0 })
    const timedAdmission = await page.evaluate(async () => {
      const entry = '/index.js', api = await import(entry)
      const renderer = api.createUpstreamZenUMLRenderer({ backendURL: '/frame.js', timeoutMs: 1 })
      try { await renderer.render('zenuml\nA->B: deadline', { style: 'dracula' }); return 'unexpected-success' }
      catch (error) { return (error as { code: string }).code }
      finally { renderer.dispose() }
    })
    expect(timedAdmission).toBe('BACKEND_UNAVAILABLE')
    for (const route of held) await route.abort()
    await page.unroute('**/*.js')
    const failedImport = await page.evaluate(async () => {
      const entry = '/index.js', api = await import(entry)
      try { await api.renderUpstreamZenUMLSVG('zenuml\nA->B: missing palette', { backendURL: '/frame.js', style: 'dracula' }); return 'unexpected-success' }
      catch (error) { return (error as { code: string }).code }
    })
    expect(failedImport).toBe('BACKEND_UNAVAILABLE')
    expect(await page.locator('iframe').count()).toBe(0)
    await page.close()
  }, 30_000)

  test('a host Trusted Types refusal is a cleaned-up backend failure on every session request', async () => {
    const page = await browser.newPage()
    await page.goto(`http://localhost:${server.port}/trusted`)
    const result = await page.evaluate(async () => {
      const entry = '/index.js', api = await import(entry)
      const renderer = api.createUpstreamZenUMLRenderer({ backendURL: '/frame.js', timeoutMs: 10_000 })
      const errors = []
      try {
        for (const label of ['first', 'second']) {
          try { await renderer.render(`zenuml\nA->B: ${label}`); errors.push('unexpected-success') }
          catch (error) { errors.push((error as { code: string }).code) }
        }
        return { errors, frames: document.querySelectorAll('iframe').length }
      } finally { renderer.dispose() }
    })
    expect(result).toEqual({ errors: ['BACKEND_UNAVAILABLE', 'BACKEND_UNAVAILABLE'], frames: 0 })
    await page.close()
  }, 30_000)
})
