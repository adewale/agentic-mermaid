// Reproduce the issue #158 comparison-page evidence from a detached base
// worktree and the current checkout.
//
//   bun run scripts/pr-assets/issue-158-agent-interface-audit.ts
//
// Override AM_BEFORE_SHA only when intentionally regenerating against a
// different reviewed base.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BEFORE_SHA = process.env.AM_BEFORE_SHA ?? '5419e19d9e84922a749f3017fb686a9926ff2566'
const OUT = join(ROOT, 'docs/pr-assets/pr158-agent-interface-audit-before-after.png')
const worktree = mkdtempSync(join(tmpdir(), 'am-pr158-before-'))
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json',
}

function buildWebsite(cwd: string) {
  execFileSync('bun', ['run', 'website'], { cwd, stdio: 'inherit' })
}

function serve(site: string) {
  return Bun.serve({
    port: 0,
    fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '')
      const rel = path && !path.endsWith('/') ? path : `${path}index.html`
      const absolute = normalize(join(site, rel))
      if (!absolute.startsWith(site) || !existsSync(absolute)) return new Response('Not found', { status: 404 })
      return new Response(Bun.file(absolute), { headers: { 'content-type': mime[extname(absolute)] ?? 'application/octet-stream' } })
    },
  })
}

async function capture(site: string, items: Array<[selector: string, output: string]>) {
  const server = serve(site)
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
    await page.goto(`http://${server.hostname}:${server.port}/comparisons/`, { waitUntil: 'networkidle' })
    for (const [selector, output] of items) {
      const element = page.locator(selector)
      await element.scrollIntoViewIfNeeded()
      await page.waitForTimeout(100)
      await element.screenshot({ path: output, animations: 'disabled' })
    }
  } finally {
    await browser.close()
    server.stop(true)
  }
}

async function dataUrl(path: string) {
  return `data:image/png;base64,${Buffer.from(await Bun.file(path).arrayBuffer()).toString('base64')}`
}

try {
  execFileSync('git', ['worktree', 'add', '--detach', worktree, BEFORE_SHA], { cwd: ROOT, stdio: 'inherit' })
  symlinkSync(join(ROOT, 'node_modules'), join(worktree, 'node_modules'))
  buildWebsite(worktree)
  buildWebsite(ROOT)

  const baseGantt = join(worktree, 'base-gantt.png')
  const baseStyle = join(worktree, 'base-style.png')
  const afterMindmap = join(worktree, 'after-mindmap.png')
  const afterGitgraph = join(worktree, 'after-gitgraph.png')
  await capture(join(worktree, 'website/public'), [
    ['#gantt', baseGantt], ['#comparison-style-matrix-title', baseStyle],
  ])
  await capture(join(ROOT, 'website/public'), [
    ['#mindmap', afterMindmap], ['#gitgraph', afterGitgraph],
  ])
  const [gantt, style, mindmap, gitgraph] = await Promise.all(
    [baseGantt, baseStyle, afterMindmap, afterGitgraph].map(dataUrl),
  )

  const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#f3f0eb;font-family:Inter,system-ui;color:#211f1b}
.sheet{padding:28px;display:grid;grid-template-columns:1fr 1fr;gap:22px}.card{background:#fff;border:1px solid #c9c1b7;border-radius:14px;padding:16px;box-shadow:0 8px 28px #0001}
h1{font-size:24px;margin:0 0 5px}.caption{font-size:15px;margin:0 0 12px;color:#5d554d;min-height:40px}.stack{display:grid;gap:12px}img{width:100%;max-height:620px;object-fit:contain;object-position:top;border:1px solid #ddd6ce;background:white}
</style><div class="sheet"><section class="card"><h1>Before · ${BEFORE_SHA}</h1><p class="caption">Comparisons ended at Gantt, followed immediately by the style matrix.</p><div class="stack"><img src="${gantt}"><img src="${style}"></div></section><section class="card"><h1>After · audit fix</h1><p class="caption">Mindmap and GitGraph now have first-class same-source comparison rows.</p><div class="stack"><img src="${mindmap}"><img src="${gitgraph}"></div></section></div>`
  const server = Bun.serve({ port: 0, fetch: () => new Response(html, { headers: { 'content-type': 'text/html' } }) })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 2200, height: 1400 } })
    await page.goto(`http://${server.hostname}:${server.port}`, { waitUntil: 'load' })
    await page.screenshot({ path: OUT, fullPage: true, animations: 'disabled' })
  } finally {
    await browser.close()
    server.stop(true)
  }
  console.log(`wrote ${OUT}`)
} finally {
  try { execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: ROOT, stdio: 'pipe' }) } catch {}
  rmSync(worktree, { recursive: true, force: true })
}
