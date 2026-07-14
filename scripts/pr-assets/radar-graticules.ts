// Renders the SAME radar under every supported graticule (circle, polygon) so
// the difference — ring shape AND curve-edge treatment (smooth Catmull-Rom vs
// straight polygon edges) — is directly comparable on identical data. Rasterizes
// each with Resvg, composes a labelled side-by-side HTML, and screenshots it to
// docs/design/families/radar-graticules.png with the pre-installed Chromium.
// Run: bun run scripts/pr-assets/radar-graticules.ts
import { writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { chromium } from 'playwright'
import '../../src/index.ts'
import { renderMermaidSVG } from '../../src/agent/index.ts'
import { inlineFontVarForRaster } from '../../src/theme.ts'

const ROOT = join(import.meta.dir, '..', '..')
const FONT_DIR = join(ROOT, 'assets', 'fonts')
const OUT = join(ROOT, 'docs', 'design', 'families', 'radar-graticules.png')
// macOS Chrome, else the managed-CI pre-installed Chromium; else Playwright's default.
const chromePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/opt/pw-browsers/chromium'].find(existsSync)

// One identical dataset; only the `graticule` line changes between tiles.
const BODY = `  title Team skills
  axis design["Design"], code["Code"], comms["Comms"], ops["Ops"], data["Data"]
  curve alice["Alice"]{4, 5, 3, 2, 4}
  curve bob["Bob"]{3, 3, 5, 4, 3}
  max 5`

const GRATICULES = [
  { kind: 'circle', caption: 'graticule circle — circular rings + smooth closed Catmull-Rom curves (the default)' },
  { kind: 'polygon', caption: 'graticule polygon — polygonal rings + straight polygon edges' },
] as const

function rasterB64(svg: string, width: number): string {
  const png = new Resvg(inlineFontVarForRaster(svg), {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: false, fontDirs: [FONT_DIR], defaultFontFamily: 'Inter' },
  }).render().asPng()
  return Buffer.from(png).toString('base64')
}

function tile(kind: string, caption: string): string {
  const source = `radar-beta\n${BODY}\n  graticule ${kind}`
  const b64 = rasterB64(renderMermaidSVG(source, { embedFontImport: false } as never), 520)
  return `<figure><img alt="radar ${kind} graticule" src="data:image/png;base64,${b64}"><figcaption><code>${kind}</code> — ${caption.replace(/^graticule \w+ — /, '')}</figcaption></figure>`
}

const tiles = GRATICULES.map(g => tile(g.kind, g.caption)).join('\n')
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#fff;color:#1a1a1a;font:14px/1.4 system-ui,sans-serif;padding:24px}
  h1{font-size:19px;margin:0 0 4px} p.sub{color:#667;margin:0 0 18px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
  figure{margin:0;border:1px solid #e5e5e0;border-radius:10px;overflow:hidden}
  img{display:block;width:100%;height:auto}
  figcaption{font:12.5px/1.4 ui-monospace,monospace;color:#333;background:#f6f6f4;padding:8px 10px;border-top:1px solid #e5e5e0}
  figcaption code{background:#ececea;padding:1px 5px;border-radius:4px}
</style></head><body>
  <h1>Radar — all supported graticules</h1>
  <p class="sub">Identical data (5 axes, 2 curves). Only the <code>graticule</code> option differs, changing both the ring shape and the curve-edge treatment.</p>
  <div class="grid">${tiles}</div>
</body></html>`

const HTML_OUT = join(import.meta.dir, 'radar-graticules.html')
writeFileSync(HTML_OUT, html)

const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) })
const page = await browser.newPage({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 2 })
await page.goto(`file://${HTML_OUT}`)
const body = await page.$('body')
await body!.screenshot({ path: OUT })
await browser.close()
console.log(`wrote ${OUT} — ${GRATICULES.length} graticules`)
