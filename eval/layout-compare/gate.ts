// ============================================================================
// Same-host paired layout gate: is the head revision better, never worse?
//
// `run.ts report` lists every metric that moved. This gate decides. Both
// revisions lay out the same inputs on the same machine with the same Bun, in
// separate processes, interleaved over several rounds, and with the position
// and ELK caches off. Head's own `measureQuality` and rubric then score BOTH
// layouts, so a scorer change cannot flatter one side, and the engine's
// declared objective (`compareLayoutPreference`, the comparator candidate
// selection uses) ranks them on every axis the published layout shows. Same-host pairing removes the cross-machine float drift that keeps the
// committed heuristic-tracker baseline from being a CI gate.
//
// Per sample:
//   broken     support lost, authored nodes/edges lost, graph geometry or
//              paint certification lost, label measurement lost, or head
//              nondeterministic.
//   regressed  the declared objective prefers base. Its crossing axis
//              counts contacts between unrelated routes as crossings.
//   improved   the declared objective prefers head (or head fixed a break).
//   unchanged  objective tie; secondary metric moves are listed as tradeoffs.
//
// Exit 1 on any broken sample; on any regressed sample unless
// --accept-objective-regressions (CI passes it when the PR carries a
// head-scoped `layout-tradeoff-approved` label); and when --max-slowdown is
// given and head's geometric-mean layout time ratio exceeds it.
//
//   bun run layout:gate --base origin/main [--balanced] [--generated-count 64]
//     [--rounds 2] [--reps 2] [--families flowchart,state] [--max-slowdown 1.5]
//     [--accept-objective-regressions] [--json out.json] [--markdown out.md]
// ============================================================================

import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { measureQuality, type QualityMetrics } from '../../src/agent/index.ts'
import type { RenderedLayout } from '../../src/agent/types.ts'
import { compareLayoutPreference, type LayoutPreferenceScore, type PreferenceCriterion } from '../../src/layout/certification.ts'
import { measureRubricMetrics, portEndpointRate } from '../../src/layout-rubric.ts'
import { normalizeMermaidSource } from '../../src/mermaid-source.ts'
import { parseMermaid } from '../../src/parser.ts'
import { resolveRenderStyle } from '../../src/styles.ts'
import type { PositionedGraph, PositionedGroup } from '../../src/types.ts'
import { collectSamples } from './run.ts'
import { generatedFlowchartSamples, graphStressSamples } from './generated.ts'

const HEAD_ROOT = resolve(import.meta.dir, '..', '..')
const GRAPH_FAMILIES = new Set(['flowchart', 'state', 'class', 'er', 'requirement', 'architecture'])

export interface GateInput { key: string; family: string; source: string; options: Record<string, unknown> }
export interface CapturedSample { key: string; ok: boolean; error?: string; layout?: unknown; digest?: string; ms: number[]
  /** Graph geometry certification from the receipt; absent when certified or not reported. */
  geometry?: { status: string; kinds: string[] } }

export type GateVerdict = 'broken' | 'regressed' | 'improved' | 'unchanged'
export interface GateResult {
  key: string
  family: string
  verdict: GateVerdict
  /** Objective axis that decided, when the objective decided. */
  criterion?: PreferenceCriterion
  notes: string[]
  /** Secondary metrics that moved against head without deciding the verdict. */
  tradeoffs: string[]
  baseMs?: number
  headMs?: number
}

// ---- Capture (runs once per revision, in that revision's checkout) ----------

const CAPTURE = `
const { createHash } = await import('node:crypto')
const api = await import(process.env.GATE_ROOT + '/src/agent/index.ts')
const inputs = JSON.parse(await Bun.file(process.env.GATE_INPUTS).text())
const reps = Number(process.env.GATE_REPS)
const out = []
for (const input of inputs) {
  const ms = []
  let layout, receipt, error
  for (let i = 0; i <= reps; i++) {
    const start = performance.now()
    try { ({ layout, receipt } = api.layoutMermaidWithReceipt(input.source, input.options)) } catch (e) { error = String(e && e.message || e); break }
    if (i > 0) ms.push(performance.now() - start)
  }
  if (error !== undefined) { out.push({ key: input.key, ok: false, error, ms }); continue }
  const json = JSON.stringify(layout)
  const geometry = receipt && receipt.layoutCertification && receipt.layoutCertification.geometry
  out.push({ key: input.key, ok: true, layout: process.env.GATE_KEEP_LAYOUT === '1' ? JSON.parse(json) : undefined,
    digest: createHash('sha256').update(json).digest('hex'), ms,
    ...(geometry && geometry.status !== 'passed' ? { geometry: { status: geometry.status, kinds: (geometry.violations || []).map(v => v.kind) } } : {}) })
}
await Bun.write(process.env.GATE_OUT, JSON.stringify(out))
`

function capture(root: string, inputsPath: string, outPath: string, reps: number, keepLayout: boolean): CapturedSample[] {
  const child = Bun.spawnSync(['bun', '-e', CAPTURE], {
    cwd: root, stdout: 'inherit', stderr: 'inherit',
    env: { ...process.env, GATE_ROOT: root, GATE_INPUTS: inputsPath, GATE_OUT: outPath, GATE_REPS: String(reps),
      GATE_KEEP_LAYOUT: keepLayout ? '1' : '0',
      // Timing and geometry must come from real work, not a warm cache.
      AGENTIC_MERMAID_ELK_CACHE: '0', AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' },
  })
  if (child.exitCode !== 0) throw new Error(`capture failed in ${root} (exit ${child.exitCode})`)
  return JSON.parse(readFileSync(outPath, 'utf8')) as CapturedSample[]
}

// ---- Classification (pure; head's scorer for both sides) ---------------------

/** The objective axes the quality metrics do not carry: canonical-port rate
 * and peer-barycentre offset, measured on the published layout with the
 * rubric predicates candidate selection scores. Only families laid out by the
 * graph pipeline rank them; elsewhere they tie. */
export type ObjectiveGeometry = Pick<LayoutPreferenceScore, 'nonCanonicalEndpointRate' | 'peerBarycenterDelta'>
const PIPELINE_FAMILIES = new Set(['flowchart', 'state'])

export function objectiveGeometry(input: GateInput, layout: RenderedLayout): ObjectiveGeometry | undefined {
  if (!PIPELINE_FAMILIES.has(input.family)) return undefined
  const groups: PositionedGroup[] = layout.groups.map(group => ({ id: group.id, label: group.label ?? '', x: group.x, y: group.y, width: group.w, height: group.h, children: [] }))
  const positioned = {
    width: layout.bounds.w, height: layout.bounds.h, groups,
    nodes: layout.nodes.map(node => ({ id: node.id, label: node.label ?? '', shape: node.shape, x: node.x, y: node.y, width: node.w, height: node.h })),
    edges: layout.edges.map(edge => ({ source: edge.from, target: edge.to, style: edge.visibility === 'hidden' ? 'invisible' : 'solid', points: edge.path.map(([x, y]) => ({ x, y })) })),
  } as unknown as PositionedGraph
  const symmetry = measureRubricMetrics(parseMermaid(normalizeMermaidSource(input.source).text), positioned, ['symErr'], resolveRenderStyle({})).symErr ?? 0
  return { nonCanonicalEndpointRate: 1 - portEndpointRate(positioned), peerBarycenterDelta: Math.round(symmetry * 1000) / 1000 }
}

/** The declared objective, read from the published projection in the
 * objective's own order. Title readability cannot be observed and ties on
 * both sides; so do the port and barycentre axes when `objective` is absent.
 * The crossing axis counts each contact between unrelated routes (a shared
 * corner, a T-junction, a shared run) as a crossing: such a contact hides at
 * least one, so drawing a crossing as a contact cannot score better.
 * Area is the drawn canvas in px²; `classify` ties two areas within 1% of each
 * other, because the canvas includes bands the engine's candidate area excludes. */
export function projectedPreferenceScore(metrics: QualityMetrics, objective?: ObjectiveGeometry): LayoutPreferenceScore {
  const area = metrics.routeGeometry?.area ?? 0
  return {
    unreadableTitles: 0,
    edgeCrossings: metrics.edgeCrossings + (metrics.routeContacts?.touches ?? 0) + (metrics.routeContacts?.overlaps ?? 0),
    labelConflicts: metrics.labelConflicts?.total ?? 0,
    totalBends: metrics.routeGeometry?.bends ?? 0,
    nonCanonicalEndpointRate: objective?.nonCanonicalEndpointRate ?? 0,
    peerBarycenterDelta: objective?.peerBarycenterDelta ?? 0,
    area,
  }
}

/** Hard axes on which `to` lost something `from` had. */
function losses(from: QualityMetrics, to: QualityMetrics): { axis: string; from: string | number; to: string | number }[] {
  const lost: { axis: string; from: string | number; to: string | number }[] = []
  if (to.nodeCount !== from.nodeCount) lost.push({ axis: 'nodes', from: from.nodeCount, to: to.nodeCount })
  if (to.edgeCount !== from.edgeCount) lost.push({ axis: 'edges', from: from.edgeCount, to: to.edgeCount })
  const paint = (m: QualityMetrics) => m.paintCertification?.status ?? 'absent'
  if (paint(from) === 'passed' && paint(to) !== 'passed') lost.push({ axis: 'paint certification', from: paint(from), to: paint(to) })
  const measured = (m: QualityMetrics) => (m.labelMeasurement?.measuredLabels ?? 0) + (m.labelMeasurement?.measuredNodes ?? 0)
  if (from.labelMeasurement && measured(to) < measured(from)) lost.push({ axis: 'measured labels/nodes', from: measured(from), to: measured(to) })
  return lost
}

function tradeoffNotes(base: QualityMetrics, head: QualityMetrics): string[] {
  const notes: string[] = []
  const worse = (name: string, b: number | undefined, a: number | undefined, higherIsBetter = false, eps = 0) => {
    if (b === undefined || a === undefined || Math.abs(a - b) <= eps) return
    if (higherIsBetter ? a < b : a > b) notes.push(`${name} ${Number(b.toFixed(3))} → ${Number(a.toFixed(3))}`)
  }
  worse('opposing shared spans', base.routeOverlaps?.opposing, head.routeOverlaps?.opposing)
  worse('same-endpoint shared spans', base.routeOverlaps?.parallel, head.routeOverlaps?.parallel)
  worse('runs beside unattached borders', base.routeClearance?.borderRuns, head.routeClearance?.borderRuns)
  worse('short or tangent end shafts', base.routeClearance?.terminalShafts, head.routeClearance?.terminalShafts)
  worse('ends at a corner', base.routeClearance?.cornerEnds, head.routeClearance?.cornerEnds)
  worse('label legibility', base.labelLegibility, head.labelLegibility, true, 0.01)
  worse('label–edge proximity', base.labelEdgeProximity, head.labelEdgeProximity, true, 0.5)
  worse('minimum node spacing', base.minimumNodeSpacing, head.minimumNodeSpacing, true, 0.5)
  worse('route length', base.routeGeometry?.length, head.routeGeometry?.length, false, Math.max(1, (base.routeGeometry?.length ?? 0) * 0.01))
  return notes
}

const median = (values: readonly number[]) => {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length % 2 ? sorted[sorted.length >> 1]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
}

/** `base`/`head` hold one capture per round; round 0 carries the layout. */
export function classify(input: GateInput, base: readonly CapturedSample[], head: readonly CapturedSample[],
  score: (layout: unknown) => QualityMetrics = layout => measureQuality(layout as never),
  objective: (layout: unknown) => ObjectiveGeometry | undefined = layout => objectiveGeometry(input, layout as RenderedLayout)): GateResult {
  const result: GateResult = { key: input.key, family: input.family, verdict: 'unchanged', notes: [], tradeoffs: [] }
  const timing = (rounds: readonly CapturedSample[]) => median(rounds.map(round => median(round.ms)).filter((value): value is number => value !== undefined))
  result.baseMs = timing(base)
  result.headMs = timing(head)
  const [b, h] = [base[0]!, head[0]!]
  if (new Set(head.map(round => round.digest)).size > 1) {
    return { ...result, verdict: 'broken', notes: ['head geometry differs between identical runs (nondeterministic)'] }
  }
  if (!h.ok) return { ...result, verdict: b.ok ? 'broken' : 'unchanged', notes: [b.ok ? `support lost: ${h.error}` : 'both error'] }
  if (!b.ok) return { ...result, verdict: 'improved', notes: ['support gained: error → layout'] }
  // Drawn but no longer certified is a lost hard guarantee, whatever it scores.
  if (h.geometry && !b.geometry) return { ...result, verdict: 'broken', notes: [`geometry certification lost: ${h.geometry.kinds.join(', ') || h.geometry.status}`] }
  if (b.geometry && !h.geometry) return { ...result, verdict: 'improved', notes: [`geometry certification regained: ${b.geometry.kinds.join(', ') || b.geometry.status}`] }
  // Both uncertified: each violation head adds is a hard loss; shedding one
  // with none added is a hard gain.
  if (b.geometry && h.geometry) {
    const added = surplus(h.geometry.kinds, b.geometry.kinds), shed = surplus(b.geometry.kinds, h.geometry.kinds)
    if (added.length) return { ...result, verdict: 'broken', notes: [`geometry violations added: ${added.join(', ')}`] }
    if (shed.length) return { ...result, verdict: 'improved', notes: [`geometry violations removed: ${shed.join(', ')}`] }
  }
  if (b.digest === h.digest) return result
  let headMetrics: QualityMetrics, headObjective: ObjectiveGeometry | undefined
  try { headMetrics = score(h.layout); headObjective = objective(h.layout) } catch (error) {
    return { ...result, verdict: 'broken', notes: [`head layout cannot be scored: ${error instanceof Error ? error.message : String(error)}`] }
  }
  let baseMetrics: QualityMetrics, baseObjective: ObjectiveGeometry | undefined
  try { baseMetrics = score(b.layout); baseObjective = objective(b.layout) } catch (error) {
    return { ...result, notes: [`base layout cannot be scored by head; no comparison: ${error instanceof Error ? error.message : String(error)}`] }
  }
  const broken = losses(baseMetrics, headMetrics)
  if (broken.length) return { ...result, verdict: 'broken', notes: broken.map(loss => `${loss.axis} ${loss.from} → ${loss.to}`) }
  const fixed = losses(headMetrics, baseMetrics)
  result.tradeoffs = tradeoffNotes(baseMetrics, headMetrics)
  if (fixed.length) return { ...result, verdict: 'improved', notes: fixed.map(gain => `${gain.axis} ${gain.to} → ${gain.from}`) }
  const [baseScore, headScore] = [projectedPreferenceScore(baseMetrics, baseObjective), projectedPreferenceScore(headMetrics, headObjective)]
  if (baseScore.area > 0 && headScore.area > 0 && Math.abs(Math.log(headScore.area / baseScore.area)) < Math.log(1.01)) headScore.area = baseScore.area
  const decision = compareLayoutPreference(baseScore, headScore)
  if (decision.criterion === undefined) return { ...result, notes: ['geometry changed; objective tied'] }
  const pair = `${decision.criterion} ${fmt(baseScore[decision.criterion])} → ${fmt(headScore[decision.criterion])}`
  return { ...result, verdict: decision.order < 0 ? 'improved' : 'regressed', criterion: decision.criterion, notes: [decision.criterion === 'area' ? 'canvas area changed by ≥1%' : pair] }
}

/** Each entry of `from` beyond its count in `to`, one per extra occurrence. */
function surplus(from: readonly string[], to: readonly string[]): string[] {
  const left = new Map<string, number>()
  for (const kind of to) left.set(kind, (left.get(kind) ?? 0) + 1)
  return from.filter(kind => {
    const count = left.get(kind) ?? 0
    left.set(kind, count - 1)
    return count <= 0
  })
}

const fmt = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(3)

export interface GateSummary { results: GateResult[]; counts: Record<GateVerdict, number>; slowdown?: number }

export function summarize(results: GateResult[]): GateSummary {
  const counts = { broken: 0, regressed: 0, improved: 0, unchanged: 0 }
  for (const result of results) counts[result.verdict]++
  const ratios = results.flatMap(result => result.baseMs && result.headMs ? [Math.log(result.headMs / result.baseMs)] : [])
  return { results, counts, ...(ratios.length ? { slowdown: Math.exp(ratios.reduce((a, b) => a + b, 0) / ratios.length) } : {}) }
}

export function markdown(summary: GateSummary, base: string, head: string): string {
  const { counts } = summary
  const lines = [`## Paired layout gate`, '', `Base \`${base}\` vs head \`${head}\`, same host, caches off. Objective: \`compareLayoutPreference\` on head-scored projections.`, '',
    `| broken | regressed | improved | unchanged | geometric-mean layout time (head/base) |`, '|---:|---:|---:|---:|---:|',
    `| ${counts.broken} | ${counts.regressed} | ${counts.improved} | ${counts.unchanged} | ${summary.slowdown === undefined ? 'n/a' : summary.slowdown.toFixed(3) + '×'} |`, '']
  const table = (title: string, rows: GateResult[], extra = false) => {
    if (!rows.length) return
    lines.push(`### ${title} (${rows.length})`, '', '| sample | evidence |' + (extra ? ' tradeoffs |' : ''), '|---|---|' + (extra ? '---|' : ''))
    for (const row of rows) lines.push(`| \`${row.key}\` | ${row.notes.join('; ')} |` + (extra ? ` ${row.tradeoffs.join('; ') || '—'} |` : ''))
    lines.push('')
  }
  table('Broken', summary.results.filter(r => r.verdict === 'broken'))
  table('Objective regressions', summary.results.filter(r => r.verdict === 'regressed'), true)
  table('Improvements', summary.results.filter(r => r.verdict === 'improved'), true)
  table('Unchanged objective with secondary tradeoffs', summary.results.filter(r => r.verdict === 'unchanged' && r.tradeoffs.length), true)
  const slow = summary.results.filter(r => r.baseMs && r.headMs && r.baseMs >= 5).sort((a, b) => b.headMs! / b.baseMs! - a.headMs! / a.baseMs!).slice(0, 8)
  if (slow.length) {
    lines.push('### Largest layout-time ratios (samples ≥5 ms on base)', '', 'Single-sample ratios are noisy at CI repetition counts; only the geometric mean above is gated.', '', '| sample | base ms | head ms | ratio |', '|---|---:|---:|---:|')
    for (const row of slow) lines.push(`| \`${row.key}\` | ${row.baseMs!.toFixed(1)} | ${row.headMs!.toFixed(1)} | ${(row.headMs! / row.baseMs!).toFixed(2)}× |`)
    lines.push('')
  }
  return lines.join('\n')
}

// ---- Corpus and CLI ---------------------------------------------------------

export function gateInputs(options: { families?: readonly string[]; generatedCount: number; balanced: boolean }): GateInput[] {
  const samples = [...collectSamples({ includeStress: false }), ...graphStressSamples(),
    ...(options.generatedCount > 0 ? generatedFlowchartSamples({ start: 0, count: options.generatedCount }) : [])]
    .filter(sample => !options.families || options.families.includes(sample.family))
  const inputs: GateInput[] = samples.map(sample => ({ key: sample.id, family: sample.family, source: sample.source, options: {} }))
  if (options.balanced) for (const sample of samples) if (GRAPH_FAMILIES.has(sample.family)) {
    inputs.push({ key: `${sample.id}#balanced`, family: sample.family, source: sample.source, options: { graphLayout: { quality: 'balanced' } } })
  }
  return inputs
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function git(args: string[], cwd = HEAD_ROOT): string {
  const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`)
  return result.stdout.toString().trim()
}

/** A directory is used as the base checkout; anything else is a git revision. */
function prepareBase(base: string, work: string): { root: string; cleanup: () => void } {
  if (existsSync(join(base, 'src', 'agent', 'index.ts'))) return { root: resolve(base), cleanup: () => {} }
  const root = join(work, 'base')
  git(['worktree', 'add', '--detach', root, base])
  const cleanup = () => { try { git(['worktree', 'remove', '--force', root]) } catch { /* already gone */ } }
  try {
    if (readFileSync(join(root, 'bun.lock'), 'utf8') === readFileSync(join(HEAD_ROOT, 'bun.lock'), 'utf8')) symlinkSync(join(HEAD_ROOT, 'node_modules'), join(root, 'node_modules'))
    else if (Bun.spawnSync(['bun', 'install', '--frozen-lockfile'], { cwd: root, stdout: 'inherit', stderr: 'inherit' }).exitCode !== 0) throw new Error('base dependency install failed')
  } catch (error) { cleanup(); throw error }
  return { root, cleanup }
}

if (import.meta.main) {
  const baseArg = arg('--base')
  if (!baseArg) { console.error('usage: gate.ts --base <revision|checkout> [--balanced] [--generated-count N] [--rounds N] [--reps N] [--families a,b] [--max-slowdown X] [--accept-objective-regressions] [--json f] [--markdown f]'); process.exit(2) }
  const rounds = Math.max(1, Number(arg('--rounds') ?? 2)), reps = Math.max(1, Number(arg('--reps') ?? 2))
  const maxSlowdown = arg('--max-slowdown') === undefined ? undefined : Number(arg('--max-slowdown'))
  const inputs = gateInputs({ families: arg('--families')?.split(','), generatedCount: Number(arg('--generated-count') ?? 0), balanced: process.argv.includes('--balanced') })
  const work = mkdtempSync(join(tmpdir(), 'layout-gate-'))
  const inputsPath = join(work, 'inputs.json')
  writeFileSync(inputsPath, JSON.stringify(inputs))
  const { root: baseRoot, cleanup } = prepareBase(baseArg, work)
  const captured = { base: [] as CapturedSample[][], head: [] as CapturedSample[][] }
  try {
    for (let round = 0; round < rounds; round++) {
      // Alternate which revision runs first so machine drift cannot favour one.
      const order = round % 2 === 0 ? (['base', 'head'] as const) : (['head', 'base'] as const)
      for (const side of order) {
        const root = side === 'base' ? baseRoot : HEAD_ROOT
        console.error(`round ${round + 1}/${rounds}: ${side} (${inputs.length} inputs)`)
        captured[side].push(capture(root, inputsPath, join(work, `${side}-${round}.json`), reps, round === 0))
      }
    }
  } finally { cleanup() }
  const byKey = (side: 'base' | 'head', key: string) => captured[side].map(round => round.find(sample => sample.key === key)!)
  const summary = summarize(inputs.map(input => classify(input, byKey('base', input.key), byKey('head', input.key))))
  let baseRev = baseArg
  try { baseRev = git(['rev-parse', '--short', `${baseArg}^{commit}`]) } catch { /* a directory */ }
  const report = markdown(summary, baseRev, git(['rev-parse', '--short', 'HEAD']))
  const json = arg('--json'), md = arg('--markdown')
  if (json) writeFileSync(json, JSON.stringify(summary, null, 2))
  if (md) writeFileSync(md, report)
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n', { flag: 'a' })
  console.log(report)
  rmSync(work, { recursive: true, force: true })
  const failures: string[] = []
  if (summary.counts.broken) failures.push(`${summary.counts.broken} broken sample(s)`)
  if (summary.counts.regressed && !process.argv.includes('--accept-objective-regressions')) failures.push(`${summary.counts.regressed} objective regression(s); label the PR layout-tradeoff-approved if intended`)
  if (maxSlowdown !== undefined && summary.slowdown !== undefined && summary.slowdown > maxSlowdown) failures.push(`layout time ${summary.slowdown.toFixed(3)}× exceeds ${maxSlowdown}×`)
  if (failures.length) {
    for (const failure of failures) console.error(process.env.GITHUB_ACTIONS === 'true' ? `::error title=Paired layout gate::${failure}` : failure)
    process.exit(1)
  }
}
