/**
 * Render PR #54 before/after evidence by comparing a base worktree against
 * the current branch. The base worktree must have dependencies available
 * (the simplest local setup is a node_modules symlink to this checkout):
 *
 *   git worktree add --detach /tmp/bm-main-pr54 origin/main
 *   ln -s "$PWD/node_modules" /tmp/bm-main-pr54/node_modules
 *   bun run eval/visual-rubric/before-after.ts \
 *     --base-dir /tmp/bm-main-pr54 \
 *     --out docs/pr-assets/before-after.png
 */
import { Resvg } from '@resvg/resvg-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { contactSheetScenarios } from './scenarios.ts'
import { renderMermaidSVG as renderAfter } from '../../src/index.ts'

interface RendererModule {
  renderMermaidSVG(source: string): string
}

interface BeforeAfterCase {
  id: string
  title: string
  source: string
}

function argValue(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name)
  return idx >= 0 ? process.argv[idx + 1] ?? fallback : fallback
}

const out = argValue('--out', 'docs/pr-assets/before-after.png')
const baseDir = argValue('--base-dir', '/tmp/bm-main-pr54')
const baseLabel = argValue('--base-label', 'origin/main')
const afterLabel = argValue('--after-label', 'this branch')

const baseModule = await import(pathToFileURL(resolve(baseDir, 'src/index.ts')).href) as RendererModule
const scenarios = contactSheetScenarios()
const byLetter = new Map(scenarios.map(s => [s.letter, s]))
const scenario = (letter: string) => {
  const found = byLetter.get(letter)
  if (!found) throw new Error(`missing contact-sheet scenario ${letter}`)
  return found
}

const cases: BeforeAfterCase[] = [
  {
    id: 'MFA',
    title: 'MFA/login route hitches — clear-lane edges straighten and retry labels stay on loops',
    source: `flowchart LR
  A[User] --> B[Login Page]
  B --> C{Valid Credentials?}
  C -- No --> B
  C -- Yes --> D{MFA Enabled?}
  D -- No --> G[Create Session]
  D -- Yes --> E[Enter MFA Code]
  E --> F{Code Valid?}
  F -- No --> E
  F -- Yes --> G`,
  },
  { id: 'E', title: scenario('E').title, source: scenario('E').source },
  { id: 'G', title: scenario('G').title, source: scenario('G').source },
  { id: 'L', title: scenario('L').title, source: scenario('L').source },
  { id: 'T', title: scenario('T').title, source: scenario('T').source },
  {
    id: 'Nested',
    title: 'Nested subgraph-id endpoint — edge attaches to the Pipeline container, not a phantom node',
    source: `flowchart LR
  X --> Pipeline
  subgraph Outer
    direction TB
    subgraph Pipeline
      Fetch --> Done
    end
  end`,
  },
]

const W = 1280
const PAD = 28
const GAP = 28
const LABEL_H = 76
const CELL_W = (W - PAD * 2 - GAP) / 2
const CELL_H = 300
const ROW_H = LABEL_H + CELL_H + 38
const H = 92 + cases.length * ROW_H + 30

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderCard(renderer: RendererModule, source: string, width: number): { href?: string; error?: string } {
  try {
    const svg = renderer.renderMermaidSVG(source).replace(/<\?xml[^>]*\?>/, '')
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: Math.floor(width) } }).render().asPng()
    return { href: `data:image/png;base64,${Buffer.from(png).toString('base64')}` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

const blocks: string[] = []
blocks.push('<rect width="100%" height="100%" fill="#fdf6ec"/>')
blocks.push(`<text x="${PAD}" y="34" font-size="21" font-weight="800" fill="#5c1a0a">PR #54 before/after — generated from origin/main vs this branch</text>`)
blocks.push(`<text x="${PAD}" y="62" font-size="13" fill="#7a4a32">Left: ${esc(baseLabel)}. Right: ${esc(afterLabel)}. Same sources, same renderMermaidSVG entrypoint.</text>`)
blocks.push(`<text x="${PAD}" y="88" font-size="15" font-weight="700" fill="#8b2f12">BEFORE — main</text>`)
blocks.push(`<text x="${PAD + CELL_W + GAP}" y="88" font-size="15" font-weight="700" fill="#1f6f43">AFTER — ${esc(afterLabel)}</text>`)

for (let i = 0; i < cases.length; i++) {
  const c = cases[i]!
  const y = 105 + i * ROW_H
  blocks.push(`<text x="${PAD}" y="${y}" font-size="14" font-weight="700" fill="#4b2618">${esc(c.id)} — ${esc(c.title)}</text>`)
  for (const [col, renderer] of [[0, baseModule], [1, { renderMermaidSVG: renderAfter }]] as const) {
    const x = PAD + col * (CELL_W + GAP)
    const cardY = y + 16
    blocks.push(`<rect x="${x}" y="${cardY}" width="${CELL_W}" height="${CELL_H}" rx="10" fill="#fffaf4" stroke="#ead4c2"/>`)
    const rendered = renderCard(renderer, c.source, CELL_W - 36)
    if (rendered.href) {
      blocks.push(`<image x="${x + 18}" y="${cardY + 14}" width="${CELL_W - 36}" height="${CELL_H - 28}" preserveAspectRatio="xMidYMid meet" href="${rendered.href}"/>`)
    } else {
      blocks.push(`<text x="${x + 18}" y="${cardY + 42}" font-size="13" fill="#a01818">Render error:</text>`)
      blocks.push(`<foreignObject x="${x + 18}" y="${cardY + 54}" width="${CELL_W - 36}" height="${CELL_H - 70}"><div xmlns="http://www.w3.org/1999/xhtml" style="font:12px monospace;color:#a01818;white-space:pre-wrap">${esc(rendered.error ?? '')}</div></foreignObject>`)
    }
  }
}

const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">${blocks.join('\n')}</svg>`
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, new Resvg(sheet, { fitTo: { mode: 'width', value: W } }).render().asPng())
console.log(`wrote ${out} — ${cases.length} before/after cases`)
