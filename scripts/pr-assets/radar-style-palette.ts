// Generates radar Look/Palette contact sheets: renders one radar across every
// registered Look (fixed palette) and every Palette (default Look), rasterizes
// each with Resvg, and writes an HTML contact sheet + inlined base64 PNGs.
// Run: bun run scripts/pr-assets/radar-style-palette.ts
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { chromium } from 'playwright'
import '../../src/index.ts'
import { renderMermaidSVG } from '../../src/agent/index.ts'
import { knownStyles, getStyle, styleKind } from '../../src/scene/style-registry.ts'
import { inlineFontVarForRaster } from '../../src/theme.ts'

const ROOT = join(import.meta.dir, '..', '..')
const FONT_DIR = join(ROOT, 'assets', 'fonts')
const HTML_OUT = join(ROOT, 'scripts', 'pr-assets', 'radar-style-palette.html')
const PNG_OUT = join(ROOT, 'docs', 'design', 'families', 'radar-style-palette-sheet.png')
const chromePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/opt/pw-browsers/chromium'].find(existsSync)

const SOURCE = `radar-beta
  title Profile
  axis speed["Speed"], power["Power"], range["Range"]
  axis comfort["Comfort"], tech["Tech"], safety["Safety"]
  curve a["Alpha"]{4, 5, 3, 4, 4, 5}
  curve b["Beta"]{5, 3, 4, 5, 3, 3}
  max 5`

const names = knownStyles()
const looks = names.filter(n => { const s = getStyle(n); return s && styleKind(s) === 'look' })
const palettes = names.filter(n => { const s = getStyle(n); return s && styleKind(s) === 'palette' })

function rasterB64(svg: string, width: number): string {
  const png = new Resvg(inlineFontVarForRaster(svg), {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: false, fontDirs: [FONT_DIR], defaultFontFamily: 'Inter' },
  }).render().asPng()
  return Buffer.from(png).toString('base64')
}

function tile(label: string, style: string[]): string {
  const svg = renderMermaidSVG(SOURCE, { style, embedFontImport: false } as never)
  const b64 = rasterB64(svg, 460)
  return `<figure><img alt="${label}" src="data:image/png;base64,${b64}"><figcaption>${label}</figcaption></figure>`
}

const lookTiles = looks.map(l => tile(l, [l, 'github-light'])).join('\n')
const paletteTiles = palettes.map(p => tile(p, [p])).join('\n')

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#0f1115;color:#e8e8ea;font:14px/1.4 system-ui,sans-serif;padding:28px}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;letter-spacing:.02em;text-transform:uppercase;color:#9aa;margin:28px 0 12px;border-bottom:1px solid #2a2d34;padding-bottom:6px}
  p.sub{color:#9aa;margin:0 0 8px}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  figure{margin:0;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #2a2d34}
  img{display:block;width:100%;height:auto}
  figcaption{font:12px ui-monospace,monospace;color:#333;background:#f4f4f2;padding:6px 8px;border-top:1px solid #e5e5e0}
</style></head><body>
  <h1>Radar family — every Style (Look) and every Palette</h1>
  <p class="sub">One radar (${looks.length} Looks + ${palettes.length} Palettes = ${looks.length + palettes.length} renders). Each is real renderer output; per-curve colors come from the shared chart palette so radar recolors correctly under every theme, and the pie-slice role lets the hand-drawn / watercolor Looks sketch the filled areas.</p>
  <h2>All ${looks.length} Looks (palette: github-light)</h2>
  <div class="grid">${lookTiles}</div>
  <h2>All ${palettes.length} Palettes (default Look)</h2>
  <div class="grid">${paletteTiles}</div>
</body></html>`

writeFileSync(HTML_OUT, html)
const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) })
const page = await browser.newPage({ viewport: { width: 1880, height: 4200 }, deviceScaleFactor: 1 })
await page.goto(`file://${HTML_OUT}`)
const body = await page.$('body')
await body!.screenshot({ path: PNG_OUT })
await browser.close()
rmSync(HTML_OUT)
console.log(`wrote ${PNG_OUT} — ${looks.length} looks + ${palettes.length} palettes`)
