import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'

const ROOT = join(import.meta.dir, '..', '..')
const DEMOS = join(ROOT, 'docs', 'design', 'families')
export const OUTPUT_PATH = join(ROOT, 'docs', 'design', 'families', 'style-palette-all-families-after.png')

const STACK = ['hand-drawn', 'dracula'] as const
const SEED = 7
const CELL_W = 500
const CELL_H = 360
const COLS = 3
const PAD = 20
const LABEL_H = 34
const FONT_FILES = [
  join(ROOT, 'assets', 'fonts', 'DejaVuSans.ttf'),
  join(ROOT, 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
].filter(existsSync)

const FAMILIES = [
  ['Flowchart', 'flowchart-v11-shapes-demo.mmd', {}],
  ['State', 'state-pseudostates-demo.mmd', {}],
  ['Sequence', 'sequence-config-demo.mmd', {}],
  ['Timeline', 'timeline-vertical-demo.mmd', {}],
  ['Class', 'class-namespaces-demo.mmd', {}],
  ['ER', 'er-direction-demo.mmd', {}],
  ['Journey', 'journey-section-overlap-demo.mmd', {}],
  ['Architecture', 'architecture-align-demo.mmd', {}],
  ['XYChart', 'xychart-legend-demo.mmd', {}],
  ['Pie', 'pie-donut-labels-demo.mmd', {}],
  ['Quadrant', 'quadrant-styling-demo.mmd', {}],
  ['Gantt', 'gantt-dependency-overlay-demo.mmd', { gantt: { dependencyArrows: true, criticalPath: true } }],
  ['Mindmap', 'mindmap-demo.mmd', {}],
  ['GitGraph', 'gitgraph-demo.mmd', {}],
  ['Radar', 'radar-demo.mmd', {}],
] as const

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function svgSize(svg: string): { width: number; height: number } {
  const match = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  if (!match) throw new Error('Rendered family SVG has no finite viewBox')
  return { width: Number(match[1]), height: Number(match[2]) }
}

function raster(source: string, renderOptions: Record<string, unknown>): { b64: string; width: number; height: number } {
  const svg = renderMermaidSVG(source, { ...renderOptions, style: [...STACK], seed: SEED, embedFontImport: false })
  const size = svgSize(svg)
  const maxW = CELL_W - PAD * 2
  const maxH = CELL_H - LABEL_H - PAD * 2
  const scale = Math.min(maxW / size.width, maxH / size.height)
  const width = Math.max(1, Math.round(size.width * scale))
  const height = Math.max(1, Math.round(size.height * scale))
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' },
  }).render().asPng()
  return { b64: Buffer.from(png).toString('base64'), width, height }
}

export function buildPng(): Uint8Array {
  const rows = Math.ceil(FAMILIES.length / COLS)
  const width = COLS * CELL_W
  const height = rows * CELL_H
  const cells = FAMILIES.map(([family, fixture, renderOptions], index) => {
    const source = readFileSync(join(DEMOS, fixture), 'utf8')
    const image = raster(source, renderOptions)
    const col = index % COLS
    const row = Math.floor(index / COLS)
    const x0 = col * CELL_W
    const y0 = row * CELL_H
    const x = x0 + (CELL_W - image.width) / 2
    const y = y0 + LABEL_H + (CELL_H - LABEL_H - image.height) / 2
    return `<g>
      <rect x="${x0 + 1}" y="${y0 + 1}" width="${CELL_W - 2}" height="${CELL_H - 2}" rx="12" fill="#282a36" stroke="#6272a4" stroke-width="2"/>
      <text x="${x0 + PAD}" y="${y0 + 25}" fill="#f8f8f2" font-family="DejaVu Sans, sans-serif" font-size="17" font-weight="700">${esc(family)}</text>
      <image x="${x}" y="${y}" width="${image.width}" height="${image.height}" href="data:image/png;base64,${image.b64}"/>
    </g>`
  }).join('\n')
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#1f2029"/>
    ${cells}
  </svg>`
  return new Resvg(sheet, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' },
  }).render().asPng()
}

if (import.meta.main) {
  mkdirSync(join(ROOT, 'docs', 'design', 'families'), { recursive: true })
  writeFileSync(OUTPUT_PATH, buildPng())
  console.log(`wrote ${OUTPUT_PATH}`)
}
