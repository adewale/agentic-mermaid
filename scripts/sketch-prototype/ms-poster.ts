// ============================================================================
// Single-style poster: every supported diagram type in the "Making Software"
// style (ref: makingsoftware.com). Output: poster-making-software.png
//
//   bun run scripts/sketch-prototype/ms-poster.ts
//
// Demonstrates that a poster for ANY one style is just: pick the style record,
// render the 12 diagrams through restyle(), lay them out. The only style-
// specific flourish here is the signature squiggly-blue underline motif.
// ============================================================================

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
// @ts-expect-error - upng-js ships no types
import UPNG from 'upng-js'
import { renderMermaidSVG } from '../../src/index.ts'
import { STYLES } from './styles.ts'
import { restyle } from './restyle.ts'
import { DIAGRAMS } from './diagrams.ts'

const DIR = import.meta.dir
const FONT_FILES = ['Caveat.ttf', 'EBGaramond.ttf', 'ShareTechMono.ttf', 'Fraunces.ttf', 'ArchitectsDaughter.ttf', 'Cinzel.ttf', 'Fredoka.ttf', '../../assets/fonts/DejaVuSans.ttf', '../../assets/fonts/DejaVuSans-Bold.ttf'].map(f => join(DIR, f))
const st = STYLES.find(s => s.name === 'making-software')!
const SCALE = Number(process.env.SCALE ?? 1.6)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// The signature: a hand-wavy blue underline (Making Software highlights links
// with a squiggly blue line). Pure SVG path, alternating quadratic arcs.
function squiggle(x1: number, x2: number, y: number, amp = 3, wl = 11, color = st.colors.accent, sw = 2.4): string {
  let d = `M${x1},${y}`, x = x1, up = true
  while (x < x2) { const nx = Math.min(x + wl, x2), cx = (x + nx) / 2; d += ` Q${cx.toFixed(1)},${(y + (up ? -amp : amp)).toFixed(1)} ${nx.toFixed(1)},${y}`; x = nx; up = !up }
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`
}

function raster(svg: string, width: number, bg?: string) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: Math.round(width) }, background: bg, font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'EB Garamond' } }).render()
  return { png: Buffer.from(r.asPng()), w: r.width, h: r.height, raw: r }
}

const COLS = 4, CELL_W = 540, CELL_H = 440, PAD = 56, TITLE_H = 150, CAP_H = 56
const ROWS = Math.ceil(DIAGRAMS.length / COLS)
const W = PAD * 2 + COLS * CELL_W, H = PAD * 2 + TITLE_H + ROWS * (CELL_H + CAP_H)

const P: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`]
P.push(`<rect width="${W}" height="${H}" fill="${st.colors.bg}"/>`)
// Title + signature squiggle underline.
P.push(`<text x="${PAD}" y="${PAD + 56}" font-family="Fraunces,serif" font-size="64" fill="${st.colors.fg}">Making Software — every diagram type</text>`)
P.push(squiggle(PAD, PAD + 760, PAD + 78, 4, 13, st.colors.accent, 3.2))
P.push(`<text x="${PAD}" y="${PAD + 118}" font-family="Fraunces,serif" font-size="24" fill="${st.colors.muted}">${esc(st.blurb)}  ·  Arizona→Fraunces; Departure Mono pending</text>`)

DIAGRAMS.forEach((d, i) => {
  const col = i % COLS, row = Math.floor(i / COLS)
  const x = PAD + col * CELL_W
  const y = PAD + TITLE_H + row * (CELL_H + CAP_H)
  const availW = CELL_W - 36, availH = CELL_H - 24
  try {
    const raw = renderMermaidSVG(d.src, { bg: st.colors.bg, fg: st.colors.fg, line: st.colors.line, accent: st.colors.accent, muted: st.colors.muted, surface: st.colors.surface, border: st.colors.border, font: st.font, embedFontImport: false, transparent: true, style: { text: { fontSize: 22 }, node: { fontSize: 26, fontWeight: 600, paddingX: 22, paddingY: 14, cornerRadius: st.nodeCornerRadius }, edge: { fontSize: 22, fontWeight: 600 }, group: { fontSize: 22, fontWeight: 700 } } })
    const img = raster(restyle(raw, st, { backdrop: false }), availW * SCALE)
    const sc = Math.min(availW / (img.w / SCALE), availH / (img.h / SCALE))
    const dw = (img.w / SCALE) * sc, dh = (img.h / SCALE) * sc
    P.push(`<image x="${x + (CELL_W - dw) / 2}" y="${y + (availH - dh) / 2}" width="${dw}" height="${dh}" href="data:image/png;base64,${img.png.toString('base64')}"/>`)
  } catch (e) {
    P.push(`<text x="${x + CELL_W / 2}" y="${y + availH / 2}" text-anchor="middle" font-size="18" fill="#c33">${esc((e as Error).message).slice(0, 40)}</text>`)
  }
  // caption with a small squiggle underline
  const cx = x + CELL_W / 2, cy = y + CELL_H + 24
  P.push(`<text x="${cx}" y="${cy}" text-anchor="middle" font-family="Fraunces,serif" font-size="30" fill="${st.colors.fg}">${esc(d.type)}</text>`)
  P.push(squiggle(cx - d.type.length * 8, cx + d.type.length * 8, cy + 12, 2.4, 10))
})
P.push('</svg>')

const r = raster(P.join('\n'), W * SCALE, st.colors.bg).raw
const px = r.pixels
const ab = px.buffer.slice(px.byteOffset, px.byteOffset + px.byteLength)
const out = Buffer.from(UPNG.encode([ab], r.width, r.height, 256))
writeFileSync(join(DIR, 'poster-making-software.png'), out)
console.log(`wrote poster-making-software.png  ${r.width}x${r.height}px  ${(out.length / 1e6).toFixed(2)} MB`)
