/**
 * Heuristic regression tracker.
 *
 *   bun run eval/heuristic-tracker/run.ts            # score all examples, compare to baseline, show deltas
 *   bun run eval/heuristic-tracker/run.ts --update   # write the current scores as the new baseline
 *
 * Per example it records: HARD rubric violations (must stay 0), off-cardinal
 * endpoints (informational — many are correct-by-standard reciprocal/spread
 * attachments), total bends, straight-edge count, crossings, and (for fan-ins)
 * the mirror-symmetry error. A committed baseline lets any heuristic change be
 * judged improvement vs. regression at a glance.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { parseMermaid } from '../../src/parser.ts'
import { layoutGraphSync } from '../../src/layout-engine.ts'
import { assessLayout } from '../../src/layout-rubric.ts'
import { shapePorts, diamondFacetPorts } from '../../src/route-contracts.ts'
import { trackedExamples } from './catalog.ts'

interface Row {
  hard: number; offCardinal: number; bends: number; straight: number; crossings: number; symErr: number | null
  /** SOFT label-CENTRING: worst |projFrac(label) - 0.5| over labelled edges
   *  (layout-rubric worstLabelOffset). Records how well-centred each example's
   *  labels are so a regression of the symmetric-dogleg hugging class trips the
   *  gate; null when the example has no labelled edges. */
  labelOff: number | null
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

export type ScoreResult = Row | { error: string }

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

/** Score every tracked example, keyed `group/name`. */
export function scoreAll(): Record<string, ScoreResult> {
  const current: Record<string, ScoreResult> = {}
  for (const ex of trackedExamples()) current[`${ex.group}/${ex.name}`] = score(ex.source)
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
