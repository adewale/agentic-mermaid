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
import { auditRouteContracts } from '../route-contracts.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

  test('packing preserves every requested long-link gap in all four directions', () => {
    const template = (dir: 'LR' | 'RL' | 'TD' | 'BT') =>
      `flowchart ${dir}\n  N2((x))\n  N9 ===>|x| N6\n  N7 ----> N0\n  N2 ---> N7`
    const mainGap = (positioned: ReturnType<typeof layoutGraphSync>, dir: 'LR' | 'RL' | 'TD' | 'BT'): number => {
      const source = positioned.nodes.find(n => n.id === 'N7')!
      const target = positioned.nodes.find(n => n.id === 'N0')!
      switch (dir) {
        case 'LR': return target.x - (source.x + source.width)
        case 'RL': return source.x - (target.x + target.width)
        case 'TD': return target.y - (source.y + source.height)
        default: return source.y - (target.y + target.height)
      }
    }
    for (const dir of ['LR', 'RL', 'TD', 'BT'] as const) {
      const graph = parseMermaid(template(dir))
      const positioned = layoutGraphSync(graph)
      // `---->` parses as length 3: 48 + 2 × (48 + 40) = 224px.
      expect(mainGap(positioned, dir)).toBeGreaterThanOrEqual(223.5)
      expect(hardViolations(assessLayout(graph, positioned))).toEqual([])
      expect(auditRouteContracts(positioned, graph)).toEqual([])
    }
  })
})

// Issue #87 evidence fixtures: an authored `B ----> A` feedback edge requests
// three ranks in every direction (Bug 1), and overlap repair must not compress
// the N7 ----> N0 rank constraint again (Bug 2). These gaps were previously
// asserted only by the gallery generator; they now gate every run.
describe('issue #87 link-rank evidence fixtures keep the requested gap', () => {
  const FIXTURES = join(import.meta.dir, '..', '..', 'eval', 'linkrank-feedback-packing', 'fixtures')
  const fixtures = [
    ...(['lr', 'rl', 'td', 'bt'] as const).map(dir => ({ file: `feedback-long-${dir}.mmd`, source: 'A', target: 'B' })),
    { file: 'packing-td.mmd', source: 'N7', target: 'N0' },
    { file: 'packing-bt.mmd', source: 'N7', target: 'N0' },
  ]
  for (const fixture of fixtures) {
    test(`${fixture.file}: ${fixture.source}/${fixture.target} boundary gap is at least 224px`, () => {
      const text = readFileSync(join(FIXTURES, fixture.file), 'utf8')
      const direction = /^flowchart (LR|RL|TD|BT)\b/m.exec(text)![1] as 'LR' | 'RL' | 'TD' | 'BT'
      const graph = parseMermaid(text)
      const positioned = layoutGraphSync(graph)
      const source = positioned.nodes.find(n => n.id === fixture.source)!
      const target = positioned.nodes.find(n => n.id === fixture.target)!
      const gap = direction === 'LR' ? target.x - (source.x + source.width)
        : direction === 'RL' ? source.x - (target.x + target.width)
          : direction === 'TD' ? target.y - (source.y + source.height)
            : source.y - (target.y + target.height)
      expect(gap).toBeGreaterThanOrEqual(223.5)
      expect(hardViolations(assessLayout(graph, positioned))).toEqual([])
    })
  }
})
