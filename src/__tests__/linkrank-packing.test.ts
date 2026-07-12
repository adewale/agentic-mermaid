// honorLinkRankDistance shoves a variable-length link's target sub-DAG along the
// main axis, but previously left whatever the shove landed on sitting UNDER the
// moved nodes — breaking ELK's no-overlap guarantee (nodeOverlaps) and dragging
// edges through the overlapped boxes (edgeThroughNode); issue #81. The pass now
// (a) pushes ahead any node a shove-introduced overlap lands on, and (b) when a
// rebuilt feedback U-detour or forward dogleg is blocked by a bystander, picks a
// clear variant through free channels (lane switch, rung, elbow, staircase)
// before falling back to the canonical route. These shrunk fuzz repros cover
// every mechanism and are HARD-clean for nodeOverlaps/edgeThroughNode with the
// fix; each shows nodeOverlaps and/or edgeThroughNode without it.
import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { assessLayout, hardViolations } from '../layout-rubric.ts'
import { createHash } from 'node:crypto'

const cases: [string, string][] = [
  // Shove lands a node on a bystander: nodeOverlaps + edgeThroughNode without
  // the push-ahead repair (issue #81 rep1-rep3, one per direction family).
  ['shove overlap, LR diamond', 'flowchart LR\n  N4{warnings}\n  N3 ===>|warnings| N4\n  N3 ----> N0'],
  ['shove overlap, TD 2 components', 'flowchart TD\n  N2((x))\n  N9 ===>|x| N6\n  N7 ----> N0\n  N2 ---> N7'],
  ['shove overlap, RL long-link fan', 'flowchart RL\n  N6((a longer label goes here))\n  N2 ---> N0\n  N6 ===>|warnings| N0\n  N1 ----> N6'],
  // Feedback U-detour risers blocked on BOTH lanes: needs the rung variant
  // through the free channel between rows (issue #81 rep4).
  ['feedback rung, BT 3 components', 'flowchart BT\n  N5[(warnings)]\n  N7 ===>|q| N0\n  N5 --->|done| N3\n  N3 --->|ok| N5\n  N4 --> N6'],
  // A bystander sits over the target's entry port with a 4px free channel
  // beside it: only the double-elbow staircase threads it.
  ['dogleg staircase, TD', `flowchart TD
  N1((a longer label goes here))
  N2(["x"])
  N4((q))
  N6{retry}
  N7((validate input))
  N9{ok}
  N10((same word ok))
  N11(["a longer label goes here"])
  N3 ----> N0
  N4 --> N9
  N11 ----> N8
  N9 ===>|retry| N2
  N6 --->|validate input| N3
  N7 ----> N0
  N4 --> N1
  N1 ===>|same word ok| N10
  N2 --->|a longer label goes here| N7`],
]

describe('honorLinkRankDistance packing: a shove never leaves overlaps or blocked rebuilt routes', () => {
  for (const [name, src] of cases) {
    test(`${name}: no nodeOverlaps, no edgeThroughNode`, () => {
      const g = parseMermaid(src)
      const p = layoutGraphSync(g)
      const bad = hardViolations(assessLayout(g, p))
        .filter(v => v.metric === 'nodeOverlaps' || v.metric === 'edgeThroughNode')
      expect(bad).toEqual([])
    })
  }

  // Characterization: pin the exact repaired geometry. Explicit hashes avoid
  // Bun's concurrent cross-file snapshot-writer race in the full suite.
  const expectedHashes: Record<string, string> = {
    'shove overlap, LR diamond': '6d93304a97f9175b33a0366fb1782132563efa614106b5f943874bb81aa25b27',
    'shove overlap, TD 2 components': 'be325ac3cff9edfc747f394e89de96615e1f33065b6536bdc3f79774d2dfbbf5',
    'shove overlap, RL long-link fan': '07a9a8d24ef74000d95a6187cc8dfbe16214b5403ef0d1f497087d031b9921cd',
    'feedback rung, BT 3 components': 'c32f0dff6c2f8a499091a5f34eddd0cc3365c17084b310775719a68bf43134fa',
    'dogleg staircase, TD': '5bb57ff4f46a0c23a30adf5518b6d3d791e7e053a0c261a5822625b4502ccd39',
  }
  for (const [name, src] of cases) {
    test(`${name}: repaired geometry characterization`, () => {
      const p = layoutGraphSync(parseMermaid(src))
      const digest = {
        nodes: p.nodes.map(n => `${n.id}@${n.x.toFixed(1)},${n.y.toFixed(1)} ${n.width.toFixed(1)}x${n.height.toFixed(1)}`),
        edges: p.edges.map(e => `${e.source}->${e.target}: ${e.points.map(q => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')}`),
      }
      const hash = createHash('sha256').update(JSON.stringify(digest)).digest('hex')
      expect(hash).toBe(expectedHashes[name]!)
    })
  }
})
