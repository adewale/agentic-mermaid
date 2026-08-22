#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { renderMermaidSVG, verifyNoExternalRefs } from '../../src/index.ts'

const ROOT = join(import.meta.dir, '..', '..')
const FIXTURE = join(ROOT, 'docs', 'design', 'families', 'sankey-flows-demo.mmd')
const OUTPUT = join(ROOT, 'docs', 'design', 'families', 'sankey-mermaid-agentic-comparison.png')
const MERMAID_VERSION = JSON.parse(
  readFileSync(join(ROOT, 'node_modules', 'mermaid', 'package.json'), 'utf8'),
).version as string
const source = readFileSync(FIXTURE, 'utf8')
const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const browser = await chromium.launch({
  headless: true,
  ...(existsSync(localChrome) ? { executablePath: localChrome } : {}),
})

const officialPage = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await officialPage.setContent('<div id="official"></div>')
await officialPage.addScriptTag({
  path: join(ROOT, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'),
})
const officialSvgRaw = await officialPage.evaluate(async ({ source }) => {
  const mermaid = (
    globalThis as typeof globalThis & {
      mermaid: {
        initialize(config: object): void
        render(id: string, source: string): Promise<{ svg: string }>
      }
    }
  ).mermaid
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    deterministicIds: true,
    deterministicIDSeed: 'sankey-pr-192-comparison',
    theme: 'default',
    fontFamily: 'Arial',
    sankey: { width: 600, height: 400 },
  })
  return (await mermaid.render('sankey-official-comparison', source)).svg
}, { source })
await officialPage.close()

// Mermaid emits insignificant trailing whitespace in multiline SVG attributes.
const officialSvg = officialSvgRaw.replace(/[ \t]+\n/g, '\n')
const agenticSvg = renderMermaidSVG(source, {
  embedFontImport: false,
  mermaidConfig: {
    fontFamily: 'Arial',
    sankey: { width: 600, height: 400 },
  },
})
if (verifyNoExternalRefs(agenticSvg).ok === false) {
  throw new Error('Agentic Mermaid comparison render contains an external SVG reference')
}

const page = await browser.newPage({
  viewport: { width: 1640, height: 1100 },
  deviceScaleFactor: 1,
})
await page.setContent(`<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  body{margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,sans-serif}
  main{width:1600px;margin:20px;padding:24px;background:#fff;border:1px solid #d4d4d8;border-radius:18px}
  h1{margin:0 0 6px;font-size:28px}
  .subtitle{margin:0 0 18px;color:#52525b;font-size:14px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  section{border:1px solid #d4d4d8;border-radius:13px;overflow:hidden;background:#fff}
  header{padding:13px 16px 11px;border-bottom:1px solid #e4e4e7;background:#fafafa}
  h2{margin:0 0 4px;font-size:18px}
  .note{margin:0;color:#52525b;font-size:12px;line-height:1.4}
  .visual{height:520px;padding:18px;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .visual svg{display:block;max-width:100%!important;width:100%!important;max-height:484px!important;height:auto!important}
  .review{margin-top:18px;padding:14px 16px;border-left:5px solid #2563eb;border-radius:8px;background:#eff6ff;font-size:13px;line-height:1.5}
  .review strong{color:#1e3a8a}
  code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
</style><main>
  <h1>Sankey — same source, two production renderers</h1>
  <p class="subtitle">Semantic and layout comparison, not pixel equivalence. Fixture: <code>docs/design/families/sankey-flows-demo.mmd</code>.</p>
  <div class="grid">
    <section>
      <header><h2>Mermaid ${MERMAID_VERSION}</h2><p class="note">Browser renderer · d3-sankey 0.12.3 · upstream Tableau palette and label composition.</p></header>
      <div class="visual">${officialSvg}</div>
    </section>
    <section>
      <header><h2>Agentic Mermaid</h2><p class="note">Production SVG renderer · d3-sankey 0.12.3 · typed Scene gradients and deterministic resources.</p></header>
      <div class="visual">${agenticSvg}</div>
    </section>
  </div>
  <div class="review"><strong>What to inspect:</strong> the same eight authored links, node layers, ribbon-width ordering, and source-to-target gradients. Expected differences are palette, typography and label bounds, outer canvas margins, and renderer-specific compositing—not flow meaning or topology.</div>
</main>`)
await page.locator('main').screenshot({ path: OUTPUT })
await page.close()
await browser.close()

console.log(`wrote ${OUTPUT}`)
