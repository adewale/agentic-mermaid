// ============================================================================
// Poster: every supported diagram type (columns) x every style (rows),
// rendered at high resolution. Output: poster.png
//
//   bun run scripts/sketch-prototype/poster.ts
// ============================================================================

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'
import { STYLES, type Style } from './styles.ts'
import { restyle } from './restyle.ts'
import { DIAGRAMS } from './diagrams.ts'

const DIR = import.meta.dir
const FONT_FILES = ['Caveat.ttf', 'EBGaramond.ttf', '../../assets/fonts/DejaVuSans.ttf', '../../assets/fonts/DejaVuSans-Bold.ttf'].map(f => join(DIR, f))

function raster(svg: string, width: number, bg?: string) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: bg, font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'Caveat' } }).render()
  return { png: Buffer.from(r.asPng()), w: r.width, h: r.height }
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// layout (logical px; whole poster is scaled up at raster time)
const HEAD_COL = 240, HEAD_ROW = 92, CELL_W = 340, CELL_H = 252, PAD = 36, GAP = 6
const COLS = DIAGRAMS.length, ROWS = STYLES.length
const POSTER_W = HEAD_COL + COLS * CELL_W + PAD * 2
const POSTER_H = HEAD_ROW + ROWS * CELL_H + PAD * 2 + 70

function cellBg(st: Style, x: number, y: number, w: number, h: number): string {
  const p = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${st.colors.bg}"/>`]
  if (st.backdrop === 'grid') for (let gx = x; gx < x + w; gx += 22) p.push(`<line x1="${gx}" y1="${y}" x2="${gx}" y2="${y + h}" stroke="#bcd6f0" stroke-width="0.5" opacity="0.25"/>`)
  if (st.backdrop === 'paper-ruled') for (let gy = y + 20; gy < y + h; gy += 22) p.push(`<line x1="${x}" y1="${gy}" x2="${x + w}" y2="${gy}" stroke="#9fc0d8" stroke-width="0.6" opacity="0.4"/>`)
  return p.join('')
}

function build(): string {
  const P: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${POSTER_W} ${POSTER_H}" width="${POSTER_W}" height="${POSTER_H}">`]
  P.push(`<rect width="${POSTER_W}" height="${POSTER_H}" fill="#1b1b1f"/>`)
  P.push(`<text x="${PAD}" y="48" font-family="EB Garamond,serif" font-size="44" fill="#f5f5f0">Hand-rendered Mermaid — ${ROWS} styles × ${COLS} diagram types</text>`)

  const ox = PAD, oy = PAD + 58
  // column headers
  DIAGRAMS.forEach((d, c) => {
    const x = ox + HEAD_COL + c * CELL_W
    P.push(`<text x="${x + CELL_W / 2}" y="${oy + HEAD_ROW - 28}" text-anchor="middle" font-family="EB Garamond,serif" font-size="22" fill="#e8e8e2">${esc(d.type)}</text>`)
  })

  STYLES.forEach((st, r) => {
    const y = oy + HEAD_ROW + r * CELL_H
    // row header
    P.push(`<text x="${ox + 14}" y="${y + CELL_H / 2 - 8}" font-family="EB Garamond,serif" font-size="24" fill="#f5f5f0">${esc(st.label)}</text>`)
    P.push(`<text x="${ox + 14}" y="${y + CELL_H / 2 + 16}" font-family="EB Garamond,serif" font-size="13" fill="#a8a8a2"><tspan>${esc(st.name)}</tspan></text>`)
    DIAGRAMS.forEach((d, c) => {
      const x = ox + HEAD_COL + c * CELL_W
      P.push(cellBg(st, x + GAP, y + GAP, CELL_W - GAP * 2, CELL_H - GAP * 2))
      try {
        const raw = renderMermaidSVG(d.src, { bg: st.colors.bg, fg: st.colors.fg, line: st.colors.line, accent: st.colors.accent, muted: st.colors.muted, surface: st.colors.surface, border: st.colors.border, font: st.font, embedFontImport: false, transparent: true })
        const styled = restyle(raw, st, { backdrop: false })
        const img = raster(styled, 620)
        const availW = CELL_W - GAP * 2 - 16, availH = CELL_H - GAP * 2 - 16
        const sc = Math.min(availW / img.w, availH / img.h)
        const dw = img.w * sc, dh = img.h * sc
        P.push(`<image x="${x + (CELL_W - dw) / 2}" y="${y + (CELL_H - dh) / 2}" width="${dw}" height="${dh}" href="data:image/png;base64,${img.png.toString('base64')}"/>`)
      } catch (e) {
        P.push(`<text x="${x + CELL_W / 2}" y="${y + CELL_H / 2}" text-anchor="middle" font-family="EB Garamond" font-size="12" fill="#c33">${esc((e as Error).message).slice(0, 36)}</text>`)
      }
    })
  })
  P.push('</svg>')
  return P.join('\n')
}

console.log(`building poster ${ROWS}x${COLS} (${POSTER_W}x${POSTER_H} logical)...`)
const { png } = raster(build(), POSTER_W * 2, '#1b1b1f') // 2x supersample for detail
writeFileSync(join(DIR, 'poster.png'), png)
console.log('wrote poster.png at', POSTER_W * 2, 'px wide')
