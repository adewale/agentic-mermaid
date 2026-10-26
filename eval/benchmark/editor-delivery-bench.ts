import './ci-policy-enforce.ts'
// Advisory delivery diagnostic: measure the actual requested graph at each
// interaction boundary, including work inside the persistent module worker.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { chromium } from 'playwright'
import { getFamily, knownBuiltinFamilies } from '../../src/agent/families.ts'
import type { createBrowserEditorAdapter } from '../../src/browser-editor-adapter.ts'
import { benchmarkHost, benchmarkOptions, positiveOption, sha256 } from './browser-bench-host.ts'
import { officialCorpusInventory } from '../shared/official-fences.ts'

type Adapter = ReturnType<typeof createBrowserEditorAdapter>
const options = benchmarkOptions(['--site', '--out', '--rounds', '--corpus'], ['--site', '--out'])
if (options.has('--corpus') && options.get('--corpus') !== 'official') throw new Error('--corpus must be official')
const site = resolve(options.get('--site')!), out = resolve(options.get('--out')!)
const rounds = positiveOption(options, '--rounds', 3)
mkdirSync(out, { recursive: true })
const reportPath = join(out, 'editor-delivery.json')
writeFileSync(reportPath, JSON.stringify({ status: 'incomplete', site }) + '\n')
const browser = await chromium.launch({ headless: true })
const samples: unknown[] = []
type FileMeasurement = { path: string; raw: number; gzip: number; brotli: number; sha256: string }
const stages: Array<{ round: number; stage: string; ms: number; requests: number; raw: number; gzip: number; brotli: number; files: FileMeasurement[] }> = []
const artifacts: unknown[] = []
const errors: string[] = []
const examples = knownBuiltinFamilies().map(id => ({ id, source: getFamily(id)!.example })).sort((a, b) => a.id === 'sequence' ? -1 : b.id === 'sequence' ? 1 : 0)
const measuredFiles = new Map<string, FileMeasurement>()
const official: unknown[] = []
try {
  for (let round = 1; round <= rounds; round++) {
    const host = await benchmarkHost({ '/': site })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, serviceWorkers: 'block' })
    await context.route('**/*', route => new URL(route.request().url()).origin === host.origin ? route.continue() : route.abort())
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(String(error)))
    const snapshot = (stage: string, ms: number) => {
      const files = [...host.fetched].sort().map(file => {
        const previous = measuredFiles.get(file)
        if (previous) return previous
        const bytes = readFileSync(file)
        const measured = { path: '/' + relative(site, file), raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length, brotli: brotliCompressSync(bytes, { params: { 1: 11, 2: 22 } }).length, sha256: sha256(bytes) }
        measuredFiles.set(file, measured)
        return measured
      })
      stages.push({ round, stage, ms, requests: files.length, raw: files.reduce((n, f) => n + f.raw, 0), gzip: files.reduce((n, f) => n + f.gzip, 0), brotli: files.reduce((n, f) => n + f.brotli, 0), files })
      console.log(`round ${round}: ${stage}: ${stages.at(-1)!.gzip} gzip bytes, ${files.length} distinct assets`)
    }
    try {
      const started = Date.now()
      await page.goto(host.origin + '/editor/?empty=1')
      await page.waitForFunction(() => !!(globalThis as unknown as { __mermaid?: Adapter }).__mermaid)
      await page.evaluate(() => document.fonts.ready)
      snapshot('blank', Date.now() - started)
      for (const nodes of [5, 50, 150]) for (let rep = 0; rep < 4; rep++) {
        let source = 'flowchart TD\n'
        for (let i = 1; i < nodes; i++) source += `n${Math.floor((i - 1) / 3)}[Node ${Math.floor((i - 1) / 3)}] --> n${i}[Node ${i}]\n`
        const result = await page.evaluate(async ({ source, rep }) => {
          const input = document.getElementById('code-editor') as HTMLTextAreaElement
          const status = document.getElementById('status-text')!
          status.textContent = 'benchmark-pending'
          const started = performance.now()
          const ready = new Promise<void>((done, reject) => {
            const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Preview timed out')) }, 30000)
            const observer = new MutationObserver(() => {
              if (!['OK', 'Error', 'Needs fixes', 'Verify error'].includes(status.textContent ?? '')) return
              observer.disconnect(); clearTimeout(timer)
              requestAnimationFrame(() => requestAnimationFrame(() => done()))
            })
            observer.observe(status, { childList: true, characterData: true, subtree: true })
          })
          input.value = source.replaceAll('[Node 0]', `[Root ${rep}]`)
          input.dispatchEvent(new Event('input', { bubbles: true }))
          await ready
          const preview = document.getElementById('preview-inner')!
          return { ms: performance.now() - started, status: status.textContent, receipt: preview.dataset.sharedRequestDigest, svg: preview.querySelector('svg')?.outerHTML }
        }, { source, rep })
        if (result.status !== 'OK' || !result.receipt) throw new Error(`Preview failed: ${nodes}/${rep}: ${JSON.stringify(result)}`)
        samples.push({ round, nodes, rep, ms: result.ms })
        if (nodes === 5 && rep === 0) snapshot('first-flowchart', result.ms)
        if (rep === 3) artifacts.push({ round, id: `tree-${nodes}`, svg: result.svg, receipt: result.receipt })
      }
      snapshot('flowchart-session', 0)
      for (const entry of examples) {
        const start = Date.now()
        const artifact = await page.evaluate(async source => {
          const api = (globalThis as unknown as { __mermaid: Adapter }).__mermaid
          const result = await api.renderMermaidSVGWithReceipt(source, { security: 'strict', embedFontImport: false })
          return { svg: result.svg, receipt: result.receipt, verification: result.verification }
        }, entry.source)
        if (!artifact.svg.includes('<svg')) throw new Error(`No SVG for ${entry.id}`)
        artifacts.push({ round, id: entry.id, ...artifact })
        if (entry.id === 'sequence') snapshot('sequence', Date.now() - start)
      }
      snapshot('all-svg-families', 0)
      const source = 'sequenceDiagram\n Alice->>Bob: Request\n Bob-->>Alice: Reply'
      await page.locator('#code-editor').fill(source)
      await page.waitForFunction(() => document.getElementById('status-text')?.textContent === 'OK' && document.getElementById('preview-inner')?.textContent?.includes('Request'))
      const textStart = Date.now()
      const terminal = await page.evaluate(async source => {
        const api = (globalThis as unknown as { __mermaid: Adapter }).__mermaid
        return { unicode: await api.renderMermaidUnicodeWithReceipt(source, { colorMode: 'none' }), ascii: await api.renderMermaidASCIIWithReceipt(source, { colorMode: 'none' }) }
      }, source)
      artifacts.push({ round, id: 'terminal', ...terminal })
      snapshot('terminal-output', Date.now() - textStart)
      const pngStart = Date.now(), download = page.waitForEvent('download', { timeout: 30000 })
      await page.locator('#export-main-btn').click()
      const saved = await download, bytes = readFileSync((await saved.path())!)
      writeFileSync(join(out, `export-${round}.png`), bytes)
      artifacts.push({ round, id: 'png', sha256: sha256(bytes), bytes: bytes.length })
      snapshot('png-export', Date.now() - pngStart)
      const styled = await page.evaluate(async source => {
        const api = (globalThis as unknown as { __mermaid: Adapter }).__mermaid
        const result = await api.renderMermaidSVGWithReceipt(source, { style: ['hand-drawn', 'paper'], seed: 7, security: 'strict', embedFontImport: false })
        return { svg: result.svg, receipt: result.receipt, verification: result.verification }
      }, source)
      artifacts.push({ round, id: 'styled', ...styled })
      for (const { source } of examples) await page.evaluate(async source => {
        const api = (globalThis as unknown as { __mermaid: Adapter }).__mermaid
        await api.renderMermaidUnicodeWithReceipt(source, { colorMode: 'none' })
      }, source)
      snapshot('all-families-and-features', 0)
      // This is warm output parity: the session above installed every family.
      // Cold source admission is exercised in fresh pages by browser contracts.
      if (round === 1 && options.get('--corpus') === 'official') {
        const inputs = officialCorpusInventory().occurrences
        for (let start = 0; start < inputs.length; start += 40) {
          official.push(...await page.evaluate(async inputs => {
            const api = (globalThis as unknown as { __mermaid: Adapter }).__mermaid
            const rows = []
            for (const input of inputs) {
              try {
                const result = await api.renderMermaidSVGWithReceipt(input.source, { security: 'strict', embedFontImport: false })
                const bytes = new TextEncoder().encode(JSON.stringify({ svg: result.svg, receipt: result.receipt, verification: result.verification }))
                const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
                rows.push({ id: input.id, ok: true, digest })
              } catch (error) { rows.push({ id: input.id, ok: false, error: String(error) }) }
            }
            return rows
          }, inputs.slice(start, start + 40)))
          console.log(`official ${Math.min(start + 40, inputs.length)}/${inputs.length}`)
        }
      }
    } finally { await context.close(); await host.close() }
  }
  if (errors.length) throw new Error(errors.join('\n'))
  writeFileSync(reportPath, JSON.stringify({ status: 'completed', advisory: true, site, browser: browser.version(), rounds, policy: 'Fresh contexts per delivery round, local uncompressed HTTP, remote assets blocked; compression estimates of distinct fetched assets, with cumulative stage counts/bytes rather than repeated wire transfers; three warm edits after a warmup per tree size. Official corpus output parity runs after all families/features are loaded; it does not test cold source admission.', stages, samples, artifacts, official, errors }, null, 2) + '\n')
} finally { await browser.close() }
