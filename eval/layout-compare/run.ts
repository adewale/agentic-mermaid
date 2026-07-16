// ============================================================================
// Layout before/after comparison harness (TODO.md BUILD-13).
//
// Layout work (fan-out trunks, fan-in grouping, subgraph direction,
// collapsible subgraphs) must show its effect, not just survive the drift
// sentinel. This harness renders a sample set twice — once per git state —
// and emits a side-by-side HTML report with perceptual-metric deltas.
//
// Usage:
//   git checkout main
//   bun run eval/layout-compare/run.ts snapshot --out /tmp/before.json
//   git checkout my-layout-branch
//   bun run eval/layout-compare/run.ts snapshot --out /tmp/after.json
//   bun run eval/layout-compare/run.ts report \
//     --before /tmp/before.json --after /tmp/after.json --out /tmp/report.html
//
// Samples: the mermaid-docs corpus plus any *.mmd files in
// eval/layout-compare/fixtures/ (for targeted probes, e.g. fan-in shapes).
// ============================================================================

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { parseRegisteredMermaid as parseMermaid, layoutMermaid, measureQuality, renderMermaidSVG, renderMermaidASCII } from '../../src/agent/index.ts'
import type { QualityMetrics } from '../../src/agent/index.ts'

const ROOT = join(import.meta.dir, '..', '..')
const CORPUS_PATH = join(ROOT, 'eval', 'mermaid-docs-corpus', 'corpus.json')
const FIXTURES_DIR = join(import.meta.dir, 'fixtures')

export interface SampleResult {
  id: string
  family: string
  source: string
  ok: boolean
  error?: string
  metrics?: QualityMetrics
  svg?: string
  ascii?: string
}

export interface Snapshot {
  label: string
  rev: string
  createdAt: string
  samples: SampleResult[]
}

interface SampleInput { id: string; family: string; source: string }

export function collectSamples(): SampleInput[] {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as Array<{ family: string; source: string; origin: string; index: number }>
  const samples: SampleInput[] = corpus.map(e => ({ id: `corpus/${e.family}/${e.index}`, family: e.family, source: e.source }))
  if (existsSync(FIXTURES_DIR)) {
    for (const name of readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.mmd')).sort()) {
      const source = readFileSync(join(FIXTURES_DIR, name), 'utf8')
      const parsed = parseMermaid(source)
      samples.push({ id: `fixture/${name}`, family: parsed.ok ? parsed.value.kind : 'unknown', source })
    }
  }
  return samples
}

export function snapshotSample(input: SampleInput, idPrefix: string): SampleResult {
  try {
    const parsed = parseMermaid(input.source)
    if (!parsed.ok) {
      return { id: input.id, family: input.family, source: input.source, ok: false, error: `parse: ${JSON.stringify(parsed.error).slice(0, 200)}` }
    }
    const metrics = measureQuality(layoutMermaid(parsed.value))
    const svg = renderMermaidSVG(input.source, { idPrefix })
    let ascii: string | undefined
    try {
      ascii = renderMermaidASCII(input.source)
    } catch {
      ascii = undefined // some families render SVG-only; that is not a failure
    }
    return { id: input.id, family: input.family, source: input.source, ok: true, metrics, svg, ascii }
  } catch (e) {
    return { id: input.id, family: input.family, source: input.source, ok: false, error: String(e).slice(0, 300) }
  }
}

export function buildSnapshot(label: string): Snapshot {
  let rev = 'unknown'
  try { rev = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim() } catch { /* not a repo */ }
  const samples = collectSamples().map((s, i) => snapshotSample(s, `lc${i}-`))
  return { label, rev, createdAt: new Date().toISOString(), samples }
}

// ---- Report ----------------------------------------------------------------

type Verdict = 'regression' | 'improvement' | 'changed' | 'unchanged' | 'status-changed'

export interface Comparison {
  id: string
  family: string
  verdict: Verdict
  notes: string[]
  before: SampleResult | undefined
  after: SampleResult | undefined
}

const LEGIBILITY_EPS = 0.01

export function compareSample(before: SampleResult | undefined, after: SampleResult | undefined): Comparison {
  const id = (after ?? before)!.id
  const family = (after ?? before)!.family
  const notes: string[] = []
  if (!before || !after || before.ok !== after.ok) {
    notes.push(`status: before=${before ? (before.ok ? 'ok' : 'error') : 'missing'} after=${after ? (after.ok ? 'ok' : 'error') : 'missing'}`)
    return { id, family, verdict: 'status-changed', notes, before, after }
  }
  if (!before.ok) return { id, family, verdict: 'unchanged', notes: ['both error'], before, after }

  const mb = before.metrics!
  const ma = after.metrics!
  let regressed = false
  let improved = false
  // QUAL-1: a family that previously had an EMPTY layout (nodeCount 0 — the
  // perceptual metrics were blind to it) gaining real geometry is an
  // IMPROVEMENT, never a faithfulness regression. While transitioning out of an
  // empty layout, the derived metrics (edgeCrossings, labelLegibility) move from
  // their trivial baselines (0, 1.0) to real values; those moves are an artifact
  // of the empty→measured transition, not a genuine layout regression, so they
  // must NOT flip the verdict to 'regression'. Only count drifts on a family
  // that was ALREADY measured (before had geometry) are real regressions.
  const fromEmpty = mb.nodeCount === 0 && mb.edgeCount === 0
  const transitionedToMeasured = fromEmpty && ma.nodeCount > 0
  const track = (name: string, b: number, a: number, higherIsBetter: boolean, eps = 0) => {
    if (Math.abs(a - b) <= eps) return
    const better = higherIsBetter ? a > b : a < b
    notes.push(`${name}: ${fmt(b)} → ${fmt(a)}${better ? ' ✓' : ' ✗'}`)
    if (transitionedToMeasured) return  // derived-metric move is part of the empty→measured improvement
    if (better) improved = true
    else regressed = true
  }
  track('edgeCrossings', mb.edgeCrossings, ma.edgeCrossings, false)
  track('labelLegibility', mb.labelLegibility, ma.labelLegibility, true, LEGIBILITY_EPS)
  if (mb.nodeCount !== ma.nodeCount) {
    if (transitionedToMeasured) { notes.push(`nodeCount: ${mb.nodeCount} → ${ma.nodeCount} ✓ (empty→measured)`); improved = true }
    else { notes.push(`nodeCount: ${mb.nodeCount} → ${ma.nodeCount} ✗`); regressed = true }
  }
  if (mb.edgeCount !== ma.edgeCount) {
    if (transitionedToMeasured) { notes.push(`edgeCount: ${mb.edgeCount} → ${ma.edgeCount} ✓ (empty→measured)`); improved = true }
    else { notes.push(`edgeCount: ${mb.edgeCount} → ${ma.edgeCount} ✗`); regressed = true }
  }

  const svgChanged = before.svg !== after.svg
  const asciiChanged = before.ascii !== after.ascii
  if (svgChanged) notes.push('svg bytes changed')
  if (asciiChanged) notes.push('ascii bytes changed')

  const verdict: Verdict = regressed ? 'regression' : improved ? 'improvement' : (svgChanged || asciiChanged) ? 'changed' : 'unchanged'
  return { id, family, verdict, notes, before, after }
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3)
}

export function compareSnapshots(before: Snapshot, after: Snapshot): Comparison[] {
  const byId = new Map(before.samples.map(s => [s.id, s]))
  const ids = new Set([...before.samples.map(s => s.id), ...after.samples.map(s => s.id)])
  const afterById = new Map(after.samples.map(s => [s.id, s]))
  return [...ids].map(id => compareSample(byId.get(id), afterById.get(id)))
}

const VERDICT_ORDER: Record<Verdict, number> = { 'status-changed': 0, regression: 1, improvement: 2, changed: 3, unchanged: 4 }

export function buildReportHtml(before: Snapshot, after: Snapshot): string {
  const comparisons = compareSnapshots(before, after).sort((a, b) =>
    VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || a.id.localeCompare(b.id))
  const counts = new Map<Verdict, number>()
  for (const c of comparisons) counts.set(c.verdict, (counts.get(c.verdict) ?? 0) + 1)

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const cell = (r: SampleResult | undefined) => {
    if (!r) return '<em>missing</em>'
    if (!r.ok) return `<pre class="err">${esc(r.error ?? 'error')}</pre>`
    const ascii = r.ascii ? `<details><summary>ASCII</summary><pre class="ascii">${esc(r.ascii)}</pre></details>` : ''
    return `<div class="svgbox">${r.svg ?? ''}</div>${ascii}`
  }

  const rows = comparisons
    .filter(c => c.verdict !== 'unchanged')
    .map(c => `
<section class="sample ${c.verdict}">
  <h3>${esc(c.id)} <span class="badge">${c.verdict}</span> <span class="family">${esc(c.family)}</span></h3>
  <p class="notes">${c.notes.map(esc).join(' · ') || 'no metric delta'}</p>
  <details><summary>source</summary><pre>${esc((c.after ?? c.before)!.source)}</pre></details>
  <div class="pair">
    <div><h4>before (${esc(before.rev)})</h4>${cell(c.before)}</div>
    <div><h4>after (${esc(after.rev)})</h4>${cell(c.after)}</div>
  </div>
</section>`)
    .join('\n')

  const summary = (['status-changed', 'regression', 'improvement', 'changed', 'unchanged'] as Verdict[])
    .map(v => `<li><strong>${counts.get(v) ?? 0}</strong> ${v}</li>`).join('')

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Layout comparison: ${esc(before.label)} → ${esc(after.label)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; background: #fafafa; color: #1c1c1c; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .svgbox { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 8px; overflow: auto; }
  .svgbox svg { max-width: 100%; height: auto; }
  pre { background: #f0f0f0; border-radius: 6px; padding: 8px; overflow: auto; font-size: 12px; }
  pre.ascii { line-height: 1.1; }
  pre.err { background: #fde8e8; }
  .sample { border: 1px solid #ddd; border-radius: 10px; padding: 12px 16px; margin: 16px 0; background: #fff; }
  .sample.regression { border-color: #d33; }
  .sample.status-changed { border-color: #d33; border-width: 2px; }
  .sample.improvement { border-color: #2a8; }
  .badge { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 8px; border-radius: 999px; background: #eee; }
  .regression .badge, .status-changed .badge { background: #fde8e8; }
  .improvement .badge { background: #e3f7ef; }
  .family { font-size: 12px; color: #777; }
  .notes { color: #444; font-size: 13px; }
</style></head>
<body>
<h1>Layout comparison</h1>
<p><strong>${esc(before.label)}</strong> (${esc(before.rev)}, ${esc(before.createdAt)}) →
   <strong>${esc(after.label)}</strong> (${esc(after.rev)}, ${esc(after.createdAt)})</p>
<ul>${summary}</ul>
<p>Unchanged samples are hidden. Verdicts: metric deltas use measureQuality
(edge crossings, label legibility) plus node/edge-count faithfulness;
"changed" means bytes differ with no metric movement.</p>
${rows}
</body></html>`
}

// ---- CLI -------------------------------------------------------------------

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

if (import.meta.main) {
  const cmd = process.argv[2]
  if (cmd === 'snapshot') {
    const out = arg('--out')
    if (!out) { console.error('snapshot requires --out <file.json>'); process.exit(2) }
    const snap = buildSnapshot(arg('--label') ?? out)
    writeFileSync(out, JSON.stringify(snap))
    const failed = snap.samples.filter(s => !s.ok).length
    console.log(`wrote ${out}: ${snap.samples.length} samples (${failed} errored) at ${snap.rev}`)
  } else if (cmd === 'report') {
    const beforePath = arg('--before')
    const afterPath = arg('--after')
    const out = arg('--out')
    if (!beforePath || !afterPath || !out) { console.error('report requires --before, --after, --out'); process.exit(2) }
    const before = JSON.parse(readFileSync(beforePath, 'utf8')) as Snapshot
    const after = JSON.parse(readFileSync(afterPath, 'utf8')) as Snapshot
    writeFileSync(out, buildReportHtml(before, after))
    const comparisons = compareSnapshots(before, after)
    const n = (v: Verdict) => comparisons.filter(c => c.verdict === v).length
    console.log(`wrote ${out}: ${n('status-changed')} status-changed, ${n('regression')} regressions, ${n('improvement')} improvements, ${n('changed')} changed, ${n('unchanged')} unchanged`)
    if (n('status-changed') + n('regression') > 0) process.exit(1)
  } else {
    console.error('usage: run.ts snapshot --out f.json [--label name] | report --before a.json --after b.json --out report.html')
    process.exit(2)
  }
}
