// Before/after evidence for the alignLabeledSourcePort fix.
//
// BEFORE is the real output with the pass disabled (APL_NO_LABELED_SOURCE_PORT),
// AFTER is the current tree — so the ONLY variable is the pass. Composes a
// labelled side-by-side PNG. Also renders the still-unhandled multi-edge case
// (a labelled source that also carries another edge), which the conservative
// degree-1 guard skips, as a separate image for the broaden-or-not decision.
// Reproducible from source, not hand-captured:
//
//   bun run scripts/pr-assets/labeled-source-port-evidence.ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'
import { parseMermaid } from '../../src/parser.ts'
import { layoutGraphSync } from '../../src/layout-engine.ts'
import { THEMES } from '../../src/theme.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'pr-assets')
const THEME = THEMES['github-light']!
const FONT_FILES = [
  join(ROOT, 'assets', 'fonts', 'DejaVuSans.ttf'),
  join(ROOT, 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
].filter(existsSync)

// The minimal case the fix handles: A's only edge is the labelled A->B and B's
// slot for it coincides with B's mid-port, so sliding A makes it straight + exact.
const SINGLE = [
  'flowchart LR',
  '  A -->|x| B',
  '  B2 --> B',
  '  B --> C',
].join('\n')

// A degree-1 source but with a WIDER label, which shifts B's input slot off B's
// mid-port — the fix slides A to B's mid, not the slot, so it only half-helps.
const WIDE = [
  'flowchart LR',
  '  A["warnings"] -->|warning| B["ok"]',
  '  B2["other"] --> B',
  '  B --> C["done"]',
].join('\n')

// A labelled source that ALSO carries another edge (incoming Z->A): A is now
// degree-2, so the conservative pass skips it and A->B stays off its mid-port.
const MULTI = [
  'flowchart LR',
  '  Z["start"] --> A["warnings"]',
  '  A -->|warning| B["ok"]',
  '  B2["other"] --> B',
  '  B --> C["done"]',
].join('\n')

function portGap(src: string): number {
  const p = layoutGraphSync(parseMermaid(src))
  const A = p.nodes.find(n => n.id === 'A')!
  const ab = p.edges.find(e => e.source === 'A' && e.target === 'B')!
  return Math.abs(ab.points[0]!.y - (A.y + A.height / 2))
}

function withFlag<T>(on: boolean, fn: () => T): T {
  if (on) process.env.APL_NO_LABELED_SOURCE_PORT = '1'
  else delete process.env.APL_NO_LABELED_SOURCE_PORT
  try { return fn() } finally { delete process.env.APL_NO_LABELED_SOURCE_PORT }
}

function rasterize(svg: string): { b64: string; w: number; h: number } {
  const r = new Resvg(svg, { font: { fontFiles: FONT_FILES, loadSystemFonts: false }, background: THEME.bg })
  const png = r.render().asPng()
  const { width, height } = r
  return { b64: Buffer.from(png).toString('base64'), w: width, h: height }
}

function panel(caption: string, raster: { b64: string; w: number; h: number }, x: number, w: number): string {
  const imgY = 30
  const imgX = x + (w - raster.w) / 2
  return `
    <text x="${x + w / 2}" y="20" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="600" fill="${THEME.fg}">${caption}</text>
    <image x="${imgX}" y="${imgY}" width="${raster.w}" height="${raster.h}" href="data:image/png;base64,${raster.b64}" />`
}

function sideBySide(file: string, title: string, before: ReturnType<typeof rasterize>, after: ReturnType<typeof rasterize>) {
  const colW = Math.max(before.w, after.w) + 60
  const h = Math.max(before.h, after.h) + 70
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${colW * 2}" height="${h}" viewBox="0 0 ${colW * 2} ${h}">
    <rect width="100%" height="100%" fill="${THEME.bg}"/>
    <line x1="${colW}" y1="10" x2="${colW}" y2="${h - 10}" stroke="${THEME.line}" stroke-dasharray="4 4"/>
    ${panel('BEFORE — ' + title.split('|')[0], before, 0, colW)}
    ${panel('AFTER — ' + title.split('|')[1], after, colW, colW)}
  </svg>`
  const png = new Resvg(svg, { font: { fontFiles: FONT_FILES, loadSystemFonts: false } }).render().asPng()
  Bun.write(join(OUT_DIR, file), png)
  console.log('wrote', file)
}

function single(file: string, caption: string, raster: ReturnType<typeof rasterize>) {
  const w = Math.max(raster.w + 60, 620), h = raster.h + 50
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="100%" height="100%" fill="${THEME.bg}"/>
    ${panel(caption, raster, 0, w)}
  </svg>`
  const png = new Resvg(svg, { font: { fontFiles: FONT_FILES, loadSystemFonts: false } }).render().asPng()
  Bun.write(join(OUT_DIR, file), png)
  console.log('wrote', file)
}

const g = (on: boolean, s: string) => withFlag(on, () => portGap(s)).toFixed(2)
console.log('MINIMAL  before gap=%s  after gap=%s  (FIXED)', g(true, SINGLE), g(false, SINGLE))
console.log('WIDE     before gap=%s  after gap=%s  (degree-1, wide label: slot off mid → only half-helps)', g(true, WIDE), g(false, WIDE))
console.log('MULTI    before gap=%s  after gap=%s  (degree-2 source: pass skips it entirely)', g(true, MULTI), g(false, MULTI))

const beforeSvg = withFlag(true, () => renderMermaidSVG(SINGLE, { ...THEME, embedFontImport: false }))
const afterSvg = withFlag(false, () => renderMermaidSVG(SINGLE, { ...THEME, embedFontImport: false }))
sideBySide('labeled-source-port-before-after.png', 'A→B exits A 14px below centre|A→B exits A at its mid-port, still straight', rasterize(beforeSvg), rasterize(afterSvg))

const multiSvg = withFlag(false, () => renderMermaidSVG(MULTI, { ...THEME, embedFontImport: false }))
single('labeled-source-port-multiedge.png', 'Unhandled: degree-2 source (warnings->ok exits off-centre)', rasterize(multiSvg))
