import './ci-policy-enforce.ts'
// Controlled production-adapter comparison, separate from session timings.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { benchmarkHost, benchmarkOptions, driverRevision, positiveOption, sha256 } from './browser-bench-host.ts'
import { realmMemory } from './browser-realm-memory.ts'
import { editorSessionCases } from './editor-session-cases.ts'

type Outcome = { ok: false; elapsedMs: number; error: string }
  | { ok: true; elapsedMs: number; digest: string; hash: string }
interface OwnershipSample {
  id: string; variant: string; rep: number; shellReadyMs: number
  empty: Awaited<ReturnType<typeof realmMemory>>
  preview: Outcome
  afterPreview: Awaited<ReturnType<typeof realmMemory>>
  exports: { textMs: number; pngMs: number; ascii: Outcome; unicode: Outcome; png: Outcome }
  afterExports: Awaited<ReturnType<typeof realmMemory>>
}

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
const samplePath = join(out, 'samples.jsonl')
writeFileSync(samplePath, '')
const host = await benchmarkHost({ '/': site }, {}, true)
const browser = await chromium.launch({ headless: true, executablePath: options.get('--executable') })
const samples: OwnershipSample[] = [], errors: string[] = []
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
    await page.evaluate(() => {
      const api = (globalThis as any).__mermaid
      const methods = ['renderMermaidSVGWithReceipt', 'renderMermaidASCIIWithReceipt', 'renderMermaidUnicodeWithReceipt', 'renderMermaidPNGInBrowserWithReceipt']
      if (!api || methods.some(method => typeof api[method] !== 'function')) throw new Error('Editor adapter did not load all required operations')
    })
    const shellReadyMs = await page.evaluate(() => performance.now())
    const empty = await realmMemory(browser, page)
    const preview = await page.evaluate(async ({ source, style }) => {
      const options = { security: 'strict', embedFontImport: false, ...(style ? { style, seed: 7 } : {}) }
      const input = { source, options, digest: undefined as string | undefined }
      ;(globalThis as any).__ownershipInput = input
      const start = performance.now()
      let artifact, receipt
      try {
        artifact = await (globalThis as any).__mermaid.renderMermaidSVGWithReceipt(source, options)
      } catch (error) {
        return { ok: false as const, elapsedMs: performance.now() - start, error: error instanceof Error ? error.message : String(error) }
      }
      if (!artifact || typeof artifact !== 'object' || typeof artifact.svg !== 'string' || !('receipt' in artifact)) throw new Error('Malformed fulfilled SVG artifact')
      try { receipt = artifact.receipt }
      catch (error) { return { ok: false as const, elapsedMs: performance.now() - start, error: error instanceof Error ? error.message : String(error) } }
      const elapsedMs = performance.now() - start
      if (!receipt || typeof receipt !== 'object' || receipt.output !== 'svg' || typeof receipt.sharedRequestDigest !== 'string' || !receipt.sharedRequestDigest || typeof receipt.graphicalProjectionDigest !== 'string' || !receipt.graphicalProjectionDigest) throw new Error('Malformed fulfilled SVG receipt')
      if (!artifact.verification.ok || !artifact.svg.includes('Ownership')) throw new Error('Preview failed')
      input.digest = receipt.sharedRequestDigest
      const bytes = new TextEncoder().encode(artifact.svg)
      const svgHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')
      return { ok: true as const, elapsedMs, computeMs: artifact.computeMs, svgBytes: bytes.length, digest: receipt.sharedRequestDigest, svgDigest: receipt.graphicalProjectionDigest, hash: svgHash }
    }, { source: input.source.replaceAll('BENCH_LABEL', 'Ownership'), style: options.get('--style') })
    const afterPreview = await realmMemory(browser, page)
    // Use existing public adapters, including actual Canvas PNG rasterization.
    // The candidate selects the execution realm; Canvas stays on the main thread.
    const exports = await page.evaluate(async () => {
      const { source, options, digest } = (globalThis as any).__ownershipInput, api = (globalThis as any).__mermaid
      const hash = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))].map(n => n.toString(16).padStart(2, '0')).join('')
      const text = async (format: 'ascii' | 'unicode') => {
        const started = performance.now()
        let artifact, receipt
        try {
          artifact = await (format === 'ascii' ? api.renderMermaidASCIIWithReceipt(source, { ...options, useAscii: true }) : api.renderMermaidUnicodeWithReceipt(source, options))
        } catch (error) {
          return { ok: false as const, elapsedMs: performance.now() - started, error: error instanceof Error ? error.message : String(error) }
        }
        if (!artifact || typeof artifact !== 'object' || typeof artifact.text !== 'string' || !('receipt' in artifact)) throw new Error('Malformed fulfilled text artifact')
        // A canonical lazy receipt may reject on its own admission limits.
        try { receipt = artifact.receipt }
        catch (error) { return { ok: false as const, elapsedMs: performance.now() - started, error: error instanceof Error ? error.message : String(error) } }
        const elapsedMs = performance.now() - started
        if (!receipt || typeof receipt !== 'object' || typeof receipt.sharedRequestDigest !== 'string' || !receipt.sharedRequestDigest) throw new Error('Malformed fulfilled text receipt')
        if (!artifact.text.includes('Ownership') || receipt.output !== format || (digest && receipt.sharedRequestDigest !== digest)) throw new Error('Text receipt/content mismatch')
        const bytes = new TextEncoder().encode(artifact.text)
        return { ok: true as const, elapsedMs, bytes: bytes.length, hash: await hash(bytes), digest: receipt.sharedRequestDigest }
      }
      const ascii = await text('ascii'), unicode = await text('unicode')
      const pngStarted = performance.now()
      let artifact, failure: string | undefined
      try { artifact = await api.renderMermaidPNGInBrowserWithReceipt(source, options, 1, async (svg: string, context: any) => {
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
        try {
          const image = new Image(); image.src = url; await image.decode()
          const canvas = document.createElement('canvas'); canvas.width = context.rasterDimensions.width; canvas.height = context.rasterDimensions.height
          const ctx = canvas.getContext('2d')!; ctx.fillStyle = context.rasterBackground; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
          const blob = await new Promise<Blob>((done, reject) => canvas.toBlob(b => b ? done(b) : reject(new Error('No PNG')), 'image/png'))
          return { png: new Uint8Array(await blob.arrayBuffer()), fontSources: ['unavailable'] }
        } finally { URL.revokeObjectURL(url) }
      }) } catch (error) { failure = error instanceof Error ? error.message : String(error) }
      const pngMs = performance.now() - pngStarted
      if (!artifact && failure === undefined) throw new Error('PNG returned no artifact')
      if (artifact && (typeof artifact !== 'object' || !(artifact.png instanceof Uint8Array) || !artifact.receipt || typeof artifact.receipt.sharedRequestDigest !== 'string' || !artifact.receipt.sharedRequestDigest)) throw new Error('Malformed fulfilled PNG artifact')
      if (artifact && (artifact.receipt.output !== 'png' || (digest && artifact.receipt.sharedRequestDigest !== digest) || artifact.png[0] !== 137 || artifact.png[1] !== 80)) throw new Error('PNG receipt/encoding mismatch')
      const png = artifact ? { ok: true as const, elapsedMs: pngMs, bytes: artifact.png.length, hash: await hash(artifact.png), digest: artifact.receipt.sharedRequestDigest }
        : { ok: false as const, elapsedMs: pngMs, error: failure! }
      const identities = [digest, ...[ascii, unicode, png].filter(result => result.ok).map(result => result.digest)].filter(Boolean)
      if (new Set(identities).size > 1) throw new Error('Successful outputs disagree on request identity')
      return { textMs: ascii.elapsedMs + unicode.elapsedMs, pngMs, ascii, unicode, png }
    })
    const afterExports = await realmMemory(browser, page)
    const sample = { id: input.id, variant, rep, shellReadyMs, empty, preview, afterPreview, exports, afterExports }
    samples.push(sample)
    appendFileSync(samplePath, JSON.stringify(sample) + '\n')
    await context.close()
    console.log(`Completed ownership probe ${input.id} ${rep}: ${variant}`)
  }
  if (errors.length) throw new Error(errors.join('; '))
  for (const input of cases) for (const format of ['svg', 'ascii', 'unicode', 'png'] as const) {
    const signatures = samples.filter(s => s.id === input.id).map(sample => {
      const result = format === 'svg' ? sample.preview : sample.exports[format]
      return JSON.stringify(result.ok ? { ok: true, digest: result.digest, hash: result.hash } : { ok: false, error: result.error })
    })
    if (new Set(signatures).size !== 1) throw new Error(`Output acceptance, bytes or rejection differs for ${input.id}/${format}`)
  }
  const outcomes = cases.flatMap(input => ['original', candidate].flatMap(variant => (['svg', 'ascii', 'unicode', 'png'] as const).map(format => {
    const rows = samples.filter(s => s.id === input.id && s.variant === variant).map(s => format === 'svg' ? s.preview : s.exports[format])
    return { id: input.id, variant, format, attempts: rows.length, accepted: rows.filter(r => r.ok).length, errors: [...new Set(rows.filter(r => !r.ok).map(r => r.error))] }
  })))
  writeFileSync(reportPath, JSON.stringify({ status: 'completed', advisory: true, driverRevision: driverRevision(), browser: browser.version(), runs,
    policy: 'fresh contexts; alternate variant ordering; no-store local uncompressed HTTP; shared browser/OS caches; empty and post-preview forced-GC outside operation timers; first preview directly invokes the production editor adapter; exports run ASCII, Unicode and actual Canvas PNG; JS heap excludes native/DOM/Blob backing and process RSS',
    cases, style: options.get('--style'), limitations: 'Retained JS heap excludes process/native/DOM/Blob memory. Exact output identity applies to selected fixtures, not arbitrary diagram fidelity.',
    artifacts: ['original', candidate].map(variant => ({ variant, sha256: sha256(readFileSync(join(site, variant + '.html'))) })), errors, outcomes, samples }, null, 2) + '\n')
  console.log(reportPath)
} catch (error) { writeFileSync(reportPath, JSON.stringify({ status: 'failed', error: String(error), errors, samples }) + '\n'); throw error }
finally { await browser.close(); await host.close() }
