/**
 * Render the lettered contact-sheet scenarios into one reviewable PNG.
 *
 *   bun run contact:sheet            → /tmp/visual-rubric/contact-sheet.png
 *   bun run contact:sheet out.png    → out.png
 *
 * The same scenarios are pinned in `src/__tests__/contact-sheet.test.ts`
 * (geometry snapshots + zero hard rubric metrics), and
 * `src/__tests__/contact-sheet-png.test.ts` byte-compares the committed PNG
 * so the human-review artifact is also a visual-regression gate.
 */
import { Resvg } from '@resvg/resvg-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderMermaidSVG } from '../../src/index.ts'
import { contactSheetScenarios } from './scenarios.ts'

const FONT_FAMILY = 'DejaVu Sans'
const here = dirname(fileURLToPath(import.meta.url))
const fontFiles = [
  resolve(here, '../../assets/fonts/DejaVuSans.ttf'),
  resolve(here, '../../assets/fonts/DejaVuSans-Bold.ttf'),
]
const resvgOptions = (fitTo: { mode: 'width'; value: number }) => ({
  fitTo,
  font: {
    loadSystemFonts: false,
    fontFiles,
    defaultFontFamily: FONT_FAMILY,
    sansSerifFamily: FONT_FAMILY,
  },
})

const COLS = 2
const CELL_W = 700
const CELL_H = 300
const SHEET_BG = '#ffffff'
const TEXT = '#111827'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function renderContactSheetSvg(): string {
  const scenarios = contactSheetScenarios()
  const rows = Math.ceil(scenarios.length / COLS)
  const cells = scenarios.map((sc, i) => {
    const x = (i % COLS) * CELL_W + 20
    const y = Math.floor(i / COLS) * CELL_H + 50
    const svg = renderMermaidSVG(sc.source, { font: FONT_FAMILY, embedFontImport: false }).replace(/<\?xml[^>]*\?>/, '')
    const png = new Resvg(svg, resvgOptions({ mode: 'width', value: 620 })).render().asPng()
    const b64 = Buffer.from(png).toString('base64')
    return `<text x="${x}" y="${y - 8}" font-size="15" font-weight="bold" fill="${TEXT}">${esc(sc.letter)} — ${esc(sc.title)}</text>
    <image x="${x}" y="${y}" width="${CELL_W - 60}" height="${CELL_H - 70}" preserveAspectRatio="xMinYMin meet" href="data:image/png;base64,${b64}"/>`
  }).join('\n')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${COLS * CELL_W + 40}" height="${rows * CELL_H + 60}" font-family="${FONT_FAMILY}">
  <rect width="100%" height="100%" fill="${SHEET_BG}"/>
  <text x="20" y="30" font-size="20" font-weight="bold" fill="${TEXT}">Port ranking + port-lane alignment — contact sheet (pinned in contact-sheet.test.ts)</text>
  ${cells}</svg>`
}

export function renderContactSheetPng(): Buffer {
  return Buffer.from(new Resvg(renderContactSheetSvg(), resvgOptions({ mode: 'width', value: COLS * CELL_W + 40 })).render().asPng())
}

export function writeContactSheet(out: string): void {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, renderContactSheetPng())
  console.log(`wrote ${out} — ${contactSheetScenarios().length} scenarios`)
}

if (import.meta.main) {
  writeContactSheet(process.argv[2] ?? '/tmp/visual-rubric/contact-sheet.png')
}
