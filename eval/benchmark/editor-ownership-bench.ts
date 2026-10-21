// Controlled architecture experiment, separate from production/session timings.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { benchmarkHost, benchmarkOptions, driverRevision, positiveOption, sha256 } from './browser-bench-host.ts'
import { realmMemory } from './browser-realm-memory.ts'
import { editorSessionCases } from './editor-session-cases.ts'

const options = benchmarkOptions(['--site', '--out', '--executable', '--runs', '--candidate', '--case', '--style'], ['--site', '--out'])
const site = resolve(options.get('--site')!), out = resolve(options.get('--out')!), runs = positiveOption(options, '--runs', 7)
const candidate = options.get('--candidate') ?? 'candidate'
if (!/^[a-z-]+$/.test(candidate) || candidate === 'original') throw new Error('Invalid candidate filename')
const selected = options.get('--case')?.split(',') ?? ['tree-5']
const cases = editorSessionCases().filter(c => selected.includes(c.id))
if (selected.some(id => !cases.some(c => c.id === id))) throw new Error('Unknown case')
mkdirSync(out, { recursive: true })
const reportPath = join(out, 'ownership.json')
writeFileSync(reportPath, JSON.stringify({ status: 'incomplete' }) + '\n')
const host = await benchmarkHost({ '/': site }, {}, true)
const browser = await chromium.launch({ headless: true, executablePath: options.get('--executable') })
const samples = [], errors: string[] = []
try {
  for (const input of cases) for (let rep = 0; rep < runs; rep++) for (const variant of rep % 2 ? [candidate, 'original'] : ['original', candidate]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
    await context.route('**/*', route => new URL(route.request().url()).origin === host.origin ? route.continue() : route.abort())
    await context.addInitScript(() => {
      const Original = Worker
      globalThis.Worker = class extends Original {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options)
          this.addEventListener('error', e => console.error(`Worker error: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`))
        }
      }
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(String(error)))
    page.on('console', message => { if (message.type() === 'error') console.error(message.text()) })
    await page.goto(`${host.origin}/${variant}.html?empty=1`)
    await page.waitForFunction(() => (globalThis as any).__mermaid !== undefined)
    const shellReadyMs = await page.evaluate(() => performance.now())
    const empty = await realmMemory(browser, page)
    const preview = await page.evaluate(async ({ source, style }) => {
      const options = { security: 'strict', embedFontImport: false, ...(style ? { style, seed: 7 } : {}) }
      const start = performance.now()
      const artifact = await (globalThis as any).__mermaid.renderMermaidSVGWithReceipt(source, options)
      if (!artifact.verification.ok || !artifact.svg.includes('Ownership')) throw new Error('Preview failed')
      ;(globalThis as any).__ownershipInput = { source, options, digest: artifact.receipt.sharedRequestDigest }
      return { elapsedMs: performance.now() - start, computeMs: artifact.computeMs, svgBytes: artifact.svg.length, digest: artifact.receipt.sharedRequestDigest, svgDigest: artifact.receipt.graphicalProjectionDigest }
    }, { source: input.source.replaceAll('BENCH_LABEL', 'Ownership'), style: options.get('--style') })
    const afterPreview = await realmMemory(browser, page)
    // Use existing public adapters, including actual Canvas PNG rasterization.
    // The candidate selects the execution realm; Canvas stays on the main thread.
    const exports = await page.evaluate(async () => {
      const { source, options, digest } = (globalThis as any).__ownershipInput, api = (globalThis as any).__mermaid
      const started = performance.now()
      const ascii = await api.renderMermaidASCIIWithReceipt(source, { ...options, useAscii: true })
      const unicode = await api.renderMermaidUnicodeWithReceipt(source, options)
      if (![ascii, unicode].every(a => a.text.includes('Ownership') && a.receipt.sharedRequestDigest === digest)) throw new Error('Text receipt/content mismatch')
      const textMs = performance.now() - started
      const pngStarted = performance.now()
      const png = await api.renderMermaidPNGInBrowserWithReceipt(source, options, 1, async (svg: string, context: any) => {
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
        try {
          const image = new Image(); image.src = url; await image.decode()
          const canvas = document.createElement('canvas'); canvas.width = context.rasterDimensions.width; canvas.height = context.rasterDimensions.height
          const ctx = canvas.getContext('2d')!; ctx.fillStyle = context.rasterBackground; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
          const blob = await new Promise<Blob>((done, reject) => canvas.toBlob(b => b ? done(b) : reject(new Error('No PNG')), 'image/png'))
          return { png: new Uint8Array(await blob.arrayBuffer()), fontSources: ['unavailable'] }
        } finally { URL.revokeObjectURL(url) }
      })
      if (png.receipt.output !== 'png' || png.receipt.sharedRequestDigest !== digest || png.png[0] !== 137 || png.png[1] !== 80) throw new Error('PNG receipt/encoding mismatch')
      const pngMs = performance.now() - pngStarted
      const hash = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))].map(n => n.toString(16).padStart(2, '0')).join('')
      return { textMs, pngMs, asciiBytes: ascii.text.length, unicodeBytes: unicode.text.length, pngBytes: png.png.length,
        asciiDigest: await hash(new TextEncoder().encode(ascii.text)), unicodeDigest: await hash(new TextEncoder().encode(unicode.text)), pngDigest: await hash(png.png) }
    })
    const afterExports = await realmMemory(browser, page)
    samples.push({ id: input.id, variant, rep, shellReadyMs, empty, preview, afterPreview, exports, afterExports })
    await context.close()
    console.log(`Completed ownership probe ${rep}: ${variant}`)
  }
  if (errors.length) throw new Error(errors.join('; '))
  for (const input of cases) if (new Set(samples.filter(s => s.id === input.id).map(s => JSON.stringify([s.preview.svgDigest, s.exports.asciiDigest, s.exports.unicodeDigest, s.exports.pngDigest]))).size !== 1) throw new Error(`Preview/export bytes differ for ${input.id}`)
  writeFileSync(reportPath, JSON.stringify({ status: 'completed', advisory: true, experimental: true, driverRevision: driverRevision(), browser: browser.version(), runs,
    policy: 'fresh contexts; alternate variant ordering; no-store local uncompressed HTTP; shared browser/OS caches; empty and post-preview forced-GC outside operation timers; first preview directly invokes the production editor adapter; exports run ASCII, Unicode and actual Canvas PNG; JS heap excludes native/DOM/Blob backing and process RSS',
    cases, style: options.get('--style'), limitations: 'Retained JS heap excludes process/native/DOM/Blob memory. Exact output identity applies to selected fixtures, not arbitrary diagram fidelity.',
    artifacts: ['original', candidate].map(variant => ({ variant, sha256: sha256(readFileSync(join(site, variant + '.html'))) })), errors, samples }, null, 2) + '\n')
  console.log(reportPath)
} catch (error) { writeFileSync(reportPath, JSON.stringify({ status: 'failed', error: String(error) }) + '\n'); throw error }
finally { await browser.close(); await host.close() }
