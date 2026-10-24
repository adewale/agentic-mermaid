import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { entryImport, type InvocationOptions, invocationHarnessRoot, invocationRow } from './invocation.ts'
import { qualifyOutput } from './qualification.ts'
import type { BenchmarkObservation, UnifiedWorkload } from './types.ts'

export async function runInvocationBrowser(options: InvocationOptions, workloads: UnifiedWorkload[]): Promise<{ rows: BenchmarkObservation[]; gaps: string[]; artifacts: string[] }> {
  const root = options.packageRoot ?? options.root,
    site = join(options.root, 'website/public'),
    out = join(options.out, 'browser')
  mkdirSync(out, { recursive: true })
  const rows: BenchmarkObservation[] = [],
    gaps: string[] = [],
    artifacts: string[] = [],
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')),
    require = createRequire(join(options.harnessRoot ?? invocationHarnessRoot, 'package.json')),
    { chromium } = require('playwright')
  const checker = join(out, 'receipt-checker.js')
  await require('esbuild').build({ entryPoints: [join(import.meta.dir, 'invocation-receipt.ts')], outfile: checker, bundle: true, platform: 'browser', format: 'iife', globalName: '__unifiedReceipt', target: 'es2022', logLevel: 'silent' })
  const mapFile = (pathname: string) => {
    const base = pathname.startsWith('/pkg/') ? root : site,
      part = pathname.startsWith('/pkg/') ? pathname.slice(4) : pathname
    const file = resolve(base, '.' + decodeURIComponent(part.endsWith('/') ? part + 'index.html' : part))
    return file.startsWith(resolve(base) + '/') ? file : undefined
  }
  const server = createServer((req, res) => {
    const u = new URL(req.url!, 'http://localhost')
    if (u.pathname === '/blank') {
      res.setHeader('content-type', 'text/html')
      res.end('<!doctype html><meta charset="utf-8"><body>')
      return
    }
    const file = u.pathname === '/__unified/receipt-checker.js' ? checker : mapFile(u.pathname)
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end()
      return
    }
    res.setHeader('content-type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' } as Record<string, string>)[extname(file)] ?? 'application/octet-stream')
    res.setHeader('cache-control', 'no-store')
    res.end(readFileSync(file))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + (server.address() as any).port
  const payload = (paths: Set<string>) => {
    const files = [...paths].map(url => {
      const file = mapFile(url)
      if (!file || !existsSync(file) || !statSync(file).isFile()) return { url, missing: true, bytes: 0, gzip: 0 }
      const data = readFileSync(file)
      return { url, bytes: data.length, gzip: gzipSync(data, { level: 9 }).length }
    })
    return { files, bytes: files.reduce((n, f) => n + f.bytes, 0), gzip: files.reduce((n, f) => n + f.gzip, 0) }
  }
  const iife = entryImport(pkg.exports?.['./browser']),
    lazy = entryImport(pkg.exports?.['./browser/lazy']),
    runtime = join(site, 'editor/runtime'),
    workerCandidates = existsSync(runtime) ? readdirSync(runtime).filter(name => /^browser-preview-worker-.*\.js$/.test(name)) : [],
    worker = workerCandidates.length === 1 ? '/editor/runtime/' + workerCandidates[0] : undefined
  let actualBrowser = 'chromium:unavailable'
  try {
    for (const surface of ['global', 'lazy', 'worker', 'editor'] as const) {
      const resource = surface === 'global' ? iife && join(root, iife) : surface === 'lazy' ? lazy && join(root, lazy) : surface === 'worker' ? worker && join(site, worker) : join(site, 'editor/index.html')
      if (!resource || !existsSync(resource)) {
        rows.push({
          ...invocationRow(`browser:${surface}`, workloads[0]!, 'load', 'module', 'fresh-browser'),
          family: '*',
          caseId: 'surface-load',
          status: 'blocked',
          detail: surface === 'worker' && workerCandidates.length > 1 ? 'Ambiguous generated worker artifacts; clean website build required' : 'Required shipped/browser website artifact missing; build canonical package and website first.',
        })
        continue
      }
      for (let round = 1; round <= options.rounds; round++) {
        const browser = await chromium.launch({ headless: true, executablePath: options.executable ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) }),
          context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' }),
          fetched = new Set<string>(),
          page = await context.newPage(),
          errors: string[] = []
        actualBrowser = `chromium:${browser.version()}`
        context.on('request', (request: any) => {
          const u = new URL(request.url())
          if (u.origin === origin && !u.pathname.startsWith('/__unified/')) fetched.add(u.pathname)
        })
        await context.route('**/*', (route: any) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()))
        page.on('pageerror', (e: Error) => errors.push(String(e)))
        try {
          const loadStart = performance.now()
          await page.goto(origin + (surface === 'editor' ? '/editor/?empty=1' : '/blank'))
          if (surface === 'global') await page.addScriptTag({ url: origin + '/pkg/' + iife!.replace(/^\.\//, '') })
          if (surface === 'lazy')
            await page.evaluate(
              async (url: string) => {
                ;(globalThis as any).__invocationApi = await import(url)
              },
              origin + '/pkg/' + lazy!.replace(/^\.\//, ''),
            )
          if (surface === 'editor') await page.waitForFunction(() => !!(globalThis as any).__mermaid)
          if (surface === 'worker')
            await page.evaluate((url: string) => {
              const g = globalThis as any
              g.__invocationWorker = new Worker(url, { type: 'module' })
              g.__invocationPending = new Map()
              g.__invocationId = 0
              g.__invocationRaster = async (svg: string, raster: any) => {
                const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
                try {
                  const image = new Image()
                  image.src = url
                  await image.decode()
                  const canvas = document.createElement('canvas')
                  canvas.width = raster.rasterDimensions.width
                  canvas.height = raster.rasterDimensions.height
                  const ctx = canvas.getContext('2d')!
                  ctx.fillStyle = raster.rasterBackground
                  ctx.fillRect(0, 0, canvas.width, canvas.height)
                  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
                  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => (value ? resolve(value) : reject(Error('Canvas PNG unavailable'))), 'image/png'))
                  return new Uint8Array(await blob.arrayBuffer())
                } finally {
                  URL.revokeObjectURL(url)
                }
              }
              g.__invocationWorker.onmessage = async ({ data }: MessageEvent) => {
                const pending = g.__invocationPending.get(data.id)
                if (!pending) return
                if (data.kind === 'rasterize') {
                  try {
                    const png = await g.__invocationRaster(data.svg, data.context)
                    g.__invocationWorker.postMessage({ id: data.id, kind: 'rasterized', ok: true, png }, [png.buffer])
                  } catch (e) {
                    g.__invocationWorker.postMessage({ id: data.id, kind: 'rasterized', ok: false, error: String(e) })
                  }
                  return
                }
                g.__invocationPending.delete(data.id)
                data.ok ? pending.resolve(data.artifact) : pending.reject(Error(data.error))
              }
              g.__invocationWorker.onerror = (event: ErrorEvent) => {
                for (const p of g.__invocationPending.values()) p.reject(Error(event.message))
                g.__invocationPending.clear()
              }
              g.__invocationCall = (operation: string, source: string) =>
                new Promise((resolve, reject) => {
                  const id = ++g.__invocationId,
                    timer = setTimeout(() => {
                      g.__invocationPending.delete(id)
                      reject(Error('Worker response timeout'))
                    }, 60000)
                  g.__invocationPending.set(id, {
                    resolve: (v: any) => {
                      clearTimeout(timer)
                      resolve(v)
                    },
                    reject: (e: Error) => {
                      clearTimeout(timer)
                      reject(e)
                    },
                  })
                  g.__invocationWorker.postMessage({ id, operation, source, options: { security: 'strict', embedFontImport: false }, ...(operation === 'png' ? { output: 1 } : {}) })
                })
            }, origin + worker)
          rows.push({
            ...invocationRow(`browser:${surface}`, workloads[0]!, 'load', 'module', 'fresh-browser'),
            family: '*',
            caseId: 'surface-load',
            samplesMs: [performance.now() - loadStart],
            metrics: { round, browser: browser.version(), clock: 'navigation and supported API availability; worker first handshake belongs to first artifact', cachePolicy: 'artifact defaults' },
          })
          await page.addScriptTag({ url: origin + '/__unified/receipt-checker.js' })
          const initial = [...fetched]
          for (const [index, w] of workloads.entries()) {
            if (surface === 'editor') {
              const row = invocationRow('browser:editor', w, 'input-preview', 'svg', options.profile === 'full' ? 'eight-input-burst-to-latest-verified-DOM' : 'changed-input-to-verified-DOM')
              row.metrics = { round, clock: 'input event through current labelled SVG DOM, status, receipt authority and two animation frames' }
              try {
                const result = await page.evaluate(
                  async ({ source, index, round, edits }: { source: string; index: number; round: number; edits: number }) => {
                    const input = document.querySelector<HTMLTextAreaElement>('#code-editor'),
                      preview = document.querySelector<HTMLElement>('#preview-inner'),
                      status = document.querySelector<HTMLElement>('#status-text')
                    if (!input || !preview || !status) throw Error('Required editor DOM unavailable')
                    const marker = `UnifiedEdit_${round}_${index}`,
                      lines = source.split('\n')
                    let header = 0
                    if (lines[0]?.trim() === '---') {
                      const end = lines.slice(1).findIndex(line => line.trim() === '---')
                      if (end >= 0) header = end + 2
                    }
                    while (header < lines.length && (!lines[header]!.trim() || lines[header]!.trim().startsWith('%%'))) header++
                    source = /^\s*accTitle\s*:/im.test(source) ? source.replace(/^\s*accTitle\s*:.*$/im, `accTitle: ${marker}`) : (lines.splice(header + 1, 0, `accTitle: ${marker}`), lines.join('\n'))
                    const started = performance.now()
                    for (let edit = 0; edit < edits; edit++) {
                      input.value = edit === edits - 1 ? source : source.replace(marker, `Superseded_${round}_${index}_${edit}`)
                      input.dispatchEvent(new Event('input', { bubbles: true }))
                    }
                    const staleAuthority = !!preview.dataset.sharedRequestDigest
                    await new Promise<void>((resolve, reject) => {
                      const observer = new MutationObserver(check),
                        timer = setTimeout(() => {
                          observer.disconnect()
                          reject(Error('Editor did not produce current labelled SVG: ' + status.textContent))
                        }, 30000)
                      function check() {
                        if (['Error', 'Verify error'].includes(status!.textContent ?? '')) {
                          observer.disconnect()
                          clearTimeout(timer)
                          reject(Error(status!.textContent + ': ' + preview!.textContent))
                          return
                        }
                        const svg = preview!.querySelector('svg')
                        if (!svg || !svg.textContent?.includes(marker) || !['OK', 'Needs fixes'].includes(status!.textContent ?? '')) return
                        observer.disconnect()
                        clearTimeout(timer)
                        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
                      }
                      observer.observe(preview!, { subtree: true, attributes: true, childList: true, characterData: true })
                      observer.observe(status!, { subtree: true, childList: true, characterData: true })
                      check()
                    })
                    const ms = performance.now() - started,
                      svg = preview.querySelector('svg')!.outerHTML
                    return { ms, svg, bytes: new TextEncoder().encode(svg).length, staleAuthority, receiptAuthority: !!preview.dataset.sharedRequestDigest, status: status.textContent }
                  },
                  { source: w.source, index, round, edits: options.profile === 'full' ? 8 : 1 },
                )
                const q = qualifyOutput(w, result.svg, 'svg')
                row.samplesMs = [result.ms]
                row.bytes = result.bytes
                row.findings = q.findings
                row.status = q.ok && !result.staleAuthority && result.receiptAuthority ? 'passed' : 'failed'
                row.metrics = { ...row.metrics, receiptAuthority: result.receiptAuthority, staleAuthority: result.staleAuthority, editorStatus: result.status }
              } catch (e) {
                row.status = 'failed'
                row.detail = String(e)
              }
              rows.push(row)
              continue
            }
            const operations = surface === 'lazy' ? ['svg', 'svg-receipt'] : surface === 'worker' ? ['preview', 'ascii', 'unicode', ...(options.profile === 'full' ? ['png'] : [])] : ['svg', 'svg-async', 'svg-receipt', 'ascii', 'unicode', ...(options.profile === 'full' ? ['png'] : [])]
            for (const operation of operations) {
              const format = operation === 'preview' || operation.startsWith('svg') ? 'svg' : operation,
                row = invocationRow(`browser:${surface}`, w, operation, format, 'first-and-warm-consumed')
              row.metrics = { round, clock: surface === 'worker' ? 'main thread request through message clone/worker reply and consumed artifact' : 'public API through consumed UTF8/receipt or PNG; subsequent validation excluded' }
              try {
                const result = await page.evaluate(
                  async ({ source, surface, operation }: { source: string; surface: string; operation: string }) => {
                    const g = globalThis as any,
                      api = surface === 'global' ? g.agenticMermaid : g.__invocationApi
                    const raster = async (svg: string, context: any) => {
                      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
                      try {
                        const image = new Image()
                        image.src = url
                        await image.decode()
                        const canvas = document.createElement('canvas')
                        canvas.width = context.rasterDimensions.width
                        canvas.height = context.rasterDimensions.height
                        const ctx = canvas.getContext('2d')!
                        ctx.fillStyle = context.rasterBackground
                        ctx.fillRect(0, 0, canvas.width, canvas.height)
                        ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
                        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => (value ? resolve(value) : reject(Error('Canvas PNG unavailable'))), 'image/png'))
                        return { png: new Uint8Array(await blob.arrayBuffer()), fontSources: ['unavailable'] }
                      } finally {
                        URL.revokeObjectURL(url)
                      }
                    }
                    const call = () =>
                      surface === 'worker'
                        ? g.__invocationCall(operation, source)
                        : operation === 'svg'
                          ? api.renderMermaidSVG
                            ? api.renderMermaidSVG(source)
                            : api.renderMermaidSVGAsync(source)
                          : operation === 'svg-async'
                            ? api.renderMermaidSVGAsync(source)
                            : operation === 'svg-receipt'
                              ? api.renderMermaidSVGWithReceipt
                                ? api.renderMermaidSVGWithReceipt(source)
                                : api.renderMermaidSVGWithReceiptAsync(source)
                              : operation === 'ascii' || operation === 'unicode'
                                ? api.renderMermaidASCIIWithReceipt(source, { useAscii: operation === 'ascii', colorMode: 'none' })
                                : api.renderMermaidPNGInBrowserWithReceipt(source, { security: 'strict', embedFontImport: false }, 1, raster)
                    const invoke = async () => {
                      const started = performance.now(),
                        value = await call()
                      if (surface === 'worker' || operation === 'svg-receipt' || operation === 'ascii' || operation === 'unicode' || operation === 'png') g.__unifiedReceipt.assertInvocationReceipt(value?.receipt, operation === 'preview' || operation.startsWith('svg') ? 'svg' : operation)
                      const artifact = value?.svg ?? value?.text ?? value?.png ?? value,
                        bytes = artifact instanceof Uint8Array ? artifact : new TextEncoder().encode(typeof artifact === 'string' ? artifact : JSON.stringify(artifact)),
                        receipt = value?.receipt ? new TextEncoder().encode(JSON.stringify(value.receipt)) : undefined
                      g.__unifiedInvocationSink = [bytes, receipt]
                      return { ms: performance.now() - started, artifact, bytes: bytes.length + (receipt?.length ?? 0), receiptOutput: value?.receipt?.output }
                    }
                    const first = await invoke()
                    await invoke()
                    const samples = [],
                      artifacts = [first.artifact]
                    for (let i = 0; i < 3; i++) {
                      const sample = await invoke()
                      samples.push(sample.ms)
                      artifacts.push(sample.artifact)
                    }
                    return { firstMs: first.ms, samples, bytes: first.bytes, artifacts: artifacts.map(artifact => (artifact instanceof Uint8Array ? Array.from(artifact) : artifact)), receiptOutput: first.receiptOutput }
                  },
                  { source: w.source, surface, operation },
                )
                const checks = result.artifacts.map((artifact: unknown) => qualifyOutput(w, format === 'png' ? new Uint8Array(artifact as number[]) : artifact, format))
                row.status = checks.every((q: { ok: boolean }) => q.ok) ? 'passed' : 'failed'
                row.findings = [...new Set(checks.flatMap((q: { findings: string[] }) => q.findings))] as string[]
                row.samplesMs = result.samples
                row.bytes = result.bytes
                row.metrics = { ...row.metrics, firstInputMs: result.firstMs, receiptOutput: result.receiptOutput ?? null }
              } catch (e) {
                row.status = 'failed'
                row.detail = String(e)
              }
              rows.push(row)
            }
          }
          const session = await context.newCDPSession(page)
          await session.send('HeapProfiler.collectGarbage')
          const heap = await session.send('Runtime.getHeapUsage')
          await session.detach()
          rows.push({ ...invocationRow(`browser:${surface}`, workloads[0]!, 'heap-checkpoint', 'memory', 'after-portfolio'), family: '*', caseId: 'browser-memory', metrics: { round, usedSize: heap.usedSize, totalSize: heap.totalSize, scope: 'main document V8 heap; worker/native/GPU memory excluded' } })
          const report = { surface, round, initial: payload(new Set(initial)), allFamilies: payload(fetched), browser: browser.version(), errors }
          const path = join(out, `${surface}-${round}-payload.json`)
          writeFileSync(path, JSON.stringify(report, null, 2))
          artifacts.push(path)
          rows.push({
            ...invocationRow(`browser:${surface}`, workloads[0]!, 'download-closure', 'bytes', 'through-family-portfolio'),
            family: '*',
            caseId: 'browser-payload',
            bytes: report.allFamilies.bytes,
            metrics: { round, gzipBytes: report.allFamilies.gzip, initialGzipBytes: report.initial.gzip, requests: report.allFamilies.files.length },
          })
        } catch (e) {
          rows.push({ ...invocationRow(`browser:${surface}`, workloads[0]!, 'surface-run', 'mixed', 'initialization'), family: '*', caseId: `browser-${round}`, status: 'failed', detail: String(e) })
        } finally {
          await context.close()
          await browser.close()
        }
      }
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
  gaps.push(
    'Browser Canvas PNG checks binary dimensions/encoding; text legibility, correspondence and geometry are qualified by owning family/rendering suites, not PNG signature alone.',
    'Browser memory checkpoint covers document V8 heap only; worker/native/GPU/process peak memory is not claimed.',
    'Browser API timings exclude subsequent SVG insertion/paint; editor timings include current preview DOM and two animation frames, which are not a pixel-paint proof.',
    'Actual worker and editor artifacts come from the target website build, distinct from package-only delivery.',
    'Full editor profile exercises an eight-input burst and verifies latest artifact/receipt authority; explicit worker cancellation and scheduler race interleavings require owning preview-session tests. Structural growth/revisit is bounded to flowchart/state persistent library sessions; cache-capacity eviction is not proved.',
  )
  for (const row of rows) row.runtime = actualBrowser
  return { rows, gaps, artifacts }
}
