/**
 * Causal before/after evidence for the canonical shape-outline authority.
 * Both columns render the same Mermaid source through the public SVG API; the
 * BEFORE column comes from the rebased mainline revision.
 *
 *   bun run scripts/pr-assets/shape-outline-authority-evidence.ts
 *   bun run scripts/pr-assets/shape-outline-authority-evidence.ts --check
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUTPUT = join(ROOT, 'docs', 'pr-assets', 'shape-outline-authority-before-after.png')
const BEFORE_SHA = 'a96b7120fb119f03e7c6e6bdb3c4d582f8b25401'

const CASES = [
  {
    id: 'small-circle',
    title: 'Mermaid v11 small circle',
    note: 'The final arrow endpoint should meet the small painted circle, not its 64px layout box.',
    source: 'flowchart LR\n  A[Source] --> B@{ shape: sm-circ, label: "" }',
    focusNode: 'B',
  },
  {
    id: 'state-pseudostates',
    title: 'State start and end pseudostates',
    note: 'Both shafts should meet the painted 12px outer radius, not the 14px layout-box radius.',
    source: 'stateDiagram-v2\n  direction LR\n  [*] --> Ready\n  Ready --> [*]',
    focusNode: '_end',
  },
] as const

interface CircleGeometry { cx: number; cy: number; r: number }
interface EvidenceMetrics { targetGap: number; sourceGap?: number }

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderBefore(): string[] {
  const worktree = join(tmpdir(), `agentic-mermaid-shape-outline-${Date.now()}`)
  execFileSync('git', ['worktree', 'add', '--detach', worktree, BEFORE_SHA], { cwd: ROOT, stdio: 'pipe' })
  try {
    const modules = join(worktree, 'node_modules')
    if (!existsSync(modules)) symlinkSync(join(ROOT, 'node_modules'), modules, 'dir')
    writeFileSync(join(worktree, 'shape-outline-probe.ts'), `
      import { renderMermaidSVG } from './src/index.ts'
      const sources = ${JSON.stringify(CASES.map(item => item.source))}
      console.log(JSON.stringify(sources.map(source => renderMermaidSVG(source, { embedFontImport: false }))))
    `)
    return JSON.parse(execFileSync('bun', ['shape-outline-probe.ts'], {
      cwd: worktree,
      encoding: 'utf8',
      env: { ...process.env, BUN_OPTIONS: '' },
    }).trim()) as string[]
  } finally {
    execFileSync('git', ['worktree', 'remove', worktree, '--force'], { cwd: ROOT, stdio: 'pipe' })
  }
}

function groupFor(svg: string, nodeId: string): string {
  const match = svg.match(new RegExp(`<g class="node" data-id="${nodeId}"[\\s\\S]*?</g>`))
  if (!match) throw new Error(`node ${nodeId} not found in rendered SVG`)
  return match[0]
}

function circleFor(svg: string, nodeId: string): CircleGeometry {
  const circle = groupFor(svg, nodeId).match(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.-]+)"/)
  if (!circle) throw new Error(`circle for ${nodeId} not found in rendered SVG`)
  return { cx: Number(circle[1]), cy: Number(circle[2]), r: Number(circle[3]) }
}

function edgePoint(svg: string, nodeId: string, endpoint: 'source' | 'target'): { x: number; y: number } {
  const attr = endpoint === 'target' ? 'data-to' : 'data-from'
  const edge = svg.match(new RegExp(`<polyline class="edge"[^>]*${attr}="${nodeId}"[^>]*points="([^"]+)"`))
  if (!edge) throw new Error(`${endpoint} edge for ${nodeId} not found in rendered SVG`)
  const points = edge[1]!.trim().split(/\s+/).map(value => value.split(',').map(Number))
  const point = endpoint === 'target' ? points.at(-1)! : points[0]!
  return { x: point[0]!, y: point[1]! }
}

function metrics(svg: string, caseId: string, targetId: string): EvidenceMetrics {
  const target = circleFor(svg, targetId)
  const targetPoint = edgePoint(svg, targetId, 'target')
  const targetGap = target.cx - target.r - targetPoint.x
  if (caseId !== 'state-pseudostates') return { targetGap }
  const source = circleFor(svg, '_start')
  const sourcePoint = edgePoint(svg, '_start', 'source')
  return { targetGap, sourceGap: sourcePoint.x - (source.cx + source.r) }
}

function zoom(svg: string, circle: CircleGeometry): string {
  const width = 72
  const height = 42
  return svg
    .replace(/width="[^"]+"/, `width="${width}"`)
    .replace(/height="[^"]+"/, `height="${height}"`)
    .replace(/viewBox="[^"]+"/, `viewBox="${circle.cx - 48} ${circle.cy - height / 2} ${width} ${height}"`)
}

function raster(svg: string, width: number): { data: string; width: number; height: number } {
  const image = new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: '#ffffff' }).render()
  return { data: Buffer.from(image.asPng()).toString('base64'), width: image.width, height: image.height }
}

function cell(svg: string, kind: 'BEFORE' | 'AFTER', index: number, x: number, y: number): string {
  const item = CASES[index]!
  const full = raster(svg, 480)
  const focus = circleFor(svg, item.focusNode)
  const detail = raster(zoom(svg, focus), 480)
  const measured = metrics(svg, item.id, item.focusNode)
  const metric = item.id === 'state-pseudostates'
    ? `start gap ${measured.sourceGap!.toFixed(2)}px · end gap ${measured.targetGap.toFixed(2)}px`
    : `paint-to-endpoint gap ${measured.targetGap.toFixed(2)}px`
  const accent = kind === 'BEFORE' ? '#b42318' : '#16794c'
  return `<g transform="translate(${x} ${y})">
    <rect width="550" height="430" rx="14" fill="#fff" stroke="#d0d5dd"/>
    <text x="22" y="31" font-size="14" font-weight="800" fill="${accent}">${kind}</text>
    <text x="100" y="31" font-size="15" font-weight="700" fill="#101828">${esc(item.title)}</text>
    <text x="22" y="54" font-size="11.5" fill="#475467">${esc(metric)}</text>
    <image x="35" y="72" width="480" height="${full.height}" href="data:image/png;base64,${full.data}"/>
    <text x="35" y="${Math.min(260, 82 + full.height)}" font-size="11" font-weight="700" fill="#344054">ENDPOINT DETAIL · ${item.focusNode}</text>
    <image x="35" y="${Math.min(270, 92 + full.height)}" width="480" height="${Math.min(125, detail.height)}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${detail.data}"/>
  </g>`
}

const before = renderBefore()
const after = CASES.map(item => renderMermaidSVG(item.source, { embedFontImport: false }))
const width = 1180
const height = 1100
const rows = CASES.map((item, index) => {
  const y = 138 + index * 480
  return `<text x="34" y="${y - 18}" font-size="12" fill="#475467">${esc(item.note)}</text>
    ${cell(before[index]!, 'BEFORE', index, 34, y)}
    ${cell(after[index]!, 'AFTER', index, 596, y)}`
}).join('\n')
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, Arial, sans-serif">
  <rect width="${width}" height="${height}" fill="#f2f4f7"/>
  <text x="34" y="42" font-size="24" font-weight="800" fill="#101828">Canonical shape outline — final rendered endpoints</text>
  <text x="34" y="70" font-size="13" fill="#475467">Same Mermaid source through the public renderer at main ${BEFORE_SHA.slice(0, 8)} and this branch.</text>
  <text x="34" y="92" font-size="13" fill="#475467">Gap is measured from SVG paint geometry and the settled route endpoint; zero means the shaft meets the outline.</text>
  ${rows}
</svg>`
const output = new Resvg(sheet, { fitTo: { mode: 'width', value: width * 2 } }).render().asPng()

if (process.argv.includes('--check')) {
  if (!existsSync(OUTPUT) || !Buffer.from(output).equals(readFileSync(OUTPUT))) {
    throw new Error('Shape-outline visual evidence is stale; regenerate it without --check')
  }
  console.log('shape-outline visual evidence is fresh')
} else {
  mkdirSync(join(ROOT, 'docs', 'pr-assets'), { recursive: true })
  writeFileSync(OUTPUT, output)
  console.log('wrote docs/pr-assets/shape-outline-authority-before-after.png')
  for (const [index, item] of CASES.entries()) {
    console.log(`${item.id}: before=${JSON.stringify(metrics(before[index]!, item.id, item.focusNode))} after=${JSON.stringify(metrics(after[index]!, item.id, item.focusNode))}`)
  }
}
