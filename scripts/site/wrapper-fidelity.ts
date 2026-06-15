// ============================================================================
// Before/after evidence for the wrapper-fidelity fix (BUILD-21) →
// docs/assets/improvements/wrapper-*.png
//
// Same reproducibility contract as improvements.ts: the BEFORE column runs the
// real parse → serialize (+ verify) loop at a historical git ref in a temp
// worktree; the AFTER column runs the current tree. The panels show source
// text and round-tripped source text verbatim — nothing is hand-edited.
//
// Run: bun run scripts/site/wrapper-fidelity.ts [--before <ref>]
//   default --before main (the tree before the 1C/2C wrapper work)
// ============================================================================

import { writeFileSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { Resvg } from '@resvg/resvg-js'
import { parseMermaid, serializeMermaid, verifyMermaid } from '../../src/agent/index.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'assets', 'improvements')
const BEFORE_REF = (() => {
  const i = process.argv.indexOf('--before')
  return i >= 0 ? process.argv[i + 1]! : 'main'
})()

interface Case {
  file: string
  title: string
  caption: string
  source: string
}

const CASES: Case[] = [
  {
    file: 'wrapper-frontmatter',
    title: 'Frontmatter config keys survive the edit loop',
    caption: 'Mermaid reads layout/look only under config:. Before: round-tripping flattened them to top-level keys Mermaid ignores — the author’s ELK request silently died on interop. After: byte-verbatim.',
    source: '---\nconfig:\n  layout: elk\n  look: handDrawn\n---\nflowchart TD\n  A --> B',
  },
  {
    file: 'wrapper-init-directive',
    title: 'Init directives are no longer duplicated',
    caption: 'Before: the directive’s config was lifted into a synthesized frontmatter block AND the directive was kept — the same setting twice, in two syntaxes. After: byte-verbatim.',
    source: '%%{init: {"flowchart": {"curve": "basis"}}}%%\nflowchart TD\n  A --> B',
  },
  {
    file: 'wrapper-leading-comment',
    title: 'Comments before the header survive',
    caption: 'Before: a leading %% comment was erased by every parse → serialize round-trip. After: byte-verbatim.',
    source: '%% keep: reviewed by security 2026-06\nflowchart TD\n  A --> B',
  },
  {
    file: 'comment-dropped-lint',
    title: 'In-body comment loss is announced, not silent',
    caption: 'Structured bodies canonicalize in-body %% comments away (2C). Before: dropped with zero warnings. After: still canonicalized, but verify emits the Tier 3 COMMENT_DROPPED lint naming the lines.',
    source: 'flowchart TD\n  %% do not reorder: auth flow order matters\n  A --> B',
  },
]

interface Probe { out: string; warnings: string }

function probeCurrent(src: string): Probe {
  const p = parseMermaid(src)
  if (!p.ok) return { out: 'parse error', warnings: '-' }
  const v = verifyMermaid(p.value)
  const codes = v.warnings.map(w => w.code === 'COMMENT_DROPPED' ? `${w.code} (count ${(w as { count: number }).count}, lines ${(w as { lines: number[] }).lines.join(',')})` : w.code)
  return { out: serializeMermaid(p.value), warnings: codes.join(', ') || 'none' }
}

// ---- BEFORE probes at the historical ref via a temp worktree ----------------

const wtPath = '/tmp/am-wrapper-before'
rmSync(wtPath, { recursive: true, force: true })
execSync(`git worktree prune`, { cwd: ROOT })
execSync(`git worktree add ${wtPath} ${BEFORE_REF}`, { cwd: ROOT, stdio: 'pipe' })
try {
  if (!existsSync(join(wtPath, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(wtPath, 'node_modules'))
  const probe = `
    const { parseMermaid, serializeMermaid, verifyMermaid } = await import('./src/agent/index.ts')
    const cases = ${JSON.stringify(CASES.map(c => c.source))}
    console.log(JSON.stringify(cases.map(src => {
      try {
        const p = parseMermaid(src)
        if (!p.ok) return { out: 'parse error', warnings: '-' }
        const v = verifyMermaid(p.value)
        return { out: serializeMermaid(p.value), warnings: v.warnings.map(w => w.code).join(', ') || 'none' }
      } catch (e) { return { out: 'error: ' + e.message, warnings: '-' } }
    })))
  `
  writeFileSync(join(wtPath, 'probe-before.ts'), probe)
  const beforeProbes = JSON.parse(
    execSync(`bun -e "await import('${wtPath}/probe-before.ts')"`, { cwd: wtPath, encoding: 'utf8', env: { ...process.env, BUN_OPTIONS: '' } }).trim(),
  ) as Probe[]

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

  const panelText = (p: Probe): string[] => [
    ...p.out.trimEnd().split('\n'),
    '',
    `verify warnings: ${p.warnings}`,
  ]

  CASES.forEach((c, idx) => {
    const src = c.source.split('\n')
    const before = panelText(beforeProbes[idx]!)
    const after = panelText(probeCurrent(c.source))
    const fontSize = 11
    const lineH = fontSize * 1.18
    const charW = fontSize * 0.602
    const colChars = Math.max(...src.map(l => l.length), ...before.map(l => l.length), ...after.map(l => l.length), 34)
    const colW = Math.ceil(colChars * charW) + 48
    const rows = Math.max(src.length, before.length, after.length)
    const panelH = Math.ceil(rows * lineH) + 64
    const W = Math.max(colW * 3 + 36 * 4, Math.ceil(c.title.length * 22 * 0.58) + 72)
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
      ${panel(36, 'SOURCE', SALMON.muted)}
      ${mono(src, 36 + 18, panelTop + 54, fontSize, SALMON.fg)}
      ${panel(36 * 2 + colW, 'ROUND-TRIP BEFORE (' + BEFORE_REF + ')', SALMON.red)}
      ${mono(before, 36 * 2 + colW + 18, panelTop + 54, fontSize, SALMON.fg)}
      ${panel(36 * 3 + colW * 2, 'ROUND-TRIP AFTER', SALMON.green)}
      ${mono(after, 36 * 3 + colW * 2 + 18, panelTop + 54, fontSize, SALMON.fg)}
    </svg>`

    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: Math.min(W * 2, 2400) },
      font: { loadSystemFonts: false, fontFiles, defaultFontFamily: 'DejaVu Sans' },
    }).render().asPng()
    writeFileSync(join(OUT_DIR, `${c.file}.png`), png)
    console.log(`wrote docs/assets/improvements/${c.file}.png (${Math.round(png.length / 1024)} KB)`)
  })
} finally {
  execSync(`git worktree remove ${wtPath} --force`, { cwd: ROOT, stdio: 'pipe' })
}
