// ============================================================================
// Before/after evidence for the Gantt PR → docs/assets/improvements/gantt-*.png
//
// Same contract as scripts/site/improvements.ts (issue #26 WS12): each image
// is generated from REAL renderer output — the BEFORE column renders at a
// historical git SHA in a temporary worktree, the AFTER column renders from
// the current tree — so the evidence cannot drift from the code. Nothing is
// hand-drawn or hand-captured.
//
// Run: bun run scripts/site/gantt-evidence.ts
//
// Cases (each names its own BEFORE sha, because they demonstrate different
// commits' impact):
//   gantt-family          235ab18 (main, pre-PR)  ascii: header rejected → renders
//   gantt-milestone-clamp 936fe5a (pre-clamp)     svg-crop: diamond protrudes → flush
//   gantt-verify-seam     643492b (pre-bench)     text: verify ok + render throw → named warning
// ============================================================================

import { writeFileSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { Resvg } from '@resvg/resvg-js'
import { renderMermaidASCII } from '../../src/ascii/index.ts'
import { renderMermaidSVG } from '../../src/index.ts'
import { parseMermaid } from '../../src/agent/parse.ts'
import { verifyMermaid } from '../../src/agent/verify.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'assets', 'improvements')

const BASIC = 'gantt\n  title Release plan\n  dateFormat YYYY-MM-DD\n  excludes weekends\n  section Build\n    Core engine :core, 2024-01-01, 10d\n    Polish :pol, after core, 5d\n  section Ship\n    Release :milestone, rel, after pol, 0d'

const REPRESENTATIVE = 'gantt\n  title Adding GANTT diagram functionality to mermaid\n  dateFormat YYYY-MM-DD\n  excludes weekends\n  section A section\n    Completed task :done, des1, 2014-01-06, 2014-01-08\n    Active task :active, des2, 2014-01-09, 3d\n    Future task :des3, after des2, 5d\n  section Critical tasks\n    Crit task :crit, c1, 2014-01-06, 4d\n    Release :milestone, m1, after des3, 0d'

const UNRESOLVABLE = 'gantt\n  dateFormat YYYY-MM-DD\n  excludes weekdays 2019-02-01\n  A :a, 2019-02-04, 3d'

// Render in a worktree at `sha`, with the probe deciding what string comes back.
function probeAt(sha: string, probe: string): string {
  const wt = `/tmp/am-gantt-evidence-${sha}`
  rmSync(wt, { recursive: true, force: true })
  execSync('git worktree prune', { cwd: ROOT })
  execSync(`git worktree add ${wt} ${sha}`, { cwd: ROOT, stdio: 'pipe' })
  try {
    if (!existsSync(join(wt, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(wt, 'node_modules'))
    writeFileSync(join(wt, 'evidence-probe.ts'), probe)
    return execSync(`bun -e "await import('${wt}/evidence-probe.ts')"`, { cwd: wt, encoding: 'utf8', env: { ...process.env, BUN_OPTIONS: '' } }).trim()
  } finally {
    execSync(`git worktree remove ${wt} --force`, { cwd: ROOT, stdio: 'pipe' })
  }
}

const SALMON = { bg: '#FFFBF5', fg: '#521000', muted: '#85532E', surface: '#FFFDFB', border: '#D4B89E', red: '#B3261E', green: '#1E7A46' }
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const mono = (lines: string[], x: number, y: number, size: number, fill: string) =>
  lines.map((l, i) => `<text x="${x}" y="${y + i * size * 1.18}" font-family="DejaVu Sans Mono, monospace" font-size="${size}" fill="${fill}" xml:space="preserve">${esc(l)}</text>`).join('\n')

const fontFiles = [
  join(ROOT, 'assets', 'fonts', 'DejaVuSans.ttf'),
  join(ROOT, 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
  '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
].filter(existsSync)

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

function writePng(file: string, svg: string, width: number): void {
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.min(width * 2, 2200) },
    font: { loadSystemFonts: false, fontFiles, defaultFontFamily: 'DejaVu Sans' },
  }).render().asPng()
  writeFileSync(join(OUT_DIR, file), png)
  console.log(`wrote docs/assets/improvements/${file} (${Math.round(png.length / 1024)} KB)`)
}

function monoPanels(file: string, title: string, caption: string, beforeSha: string, before: string[], after: string[]): void {
  const fontSize = 11
  const lineH = fontSize * 1.18
  const charW = fontSize * 0.602
  const colChars = Math.max(...before.map(l => l.length), ...after.map(l => l.length), 30)
  const colW = Math.ceil(colChars * charW) + 48
  const rows = Math.max(before.length, after.length)
  const panelH = Math.ceil(rows * lineH) + 64
  const W = Math.max(colW * 2 + 36 * 3, Math.ceil(title.length * 22 * 0.58) + 72)
  const captionLines = wrap(caption, W - 72, 13)
  const panelTop = 72 + captionLines.length * 18 + 14
  const H = panelTop + panelH + 46
  const panel = (x: number, label: string, color: string) =>
    `<rect x="${x}" y="${panelTop}" width="${colW}" height="${panelH}" rx="14" fill="${SALMON.surface}" stroke="${SALMON.border}" stroke-width="1.5"/>
     <text x="${x + 18}" y="${panelTop + 26}" font-family="DejaVu Sans" font-size="13" font-weight="bold" fill="${color}" letter-spacing="2">${label}</text>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${SALMON.bg}"/>
    <text x="36" y="44" font-family="DejaVu Sans" font-size="22" font-weight="bold" fill="${SALMON.fg}">${esc(title)}</text>
    ${captionLines.map((l, i) => `<text x="36" y="${72 + i * 18}" font-family="DejaVu Sans" font-size="13" fill="${SALMON.muted}">${esc(l)}</text>`).join('\n')}
    ${panel(36, 'BEFORE (' + beforeSha + ')', SALMON.red)}
    ${mono(before, 36 + 18, panelTop + 54, fontSize, SALMON.fg)}
    ${panel(36 * 2 + colW, 'AFTER', SALMON.green)}
    ${mono(after, 36 * 2 + colW + 18, panelTop + 54, fontSize, SALMON.fg)}
  </svg>`
  writePng(file, svg, W)
}

// Side-by-side zoomed CROPS of two full SVG renders. Each chart is first
// rasterized on its own (resvg cannot nest full SVG documents), then embedded
// as a clipped base64 <image> — so the panels are pixel-true renderer output.
function svgCropPanels(file: string, title: string, caption: string, beforeSha: string, beforeSvg: string, afterSvg: string, crop: { x: number; y: number; w: number; h: number }, scale: number, guides: Array<{ x: number; label: string }> = []): void {
  const rasterize = (svg: string): { b64: string; w: number; h: number } => {
    const m = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/)
    const w = Number(m?.[1] ?? 800)
    const rendered = new Resvg(svg, {
      fitTo: { mode: 'width', value: Math.round(w * scale) },
      font: { loadSystemFonts: false, fontFiles, defaultFontFamily: 'DejaVu Sans' },
    }).render()
    return { b64: Buffer.from(rendered.asPng()).toString('base64'), w: rendered.width, h: rendered.height }
  }

  const panelW = crop.w * scale
  const panelH = crop.h * scale
  const W = Math.max(panelW * 2 + 36 * 3, Math.ceil(title.length * 22 * 0.58) + 72)
  const captionLines = wrap(caption, W - 72, 13)
  const panelTop = 72 + captionLines.length * 18 + 14
  const H = panelTop + 34 + panelH + 46
  const inner = (img: { b64: string; w: number; h: number }, x: number, clipId: string) =>
    `<clipPath id="${clipId}"><rect x="${x}" y="${panelTop + 34}" width="${panelW}" height="${panelH}" rx="6"/></clipPath>
     <g clip-path="url(#${clipId})">
       <rect x="${x}" y="${panelTop + 34}" width="${panelW}" height="${panelH}" fill="#FFFFFF"/>
       <image x="${x - crop.x * scale}" y="${panelTop + 34 - crop.y * scale}" width="${img.w}" height="${img.h}" href="data:image/png;base64,${img.b64}"/>
     </g>
     ${guides.map(g => {
       const gx = x + (g.x - crop.x) * scale
       return `<line x1="${gx}" y1="${panelTop + 34}" x2="${gx}" y2="${panelTop + 34 + panelH}" stroke="${SALMON.red}" stroke-width="2" stroke-dasharray="7 5"/>
        <text x="${gx - 8}" y="${panelTop + 56}" font-family="DejaVu Sans" font-size="13" font-weight="bold" fill="${SALMON.red}" text-anchor="end">${esc(g.label)}</text>`
     }).join('\n')}
     <rect x="${x}" y="${panelTop + 34}" width="${panelW}" height="${panelH}" fill="none" stroke="${SALMON.border}" stroke-width="1.5" rx="6"/>`
  const label = (x: number, text: string, color: string) =>
    `<text x="${x}" y="${panelTop + 22}" font-family="DejaVu Sans" font-size="13" font-weight="bold" fill="${color}" letter-spacing="2">${text}</text>`
  const before = rasterize(beforeSvg)
  const after = rasterize(afterSvg)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${SALMON.bg}"/>
    <text x="36" y="44" font-family="DejaVu Sans" font-size="22" font-weight="bold" fill="${SALMON.fg}">${esc(title)}</text>
    ${captionLines.map((l, i) => `<text x="36" y="${72 + i * 18}" font-family="DejaVu Sans" font-size="13" fill="${SALMON.muted}">${esc(l)}</text>`).join('\n')}
    ${label(36, 'BEFORE (' + beforeSha + ') — zoomed crop', SALMON.red)}
    ${inner(before, 36, 'clip-before')}
    ${label(36 * 2 + panelW, 'AFTER — zoomed crop', SALMON.green)}
    ${inner(after, 36 * 2 + panelW, 'clip-after')}
  </svg>`
  writePng(file, svg, W)
}

mkdirSync(OUT_DIR, { recursive: true })

// ---- Case 1: the family itself (main rejected the header) -------------------
{
  const beforeSha = '235ab18'
  const before = probeAt(beforeSha, `
    const { renderMermaidASCII } = await import('./src/ascii/index.ts')
    try { console.log(renderMermaidASCII(${JSON.stringify(BASIC)}, { useAscii: false })) }
    catch (e) { console.log('render error: ' + e.message) }
  `).split('\n')
  const after = renderMermaidASCII(BASIC).trimEnd().split('\n')
  monoPanels(
    'gantt-family.png',
    'Gantt: a new diagram family',
    'The same Mermaid gantt source. Before (main): the renderer rejects the header outright. After: deterministic terminal output — schedule resolved by the pure UTC scheduler, weekends extending working durations, milestone diamond, dates in the gutter. SVG/PNG render from the same resolved schedule.',
    beforeSha, before, after,
  )
}

// ---- Case 2: milestone clamp (geometry tripwire catch) ----------------------
{
  const beforeSha = '936fe5a'
  const beforeSvg = probeAt(beforeSha, `
    const { renderMermaidSVG } = await import('./src/index.ts')
    console.log(renderMermaidSVG(${JSON.stringify(REPRESENTATIVE)}))
  `)
  const afterSvg = renderMermaidSVG(REPRESENTATIVE)
  svgCropPanels(
    'gantt-milestone-clamp.png',
    'Milestone diamonds stay inside the plot band',
    'An end-of-project milestone rendered its diamond centered ON the plot edge (dashed annotation), protruding past the section band — while the ASCII renderer quietly clamped the same case locally (the per-renderer-hack smell issue #26 names). The clamp now lives in the shared layout; the new GROUP_BREACH geometry tripwire is what caught it.',
    beforeSha, beforeSvg, afterSvg,
    { x: 655, y: 200, w: 95, h: 90 }, 4,
    [{ x: 719, label: 'plot edge (annotation)' }],
  )
}

// ---- Case 3: the verify seam (UNRESOLVABLE_SCHEDULE) -------------------------
{
  const beforeSha = '643492b'
  const before = probeAt(beforeSha, `
    const { parseMermaid } = await import('./src/agent/parse.ts')
    const { verifyMermaid } = await import('./src/agent/verify.ts')
    const { renderMermaidASCII } = await import('./src/ascii/index.ts')
    const src = ${JSON.stringify(UNRESOLVABLE)}
    const d = parseMermaid(src)
    const v = verifyMermaid(d.ok ? d.value : src)
    const lines = ['$ am verify  (excludes weekdays …)', '  verify.ok       = ' + v.ok, '  verify.warnings = ' + JSON.stringify(v.warnings), '', '$ am render --format unicode']
    try { renderMermaidASCII(src); lines.push('  (rendered)') }
    catch (e) { lines.push('  THROWS ' + e.message.split(':')[0] + ' — after verify said ok') }
    console.log(lines.join('\\n'))
  `).split('\n')
  const d = parseMermaid(UNRESOLVABLE)
  const v = verifyMermaid(d.ok ? d.value : UNRESOLVABLE)
  const after = [
    '$ am verify  (excludes weekdays …)',
    `  verify.ok       = ${v.ok}`,
    ...JSON.stringify(v.warnings, null, 1).split('\n').map(l => '  ' + l),
    '',
    'render is no longer a surprise: the failure is named at verify time',
  ]
  monoPanels(
    'gantt-verify-seam.png',
    'UNRESOLVABLE_SCHEDULE closes the verify/render seam',
    "Found by harvesting upstream's own test suite (eval/mermaid-gantt-bench): `excludes weekdays` parses and round-trips, upstream silently ignores it — and our verify said ok while render threw. Verify now flips ok with the named GANTT_* reason before any commit point.",
    beforeSha, before, after,
  )
}

console.log('\nRegenerate with: bun run scripts/site/gantt-evidence.ts')
