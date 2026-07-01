// A feedback (or reciprocal) edge that returns past its target can cut through an
// unrelated node sitting BESIDE the target — the return segment crosses that
// node's cross-band. rerouteEdgesThroughNodes' bracket previously only tried
// lanes just outside the WHOLE obstacle band, so when a node also sat on the far
// side (e.g. a disconnected component to the left) both band-edge lanes were
// blocked and the through-node route was kept. The bracket now also tries lanes
// just past EACH obstacle's edges, so the clear GAP lane between the target and
// its neighbour is found. These cases are HARD-clean with the fix and show
// `edgeThroughNode` without it (bracketOverBand can find no clear band-edge lane).
import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { assessLayout, hardViolations } from '../layout-rubric.ts'

const cases: [string, string][] = [
  // Shrunk fuzz repro: N1<->N8 reciprocal (feedback N8->N1) with the unrelated
  // component N2->N0 sitting beside N1, and N3->N5 on the far side.
  ['multi-component reciprocal (BT)', 'flowchart BT\n  N3 ---->|warnings| N5\n  N1 --> N8\n  N2 --->|a longer label goes here| N0\n  N8 -->|errors| N1'],
  ['same, LR', 'flowchart LR\n  N3 ---->|warnings| N5\n  N1 --> N8\n  N2 --->|a longer label goes here| N0\n  N8 -->|errors| N1'],
  ['same, TD', 'flowchart TD\n  N3 ---->|warnings| N5\n  N1 --> N8\n  N2 --->|a longer label goes here| N0\n  N8 -->|errors| N1'],
]

describe('feedback reroute: a feedback that returns past its target clears a node beside it', () => {
  for (const [name, src] of cases) {
    test(`${name}: no edgeThroughNode`, () => {
      const g = parseMermaid(src)
      const p = layoutGraphSync(g)
      const etn = hardViolations(assessLayout(g, p)).filter(v => v.metric === 'edgeThroughNode')
      expect(etn).toEqual([])
    })
  }
})
