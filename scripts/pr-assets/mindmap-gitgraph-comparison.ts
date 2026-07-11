#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { renderMermaidASCII, renderMermaidSVG } from '../../src/index.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT = join(ROOT, 'docs', 'design', 'families')
const MERMAID_VERSION = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'mermaid', 'package.json'), 'utf8')).version as string
const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(localChrome) ? { executablePath: localChrome } : {}),
})

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

for (const family of ['mindmap', 'gitgraph'] as const) {
  const source = readFileSync(join(OUT, `${family}-demo.mmd`), 'utf8')
  const officialPage = await browser.newPage({ viewport: { width: 1800, height: 1300 } })
  await officialPage.setContent('<div id="official"></div>')
  await officialPage.addScriptTag({ path: join(ROOT, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js') })
  const officialSvgRaw = await officialPage.evaluate(async ({ source, family }) => {
    const mermaid = (globalThis as typeof globalThis & { mermaid: { initialize(config: object): void; render(id: string, source: string): Promise<{ svg: string }> } }).mermaid
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', fontFamily: 'Arial' })
    return (await mermaid.render(`${family}-official`, source)).svg
  }, { source, family })
  await officialPage.close()
  // Mermaid emits multiline path/polygon attributes with trailing spaces.
  // Normalize insignificant line-end whitespace so committed evidence passes
  // repository diff hygiene without changing rendered geometry.
  const officialSvg = officialSvgRaw.replace(/[ \t]+\n/g, '\n')

  const agenticSvg = renderMermaidSVG(source, { embedFontImport: false })
  const terminal = renderMermaidASCII(source, { targetWidth: family === 'gitgraph' ? 100 : 72, colorMode: 'none' })
  writeFileSync(join(OUT, `${family}-mermaid-${MERMAID_VERSION}.svg`), officialSvg)
  writeFileSync(join(OUT, `${family}-terminal-after.txt`), `${terminal}\n`)

  const unsupportedHeader = family === 'mindmap' ? 'mindmap' : 'gitGraph'
  const page = await browser.newPage({ viewport: { width: 1640, height: 1300 }, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0;background:#f5f5f4;color:#18181b;font-family:Arial,sans-serif}
    main{width:1600px;margin:20px;padding:22px;background:white;border:1px solid #d6d3d1;border-radius:18px}
    h1{font-size:26px;margin:0 0 6px} .subtitle{font-size:14px;color:#57534e;margin-bottom:18px}
    .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;align-items:start}
    section{border:1px solid #d6d3d1;border-radius:12px;padding:14px;min-width:0;overflow:hidden;background:#fff}
    h2{font-size:16px;margin:0 0 4px}.note{font-size:12px;color:#78716c;margin-bottom:10px;min-height:30px}
    .visual{display:flex;justify-content:center;align-items:flex-start;min-height:430px;overflow:hidden}
    .visual svg{max-width:100%!important;width:100%!important;height:auto!important;max-height:760px}
    pre{font:12px/1.28 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow:hidden;margin:0;color:#27272a}
    .unsupported{margin-top:16px;border-left:5px solid #b45309;background:#fffbeb;padding:12px 14px;border-radius:8px;font-size:13px}
    code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  </style><main>
    <h1>${family === 'mindmap' ? 'Mindmap' : 'GitGraph'} — same authored source, three product surfaces</h1>
    <div class="subtitle">Semantic comparison, not pixel equivalence. Official Mermaid ${MERMAID_VERSION}; Agentic Mermaid SVG and hard-width Unicode terminal output.</div>
    <div class="grid">
      <section><h2>Official Mermaid ${MERMAID_VERSION}</h2><div class="note">Browser renderer: upstream layout, symbols, and styling.</div><div class="visual">${officialSvg}</div></section>
      <section><h2>Agentic Mermaid SVG</h2><div class="note">Deterministic geometry, semantic IDs, accessibility, typed editing.</div><div class="visual">${agenticSvg}</div></section>
      <section><h2>Agentic Mermaid Unicode</h2><div class="note">Display-cell measured; hard target width ${family === 'gitgraph' ? 100 : 72}.</div><pre>${escapeHtml(terminal)}</pre></section>
    </div>
    <div class="unsupported"><strong>AlexanderGrooff/mermaid-ascii 1.4.0:</strong> exit 1 — <code>unsupported graph type '${unsupportedHeader}'</code>. Its current documented families are Flowchart and Sequence; this is a capability comparison, not a visual failure.</div>
  </main>`)
  await page.locator('main').screenshot({ path: join(OUT, `${family}-renderer-comparison.png`) })
  await page.close()
}

await browser.close()
console.log(`wrote Mindmap/GitGraph Mermaid ${MERMAID_VERSION}, Agentic SVG/terminal comparison artifacts`)
