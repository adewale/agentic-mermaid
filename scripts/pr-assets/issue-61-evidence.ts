/**
 * Render the issue #61 mixed fan-in/fan-out hub centering evidence by comparing
 * a base worktree (the fix's parent) against the current branch. Same Mermaid
 * source rendered through both `renderMermaidSVG` entrypoints, stacked so GitHub
 * does not shrink each side to half-width.
 *
 * The hub shift is only a few pixels, so each panel overlays the computed
 * barycenter guide lines (parsed from the rendered SVG's node rects, not hand
 * placed): blue = incoming barycenter, orange = outgoing barycenter, green =
 * hub center. BEFORE sits the hub at the in/out midpoint (~half the gap off each
 * side); AFTER centers it on both by rigidly shifting the terminal out-group
 * onto the incoming barycenter, keeping the fan-out's shared trunk intact.
 *
 *   bun run scripts/pr-assets/issue-61-evidence.ts
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'pr-assets')
// Parent of the fix commit — isolates exactly this PR's centering change.
const BEFORE_SHA = 'a86a17ab873fbb749fbf88990f30ca158429f989'

const SOURCE = `flowchart TD
  I0[In 0] --> H[Hub]
  I1[In 1] --> H[Hub]
  I2[In 2] --> H[Hub]
  I3[In 3] --> H[Hub]
  H --> O0[Out 0]
  H --> O1[Out 1]
  H --> O2[Out 2]
  H --> O3[Out 3]
  H --> O4[Out 4]
  H --> O5[Out 5]`

const IN_IDS = ['I0', 'I1', 'I2', 'I3']
const OUT_IDS = ['O0', 'O1', 'O2', 'O3', 'O4', 'O5']

const FONT_FILES = [
  join(ROOT, 'assets', 'fonts', 'DejaVuSans.ttf'),
  join(ROOT, 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
].filter(existsSync)

const SHEET_BG = '#f8fafc'
const CARD_BG = '#ffffff'
const CARD_STROKE = '#d1d5db'
const TEXT = '#111827'
const TEXT_MUTED = '#4b5563'
const IN_COLOR = '#2563eb'
const OUT_COLOR = '#ea580c'
const HUB_COLOR = '#16a34a'

interface Raster { b64: string; width: number; height: number }

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderSvgAtSha(sha: string): string {
  const wt = join(tmpdir(), `beautiful-mermaid-issue61-${sha.slice(0, 7)}-${Date.now()}`)
  rmSync(wt, { recursive: true, force: true })
  execFileSync('git', ['worktree', 'add', '--detach', wt, sha], { cwd: ROOT, stdio: 'pipe' })
  try {
    const modules = join(wt, 'node_modules')
    if (!existsSync(modules)) symlinkSync(join(ROOT, 'node_modules'), modules, 'dir')
    writeFileSync(join(wt, 'issue-61-probe.ts'), `
      import { renderMermaidSVG } from './src/index.ts'
      console.log(renderMermaidSVG(${JSON.stringify(SOURCE)}, { embedFontImport: false }))
    `)
    return execFileSync('bun', ['issue-61-probe.ts'], {
      cwd: wt,
      encoding: 'utf8',
      env: { ...process.env, BUN_OPTIONS: '' },
    }).trim()
  } finally {
    execFileSync('git', ['worktree', 'remove', wt, '--force'], { cwd: ROOT, stdio: 'pipe' })
  }
}

function svgSize(svg: string): { width: number; height: number } {
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  if (vb) return { width: Number(vb[1]), height: Number(vb[2]) }
  return { width: 800, height: 600 }
}

/** Cross-axis (x) center of a node, read from its rendered SVG rect. */
function nodeCenterX(svg: string, id: string): number {
  const group = svg.match(new RegExp(`<g class="node" data-id="${id}"[\\s\\S]*?</g>`))
  if (!group) throw new Error(`node ${id} not found in SVG`)
  const rect = group[0].match(/<rect[^>]* x="([\d.-]+)"[^>]* width="([\d.-]+)"/)
  if (!rect) throw new Error(`rect for node ${id} not found`)
  return Number(rect[1]) + Number(rect[2]) / 2
}

function barycenters(svg: string): { inB: number; outB: number; hub: number } {
  const avg = (ids: string[]) => ids.reduce((s, id) => s + nodeCenterX(svg, id), 0) / ids.length
  return { inB: avg(IN_IDS), outB: avg(OUT_IDS), hub: nodeCenterX(svg, 'H') }
}

function rasterize(svg: string, width: number): Raster {
  const rendered = new Resvg(svg.replace(/<\?xml[^>]*\?>/, ''), {
    fitTo: { mode: 'width', value: Math.round(width) },
    background: CARD_BG,
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'DejaVu Sans' },
  }).render()
  return { b64: Buffer.from(rendered.asPng()).toString('base64'), width: rendered.width, height: rendered.height }
}

const W = 1180
const PAD = 32
const PANEL_W = W - PAD * 2

function panel(svg: string, label: string, sub: string, x: number, y: number): { markup: string; height: number } {
  const size = svgSize(svg)
  const img = rasterize(svg, PANEL_W - 36)
  const scale = img.width / size.width
  const imgX = x + 18
  const imgY = y + 30
  const cardH = img.height + 48
  const { inB, outB, hub } = barycenters(svg)
  const lineX = (cx: number) => imgX + cx * scale
  const guide = (cx: number, color: string, dash: string) =>
    `<line x1="${lineX(cx).toFixed(1)}" y1="${imgY}" x2="${lineX(cx).toFixed(1)}" y2="${imgY + img.height}" stroke="${color}" stroke-width="1.4" stroke-dasharray="${dash}"/>`
  const dIn = Math.abs(hub - inB), dOut = Math.abs(hub - outB)
  const markup = `
    <rect x="${x}" y="${y}" width="${PANEL_W}" height="${cardH}" rx="12" fill="${CARD_BG}" stroke="${CARD_STROKE}"/>
    <text x="${x + 18}" y="${y + 20}" font-size="14" font-weight="700" fill="${label.startsWith('BEFORE') ? '#991b1b' : '#1f6f43'}">${esc(label)}</text>
    <text x="${x + 110}" y="${y + 20}" font-size="12" fill="${TEXT_MUTED}">${esc(sub)}</text>
    <image x="${imgX}" y="${imgY}" width="${img.width}" height="${img.height}" href="data:image/png;base64,${img.b64}"/>
    ${guide(inB, IN_COLOR, '5 3')}
    ${guide(outB, OUT_COLOR, '5 3')}
    ${guide(hub, HUB_COLOR, '0')}
    <text x="${x + 18}" y="${y + cardH - 12}" font-size="12" font-family="monospace" fill="${TEXT}"><tspan fill="${HUB_COLOR}">hub</tspan> to <tspan fill="${IN_COLOR}">in-bary</tspan> ${dIn.toFixed(2)}px, to <tspan fill="${OUT_COLOR}">out-bary</tspan> ${dOut.toFixed(2)}px — worst ${Math.max(dIn, dOut).toFixed(2)}px</text>`
  return { markup, height: cardH }
}

const beforeSvg = renderSvgAtSha(BEFORE_SHA)
const afterSvg = renderMermaidSVG(SOURCE, { embedFontImport: false })

const headerH = 96
const before = panel(beforeSvg, 'BEFORE', `main ${BEFORE_SHA.slice(0, 7)} — midpoint floor`, PAD, headerH)
const gap = 24
const afterY = headerH + before.height + gap
const after = panel(afterSvg, 'AFTER', 'this branch — centered, shared trunk preserved', PAD, afterY)
const totalH = afterY + after.height + PAD

const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}" font-family="DejaVu Sans, Inter, system-ui, sans-serif">
  <rect width="${W}" height="${totalH}" fill="${SHEET_BG}"/>
  <text x="${PAD}" y="36" font-size="20" font-weight="800" fill="${TEXT}">Issue #61 — mixed fan-in/fan-out hub centering</text>
  <text x="${PAD}" y="60" font-size="13" fill="${TEXT_MUTED}">Same Mermaid source through both renderMermaidSVG entrypoints. Guide lines computed from the rendered node rects, not hand placed.</text>
  <text x="${PAD}" y="80" font-size="13" fill="${TEXT_MUTED}"><tspan fill="${HUB_COLOR}">green</tspan> = hub center, <tspan fill="${IN_COLOR}">blue</tspan> = incoming barycenter, <tspan fill="${OUT_COLOR}">orange</tspan> = outgoing barycenter.</text>
  ${before.markup}
  ${after.markup}
</svg>`

mkdirSync(OUT_DIR, { recursive: true })
const out = join(OUT_DIR, 'issue-61-mixed-hub-centering-before-after.png')
writeFileSync(out, new Resvg(sheet, { fitTo: { mode: 'width', value: W * 2 } }).render().asPng())
console.log(`wrote docs/pr-assets/issue-61-mixed-hub-centering-before-after.png`)
console.log(`before: ${JSON.stringify(barycenters(beforeSvg))}`)
console.log(`after:  ${JSON.stringify(barycenters(afterSvg))}`)
