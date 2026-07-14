// Reproduce the Section A graphical-correctness and strict-ASCII evidence from
// a detached pre-Section-A worktree and the current checkout.
//
//   bun run scripts/pr-assets/section-a-rendering-contract-evidence.ts
//
// Override AM_BEFORE_SHA only when intentionally reviewing a different base.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BEFORE_SHA = process.env.AM_BEFORE_SHA ?? 'c57b68e7'
const OUT = join(ROOT, 'docs/pr-assets/section-a-rendering-contract-before-after.png')
const worktree = mkdtempSync(join(tmpdir(), 'am-section-a-before-'))

interface Probe {
  svg: string
  viewBox: string
  svgHasNonFiniteGeometry: boolean
  ascii: string
  asciiNonSevenBit: string[]
}

const probeCode = String.raw`
import { renderMermaidASCII, renderMermaidSVG } from './src/index.ts'
const graphical = 'flowchart TD\n  N0[N0]\n  N1[N1]\n  N0 --> N0'
const terminal = 'stateDiagram-v2\n  [*] --> Active\n  Active --> [*]'
const svg = renderMermaidSVG(graphical)
const ascii = renderMermaidASCII(terminal, { useAscii: true })
console.log(JSON.stringify({
  svg,
  viewBox: svg.match(/viewBox="([^"]+)/)?.[1] ?? 'missing',
  svgHasNonFiniteGeometry: /(?:NaN|Infinity)/.test(svg),
  ascii,
  asciiNonSevenBit: [...new Set([...ascii].filter(character => character.codePointAt(0) > 0x7f))],
}))
`

function probe(cwd: string): Probe {
  return JSON.parse(execFileSync('bun', ['-e', probeCode], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  })) as Probe
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

try {
  execFileSync('git', ['worktree', 'add', '--detach', worktree, BEFORE_SHA], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  symlinkSync(join(ROOT, 'node_modules'), join(worktree, 'node_modules'))

  const before = probe(worktree)
  const after = probe(ROOT)
  const beforeOffender = before.asciiNonSevenBit
    .map(character => `${character} · U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
    .join(', ') || 'none'
  const afterOffender = after.asciiNonSevenBit.join(', ') || 'none'

  const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#eeeae3;color:#1f211f;font-family:Inter,system-ui,sans-serif}
.page{padding:34px}.heading{margin:0 0 8px;font-size:30px}.lede{margin:0 0 26px;color:#5c625e;font-size:18px}
.sheet{display:grid;grid-template-columns:1fr 1fr;gap:24px}.card{background:#fff;border:1px solid #c9c4bb;border-radius:18px;padding:22px;box-shadow:0 10px 32px #1f211f14}
.card.before{border-top:7px solid #b4483f}.card.after{border-top:7px solid #287b53}h2{margin:0 0 8px;font-size:25px}.caption{color:#626761;margin:0 0 16px;min-height:48px}
.badge{display:inline-block;border-radius:999px;padding:7px 11px;margin:0 6px 12px 0;font-weight:700;font-size:14px}.bad{background:#f9ded9;color:#8a2f28}.good{background:#dcefe3;color:#1d6542}
.panel{border:1px solid #d9d5cf;border-radius:12px;padding:14px;margin-top:12px;background:#faf9f7}.panel h3{margin:0 0 8px;font-size:16px}.diagram{height:310px;display:grid;place-items:center;background:#fff}.diagram img{width:78%;height:78%;object-fit:contain}
pre{margin:0;white-space:pre-wrap;font:15px/1.28 "SFMono-Regular",Consolas,monospace;color:#242724}.fact{font:15px/1.45 "SFMono-Regular",Consolas,monospace}.invalid{height:310px;display:grid;place-items:center;text-align:center;color:#8a2f28}.invalid strong{font-size:28px}.invalid code{display:block;margin-top:12px;font-size:18px;color:#53221e}
</style><main class="page"><h1 class="heading">Section A · same inputs, enforceable output contracts</h1><p class="lede">A disconnected self-loop exercises graphical bounds; a state final node exercises strict <code>useAscii: true</code> projection.</p><div class="sheet">
<section class="card before"><h2>Before · ${escapeHtml(BEFORE_SHA)}</h2><p class="caption">The graphical backend returned a nominal success with non-finite geometry, while ASCII mode leaked a Unicode box character.</p><span class="badge bad">invalid SVG bounds</span><span class="badge bad">not 7-bit ASCII</span>
<div class="panel"><h3>Graphical output</h3><div class="invalid"><div><strong>Browser cannot render this SVG reliably</strong><code>viewBox=&quot;${escapeHtml(before.viewBox)}&quot;</code></div></div></div>
<div class="panel"><h3>ASCII output · offender ${escapeHtml(beforeOffender)}</h3><pre>${escapeHtml(before.ascii)}</pre></div></section>
<section class="card after"><h2>After · Section A contracts</h2><p class="caption">Non-finite ELK output enters the deterministic fallback ladder, and ASCII projection stays inside the advertised character set.</p><span class="badge good">finite SVG bounds</span><span class="badge good">strict 7-bit ASCII</span>
<div class="panel"><h3>Graphical output · viewBox ${escapeHtml(after.viewBox)}</h3><div class="diagram"><img src="${svgDataUrl(after.svg)}"></div></div>
<div class="panel"><h3>ASCII output · non-ASCII characters: ${escapeHtml(afterOffender)}</h3><pre>${escapeHtml(after.ascii)}</pre></div></section>
</div></main>`

  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 2200, height: 1500 }, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'load' })
    await page.screenshot({ path: OUT, fullPage: true, animations: 'disabled' })
  } finally {
    await browser.close()
  }
  console.log(`wrote ${OUT}`)
} finally {
  try {
    execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: ROOT, stdio: 'pipe' })
  } catch {}
  rmSync(worktree, { recursive: true, force: true })
}
