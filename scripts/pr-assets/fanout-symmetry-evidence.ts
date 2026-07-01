// Before/after evidence for the fan-out peer symmetry fix (#71 follow-up).
//
// Renders the diagram twice: BEFORE from the commit just before the fix (real
// SVG output of the old same-rank gate of 28, via a detached worktree) and AFTER
// from the current tree (gate 40), then composes a labeled side-by-side PNG.
// Reproducible from source per docs/contributing/visual-review-evidence.md —
// not hand-captured.
//
//   bun run scripts/pr-assets/fanout-symmetry-evidence.ts
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'
import { THEMES } from '../../src/theme.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'pr-assets')
// Parent of the symmetry-fix commit: identical to this branch EXCEPT the
// applySymmetricFanoutEmissions same-rank gate is still 28, so this is the
// honest "before" that isolates exactly this change.
const BEFORE_SHA = '4072668024eac780b5d52e146721782a54a5f4e2'

const THEME = THEMES['github-light']!
const COLORS = { bg: THEME.bg, surface: THEME.bg, border: THEME.line, fg: THEME.fg, muted: THEME.muted }
const FONT_FILES = [
  join(ROOT, 'assets', 'fonts', 'DejaVuSans.ttf'),
  join(ROOT, 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
].filter(existsSync)

interface Raster { b64: string; width: number; height: number }

const CASES: Array<{ caption: string; source: string }> = [
  {
    caption: 'Fan-out peers D ("warnings") and E ("ok") equalize to one width + align; their edges mirror',
    source: [
      'flowchart LR',
      '  A["warnings"] -->|warnings| B["ok"]',
      '  B -->|ok| C["rendered"]',
      '  A2["same word: warnings"] --> A',
      '  B2["same word: ok"] --> B',
      '  C -->|warnings| D["warnings"]',
      '  C -->|ok| E["ok"]',
    ].join('\n'),
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
  const wt = join(tmpdir(), `beautiful-mermaid-fanoutsym-${BEFORE_SHA.slice(0, 7)}-${Date.now()}`)
  rmSync(wt, { recursive: true, force: true })
  execFileSync('git', ['worktree', 'add', '--detach', wt, BEFORE_SHA], { cwd: ROOT, stdio: 'pipe' })
  try {
    const modules = join(wt, 'node_modules')
    if (!existsSync(modules)) symlinkSync(join(ROOT, 'node_modules'), modules, 'dir')
    writeFileSync(join(wt, 'fanout-sym-probe.ts'), `
      import { renderMermaidSVG } from './src/index.ts'
      import { THEMES } from './src/theme.ts'
      const sources = ${JSON.stringify(sources)}
      const out = sources.map(s => renderMermaidSVG(s, { ...THEMES['github-light'], embedFontImport: false }))
      console.log(JSON.stringify(out))
    `)
    const raw = execFileSync('bun', ['fanout-sym-probe.ts'], { cwd: wt, encoding: 'utf8', env: { ...process.env, BUN_OPTIONS: '' } }).trim()
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

const PANEL_W = 920
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
body += label('BEFORE (gate 28)', COL_X[0]!, 150, '#9A3412')
body += label('AFTER (this PR, gate 40)', COL_X[1]!, 150, '#15803D')
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
  <text x="${GUTTER}" y="64" font-family="DejaVu Sans" font-size="40" font-weight="700" fill="${COLORS.fg}">Fan-out peer symmetry (#71 follow-up)</text>
  <text x="${GUTTER}" y="104" font-family="DejaVu Sans" font-size="22" fill="${COLORS.muted}">Real SVG output rendered from the pre-fix commit vs. this branch; not hand-captured.</text>
  ${body}
</svg>`

const file = 'fanout-symmetry-before-after.png'
const png = new Resvg(composite, {
  fitTo: { mode: 'width', value: WIDTH },
  background: COLORS.bg,
  font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'DejaVu Sans' },
}).render().asPng()
writeFileSync(join(OUT_DIR, file), png)
console.log(`wrote docs/pr-assets/${file} (${Math.round(png.byteLength / 1024)} KB)`)
