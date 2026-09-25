/**
 * Before/after evidence for holding every family to the chart-honesty text
 * contract (docs/design/system/chart-honesty.md, H1–H3).
 *
 * Renders the same named inputs through the production renderer at BEFORE_SHA
 * (main, in a detached worktree) and at the current tree, then measures each
 * row's text with the pixel oracle the tests use
 * (src/__tests__/helpers/rendered-text.ts), so every caption metric is read
 * from the rasterized output. Every registered family has at least one row, in
 * registry order. Each panel shows the whole diagram and, when the text is
 * drawn, a 3× crop around it; the quadrant row that changes what verify
 * reports prints the warnings at each revision. The script ends by printing
 * one Markdown table line per row, for the pull request.
 *
 *   bun run scripts/pr-assets/chart-honesty-families-evidence.ts
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { measureRenderedText, pageColorOf, renderedTextReady, requiredContrast, type RenderedText } from '../../src/__tests__/helpers/rendered-text.ts'
import { BUILTIN_FAMILY_METADATA } from '../../src/agent/families.ts'
import type { DiagramKind } from '../../src/agent/types.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT_DIR = join(ROOT, 'docs', 'pr-assets')
const BEFORE_SHA = 'd59c49a859d48fccc4bc5cd1c764f8ea0b68a6b7'
const FONT_DIR = join(ROOT, 'assets', 'fonts')

const titled = (title: string, body: string): string => `---\ntitle: ${title}\n---\n${body}`

type Check = 'legible' | 'on-canvas' | 'drawn'

interface Row {
  id: string
  /** The registered family the row stands for; every family has a row. */
  kind: DiagramKind
  principle: string
  family: string
  title: string
  claim: string
  source: string
  style?: string
  /** The text the row measures, as drawn at the current tree. */
  text: string
  /** More authored text a `drawn` row looks for. */
  also?: readonly string[]
  check: Check
  inspect: string
}

const ROWS: readonly Row[] = [
  {
    id: 'er-fill', kind: 'er', principle: 'H1 legible', family: 'ER', title: 'Entity text on an authored dark fill',
    claim: '`style CUSTOMER fill:#1f2937`, default style. The entity name used the page ink whatever the fill.',
    source: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  CUSTOMER {\n    string id PK\n    string email\n  }\n  style CUSTOMER fill:#1f2937',
    text: 'CUSTOMER', check: 'legible',
    inspect: 'the name and attributes on the dark entity read in light ink; ORDER, on the page fill, keeps its ink.',
  },
  {
    id: 'sankey-ribbon', kind: 'sankey', principle: 'H1 legible', family: 'Sankey', title: 'Node labels over the ribbons',
    claim: 'The registry example in solarized-dark. Labels sit on top of the flows they name.',
    source: 'sankey-beta\n  Solar,Grid,40\n  Wind,Grid,30\n  Grid,Homes,50\n  Grid,Industry,20',
    style: 'solarized-dark', text: 'Homes 50', check: 'legible',
    inspect: 'each label carries a halo in the page color, so the ribbon behind it no longer shows through its glyphs.',
  },
  {
    id: 'sequence-box', kind: 'sequence', principle: 'H1 legible', family: 'Sequence', title: 'Message labels inside an authored box color',
    claim: '`box Aqua Team`, tufte-dark. Message labels kept the dark look\'s muted tone, meant for its dark page, on the light box.',
    source: 'sequenceDiagram\n  box Aqua Team\n    participant A as Alice\n    participant B as Bob\n  end\n  A->>B: hello\n  B-->>A: hi',
    style: 'tufte-dark', text: 'hello', check: 'legible',
    inspect: 'the message labels on the aqua box read in a darker tone with an aqua halo; the participant names keep their light ink on their own dark boxes.',
  },
  {
    id: 'quadrant-divider', kind: 'quadrant', principle: 'H1 legible', family: 'Quadrant', title: 'A point label on the midline',
    claim: 'A point at y = 0.5, tokyo-night: its label sits on the horizontal divider. Found by the random-title property.',
    source: 'quadrantChart\n  x-axis Low --> High\n  y-axis Bad --> Good\n  n0: [0.1, 0.4]\n  n1: [0.2, 0.5]',
    style: 'tokyo-night', text: 'n1', check: 'legible',
    inspect: 'the divider stops at the label: a halo in the quadrant fill keeps the line out of the glyphs.',
  },
  {
    id: 'gantt-title', kind: 'gantt', principle: 'H2 on the canvas', family: 'Gantt', title: 'A title wider than the chart',
    claim: 'A long `title` in architectural-plan, which uppercases and letter-spaces titles. Found by the random-title property.',
    source: 'gantt\n  title Quarterly roadmap for the whole platform engineering organization\n  dateFormat YYYY-MM-DD\n  section Plan\n  Scope :s1, 2026-02-01, 2d',
    style: 'architectural-plan', text: 'QUARTERLY ROADMAP FOR THE WHOLE PLATFORM ENGINEERING ORGANIZATION', check: 'on-canvas',
    inspect: 'the canvas widens to the title as the style draws it; before, both ends were cut off.',
  },
  {
    id: 'class-namespace', kind: 'class', principle: 'H2 on the canvas', family: 'Class', title: 'A namespace title longer than its one class',
    claim: 'An unbreakable namespace name over a narrow class, default style.',
    source: 'classDiagram\n  namespace A_namespace_title_longer_than_its_class {\n    class X\n  }',
    text: 'A_namespace_title_longer_than_its_class', check: 'on-canvas',
    inspect: 'the title wraps inside the namespace frame instead of running past it and off the canvas.',
  },
  {
    id: 'flowchart-title', kind: 'flowchart', principle: 'H3 drawn', family: 'Flowchart', title: 'The frontmatter title, and a label given after first use',
    claim: 'Mermaid draws a frontmatter `title:` for every family and lets a later `b[Label B]` label an existing node.',
    source: titled('Checkout flow', 'flowchart LR\n  a[Cart] --> b\n  b[Label B]'),
    text: 'Checkout flow', also: ['Label B'], check: 'drawn',
    inspect: 'the title band above the graph, and "Label B" instead of the bare id "b".',
  },
  {
    id: 'er-comment', kind: 'er', principle: 'H3 drawn', family: 'ER', title: 'Attribute comments',
    claim: '`string id PK "identifier"`: the quoted comment is part of the attribute.',
    source: 'erDiagram\n  CUSTOMER {\n    string id PK "identifier"\n    string email UK "login address"\n  }',
    text: 'identifier', check: 'drawn',
    inspect: 'a comment column after the key column.',
  },
  {
    id: 'state-description', kind: 'state', principle: 'H3 drawn', family: 'State', title: 'A description added to a declared state',
    claim: '`Done : Order complete` after `Done` was already used in a transition.',
    source: 'stateDiagram-v2\n  [*] --> Done\n  Done : Order complete',
    text: 'Order complete', check: 'drawn',
    inspect: 'the description is drawn under the state name.',
  },
  {
    id: 'timeline-band', kind: 'timeline', principle: 'H1 legible', family: 'Timeline', title: 'Event text on the section band',
    claim: 'The Section B census fixture in dracula. Event text on the section band missed AA.',
    source: 'timeline\n  title Launch\n  section Alpha\n    2026 Q1 : Design : Build\n  section Beta\n    2026 Q2 : Ship',
    style: 'dracula', text: 'Build', check: 'legible',
    inspect: 'the event text clears AA on the band, because the theme tones are chosen against every surface the theme paints.',
  },
  {
    id: 'journey-title', kind: 'journey', principle: 'H2 on the canvas', family: 'Journey', title: 'A title wider than the chart',
    claim: 'A long `title` over a single task, default style.',
    source: 'journey\n  title A very long journey title that is much wider than the single task below it\n  section Try\n    Sign up: 3: Me',
    text: 'A very long journey title that is much wider than the single task below it', check: 'on-canvas',
    inspect: 'the canvas grows to hold the title.',
  },
  {
    id: 'architecture-title', kind: 'architecture', principle: 'H2 on the canvas', family: 'Architecture', title: 'A title wider than the diagram',
    claim: 'A long `title` and a long group label over one service, default style.',
    source: 'architecture-beta\n  title An architecture title far longer than the one service in this diagram\n  group g(cloud)[A group label longer than its only service]\n  service s(server)[S] in g',
    text: 'An architecture title far longer than the one service in this diagram', check: 'on-canvas',
    inspect: 'the canvas grows to hold the title, and the group widens to hold its icon and label.',
  },
  {
    id: 'xychart-legend', kind: 'xychart', principle: 'H2 on the canvas', family: 'XY chart', title: 'A legend label in an uppercase style',
    claim: 'The census fixture in ops-schematic, which uppercases and letter-spaces labels. The legend was measured as authored, not as drawn.',
    source: '---\nconfig:\n  xyChart:\n    showDataLabel: true\n---\nxychart-beta\n  title Revenue\n  x-axis [Q1, Q2, Q3]\n  y-axis USD 0 --> 100\n  bar Online [30, 55, 80]\n  line Forecast [25, 60, 75]',
    style: 'ops-schematic', text: 'FORECAST', check: 'on-canvas',
    inspect: 'the legend is measured as the style draws it, so the canvas holds "FORECAST".',
  },
  {
    id: 'pie-hatched', kind: 'pie', principle: 'H1 legible', family: 'Pie', title: 'Slice percentages inside their own halo',
    claim: 'The census fixture in excalidraw, which hatches slices and halos text in the page color. The percentages were inked white for the slice fill, inside a white halo.',
    source: '---\nconfig:\n  pie:\n    highlightSlice: Pro\n---\npie showData\n  title Plans\n  "Free" : 60\n  "Pro" : 30\n  "Enterprise" : 10',
    style: 'excalidraw', text: '30%', check: 'legible',
    inspect: 'the percentages are inked against the halo they carry, so they read over the hatching.',
  },
  {
    id: 'mindmap-root', kind: 'mindmap', principle: 'H1 legible', family: 'Mindmap', title: 'The root label inside its own halo',
    claim: 'The census fixture in architectural-plan, which halos text in the page color. The root label was inked in that same color, so its letters ran together.',
    source: 'mindmap\n  root((Product))\n    Research\n      ::icon(fa fa-book)\n      Interviews\n      Evidence\n    Delivery\n      ::icon(acme:unknown)\n      Launch',
    style: 'architectural-plan', text: 'Product', check: 'legible',
    inspect: 'the label is inked against the halo it carries: dark letters inside the light halo.',
  },
  {
    id: 'gitgraph-branch', kind: 'gitgraph', principle: 'H1 legible', family: 'GitGraph', title: 'A branch label in blueprint',
    claim: 'Branches, tags and a title in blueprint. The hotfix branch label was just under AA.',
    source: titled('Release train', 'gitGraph\n  commit id:"init"\n  branch develop\n  commit id:"feature work" tag:"v0.1"\n  branch hotfix\n  commit id:"patch"\n  checkout main\n  merge develop\n  merge hotfix'),
    style: 'blueprint', text: 'hotfix', check: 'legible',
    inspect: 'a small change: the label\'s tone moves just far enough to clear AA.',
  },
  {
    id: 'radar-legend', kind: 'radar', principle: 'H1 legible', family: 'Radar', title: 'The one family that already passed',
    claim: 'Radar had no violation on main. Its closest text, the legend in solarized-light, is shown at both revisions.',
    source: 'radar-beta\n  title Skills\n  axis speed["Speed"], power["Power"], range["Range"]\n  curve now["Current"]{4, 3, 5}\n  curve goal["Target"]{5, 5, 4}\n  max 5',
    style: 'solarized-light', text: 'Current', check: 'legible',
    inspect: 'both revisions pass; the legend\'s tone moves with the theme\'s text tones.',
  },
]

/** Rows in registry order. Every registered family, a new one included, needs
 * at least one row, so the sheet always covers what the contract covers. */
const FAMILY_ORDER: readonly DiagramKind[] = BUILTIN_FAMILY_METADATA.map(family => family.id)
const UNCOVERED = FAMILY_ORDER.filter(kind => !ROWS.some(row => row.kind === kind))
if (UNCOVERED.length > 0) throw new Error(`No evidence row for ${UNCOVERED.join(', ')}; every registered family needs one`)
const ORDERED_ROWS = [...ROWS].sort((a, b) => FAMILY_ORDER.indexOf(a.kind) - FAMILY_ORDER.indexOf(b.kind))

/** The quadrant row that changes what verify reports, not pixels. */
const CROWDED = 'quadrantChart\n  title Crowded points\n  x-axis Low --> High\n  y-axis Low --> High\n  Alpha: [0.30, 0.60]\n  Beta: [0.31, 0.61]\n  Referrals: [0.32, 0.62]\n  Retention: [0.33, 0.60]\n  Churn: [0.31, 0.59]'

interface RevisionOutput { svgs: Record<string, string>; crowdedWarnings: string[] }

/** One probe runs unchanged against either checkout, through its public API. */
function probeSource(root: string): string {
  return `
    import { renderMermaidSVG } from ${JSON.stringify(join(root, 'src', 'index.ts'))}
    import { verifyMermaid } from ${JSON.stringify(join(root, 'src', 'agent', 'index.ts'))}
    const rows = ${JSON.stringify(ROWS.map(row => ({ id: row.id, source: row.source, style: row.style })))}
    const svgs = Object.fromEntries(rows.map(row => [row.id, renderMermaidSVG(row.source, { embedFontImport: false, ...(row.style ? { style: row.style } : {}) })]))
    const crowdedWarnings = verifyMermaid(${JSON.stringify(CROWDED)}).warnings
      .filter(warning => warning.code === 'LABELS_HIDDEN' || warning.code === 'OFF_CANVAS')
      .map(warning => warning.code + ': ' + ('message' in warning ? warning.message : JSON.stringify(warning)))
    console.log(JSON.stringify({ svgs, crowdedWarnings }))
  `
}

function runProbe(root: string): RevisionOutput {
  const probe = join(tmpdir(), `chart-honesty-evidence-probe-${process.pid}-${Date.now()}.ts`)
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
  const worktree = join(tmpdir(), `agentic-mermaid-honesty-${Date.now()}`)
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

// ---- measurement and pictures ----

/** Drawn text compared without case, whitespace, or wrap hyphens. */
const reading = (text: string): string => text.toLocaleLowerCase('en-US').replace(/[\s-]+/g, '')

function find(texts: readonly RenderedText[], wanted: string): RenderedText | undefined {
  return texts.find(text => reading(text.content) === reading(wanted))
    ?? texts.find(text => reading(text.content).includes(reading(wanted)))
}

function metric(svg: string, row: Row): string {
  const census = measureRenderedText(svg)
  const text = find(census.texts, row.text)
  if (row.check === 'drawn') {
    const drawn = census.texts.map(each => reading(each.content)).join('')
    return [row.text, ...(row.also ?? [])]
      .map(wanted => `"${wanted}" ${drawn.includes(reading(wanted)) ? 'is drawn' : 'is not drawn'}`)
      .join(' · ')
  }
  if (!text) return `"${row.text}" is not drawn`
  if (row.check === 'on-canvas') {
    return text.offCanvasPixels > 0
      ? `${text.offCanvasPixels} of ${text.pixels} glyph pixels fall off the canvas`
      : `all ${text.pixels} glyph pixels are on the canvas`
  }
  return `"${text.content}" ${text.ink} on ${text.surround}: ${text.contrast!.toFixed(2)}:1 (needs ${requiredContrast(text)}:1)`
}

function viewBox(svg: string): { x: number; y: number; width: number; height: number } {
  const [x, y, width, height] = svg.match(/viewBox="([^"]+)"/)![1]!.trim().split(/[\s,]+/).map(Number)
  return { x: x!, y: y!, width: width!, height: height! }
}

function rasterize(svg: string, zoom: number): Buffer {
  return Buffer.from(new Resvg(svg, {
    fitTo: { mode: 'zoom', value: zoom },
    background: pageColorOf(svg),
    font: { loadSystemFonts: false, fontDirs: [FONT_DIR], defaultFontFamily: 'Inter' },
  }).render().asPng())
}

/** A 3× crop around the row's text, clamped to the canvas. */
async function zoomOn(svg: string, row: Row): Promise<Buffer | undefined> {
  const text = find(measureRenderedText(svg).texts, row.text)
  if (!text?.box) return undefined
  const box = viewBox(svg)
  const zoom = 3
  const pad = 14
  const left = Math.max(0, text.box.x - box.x - pad)
  const top = Math.max(0, text.box.y - box.y - pad)
  const right = Math.min(box.width, text.box.x - box.x + text.box.width + pad)
  const bottom = Math.min(box.height, text.box.y - box.y + text.box.height + pad)
  if (right <= left || bottom <= top) return undefined
  const image = sharp(rasterize(svg, zoom))
  const meta = await image.metadata()
  const extract = {
    left: Math.floor(left * zoom), top: Math.floor(top * zoom),
    width: Math.min(meta.width! - Math.floor(left * zoom), Math.ceil((right - left) * zoom)),
    height: Math.min(meta.height! - Math.floor(top * zoom), Math.ceil((bottom - top) * zoom)),
  }
  return image.extract(extract).png().toBuffer()
}

// ---- sheet ----

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const png = (buffer: Buffer): string => `data:image/png;base64,${buffer.toString('base64')}`

interface Panel { whole?: Buffer; zoom?: Buffer; lines?: string[]; metric: string }

function panelHtml(kind: 'before' | 'after', sha: string, panel: Panel): string {
  const body = panel.lines
    ? `<pre>${esc(panel.lines.join('\n') || '(no LABELS_HIDDEN or OFF_CANVAS warning)')}</pre>`
    : `<div class="pictures"><img class="whole" src="${png(panel.whole!)}" alt="">${panel.zoom ? `<img class="zoom" src="${png(panel.zoom)}" alt="">` : ''}</div>`
  return `<div class="panel ${kind}"><div class="tag">${kind === 'before' ? 'Before' : 'After'} · ${sha.slice(0, 7)}</div>${body}<p class="metric">${esc(panel.metric)}</p></div>`
}

function sheetHtml(sections: string[], headSha: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; background: #e4e4e7; color: #18181b; font-family: Inter, -apple-system, "Segoe UI", sans-serif; }
    main { width: 1600px; padding: 28px; }
    main > h1 { margin: 0 0 6px; font-size: 30px; }
    main > p { margin: 0 0 22px; color: #52525b; font-size: 16px; }
    .row { margin: 0 0 18px; padding: 18px 20px; border-radius: 14px; background: #fff; border: 1px solid #d4d4d8; }
    .row header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
    .principle { padding: 2px 9px; border-radius: 999px; background: #18181b; color: #fff; font-size: 13px; font-weight: 700; }
    .family { font-size: 13px; font-weight: 700; color: #52525b; text-transform: uppercase; letter-spacing: .04em; }
    h2 { margin: 0; font-size: 20px; }
    .row header p { margin: 0; color: #3f3f46; font-size: 15px; flex-basis: 100%; }
    .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px; }
    .panel { padding: 10px; border-radius: 10px; }
    .before { background: #fff1f2; border: 1px solid #fecdd3; }
    .after { background: #f0fdf4; border: 1px solid #bbf7d0; }
    .tag { font-size: 12px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; margin-bottom: 8px; }
    .before .tag { color: #9f1239; } .after .tag { color: #166534; }
    .pictures { display: flex; gap: 10px; align-items: flex-start; }
    .pictures img { display: block; min-width: 0; border: 2px solid #3f3f46; }
    .pictures img.whole { max-width: 58%; max-height: 300px; }
    .pictures img.whole:only-child { max-width: 100%; }
    .pictures img.zoom { max-width: 40%; max-height: 300px; }
    pre { margin: 0; padding: 10px; min-height: 64px; white-space: pre-wrap; word-break: break-word; font: 12.5px/1.4 ui-monospace, Menlo, monospace; background: #fff; border: 1px solid #d4d4d8; border-radius: 6px; }
    .metric { margin: 8px 0 0; font-size: 14px; font-weight: 650; }
    .inspect { margin: 12px 0 0; font-size: 14px; color: #3f3f46; }
  </style></head><body><main>
    <h1>Chart honesty across families: before / after</h1>
    <p>Same named inputs through the production renderer at ${BEFORE_SHA.slice(0, 12)} (main, before) and ${headSha.slice(0, 12)} (after), with at least one row for each of the ${FAMILY_ORDER.length} registered families, in registry order. Metrics come from the pixel oracle the tests use (resvg with the bundled fonts). Source: scripts/pr-assets/chart-honesty-families-evidence.ts.</p>
    ${sections.join('\n')}
  </main></body></html>`
}

function sectionHtml(head: { principle: string; family: string; title: string; claim: string; inspect: string }, before: Panel, after: Panel, headSha: string): string {
  return `<section class="row">
    <header><span class="principle">${esc(head.principle)}</span><span class="family">${esc(head.family)}</span><h2>${esc(head.title)}</h2><p>${esc(head.claim)}</p></header>
    <div class="panels">${panelHtml('before', BEFORE_SHA, before)}${panelHtml('after', headSha, after)}</div>
    <p class="inspect"><b>Inspect:</b> ${esc(head.inspect)}</p>
  </section>`
}

// ---- main ----

if (execFileSync('git', ['status', '--porcelain', '--', 'src'], { cwd: ROOT, encoding: 'utf8' }).trim()) {
  throw new Error('src/ has uncommitted changes; the after panels must match a commit')
}
const HEAD_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
await renderedTextReady()
const before = renderBefore()
const after = runProbe(ROOT)

const sections = new Map<string, string>()
const summary = ['| Family | Principle | Row | Before | After |', '|---|---|---|---|---|']
for (const row of ORDERED_ROWS) {
  const panel = async (svg: string): Promise<Panel> => ({ whole: rasterize(svg, 1.5), zoom: await zoomOn(svg, row), metric: metric(svg, row) })
  const [was, now] = [await panel(before.svgs[row.id]!), await panel(after.svgs[row.id]!)]
  sections.set(row.id, sectionHtml(row, was, now, HEAD_SHA))
  summary.push(`| ${row.family} | ${row.principle} | ${row.title} | ${was.metric} | ${now.metric} |`)
  if (row.id !== 'quadrant-divider') continue
  // The quadrant row that changes what verify reports sits with its family.
  const crowded = {
    principle: 'H3 reported', family: 'Quadrant', title: 'verify names the point labels crowding hides',
    claim: 'Five points within 0.02 of each other; placement hides the labels it cannot fit at both revisions.',
    inspect: 'the chart is unchanged; LABELS_HIDDEN (target "point-labels") is new, so the omission is no longer silent.',
  }
  const reported = (warnings: string[]) => warnings.length ? 'LABELS_HIDDEN lists the undrawn point labels' : 'verify is silent'
  sections.set('quadrant-crowding', sectionHtml(
    crowded,
    { lines: before.crowdedWarnings, metric: reported(before.crowdedWarnings) },
    { lines: after.crowdedWarnings, metric: reported(after.crowdedWarnings) },
    HEAD_SHA,
  ))
  summary.push(`| ${crowded.family} | ${crowded.principle} | ${crowded.title} | ${reported(before.crowdedWarnings)} | ${reported(after.crowdedWarnings)} |`)
}

mkdirSync(OUT_DIR, { recursive: true })
const chromePath = [process.env.AM_CHROMIUM, '/opt/pw-browsers/chromium'].find(path => path && existsSync(path))
const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'], ...(chromePath ? { executablePath: chromePath } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 })
  await page.setContent(sheetHtml([...sections.values()], HEAD_SHA), { waitUntil: 'load' })
  const sheet = join(OUT_DIR, 'chart-honesty-families-before-after.png')
  await page.locator('main').screenshot({ path: sheet, animations: 'disabled' })
  console.log(`wrote docs/pr-assets/chart-honesty-families-before-after.png (${Math.round(statSync(sheet).size / 1024)} KB)`)
  // A legibility row and a containment row as separate panels, for the PR.
  for (const slug of ['er-fill', 'gantt-title'] as const) {
    await page.setContent(sheetHtml([sections.get(slug)!], HEAD_SHA), { waitUntil: 'load' })
    for (const kind of ['before', 'after'] as const) {
      const path = join(OUT_DIR, `chart-honesty-${slug}-${kind}.png`)
      await page.locator(`.panel.${kind}`).screenshot({ path, animations: 'disabled' })
      console.log(`wrote docs/pr-assets/chart-honesty-${slug}-${kind}.png (${Math.round(statSync(path).size / 1024)} KB)`)
    }
  }
  await page.close()
} finally {
  await browser.close()
}
console.log(summary.join('\n'))
