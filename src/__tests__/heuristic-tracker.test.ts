// Promote the heuristic-tracker from a manual script to a per-PR gate.
//
// eval/heuristic-tracker scores every tracked layout example. This test gates
// the PORTABLE part — HARD rubric violations must stay 0 (structural routing
// correctness: no edge-through-node, no floating endpoint, etc.) and the tracker
// must score every example without error.
//
// The SOFT-metric baseline comparison (bends/crossings/straight counts) is NOT
// gated here: those exact integers depend on floating-point ELK geometry that is
// not byte-identical across runtimes/machines, so a committed baseline captured
// on one host flags spurious "regressions" on another (it did, on this PR's
// first CI run). It remains a LOCAL tool: `bun run eval/heuristic-tracker/run.ts`
// shows soft-metric deltas vs baseline for human review when tuning routing.

import { describe, test, expect } from 'bun:test'
import { scoreAll, loadBaseline, compareToBaseline } from '../../eval/heuristic-tracker/run.ts'
import { trackedExamples } from '../../eval/heuristic-tracker/catalog.ts'
import { parseMermaid } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { auditRouteContracts } from '../route-contracts.ts'

describe('heuristic-tracker ratchet', () => {
  const current = scoreAll()
  const baseline = loadBaseline()
  const report = compareToBaseline(current, baseline)

  test('the tracker scores every example without a layout/parse error', () => {
    expect(report.errors).toEqual([])
  })

  test('no HARD rubric violations on any tracked example', () => {
    expect({ totalHard: report.totalHard }).toEqual({ totalHard: 0 })
  })

  test('baseline keys exactly match tracked examples and deterministic family rows do not regress', () => {
    expect(Object.keys(baseline).sort()).toEqual(Object.keys(current).sort())
    const familyRegressions = report.regressionDetails.filter(detail => {
      const key = detail.slice(0, detail.indexOf(':'))
      return (current[key] as { kind?: string } | undefined)?.kind === 'family'
    })
    expect(familyRegressions).toEqual([])
  })

  test('comparison discriminates a lower family score/label rate', () => {
    const base = { family: { kind: 'family', hard: 0, offCanvas: 0, nodeOverlaps: 0, groupBreaches: 0, groupOverlaps: 0, score: 100, labelled: 1, journeyScore: null } }
    const worse = { family: { ...base.family, score: 99, labelled: 0.5 } }
    const result = compareToBaseline(worse as never, base)
    expect(result.regressionDetails).toContain('family: score 100→99')
    expect(result.regressionDetails).toContain('family: labelled 1→0.5')
  })

  // Issue #25 acceptance criterion 7: "corpus diff shows no increase in unexplained
  // bends, edge crossings, or label overlap." Unexplained bends and label overlap
  // are STRUCTURAL route-contract findings that are deterministic across runtimes
  // (verified stable), unlike raw edge-crossing COUNTS, which depend on non-portable
  // ELK float geometry (see the file header) and stay a local soft metric, not a gate.
  //
  // This is a no-increase ratchet: the corpus may currently carry the known
  // offenders below; any NEW unexplained-bend/label-overlap finding fails, and
  // fixing a known one fails too (so the baseline only ever shrinks).
  const KNOWN_ROUTE_CONTRACT_OFFENDERS = [
    'contact-sheet/AJ: ROUTE_LABEL_ON_SHARED_TRUNK D->E',
  ]

  test('no NEW unexplained-bend or label-overlap findings across the tracked corpus (criterion 7)', () => {
    const offenders: string[] = []
    for (const ex of trackedExamples()) {
      // Route contracts are an ELK-routed-graph audit; family examples are
      // scored by the family rubric instead (and gated by totalHard above).
      if (ex.family) continue
      const key = `${ex.group}/${ex.name}`
      try {
        const graph = parseMermaid(ex.source)
        const positioned = layoutGraphSync(graph)
        for (const f of auditRouteContracts(positioned, graph)) {
          if (f.code === 'ROUTE_UNEXPLAINED_BEND' || f.code === 'ROUTE_LABEL_ON_SHARED_TRUNK') {
            offenders.push(`${key}: ${f.code} ${f.edge}`)
          }
        }
      } catch (e) {
        offenders.push(`${key}: layout error ${String(e).slice(0, 40)}`)
      }
    }
    expect(offenders.sort()).toEqual([...KNOWN_ROUTE_CONTRACT_OFFENDERS].sort())
  })
})
