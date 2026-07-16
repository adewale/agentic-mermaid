// Before/after evidence for the alignLabeledSourcePort fix (chain-translate).
//
// BEFORE renders with the pass disabled (APL_NO_LABELED_SOURCE_PORT); AFTER is
// the current tree — so the ONLY variable is the pass. Two rows: a degree-1
// labelled source (wide label) and a degree-2 source fed by an incoming edge.
// The fix slides the labelled source — and, for degree 2, its whole upstream
// chain — onto the lane the certifying straightener will use, so every single-
// out source in the neighbourhood exits at its mid-port as ONE straight line
// (no jog). Reproducible from source, not hand-captured:
//
//   bun run scripts/pr-assets/labeled-source-port-evidence.ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'
import { parseMermaid } from '../../src/parser.ts'
import { layoutGraphSync } from '../../src/layout-engine.ts'
import { BUILTIN_PALETTE_DEFINITIONS } from '../../src/palette-catalog.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'pr-assets')
const THEME = BUILTIN_PALETTE_DEFINITIONS.find(palette => palette.inputName === 'github-light')!.colors
const FONT_FILES = [
  join(ROOT, 'assets', 'fonts', 'DejaVuSans.ttf'),
  join(ROOT, 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
].filter(existsSync)

// A degree-1 labelled source with a WIDE label, which shifts the straightener's
// lane off the centre — the source slides onto that lane and exits straight.
const WIDE = [
  'flowchart LR',
  '  A["warnings"] -->|warning| B["ok"]',
  '  B2["other"] --> B',
  '  B --> C["done"]',
].join('\n')

// A degree-2 source: an incoming Z->A means sliding A must carry Z too, so Z
// keeps its own mid-port and the whole start->warnings->ok chain stays straight.
const MULTI = [
  'flowchart LR',
  '  Z["start"] --> A["warnings"]',
  '  A -->|warning| B["ok"]',
  '  B2["other"] --> B',
  '  B --> C["done"]',
].join('\n')

function withFlag<T>(on: boolean, fn: () => T): T {
  if (on) process.env.APL_NO_LABELED_SOURCE_PORT = '1'
  else delete process.env.APL_NO_LABELED_SOURCE_PORT
  try { return fn() } finally { delete process.env.APL_NO_LABELED_SOURCE_PORT }
}

const midCross = (n: { y: number; height: number }) => n.y + n.height / 2
/** Source-exit gap from mid-port and interior bend count for one edge's source. */
function stat(src: string, sourceId: string): { gap: number; bends: number } {
  const p = layoutGraphSync(parseMermaid(src))
  const S = p.nodes.find(n => n.id === sourceId)!
  const e = p.edges.find(x => x.source === sourceId)!
  return { gap: Math.abs(e.points[0]!.y - midCross(S)), bends: Math.max(0, e.points.length - 2) }
}

function rasterize(svg: string): { b64: string; w: number; h: number } {
  const r = new Resvg(svg, { font: { fontFiles: FONT_FILES, loadSystemFonts: false }, background: THEME.bg })
  const png = r.render().asPng()
  return { b64: Buffer.from(png).toString('base64'), w: r.width, h: r.height }
}

type Img = ReturnType<typeof rasterize>
type Row = { title: string; before: Img; after: Img; beforeAnn: string; afterAnn: string }

const COLS = { labelW: 210, headerH: 42 }

function rowSvg(row: Row, colW: number, rowH: number, y0: number): string {
  const panel = (img: Img, ann: string, x0: number, ok: boolean) => {
    const ix = x0 + (colW - img.w) / 2
    return `
      <text x="${x0 + colW / 2}" y="${y0 + 22}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="${ok ? '#1a7f37' : '#cf222e'}">${ann}</text>
      <image x="${ix}" y="${y0 + 32}" width="${img.w}" height="${img.h}" href="data:image/png;base64,${img.b64}"/>`
  }
  return `
    <text x="${COLS.labelW / 2}" y="${y0 + rowH / 2}" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="600" fill="${THEME.fg}" opacity="0.8">${row.title}</text>
    ${panel(row.before, row.beforeAnn, COLS.labelW, false)}
    ${panel(row.after, row.afterAnn, COLS.labelW + colW, true)}`
}

function beforeAfter(file: string, rows: Row[]) {
  const colW = Math.max(...rows.flatMap(r => [r.before.w, r.after.w])) + 80
  const rowH = Math.max(...rows.flatMap(r => [r.before.h, r.after.h])) + 80
  const W = COLS.labelW + colW * 2
  const H = COLS.headerH + rowH * rows.length
  const body = rows.map((r, i) => rowSvg(r, colW, rowH, COLS.headerH + i * rowH)).join('\n')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="100%" height="100%" fill="${THEME.bg}"/>
    <text x="${COLS.labelW + colW / 2}" y="26" text-anchor="middle" font-family="sans-serif" font-size="16" font-weight="700" fill="${THEME.fg}">BEFORE — fix off</text>
    <text x="${COLS.labelW + colW + colW / 2}" y="26" text-anchor="middle" font-family="sans-serif" font-size="16" font-weight="700" fill="${THEME.fg}">AFTER — fix on</text>
    <line x1="${COLS.labelW + colW}" y1="10" x2="${COLS.labelW + colW}" y2="${H - 10}" stroke="${THEME.line}" stroke-dasharray="5 5"/>
    ${body}
  </svg>`
  const png = new Resvg(svg, { font: { fontFiles: FONT_FILES, loadSystemFonts: false }, background: THEME.bg }).render().asPng()
  Bun.write(join(OUT_DIR, file), png)
  console.log('wrote', file)
}

const fmt = (s: { gap: number; bends: number }) => `${s.gap.toFixed(2)}px${s.bends ? `, ${s.bends} bends` : ', straight'}`

const wideBefore = withFlag(true, () => stat(WIDE, 'A'))
const wideAfter = withFlag(false, () => stat(WIDE, 'A'))
const multiBeforeZ = withFlag(true, () => stat(MULTI, 'Z'))
const multiBeforeA = withFlag(true, () => stat(MULTI, 'A'))
const multiAfterZ = withFlag(false, () => stat(MULTI, 'Z'))
const multiAfterA = withFlag(false, () => stat(MULTI, 'A'))

console.log('WIDE  A  before=%s  after=%s', fmt(wideBefore), fmt(wideAfter))
console.log('MULTI Z  before=%s  after=%s', fmt(multiBeforeZ), fmt(multiAfterZ))
console.log('MULTI A  before=%s  after=%s', fmt(multiBeforeA), fmt(multiAfterA))

beforeAfter('labeled-source-port-before-after.png', [
  {
    title: 'wide degree-1 source',
    before: rasterize(withFlag(true, () => renderMermaidSVG(WIDE, { ...THEME, embedFontImport: false }))),
    after: rasterize(withFlag(false, () => renderMermaidSVG(WIDE, { ...THEME, embedFontImport: false }))),
    beforeAnn: `warnings→ok: ${fmt(wideBefore)}`,
    afterAnn: `warnings→ok: ${fmt(wideAfter)}`,
  },
  {
    title: 'degree-2 source (start → warnings)',
    before: rasterize(withFlag(true, () => renderMermaidSVG(MULTI, { ...THEME, embedFontImport: false }))),
    after: rasterize(withFlag(false, () => renderMermaidSVG(MULTI, { ...THEME, embedFontImport: false }))),
    beforeAnn: `start→warnings: ${fmt(multiBeforeZ)} · warnings→ok: ${fmt(multiBeforeA)}`,
    afterAnn: `start→warnings: ${fmt(multiAfterZ)} · warnings→ok: ${fmt(multiAfterA)}`,
  },
])
