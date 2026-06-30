// Before/after evidence for the symmetric fan-in (co-rank mixed-label fan-in).
//
// BEFORE renders with co-rank disabled (APL_NO_CORANK_FANIN); AFTER is the
// current default — so the ONLY variable is the co-rank behaviour. A mixed-label
// fan-in (one incoming edge labelled, one not) is desynced by ELK's label-dummy
// rank; co-rank gives the unlabelled sibling a matching balancing rank so the
// sources co-rank, the hub centres on them, and the spokes converge as a
// symmetric dogleg. Reproducible, not hand-captured:
//
//   bun run scripts/pr-assets/symmetric-fanin-evidence.ts
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

// Fan-in hub B("ok") fed by a LABELLED edge (A) and an UNLABELLED one (B2);
// a symmetric fan-out hub C("rendered") for contrast (already symmetric).
const SRC = [
  'flowchart LR',
  '  A["warnings"] -->|warnings| B["ok"]',
  '  B -->|ok| C["rendered"]',
  '  A2["same word: warnings"] --> A',
  '  B2["same word: ok"] --> B',
  '  C -->|warnings| D["warnings"]',
  '  C -->|ok| E["ok"]',
].join('\n')

function withDisabled<T>(off: boolean, fn: () => T): T {
  if (off) process.env.APL_NO_CORANK_FANIN = '1'
  else delete process.env.APL_NO_CORANK_FANIN
  try { return fn() } finally { delete process.env.APL_NO_CORANK_FANIN }
}

const cy = (p: ReturnType<typeof layoutGraphSync>, id: string) => {
  const n = p.nodes.find(x => x.id === id)!
  return n.y + n.height / 2
}
const nx = (p: ReturnType<typeof layoutGraphSync>, id: string) => p.nodes.find(x => x.id === id)!.x

function stat(off: boolean): string {
  const p = withDisabled(off, () => layoutGraphSync(parseMermaid(SRC)))
  const bary = (cy(p, 'A') + cy(p, 'B2')) / 2
  return `ok off-barycentre ${(cy(p, 'B') - bary).toFixed(1)}px · inputs rankΔ ${Math.abs(nx(p, 'A') - nx(p, 'B2')).toFixed(0)}px`
}

function rasterize(svg: string) {
  const r = new Resvg(svg, { font: { fontFiles: FONT_FILES, loadSystemFonts: false }, background: THEME.bg })
  const png = r.render().asPng()
  return { b64: Buffer.from(png).toString('base64'), w: r.width, h: r.height }
}

const before = rasterize(withDisabled(true, () => renderMermaidSVG(SRC, { ...THEME, embedFontImport: false })))
const after = rasterize(withDisabled(false, () => renderMermaidSVG(SRC, { ...THEME, embedFontImport: false })))
const beforeAnn = stat(true), afterAnn = stat(false)
console.log('BEFORE (co-rank off):', beforeAnn)
console.log('AFTER  (default):    ', afterAnn)

const colW = Math.max(before.w, after.w) + 60
const H = Math.max(before.h, after.h) + 84
const panel = (img: typeof before, head: string, ann: string, x: number, ok: boolean) => `
  <text x="${x + colW / 2}" y="22" text-anchor="middle" font-family="sans-serif" font-size="15" font-weight="700" fill="${THEME.fg}">${head}</text>
  <text x="${x + colW / 2}" y="42" text-anchor="middle" font-family="sans-serif" font-size="12" fill="${ok ? '#1a7f37' : '#cf222e'}">${ann}</text>
  <image x="${x + (colW - img.w) / 2}" y="54" width="${img.w}" height="${img.h}" href="data:image/png;base64,${img.b64}"/>`
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${colW * 2}" height="${H}" viewBox="0 0 ${colW * 2} ${H}">
  <rect width="100%" height="100%" fill="${THEME.bg}"/>
  <line x1="${colW}" y1="10" x2="${colW}" y2="${H - 10}" stroke="${THEME.line}" stroke-dasharray="5 5"/>
  ${panel(before, 'BEFORE — co-rank off', beforeAnn, 0, false)}
  ${panel(after, 'AFTER — default (symmetric fan-in)', afterAnn, colW, true)}
</svg>`
const png = new Resvg(svg, { font: { fontFiles: FONT_FILES, loadSystemFonts: false }, background: THEME.bg }).render().asPng()
Bun.write(join(OUT_DIR, 'symmetric-fanin-before-after.png'), png)
console.log('wrote symmetric-fanin-before-after.png')
