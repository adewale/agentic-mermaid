/**
 * Heuristic regression tracker.
 *
 *   bun run eval/heuristic-tracker/run.ts            # score all examples, compare to baseline, show deltas
 *   bun run eval/heuristic-tracker/run.ts --update   # write the current scores as the new baseline
 *
 * Per FLOWCHART example it records: HARD rubric violations (must stay 0),
 * off-cardinal endpoints (informational — many are correct-by-standard
 * reciprocal/spread attachments), total bends, straight-edge count, crossings,
 * and (for fan-ins) the mirror-symmetry error. Examples with a `family` field
 * (journey, sequence, class, …) are scored via the family-generic rubric
 * (src/family-rubric.ts) over their RenderedLayout instead — journey adds its
 * layered assessor (tiling / marker centring / score monotonicity / actor
 * dots). A committed baseline lets any heuristic change be judged improvement
 * vs. regression at a glance, for EVERY family, not just flowchart.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { parseMermaid } from '../../src/parser.ts'
import { layoutGraphSync } from '../../src/layout-engine.ts'
import { assessLayout } from '../../src/layout-rubric.ts'
import { shapePorts, diamondFacetPorts } from '../../src/route-contracts.ts'
import { parseRegisteredMermaid as parseAgentMermaid, layoutMermaid } from '../../src/agent/index.ts'
import { assessRenderedLayout, assessJourneyLayout, familyHardViolations } from '../../src/family-rubric.ts'
import { parseJourneyDiagram } from '../../src/journey/parser.ts'
import { layoutJourneyDiagram, resolveJourneyRequestAppearance } from '../../src/journey/layout.ts'
import { toMermaidLines } from '../../src/mermaid-source.ts'
import type { DiagramKind } from '../../src/agent/types.ts'
import { trackedExamples } from './catalog.ts'

interface Row {
  hard: number; offCardinal: number; bends: number; straight: number; crossings: number; symErr: number | null
  /** SOFT label-CENTRING: worst |projFrac(label) - 0.5| over labelled edges
   *  (layout-rubric worstLabelOffset). Records how well-centred each example's
   *  labels are so a regression of the symmetric-dogleg hugging class trips the
   *  gate; null when the example has no labelled edges. */
  labelOff: number | null
}

/** Family-rubric row for non-flowchart examples. `hard` folds in the journey
 *  assessor's violations for journey examples, so the per-PR totalHard gate
 *  (heuristic-tracker.test.ts) covers the journey-specific invariants too. */
interface FamilyRow {
  kind: 'family'
  hard: number
  /** Family-rubric score (0–100, higher better, stable weights). */
  score: number
  offCanvas: number; nodeOverlaps: number; groupBreaches: number; groupOverlaps: number
  /** Labelled-box rate, 3dp (higher better). */
  labelled: number
  /** Journey assessor score (0–100, higher better); null for other families. */
  journeyScore: number | null
}

// A "designated" attachment point: the four cardinal side-midpoints for every
// shape, PLUS the four facet-midpoints on a diamond (NE/SE/SW/NW). Facet-mids
// are exact on-outline ports the 8-port model attaches to deliberately, so an
// endpoint there is NOT an off-port floater — it should not count against the
// offCardinal metric (which tracks endpoints floating at arbitrary positions).
function onCardinal(node: any, p: { x: number; y: number }): boolean {
  const near = (q: any) => Math.abs(q.x - p.x) <= 0.5 && Math.abs(q.y - p.y) <= 0.5
  if (Object.values(shapePorts(node)).some(near)) return true
  if (node.shape === 'diamond' && Object.values(diamondFacetPorts(node)).some(near)) return true
  return false
}

function fanInSymmetryError(pos: any): number | null {
  // hubs with >=2 incoming: check the merge point sits at the source barycenter
  const incoming = new Map<string, any[]>()
  for (const e of pos.edges) (incoming.get(e.target) ?? incoming.set(e.target, []).get(e.target))!.push(e)
  let worst = 0, any = false
  const nm = new Map(pos.nodes.map((n: any) => [n.id, n]))
  for (const [tid, edges] of incoming) {
    if (edges.length < 2) continue
    const srcs = edges.map(e => nm.get(e.source)).filter(Boolean) as any[]
    if (srcs.length < 2) continue
    any = true
    const bary = srcs.reduce((a, n) => a + (n.y + n.height / 2), 0) / srcs.length
    for (const e of edges) {
      const last = e.points[e.points.length - 1]
      worst = Math.max(worst, Math.abs(last.y - bary))
    }
  }
  return any ? Number(worst.toFixed(1)) : null
}

export type ScoreResult = Row | FamilyRow | { error: string }

/**
 * Score a non-flowchart example via the family-generic rubric over its
 * RenderedLayout (the same projection verify/measureQuality consume), plus the
 * journey assessor over the positioned journey diagram for journey examples.
 */
export function scoreFamily(source: string, family: DiagramKind): ScoreResult {
  let result
  try {
    const p = parseAgentMermaid(source)
    if (!p.ok) return { error: 'parse' }
    const layout = layoutMermaid(p.value)
    if (layout.nodes.length === 0) return { error: 'empty layout' }
    result = assessRenderedLayout(layout)
  } catch (e) { return { error: String(e).slice(0, 60) } }
  let hard = familyHardViolations(result).length
  let journeyScore: number | null = null
  if (family === 'journey') {
    try {
      const j = assessJourneyLayout(layoutJourneyDiagram(
        parseJourneyDiagram(toMermaidLines(source)),
        resolveJourneyRequestAppearance(),
      ))
      journeyScore = j.score
      hard += j.violations.length // every journey metric is HARD
    } catch (e) { return { error: String(e).slice(0, 60) } }
  }
  const m = result.metrics
  return {
    kind: 'family', hard, score: result.score,
    offCanvas: m.offCanvas, nodeOverlaps: m.nodeOverlaps,
    groupBreaches: m.groupBreaches, groupOverlaps: m.groupOverlaps,
    labelled: Number(m.labelledBoxRate.toFixed(3)),
    journeyScore,
  }
}

export function score(source: string): ScoreResult {
  let pos: any
  try { pos = layoutGraphSync(parseMermaid(source)) } catch (e) { return { error: String(e).slice(0, 60) } }
  if (!pos || pos.nodes.length === 0) return { error: 'empty layout' }
  let graph: any
  try { graph = parseMermaid(source) } catch { return { error: 'reparse' } }
  const r = assessLayout(graph, pos)
  const nm = new Map(pos.nodes.map((n: any) => [n.id, n]))
  let offCardinal = 0, straight = 0
  for (const e of pos.edges) {
    if (e.points.length < 2) continue
    if (e.points.length === 2) straight++
    const s = nm.get(e.source), t = nm.get(e.target)
    if (s && !onCardinal(s, e.points[0])) offCardinal++
    if (t && !onCardinal(t, e.points[e.points.length - 1])) offCardinal++
  }
  const hasLabel = pos.edges.some((e: any) => e.label && e.labelPosition && e.points.length >= 2)
  return {
    hard: r.violations.length, offCardinal, bends: r.metrics.totalBends, straight,
    crossings: r.metrics.edgeCrossings, symErr: fanInSymmetryError(pos),
    labelOff: hasLabel ? Number(r.metrics.worstLabelOffset.toFixed(3)) : null,
  }
}

export const baselinePath = join(dirname(new URL(import.meta.url).pathname), 'baseline.json')

/** Score every tracked example, keyed `group/name`. Examples with a `family`
 *  field route through the family rubric; the rest keep flowchart scoring. */
export function scoreAll(): Record<string, ScoreResult> {
  const current: Record<string, ScoreResult> = {}
  for (const ex of trackedExamples()) {
    current[`${ex.group}/${ex.name}`] = ex.family ? scoreFamily(ex.source, ex.family) : score(ex.source)
  }
  return current
}

export function loadBaseline(): Record<string, any> {
  return existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {}
}

export interface RegressionReport {
  totalHard: number
  improvements: number
  regressions: number
  /** Per-example regressed metrics, e.g. `flowchart/auth: crossings 3→5`. */
  regressionDetails: string[]
  /** Examples whose scorer errored (parse/layout failure). */
  errors: string[]
}

/**
 * Compare current scores to a baseline. A regression is: more hard violations,
 * more bends/crossings/off-cardinal endpoints, fewer straight edges, or a worse
 * fan-in symmetry error — the same directions the CLI prints with ✗.
 */
export function compareToBaseline(
  current: Record<string, ScoreResult>,
  baseline: Record<string, any>,
): RegressionReport {
  let totalHard = 0, improvements = 0, regressions = 0
  const regressionDetails: string[] = []
  const errors: string[] = []
  for (const [key, cAny] of Object.entries(current)) {
    const c = cAny as any
    if (c.error) { errors.push(`${key}: ${c.error}`); continue }
    totalHard += c.hard
    const b = baseline[key]
    if (!b || b.error) continue
    if (c.kind === 'family') {
      // Family-rubric rows: hard counts must not rise; scores and the
      // labelled-box rate must not fall.
      for (const m of ['hard', 'offCanvas', 'nodeOverlaps', 'groupBreaches', 'groupOverlaps'] as const) {
        const d = c[m] - (b[m] ?? 0)
        if (d === 0) continue
        if (d < 0) improvements++
        else { regressions++; regressionDetails.push(`${key}: ${m} ${b[m]}→${c[m]}`) }
      }
      for (const m of ['score', 'labelled', 'journeyScore'] as const) {
        if (c[m] === null || b[m] == null) continue
        const d = c[m] - b[m]
        if (Math.abs(d) < 1e-9) continue
        if (d > 0) improvements++
        else { regressions++; regressionDetails.push(`${key}: ${m} ${b[m]}→${c[m]}`) }
      }
      continue
    }
    for (const m of ['hard', 'offCardinal', 'bends', 'straight', 'crossings'] as const) {
      const d = c[m] - b[m]
      if (d === 0) continue
      const better = m === 'straight' ? d > 0 : d < 0
      if (better) improvements++
      else { regressions++; regressionDetails.push(`${key}: ${m} ${b[m]}→${c[m]}`) }
    }
    if (c.symErr !== null && b.symErr !== null && Math.abs(c.symErr - b.symErr) > 0.5) {
      const d = c.symErr - b.symErr
      if (d < 0) improvements++
      else { regressions++; regressionDetails.push(`${key}: symErr ${b.symErr}→${c.symErr}`) }
    }
    // Label-centring: lower is better (a label drifting toward an endpoint is a
    // regression). Fractional metric, so a tighter tolerance than symErr's px.
    if (c.labelOff !== null && b.labelOff != null && Math.abs(c.labelOff - b.labelOff) > 0.005) {
      const d = c.labelOff - b.labelOff
      if (d < 0) improvements++
      else { regressions++; regressionDetails.push(`${key}: labelOff ${b.labelOff}→${c.labelOff}`) }
    }
  }
  return { totalHard, improvements, regressions, regressionDetails, errors }
}

if (import.meta.main) {
  const examples = trackedExamples()
  const current = scoreAll()
  const update = process.argv.includes('--update')

  if (update) {
    writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n')
    console.log(`wrote baseline: ${Object.keys(current).length} examples`)
    process.exit(0)
  }

  const baseline = loadBaseline()
  const fmt = (v: any) => v === null ? '·' : String(v)
  console.log('group/name'.padEnd(34), 'hard off bend strt xing  sym  lblOff  Δ(vs baseline)')
  for (const ex of examples) {
    const key = `${ex.group}/${ex.name}`
    const c = current[key] as any
    const b = baseline[key]
    if (c.error) { console.log(key.padEnd(34), `ERROR: ${c.error}`); continue }
    if (c.kind === 'family') {
      const deltas: string[] = []
      if (b && !b.error && b.kind === 'family') {
        for (const m of ['hard', 'offCanvas', 'nodeOverlaps', 'groupBreaches', 'groupOverlaps'] as const) {
          const d = c[m] - (b[m] ?? 0)
          if (d !== 0) deltas.push(`${m}${d > 0 ? '+' : ''}${d}${d < 0 ? '✓' : '✗'}`)
        }
        for (const m of ['score', 'labelled', 'journeyScore'] as const) {
          if (c[m] === null || b[m] == null) continue
          const d = c[m] - b[m]
          if (Math.abs(d) > 1e-9) deltas.push(`${m}${d > 0 ? '+' : ''}${Number(d.toFixed(3))}${d > 0 ? '✓' : '✗'}`)
        }
      }
      console.log(
        key.padEnd(34),
        String(c.hard).padStart(4),
        `score ${String(c.score).padStart(5)}`,
        c.journeyScore !== null ? `journey ${String(c.journeyScore).padStart(5)}` : ''.padEnd(13),
        `lbl ${c.labelled.toFixed(3)}`,
        '  ' + (deltas.join(' ') || (b ? '=' : 'new')),
      )
      continue
    }
    const deltas: string[] = []
    if (b && !b.error) {
      for (const m of ['hard', 'offCardinal', 'bends', 'straight', 'crossings'] as const) {
        const d = c[m] - b[m]
        if (d !== 0) {
          const better = m === 'straight' ? d > 0 : d < 0
          deltas.push(`${m}${d > 0 ? '+' : ''}${d}${better ? '✓' : '✗'}`)
        }
      }
      if (c.symErr !== null && b.symErr !== null && Math.abs(c.symErr - b.symErr) > 0.5) {
        const d = c.symErr - b.symErr
        deltas.push(`sym${d > 0 ? '+' : ''}${d.toFixed(1)}${d < 0 ? '✓' : '✗'}`)
      }
      if (c.labelOff !== null && b.labelOff != null && Math.abs(c.labelOff - b.labelOff) > 0.005) {
        const d = c.labelOff - b.labelOff
        deltas.push(`lblOff${d > 0 ? '+' : ''}${d.toFixed(3)}${d < 0 ? '✓' : '✗'}`)
      }
    }
    console.log(
      key.padEnd(34),
      String(c.hard).padStart(4), String(c.offCardinal).padStart(3), String(c.bends).padStart(4),
      String(c.straight).padStart(4), String(c.crossings).padStart(4), fmt(c.symErr).padStart(5),
      fmt(c.labelOff).padStart(6),
      '  ' + (deltas.join(' ') || (b ? '=' : 'new')),
    )
  }
  const report = compareToBaseline(current, baseline)
  console.log('—'.repeat(70))
  console.log(`examples: ${examples.length}   total HARD violations: ${report.totalHard}   vs baseline: ${report.improvements} improvements, ${report.regressions} regressions`)
  if (report.totalHard > 0) { console.error('FAIL: hard-metric violations present'); process.exit(1) }
}
