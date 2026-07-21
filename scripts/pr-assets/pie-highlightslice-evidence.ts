#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { renderMermaidSVG } from '../../src/index.ts'
import { renderMermaidPNG } from '../../src/agent/png.ts'
import { wcagCssContrastRatio } from '../../src/shared/color-math.ts'
import { hashArtifactInputs, repositoryPath, runtimeDependencyClosure, runtimeDependencySummary, sha256File, sortRepositoryPaths, transitiveLocalInputs } from './artifact-receipt.ts'

const ROOT = join(import.meta.dir, '..', '..')
const MATRIX_OUTPUT = join(ROOT, 'docs', 'design', 'families', 'pie-highlightslice-regression-matrix.png')
const AFTER_OUTPUT = join(ROOT, 'docs', 'design', 'families', 'pie-highlightslice-after.png')
const RECEIPT = join(ROOT, 'eval', 'pie-highlightslice', 'evidence-receipt.json')
// macOS Chrome, else the managed-CI pre-installed Chromium; else Playwright's default.
const chromePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/opt/pw-browsers/chromium'].find(existsSync)

const repoPath = (path: string): string => repositoryPath(ROOT, path)
const receiptEntrypoints = [import.meta.filename]
const inputPaths = sortRepositoryPaths(ROOT, [
  ...transitiveLocalInputs(ROOT, receiptEntrypoints),
])
const runtimeDependencies = runtimeDependencyClosure(ROOT, receiptEntrypoints)
const currentReceipt = () => ({
  schemaVersion: 1,
  generator: repoPath(import.meta.filename),
  inputCount: inputPaths.length,
  inputTreeSha256: hashArtifactInputs(ROOT, inputPaths, runtimeDependencies),
  runtimeDependencies: runtimeDependencySummary(runtimeDependencies),
  outputs: [MATRIX_OUTPUT, AFTER_OUTPUT].map(path => ({
    path: repoPath(path),
    sha256: sha256File(path),
  })),
})

if (process.argv.includes('--check')) {
  const recorded = JSON.parse(readFileSync(RECEIPT, 'utf8'))
  if (JSON.stringify(recorded) !== JSON.stringify(currentReceipt())) {
    throw new Error('Pie highlightSlice evidence is stale; run bun run gallery:pie-highlight')
  }
  console.log('Pie highlightSlice evidence is synchronized')
  process.exit(0)
}

const staticSource = `---
config:
  pie:
    textPosition: 0.5
    donutHole: 0.2
    highlightSlice: Potassium — long bold label
  themeVariables:
    pieOuterStrokeWidth: "5px"
    pieOpacity: 0.5
---
pie showData
  title Highlight × opacity × bold label
  "Calcium" : 42.96
  "Potassium — long bold label" : 50.05
  "Magnesium" : 10.01
  "Iron" : 5`

const styledSource = `---
config:
  pie:
    textPosition: 0.5
    donutHole: 0.2
    highlightSlice: Potassium
  themeVariables:
    pieOuterStrokeWidth: "5px"
---
pie showData
  title Styled backend keeps semantic emphasis
  "Calcium" : 42.96
  "Potassium" : 50.05
  "Magnesium" : 10.01
  "Iron" : 5`

const afterSource = styledSource.replace(
  'Styled backend keeps semantic emphasis',
  'Key elements in Product X',
)

const hoverSource = `---
config:
  pie:
    textPosition: 0.5
    donutHole: 0.2
    highlightSlice: hover
---
pie showData
  title Literal “hover” label × pointer tooltip
  "hover" : 45
  "Interactive overlay" : 35
  "Other" : 20`

const staticSvg = renderMermaidSVG(staticSource, { embedFontImport: false })
const dimmedSliceFill = staticSvg.match(/class="pie-slice pie-dim"[^>]*fill="([^"]+)"/)?.[1]
const dimmedLabelFill = staticSvg.match(/class="pie-slice-label"[^>]*fill="([^"]+)"/)?.[1]
if (!dimmedSliceFill || !dimmedLabelFill) throw new Error('Static evidence fixture must expose dimmed wedge paint')
// pieOpacity 0.5 × the 0.4 dim tier = 0.2 (0x33) before compositing over white.
const contrast = wcagCssContrastRatio(dimmedLabelFill, `${dimmedSliceFill}33`, '#ffffff')
if (contrast === null || contrast < 4.5) throw new Error(`Composited percentage-label contrast is ${contrast ?? 'unresolved'}`)
writeFileSync(AFTER_OUTPUT, renderMermaidPNG(afterSource, { scale: 4 }))

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cards = [
  {
    id: 'static-evidence',
    title: 'Crisp · static × opacity × long bold label',
    why: 'Exercises three previously missing cross-products in one authored chart.',
    inspect: `Selected wedge stays at full opacity; long bold row remains inside the SVG; dimmed-wedge text is ${contrast.toFixed(2)}:1 after compositing.`,
    svg: staticSvg,
  },
  {
    id: 'hand-drawn-evidence',
    title: 'Hand-drawn · styled backend × highlight',
    why: 'Styled renderers redraw from Scene paint rather than the crisp SVG string.',
    inspect: 'Potassium keeps the foreground outline and full opacity in the style-specific redraw.',
    svg: renderMermaidSVG(styledSource, { style: 'hand-drawn', embedFontImport: false }),
  },
  {
    id: 'watercolor-evidence',
    title: 'Watercolor · styled backend × highlight',
    why: 'A second Scene-backed renderer checks that emphasis is semantic, not backend-specific CSS luck.',
    inspect: 'Selected paint survives the watercolor redraw while sibling wedges remain de-emphasized.',
    svg: renderMermaidSVG(styledSource, { style: 'watercolor', embedFontImport: false }),
  },
  {
    id: 'hover-evidence',
    title: 'Browser · tooltip overlay × pointer hover',
    why: 'The transparent tooltip path owns hit-testing and previously masked the visible wedge hover.',
    inspect: 'The literal “hover” slice is inert at rest; after a real pointer move the overlay gains the foreground outline and the tooltip becomes visible.',
    svg: renderMermaidSVG(hoverSource, { interactive: true, embedFontImport: false }),
  },
].map(card => `<article id="${card.id}">
  <header><h2>${escapeHtml(card.title)}</h2><p><b>Why:</b> ${escapeHtml(card.why)}</p></header>
  <div class="visual">${card.svg}</div>
  <footer><b>What to inspect:</b> ${escapeHtml(card.inspect)}</footer>
</article>`).join('')

const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) })
const page = await browser.newPage({ viewport: { width: 1840, height: 1800 }, deviceScaleFactor: 1 })
await page.setContent(`<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,sans-serif}
  main{width:1800px;margin:20px;padding:26px;background:white;border:1px solid #d4d4d8;border-radius:18px}
  h1{margin:0 0 6px;font-size:30px}.subtitle{margin:0 0 20px;color:#52525b;font-size:15px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  article{border:1px solid #d4d4d8;border-radius:12px;overflow:hidden;background:#fff;display:grid;grid-template-rows:auto 470px auto}
  header{padding:12px 16px 10px;border-bottom:1px solid #e4e4e7}h2{margin:0 0 6px;font-size:18px}
  p{margin:0;color:#52525b;font-size:12px;line-height:1.4}.visual{display:flex;align-items:center;justify-content:center;padding:12px;overflow:hidden}
  .visual svg{display:block;max-width:100%!important;width:100%!important;max-height:446px!important;height:auto!important}
  footer{min-height:54px;border-top:1px solid #e4e4e7;padding:9px 14px;color:#3f3f46;background:#fafafa;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
</style><main><h1>Pie highlightSlice — regression cross-products</h1>
<p class="subtitle">Current renderer output · semantic paint, measured typography, real pointer interaction, and composited WCAG contrast</p>
<div class="grid">${cards}</div></main>`)
await page.evaluate(() => document.fonts?.ready)

const containment = await page.locator('#static-evidence .pie-legend-text').nth(1).evaluate((text: SVGGraphicsElement) => {
  const box = text.getBBox()
  const viewBox = text.ownerSVGElement!.viewBox.baseVal
  return viewBox.x + viewBox.width - box.x - box.width
})
if (containment < 1) throw new Error(`Long highlighted legend row overflows its SVG by ${-containment}px`)

const hitTarget = page.locator('#hover-evidence .pie-slice-hover-target').first()
const box = await hitTarget.boundingBox()
if (!box) throw new Error('Hover evidence target has no browser geometry')
const point = await hitTarget.evaluate((path, bounds) => {
  for (let y = bounds.y + 2; y < bounds.y + bounds.height - 1; y += 3) {
    for (let x = bounds.x + 2; x < bounds.x + bounds.width - 1; x += 3) {
      if (document.elementFromPoint(x, y) === path) return { x, y }
    }
  }
  return null
}, box)
if (!point) throw new Error('Could not find an interior point on the hover tooltip overlay')
await page.mouse.move(point.x, point.y)
await page.waitForFunction(() => {
  const target = document.querySelector('#hover-evidence .pie-slice-hover-target')
  const tip = document.querySelector('#hover-evidence .pie-tip')
  if (!target || !tip) return false
  return parseFloat(getComputedStyle(target).strokeWidth) === 2.5 && getComputedStyle(tip).opacity === '1'
})

await page.locator('main').screenshot({ path: MATRIX_OUTPUT })
await page.close()
await browser.close()
mkdirSync(join(ROOT, 'eval', 'pie-highlightslice'), { recursive: true })
writeFileSync(RECEIPT, `${JSON.stringify(currentReceipt(), null, 2)}\n`)
console.log(`wrote ${MATRIX_OUTPUT} and ${AFTER_OUTPUT}`)
