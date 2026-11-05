import { chromium } from 'playwright'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join, extname, sep } from 'node:path'
import { gzipSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const value = (flag: string, fallback: string) => args.includes(flag) ? args[args.indexOf(flag) + 1]! : fallback
const root = resolve(value('--root', join(import.meta.dir, '../..')))
const out = resolve(value('--out', join(root, 'bench-report/font-layout/browser.json')))
const features = value('--features', '').split(',').filter(Boolean)
const source = 'flowchart TD\nA[Authentication and authorization gateway] --> B[Validate incoming customer request]\nB --> C[Persist the final transaction result]\nA --> D[Record request tracing and audit information]\nD --> C'
const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(request) {
  const pathname = decodeURIComponent(new URL(request.url).pathname)
  if (pathname === '/') return new Response('<main id="diagram"></main>', { headers: { 'Content-Type': 'text/html' } })
  const file = resolve(root, '.' + pathname)
  if (!file.startsWith(root + sep) || !existsSync(file)) return new Response('Missing', { status: 404 })
  const contentType = extname(file) === '.js' ? 'text/javascript' : extname(file) === '.ttf' ? 'font/ttf' : 'application/octet-stream'
  return new Response(gzipSync(readFileSync(file)), { headers: { 'Content-Type': contentType, 'Content-Encoding': 'gzip', 'Cache-Control': 'no-store' } })
} })
const browser = await chromium.launch({ headless: true })
const rows = []
try {
  for (const backend of ['elk', 'agentic'] as const) {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(String(error)))
    const start = performance.now()
    await page.goto(`http://127.0.0.1:${server.port}/`)
    const result = await page.evaluate(async ({ source, backend, features }) => {
      const resourceRows = () => performance.getEntriesByType('resource').map(entry => {
        const resource = entry as PerformanceResourceTiming
        return { url: new URL(resource.name).pathname, encodedBytes: resource.encodedBodySize, decodedBytes: resource.decodedBodySize, transferBytes: resource.transferSize }
      })
      const start = performance.now()
      // Runtime path is served from the selected checkout; no source bundler.
      const entry = '/dist/browser-lazy/index.js'
      const api = await import(entry)
      const initial = resourceRows()
      const options = { embedFontImport: false, security: 'strict',
        ...(features.includes('fonts') ? { fontMetrics: 'bundled-inter' } : {}),
        graphLayout: { backend, fallback: 'elk', ...(features.includes('elk-order') && backend === 'elk' || features.includes('ports') && backend === 'agentic' ? { quality: 'balanced' } : {}),
          ...(features.includes('wrap') ? { viewport: { width: 800, height: 600 } } : {}),
        },
      }
      // ELK rejects fallback=elk; preserve the same explicit policy as Node.
      if (backend === 'elk') options.graphLayout.fallback = 'none'
      const first = await api.renderMermaidSVGWithReceiptAsync(source, options)
      const consumed = JSON.stringify(first)
      const firstMs = performance.now() - start
      document.getElementById('diagram')!.innerHTML = first.svg
      const requests = resourceRows()
      const samples = []
      for (let i = 0; i < 9; i++) {
        const begin = performance.now()
        JSON.stringify(await api.renderMermaidSVGWithReceiptAsync(source, options))
        samples.push(performance.now() - begin)
      }
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory
      return { initial, requests, firstMs, samples, consumedBytes: consumed.length,
        memory: memory ? { usedJSHeapSize: memory.usedJSHeapSize, totalJSHeapSize: memory.totalJSHeapSize, limitation: 'main document only; excludes native and worker heaps' } : null,
        receipt: first.receipt,
      }
    }, { source, backend, features }).catch(error => ({ failure: String(error) }))
    rows.push({ backend, elapsedMs: performance.now() - start, errors, ...result })
    await context.close()
  }
} finally { await browser.close(); server.stop(true) }
mkdirSync(resolve(out, '..'), { recursive: true })
writeFileSync(out, JSON.stringify({ sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), features, browser: 'fresh Chromium context, gzip HTTP, no-store, fully consumed SVG+receipt; filesystem warm', rows }, null, 2) + '\n')
console.log(out)
