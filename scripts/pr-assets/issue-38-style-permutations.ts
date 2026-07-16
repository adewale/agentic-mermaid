import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'
import { parseMermaid } from '../../src/parser.ts'
import { layoutGraphSync } from '../../src/layout-engine.ts'
import { BUILTIN_PALETTE_DEFINITIONS } from '../../src/palette-catalog.ts'
import type { PositionedGraph } from '../../src/types.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'pr-assets')
const OUT_FILE = 'issue-38-style-permutation-contact-sheet.png'
export const OUTPUT_PATH = join(OUT_DIR, OUT_FILE)

const OPTIONS = {
  style: 'publication-figure',
  seed: 3,
}

const COLORS = BUILTIN_PALETTE_DEFINITIONS.find(palette => palette.inputName === 'salmon')!.colors
const FONT_FILES = [
  join(ROOT, 'assets', 'fonts', 'DejaVuSans.ttf'),
  join(ROOT, 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
].filter(existsSync)

const STYLES = [
  { key: 'solid', label: 'solid -->', op: '-->' },
  { key: 'dotted', label: 'dotted -.->', op: '-.->' },
  { key: 'thick', label: 'thick ==>', op: '==>' },
] as const

interface SvgSize { width: number; height: number }
interface Rect { x: number; y: number; width: number; height: number }
interface Raster { b64: string; width: number; height: number }

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function source(yesOp: string, needsWorkOp: string): string {
  return `flowchart TD
  subgraph product [Product Loop]
    A[Capture request] --> B{Ready?}
    B ${yesOp}|yes| C[Ship]
    B ${needsWorkOp}|needs work| D[Refine]
  end`
}

function renderSvg(yesOp: string, needsWorkOp: string): string {
  return renderMermaidSVG(source(yesOp, needsWorkOp), { ...COLORS, ...OPTIONS, embedFontImport: false })
}

function layout(yesOp: string, needsWorkOp: string): PositionedGraph {
  return layoutGraphSync(parseMermaid(source(yesOp, needsWorkOp)), OPTIONS)
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

function geometrySignature(positioned: PositionedGraph): string {
  return JSON.stringify({
    width: round(positioned.width),
    height: round(positioned.height),
    nodes: positioned.nodes.map(node => ({
      id: node.id,
      x: round(node.x),
      y: round(node.y),
      width: round(node.width),
      height: round(node.height),
      shape: node.shape,
    })),
    groups: positioned.groups.map(group => ({
      id: group.id,
      x: round(group.x),
      y: round(group.y),
      width: round(group.width),
      height: round(group.height),
    })),
    edges: positioned.edges.map(edge => ({
      source: edge.source,
      target: edge.target,
      label: edge.label,
      points: edge.points.map(point => ({ x: round(point.x), y: round(point.y) })),
      labelPosition: edge.labelPosition ? { x: round(edge.labelPosition.x), y: round(edge.labelPosition.y) } : undefined,
    })),
  })
}

function svgSize(svg: string): SvgSize {
  const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  if (viewBox) return { width: Number(viewBox[1]), height: Number(viewBox[2]) }
  const width = svg.match(/width="([\d.]+)"/)
  const height = svg.match(/height="([\d.]+)"/)
  return { width: Number(width?.[1] ?? 800), height: Number(height?.[1] ?? 600) }
}

function union(rects: Rect[]): Rect {
  const left = Math.min(...rects.map(r => r.x))
  const top = Math.min(...rects.map(r => r.y))
  const right = Math.max(...rects.map(r => r.x + r.width))
  const bottom = Math.max(...rects.map(r => r.y + r.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function expand(rect: Rect, amount: number): Rect {
  return { x: rect.x - amount, y: rect.y - amount, width: rect.width + amount * 2, height: rect.height + amount * 2 }
}

function focusBox(svg: string): Rect {
  const rects: Rect[] = []
  for (const node of svg.matchAll(/<g class="node" data-id="([BCD])"[\s\S]*?<\/g>/g)) {
    const body = node[0]
    const rect = body.match(/<rect[^>]* x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/)
    if (rect) {
      rects.push({ x: Number(rect[1]), y: Number(rect[2]), width: Number(rect[3]), height: Number(rect[4]) })
      continue
    }
    const polygon = body.match(/<polygon points="([^"]+)"/)
    if (polygon) {
      const points = polygon[1]!.trim().split(/\s+/).flatMap(pair => {
        const coords = pair.split(',').map(Number)
        const x = coords[0]
        const y = coords[1]
        return Number.isFinite(x) && Number.isFinite(y) ? [{ x: x!, y: y! }] : []
      })
      rects.push(union(points.map(point => ({ x: point.x, y: point.y, width: 0, height: 0 }))))
    }
  }
  for (const match of svg.matchAll(/<rect class="edge-label-halo" x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/g)) {
    rects.push({ x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]) })
  }
  return expand(union(rects), 46)
}

function cropFor(svg: string, panelWidth: number, panelHeight: number): Rect {
  const size = svgSize(svg)
  const focus = focusBox(svg)
  const aspect = panelWidth / panelHeight
  let width = Math.max(focus.width, 220)
  let height = Math.max(focus.height + 64, 300)
  if (width / height > aspect) height = width / aspect
  else width = height * aspect
  const cx = focus.x + focus.width / 2
  const cy = focus.y + focus.height / 2 + 16
  const x = Math.max(0, Math.min(size.width - width, cx - width / 2))
  const y = Math.max(0, Math.min(size.height - height, cy - height / 2))
  return { x, y, width, height }
}

function rasterizeAtScale(svg: string, scale: number): Raster {
  const size = svgSize(svg)
  const rendered = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.round(size.width * scale) },
    background: COLORS.bg,
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'DejaVu Sans' },
  }).render()
  return { b64: Buffer.from(rendered.asPng()).toString('base64'), width: rendered.width, height: rendered.height }
}

const panels = STYLES.flatMap(yesStyle => STYLES.map(needsWorkStyle => {
  const svg = renderSvg(yesStyle.op, needsWorkStyle.op)
  return {
    yesStyle,
    needsWorkStyle,
    svg,
    signature: geometrySignature(layout(yesStyle.op, needsWorkStyle.op)),
  }
}))

const baseline = panels[0]!.signature
for (const panel of panels) {
  if (panel.signature !== baseline) {
    throw new Error(`Geometry drift for yes=${panel.yesStyle.key}, needs=${panel.needsWorkStyle.key}`)
  }
}

const panelWidth = 700
const panelHeight = 760
const gutter = 44
const left = 210
const top = 250
const rowHeaderWidth = 150
const colHeaderHeight = 60
const width = left + rowHeaderWidth + STYLES.length * panelWidth + (STYLES.length - 1) * gutter + 64
const height = top + colHeaderHeight + STYLES.length * panelHeight + (STYLES.length - 1) * gutter + 80
const crop = cropFor(panels[0]!.svg, panelWidth, panelHeight)
const scale = panelWidth / crop.width

function imagePanel(panel: (typeof panels)[number], row: number, col: number): string {
  const x = left + rowHeaderWidth + col * (panelWidth + gutter)
  const y = top + colHeaderHeight + row * (panelHeight + gutter)
  const id = `clip-${row}-${col}`
  const raster = rasterizeAtScale(panel.svg, scale)
  return `
    <clipPath id="${id}"><rect x="${x}" y="${y}" width="${panelWidth}" height="${panelHeight}" rx="12"/></clipPath>
    <rect x="${x - 12}" y="${y - 12}" width="${panelWidth + 24}" height="${panelHeight + 24}" rx="16" fill="${COLORS.surface}" stroke="${COLORS.border}" stroke-width="2"/>
    <g clip-path="url(#${id})">
      <rect x="${x}" y="${y}" width="${panelWidth}" height="${panelHeight}" fill="${COLORS.bg}"/>
      <image x="${x - crop.x * scale}" y="${y - crop.y * scale}" width="${raster.width}" height="${raster.height}" href="data:image/png;base64,${raster.b64}"/>
    </g>`
}

const colHeaders = STYLES.map((style, col) => {
  const x = left + rowHeaderWidth + col * (panelWidth + gutter) + panelWidth / 2
  return `<text x="${x}" y="${top + 36}" text-anchor="middle" font-family="DejaVu Sans" font-size="26" font-weight="700" fill="${COLORS.fg}">needs work ${esc(style.label)}</text>`
}).join('\n')

const rowHeaders = STYLES.map((style, row) => {
  const y = top + colHeaderHeight + row * (panelHeight + gutter) + panelHeight / 2
  return `<text x="${left + rowHeaderWidth - 24}" y="${y}" text-anchor="end" dominant-baseline="middle" font-family="DejaVu Sans" font-size="26" font-weight="700" fill="${COLORS.fg}">yes ${esc(style.label)}</text>`
}).join('\n')

const grid = panels.map((panel, index) => imagePanel(panel, Math.floor(index / STYLES.length), index % STYLES.length)).join('\n')

const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${COLORS.bg}"/>
  <text x="64" y="78" font-family="DejaVu Sans" font-size="44" font-weight="700" fill="${COLORS.fg}">Issue #38 style permutation contact sheet</text>
  <text x="64" y="124" font-family="DejaVu Sans" font-size="24" fill="${COLORS.muted}">Rows vary the yes branch; columns vary the needs work branch. Geometry signature is identical in all 9 panels.</text>
  <text x="64" y="160" font-family="DejaVu Sans" font-size="20" fill="${COLORS.muted}">Only the rendered line style changes: solid, dotted, or thick. Labels, bends, target row, group bounds, and route points remain fixed.</text>
  ${colHeaders}
  ${rowHeaders}
  ${grid}
</svg>`

const png = new Resvg(sheet, {
  fitTo: { mode: 'width', value: width },
  background: COLORS.bg,
  font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'DejaVu Sans' },
}).render().asPng()

export function buildPng(): Uint8Array {
  return png
}

if (import.meta.main) {
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUTPUT_PATH, png)
  console.log(`wrote docs/pr-assets/${OUT_FILE} (${Math.round(png.byteLength / 1024)} KB)`)
}
