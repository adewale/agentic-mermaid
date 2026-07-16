// Before/after evidence for the PR #60 follow-up:
// - class-painted SceneGraph marks now use semantic paint in sketch backends
// - hosted PNG now bundles the built-in style fonts instead of substituting
//   DejaVu for every styled face.
//
// Reproducible from source, not hand-captured:
//   bun run scripts/pr-assets/pr60-style-paint-fonts-evidence.ts

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'
import { inlineFontVarForRaster } from '../../src/theme.ts'
import { BUILTIN_PALETTE_DEFINITIONS } from '../../src/palette-catalog.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'pr-assets')
const BEFORE_SHA = '1d3fd948026b0329ced32d4ddf7803830c3ca2a1'

const THEME = BUILTIN_PALETTE_DEFINITIONS.find(palette => palette.inputName === 'github-light')!.colors
const COLORS = {
  bg: THEME.bg,
  surface: THEME.bg,
  border: THEME.line,
  fg: THEME.fg,
  muted: THEME.muted,
}

const FONT_FILES_DEJAVU = [
  join(ROOT, 'assets', 'fonts', 'DejaVuSans.ttf'),
  join(ROOT, 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
].filter(existsSync)
const FONT_FILES_FULL = [
  ...FONT_FILES_DEJAVU,
  join(ROOT, 'assets', 'fonts', 'Caveat.ttf'),
  join(ROOT, 'assets', 'fonts', 'EBGaramond.ttf'),
  join(ROOT, 'assets', 'fonts', 'ArchitectsDaughter.ttf'),
  join(ROOT, 'assets', 'fonts', 'ShareTechMono.ttf'),
].filter(existsSync)

interface Raster { b64: string; width: number; height: number }

const STYLE_PAINT_CASES: Array<{ caption: string; style: string; source: string }> = [
  {
    caption: 'xychart / excalidraw: class-only bars and line series use semantic colors',
    style: 'excalidraw',
    source: `xychart-beta
  title "Quarterly Adoption"
  x-axis [Jan, Feb, Mar, Apr]
  y-axis "Users" 0 --> 100
  bar "Active users" [34, 58, 76, 91]
  line "Target" [40, 55, 70, 90]`,
  },
  {
    caption: 'gantt / watercolor: status bars get styled fills without losing status color',
    style: 'watercolor',
    source: `gantt
  title Launch Plan
  dateFormat YYYY-MM-DD
  section Build
  API contract :active, api, 2026-01-01, 6d
  Frontend polish :done, ui, after api, 4d
  section Ship
  Release candidate :crit, rel, after ui, 3d`,
  },
]

const FONT_CASE = {
  caption: 'hosted PNG / hand-drawn: bundled Caveat face replaces old DejaVu fallback',
  style: 'hand-drawn',
  source: `flowchart LR
  A["Hand-drawn style font"]
  A --> B["Hosted PNG now bundles it"]`,
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderAfter(source: string, style: string): string {
  return inlineFontVarForRaster(renderMermaidSVG(source, { style, seed: 3, embedFontImport: false }))
}

function renderBeforeAll(cases: Array<{ source: string; style: string }>): string[] {
  const wt = join(tmpdir(), `beautiful-mermaid-pr60-before-${BEFORE_SHA.slice(0, 7)}-${Date.now()}`)
  rmSync(wt, { recursive: true, force: true })
  execFileSync('git', ['worktree', 'add', '--detach', wt, BEFORE_SHA], { cwd: ROOT, stdio: 'pipe' })
  try {
    const modules = join(wt, 'node_modules')
    if (!existsSync(modules)) symlinkSync(join(ROOT, 'node_modules'), modules, 'dir')
    writeFileSync(join(wt, 'pr60-probe.ts'), `
      import { renderMermaidSVG } from './src/index.ts'
      import { inlineFontVarForRaster } from './src/theme.ts'
      const cases = ${JSON.stringify(cases)}
      const out = cases.map(c => inlineFontVarForRaster(renderMermaidSVG(c.source, { style: c.style, seed: 3, embedFontImport: false })))
      console.log(JSON.stringify(out))
    `)
    const raw = execFileSync('bun', ['pr60-probe.ts'], {
      cwd: wt,
      encoding: 'utf8',
      env: { ...process.env, BUN_OPTIONS: '' },
    }).trim()
    return JSON.parse(raw) as string[]
  } finally {
    execFileSync('git', ['worktree', 'remove', wt, '--force'], { cwd: ROOT, stdio: 'pipe' })
  }
}

function rasterize(svg: string, width: number, fontFiles = FONT_FILES_FULL): Raster {
  const rendered = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: COLORS.bg,
    font: { loadSystemFonts: false, fontFiles, defaultFontFamily: 'DejaVu Sans' },
  }).render()
  const png = rendered.asPng()
  return { b64: Buffer.from(png).toString('base64'), width: rendered.width, height: rendered.height }
}

function label(text: string, x: number, y: number, color: string): string {
  return `<text x="${x}" y="${y}" font-family="DejaVu Sans" font-size="24" font-weight="700" fill="${color}">${esc(text)}</text>`
}

const PANEL_W = 720
const GUTTER = 52
const COL_X = [GUTTER, GUTTER * 2 + PANEL_W]
const WIDTH = PANEL_W * 2 + GUTTER * 3

mkdirSync(OUT_DIR, { recursive: true })

const beforeSvgs = renderBeforeAll(STYLE_PAINT_CASES.map(({ source, style }) => ({ source, style })))
const rows = STYLE_PAINT_CASES.map((c, i) => ({
  caption: c.caption,
  before: rasterize(beforeSvgs[i]!, PANEL_W),
  after: rasterize(renderAfter(c.source, c.style), PANEL_W),
}))

const fontSvg = renderAfter(FONT_CASE.source, FONT_CASE.style)
rows.push({
  caption: FONT_CASE.caption,
  before: rasterize(fontSvg, PANEL_W, FONT_FILES_DEJAVU),
  after: rasterize(fontSvg, PANEL_W, FONT_FILES_FULL),
})

let body = ''
let y = 190
body += label('BEFORE', COL_X[0]!, 145, '#9A3412')
body += label('AFTER', COL_X[1]!, 145, '#15803D')
for (const row of rows) {
  y += 42
  body += `<text x="${GUTTER}" y="${y}" font-family="DejaVu Sans" font-size="21" font-weight="600" fill="${COLORS.fg}">${esc(row.caption)}</text>`
  y += 20
  const panelH = Math.max(row.before.height, row.after.height)
  const panel = (img: Raster, x: number) => `
    <rect x="${x - 12}" y="${y - 12}" width="${PANEL_W + 24}" height="${panelH + 24}" rx="14" fill="${COLORS.surface}" stroke="${COLORS.border}" stroke-width="2"/>
    <image x="${x}" y="${y}" width="${img.width}" height="${img.height}" href="data:image/png;base64,${img.b64}"/>`
  body += panel(row.before, COL_X[0]!) + panel(row.after, COL_X[1]!)
  y += panelH + 50
}

const height = y + 20
const composite = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
  <rect width="${WIDTH}" height="${height}" fill="${COLORS.bg}"/>
  <text x="${GUTTER}" y="60" font-family="DejaVu Sans" font-size="38" font-weight="700" fill="${COLORS.fg}">PR #60 follow-up: styled paint and hosted fonts</text>
  <text x="${GUTTER}" y="100" font-family="DejaVu Sans" font-size="21" fill="${COLORS.muted}">Before renders from ${BEFORE_SHA.slice(0, 7)}; after renders from this branch. Font row simulates the old hosted DejaVu-only PNG path.</text>
  ${body}
</svg>`

const file = 'pr60-style-paint-fonts-before-after.png'
const png = new Resvg(composite, {
  fitTo: { mode: 'width', value: WIDTH },
  background: COLORS.bg,
  font: { loadSystemFonts: false, fontFiles: FONT_FILES_FULL, defaultFontFamily: 'DejaVu Sans' },
}).render().asPng()
writeFileSync(join(OUT_DIR, file), png)
console.log(`wrote docs/pr-assets/${file} (${Math.round(png.byteLength / 1024)} KB)`)
