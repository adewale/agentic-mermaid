/**
 * Render the lettered contact-sheet scenarios into one reviewable PNG.
 *
 *   bun run contact:sheet            → /tmp/visual-rubric/contact-sheet.png
 *   bun run contact:sheet out.png    → out.png
 *
 * The same scenarios are pinned in `src/__tests__/contact-sheet.test.ts`
 * (geometry snapshots + zero hard rubric metrics), so this sheet is the
 * human-reviewable face of an automated visual-regression gate.
 */
import { Resvg } from '@resvg/resvg-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { renderMermaidSVG } from '../../src/index.ts'
import { contactSheetScenarios } from './scenarios.ts'

const out = process.argv[2] ?? '/tmp/visual-rubric/contact-sheet.png'
const scenarios = contactSheetScenarios()

const COLS = 2
const CELL_W = 700
const CELL_H = 300
const rows = Math.ceil(scenarios.length / COLS)
const cells = scenarios.map((sc, i) => {
  const x = (i % COLS) * CELL_W + 20
  const y = Math.floor(i / COLS) * CELL_H + 50
  const svg = renderMermaidSVG(sc.source).replace(/<\?xml[^>]*\?>/, '')
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 620 } }).render().asPng()
  const b64 = Buffer.from(png).toString('base64')
  return `<text x="${x}" y="${y - 8}" font-size="15" font-weight="bold" fill="#5c1a0a">${sc.letter} — ${sc.title}</text>
    <image x="${x}" y="${y}" width="${CELL_W - 60}" height="${CELL_H - 70}" preserveAspectRatio="xMinYMin meet" href="data:image/png;base64,${b64}"/>`
}).join('\n')

const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${COLS * CELL_W + 40}" height="${rows * CELL_H + 60}" font-family="sans-serif">
  <rect width="100%" height="100%" fill="#fdf6ec"/>
  <text x="20" y="30" font-size="20" font-weight="bold" fill="#5c1a0a">Port ranking + port-lane alignment — contact sheet (pinned in contact-sheet.test.ts)</text>
  ${cells}</svg>`

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, new Resvg(sheet, { fitTo: { mode: 'width', value: COLS * CELL_W + 40 } }).render().asPng())
console.log(`wrote ${out} — ${scenarios.length} scenarios`)
