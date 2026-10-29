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
import { isDeepStrictEqual } from 'node:util'
import { parseRegisteredMermaid as parseMermaid, layoutMermaidWithReceipt, measureQuality, renderMermaidSVGWithReceipt, renderMermaidASCII } from '../../src/agent/index.ts'
import type { QualityMetrics } from '../../src/agent/index.ts'
import type { RenderOptions } from '../../src/types.ts'
import { validateSerializableRenderOptions, type RenderRequestReceipt } from '../../src/render-contract.ts'
import { compareCodePointStrings } from '../../src/shared/deterministic-order.ts'
import { namespaceSvgIds } from '../../src/renderer.ts'
import { attemptApi, failureCode, type ApiFailure } from './outcomes.ts'
import { generatedFlowchartSamples, graphStressSamples, type GeneratedFlowchartRange, type GeneratedFlowchartKind } from './generated.ts'

const ROOT = join(import.meta.dir, '..', '..')
const CORPUS_PATH = join(ROOT, 'eval', 'mermaid-docs-corpus', 'corpus.json')
const FIXTURES_DIR = join(import.meta.dir, 'fixtures')

export interface SampleResult {
  id: string
  family: string
  source: string
  ok: boolean
  error?: string
  errorCode?: string
  failures?: { layout?: ApiFailure; svg?: ApiFailure; ascii?: ApiFailure; metrics?: ApiFailure }
  /** JSON report projection; object aliases, Maps and descriptors are not preserved. */
  layout?: ReturnType<typeof layoutMermaidWithReceipt>['layout']
  metrics?: QualityMetrics
  svg?: string
  ascii?: string
  svgReceipt?: RenderRequestReceipt
  layoutReceipt?: RenderRequestReceipt
}

export interface Snapshot {
  label: string
  rev: string
  dirty?: boolean
  renderOptions?: RenderOptions
  population?: GeneratedFlowchartRange & { kind: 'generated-flowchart'; generator?: GeneratedFlowchartKind; terminal: 'not-requested' }
  createdAt: string
  samples: SampleResult[]
}

interface SampleInput { id: string; family: string; source: string }

export function collectSamples(options: { includeStress?: boolean } = {}): SampleInput[] {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as Array<{ family: string; source: string; origin: string; index: number }>
  const samples: SampleInput[] = corpus.map(e => ({ id: `corpus/${e.family}/${e.index}`, family: e.family, source: e.source }))
  if (existsSync(FIXTURES_DIR)) {
    for (const name of readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.mmd')).sort()) {
      const source = readFileSync(join(FIXTURES_DIR, name), 'utf8')
      const parsed = parseMermaid(source)
      samples.push({ id: `fixture/${name}`, family: parsed.ok ? parsed.value.kind : 'unknown', source })
    }
  }
  if (options.includeStress) samples.push(...graphStressSamples())
  return samples
}

export function snapshotSample(input: SampleInput, idPrefix: string, options: RenderOptions = {}, projection: { includeAscii?: boolean } = {}): SampleResult {
  const layout = attemptApi(() => layoutMermaidWithReceipt(input.source, { ...options, debug: true }))
  const rendered = attemptApi(() => renderMermaidSVGWithReceipt(input.source, { ...options, idPrefix }))
  const ascii = projection.includeAscii === false ? undefined : attemptApi(() => renderMermaidASCII(input.source, options))
  const metrics = layout.ok ? attemptApi(() => measureQuality(layout.value.layout)) : undefined
  const failures = { ...(!layout.ok ? { layout: layout.error } : {}), ...(!rendered.ok ? { svg: rendered.error } : {}),
    ...(ascii && !ascii.ok ? { ascii: ascii.error } : {}), ...(metrics && !metrics.ok ? { metrics: metrics.error } : {}) }
  const failure = !layout.ok ? layout.error : !rendered.ok ? rendered.error : metrics && !metrics.ok ? metrics.error : undefined
  return { id: input.id, family: input.family, source: input.source, ok: layout.ok && rendered.ok && metrics?.ok === true,
    ...(failure ? { error: `${failure.name}: ${failure.message}`, errorCode: failureCode(failure) } : {}),
    ...(Object.keys(failures).length ? { failures } : {}),
    ...(layout.ok ? { layout: layout.value.layout, layoutReceipt: JSON.parse(JSON.stringify(layout.value.receipt)) } : {}),
    ...(metrics?.ok ? { metrics: metrics.value } : {}),
    ...(rendered.ok ? { svg: rendered.value.svg, svgReceipt: JSON.parse(JSON.stringify(rendered.value.receipt)) } : {}),
    ...(ascii?.ok ? { ascii: ascii.value } : {}) }
}

export function buildSnapshot(label: string, options: { renderOptions?: RenderOptions; families?: readonly string[]; generated?: GeneratedFlowchartRange; generatedKind?: GeneratedFlowchartKind; includeStress?: boolean } = {}): Snapshot {
  let rev = 'unknown'
  let dirty = true
  try {
    rev = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim()
    dirty = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' }).length > 0
  } catch { /* not a repo */ }
  if (options.generated && !options.renderOptions?.graphLayout) throw new RangeError('Generated comparisons require an explicit graphLayout.backend')
  const all = options.generated ? generatedFlowchartSamples(options.generated, options.generatedKind) : collectSamples({ includeStress: options.includeStress })
  if (options.families?.some(family => !all.some(sample => sample.family === family))) throw new RangeError('Unknown snapshot family')
  const samples = all.filter(sample => !options.families || options.families.includes(sample.family))
    .map((s, i) => snapshotSample(s, `lc${i}-`, options.renderOptions, { includeAscii: !options.generated }))
  return { label, rev, dirty, ...(options.renderOptions ? { renderOptions: options.renderOptions } : {}),
    ...(options.generated ? { population: { ...options.generated, kind: 'generated-flowchart' as const, ...(options.generatedKind ? { generator: options.generatedKind } : {}), terminal: 'not-requested' as const } } : {}),
    createdAt: new Date().toISOString(), samples }
}

// ---- Report ----------------------------------------------------------------

type Verdict = 'regression' | 'improvement' | 'changed' | 'unchanged' | 'status-changed'
export type ComparisonMode = 'revision' | 'backend'

export interface Comparison {
  id: string
  family: string
  verdict: Verdict
  notes: string[]
  before: SampleResult | undefined
  after: SampleResult | undefined
}

export interface FamilyComparisonSummary {
  family: string
  samples: number
  adverse: number
  adverseRate: number
  counts: Record<Verdict, number>
}

export interface FamilyBalancedSummary {
  families: FamilyComparisonSummary[]
  /** Every family contributes equally, regardless of corpus size. */
  macroAdverseRate: number
  /** Every sample contributes equally; retained to expose corpus skew. */
  microAdverseRate: number
}

const LEGIBILITY_EPS = 0.01
const LABEL_MEASUREMENT_COUNTS = ['measuredNodes', 'unmeasuredNodes', 'hiddenNodes', 'semanticNodes',
  'measuredEdges', 'unmeasuredEdges', 'measuredLabels', 'unmeasuredLabels', 'hiddenLabels', 'semanticLabels'] as const

function admitComparisonSample(sample: SampleResult): void {
  const invalid = (field: string, expectation: string): never => {
    throw new TypeError(`Invalid layout comparison sample ${JSON.stringify(sample?.id)}: ${field} must be ${expectation}`)
  }
  const record = (value: unknown, field: string): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field, 'an object')
  }
  record(sample, 'sample')
  for (const field of ['id', 'family'] as const) if (typeof sample[field] !== 'string' || !sample[field]) invalid(field, 'a nonempty string')
  if (typeof sample.source !== 'string') invalid('source', 'a string')
  if (typeof sample.ok !== 'boolean') invalid('ok', 'a boolean')
  if (!sample.ok) return
  if (typeof sample.svg !== 'string' || !sample.svg) invalid('svg', 'a nonempty string for a successful sample')
  record(sample.metrics, 'metrics')
  const metrics = sample.metrics!
  const number = (value: unknown, field: string, count = false, maximum = Infinity): void => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum || (count && !Number.isSafeInteger(value))) {
      invalid(`metrics.${field}`, count ? 'a nonnegative safe integer' : maximum === 1 ? 'a finite number between 0 and 1' : 'a finite nonnegative number')
    }
  }
  for (const field of ['nodeCount', 'edgeCount', 'edgeCrossings'] as const) number(metrics[field], field, true)
  number(metrics.labelLegibility, 'labelLegibility', false, 1)
  // Omitted dimensions mean unavailable evidence. Null and malformed present
  // dimensions must not become zero through arithmetic coercion.
  if (metrics.labelConflicts !== undefined) {
    record(metrics.labelConflicts, 'metrics.labelConflicts')
    number(metrics.labelConflicts.total, 'labelConflicts.total', true)
  }
  if (metrics.routeOverlaps !== undefined) {
    record(metrics.routeOverlaps, 'metrics.routeOverlaps')
    for (const field of ['parallel', 'opposing'] as const) number(metrics.routeOverlaps[field], `routeOverlaps.${field}`, true)
  }
  if (metrics.routeGeometry !== undefined) {
    record(metrics.routeGeometry, 'metrics.routeGeometry')
    number(metrics.routeGeometry.bends, 'routeGeometry.bends', true)
    number(metrics.routeGeometry.length, 'routeGeometry.length')
    number(metrics.routeGeometry.area, 'routeGeometry.area')
  }
  if (metrics.labelMeasurement !== undefined) {
    record(metrics.labelMeasurement, 'metrics.labelMeasurement')
    for (const field of LABEL_MEASUREMENT_COUNTS) number(metrics.labelMeasurement[field], `labelMeasurement.${field}`, true)
  }
}

export function compareSample(before: SampleResult | undefined, after: SampleResult | undefined, mode: ComparisonMode = 'revision'): Comparison {
  if (!before && !after) throw new TypeError('Invalid layout comparison: at least one sample is required')
  if (before) admitComparisonSample(before)
  if (after) admitComparisonSample(after)
  const id = (after ?? before)!.id
  const family = (after ?? before)!.family
  const notes: string[] = []
  if (!before || !after) {
    notes.push(`status: before=${before ? (before.ok ? 'ok' : 'error') : 'missing'} after=${after ? (after.ok ? 'ok' : 'error') : 'missing'}`)
    return { id, family, verdict: 'status-changed', notes, before, after }
  }
  if (before.ok !== after.ok) {
    notes.push(after.ok ? 'support gained: error → render' : 'support lost: render → error')
    return { id, family, verdict: after.ok ? 'improvement' : 'regression', notes, before, after }
  }
  if (!before.ok) {
    const sameFailure = before.errorCode === after.errorCode && before.error === after.error
      && JSON.stringify(before.failures) === JSON.stringify(after.failures)
      && before.svg === after.svg && JSON.stringify(before.layout) === JSON.stringify(after.layout)
    return { id, family, verdict: sameFailure ? 'unchanged' : 'changed', notes: [sameFailure ? 'both error' : 'failure changed; inspect retained outcomes'], before, after }
  }

  const mb = before.metrics!
  const ma = after.metrics!
  let regressed = false
  let improved = false
  let measurementChanged = false
  for (const dimension of ['labelConflicts', 'routeOverlaps', 'routeGeometry', 'labelMeasurement'] as const) {
    if (mb[dimension] && !ma[dimension]) {
      notes.push(`${dimension}: measurement lost`)
      regressed = true
    } else if (!mb[dimension] && ma[dimension]) {
      notes.push(`${dimension}: measurement gained; geometry not compared`)
      measurementChanged = true
    }
  }
  if (mb.labelMeasurement && ma.labelMeasurement) for (const field of LABEL_MEASUREMENT_COUNTS) {
    const b = mb.labelMeasurement[field], a = ma.labelMeasurement[field]
    if (a === b) continue
    const lost = field.startsWith('measured') ? a < b : a > b
    notes.push(`labelMeasurement.${field}: ${b} → ${a}${lost ? ' ✗ (measurement or visibility lost)' : ' (coverage changed; geometry not compared)'}`)
    if (lost) regressed = true
    else measurementChanged = true
  }
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
  const track = (name: string, b: number, a: number, higherIsBetter: boolean, eps = 0, tradeoff = false) => {
    if (Math.abs(a - b) <= eps) return
    const better = higherIsBetter ? a > b : a < b
    notes.push(`${name}: ${fmt(b)} → ${fmt(a)}${better ? ' ✓' : ' ✗'}`)
    if (mode === 'backend' && tradeoff) return
    if (transitionedToMeasured) return  // derived-metric move is part of the empty→measured improvement
    if (better) improved = true
    else regressed = true
  }
  track('edgeCrossings', mb.edgeCrossings, ma.edgeCrossings, false)
  if (mb.labelConflicts && ma.labelConflicts) track('padded label conflicts', mb.labelConflicts.total, ma.labelConflicts.total, false)
  if (mb.routeOverlaps && ma.routeOverlaps) {
    track('opposing shared spans', mb.routeOverlaps.opposing, ma.routeOverlaps.opposing, false)
    track('same-endpoint shared spans', mb.routeOverlaps.parallel, ma.routeOverlaps.parallel, false)
  }
  track('labelLegibility', mb.labelLegibility, ma.labelLegibility, true, LEGIBILITY_EPS)
  if (mb.routeGeometry && ma.routeGeometry) {
    track('polyline bends', mb.routeGeometry.bends, ma.routeGeometry.bends, false, 0, true)
    track('route length', mb.routeGeometry.length, ma.routeGeometry.length, false, 0.01, true)
    track('canvas area', mb.routeGeometry.area, ma.routeGeometry.area, false, 0.01, true)
  }
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
  const backendChanged = JSON.stringify(before.svgReceipt?.layoutDecisions ?? []) !== JSON.stringify(after.svgReceipt?.layoutDecisions ?? [])
  if (svgChanged) notes.push('svg bytes changed')
  if (asciiChanged) notes.push('ascii bytes changed')
  if (backendChanged) notes.push('backend execution changed')

  const verdict: Verdict = regressed ? 'regression' : improved ? 'improvement' : (svgChanged || asciiChanged || backendChanged || measurementChanged) ? 'changed' : 'unchanged'
  return { id, family, verdict, notes, before, after }
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3)
}

export function compareSnapshots(before: Snapshot, after: Snapshot, mode: ComparisonMode = 'revision'): Comparison[] {
  for (const snapshot of [before, after]) {
    if (!snapshot || !Array.isArray(snapshot.samples)) throw new TypeError('Invalid layout comparison: samples must be an array')
    for (const sample of snapshot.samples) admitComparisonSample(sample)
    if (new Set(snapshot.samples.map(sample => sample.id)).size !== snapshot.samples.length) throw new TypeError('Invalid layout comparison: duplicate sample identities')
    if (snapshot.renderOptions !== undefined) {
      const problems = validateSerializableRenderOptions(snapshot.renderOptions)
      if (problems.length) throw new TypeError(`Invalid layout comparison render options: ${problems.join('; ')}`)
    }
  }
  if (!before.samples.length && !after.samples.length) throw new TypeError('Invalid layout comparison: a nonempty population is required')
  if (mode === 'backend') {
    if (before.rev !== after.rev || !/^[a-f0-9]{40}$/.test(before.rev) || before.dirty !== false || after.dirty !== false) {
      throw new Error('Backend comparisons require the same clean immutable revision')
    }
    const left = before.renderOptions?.graphLayout?.backend, right = after.renderOptions?.graphLayout?.backend
    if (!left || !right || left === right) throw new Error('Backend comparisons require two explicit different backends')
    const comparableOptions = (snapshot: Snapshot) => {
      const { graphLayout, ...options } = snapshot.renderOptions ?? {}
      return { ...options, fallback: graphLayout?.fallback ?? 'none' }
    }
    if (!isDeepStrictEqual(comparableOptions(before), comparableOptions(after))) throw new Error('Backend comparison render options differ')
    const sources = new Map(before.samples.map(sample => [sample.id, sample]))
    for (const sample of after.samples) {
      const original = sources.get(sample.id)
      if (original && (original.source !== sample.source || original.family !== sample.family)) throw new Error('Backend comparison inputs differ')
    }
  }
  const byId = new Map(before.samples.map(s => [s.id, s]))
  const ids = new Set([...before.samples.map(s => s.id), ...after.samples.map(s => s.id)])
  const afterById = new Map(after.samples.map(s => [s.id, s]))
  return [...ids].map(id => compareSample(byId.get(id), afterById.get(id), mode))
}

/** Report both sample-weighted and family-weighted outcomes. The docs corpus is
 * intentionally source-faithful rather than balanced (flowchart has far more
 * examples than journey/pie), so raw totals alone can conceal a complete
 * regression in a small family. */
export function summarizeComparisonsByFamily(comparisons: readonly Comparison[]): FamilyBalancedSummary {
  const byFamily = new Map<string, Comparison[]>()
  for (const comparison of comparisons) {
    const rows = byFamily.get(comparison.family) ?? []
    rows.push(comparison)
    byFamily.set(comparison.family, rows)
  }
  const verdicts: readonly Verdict[] = ['status-changed', 'regression', 'improvement', 'changed', 'unchanged']
  const families = [...byFamily.entries()]
    .sort(([a], [b]) => compareCodePointStrings(a, b))
    .map(([family, rows]) => {
      const counts = Object.fromEntries(verdicts.map(verdict => [verdict, rows.filter(row => row.verdict === verdict).length])) as Record<Verdict, number>
      const adverse = counts['status-changed'] + counts.regression
      return { family, samples: rows.length, adverse, adverseRate: adverse / rows.length, counts }
    })
  const totalAdverse = families.reduce((sum, family) => sum + family.adverse, 0)
  return {
    families,
    macroAdverseRate: families.length === 0 ? 0 : families.reduce((sum, family) => sum + family.adverseRate, 0) / families.length,
    microAdverseRate: comparisons.length === 0 ? 0 : totalAdverse / comparisons.length,
  }
}

const VERDICT_ORDER: Record<Verdict, number> = { 'status-changed': 0, regression: 1, improvement: 2, changed: 3, unchanged: 4 }

export function buildReportHtml(before: Snapshot, after: Snapshot, mode: ComparisonMode = 'revision'): string {
  const comparisons = compareSnapshots(before, after, mode).sort((a, b) =>
    VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || compareCodePointStrings(a.id, b.id))
  const balanced = summarizeComparisonsByFamily(comparisons)
  const counts = new Map<Verdict, number>()
  for (const c of comparisons) counts.set(c.verdict, (counts.get(c.verdict) ?? 0) + 1)

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const cell = (r: SampleResult | undefined, prefix: string) => {
    if (!r) return '<em>missing</em>'
    if (!r.ok) return `<pre class="err">${esc(r.error ?? 'error')}</pre>`
    const ascii = r.ascii ? `<details><summary>ASCII</summary><pre class="ascii">${esc(r.ascii)}</pre></details>` : ''
    const evidence = { metrics: r.metrics, svgReceipt: r.svgReceipt, layoutReceipt: r.layoutReceipt }
    return `<div class="svgbox">${namespaceSvgIds(r.svg ?? '', prefix)}</div>${ascii}<details><summary>Measured quality and backend receipts</summary><pre>${esc(JSON.stringify(evidence, null, 2))}</pre></details>`
  }

  const rows = comparisons
    .filter(c => c.verdict !== 'unchanged')
    .map((c, index) => `
<section class="sample ${c.verdict}">
  <h3>${esc(c.id)} <span class="badge">${c.verdict}</span> <span class="family">${esc(c.family)}</span></h3>
  <p class="notes">${c.notes.map(esc).join(' · ') || 'no metric delta'}</p>
  <details><summary>source</summary><pre>${esc((c.after ?? c.before)!.source)}</pre></details>
  <div class="pair">
    <div><h4>before (${esc(before.rev)})</h4>${cell(c.before, `lc-before-${index}-`)}</div>
    <div><h4>after (${esc(after.rev)})</h4>${cell(c.after, `lc-after-${index}-`)}</div>
  </div>
</section>`)
    .join('\n')

  const summary = (['status-changed', 'regression', 'improvement', 'changed', 'unchanged'] as Verdict[])
    .map(v => `<li><strong>${counts.get(v) ?? 0}</strong> ${v}</li>`).join('')

  const familyRows = balanced.families.map(family => `<tr>
    <td>${esc(family.family)}</td><td>${family.samples}</td>
    <td>${family.counts['status-changed']}</td><td>${family.counts.regression}</td>
    <td>${family.counts.improvement}</td><td>${family.counts.changed}</td><td>${family.counts.unchanged}</td>
    <td>${(family.adverseRate * 100).toFixed(1)}%</td>
  </tr>`).join('')

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
  table { border-collapse: collapse; background: #fff; }
  th, td { border: 1px solid #ddd; padding: 5px 8px; text-align: right; }
  th:first-child, td:first-child { text-align: left; }
</style></head>
<body>
<h1>Layout comparison</h1>
<p>${mode === 'backend'
  ? 'Backend comparison at one revision. Verdicts guard support, label measurement/visibility coverage, node/edge counts, crossings, label legibility, label conflicts and shared-route overlaps. Bends, route length and canvas area remain visible tradeoffs; they do not change the verdict.'
  : 'Revision comparison. Every measured dimension contributes to the regression verdict, including bends, route length and canvas area.'}</p>
<p><strong>${esc(before.label)}</strong> (${esc(before.rev)}, ${esc(before.createdAt)}) →
   <strong>${esc(after.label)}</strong> (${esc(after.rev)}, ${esc(after.createdAt)})</p>
<p>Before options: <code>${esc(JSON.stringify(before.renderOptions ?? {}))}</code>${before.dirty ? ' (working tree modified)' : ''};
after options: <code>${esc(JSON.stringify(after.renderOptions ?? {}))}</code>${after.dirty ? ' (working tree modified)' : ''}.</p>
<p>Generated population: before <code>${esc(JSON.stringify(before.population ?? null))}</code>; after <code>${esc(JSON.stringify(after.population ?? null))}</code>. These snapshots measure quality, not execution cost.</p>
<ul>${summary}</ul>
<p><strong>Family-balanced adverse rate:</strong> ${(balanced.macroAdverseRate * 100).toFixed(1)}%
   (sample-weighted: ${(balanced.microAdverseRate * 100).toFixed(1)}%).</p>
<details open><summary>Per-family outcomes</summary>
<table><thead><tr><th>family</th><th>samples</th><th>status</th><th>regressions</th><th>improvements</th><th>changed</th><th>unchanged</th><th>adverse</th></tr></thead>
<tbody>${familyRows}</tbody></table></details>
<p>Unchanged samples are hidden. Verdicts: metric deltas use measureQuality
(edge crossings, measured label conflicts and shared spans when available, label legibility,
polyline bends, route length and canvas area) plus node/edge-count faithfulness;
"changed" means bytes or backend decisions differ with no metric movement.</p>
<p>Support gains are improvements; support losses are regressions. Missing population members
remain adverse status changes. Every measured decline remains visible in the notes even
when another dimension improves. Smaller area or fewer bends alone does not establish human preference.</p>
<p>Quality comes from a separate public-layout call, not the retained SVG artifact.
Preview IDs are scoped per panel; original SVG bytes and digests remain in the JSON snapshots.
Full measurements and actual backend choices are expandable for each rendered
sample. Spacing, area, proportions and subjective appearance still need review;
No timing is measured here; this report does not establish complete aesthetic parity or performance.</p>
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
    const backend = arg('--graph-layout'), fallback = arg('--graph-layout-fallback')
    if (fallback && !backend) throw new RangeError('--graph-layout-fallback requires --graph-layout')
    const renderOptions = backend ? { graphLayout: { backend, ...(fallback ? { fallback } : {}) } } as RenderOptions : undefined
    const problems = renderOptions ? validateSerializableRenderOptions(renderOptions) : []
    if (problems.length) throw new RangeError(JSON.stringify(problems))
    const count = arg('--generated-count'), start = arg('--generated-start'), generatedKind = arg('--generated-kind') as GeneratedFlowchartKind | undefined
    if (generatedKind && count === undefined) throw new RangeError('--generated-kind requires --generated-count')
    if (start !== undefined && count === undefined) throw new RangeError('--generated-start requires --generated-count')
    const generated = count === undefined ? undefined : { start: start === undefined ? 0 : Number(start), count: Number(count) }
    const snap = buildSnapshot(arg('--label') ?? out, { renderOptions, families: arg('--families')?.split(','), generated, generatedKind, includeStress: process.argv.includes('--stress') })
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
    const mode = arg('--comparison') ?? 'revision'
    if (mode !== 'revision' && mode !== 'backend') throw new RangeError('Unknown comparison mode')
    const comparisons = compareSnapshots(before, after, mode)
    writeFileSync(out, buildReportHtml(before, after, mode))
    const n = (v: Verdict) => comparisons.filter(c => c.verdict === v).length
    console.log(`wrote ${out} (${mode} comparison): ${n('status-changed')} status-changed, ${n('regression')} regressions, ${n('improvement')} improvements, ${n('changed')} changed, ${n('unchanged')} unchanged`)
    if (n('status-changed') + n('regression') > 0) process.exit(1)
  } else {
    console.error('usage: run.ts snapshot --out f.json [--label name] [--graph-layout elk|agentic] [--graph-layout-fallback none|elk] [--families flowchart,state] [--stress] [--generated-start 0 --generated-count 160] [--generated-kind lcg-v1|sha256-counter-v1] | report --before a.json --after b.json --out report.html [--comparison revision|backend]')
    process.exit(2)
  }
}
