// ============================================================================
// Contact sheets: every supported diagram type, rendered in each of the five
// aesthetic styles. Produces sheet-<style>.png (one per style).
//
//   bun run scripts/sketch-prototype/contact-sheet.ts
// ============================================================================

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'
import { STYLES, type Style } from './styles.ts'
import { restyle, backdrop, seal } from './restyle.ts'
import { DIAGRAMS } from './diagrams.ts'

const DIR = import.meta.dir
const FONT_FILES = ['Caveat.ttf', 'EBGaramond.ttf', 'ShareTechMono.ttf', 'Fraunces.ttf', 'ArchitectsDaughter.ttf'].map(f => join(DIR, f))
  .concat(['../../assets/fonts/DejaVuSans.ttf', '../../assets/fonts/DejaVuSans-Bold.ttf'].map(f => join(DIR, f)))

function raster(svg: string, width: number, bg?: string) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: bg,
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'Caveat' },
  }).render()
  return { png: Buffer.from(r.asPng()), w: r.width, h: r.height }
}

const COLS = 3, CELL_W = 460, IMG_H = 320, LABEL_H = 44, PAD = 28, TITLE_H = 110
const ROWS = Math.ceil(DIAGRAMS.length / COLS)
const SHEET_W = COLS * CELL_W + PAD * 2
const SHEET_H = TITLE_H + ROWS * (IMG_H + LABEL_H) + PAD

function buildSheet(st: Style): string {
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET_W} ${SHEET_H}" width="${SHEET_W}" height="${SHEET_H}">`]
  parts.push(backdrop(st, SHEET_W, SHEET_H))
  parts.push(`<text x="${PAD}" y="58" font-family="${st.font},serif" font-size="42" fill="${st.colors.fg}">${esc(st.label)}</text>`)
  parts.push(`<text x="${PAD}" y="88" font-family="${st.font},serif" font-size="20" fill="${st.colors.muted}">${esc(st.blurb)}</text>`)

  DIAGRAMS.forEach((d, i) => {
    const col = i % COLS, row = Math.floor(i / COLS)
    const cellX = PAD + col * CELL_W
    const cellY = TITLE_H + row * (IMG_H + LABEL_H)
    let img: { png: Buffer; w: number; h: number } | null = null
    try {
      const raw = renderMermaidSVG(d.src, {
        bg: st.colors.bg, fg: st.colors.fg, line: st.colors.line, accent: st.colors.accent,
        muted: st.colors.muted, surface: st.colors.surface, border: st.colors.border,
        font: st.font, embedFontImport: false, transparent: true,
      })
      const styled = restyle(raw, st, { backdrop: false })
      img = raster(styled, 760) // transparent background
    } catch (e) {
      parts.push(`<text x="${cellX + CELL_W / 2}" y="${cellY + IMG_H / 2}" text-anchor="middle" font-family="${st.font}" font-size="18" fill="#b22222">${d.type}: ${esc(String((e as Error).message).slice(0, 40))}</text>`)
    }
    if (img) {
      // Fit preserving aspect inside the cell image area.
      const availW = CELL_W - PAD, availH = IMG_H - 10
      const scale = Math.min(availW / img.w, availH / img.h)
      const dw = img.w * scale, dh = img.h * scale
      const ix = cellX + (CELL_W - dw) / 2, iy = cellY + (IMG_H - dh) / 2
      parts.push(`<image x="${ix}" y="${iy}" width="${dw}" height="${dh}" href="data:image/png;base64,${img.png.toString('base64')}"/>`)
    }
    parts.push(`<text x="${cellX + CELL_W / 2}" y="${cellY + IMG_H + 28}" text-anchor="middle" font-family="${st.font},serif" font-size="24" fill="${st.colors.fg}">${d.type}</text>`)
  })

  if (st.seal) parts.push(seal(SHEET_W, SHEET_H))
  parts.push('</svg>')
  return parts.join('\n')
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

for (const st of STYLES) {
  const sheet = buildSheet(st)
  const { png } = raster(sheet, SHEET_W, st.colors.bg)
  const out = join(DIR, `sheet-${st.name}.png`)
  writeFileSync(out, png)
  console.log('wrote', out)
}
