import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import {
  WEBSITE_PAYLOAD_OBSERVATION_MS,
  WEBSITE_PAYLOAD_ROUTES,
  buildWebsitePayloadReport,
  stablePayloadJson,
  verifyWebsitePayloadBudgets,
  websitePayloadCaptureProblems,
} from './website-payload-authority.ts'
import { WEBSITE_PAYLOAD_BUDGETS } from './website-payload-budgets.ts'

// Usage:
//   --check                 build, capture every route, and verify the budgets
//   --report <path>         also write the measured report (the PR payload delta)
//   --root <checkout>       build and measure another checkout (the PR's base)
// Byte ceilings have headroom; per-PR growth is judged by scripts/ci/payload-delta.ts
// against the base branch built on the same runner, not by a committed baseline.
const argValue = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const ROOT = argValue('--root') ? resolve(argValue('--root')!) : join(import.meta.dir, '..', '..')
const REPORT_OUT = argValue('--report')
const PUBLIC = mkdtempSync(join(tmpdir(), 'agentic-mermaid-website-payload-'))
let cleaned = false
function cleanup() {
  if (cleaned) return
  cleaned = true
  rmSync(PUBLIC, { recursive: true, force: true })
}
process.on('exit', cleanup)
if (!process.argv.includes('--check') && !REPORT_OUT) throw new Error('Usage: bun run scripts/site/website-payload-report.ts --check [--report <path>] [--root <checkout>]')

const build = Bun.spawnSync(['bun', 'run', 'website/build.ts', '--public-only'], {
  cwd: ROOT,
  env: { ...process.env, AM_WEBSITE_PUBLIC_DIR: PUBLIC },
  stdout: 'inherit',
  stderr: 'inherit',
})
if (build.exitCode !== 0) throw new Error(`website build failed with exit ${build.exitCode}`)

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    let relative = decodeURIComponent(url.pathname).replace(/^\//, '')
    if (!relative || relative.endsWith('/')) relative += 'index.html'
    const path = normalize(join(PUBLIC, relative))
    if (!path.startsWith(normalize(PUBLIC) + sep)) return new Response('not found', { status: 404 })
    if (!existsSync(path) || statSync(path).isDirectory()) return new Response('not found', { status: 404 })
    return new Response(Bun.file(path), { headers: { 'content-type': mime[extname(path)] ?? 'application/octet-stream' } })
  },
})

const origin = `http://127.0.0.1:${server.port}`
const browser = await chromium.launch({ headless: true })
const chromiumVersion = browser.version()
const captured: Record<string, string[]> = {}
try {
  for (const route of WEBSITE_PAYLOAD_ROUTES) {
    const context = await browser.newContext({ viewport: route.viewport, serviceWorkers: 'block' })
    const page = await context.newPage()
    const paths: string[] = []
    const external = new Set<string>()
    const unexpectedMethods: string[] = []
    const failedRequests: string[] = []
    const badResponses: string[] = []
    const pageErrors: string[] = []
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.origin !== origin) { external.add(url.origin); return }
      if (request.method() !== 'GET') unexpectedMethods.push(`${request.method()} ${url.pathname}`)
      paths.push(url.pathname)
    })
    page.on('requestfailed', request => failedRequests.push(`${request.failure()?.errorText ?? 'failed'} ${new URL(request.url()).pathname}`))
    page.on('response', response => {
      const url = new URL(response.url())
      if (url.origin === origin && (response.status() < 200 || response.status() >= 300)) badResponses.push(`${response.status()} ${url.pathname}`)
    })
    page.on('pageerror', error => pageErrors.push(error.message))
    const response = await page.goto(origin + route.url, { waitUntil: 'networkidle' })
    if (!response?.ok()) throw new Error(`${route.id}: navigation failed with ${response?.status()}`)
    await page.evaluate(async () => { await document.fonts.ready })
    await page.waitForLoadState('networkidle')
    // This is a declared observation horizon, not a synchronization sleep: it
    // catches automatic idle/timer work that starts after Chromium's 500ms
    // network-idle threshold. User-initiated lazy work remains out of scope.
    await page.waitForTimeout(WEBSITE_PAYLOAD_OBSERVATION_MS)
    await page.waitForLoadState('networkidle')
    if (external.size) throw new Error(`${route.id}: third-party requests: ${Array.from(external).join(', ')}`)
    if (unexpectedMethods.length) throw new Error(`${route.id}: unexpected methods: ${unexpectedMethods.join(', ')}`)
    const captureProblems = websitePayloadCaptureProblems({ failedRequests, badResponses, pageErrors })
    if (captureProblems.length) throw new Error(`${route.id}: invalid capture:\n${captureProblems.join('\n')}`)
    captured[route.id] = paths
    await context.close()
  }
} finally {
  await browser.close()
  server.stop(true)
}

const playwrightPackage = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'playwright', 'package.json'), 'utf8')) as { version: string }
const report = buildWebsitePayloadReport(PUBLIC, captured, {
  bun: Bun.version,
  playwright: playwrightPackage.version,
  chromium: chromiumVersion,
  platform: process.platform,
  arch: process.arch,
})
cleanup()
if (REPORT_OUT) writeFileSync(resolve(REPORT_OUT), stablePayloadJson(report))
if (process.argv.includes('--check')) {
  const problems = verifyWebsitePayloadBudgets(report, WEBSITE_PAYLOAD_BUDGETS)
  if (problems.length) throw new Error(`Website payload budget failures:\n${problems.map(problem => `- ${problem}`).join('\n')}`)
  for (const route of report.routes) {
    console.log(`${route.id}: ${route.totals.requests} requests, ${route.totals.rawBytes} raw / ${route.totals.gzipBytes} gzip / ${route.totals.brotliBytes} Brotli bytes`)
  }
  console.log('Website payload request graphs and budgets pass')
}
