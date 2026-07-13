// Visual evidence for the cupertino built-in style (PR #148).
//
// Two committed assets, reproducible from source per
// docs/contributing/visual-review-evidence.md — not hand-captured:
//   cupertino-before-after.png  — the same flowchart source rendered with the
//                                 crisp default vs. style 'cupertino'
//   cupertino-families.png      — six diagram families under the one style
//
// The cupertino panels pass RenderOptions.shadow: true — a public API option
// today, but not yet expressible via StyleSpec or the CLI (plan Phase 1), so
// `am render --style cupertino` produces the same geometry without elevation.
//
//   bun run scripts/pr-assets/cupertino-evidence.ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'
import { BUILTIN_FAMILY_METADATA } from '../../src/agent/families.ts'
import { inlineFontVarForRaster } from '../../src/theme.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'pr-assets')
const FONT_DIR = join(ROOT, 'assets', 'fonts')

// Wrapper chrome uses the style's own grouped-surface palette so the panels
// sit on the background they were designed for (reviewer checklist item 7).
const PAGE = '#f2f2f7'
const INK = '#000000'
const MUTED = '#66666b'

interface Raster { b64: string; width: number; height: number }

const FLOWCHART = `flowchart TD
  subgraph Client
    A[Open App] --> B{Signed in?}
  end
  B -- Yes --> C[Load Library]
  B -- No --> D[Show Onboarding]
  D --> E[Create Account]
  E --> C
  subgraph Cloud
    C --> F[(Sync Store)]
    F --> G[Push Changes]
  end`

const FAMILIES: Array<{ caption: string; source: string }> = [
  {
    caption: 'sequence',
    source: 'sequenceDiagram\n  participant iPhone\n  participant Server\n  participant APNs\n  iPhone->>Server: Register device token\n  Server-->>iPhone: Ack\n  Server->>APNs: Send push payload\n  APNs-->>iPhone: Deliver notification',
  },
  {
    caption: 'class',
    source: 'classDiagram\n  class MediaItem {\n    +UUID id\n    +String title\n    +play()\n  }\n  class Playlist {\n    +String name\n    +add(item)\n  }\n  Playlist o-- MediaItem\n  MediaItem <|-- Song',
  },
  {
    caption: 'er',
    source: 'erDiagram\n  USER ||--o{ SUBSCRIPTION : has\n  SUBSCRIPTION }o--|| PLAN : "billed as"\n  USER {\n    uuid id\n    string email\n  }',
  },
  {
    caption: 'state',
    source: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Recording : press\n  Recording --> Paused : pause\n  Paused --> Recording : resume\n  Recording --> Idle : stop',
  },
  {
    caption: 'timeline',
    source: 'timeline\n  title Release Train\n  section Spring\n    March : Feature freeze\n    April : Beta 1 : Beta 2\n  section Summer\n    June : Announcement\n    September : Public release',
  },
  {
    caption: 'pie',
    source: 'pie showData\n  title Storage Used\n  "Photos" : 128\n  "Apps" : 64\n  "Messages" : 32\n  "System" : 24',
  },
]

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function render(source: string, cupertino: boolean): string {
  return inlineFontVarForRaster(renderMermaidSVG(source, {
    embedFontImport: false,
    ...(cupertino ? { style: 'cupertino', shadow: true } : {}),
  }))
}

function rasterize(svg: string, width: number): Raster {
  const rendered = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: false, fontDirs: [FONT_DIR], defaultFontFamily: 'Inter' },
  }).render()
  const png = rendered.asPng()
  return { b64: Buffer.from(png).toString('base64'), width: rendered.width, height: rendered.height }
}

function panel(img: Raster, x: number, y: number, w: number, h: number, fill: string): string {
  return `
  <rect x="${x - 14}" y="${y - 14}" width="${w + 28}" height="${h + 28}" rx="16" fill="${fill}"/>
  <image x="${x + (w - img.width) / 2}" y="${y}" width="${img.width}" height="${img.height}" href="data:image/png;base64,${img.b64}"/>`
}

function writeComposite(file: string, width: number, height: number, body: string, title: string, subtitle: string): void {
  const composite = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${PAGE}"/>
  <text x="56" y="64" font-family="Inter" font-size="36" font-weight="700" fill="${INK}">${esc(title)}</text>
  <text x="56" y="100" font-family="Inter" font-size="20" fill="${MUTED}">${esc(subtitle)}</text>
  ${body}
</svg>`
  const png = new Resvg(composite, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: false, fontDirs: [FONT_DIR], defaultFontFamily: 'Inter' },
  }).render().asPng()
  writeFileSync(join(OUT_DIR, file), png)
  console.log(`${file}: ${png.length} bytes`)
}

if (!existsSync(FONT_DIR)) throw new Error(`bundled fonts not found at ${FONT_DIR}`)
mkdirSync(OUT_DIR, { recursive: true })

// ---- before/after: crisp default vs cupertino, same source -----------------
{
  const PANEL_W = 560
  const GUTTER = 56
  const before = rasterize(render(FLOWCHART, false), PANEL_W)
  const after = rasterize(render(FLOWCHART, true), PANEL_W)
  const panelH = Math.max(before.height, after.height)
  const colX = [GUTTER, GUTTER * 2 + PANEL_W]
  let body = ''
  body += `<text x="${colX[0]}" y="156" font-family="Inter" font-size="22" font-weight="600" letter-spacing="1" fill="${MUTED}">DEFAULT (crisp)</text>`
  body += `<text x="${colX[1]}" y="156" font-family="Inter" font-size="22" font-weight="600" letter-spacing="1" fill="${MUTED}">style: 'cupertino'</text>`
  body += panel(before, colX[0]!, 190, PANEL_W, panelH, '#ffffff')
  body += panel(after, colX[1]!, 190, PANEL_W, panelH, PAGE)
  writeComposite(
    'cupertino-before-after.png',
    PANEL_W * 2 + GUTTER * 3,
    190 + panelH + 56,
    body,
    'cupertino — one option changed',
    'Same flowchart source; right panel adds { style: "cupertino", shadow: true }. Real renders, not hand-captured.',
  )
}

// ---- family contact sheet ---------------------------------------------------
{
  const PANEL_W = 520
  const GUTTER = 48
  const COLS = 3
  const rasters = FAMILIES.map(f => ({ caption: f.caption, img: rasterize(render(f.source, true), PANEL_W) }))
  const rowHeights: number[] = []
  for (let r = 0; r < rasters.length / COLS; r++) {
    rowHeights.push(Math.max(...rasters.slice(r * COLS, r * COLS + COLS).map(x => x.img.height)))
  }
  let body = ''
  let y = 160
  rasters.forEach((entry, i) => {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const x = GUTTER + col * (PANEL_W + GUTTER)
    const rowY = y + rowHeights.slice(0, row).reduce((a, b) => a + b + 96, 0)
    body += `<text x="${x}" y="${rowY - 20}" font-family="Inter" font-size="20" font-weight="600" fill="${MUTED}">${esc(entry.caption)}</text>`
    body += panel(entry.img, x, rowY, PANEL_W, rowHeights[row]!, PAGE)
  })
  const height = y + rowHeights.reduce((a, b) => a + b + 96, 0) + 20
  writeComposite(
    'cupertino-families.png',
    (PANEL_W + GUTTER) * COLS + GUTTER,
    height,
    body,
    'cupertino — one registration, every family',
    `Six of the ${BUILTIN_FAMILY_METADATA.length} families rendered with { style: "cupertino", shadow: true }.`,
  )
}
