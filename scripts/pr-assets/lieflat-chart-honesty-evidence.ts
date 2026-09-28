/**
 * Before/after evidence for the Lieflat chart-honesty fixes
 * (research/lieflat-charts-learnings.md, issues 1–10).
 *
 * Renders the same named inputs through the production renderer at BEFORE_SHA
 * (a detached worktree) and at the current tree. Single diagrams are
 * rasterized with resvg and the bundled fonts. The page-isolation case
 * (issue 2) is a Chromium capture of real inline SVG, because that defect only
 * exists when two diagrams share one document; every other panel is rendered
 * alone for the same reason. Issues 6, 8, and 10 change what verify reports,
 * not pixels, so their panels print the warnings at each revision.
 *
 *   bun run scripts/pr-assets/lieflat-chart-honesty-evidence.ts
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { chromium, type Page } from 'playwright'
import sharp from 'sharp'
import { wcagContrastRatio } from '../../src/shared/color-math.ts'
import { deltaEOK, minPairwiseDeltaEOK } from '../../src/shared/perceptual-color.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'pr-assets')
const BEFORE_SHA = 'c349dacefaa928453ca27ade8de0341e30b7d8cd'
const FONT_DIR = join(ROOT, 'assets', 'fonts')

const labelled = (yaml: string, body: string): string => `---\nconfig:\n  xyChart:\n${yaml}\n---\n${body}`

/** Named inputs; each is rendered unchanged at both revisions. */
const SOURCES = {
  signedBars: 'xychart-beta\n  title "Net change by quarter"\n  x-axis [Q1, Q2, Q3, Q4]\n  bar [-10, 20, -5, 25]',
  autoRange: 'xychart-beta\n  title "Requests (thousands)"\n  x-axis [Mon, Tue, Wed]\n  bar [120, 130, 140]',
  // salmon: the built-in style with the smallest six-series separation at BEFORE_SHA.
  sixSeries: `xychart-beta\n  title "Six series"\n  x-axis [A, B, C, D]\n  y-axis 0 --> 100\n${Array.from({ length: 6 }, (_unused, index) =>
    `  line "S${index + 1}" [${[10 + index * 12, 20 + index * 11, 15 + index * 13, 30 + index * 10].join(', ')}]`).join('\n')}`,
  shortBar: labelled('    showDataLabel: true', 'xychart-beta\n  title "One short bar"\n  x-axis [North, South, East, West]\n  y-axis 0 --> 100\n  bar [60, 80, 2, 70]'),
  labelInk: labelled('    showDataLabel: true', 'xychart-beta\n  title "Plan vs actual"\n  x-axis [North, South, East, West]\n  y-axis 0 --> 100\n  bar "Plan" [62, 81, 47, 74]\n  bar "Actual" [58, 88, 52, 69]\n  bar "Forecast" [70, 76, 60, 80]'),
  untitled: 'xychart-beta\n  x-axis [a, b, c]\n  y-axis 0 --> 100\n  bar [10, 50, 100]',
  untitledHorizontal: 'xychart-beta horizontal\n  x-axis [a, b, c]\n  y-axis 0 --> 100\n  bar [10, 50, 100]',
  dense: `xychart-beta\n  title "Regional sales"\n  x-axis [${['North region', 'South region', 'East region', 'West region', 'Central region', 'Coastal region', 'Mountain region', 'Desert region', 'Island region', 'Border region'].map(name => `"${name}"`).join(', ')}]\n  bar [12, 18, 9, 22, 15, 11, 7, 5, 3, 8]`,
  truncated: 'xychart-beta\n  title "Satisfaction"\n  x-axis [Q1, Q2, Q3]\n  y-axis 90 --> 100\n  bar [92, 95, 97]',
  officialKeys: labelled('    showDataLabelOutsideBar: true\n    xAxis:\n      labelRotation: 45', 'xychart-beta\n  x-axis [a, b]\n  bar [3, 5]'),
} as const
type SourceId = keyof typeof SOURCES

interface RenderJob { id: string; source: SourceId; style?: string; idPrefix?: string }

const RENDERS: readonly RenderJob[] = [
  { id: 'signedBars', source: 'signedBars' },
  { id: 'autoRange', source: 'autoRange' },
  { id: 'sixSeries', source: 'sixSeries', style: 'salmon' },
  { id: 'shortBar', source: 'shortBar' },
  { id: 'labelInk', source: 'labelInk' },
  { id: 'untitled', source: 'untitled' },
  { id: 'untitledHorizontal', source: 'untitledHorizontal' },
  { id: 'dense', source: 'dense' },
  { id: 'truncated', source: 'truncated' },
  // Issue 2: two xycharts that share one page. idPrefix keeps DOM ids apart at
  // both revisions, so only style rules can leak.
  { id: 'pageA', source: 'labelInk', style: 'github-light', idPrefix: 'a-' },
  { id: 'pageB', source: 'labelInk', style: 'dracula', idPrefix: 'b-' },
]
const VERIFIED: readonly SourceId[] = ['dense', 'truncated', 'officialKeys']

interface RevisionOutput { svgs: Record<string, string>; warnings: Record<string, string[]> }

/** One probe runs unchanged against either checkout, through its public API. */
function probeSource(root: string): string {
  return `
    import { renderMermaidSVG } from ${JSON.stringify(join(root, 'src', 'index.ts'))}
    import { verifyMermaid } from ${JSON.stringify(join(root, 'src', 'agent', 'index.ts'))}
    const sources = ${JSON.stringify(SOURCES)}
    const renders = ${JSON.stringify(RENDERS)}
    const verified = ${JSON.stringify(VERIFIED)}
    const svgs = Object.fromEntries(renders.map(job => [job.id, renderMermaidSVG(sources[job.source], {
      embedFontImport: false,
      ...(job.style ? { style: job.style } : {}),
      ...(job.idPrefix ? { idPrefix: job.idPrefix } : {}),
    })]))
    const warnings = Object.fromEntries(verified.map(id => [id, verifyMermaid(sources[id]).warnings
      .map(warning => warning.code + ': ' + ('message' in warning ? warning.message : JSON.stringify(warning)))]))
    console.log(JSON.stringify({ svgs, warnings }))
  `
}

function runProbe(root: string): RevisionOutput {
  const probe = join(tmpdir(), `lieflat-evidence-probe-${process.pid}-${Date.now()}.ts`)
  writeFileSync(probe, probeSource(root))
  try {
    return JSON.parse(execFileSync('bun', [probe], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, BUN_OPTIONS: '' },
    }).trim()) as RevisionOutput
  } finally {
    rmSync(probe, { force: true })
  }
}

function renderBefore(): RevisionOutput {
  const worktree = join(tmpdir(), `agentic-mermaid-lieflat-${Date.now()}`)
  rmSync(worktree, { recursive: true, force: true })
  execFileSync('git', ['worktree', 'add', '--detach', worktree, BEFORE_SHA], { cwd: ROOT, stdio: 'pipe' })
  try {
    const modules = join(worktree, 'node_modules')
    if (!existsSync(modules)) symlinkSync(join(ROOT, 'node_modules'), modules, 'dir')
    return runProbe(worktree)
  } finally {
    execFileSync('git', ['worktree', 'remove', worktree, '--force'], { cwd: ROOT, stdio: 'pipe' })
  }
}

// ---- measurements (written against the SVG, independent of the renderer) ----

function background(svg: string): string {
  return svg.match(/<svg\b[^>]*style="[^"]*background:(#[0-9a-fA-F]{6})/)?.[1] ?? '#ffffff'
}

function viewBox(svg: string): { width: number; height: number } {
  const [, , width, height] = svg.match(/viewBox="([^"]+)"/)![1]!.split(/\s+/).map(Number)
  return { width: width!, height: height! }
}

function seriesColors(svg: string): string[] {
  return [...svg.matchAll(/--xychart-color-\d+:\s*(#[0-9a-fA-F]{6})/g)].map(match => match[1]!)
}

/** The two series whose colors are closest, as swatches for the panel. */
function closestPair(colors: string[]): Array<{ label: string; color: string }> {
  let best: [number, number] = [0, 1]
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      if (deltaEOK(colors[i]!, colors[j]!)! < deltaEOK(colors[best[0]]!, colors[best[1]]!)!) best = [i, j]
    }
  }
  return best.map(index => ({ label: `S${index + 1} ${colors[index]!}`, color: colors[index]! }))
}

interface Bar { x: number; y: number; width: number; height: number; color: string; value: number }

function bars(svg: string): Bar[] {
  const colors = seriesColors(svg)
  return [...svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" class="xychart-bar xychart-color-(\d+)" data-value="([^"]+)"/g)]
    .map(match => ({ x: +match[1]!, y: +match[2]!, width: +match[3]!, height: +match[4]!, color: colors[+match[5]!]!, value: +match[6]! }))
}

/** Lowest WCAG ratio between a data label's ink and the bar it sits on. The
 * base revision painted labels through a class rule, the head through a fill
 * attribute; both are read from the SVG. */
function minimumLabelContrast(svg: string): number | undefined {
  const classInk = svg.match(/\.xychart-data-label\s*\{\s*fill:\s*([^;]+);/)?.[1]?.trim()
  const ratios = [...svg.matchAll(/<text\b([^>]*)class="xychart-data-label"[^>]*>/g)].flatMap(match => {
    const attributes = match[1]!
    const x = +attributes.match(/\bx="([^"]+)"/)![1]!
    const y = +attributes.match(/\by="([^"]+)"/)![1]!
    const ink = attributes.match(/\bfill="([^"]+)"/)?.[1] ?? classInk
    const under = bars(svg).find(bar => x >= bar.x && x <= bar.x + bar.width && y >= bar.y && y <= bar.y + bar.height)
    return ink && under ? [wcagContrastRatio(ink, under.color)!] : []
  })
  return ratios.length ? Math.min(...ratios) : undefined
}

/** Drawn height of the tallest bar over the shortest, for proportionality. */
function heightRatio(svg: string): number {
  const heights = bars(svg).map(bar => bar.height)
  return Math.max(...heights) / Math.min(...heights)
}

function dataLabelCount(svg: string): number {
  return (svg.match(/<text\b[^>]*class="xychart-data-label"[^>]*>[^<]+<\/text>/g) ?? []).length
}

function yAxisLabels(svg: string): number[] {
  return [...svg.matchAll(/<text\b[^>]*class="xychart-label xychart-y-label"[^>]*>([^<]*)<\/text>/g)].map(match => Number(match[1]))
}

/** Glyph ink beyond each canvas edge, measured by resvg on the text alone. */
function textOverflow(svg: string): { top: number; right: number } {
  const textOnly = svg.replace(/<(rect|line|path|circle|polyline|polygon|ellipse)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g, '')
  const box = new Resvg(textOnly, resvgOptions(1)).getBBox()
  const { width } = viewBox(svg)
  return box ? { top: Math.max(0, -box.y), right: Math.max(0, box.x + box.width - width) } : { top: 0, right: 0 }
}

function resvgOptions(zoom: number, bg?: string) {
  return {
    fitTo: { mode: 'zoom' as const, value: zoom },
    ...(bg ? { background: bg } : {}),
    font: { loadSystemFonts: false, fontDirs: [FONT_DIR], defaultFontFamily: 'Inter' },
  }
}

function rasterize(svg: string, zoom = 1): Buffer {
  return Buffer.from(new Resvg(svg, resvgOptions(zoom, background(svg))).render().asPng())
}

async function crop(svg: string, zoom: number, box: { left: number; top: number; width: number; height: number }): Promise<Buffer> {
  return sharp(rasterize(svg, zoom)).extract({
    left: Math.round(box.left * zoom), top: Math.round(box.top * zoom),
    width: Math.round(box.width * zoom), height: Math.round(box.height * zoom),
  }).png().toBuffer()
}

// ---- page isolation (issue 2) ----

const PAINT = ['fill', 'stroke', 'opacity', 'fill-opacity', 'font-family', 'font-size', 'visibility', 'display']

async function paints(page: Page, html: string): Promise<string[]> {
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${html}</body></html>`)
  return page.evaluate(properties => {
    const root = document.getElementById('a')!.querySelector('svg')!
    return [root, ...root.querySelectorAll('*')].map(element => {
      const style = getComputedStyle(element)
      return `${element.tagName}|${properties.map(name => style.getPropertyValue(name)).join('|')}`
    })
  }, PAINT)
}

async function capturePair(page: Page, output: RevisionOutput): Promise<{ alone: Buffer; beside: Buffer; repainted: number; total: number }> {
  const a = `<div id="a" style="display:inline-block">${output.svgs.pageA}</div>`
  const b = `<div id="b" style="display:inline-block">${output.svgs.pageB}</div>`
  const alonePaint = await paints(page, a)
  const alone = await page.locator('#a').screenshot({ animations: 'disabled' })
  const besidePaint = await paints(page, a + b)
  const beside = await page.locator('#a').screenshot({ animations: 'disabled' })
  const repainted = alonePaint.filter((paint, index) => paint !== besidePaint[index]).length
  return { alone: Buffer.from(alone), beside: Buffer.from(beside), repainted, total: alonePaint.length }
}

// ---- sheet ----

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const png = (buffer: Buffer): string => `data:image/png;base64,${buffer.toString('base64')}`

interface Panel { image?: Buffer; images?: Array<{ caption: string; image: Buffer }>; lines?: string[]; swatches?: Array<{ label: string; color: string }>; metric: string }
interface Row { issue: string; title: string; claim: string; before: Panel; after: Panel; inspect: string }

function panelHtml(kind: 'before' | 'after', panel: Panel): string {
  const body = panel.images
    ? `<div class="pair">${panel.images.map(item => `<figure><img src="${png(item.image)}" alt=""><figcaption>${esc(item.caption)}</figcaption></figure>`).join('')}</div>`
    : panel.image
      ? `<div class="canvas"><img src="${png(panel.image)}" alt=""></div>`
      : `<pre>${esc((panel.lines ?? []).join('\n') || '(no warnings)')}</pre>`
  const swatches = panel.swatches
    ? `<div class="swatches">${panel.swatches.map(swatch => `<span><i style="background:${swatch.color}"></i>${esc(swatch.label)}</span>`).join('')}</div>`
    : ''
  return `<div class="panel ${kind}"><div class="tag">${kind === 'before' ? `Before · ${BEFORE_SHA.slice(0, 7)}` : `After · ${HEAD_SHA.slice(0, 7)}`}</div>${body}${swatches}<p class="metric">${esc(panel.metric)}</p></div>`
}

function rowHtml(row: Row): string {
  return `<section class="row">
    <header><span class="issue">${esc(row.issue)}</span><h2>${esc(row.title)}</h2><p>${esc(row.claim)}</p></header>
    <div class="panels">${panelHtml('before', row.before)}${panelHtml('after', row.after)}</div>
    <p class="inspect"><b>Inspect:</b> ${esc(row.inspect)}</p>
  </section>`
}

function sheetHtml(rows: readonly Row[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; background: #e4e4e7; color: #18181b; font-family: Inter, -apple-system, "Segoe UI", sans-serif; }
    main { width: 1600px; padding: 28px; }
    main > h1 { margin: 0 0 6px; font-size: 30px; }
    main > p { margin: 0 0 22px; color: #52525b; font-size: 16px; }
    .row { margin: 0 0 18px; padding: 18px 20px; border-radius: 14px; background: #fff; border: 1px solid #d4d4d8; }
    .row header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
    .issue { padding: 2px 9px; border-radius: 999px; background: #18181b; color: #fff; font-size: 13px; font-weight: 700; }
    h2 { margin: 0; font-size: 20px; }
    .row header p { margin: 0; color: #3f3f46; font-size: 15px; flex-basis: 100%; }
    .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px; }
    .panel { padding: 10px; border-radius: 10px; }
    .before { background: #fff1f2; border: 1px solid #fecdd3; }
    .after { background: #f0fdf4; border: 1px solid #bbf7d0; }
    .tag { font-size: 12px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; margin-bottom: 8px; }
    .before .tag { color: #9f1239; } .after .tag { color: #166534; }
    .canvas img { display: block; max-width: 100%; max-height: 360px; border: 2px solid #3f3f46; }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .pair figure { margin: 0; }
    .pair img { display: block; width: 100%; border: 2px solid #3f3f46; background: #fff; }
    figcaption { font-size: 12px; color: #3f3f46; margin-top: 4px; }
    pre { margin: 0; padding: 10px; min-height: 64px; white-space: pre-wrap; word-break: break-word; font: 12.5px/1.4 ui-monospace, Menlo, monospace; background: #fff; border: 1px solid #d4d4d8; border-radius: 6px; }
    .metric { margin: 8px 0 0; font-size: 14px; font-weight: 650; }
    .swatches { display: flex; gap: 16px; margin-top: 8px; font: 13px ui-monospace, Menlo, monospace; }
    .swatches span { display: inline-flex; align-items: center; gap: 6px; }
    .swatches i { display: inline-block; width: 44px; height: 22px; border-radius: 4px; border: 1px solid #52525b; }
    .inspect { margin: 12px 0 0; font-size: 14px; color: #3f3f46; }
  </style></head><body><main>
    <h1>Chart honesty: before / after</h1>
    <p>Same named inputs through the production renderer at ${BEFORE_SHA.slice(0, 12)} (before) and ${HEAD_SHA.slice(0, 12)} (after). Diagrams are rasterized alone with resvg and the bundled fonts; the page-isolation row is a Chromium capture. Source: scripts/pr-assets/lieflat-chart-honesty-evidence.ts.</p>
    ${rows.map(rowHtml).join('\n')}
  </main></body></html>`
}

async function screenshotHtml(page: Page, html: string, selector: string, path: string): Promise<void> {
  await page.setContent(html, { waitUntil: 'load' })
  await page.locator(selector).screenshot({ path, animations: 'disabled' })
  console.log(`wrote docs/pr-assets/${path.split('/').at(-1)} (${Math.round(statSync(path).size / 1024)} KB)`)
}

// ---- main ----

if (execFileSync('git', ['status', '--porcelain', '--', 'src'], { cwd: ROOT, encoding: 'utf8' }).trim()) {
  throw new Error('src/ has uncommitted changes; the after panels must match a commit')
}
const HEAD_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
const before = renderBefore()
const after = runProbe(ROOT)

const fixed = (value: number | undefined, digits = 2): string => value === undefined ? 'n/a' : value.toFixed(digits)
const ratio = (svg: string): string => `lowest label contrast ${fixed(minimumLabelContrast(svg))}:1`
const axisFloor = (svg: string): string => `value axis starts at ${Math.min(...yAxisLabels(svg))}`

const chromePath = [process.env.AM_CHROMIUM, '/opt/pw-browsers/chromium'].find(path => path && existsSync(path))
const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'], ...(chromePath ? { executablePath: chromePath } : {}) })
try {
  const capturePage = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
  const leakBefore = await capturePair(capturePage, before)
  const leakAfter = await capturePair(capturePage, after)
  await capturePage.close()

  const topCrop = { left: 0, top: 0, width: 140, height: 30 }
  const rightCrop = (svg: string) => ({ left: viewBox(svg).width - 170, top: 0, width: 170, height: 60 })

  const rows: Row[] = [
    {
      issue: 'Issue 1 · high', title: 'Signed bars grow from zero',
      claim: 'Bars −10, 20, −5, 25. A bar encodes its value as length from zero, and the ASCII projection already drew it that way.',
      before: { image: rasterize(before.svgs.signedBars!), metric: 'every bar grows up from the axis floor; −10 draws shorter than −5' },
      after: { image: rasterize(after.svgs.signedBars!), metric: 'negative bars hang below the zero line; lengths are proportional to |value|' },
      inspect: 'the −10 bar is twice the −5 bar and points down; SVG now agrees with ASCII.',
    },
    {
      issue: 'Issue 2 · high', title: 'Diagrams on one page no longer repaint each other',
      claim: 'A github-light xychart rendered alone, then beside a dracula xychart in the same HTML document (Chromium).',
      before: {
        images: [{ caption: 'alone', image: leakBefore.alone }, { caption: 'beside the dracula chart', image: leakBefore.beside }],
        metric: `${leakBefore.repainted} of ${leakBefore.total} elements change computed paint beside the second chart`,
      },
      after: {
        images: [{ caption: 'alone', image: leakAfter.alone }, { caption: 'beside the dracula chart', image: leakAfter.beside }],
        metric: `${leakAfter.repainted} of ${leakAfter.total} elements change computed paint`,
      },
      inspect: 'before, the second chart\'s unscoped rules recolor the first (title, axis labels, series); after, both captures are identical.',
    },
    {
      issue: 'Issue 3 · medium', title: 'Six series get six distinguishable colors',
      claim: 'Six line series in the built-in salmon style (the style with the smallest separation at the base commit).',
      before: {
        image: rasterize(before.svgs.sixSeries!), swatches: closestPair(seriesColors(before.svgs.sixSeries!)),
        metric: `closest pair ΔE_OK ${fixed(minPairwiseDeltaEOK(seriesColors(before.svgs.sixSeries!)), 3)} (contract ≥ 0.10)`,
      },
      after: {
        image: rasterize(after.svgs.sixSeries!), swatches: closestPair(seriesColors(after.svgs.sixSeries!)),
        metric: `closest pair ΔE_OK ${fixed(minPairwiseDeltaEOK(seriesColors(after.svgs.sixSeries!)), 3)}`,
      },
      inspect: 'before, S4 and S6 are the same dark red to the eye; after, S6 is repaired and the colors that already met the contract keep their exact values.',
    },
    {
      issue: 'Issue 4 · medium', title: 'One short bar no longer removes every value label',
      claim: 'showDataLabel with bars 60, 80, 2, 70 on a 0–100 axis.',
      before: { image: rasterize(before.svgs.shortBar!), metric: `${dataLabelCount(before.svgs.shortBar!)} of 4 value labels drawn` },
      after: { image: rasterize(after.svgs.shortBar!), metric: `${dataLabelCount(after.svgs.shortBar!)} of 4 value labels drawn; the short bar's label sits above it` },
      inspect: 'every bar carries its value; the 2 is placed beyond its bar because it cannot fit inside.',
    },
    {
      issue: 'Issue 5 · medium', title: 'Labels inside bars clear WCAG 4.5:1',
      claim: 'Three series with value labels, default style. At the base commit the worst built-in style (patent-drawing) measured 1.00:1.',
      before: { image: rasterize(before.svgs.labelInk!), metric: ratio(before.svgs.labelInk!) },
      after: { image: rasterize(after.svgs.labelInk!), metric: ratio(after.svgs.labelInk!) },
      inspect: 'label ink is black or white, whichever contrasts more with its own bar. The Forecast series also moves from #5f79f2 to a purple: issue 3\'s repair, because it sat too close to Plan.',
    },
    {
      issue: 'Issue 7 · medium', title: 'The automatic range of a bar chart includes zero',
      claim: 'Bars 120, 130, 140 with no authored range.',
      before: { image: rasterize(before.svgs.autoRange!), metric: `${axisFloor(before.svgs.autoRange!)}; 140 draws ${fixed(heightRatio(before.svgs.autoRange!), 1)}× as tall as 120` },
      after: { image: rasterize(after.svgs.autoRange!), metric: `${axisFloor(after.svgs.autoRange!)}; 140 draws ${fixed(heightRatio(after.svgs.autoRange!), 2)}× as tall as 120` },
      inspect: 'the values differ by 1.17×; before, the drawn heights differed by an order of magnitude.',
    },
    {
      issue: 'Issue 9 · low', title: 'Outermost value labels stay on the canvas',
      claim: 'Crops of the canvas corners at 4× and 3×: an untitled vertical chart (top-left) and a horizontal chart (top-right). The frame\'s top edge, and the right edge of the horizontal crop, are the canvas edges.',
      before: {
        images: [
          { caption: 'vertical: top y-axis label', image: await crop(before.svgs.untitled!, 4, topCrop) },
          { caption: 'horizontal: rightmost value label', image: await crop(before.svgs.untitledHorizontal!, 3, rightCrop(before.svgs.untitledHorizontal!)) },
        ],
        metric: `glyphs past the edge: ${fixed(textOverflow(before.svgs.untitled!).top, 1)} px above, ${fixed(textOverflow(before.svgs.untitledHorizontal!).right, 1)} px right`,
      },
      after: {
        images: [
          { caption: 'vertical: top y-axis label', image: await crop(after.svgs.untitled!, 4, topCrop) },
          { caption: 'horizontal: rightmost value label', image: await crop(after.svgs.untitledHorizontal!, 3, rightCrop(after.svgs.untitledHorizontal!)) },
        ],
        metric: `glyphs past the edge: ${fixed(textOverflow(after.svgs.untitled!).top, 1)} px above, ${fixed(textOverflow(after.svgs.untitledHorizontal!).right, 1)} px right`,
      },
      inspect: 'the "100" labels are whole inside the frame.',
    },
    {
      issue: 'Issue 6 · medium', title: 'verify names the category labels the axis does not draw',
      claim: 'Ten long category names under a vertical chart; the axis thins them at both revisions.',
      before: { lines: before.warnings.dense, metric: 'verify is silent' },
      after: { lines: after.warnings.dense, metric: 'LABELS_HIDDEN lists exactly the undrawn names' },
      inspect: 'the rendered chart is unchanged; the lint is new.',
    },
    {
      issue: 'Issue 8 · low', title: 'verify flags a bar range that excludes zero',
      claim: 'Bars 92, 95, 97 on an authored 90–100 axis; the geometry is the same at both revisions.',
      before: { lines: before.warnings.truncated, metric: 'verify is silent' },
      after: { lines: after.warnings.truncated, metric: 'BAR_RANGE_EXCLUDES_ZERO names the baseline' },
      inspect: 'the authored range is kept and now disclosed.',
    },
    {
      issue: 'Issue 10 · low', title: 'Official Mermaid keys are not called misspellings',
      claim: 'xyChart.showDataLabelOutsideBar and xyChart.xAxis.labelRotation, both in the pinned mermaid@11.16.0 config.',
      before: { lines: before.warnings.officialKeys, metric: 'both keys reported as unknown or undocumented' },
      after: { lines: after.warnings.officialKeys, metric: 'showDataLabelOutsideBar is wired; labelRotation is reported as accepted with no effect' },
      inspect: 'no message tells the author to check the spelling of an official key.',
    },
  ]

  mkdirSync(OUT_DIR, { recursive: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 })
  await screenshotHtml(page, sheetHtml(rows), 'main', join(OUT_DIR, 'lieflat-chart-honesty-before-after.png'))
  // Focused crops of the two high-severity rows, for side-by-side review.
  for (const [index, slug] of [[0, 'signed-bars'], [1, 'style-leak']] as const) {
    for (const kind of ['before', 'after'] as const) {
      const html = sheetHtml([{ ...rows[index]!, before: rows[index]!.before, after: rows[index]!.after }])
      await page.setContent(html, { waitUntil: 'load' })
      const path = join(OUT_DIR, `lieflat-${slug}-${kind}.png`)
      await page.locator(`.panel.${kind}`).screenshot({ path, animations: 'disabled' })
      console.log(`wrote docs/pr-assets/lieflat-${slug}-${kind}.png (${Math.round(statSync(path).size / 1024)} KB)`)
    }
  }
  await page.close()
} finally {
  await browser.close()
}
