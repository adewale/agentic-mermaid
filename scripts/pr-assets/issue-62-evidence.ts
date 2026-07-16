// Before/after evidence for issue #62 — duplicate / parallel edge routing.
//
// Renders each case twice: BEFORE from the PR base commit (real SVG output of
// the old code, via a detached worktree) and AFTER from the current tree, then
// composes a labeled side-by-side PNG. Reproducible from source per
// docs/contributing/visual-review-evidence.md — not hand-captured.
//
//   bun run scripts/pr-assets/issue-62-evidence.ts
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'
import { BUILTIN_PALETTE_DEFINITIONS } from '../../src/palette-catalog.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'pr-assets')
// PR base (main, parent of the branch's first commit): the duplicate-edge lane
// work does not exist here, so this is the honest "before".
const BEFORE_SHA = '1dc77fe6a2d2cba55e4a3c6e21256cdad04f9974'

const THEME = BUILTIN_PALETTE_DEFINITIONS.find(palette => palette.inputName === 'github-light')!.colors
const COLORS = {
  bg: THEME.bg,
  surface: THEME.bg, // neutral wrapper that matches the diagram background
  border: THEME.line,
  fg: THEME.fg,
  muted: THEME.muted,
}
const FONT_FILES = [
  join(ROOT, 'assets', 'fonts', 'DejaVuSans.ttf'),
  join(ROOT, 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
].filter(existsSync)

interface Raster { b64: string; width: number; height: number }

const CASES: Array<{ caption: string; source: string }> = [
  {
    caption: 'Issue #62 repro: duplicate pair + feedback loop + distinct feeder into one hub',
    source: 'flowchart LR\n  N0[n0]\n  N1[n1]\n  N2[n2]\n  N3[(n3)]\n  N4[n4]\n  N4 --> N0\n  N0 -- go --> N4\n  N2 --> N3\n  N2 --> N3\n  N4 --> N3',
  },
  {
    caption: 'Shared hub: the two A→C duplicates no longer collapse onto one invisible line',
    source: 'flowchart LR\n  A[a] --> C[c]\n  A --> C\n  B[b] --> C',
  },
  {
    caption: 'Feedback pair: the two B→A back-edges spread to readable parallel lanes',
    source: 'flowchart LR\n  A[a] --> B[b]\n  B --> A\n  B --> A',
  },
]

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderAfter(source: string): string {
  return renderMermaidSVG(source, { ...THEME, embedFontImport: false })
}

// Render every BEFORE source in a single detached worktree at BEFORE_SHA.
function renderBeforeAll(sources: string[]): string[] {
  const wt = join(tmpdir(), `beautiful-mermaid-issue62-${BEFORE_SHA.slice(0, 7)}-${Date.now()}`)
  rmSync(wt, { recursive: true, force: true })
  execFileSync('git', ['worktree', 'add', '--detach', wt, BEFORE_SHA], { cwd: ROOT, stdio: 'pipe' })
  try {
    const modules = join(wt, 'node_modules')
    if (!existsSync(modules)) symlinkSync(join(ROOT, 'node_modules'), modules, 'dir')
    writeFileSync(join(wt, 'issue-62-probe.ts'), `
      import { renderMermaidSVG } from './src/index.ts'
      const sources = ${JSON.stringify(sources)}
      const out = sources.map(s => renderMermaidSVG(s, { style: 'github-light', embedFontImport: false }))
      console.log(JSON.stringify(out))
    `)
    const raw = execFileSync('bun', ['issue-62-probe.ts'], {
      cwd: wt,
      encoding: 'utf8',
      env: { ...process.env, BUN_OPTIONS: '' },
    }).trim()
    return JSON.parse(raw) as string[]
  } finally {
    execFileSync('git', ['worktree', 'remove', wt, '--force'], { cwd: ROOT, stdio: 'pipe' })
  }
}

function rasterize(svg: string, width: number): Raster {
  const rendered = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: COLORS.bg,
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'DejaVu Sans' },
  }).render()
  const png = rendered.asPng()
  return { b64: Buffer.from(png).toString('base64'), width: rendered.width, height: rendered.height }
}

function label(text: string, x: number, y: number, color: string): string {
  return `<text x="${x}" y="${y}" font-family="DejaVu Sans" font-size="26" font-weight="700" letter-spacing="2" fill="${color}">${esc(text)}</text>`
}

const PANEL_W = 760
const GUTTER = 56
const COL_X = [GUTTER, GUTTER * 2 + PANEL_W]
const WIDTH = PANEL_W * 2 + GUTTER * 3

mkdirSync(OUT_DIR, { recursive: true })

const befores = renderBeforeAll(CASES.map(c => c.source))
const rows = CASES.map((c, i) => ({
  caption: c.caption,
  before: rasterize(befores[i]!, PANEL_W),
  after: rasterize(renderAfter(c.source), PANEL_W),
}))

let body = ''
let y = 200
body += label('BEFORE (main)', COL_X[0]!, 150, '#9A3412')
body += label('AFTER (this PR)', COL_X[1]!, 150, '#15803D')
for (const row of rows) {
  y += 44
  body += `<text x="${GUTTER}" y="${y}" font-family="DejaVu Sans" font-size="22" font-weight="600" fill="${COLORS.fg}">${esc(row.caption)}</text>`
  y += 22
  const panelH = Math.max(row.before.height, row.after.height)
  const panel = (img: Raster, x: number) => `
    <rect x="${x - 14}" y="${y - 14}" width="${PANEL_W + 28}" height="${panelH + 28}" rx="16" fill="${COLORS.surface}" stroke="${COLORS.border}" stroke-width="2"/>
    <image x="${x}" y="${y}" width="${img.width}" height="${img.height}" href="data:image/png;base64,${img.b64}"/>`
  body += panel(row.before, COL_X[0]!) + panel(row.after, COL_X[1]!)
  y += panelH + 56
}
const height = y + 20

const composite = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
  <rect width="${WIDTH}" height="${height}" fill="${COLORS.bg}"/>
  <text x="${GUTTER}" y="64" font-family="DejaVu Sans" font-size="40" font-weight="700" fill="${COLORS.fg}">Issue #62 — duplicate &amp; parallel edge lanes</text>
  <text x="${GUTTER}" y="104" font-family="DejaVu Sans" font-size="22" fill="${COLORS.muted}">Real SVG output rendered at high resolution from main vs. this branch; not hand-captured.</text>
  ${body}
</svg>`

const file = 'issue-62-duplicate-edge-lanes-before-after.png'
const png = new Resvg(composite, {
  fitTo: { mode: 'width', value: WIDTH },
  background: COLORS.bg,
  font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'DejaVu Sans' },
}).render().asPng()
writeFileSync(join(OUT_DIR, file), png)
console.log(`wrote docs/pr-assets/${file} (${Math.round(png.byteLength / 1024)} KB)`)
