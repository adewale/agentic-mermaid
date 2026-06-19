// Review sheet: all styles rendered for ONE diagram type, with large labels.
//   bun run scripts/sketch-prototype/review.ts <diagramIndex>
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'
import { STYLES } from './styles.ts'
import { restyle } from './restyle.ts'
import { DIAGRAMS } from './diagrams.ts'

const DIR = import.meta.dir
const FONTS = ['Caveat.ttf', 'EBGaramond.ttf', 'ShareTechMono.ttf', 'Fraunces.ttf', 'ArchitectsDaughter.ttf', '../../assets/fonts/DejaVuSans.ttf', '../../assets/fonts/DejaVuSans-Bold.ttf'].map(f => join(DIR, f))
const di = Number(process.argv[2] ?? 0)
const d = DIAGRAMS[di]!
const TYPE_OPT = { style: { text: { fontSize: 22 }, node: { fontSize: 26, fontWeight: 600, paddingX: 22, paddingY: 14 }, edge: { fontSize: 22, fontWeight: 600 }, group: { fontSize: 22, fontWeight: 700 } } }
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function raster(svg: string, width: number, bg?: string) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: Math.round(width) }, background: bg, font: { loadSystemFonts: false, fontFiles: FONTS, defaultFontFamily: 'EB Garamond' } }).render()
  return { png: Buffer.from(r.asPng()), w: r.width, h: r.height }
}

const COLS = 5, LBL = 52, CW = 560, CH = 470, PAD = 16, SCALE = 1.2
const ROWS = Math.ceil(STYLES.length / COLS)
const W = PAD + COLS * (CW + PAD), H = 64 + ROWS * (CH + PAD) + PAD
const P: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`]
P.push(`<rect width="${W}" height="${H}" fill="#15151a"/>`)
P.push(`<text x="${PAD}" y="42" font-family="DejaVu Sans" font-size="30" fill="#fff">Review — ${esc(d.type)}</text>`)
STYLES.forEach((st, i) => {
  const x = PAD + (i % COLS) * (CW + PAD), y = 64 + Math.floor(i / COLS) * (CH + PAD)
  P.push(`<rect x="${x}" y="${y}" width="${CW}" height="${CH}" fill="${st.colors.bg}"/>`)
  P.push(`<rect x="${x}" y="${y}" width="${CW}" height="${LBL}" fill="#0c0c10"/>`)
  P.push(`<text x="${x + 12}" y="${y + 35}" font-family="DejaVu Sans" font-size="26" font-weight="bold" fill="#ffffff">${esc(st.label)}</text>`)
  try {
    const raw = renderMermaidSVG(d.src, { bg: st.colors.bg, fg: st.colors.fg, line: st.colors.line, accent: st.colors.accent, muted: st.colors.muted, surface: st.colors.surface, border: st.colors.border, font: st.font, embedFontImport: false, transparent: true, ...TYPE_OPT, style: { ...TYPE_OPT.style, node: { ...TYPE_OPT.style.node, cornerRadius: st.nodeCornerRadius } } })
    const img = raster(restyle(raw, st, { backdrop: true }), (CW - 24) * SCALE)
    const availW = CW - 24, availH = CH - LBL - 24
    const sc = Math.min(availW / (img.w / SCALE), availH / (img.h / SCALE))
    const dw = (img.w / SCALE) * sc, dh = (img.h / SCALE) * sc
    P.push(`<image x="${x + (CW - dw) / 2}" y="${y + LBL + (availH - dh) / 2}" width="${dw}" height="${dh}" href="data:image/png;base64,${img.png.toString('base64')}"/>`)
  } catch (e) { P.push(`<text x="${x + 12}" y="${y + 100}" fill="#f55" font-size="16">${esc((e as Error).message).slice(0, 50)}</text>`) }
})
P.push('</svg>')
const { png } = raster(P.join('\n'), W, '#15151a')
writeFileSync(join(DIR, 'review.png'), png)
console.log('wrote review.png', W, 'x', H, '·', d.type)
