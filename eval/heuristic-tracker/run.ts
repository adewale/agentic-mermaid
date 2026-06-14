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
import { shapePorts } from '../../src/route-contracts.ts'
import { trackedExamples } from './catalog.ts'

interface Row {
  hard: number; offCardinal: number; bends: number; straight: number; crossings: number; symErr: number | null
}

function onCardinal(node: any, p: { x: number; y: number }): boolean {
  return Object.values(shapePorts(node)).some((q: any) => Math.abs(q.x - p.x) <= 0.5 && Math.abs(q.y - p.y) <= 0.5)
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

function score(source: string): Row | { error: string } {
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
  return {
    hard: r.violations.length, offCardinal, bends: r.metrics.totalBends, straight,
    crossings: r.metrics.edgeCrossings, symErr: fanInSymmetryError(pos),
  }
}

const examples = trackedExamples()
const current: Record<string, Row | { error: string }> = {}
for (const ex of examples) current[`${ex.group}/${ex.name}`] = score(ex.source)

const baselinePath = join(dirname(new URL(import.meta.url).pathname), 'baseline.json')
const update = process.argv.includes('--update')

if (update) {
  writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n')
  console.log(`wrote baseline: ${Object.keys(current).length} examples`)
  process.exit(0)
}

const baseline: Record<string, any> = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {}
let totalHard = 0, regressions = 0, improvements = 0
const fmt = (v: any) => v === null ? '·' : String(v)
console.log('group/name'.padEnd(34), 'hard off bend strt xing  sym   Δ(vs baseline)')
for (const ex of examples) {
  const key = `${ex.group}/${ex.name}`
  const c = current[key] as any
  const b = baseline[key]
  if (c.error) { console.log(key.padEnd(34), `ERROR: ${c.error}`); continue }
  totalHard += c.hard
  const deltas: string[] = []
  if (b && !b.error) {
    for (const m of ['hard', 'offCardinal', 'bends', 'straight', 'crossings'] as const) {
      const d = c[m] - b[m]
      if (d !== 0) {
        // improvement: fewer hard/offCardinal/bends/crossings OR more straight
        const better = m === 'straight' ? d > 0 : d < 0
        deltas.push(`${m}${d > 0 ? '+' : ''}${d}${better ? '✓' : '✗'}`)
        if (better) improvements++; else regressions++
      }
    }
    if (c.symErr !== null && b.symErr !== null && Math.abs(c.symErr - b.symErr) > 0.5) {
      const d = c.symErr - b.symErr
      deltas.push(`sym${d > 0 ? '+' : ''}${d.toFixed(1)}${d < 0 ? '✓' : '✗'}`)
      if (d < 0) improvements++; else regressions++
    }
  }
  console.log(
    key.padEnd(34),
    String(c.hard).padStart(4), String(c.offCardinal).padStart(3), String(c.bends).padStart(4),
    String(c.straight).padStart(4), String(c.crossings).padStart(4), fmt(c.symErr).padStart(5),
    '  ' + (deltas.join(' ') || (b ? '=' : 'new')),
  )
}
console.log('—'.repeat(70))
console.log(`examples: ${examples.length}   total HARD violations: ${totalHard}   vs baseline: ${improvements} improvements, ${regressions} regressions`)
if (totalHard > 0) { console.error('FAIL: hard-metric violations present'); process.exit(1) }
