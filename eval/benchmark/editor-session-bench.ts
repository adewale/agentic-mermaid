import './ci-policy-enforce.ts'
// Advisory real-editor workloads. Does not replace Dave's raw SVG scorecard.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium, type Page } from 'playwright'
import { benchmarkHost, benchmarkOptions, driverRevision, percentile, positiveOption, sha256 } from './browser-bench-host.ts'
import { realmMemory } from './browser-realm-memory.ts'
import { editorSessionCases } from './editor-session-cases.ts'

const options = benchmarkOptions(['--site', '--entry', '--out', '--executable', '--cold-runs', '--warm-edits', '--session-edits', '--burst-edits', '--memory-every', '--case'], ['--site', '--out'])
const site = resolve(options.get('--site')!), out = resolve(options.get('--out')!), entry = options.get('--entry') ?? '/editor/'
const coldRuns = positiveOption(options, '--cold-runs', 5), warmEdits = positiveOption(options, '--warm-edits', 20)
const sessionEdits = positiveOption(options, '--session-edits', 60), burstEdits = positiveOption(options, '--burst-edits', 30)
const memoryEvery = options.has('--memory-every') ? positiveOption(options, '--memory-every', 100) : 0
const selected = options.get('--case')?.split(',')
const cases = editorSessionCases().filter(c => !selected || selected.includes(c.id))
if (!cases.length || selected?.some(id => !cases.some(c => c.id === id))) throw new Error('Unknown --case')
mkdirSync(out, { recursive: true })
const reportPath = join(out, 'editor-session.json')
writeFileSync(reportPath, JSON.stringify({ status: 'incomplete' }) + '\n')
const host = await benchmarkHost({ '/': site }, {}, entry.endsWith('.html'))
const browser = await chromium.launch({ headless: true, executablePath: options.get('--executable') })
const errors: string[] = [], samples: any[] = [], memory: any[] = [], telemetry: any[] = []
try {
  for (const input of cases) {
    for (let cold = 0; cold < coldRuns; cold++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
      await context.route('**/*', route => new URL(route.request().url()).origin === host.origin ? route.continue() : route.abort())
      await context.addInitScript(() => {
        const state = { created: 0, terminated: 0, posted: 0, received: 0, inFlight: 0, maxInFlight: 0, staleAuthority: 0, expectedLabel: '' }
        ;(globalThis as any).__benchWorkers = state
        const Original = globalThis.Worker
        globalThis.Worker = class extends Original {
          constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options); state.created++
            this.addEventListener('message', () => { state.received++; state.inFlight-- })
          }
          postMessage(message: any, options?: StructuredSerializeOptions | Transferable[]) {
            state.posted++; state.inFlight++; state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
            return Reflect.apply(Original.prototype.postMessage, this, [message, options])
          }
          terminate() { state.terminated++; super.terminate() }
        }
        document.addEventListener('DOMContentLoaded', () => {
          const preview = document.getElementById('preview-inner')!
          new MutationObserver(() => {
            if (state.expectedLabel && preview.dataset.sharedRequestDigest && !preview.textContent?.includes(state.expectedLabel)) state.staleAuthority++
          }).observe(preview, { attributes: true, childList: true, subtree: true })
        })
      })
      const page = await context.newPage()
      page.on('pageerror', error => errors.push(`${input.id}: ${error}`))
      await page.goto(host.origin + entry + '?empty=1')
      await page.waitForFunction(() => (globalThis as any).__mermaid !== undefined)
      const shellReadyMs = await page.evaluate(() => performance.now())
      const first = await edit(page, input.source, `Bench_cold_${cold}`)
      samples.push({ id: input.id, family: input.family, phase: 'cold', rep: cold, shellReadyMs, ...first })
      if (cold === 0) {
        memory.push({ id: input.id, phase: 'first-preview', ...await realmMemory(browser, page) })
        for (const [phase, count] of [['warm', warmEdits], ['session', sessionEdits]] as const) {
          for (let rep = 0; rep < count; rep++) {
            samples.push({ id: input.id, family: input.family, phase, rep, ...await edit(page, input.source, `Bench_${phase}_${rep}`) })
            if (phase === 'session' && memoryEvery && (rep + 1) % memoryEvery === 0) memory.push({ id: input.id, phase: `session-${rep + 1}`, ...await realmMemory(browser, page) })
          }
          memory.push({ id: input.id, phase: `after-${phase}`, ...await realmMemory(browser, page) })
        }
        samples.push({ id: input.id, family: input.family, phase: 'burst', rep: 0, ...await edit(page, input.source, 'Bench_burst', burstEdits) })
        memory.push({ id: input.id, phase: 'after-burst', ...await realmMemory(browser, page) })
      }
      telemetry.push({ id: input.id, cold, ...await page.evaluate(() => (globalThis as any).__benchWorkers) })
      await context.close()
    }
    console.log(`Completed editor workload: ${input.id}`)
    writeFileSync(join(out, 'samples.json'), JSON.stringify({ samples, memory, telemetry }, null, 2) + '\n')
  }
  if (errors.length || telemetry.some(t => t.staleAuthority || t.maxInFlight > 1)) throw new Error(`Editor integrity failure: ${JSON.stringify({ errors, telemetry })}`)
  const summary = cases.flatMap(input => ['cold', 'warm', 'session', 'burst'].map(phase => {
    const rows = samples.filter(s => s.id === input.id && s.phase === phase)
    return { id: input.id, family: input.family, phase, count: rows.length, medianMs: percentile(rows.map(r => r.elapsedMs), .5), p95Ms: percentile(rows.map(r => r.elapsedMs), .95),
      medianTimerGapMs: percentile(rows.map(r => r.maxTimerGapMs), .5), p95TimerGapMs: percentile(rows.map(r => r.maxTimerGapMs), .95),
      medianNavigationToVerifiedMs: phase === 'cold' ? percentile(rows.map(r => r.navigationToVerifiedMs), .5) : undefined }
  }))
  const builtProvenance = JSON.parse(readFileSync(join(site, 'capabilities.json'), 'utf8')).generatedFrom
  writeFileSync(reportPath, JSON.stringify({ status: 'completed', advisory: true, driverRevision: driverRevision(), builtProvenance, browser: browser.version(),
    policy: { cold: `${coldRuns} fresh browser contexts per case; no-store HTTP; fresh document/worker/JIT, shared browser process and OS caches; no network shaping`,
      warm: `${warmEdits} sequential edits`, session: `${sessionEdits} sequential edits after warmup`, burst: `${burstEdits} edits with requested 80ms intervals (main-thread blocking can delay dispatch); latency from final input`,
      timing: 'input through current receipt + visible changed label + two animation frames; default adaptive debounce and cache policy',
      memory: `forced-GC retained JS heap per realm outside timed edits${memoryEvery ? `, also every ${memoryEvery} session edits` : ''}; excludes native/DOM/Blob backing/process RSS; all contexts run sequentially`, remoteAssets: 'blocked' },
    entry, cases, summary, errors, samples, memory, telemetry, assets: [...host.fetched].sort().map(path => ({ path: path.slice(site.length), sha256: sha256(readFileSync(path)) })) }, null, 2) + '\n')
  console.log(reportPath)
} catch (error) { writeFileSync(reportPath, JSON.stringify({ status: 'failed', error: String(error) }) + '\n'); throw error }
finally { await browser.close(); await host.close() }

async function edit(page: Page, source: string, label: string, burst = 1) {
  return page.evaluate(async ({ source, label, burst }) => {
    const input = document.getElementById('code-editor') as HTMLTextAreaElement, preview = document.getElementById('preview-inner')!
    const status = document.getElementById('status-text')!
    let started = performance.now(), lastTick = started, maxTimerGapMs = 0, finalLabel = ''
    const heartbeat = setInterval(() => { const now = performance.now(); maxTimerGapMs = Math.max(maxTimerGapMs, now - lastTick); lastTick = now }, 5)
    try {
      for (let i = 0; i < burst; i++) {
        finalLabel = burst === 1 ? label : `${label}_${i}`
        ;(globalThis as any).__benchWorkers.expectedLabel = finalLabel
        status.textContent = 'benchmark-pending'
        input.value = source.replaceAll('BENCH_LABEL', finalLabel)
        started = performance.now()
        input.dispatchEvent(new Event('input', { bubbles: true }))
        if (preview.dataset.sharedRequestDigest) throw new Error('Input retained stale receipt authority')
        if (i < burst - 1) await new Promise(done => setTimeout(done, 80))
      }
      await new Promise<void>((done, reject) => {
        const timeout = setTimeout(() => { observer.disconnect(); reject(new Error(`Timed out: ${status.textContent}; ${preview.textContent?.slice(0, 100)}`)) }, 30_000)
        const observer = new MutationObserver(() => {
          if (['Error', 'Verify error'].includes(status.textContent ?? '')) { observer.disconnect(); clearTimeout(timeout); reject(new Error(`${status.textContent}: ${document.getElementById('error-message')?.textContent ?? preview.textContent}`)); return }
          if (!['OK', 'Needs fixes'].includes(status.textContent ?? '') || !preview.dataset.sharedRequestDigest || !preview.textContent?.includes(finalLabel)) return
          observer.disconnect(); clearTimeout(timeout); requestAnimationFrame(() => requestAnimationFrame(() => done()))
        })
        observer.observe(status, { childList: true, characterData: true, subtree: true })
      })
      return { elapsedMs: performance.now() - started, navigationToVerifiedMs: performance.now(), maxTimerGapMs, status: status.textContent,
        hasReceipt: !!preview.dataset.sharedRequestDigest, displayedTime: document.getElementById('render-time')?.textContent, edits: burst }
    } finally { clearInterval(heartbeat) }
  }, { source, label, burst })
}
