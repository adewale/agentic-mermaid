import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidSVG } from '../../src/index.ts'
import { THEMES } from '../../src/theme.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'pr-assets')
const BEFORE_SHA = '90187229c31fb65729d92be24edc66bed5e7a412'

const SOURCE = `flowchart TD
  subgraph product [Product Loop]
    A[Capture request] --> B{Ready?}
    B -->|yes| C[Ship]
    B -.->|needs work| D[Refine]
  end`

const OPTIONS = {
  style: 'publication-figure',
  seed: 3,
}

const COLORS = THEMES.salmon!
const FONT_FILES = [
  join(ROOT, 'assets', 'fonts', 'DejaVuSans.ttf'),
  join(ROOT, 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
].filter(existsSync)

interface SvgSize { width: number; height: number }
interface Rect { x: number; y: number; width: number; height: number }
interface Raster { b64: string; width: number; height: number }

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderCurrentSvg(): string {
  return renderMermaidSVG(SOURCE, { ...COLORS, ...OPTIONS, embedFontImport: false })
}

function renderSvgAtSha(sha: string): string {
  const wt = join(tmpdir(), `beautiful-mermaid-issue38-${sha.slice(0, 7)}-${Date.now()}`)
  rmSync(wt, { recursive: true, force: true })
  execFileSync('git', ['worktree', 'add', '--detach', wt, sha], { cwd: ROOT, stdio: 'pipe' })
  try {
    const modules = join(wt, 'node_modules')
    if (!existsSync(modules)) symlinkSync(join(ROOT, 'node_modules'), modules, 'dir')
    writeFileSync(join(wt, 'issue-38-probe.ts'), `
      import { renderMermaidSVG } from './src/index.ts'
      import { THEMES } from './src/theme.ts'
      const source = ${JSON.stringify(SOURCE)}
      const options = ${JSON.stringify(OPTIONS)}
      console.log(renderMermaidSVG(source, { ...THEMES.salmon, ...options, embedFontImport: false }))
    `)
    return execFileSync('bun', ['issue-38-probe.ts'], {
      cwd: wt,
      encoding: 'utf8',
      env: { ...process.env, BUN_OPTIONS: '' },
    }).trim()
  } finally {
    execFileSync('git', ['worktree', 'remove', wt, '--force'], { cwd: ROOT, stdio: 'pipe' })
  }
}

function svgSize(svg: string): SvgSize {
  const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  if (viewBox) return { width: Number(viewBox[1]), height: Number(viewBox[2]) }
  const width = svg.match(/width="([\d.]+)"/)
  const height = svg.match(/height="([\d.]+)"/)
  return { width: Number(width?.[1] ?? 800), height: Number(height?.[1] ?? 600) }
}

function renderPng(svg: string, width: number): Uint8Array {
  return new Uint8Array(new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: COLORS.bg,
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'DejaVu Sans' },
  }).render().asPng())
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

function rasterizeAtScale(svg: string, scale: number): Raster {
  const size = svgSize(svg)
  return rasterize(svg, Math.round(size.width * scale))
}

function writeComposite(file: string, svg: string): void {
  const size = svgSize(svg)
  const png = renderPng(svg, Math.round(size.width))
  writeFileSync(join(OUT_DIR, file), png)
  console.log(`wrote docs/pr-assets/${file} (${Math.round(png.byteLength / 1024)} KB)`)
}

function label(text: string, x: number, y: number, color: string): string {
  return `<text x="${x}" y="${y}" font-family="DejaVu Sans" font-size="28" font-weight="700" letter-spacing="2" fill="${color}">${esc(text)}</text>`
}

function fullBeforeAfter(beforeSvg: string, afterSvg: string): string {
  const panelWidth = 1200
  const gutter = 72
  const top = 190
  const imageTop = 250
  const before = rasterize(beforeSvg, panelWidth)
  const after = rasterize(afterSvg, panelWidth)
  const panelHeight = Math.max(before.height, after.height)
  const width = panelWidth * 2 + gutter * 3
  const height = imageTop + panelHeight + 78
  const panel = (img: Raster, x: number) => `
    <rect x="${x - 18}" y="${imageTop - 18}" width="${panelWidth + 36}" height="${panelHeight + 36}" rx="18" fill="${COLORS.surface}" stroke="${COLORS.border}" stroke-width="2"/>
    <image x="${x}" y="${imageTop}" width="${img.width}" height="${img.height}" href="data:image/png;base64,${img.b64}"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${COLORS.bg}"/>
    <text x="${gutter}" y="70" font-family="DejaVu Sans" font-size="44" font-weight="700" fill="${COLORS.fg}">Issue #38 decision branch labels</text>
    <text x="${gutter}" y="116" font-family="DejaVu Sans" font-size="24" fill="${COLORS.muted}">Left: main before. Right: symmetric label ports with style-readable label exits.</text>
    <text x="${gutter}" y="154" font-family="DejaVu Sans" font-size="20" fill="${COLORS.muted}">Rendered at high resolution from real SVG output; not hand-captured.</text>
    ${label('BEFORE', gutter, top, '#9A3412')}
    ${label('AFTER', gutter * 2 + panelWidth, top, '#15803D')}
    ${panel(before, gutter)}
    ${panel(after, gutter * 2 + panelWidth)}
  </svg>`
}

function expand(rect: Rect, amount: number): Rect {
  return { x: rect.x - amount, y: rect.y - amount, width: rect.width + amount * 2, height: rect.height + amount * 2 }
}

function union(rects: Rect[]): Rect {
  const left = Math.min(...rects.map(r => r.x))
  const top = Math.min(...rects.map(r => r.y))
  const right = Math.max(...rects.map(r => r.x + r.width))
  const bottom = Math.max(...rects.map(r => r.y + r.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function focusBox(svg: string): Rect {
  const rects: Rect[] = []
  for (const node of svg.matchAll(/<g class="node" data-id="([BCD])"[\s\S]*?<\/g>/g)) {
    const body = node[0]
    const rect = body.match(/<rect[^>]* x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/)
    if (rect) {
      rects.push({ x: Number(rect[1]), y: Number(rect[2]), width: Number(rect[3]), height: Number(rect[4]) })
      continue
    }
    const polygon = body.match(/<polygon points="([^"]+)"/)
    if (polygon) {
      const points = polygon[1]!.trim().split(/\s+/).flatMap(pair => {
        const coords = pair.split(',').map(Number)
        const x = coords[0]
        const y = coords[1]
        return Number.isFinite(x) && Number.isFinite(y) ? [{ x: x!, y: y! }] : []
      })
      rects.push(union(points.map(point => ({ x: point.x, y: point.y, width: 0, height: 0 }))))
    }
  }
  for (const match of svg.matchAll(/<rect class="edge-label-halo" x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/g)) {
    rects.push({ x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]) })
  }
  return expand(union(rects), 34)
}

function cropFor(svg: string, panelWidth: number, panelHeight: number): Rect {
  const size = svgSize(svg)
  const focus = focusBox(svg)
  const aspect = panelWidth / panelHeight
  let width = Math.max(focus.width, 190)
  let height = Math.max(focus.height + 70, 235)
  if (width / height > aspect) height = width / aspect
  else width = height * aspect
  const cx = focus.x + focus.width / 2
  const cy = focus.y + focus.height / 2 + 18
  const x = Math.max(0, Math.min(size.width - width, cx - width / 2))
  const y = Math.max(0, Math.min(size.height - height, cy - height / 2))
  return { x, y, width, height }
}

function zoomBeforeAfter(beforeSvg: string, afterSvg: string): string {
  const panelWidth = 1160
  const panelHeight = 880
  const gutter = 72
  const imageTop = 250
  const width = panelWidth * 2 + gutter * 3
  const height = imageTop + panelHeight + 78
  const beforeCrop = cropFor(beforeSvg, panelWidth, panelHeight)
  const afterCrop = cropFor(afterSvg, panelWidth, panelHeight)
  const beforeScale = panelWidth / beforeCrop.width
  const afterScale = panelWidth / afterCrop.width
  const before = rasterizeAtScale(beforeSvg, beforeScale)
  const after = rasterizeAtScale(afterSvg, afterScale)
  const panel = (img: Raster, crop: Rect, scale: number, x: number, id: string) => `
    <clipPath id="${id}"><rect x="${x}" y="${imageTop}" width="${panelWidth}" height="${panelHeight}" rx="14"/></clipPath>
    <rect x="${x - 18}" y="${imageTop - 18}" width="${panelWidth + 36}" height="${panelHeight + 36}" rx="18" fill="${COLORS.surface}" stroke="${COLORS.border}" stroke-width="2"/>
    <g clip-path="url(#${id})">
      <rect x="${x}" y="${imageTop}" width="${panelWidth}" height="${panelHeight}" fill="${COLORS.bg}"/>
      <image x="${x - crop.x * scale}" y="${imageTop - crop.y * scale}" width="${img.width}" height="${img.height}" href="data:image/png;base64,${img.b64}"/>
    </g>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${COLORS.bg}"/>
    <text x="${gutter}" y="70" font-family="DejaVu Sans" font-size="44" font-weight="700" fill="${COLORS.fg}">Issue #38 label clearance zoom</text>
    <text x="${gutter}" y="116" font-family="DejaVu Sans" font-size="24" fill="${COLORS.muted}">Zoomed around the Ready? diamond and outgoing branch labels.</text>
    <text x="${gutter}" y="154" font-family="DejaVu Sans" font-size="20" fill="${COLORS.muted}">The after panel leaves enough post-label dashed stroke to read the edge style.</text>
    ${label('BEFORE', gutter, 202, '#9A3412')}
    ${label('AFTER', gutter * 2 + panelWidth, 202, '#15803D')}
    ${panel(before, beforeCrop, beforeScale, gutter, 'before-crop')}
    ${panel(after, afterCrop, afterScale, gutter * 2 + panelWidth, 'after-crop')}
  </svg>`
}

mkdirSync(OUT_DIR, { recursive: true })

const beforeSvg = renderSvgAtSha(BEFORE_SHA)
const afterSvg = renderCurrentSvg()

writeFileSync(join(OUT_DIR, 'issue-38-decision-branch-overlap-before.png'), renderPng(beforeSvg, 1600))
writeFileSync(join(OUT_DIR, 'issue-38-decision-branch-overlap-after.png'), renderPng(afterSvg, 1600))
writeComposite('issue-38-decision-branch-overlap-before-after.png', fullBeforeAfter(beforeSvg, afterSvg))
writeComposite('issue-38-decision-branch-overlap-zoom.png', zoomBeforeAfter(beforeSvg, afterSvg))
