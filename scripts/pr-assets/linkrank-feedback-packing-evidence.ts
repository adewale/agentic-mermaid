#!/usr/bin/env bun
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { filesUnder, hashArtifactInputs, repositoryPath, runtimeDependencyClosure, runtimeDependencySummary, sha256File, sortRepositoryPaths, transitiveLocalInputs } from './artifact-receipt.ts'

const ROOT = join(import.meta.dir, '..', '..')
const EVAL_DIR = join(ROOT, 'eval', 'linkrank-feedback-packing')
const FIXTURE_DIR = join(EVAL_DIR, 'fixtures')
const BASELINE_DIR = join(EVAL_DIR, 'baseline')
const BASELINE_LAYOUT = join(BASELINE_DIR, 'layout.json')
const MATRIX_OUTPUT = join(ROOT, 'docs', 'pr-assets', 'issue-87-linkrank-feedback-packing-before-after.png')
const AFTER_OUTPUT = join(ROOT, 'docs', 'pr-assets', 'issue-87-linkrank-feedback-packing-after.png')
const RECEIPT = join(EVAL_DIR, 'evidence-receipt.json')
const BASELINE_COMMIT = 'ad20678e72aff19b4b67178d3bc9dcad3c8c0630'
const MIN_GAP = 224
const chromePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/opt/pw-browsers/chromium'].find(existsSync)

type Direction = 'LR' | 'RL' | 'TD' | 'BT'
interface CaseSpec {
  id: string
  title: string
  direction: Direction
  fixture: string
  geometricSource: string
  geometricTarget: string
  why: string
  inspect: string
}
interface PositionedNode { id: string; x: number; y: number; width: number; height: number }
interface Runtime {
  parseMermaid: (source: string) => unknown
  layoutGraphSync: (graph: unknown) => { nodes: PositionedNode[] }
  renderMermaidSVG: (source: string, options?: { embedFontImport?: boolean }) => string
}
interface BaselineLayout {
  schemaVersion: 1
  commit: string
  cases: Array<{ id: string; gap: number }>
}

const cases: CaseSpec[] = [
  ...(['LR', 'RL', 'TD', 'BT'] as const).map(direction => ({
    id: `feedback-long-${direction.toLowerCase()}`,
    title: `Bug 1 · lengthened feedback edge · ${direction}`,
    direction,
    fixture: `feedback-long-${direction.toLowerCase()}.mmd`,
    geometricSource: 'A',
    geometricTarget: 'B',
    why: 'The authored B ----> A return edge requests three ranks but was treated as route styling only.',
    inspect: 'The A/B boundary gap grows from the base 48 px to at least 224 px; the return edge remains a feedback route.',
  })),
  {
    id: 'packing-td', title: 'Bug 2 · packing preserves long-link gap · TD', direction: 'TD', fixture: 'packing-td.mmd',
    geometricSource: 'N7', geometricTarget: 'N0',
    why: 'Overlap repair moved only the colliding node and re-compressed the N7 ----> N0 rank constraint.',
    inspect: 'The repaired N7/N0 boundary gap is at least 224 px with no node overlap or edge-through-node regression.',
  },
  {
    id: 'packing-bt', title: 'Bug 2 · packing preserves long-link gap · BT', direction: 'BT', fixture: 'packing-bt.mmd',
    geometricSource: 'N7', geometricTarget: 'N0',
    why: 'The reverse vertical direction exposed the same source-only collision repair with a smaller final gap.',
    inspect: 'The repaired N7/N0 boundary gap is at least 224 px while the surrounding component stays separated.',
  },
]

const sourceOf = (spec: CaseSpec): string => readFileSync(join(FIXTURE_DIR, spec.fixture), 'utf8')
const svgPath = (spec: CaseSpec): string => join(BASELINE_DIR, `${spec.id}.svg`)
const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function runtimeAt(root: string): Promise<Runtime> {
  const url = (path: string): string => pathToFileURL(join(root, path)).href
  const [parser, layout, renderer] = await Promise.all([
    import(url('src/parser.ts')),
    import(url('src/layout-engine.ts')),
    import(url('src/index.ts')),
  ])
  return {
    parseMermaid: parser.parseMermaid,
    layoutGraphSync: layout.layoutGraphSync,
    renderMermaidSVG: renderer.renderMermaidSVG,
  }
}

function measuredGap(runtime: Runtime, spec: CaseSpec): number {
  const positioned = runtime.layoutGraphSync(runtime.parseMermaid(sourceOf(spec)))
  const source = positioned.nodes.find(node => node.id === spec.geometricSource)
  const target = positioned.nodes.find(node => node.id === spec.geometricTarget)
  if (!source || !target) throw new Error(`${spec.id}: missing measurement endpoint`)
  switch (spec.direction) {
    case 'LR': return target.x - (source.x + source.width)
    case 'RL': return source.x - (target.x + target.width)
    case 'TD': return target.y - (source.y + source.height)
    case 'BT': return source.y - (target.y + target.height)
  }
}

const baselineArg = process.argv.indexOf('--baseline-root')
if (baselineArg !== -1) {
  const rawRoot = process.argv[baselineArg + 1]
  if (!rawRoot) throw new Error('--baseline-root requires a checkout path')
  const baselineRoot = resolve(rawRoot)
  const commit = execFileSync('git', ['-C', baselineRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (commit !== BASELINE_COMMIT) throw new Error(`Baseline checkout must be ${BASELINE_COMMIT}; received ${commit}`)
  const baselineRuntime = await runtimeAt(baselineRoot)
  mkdirSync(BASELINE_DIR, { recursive: true })
  for (const spec of cases) {
    writeFileSync(svgPath(spec), baselineRuntime.renderMermaidSVG(sourceOf(spec), { embedFontImport: false }))
  }
  const baselineLayout: BaselineLayout = {
    schemaVersion: 1,
    commit,
    cases: cases.map(spec => ({ id: spec.id, gap: measuredGap(baselineRuntime, spec) })),
  }
  writeFileSync(BASELINE_LAYOUT, `${JSON.stringify(baselineLayout, null, 2)}\n`)
}

if (!existsSync(BASELINE_LAYOUT) || cases.some(spec => !existsSync(svgPath(spec)))) {
  throw new Error(`Missing pinned baseline artifacts; rerun with --baseline-root <checkout-at-${BASELINE_COMMIT.slice(0, 8)}>`)
}

const baseline = JSON.parse(readFileSync(BASELINE_LAYOUT, 'utf8')) as BaselineLayout
if (baseline.commit !== BASELINE_COMMIT) throw new Error(`Baseline receipt is not pinned to ${BASELINE_COMMIT}`)
const baselineGap = new Map(baseline.cases.map(entry => [entry.id, entry.gap]))
const currentRuntime = await runtimeAt(ROOT)
const measurements = cases.map(spec => {
  const before = baselineGap.get(spec.id)
  if (before === undefined) throw new Error(`${spec.id}: missing baseline measurement`)
  const after = measuredGap(currentRuntime, spec)
  if (spec.id.startsWith('feedback-') && before >= 100) throw new Error(`${spec.id}: baseline no longer demonstrates ignored feedback length (${before}px)`)
  if (spec.id.startsWith('packing-') && before >= MIN_GAP - 0.5) throw new Error(`${spec.id}: baseline no longer demonstrates packing compression (${before}px)`)
  if (after < MIN_GAP - 0.5) throw new Error(`${spec.id}: current boundary gap is ${after}px; expected at least ${MIN_GAP}px`)
  return { id: spec.id, before, after }
})

const repoPath = (path: string): string => repositoryPath(ROOT, path)
const baselineInputs = [BASELINE_LAYOUT, ...cases.map(svgPath)]
const receiptEntrypoints = [
  import.meta.filename,
  join(ROOT, 'src', 'parser.ts'),
  join(ROOT, 'src', 'layout-engine.ts'),
  join(ROOT, 'src', 'index.ts'),
]
const inputPaths = sortRepositoryPaths(ROOT, [
  ...transitiveLocalInputs(ROOT, receiptEntrypoints),
  ...filesUnder(FIXTURE_DIR, path => path.endsWith('.mmd')),
  ...baselineInputs,
])
const runtimeDependencies = runtimeDependencyClosure(ROOT, receiptEntrypoints)
const currentReceipt = () => ({
  schemaVersion: 1,
  generator: repoPath(import.meta.filename),
  baseline: { commit: BASELINE_COMMIT, artifacts: baselineInputs.map(path => ({ path: repoPath(path), sha256: sha256File(path) })) },
  measurements,
  inputCount: inputPaths.length,
  inputTreeSha256: hashArtifactInputs(ROOT, inputPaths, runtimeDependencies),
  runtimeDependencies: runtimeDependencySummary(runtimeDependencies),
  outputs: [MATRIX_OUTPUT, AFTER_OUTPUT].map(path => ({ path: repoPath(path), sha256: sha256File(path) })),
})

if (process.argv.includes('--receipt-only')) {
  writeFileSync(RECEIPT, `${JSON.stringify(currentReceipt(), null, 2)}\n`)
  console.log('Refreshed Issue #87 receipt without rewriting visual output')
  process.exit(0)
}

if (process.argv.includes('--check')) {
  const recorded = JSON.parse(readFileSync(RECEIPT, 'utf8'))
  if (JSON.stringify(recorded) !== JSON.stringify(currentReceipt())) {
    throw new Error('Issue #87 visual evidence is stale; run bun run scripts/pr-assets/linkrank-feedback-packing-evidence.ts')
  }
  console.log('Issue #87 visual evidence is synchronized')
  process.exit(0)
}

const measurementOf = (id: string) => measurements.find(entry => entry.id === id)!
const panel = (label: string, gap: number, svg: string, state: 'before' | 'after'): string => `<figure class="${state}">
  <figcaption><span>${label}</span><strong>boundary gap: ${gap.toFixed(1)} px</strong></figcaption>
  <div class="visual">${svg}</div>
</figure>`
const rows = cases.map(spec => {
  const measurement = measurementOf(spec.id)
  return `<section class="matrix-row">
    <header><h2>${escapeHtml(spec.title)}</h2><p><b>Why:</b> ${escapeHtml(spec.why)}</p></header>
    <div class="pair">
      ${panel(`Before · ${BASELINE_COMMIT.slice(0, 8)}`, measurement.before, readFileSync(svgPath(spec), 'utf8'), 'before')}
      ${panel('After · issue #87 fix', measurement.after, currentRuntime.renderMermaidSVG(sourceOf(spec), { embedFontImport: false }), 'after')}
    </div>
    <footer><b>What to inspect:</b> ${escapeHtml(spec.inspect)}</footer>
  </section>`
}).join('')
const afterCards = cases.map(spec => {
  const measurement = measurementOf(spec.id)
  return `<section class="after-card"><h2>${escapeHtml(spec.title)}</h2>
    ${panel('After · issue #87 fix', measurement.after, currentRuntime.renderMermaidSVG(sourceOf(spec), { embedFontImport: false }), 'after')}
    <footer>${escapeHtml(spec.inspect)}</footer></section>`
}).join('')

const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) })
const page = await browser.newPage({ viewport: { width: 1840, height: 1400 }, deviceScaleFactor: 1 })
await page.setContent(`<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:#e4e4e7;color:#18181b;font-family:Arial,sans-serif}
  main{width:1800px;margin:20px;padding:26px;background:white;border:1px solid #d4d4d8;border-radius:18px}
  h1{margin:0 0 6px;font-size:30px}.subtitle{margin:0 0 20px;color:#52525b;font-size:15px;line-height:1.45}
  .matrix-row{border:1px solid #d4d4d8;border-radius:12px;overflow:hidden;margin-top:16px;background:#fff}
  .matrix-row>header{padding:12px 16px 10px;border-bottom:1px solid #e4e4e7}.matrix-row h2,.after-card h2{margin:0 0 6px;font-size:18px}
  p{margin:0;color:#52525b;font-size:13px;line-height:1.4}.pair{display:grid;grid-template-columns:1fr 1fr}
  figure{margin:0;min-width:0}figure+figure{border-left:1px solid #d4d4d8}
  figcaption{padding:8px 12px;display:flex;justify-content:space-between;align-items:center;background:#fafafa;border-bottom:1px solid #e4e4e7;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
  figcaption strong{padding:5px 8px;border-radius:999px}.before figcaption strong{color:#991b1b;background:#fee2e2}.after figcaption strong{color:#166534;background:#dcfce7}
  .visual{height:260px;display:flex;align-items:center;justify-content:center;padding:12px;overflow:hidden;background:white}
  .visual svg{display:block;max-width:100%!important;width:100%!important;max-height:236px!important;height:auto!important}
  footer{min-height:48px;border-top:1px solid #e4e4e7;padding:9px 14px;color:#3f3f46;background:#fafafa;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
  #after{margin-top:40px}.after-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.after-card{border:1px solid #d4d4d8;border-radius:12px;overflow:hidden}.after-card>h2{padding:12px 14px;margin:0;border-bottom:1px solid #e4e4e7}.after-card figure{border:0}.after-card .visual{height:300px}.after-card .visual svg{max-height:276px!important}
</style>
<main id="matrix"><h1>Issue #87 · link-rank regression matrix</h1>
<p class="subtitle">Renderer-generated SVGs · immutable before ${BASELINE_COMMIT} · issue #87 fix after · visible node-boundary measurements</p>${rows}</main>
<main id="after"><h1>Issue #87 · repaired output at native resolution</h1>
<p class="subtitle">All four flow directions for feedback length, plus both failing vertical packing directions. Every requested length-3 gap is ≥ ${MIN_GAP}px.</p>
<div class="after-grid">${afterCards}</div></main>`)
await page.evaluate(() => document.fonts?.ready)
mkdirSync(join(ROOT, 'docs', 'pr-assets'), { recursive: true })
await page.locator('#matrix').screenshot({ path: MATRIX_OUTPUT })
await page.locator('#after').screenshot({ path: AFTER_OUTPUT })
await page.close()
await browser.close()
writeFileSync(RECEIPT, `${JSON.stringify(currentReceipt(), null, 2)}\n`)
console.log(`wrote ${MATRIX_OUTPUT} and ${AFTER_OUTPUT}`)
