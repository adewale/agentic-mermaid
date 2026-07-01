// Certificate completeness is a CONTRACT, not a habit: applyRouteContracts
// certifies every edge, and any post-freeze repair that re-routes an edge must
// re-issue its certificate (recertifyReroutedEdge) — an uncertified edge is
// exactly what the certificate system exists to forbid. Issue #83: the
// shared-trunk label lane shipped `routeCertificate === undefined` on a
// duplicate-parallel-edge graph, and the only guard was a randomly-seeded
// property that fired ~1 run in 7. This gate is deterministic: the tracked
// corpus, the shrunk #83 repro (both horizontal directions), and a fixed-seed
// sweep of dense duplicate-edge graphs.
import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { trackedExamples } from '../../eval/heuristic-tracker/catalog.ts'

function uncertified(source: string): string[] {
  const p = layoutGraphSync(parseMermaid(source))
  return p.edges.filter(e => e.routeCertificate === undefined).map(e => `${e.source}->${e.target}`)
}

const REPRO = [
  'N0 --> N2', 'N1 --> N0', 'N1 --> N2', 'N1 --> N0',
  'N0 --> N2', 'N2 --> N0', 'N1 --> N0', 'N2 --> N0',
].join('\n  ')

describe('certificate completeness: every edge out of the pipeline is certified', () => {
  test('issue #83 repro (LR): duplicate-parallel-edge graph', () => {
    expect(uncertified(`flowchart LR\n  ${REPRO}`)).toEqual([])
  })
  test('issue #83 repro (RL)', () => {
    expect(uncertified(`flowchart RL\n  ${REPRO}`)).toEqual([])
  })
  test('tracked corpus (76 examples)', () => {
    const bad: string[] = []
    for (const ex of trackedExamples()) {
      const missing = uncertified(ex.source)
      if (missing.length) bad.push(`${ex.name}: ${missing.join(',')}`)
    }
    expect(bad).toEqual([])
  })
  test('fixed-seed duplicate-edge sweep (the #83 input class)', () => {
    const H = (i: number) => (Math.imul(i + 1, 2654435761) >>> 0)
    const bad: string[] = []
    for (let i = 0; i < 60; i++) {
      const d = ['LR', 'RL', 'TD', 'BT'][i % 4]!
      const n = 3 + (H(i) % 3)
      const lines = [`flowchart ${d}`]
      for (let e = 0; e < 5 + (H(i >> 1) % 6); e++) {
        const s = H(i * 7 + e) % n, t = H(i * 13 + e + 1) % n
        if (s !== t) lines.push(`  N${s} --> N${t}`) // duplicates on purpose
      }
      const missing = uncertified(lines.join('\n'))
      if (missing.length) bad.push(`seed ${i}: ${missing.join(',')}`)
    }
    expect(bad).toEqual([])
  })
})
