// Renders `graticule polygon` across a spread of axis counts — the polygon's
// shape is driven by the number of axes (3 -> triangle, 4 -> square, 5 -> pentagon,
// 6 -> hexagon, 7 -> heptagon, 8 -> octagon). Rasterizes each with Resvg, composes
// a labelled grid, and screenshots it to docs/design/families/radar-polygon-variety.png.
// Run: bun run scripts/pr-assets/radar-polygon-variety.ts
import { writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { chromium } from 'playwright'
import '../../src/index.ts'
import { renderMermaidSVG } from '../../src/agent/index.ts'
import { inlineFontVarForRaster } from '../../src/theme.ts'

const ROOT = join(import.meta.dir, '..', '..')
const FONT_DIR = join(ROOT, 'assets', 'fonts')
const OUT = join(ROOT, 'docs', 'design', 'families', 'radar-polygon-variety.png')
// macOS Chrome, else the managed-CI pre-installed Chromium; else Playwright's default.
const chromePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/opt/pw-browsers/chromium'].find(existsSync)

// The `graticule polygon` shape follows the axis count.
const CASES = [
  { shape: '3 axes → triangle', source: 'radar-beta\n  title Incident response\n  axis detect["Detect"], respond["Respond"], recover["Recover"]\n  curve q3["Q3"]{3, 2, 4}\n  curve q4["Q4"]{4, 4, 3}\n  graticule polygon\n  max 5' },
  { shape: '4 axes → square', source: 'radar-beta\n  title Restaurant\n  axis food["Food"], service["Service"], price["Price"], ambiance["Ambiance"]\n  curve a["A"]{4, 3, 2, 4}\n  curve b["B"]{3, 4, 3, 3}\n  graticule polygon\n  max 5' },
  { shape: '5 axes → pentagon', source: 'radar-beta\n  title Team skills\n  axis design["Design"], code["Code"], comms["Comms"], ops["Ops"], data["Data"]\n  curve alice["Alice"]{4, 5, 3, 2, 4}\n  curve bob["Bob"]{3, 3, 5, 4, 3}\n  graticule polygon\n  max 5' },
  { shape: '6 axes → hexagon', source: 'radar-beta\n  title Model comparison\n  axis speed["Speed"], accuracy["Accuracy"], cost["Cost"], latency["Latency"], context["Context"], safety["Safety"]\n  curve a["Model A"]{4, 5, 3, 4, 4, 5}\n  curve b["Model B"]{5, 3, 4, 3, 5, 3}\n  graticule polygon\n  max 5' },
  { shape: '7 axes → heptagon', source: 'radar-beta\n  title Product scorecard\n  axis ux["UX"], perf["Perf"], docs["Docs"], api["API"], price["Price"], support["Support"], eco["Ecosystem"]\n  curve now["Now"]{4, 3, 2, 4, 3, 5, 3}\n  graticule polygon\n  max 5' },
  { shape: '8 axes → octagon', source: 'radar-beta\n  title Wind rose\n  axis n["N"], ne["NE"], e["E"], se["SE"], s["S"], sw["SW"], w["W"], nw["NW"]\n  curve winter["Winter"]{5, 3, 2, 1, 2, 4, 5, 4}\n  graticule polygon\n  max 5' },
]

function rasterB64(svg: string, width: number): string {
  const png = new Resvg(inlineFontVarForRaster(svg), {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: false, fontDirs: [FONT_DIR], defaultFontFamily: 'Inter' },
  }).render().asPng()
  return Buffer.from(png).toString('base64')
}

const tiles = CASES.map(c => {
  const b64 = rasterB64(renderMermaidSVG(c.source, { embedFontImport: false } as never), 460)
  return `<figure><img alt="radar polygon ${c.shape}" src="data:image/png;base64,${b64}"><figcaption>${c.shape}</figcaption></figure>`
}).join('\n')

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#fff;color:#1a1a1a;font:14px/1.4 system-ui,sans-serif;padding:24px}
  h1{font-size:19px;margin:0 0 4px} p.sub{color:#667;margin:0 0 18px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
  figure{margin:0;border:1px solid #e5e5e0;border-radius:10px;overflow:hidden}
  img{display:block;width:100%;height:auto}
  figcaption{font:13px ui-monospace,monospace;color:#333;background:#f6f6f4;padding:8px 10px;border-top:1px solid #e5e5e0}
</style></head><body>
  <h1>Radar — <code>graticule polygon</code> across axis counts</h1>
  <p class="sub">The polygon's shape follows the number of axes; the straight polygon edges join the same value-scaled vertices a smooth curve would.</p>
  <div class="grid">${tiles}</div>
</body></html>`

const HTML_OUT = join(import.meta.dir, 'radar-polygon-variety.html')
writeFileSync(HTML_OUT, html)

const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) })
const page = await browser.newPage({ viewport: { width: 1500, height: 1040 }, deviceScaleFactor: 2 })
await page.goto(`file://${HTML_OUT}`)
const body = await page.$('body')
await body!.screenshot({ path: OUT })
await browser.close()
console.log(`wrote ${OUT} — ${CASES.length} polygon graticules`)
