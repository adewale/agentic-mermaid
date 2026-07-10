// ============================================================================
// Poster: every supported diagram type (columns) x every style (rows),
// rendered at high resolution. Output: poster.png
//
//   bun run scripts/sketch-prototype/poster.ts
// ============================================================================

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
// @ts-expect-error - upng-js ships no types
import UPNG from 'upng-js'
import { renderMermaidSVG } from '../../src/index.ts'
import { STYLES, type Style } from './styles.ts'
import { restyle } from './restyle.ts'
import { DIAGRAMS } from './diagrams.ts'

const DIR = import.meta.dir
const FONT_FILES = ['../../assets/fonts/Caveat.ttf', '../../assets/fonts/EBGaramond.ttf', '../../assets/fonts/ShareTechMono.ttf', '../../assets/fonts/ArchitectsDaughter.ttf', 'Fraunces.ttf', 'Cinzel.ttf', 'Fredoka.ttf', 'BalsamiqSans.ttf', '../../assets/fonts/DejaVuSans.ttf', '../../assets/fonts/DejaVuSans-Bold.ttf'].map(f => join(DIR, f))

function raster(svg: string, width: number, bg?: string) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: bg, font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'Caveat' } }).render()
  return { png: Buffer.from(r.asPng()), w: r.width, h: r.height }
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// layout (logical px; whole poster is scaled up at raster time). Big cells +
// big type = readable. Each diagram is rendered at ~cell pixel size (no
// down-rezzing), so text stays crisp.
const HEAD_COL = 400, HEAD_ROW = 110, CELL_W = 520, CELL_H = 400, PAD = 44, GAP = 8
const POSTER_STYLES = STYLES // all styles incl. Making Software (the premium exemplar)
const COLS = DIAGRAMS.length, ROWS = POSTER_STYLES.length
const POSTER_W = HEAD_COL + COLS * CELL_W + PAD * 2
const POSTER_H = HEAD_ROW + ROWS * CELL_H + PAD * 2 + 90

function cellBg(st: Style, x: number, y: number, w: number, h: number): string {
  const p = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${st.colors.bg}"/>`]
  if (st.backdrop === 'grid') for (let gx = x; gx < x + w; gx += 22) p.push(`<line x1="${gx}" y1="${y}" x2="${gx}" y2="${y + h}" stroke="#bcd6f0" stroke-width="0.5" opacity="0.25"/>`)
  if (st.backdrop === 'paper-ruled') for (let gy = y + 20; gy < y + h; gy += 22) p.push(`<line x1="${x}" y1="${gy}" x2="${x + w}" y2="${gy}" stroke="#9fc0d8" stroke-width="0.6" opacity="0.4"/>`)
  if (st.backdrop === 'aurora') {
    // glassmorphism cells keep their aurora ground so the translucent panels
    // actually composite over colour (that's the adversarial point)
    const rr = Math.min(w, h)
    p.push(`<circle cx="${x + w * 0.25}" cy="${y + h * 0.3}" r="${rr * 0.32}" fill="#3b2f6b" filter="url(#cellaur)"/>`)
    p.push(`<circle cx="${x + w * 0.78}" cy="${y + h * 0.35}" r="${rr * 0.26}" fill="#155e63" filter="url(#cellaur)"/>`)
    p.push(`<circle cx="${x + w * 0.55}" cy="${y + h * 0.82}" r="${rr * 0.3}" fill="#5b2a4e" filter="url(#cellaur)"/>`)
  }
  return p.join('')
}

// Split a style label into <=2 lines so it stays large and readable in the
// header column. Breaks at the space nearest the middle.
function wrapLabel(label: string): string[] {
  if (label.length <= 11 || !label.includes(' ')) return [label]
  const sp = label.split(' ')
  let best = 1, diff = Infinity
  for (let i = 1; i < sp.length; i++) {
    const a = sp.slice(0, i).join(' ').length, b = sp.slice(i).join(' ').length
    if (Math.abs(a - b) < diff) { diff = Math.abs(a - b); best = i }
  }
  return [sp.slice(0, best).join(' '), sp.slice(best).join(' ')]
}

function build(): string {
  const P: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${POSTER_W} ${POSTER_H}" width="${POSTER_W}" height="${POSTER_H}">`]
  P.push(`<defs><filter id="cellaur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="26"/></filter></defs>`)
  P.push(`<rect width="${POSTER_W}" height="${POSTER_H}" fill="#1b1b1f"/>`)
  P.push(`<text x="${PAD}" y="66" font-family="EB Garamond,serif" font-size="60" fill="#f5f5f0">Hand-rendered Mermaid — ${ROWS} styles × ${COLS} diagram types</text>`)

  const ox = PAD, oy = PAD + 80
  // column headers
  DIAGRAMS.forEach((d, c) => {
    const x = ox + HEAD_COL + c * CELL_W
    P.push(`<text x="${x + CELL_W / 2}" y="${oy + HEAD_ROW - 36}" text-anchor="middle" font-family="EB Garamond,serif" font-size="40" fill="#e8e8e2">${esc(d.type)}</text>`)
  })

  POSTER_STYLES.forEach((st, r) => {
    const y = oy + HEAD_ROW + r * CELL_H
    // row header — large, high-contrast, wrapped AND auto-fit to the header
    // column so even long single-word labels never spill into the first cell.
    const lines = wrapLabel(st.label)
    const maxLen = Math.max(...lines.map(l => l.length))
    const fs = Math.max(26, Math.min(50, Math.floor((HEAD_COL - 34) / (maxLen * 0.62))))
    const lh = Math.round(fs * 1.12)
    const top = y + CELL_H / 2 - ((lines.length - 1) * lh) / 2 - 6
    lines.forEach((ln, i) => P.push(`<text x="${ox + 18}" y="${top + i * lh}" font-family="DejaVu Sans" font-weight="bold" font-size="${fs}" fill="#ffffff">${esc(ln)}</text>`))
    DIAGRAMS.forEach((d, c) => {
      const x = ox + HEAD_COL + c * CELL_W
      P.push(cellBg(st, x + GAP, y + GAP, CELL_W - GAP * 2, CELL_H - GAP * 2))
      const availW = CELL_W - GAP * 2 - 24, availH = CELL_H - GAP * 2 - 24
      try {
        const raw = renderMermaidSVG(d.src, { bg: st.colors.bg, fg: st.colors.fg, line: st.colors.line, accent: st.colors.accent, muted: st.colors.muted, surface: st.colors.surface, border: st.colors.border, font: st.font, embedFontImport: false, transparent: true, style: 'publication-figure' })
        const styled = restyle(raw, st, { backdrop: false })
        // render the diagram at ~final cell pixel size so its text is crisp (no down-rez)
        const img = raster(styled, Math.round(availW * SCALE))
        const sc = Math.min(availW / (img.w / SCALE), availH / (img.h / SCALE))
        const dw = (img.w / SCALE) * sc, dh = (img.h / SCALE) * sc
        P.push(`<image x="${x + (CELL_W - dw) / 2}" y="${y + (CELL_H - dh) / 2}" width="${dw}" height="${dh}" href="data:image/png;base64,${img.png.toString('base64')}"/>`)
      } catch (e) {
        P.push(`<text x="${x + CELL_W / 2}" y="${y + CELL_H / 2}" text-anchor="middle" font-family="EB Garamond" font-size="20" fill="#c33">${esc((e as Error).message).slice(0, 36)}</text>`)
      }
    })
  })
  P.push('</svg>')
  return P.join('\n')
}

// Output knobs (env-overridable):
//   SCALE  supersample factor          (default 1.5)
//   COLORS palette size; 0 = lossless  (default 256 — line art quantizes cleanly)
const SCALE = Number(process.env.SCALE ?? 1.5)
const COLORS = Number(process.env.COLORS ?? 256)

console.log(`building poster ${ROWS}x${COLS} (${POSTER_W}x${POSTER_H} logical) @ ${SCALE}x, ${COLORS || 'lossless'} colours...`)
const rendered = new Resvg(build(), {
  fitTo: { mode: 'width', value: Math.round(POSTER_W * SCALE) },
  background: '#1b1b1f',
  font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'Caveat' },
}).render()

// UPNG re-encodes (and optionally palette-quantizes) the raw RGBA far smaller
// than resvg's encoder. 256 colours is visually lossless for line/flat art.
const px = rendered.pixels
const ab = px.buffer.slice(px.byteOffset, px.byteOffset + px.byteLength)
const out = Buffer.from(UPNG.encode([ab], rendered.width, rendered.height, COLORS))
writeFileSync(join(DIR, 'poster.png'), out)
console.log(`wrote poster.png  ${rendered.width}x${rendered.height}px  ${(out.length / 1e6).toFixed(2)} MB`)
