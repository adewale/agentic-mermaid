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

const DIR = import.meta.dir
const FONT_FILES = ['Caveat.ttf', 'EBGaramond.ttf'].map(f => join(DIR, f))
  .concat(['../../assets/fonts/DejaVuSans.ttf', '../../assets/fonts/DejaVuSans-Bold.ttf'].map(f => join(DIR, f)))

// The 12 supported diagram types (sources from editor/js/examples.js).
const DIAGRAMS: { type: string; src: string }[] = [
  { type: 'Flowchart', src: `flowchart TD\n  A[Start] --> B{Decision?}\n  B -->|Yes| C[Do the thing]\n  B -->|No| D[Skip it]\n  C --> E[End]\n  D --> E` },
  { type: 'State', src: `stateDiagram-v2\n  [*] --> Idle\n  Idle --> Processing: start\n  Processing --> Complete: done\n  Processing --> Failed: error\n  Failed --> Idle: retry\n  Complete --> [*]` },
  { type: 'Architecture', src: `architecture-beta\n  group app(cloud)[Application]\n  group data(database)[Data]\n  service web(server)[Web App] in app\n  service api(server)[API] in app\n  service db(database)[Postgres] in data\n  web:R --> L:api\n  api:R --> L:db` },
  { type: 'Sequence', src: `sequenceDiagram\n  participant User\n  participant App\n  participant API\n  User->>App: Click export\n  App->>API: Render SVG\n  API-->>App: SVG string\n  App-->>User: Download` },
  { type: 'Class', src: `classDiagram\n  class Renderer {\n    +renderSVG(source) string\n    +renderASCII(source) string\n  }\n  class Theme {\n    +bg string\n    +fg string\n  }\n  Renderer --> Theme : uses` },
  { type: 'ER', src: `erDiagram\n  CUSTOMER {\n    string id PK\n    string email\n  }\n  ORDER {\n    string id PK\n    date created\n  }\n  LINE_ITEM {\n    string id PK\n    int quantity\n  }\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains` },
  { type: 'Timeline', src: `timeline\n  title Product roadmap\n  section Foundation\n  2024 Q1 : Prototype\n          : Parser coverage\n  section Launch\n  2024 Q2 : Public editor\n          : SVG export` },
  { type: 'Journey', src: `journey\n  title Editor adoption\n  section Try\n    Open editor: 5: User\n    Load example: 4: User, Developer\n  section Share\n    Copy URL: 5: User\n    Export SVG: 4: Developer` },
  { type: 'XY Chart', src: `xychart\n  title "Weekly renders"\n  x-axis [Mon, Tue, Wed, Thu, Fri]\n  y-axis "Renders" 0 --> 100\n  bar [25, 42, 58, 74, 88]\n  line [18, 35, 52, 70, 95]` },
  { type: 'Pie', src: `pie showData\n  title Export requests by format\n  "SVG" : 42\n  "PNG" : 28\n  "ASCII" : 18\n  "Unicode" : 12` },
  { type: 'Quadrant', src: `quadrantChart\n  title Feature priorities\n  x-axis Low impact --> High impact\n  y-axis Low effort --> High effort\n  quadrant-1 Plan carefully\n  quadrant-2 Big bets\n  quadrant-3 Defer\n  quadrant-4 Quick wins\n  SVG export: [0.78, 0.28]\n  MCP setup: [0.62, 0.72]\n  Theme polish: [0.35, 0.24]` },
  { type: 'Gantt', src: `gantt\n  title Release train\n  dateFormat YYYY-MM-DD\n  excludes weekends\n  section Build\n    Completed task :done, des1, 2024-01-08, 2024-01-10\n    Active task    :active, des2, 2024-01-11, 3d\n    Future task    :des3, after des2, 5d\n  section Ship\n    Crit review    :crit, rev1, after des3, 2d\n    Release        :milestone, m1, after rev1, 0d` },
]

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
