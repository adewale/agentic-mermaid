// The independent hard-invariant gate — the "mandatory total checker".
//
// assessLayout (src/layout-rubric.ts) is an INDEPENDENT oracle: it reimplements
// each shape's rendered outline equation and recomputes every HARD invariant
// (endpoints on outline, no diagonals, no unexplained bends, no node overlap, no
// label off its route, no edge through a node, no hitch) from the public
// PositionedGraph alone — sharing no code with the route-contract producer. So a
// bug in the producer's own predicates cannot hide from it (that independence is
// the whole point; see the layout-rubric outline-oracle comment).
//
// The existing oracle gates are scattered (the 74 tracked examples in
// heuristic-tracker; syntax fuzz in route-contracts-syntax-range; metamorphic
// transforms in layout-metamorphic). What was missing is a SINGLE gate that runs
// the oracle over the broadest input set we have — every real-world flowchart in
// the mermaid-docs corpus PLUS a deterministic fuzz sample — and asserts ZERO
// hard violations everywhere. The layout-equivalence gate pins those same corpus
// diagrams byte-for-byte, but byte-identical geometry is not the same claim as
// "every hard invariant holds": this gate makes the structural claim explicit and
// total, so any future heuristic that breaks a hard invariant on ANY of them
// fails loudly and immediately — which is exactly what lets new placement/routing
// heuristics be added aggressively without silently regressing the foundation.
//
// Target is 0, not a ratchet: hard invariants are conventions (achievable by
// construction), not NP-hard optima — see docs/design/system/
// layout-guarantees-and-robustness.md.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMermaid } from '../parser.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { assessLayout, hardViolations } from '../layout-rubric.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts' // also installs the render families positionResolvedFamily resolves
import { verifyMermaid } from '../agent/verify.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { resolveRenderRequestForExecution } from '../render-contract.ts'
import { LayoutCertificationError } from '../layout/certification.ts'
import type { PaintLayoutCertification } from '../scene/paint-certification.ts'
import type { PositionedGraph, PositionedGroup } from '../types.ts'

const SEED = 0x0decaf

/** Run the independent oracle on one flowchart source; return hard-violation details. */
function offences(id: string, source: string): string[] {
  let graph
  try {
    // Strip frontmatter the way the render path does, so corpus entries with a
    // `---` config block are checked too.
    graph = parseMermaid(normalizeMermaidSource(source).text)
  } catch (error) {
    // A flowchart the core parser rejects is an offence, never a silent pass.
    return [`${id}: unparseable — ${error instanceof Error ? error.message : String(error)}`]
  }
  const positioned = layoutGraphSync(graph)
  expect(positioned.nodes.map(node => node.id).sort(), `${id}: authored nodes`).toEqual([...graph.nodes.keys()].sort())
  expect(positioned.edges.map(edge => JSON.stringify([edge.source, edge.target])).sort(), `${id}: authored edges`).toEqual(graph.edges.map(edge => JSON.stringify([edge.source, edge.target])).sort())
  return hardViolations(assessLayout(graph, positioned)).map(v => `${id}: ${v.metric} — ${v.detail}`)
}

// Reuse the family fuzzer shape from property-readability: vary entity count,
// relabel, and optionally append a primary/relation.
function flowchartArb() {
  const fam = METAMORPHIC_FAMILIES.flowchart
  const [kmin, kmax] = fam.kRange
  return fc.record({
    k: fc.integer({ min: kmin, max: kmax }),
    tag: fc.integer({ min: 0, max: 1_000_000 }).map(n => `q${n.toString(36)}`),
    extra: fc.constantFrom('none', 'primary', 'relation'),
  }).map(({ k, tag, extra }) => {
    let s = fam.build(k, tag)
    if (extra === 'primary' && fam.addPrimary) s += fam.addPrimary.snippet(k, tag)
    if (extra === 'relation' && fam.addRelation) s += fam.addRelation(k, tag)
    return s
  })
}

describe('hard invariants: independent oracle over corpus + fuzz (target 0)', () => {
  test('every flowchart corpus diagram is hard-clean', () => {
    const corpus = JSON.parse(
      readFileSync(join(import.meta.dir, '..', '..', 'eval', 'mermaid-docs-corpus', 'corpus.json'), 'utf8'),
    ) as Array<{ family: string; source: string; index: number }>
    const flowcharts = corpus.filter(e => e.family === 'flowchart')
    // Guard against the gate silently passing by checking nothing: every entry
    // must parse (an unparseable one is reported as an offence below).
    expect(flowcharts.length).toBeGreaterThanOrEqual(100)

    const offenders = flowcharts.flatMap(e => offences(`corpus/flowchart/${e.index}`, e.source))
    if (offenders.length > 0) {
      throw new Error(`hard-invariant violations in the flowchart corpus:\n  ${offenders.join('\n  ')}`)
    }
  })

  test('generated flowcharts are hard-clean (with shrinking)', () => {
    fc.assert(fc.property(flowchartArb(), source => {
      expect(offences('generated flowchart', source)).toEqual([])
    }), fcParameters({ numRuns: 200, seed: SEED }))
  })
})

// Small flowcharts with disjoint subgraphs, mixed shapes, per-group directions
// and edges to/from groups, laid out in looks that resize nodes and frames.
// Membership comes from the generator, not the parser, so the containment
// check below is independent of the producer's own bookkeeping.
const SHAPES = [['[', ']'], ['(', ')'], ['([', '])'], ['{', '}'], ['[/', '/]'], ['((', '))']] as const
const LINKS = ['-->', '---', '-.->', '==>', '<-->', '--o', '--x'] as const
const LOOKS = ['default', 'ops-schematic', 'status-dashboard', 'accessible-high-contrast', 'hand-drawn', 'publication-figure'] as const
type GroupedCase = { source: string; members: Array<[string, string[]]>; look: typeof LOOKS[number]; mustCertify?: true }

const groupedFlowchartArb: fc.Arbitrary<GroupedCase> = fc.integer({ min: 2, max: 10 }).chain(n => fc.record({
  direction: fc.constantFrom('TD', 'LR', 'BT', 'RL'),
  shapes: fc.array(fc.integer({ min: 0, max: SHAPES.length - 1 }), { minLength: n, maxLength: n }),
  // -1 leaves a node outside every group; one owner keeps membership disjoint.
  owners: fc.array(fc.integer({ min: -1, max: 2 }), { minLength: n, maxLength: n }),
  groupDirections: fc.array(fc.option(fc.constantFrom('LR', 'TB'), { nil: null }), { minLength: 3, maxLength: 3 }),
  edges: fc.array(fc.record({
    from: fc.nat({ max: n + 2 }), to: fc.nat({ max: n + 2 }),
    link: fc.nat({ max: LINKS.length - 1 }), label: fc.boolean(),
  }), { minLength: 1, maxLength: 2 * n }),
  look: fc.constantFrom(...LOOKS),
})).map(chart => {
  const nodes = chart.shapes.map((_, i) => `n${i}`)
  const members = new Map<string, string[]>()
  chart.owners.forEach((owner, i) => {
    if (owner >= 0) members.set(`G${owner}`, [...members.get(`G${owner}`) ?? [], nodes[i]!])
  })
  const groups = [...members.keys()].sort()
  const endpoints = [...nodes, ...groups]
  const lines = [`flowchart ${chart.direction}`]
  chart.shapes.forEach((shape, i) => lines.push(`  n${i}${SHAPES[shape]![0]}Node ${i}${SHAPES[shape]![1]}`))
  for (const id of groups) {
    const direction = chart.groupDirections[Number(id.slice(1))]
    lines.push(`  subgraph ${id}[Group ${id.slice(1)}]`, ...(direction ? [`    direction ${direction}`] : []), ...members.get(id)!.map(member => `    ${member}`), '  end')
  }
  chart.edges.forEach((edge, i) => lines.push(`  ${endpoints[edge.from % endpoints.length]} ${LINKS[edge.link]}${edge.label ? `|e${i}|` : ''} ${endpoints[edge.to % endpoints.length]}`))
  return { source: lines.join('\n') + '\n', members: [...members], look: chart.look }
})

// Reduced issue-A2 counterexamples. A diamond's symmetric fan-out moved a
// grouped target out of its frame, and a layer snap across group scopes moved
// a member past its frame padding; both inputs must now certify.
const FRAME_BREACH_EXAMPLES: GroupedCase[] = [
  {
    source: 'flowchart LR\n  A[Start] --> B{Decide}\n  B -->|yes| C[Ship]\n  B -->|no| D[Fix]\n  subgraph G[Group]\n    C\n  end\n',
    members: [['G', ['C']]], look: 'ops-schematic', mustCertify: true,
  },
  {
    source: [
      'flowchart LR', '  n0[/Node 0/]', '  n1[Node 1]', '  n2[/Node 2/]', '  n3((Node 3))', '  n6[Node 6]', '  n9((Node 9))', '  n10(Node 10)', '  n11[Node 11]',
      '  subgraph G0[Group 0]', '    n8', '  end', '  subgraph G1[Group 1]', '    n0', '  end', '  subgraph G2[Group 2]', '    n6', '  end',
      '  n6 <-->|e0| n0', '  n10 <--> n4', '  n1 <-->|e2| n10', '  G2 -.-> n1', '  n2 -.->|e4| G1', '  n4 ---|e5| n8', '  n11 -->|e6| n5',
      '  n2 ==> n8', '  n10 --x n5', '  n10 --> n5', '  n0 --> G2',
    ].join('\n') + '\n',
    members: [['G0', ['n8']], ['G1', ['n0']], ['G2', ['n6']]], look: 'default', mustCertify: true,
  },
]

// Reduced issue-A7 counterexamples: no bounded candidate certifies these, each
// for a different check (inward endpoint shaft, a group self-loop through its
// member, diagonal segments in a look that enlarges nodes). Valid source must
// still render, and verify must name the failed check. Two earlier members of
// this list now certify: a self-loop across its group's title band and a layer
// snap that overlapped two nodes; they must stay certified.
const UNCERTIFIED_EXAMPLES: GroupedCase[] = [
  { source: 'flowchart BT\n  n1 ==> n1\n  n2 ==> n3\n  n1 --o|e2| n0\n  n3 <-->|e3| n2\n  n2 --> n0\n  n2 --x n1\n', members: [], look: 'default' },
  { source: 'flowchart LR\n  subgraph G0[Group 0]\n    n2\n  end\n  G0 --x G0\n  n0 <--> n0\n  n2 --x n0\n  n1 <--> G0\n', members: [['G0', ['n2']]], look: 'default' },
  { source: 'flowchart TD\n  subgraph G0[Group 0]\n    direction LR\n    n1\n    n3\n  end\n  n3 -.->|e0| G1\n  n3 ==> n3\n', members: [['G0', ['n1', 'n3']]], look: 'default', mustCertify: true },
  { source: 'flowchart LR\n  n0[Node 0]\n  n3[/Node 3/]\n  n6\n  n10\n  subgraph G1[Group 1]\n    direction LR\n  end\n  n8 ==> n7\n  n16 ==> n2\n  n8 --x|e20| n14\n', members: [], look: 'default', mustCertify: true },
  { source: 'flowchart BT\n  subgraph G0[Group 0]\n    direction LR\n    n5\n  end\n  n3 --o n5\n  n10 --o n5\n  G0 --x|e17| G0\n  n9 --> n8\n', members: [['G0', ['n5']]], look: 'status-dashboard' },
]

// Reduced issue-A7 counterexamples whose routes entered a group's reserved
// title band and must now certify: an edge into a subgraph whose interior run
// crossed the target's band; a member self-loop drawn up into its group's band;
// and, in bottom-to-top flow, a route leaving a subgraph straight up through
// the band at the frame's top.
const HEADER_BAND_EXAMPLES: GroupedCase[] = [
  {
    source: 'flowchart TD\n  n2((Node 2))\n  subgraph G0[Group 0]\n    n2\n  end\n  subgraph G1[Group 1]\n    n1\n  end\n  G0 --- G1\n  n0 --x|e2| G1\n  G1 ---|e3| n2\n  G1 -.-> G1\n',
    members: [['G0', ['n2']], ['G1', ['n1']]], look: 'default', mustCertify: true,
  },
  {
    source: 'flowchart TD\n  subgraph G0[Group 0]\n    direction LR\n    n4\n    n5\n  end\n  n5 ==> n5\n  n0 -.-> n5\n',
    members: [['G0', ['n4', 'n5']]], look: 'default', mustCertify: true,
  },
  {
    source: 'flowchart BT\n  n6((Node 6))\n  subgraph G0[Group 0]\n    n7\n    n5\n  end\n  n3 --- n1\n  n4 ---|e1| n1\n  n6 --> n7\n  n6 ==> n5\n  n7 --> n3\n  n6 <--> n1\n  n4 --x n6\n  n1 --x|e11| n8\n  n6 -->|e12| n6\n  n8 ---|e16| n5\n',
    members: [['G0', ['n7', 'n5']]], look: 'status-dashboard', mustCertify: true,
  },
]

// Reduced issue-A7 counterexamples that drew misleading geometry and must now
// certify: a layer snap that overlapped two nodes and left a member 0.23px past
// its frame (verify reported GROUP_BREACH on a drawing certification accepted);
// an edge into a subgraph routed through an unrelated card, whose repair must
// keep its outward source shaft; the same with a group-member target; and a
// through-card route whose untouched leg grazes another card's bounding box.
const MISLEADING_EXAMPLES: GroupedCase[] = [
  {
    source: 'flowchart LR\n  n1([Node 1])\n  n2{Node 2}\n  n3((Node 3))\n  n8[/Node 8/]\n  n9{Node 9}\n  n10([Node 10])\n  subgraph G0[Group 0]\n    n10\n  end\n  subgraph G1[Group 1]\n    direction LR\n    n5\n  end\n  subgraph G2[Group 2]\n    n8\n  end\n  G2 -.->|e1| G1\n  n8 ==> n9\n  n10 ---|e3| G0\n  n9 -->|e4| n0\n  n1 -.-> n0\n  G0 ==>|e6| n5\n  n10 ==> n1\n  n9 --- n5\n',
    members: [['G0', ['n10']], ['G1', ['n5']], ['G2', ['n8']]], look: 'status-dashboard', mustCertify: true,
  },
  {
    source: 'flowchart LR\n  n0(Node 0)\n  subgraph G0[Group 0]\n    n6\n  end\n  subgraph G1[Group 1]\n    direction LR\n  end\n  G1 --o|e1| n13\n  n8 -.->|e6| n4\n  n8 --x|e8| n8\n  n13 -->|e12| G0\n  n0 -.->|e13| n9\n  n13 -->|e16| n9\n  n8 --> n9\n  n11 --> n6\n',
    members: [['G0', ['n6']]], look: 'default', mustCertify: true,
  },
  {
    source: 'flowchart LR\n  subgraph G0[Group 0]\n    n0\n    n1\n  end\n  subgraph G1[Group 1]\n    direction LR\n    n8\n  end\n  n8 ==> n1\n  n9 <--> n1\n  n10 --x n10\n  n0 --o|e6| G1\n  n8 ==>|e7| n10\n',
    members: [['G0', ['n0', 'n1']], ['G1', ['n8']]], look: 'accessible-high-contrast', mustCertify: true,
  },
  {
    source: 'flowchart LR\n  n0(Node 0)\n  n6((Node 6))\n  n10((Node 10))\n  subgraph G0[Group 0]\n    n0\n    n1\n  end\n  subgraph G1[Group 1]\n    direction LR\n    n8\n    n9\n  end\n  n8 ==> n1\n  n9 <--> n1\n  n10 --x n10\n  n6 --> n1\n  n0 --o|e6| G1\n  n8 ==>|e7| n10\n',
    members: [['G0', ['n0', 'n1']], ['G1', ['n8', 'n9']]], look: 'accessible-high-contrast', mustCertify: true,
  },
]

// Reduced issue-A7 counterexample of a broken pass contract: the labelled
// source n11 is fed by an edge from subgraph G0, which cannot travel with the
// source's slide, so alignLabeledSourcePort left that endpoint off the moved
// outline and worsened portRate (LayoutMetricBudgetError, no render at all).
const PASS_CONTRACT_EXAMPLES: GroupedCase[] = [
  {
    source: 'flowchart LR\n  subgraph G0[Group 0]\n    n9\n  end\n  n11 <-->|e5| n7\n  G0 ---|e8| n11\n  n12 -.->|e12| n4\n  n10 -.-> n7\n  n9 --o|e18| n10\n  n6 ---|e19| n7\n',
    members: [['G0', ['n9']]], look: 'default', mustCertify: true,
  },
]

// Reduced issue-A7 counterexamples whose terminal shaft approached its card
// from inside: ELK hooked a feedback route around its target and ended it with
// a short stub from inside the card's box, and a route that ran up inside a
// slanted card's box hooked down into its bottom port.
const ENDPOINT_EXAMPLES: GroupedCase[] = [
  { source: 'flowchart BT\n  n2((Node 2))\n  n3[/Node 3/]\n  n4 --x|e0| n1\n  n0 --o|e2| n2\n  n0 --x n0\n  n2 --x n0\n  n3 --- n2\n  n4 <--> n1\n  n4 ==>|e7| n1\n  n2 --x n1\n', members: [], look: 'default', mustCertify: true },
  { source: 'flowchart BT\n  n1 <--> n1\n  n10 --x|e1| n1\n  n3 --> n1\n  n10 --o n11\n', members: [], look: 'accessible-high-contrast', mustCertify: true },
]

// Reduced issue-A7 counterexamples with a slanted segment or a detached
// label: a layer snap moved a route's endpoint and first bend but not the
// collinear point after them; alignLabeledSourcePort slid a source off the
// lane of its straight two-point route; the same slide re-anchored an exit
// onto a new lane without moving the next bend; and it carried a self-loop
// with its node but left the loop's label behind.
const ROUTE_SHAPE_EXAMPLES: GroupedCase[] = [
  { source: 'flowchart BT\n  n5(Node 5)\n  subgraph G0[Group 0]\n    direction TB\n    n8\n    n10\n    n1\n  end\n  subgraph G1[Group 1]\n    direction LR\n    n0\n    n3\n  end\n  n1 ---|e0| G1\n  n8 --x n1\n  n6 -.->|e4| n2\n  n0 --- n5\n  n0 --x|e7| n13\n  G1 --x n1\n  n3 --o n5\n  n6 -->|e10| n11\n  G1 --x|e11| n5\n  n8 -->|e12| n9\n  n5 --> n7\n  n9 --> n3\n  n6 ==> n10\n  n1 -->|e16| n2\n  n13 -.->|e17| n9\n  n1 --> n7\n  G1 -.-> n13\n  n9 -.->|e20| n8\n  G0 --x n6\n  n1 --- n2\n  n11 --> n6\n  n7 --x n13\n  n1 <--> n12\n  n8 --x|e27| n5\n', members: [['G0', ['n8', 'n10', 'n1']], ['G1', ['n0', 'n3']]], look: 'status-dashboard', mustCertify: true },
  { source: 'flowchart BT\n  n2[/Node 2/]\n  n8([Node 8])\n  n7 --- n5\n  n13 --> n4\n  n8 <-->|e6| n12\n  n7 --x|e7| n1\n  n2 ---|e8| n13\n  n2 <--> n14\n  n13 --- n7\n  n4 ==> n4\n  n5 --o n12\n  n5 --x|e17| n14\n', members: [], look: 'status-dashboard', mustCertify: true },
  { source: 'flowchart LR\n  n5[/Node 5/]\n  n6{Node 6}\n  n7[Node 7]\n  n4 <--> n9\n  n8 --o n10\n  n5 -.-> n3\n  n5 ---|e6| n8\n  n10 -.->|e8| n0\n  n9 ==>|e9| n2\n  n6 ==>|e11| n7\n  n5 -.->|e12| n7\n  n5 --o n0\n  n3 --- n5\n', members: [], look: 'status-dashboard', mustCertify: true },
  { source: 'flowchart BT\n  n1([Node 1])\n  n1 ==> n4\n  n4 --- n3\n  n2 --x|e3| n2\n  n2 --x|e5| n4\n', members: [], look: 'accessible-high-contrast', mustCertify: true },
]

describe('authored group frames hold their members in every look', () => {
  test('generated subgraph flowcharts render, keep members in frames, and name any uncertified check', () => {
    fc.assert(fc.property(groupedFlowchartArb, ({ source, members, look, mustCertify }) => {
      const options = look === 'default' ? {} : { style: look }
      // Issue A7: valid source always renders, whether or not a candidate certifies.
      const { svg, receipt } = renderMermaidSVGWithReceipt(source, options)
      expect(svg.startsWith('<svg'), `${look}\n${source}`).toBe(true)
      const request = resolveRenderRequestForExecution(source, options, 'svg')
      const result = positionResolvedFamily('flowchart', request)
      const positioned = result.positioned as PositionedGraph
      const geometry = (receipt.layoutCertification as PaintLayoutCertification | undefined)?.geometry
      expect(geometry, 'the render receipt records the positioned result').toEqual(result.uncertifiedLayout)
      if (mustCertify) expect(geometry).toBeUndefined()
      const kinds = new Set(geometry?.violations.map(violation => violation.kind))
      // The independent rubric finds no hard violation the receipt leaves out.
      if (look === 'default') {
        const oracle = hardViolations(assessLayout(parseMermaid(normalizeMermaidSource(source).text), positioned)).map(violation => violation.metric)
        expect(oracle.filter(metric => !kinds.has(metric)), `${look}\n${source}`).toEqual([])
      }
      if (geometry) {
        const verdict = verifyMermaid(source, { renderOptions: options })
        expect(verdict.ok, `${look}\n${source}`).toBe(false)
        const named = new Set(verdict.warnings.flatMap(warning => warning.code === 'LAYOUT_UNCERTIFIED' ? [warning.violation] : warning.code === 'GROUP_BREACH' ? ['groupBreaches'] : []))
        expect([...kinds].filter(kind => !named.has(kind)), `${look}\n${source}`).toEqual([])
        // Strict layout safety refuses what report safety drew uncertified.
        expect(() => renderMermaidSVGWithReceipt(source, { ...options, layoutSafety: 'strict' })).toThrow(LayoutCertificationError)
      }
      // No look draws one card over another (the rubric's 0.5px overlap rule).
      const cards = positioned.nodes
      const overlapping = cards.flatMap((a, i) => cards.slice(i + 1).filter(b =>
        Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5).map(b => `${a.id}/${b.id}`))
      expect(overlapping, `${look}\n${source}`).toEqual([])
      const frames = new Map<string, PositionedGroup>()
      const collect = (groups: PositionedGroup[]): void => { for (const group of groups) { frames.set(group.id, group); collect(group.children) } }
      collect(positioned.groups)
      const nodes = new Map(positioned.nodes.map(node => [node.id, node]))
      for (const [id, ids] of members) {
        const frame = frames.get(id)
        expect(frame, `${id} frame`).toBeDefined()
        for (const member of ids) {
          const node = nodes.get(member)!
          // The frame stroke sits on its edge, so only roundoff is tolerated;
          // verify's GROUP_BREACH check uses no wider tolerance on any side.
          expect([node.x >= frame!.x - 1e-6, node.y >= frame!.y - 1e-6,
            node.x + node.width <= frame!.x + frame!.width + 1e-6, node.y + node.height <= frame!.y + frame!.height + 1e-6],
          `${member} inside ${id} (${look})\n${source}`).toEqual([true, true, true, true])
        }
      }
    }), fcParameters({ numRuns: 40, seed: SEED, examples: [...FRAME_BREACH_EXAMPLES, ...UNCERTIFIED_EXAMPLES, ...MISLEADING_EXAMPLES, ...HEADER_BAND_EXAMPLES, ...PASS_CONTRACT_EXAMPLES, ...ENDPOINT_EXAMPLES, ...ROUTE_SHAPE_EXAMPLES].map(example => [example]) }))
  })
})
