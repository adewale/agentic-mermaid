// ============================================================================
// Before/after improvement images → docs/assets/improvements/*.png
//
// Generates the visual evidence for PR descriptions and docs: each image is a
// side-by-side BEFORE/AFTER of real renderer output for one fixed bug, in the
// fork's salmon identity. The BEFORE column renders at a historical git SHA
// (checked out into a temporary worktree); the AFTER column renders from the
// current tree. Nothing is hand-drawn, so the images cannot drift from the
// renderer's actual behavior.
//
// Run: bun run scripts/site/improvements.ts [--before <sha>]
//   default --before f0a9f5f (main before the audit-branch fixes landed)
//
// Requires the dejavu system fonts for the monospace panels (same constraint
// as scripts/site/hero.ts).
// ============================================================================

import { writeFileSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidASCII } from '../../src/ascii/index.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'assets', 'improvements')
const BEFORE_SHA = (() => {
  const i = process.argv.indexOf('--before')
  return i >= 0 ? process.argv[i + 1]! : 'f0a9f5f'
})()

interface Case {
  file: string
  title: string
  caption: string
  source: string
}

const CASES: Case[] = [
  {
    file: 'er-content-loss',
    title: 'ER: silent content loss fixed',
    caption: 'The official Mermaid docs example. Before: the }o..o{ relationship and the PERSON entity vanish. After: both render; never-valid tokens now error loudly.',
    source: 'erDiagram\n    CAR ||--o{ NAMED-DRIVER : allows\n    PERSON }o..o{ NAMED-DRIVER : is',
  },
  {
    file: 'fan-in-trunks',
    title: 'Fan-in groups get separate trunks',
    caption: 'Upstream issue #68. Before: both fan-in groups share one trunk row with an ambiguous crossing. After: each target sits under its own root group.',
    source: 'graph TD\n    A1 --> A\n    A2 --> A\n    B1 --> B\n    B2 --> B\n    A --> C\n    B --> C',
  },
  {
    file: 'box-start-connector',
    title: 'Box-start connector sits on the border',
    caption: 'Upstream issue #112. Before: a sibling edge label widens the column and the connector floats in whitespace. After: flush on the source border.',
    source: 'flowchart LR\n  Src["Source"]\n  Top["Top Target"]\n  Mid["Middle Target"]\n  Bot["Bottom Target"]\n  Src -->|top*| Top\n  Src -->|mid*| Mid\n  Src -->|bot*| Bot',
  },
  {
    file: 'subgraph-container-edges',
    title: 'Edges to a subgraph attach to the container',
    caption: 'Before: an edge to a subgraph id spawns a phantom duplicate box; the container floats separately. After: the edge terminates at the container border.',
    source: 'flowchart TD\n  Start --> Pipeline\n  subgraph Pipeline\n    direction LR\n    Fetch --> Parse --> Transform --> Store\n  end\n  Pipeline --> Done',
  },
]

// ---- Render BEFORE outputs at the historical SHA via a temp worktree --------

const wtPath = '/tmp/am-improvements-before'
rmSync(wtPath, { recursive: true, force: true })
execSync(`git worktree prune`, { cwd: ROOT })
execSync(`git worktree add ${wtPath} ${BEFORE_SHA}`, { cwd: ROOT, stdio: 'pipe' })
try {
  if (!existsSync(join(wtPath, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(wtPath, 'node_modules'))
  const probe = `
    const { renderMermaidASCII } = await import('./src/ascii/index.ts')
    const cases = ${JSON.stringify(CASES.map(c => c.source))}
    console.log(JSON.stringify(cases.map(src => {
      try { return renderMermaidASCII(src) } catch (e) { return 'render error: ' + e.message }
    })))
  `
  writeFileSync(join(wtPath, 'render-before.ts'), probe)
  const beforeOutputs = JSON.parse(
    execSync(`bun -e "await import('${wtPath}/render-before.ts')"`, { cwd: wtPath, encoding: 'utf8', env: { ...process.env, BUN_OPTIONS: '' } }).trim(),
  ) as string[]

  // ---- Compose one PNG per case ---------------------------------------------

  const SALMON = { bg: '#FFFBF5', fg: '#521000', accent: '#FF4801', muted: '#85532E', surface: '#FFFDFB', border: '#D4B89E', red: '#B3261E', green: '#1E7A46' }
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const mono = (lines: string[], x: number, y: number, size: number, fill: string) =>
    lines.map((l, i) => `<text x="${x}" y="${y + i * size * 1.18}" font-family="DejaVu Sans Mono, monospace" font-size="${size}" fill="${fill}" xml:space="preserve">${esc(l)}</text>`).join('\n')

  const fontFiles = [
    join(ROOT, 'assets', 'fonts', 'DejaVuSans.ttf'),
    join(ROOT, 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
  ].filter(existsSync)

  mkdirSync(OUT_DIR, { recursive: true })

  // Greedy word-wrap by an estimated proportional-font advance.
  const wrap = (text: string, maxPx: number, size: number): string[] => {
    const px = (s: string) => s.length * size * 0.52
    const out: string[] = []
    let line = ''
    for (const word of text.split(' ')) {
      const next = line ? line + ' ' + word : word
      if (line && px(next) > maxPx) { out.push(line); line = word } else line = next
    }
    if (line) out.push(line)
    return out
  }

  CASES.forEach((c, idx) => {
    const before = beforeOutputs[idx]!.trimEnd().split('\n')
    const after = renderMermaidASCII(c.source).trimEnd().split('\n')
    const fontSize = 11
    const lineH = fontSize * 1.18
    const charW = fontSize * 0.602 // DejaVu Sans Mono advance ratio
    const colChars = Math.max(...before.map(l => l.length), ...after.map(l => l.length), 30)
    const colW = Math.ceil(colChars * charW) + 48
    const rows = Math.max(before.length, after.length)
    const panelH = Math.ceil(rows * lineH) + 64
    // Wide enough for both panels AND the title; the caption wraps to fit.
    const W = Math.max(colW * 2 + 36 * 3, Math.ceil(c.title.length * 22 * 0.58) + 72)
    const captionLines = wrap(c.caption, W - 72, 13)
    const panelTop = 72 + captionLines.length * 18 + 14
    const H = panelTop + panelH + 46

    const panel = (x: number, label: string, color: string) =>
      `<rect x="${x}" y="${panelTop}" width="${colW}" height="${panelH}" rx="14" fill="${SALMON.surface}" stroke="${SALMON.border}" stroke-width="1.5"/>
       <text x="${x + 18}" y="${panelTop + 26}" font-family="DejaVu Sans" font-size="13" font-weight="bold" fill="${color}" letter-spacing="2">${label}</text>`

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect width="${W}" height="${H}" fill="${SALMON.bg}"/>
      <text x="36" y="44" font-family="DejaVu Sans" font-size="22" font-weight="bold" fill="${SALMON.fg}">${esc(c.title)}</text>
      ${captionLines.map((l, i) => `<text x="36" y="${72 + i * 18}" font-family="DejaVu Sans" font-size="13" fill="${SALMON.muted}">${esc(l)}</text>`).join('\n')}
      ${panel(36, 'BEFORE (' + BEFORE_SHA + ')', SALMON.red)}
      ${mono(before, 36 + 18, panelTop + 54, fontSize, SALMON.fg)}
      ${panel(36 * 2 + colW, 'AFTER', SALMON.green)}
      ${mono(after, 36 * 2 + colW + 18, panelTop + 54, fontSize, SALMON.fg)}
    </svg>`

    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: Math.min(W * 2, 2000) },
      font: { loadSystemFonts: false, fontFiles, defaultFontFamily: 'DejaVu Sans' },
    }).render().asPng()
    writeFileSync(join(OUT_DIR, `${c.file}.png`), png)
    console.log(`wrote docs/assets/improvements/${c.file}.png (${Math.round(png.length / 1024)} KB)`)
  })
} finally {
  execSync(`git worktree remove ${wtPath} --force`, { cwd: ROOT, stdio: 'pipe' })
}
