import './ci-policy-enforce.ts'
// Complement Dave's SVG-return timing with the actual editor: input through
// verified DOM and two animation frames, plus main-thread timer delay.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { resolveBuildGitSha } from '../../website/build-provenance.ts'

const options = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]!, value = process.argv[i + 1]
  if (!['--site', '--out', '--executable'].includes(key) || !value || options.has(key)) throw new Error(`Invalid option ${key}`)
  options.set(key, value)
}
if (!options.has('--site') || !options.has('--out')) throw new Error('Provide --site WEBSITE_PUBLIC --out DIRECTORY')
const site = resolve(options.get('--site')!), out = resolve(options.get('--out')!)
mkdirSync(out, { recursive: true })
const reportPath = join(out, 'editor-preview.json')
// Invalidate old evidence before launch or any other fallible work.
writeFileSync(reportPath, JSON.stringify({ status: 'incomplete', site }) + '\n')
const driverGit = (args: string[]) => {
  try { return execFileSync('git', args, { cwd: resolve(import.meta.dir, '../..'), encoding: 'utf8' }).trim() }
  catch { return undefined }
}
const driverRevision = resolveBuildGitSha({ head: driverGit(['rev-parse', 'HEAD']), status: driverGit(['status', '--porcelain=v1', '--untracked-files=normal']) })
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const fetched = new Set<string>()
const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  const file = resolve(site, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname))
  if (!file.startsWith(site + sep) || !existsSync(file)) { res.writeHead(404).end(); return }
  if (pathname.endsWith('.js')) fetched.add(file)
  res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' } as Record<string, string>)[extname(file)] ?? 'application/octet-stream')
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'")
  res.end(readFileSync(file))
})
let browser: Browser | undefined
try {
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  browser = await chromium.launch({ headless: true, executablePath: options.get('--executable') })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto(`${origin}/editor/?empty=1`)
  await page.waitForFunction(() => (globalThis as any).__mermaid !== undefined)
  const samples = []
  for (const nodes of [5, 50, 150]) {
    let source = 'flowchart TD\n'
    for (let i = 1; i < nodes; i++) source += `n${Math.floor((i - 1) / 3)}[Node ${Math.floor((i - 1) / 3)}] --> n${i}[Node ${i}]\n`
    for (let rep = 0; rep < 4; rep++) {
      const result = await page.evaluate(async ({ source, rep }) => {
        const input = document.getElementById('code-editor') as HTMLTextAreaElement
        const status = document.getElementById('status-text')!
        status.textContent = 'benchmark-pending'
        const started = performance.now()
        let lastTick = started, maxTimerGapMs = 0
        const heartbeat = setInterval(() => { const now = performance.now(); maxTimerGapMs = Math.max(maxTimerGapMs, now - lastTick); lastTick = now }, 5)
        const ready = new Promise<void>((done, reject) => {
          const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Editor preview timed out')) }, 30_000)
          const observer = new MutationObserver(() => {
            if (!['OK', 'Error', 'Needs fixes', 'Verify error'].includes(status.textContent ?? '')) return
            observer.disconnect(); clearTimeout(timeout)
            requestAnimationFrame(() => requestAnimationFrame(() => done()))
          })
          observer.observe(status, { childList: true, characterData: true, subtree: true })
        })
        // Change a real label, so successive previews are not exact cache hits.
        input.value = source.replaceAll('[Node 0]', `[Root ${rep}]`)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        try {
          await ready
          return { elapsedMs: performance.now() - started, maxTimerGapMs, status: status.textContent,
            displayedTime: document.getElementById('render-time')?.textContent,
            hasReceipt: !!document.getElementById('preview-inner')?.dataset.sharedRequestDigest }
        } finally { clearInterval(heartbeat) }
      }, { source, rep })
      if (result.status !== 'OK' || !result.hasReceipt) throw new Error(`Editor did not verify ${nodes} nodes: ${JSON.stringify(result)}`)
      if (rep > 0) samples.push({ nodes, rep, ...result })
    }
  }
  const html = readFileSync(join(site, 'editor/index.html'))
  if (errors.length) throw new Error(`Editor emitted browser errors: ${errors.join('; ')}`)
  const builtProvenance = JSON.parse(readFileSync(join(site, 'capabilities.json'), 'utf8')).generatedFrom
  const report = { status: 'completed', advisory: true, browser: browser.version(),
    sourceRevision: builtProvenance.gitSha, builtProvenance, driverRevision,
    policy: 'Three measured root-label edits after one JIT warmup per ternary tree size; source through verified DOM plus two animation frames, includes adaptive debounce; default artifact cache policy, distinct labels per call; 5ms main-thread timer heartbeat; remote assets blocked',
    htmlSha256: sha256(html), assets: [...fetched].sort().map(file => ({ path: file.slice(site.length), sha256: sha256(readFileSync(file)) })), errors, samples }
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  writeFileSync(reportPath, JSON.stringify({ status: 'failed', site, driverRevision, error: String(error) }, null, 2) + '\n')
  throw error
} finally {
  await browser?.close()
  if (server.listening) await new Promise<void>(done => server.close(() => done()))
}
