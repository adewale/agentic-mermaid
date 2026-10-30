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
import '../index.ts' // installs the render families positionResolvedFamily resolves
import { positionResolvedFamily } from '../positioning.ts'
import { resolveRenderRequestForExecution } from '../render-contract.ts'
import { LayoutCertificationError } from '../layout/certification.ts'
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

describe('authored group frames hold their members in every look', () => {
  test('generated subgraph flowcharts never place a member outside its frame', () => {
    fc.assert(fc.property(groupedFlowchartArb, ({ source, members, look, mustCertify }) => {
      let positioned: PositionedGraph
      try {
        const request = resolveRenderRequestForExecution(source, look === 'default' ? {} : { style: look }, 'svg')
        positioned = (positionResolvedFamily('flowchart', request) as { positioned: PositionedGraph }).positioned
      } catch (error) {
        // Other hard metrics (header bands, endpoint approaches) are separate
        // contracts. Frame correspondence is checked before them, so no
        // attempt of a certification failure may report a frame breach.
        if (mustCertify || !(error instanceof LayoutCertificationError)) throw error
        expect(error.attempts.flatMap(attempt => attempt.violations).filter(violation => violation.includes('outside authored'))).toEqual([])
        return
      }
      const frames = new Map<string, PositionedGroup>()
      const collect = (groups: PositionedGroup[]): void => { for (const group of groups) { frames.set(group.id, group); collect(group.children) } }
      collect(positioned.groups)
      const nodes = new Map(positioned.nodes.map(node => [node.id, node]))
      for (const [id, ids] of members) {
        const frame = frames.get(id)
        expect(frame, `${id} frame`).toBeDefined()
        for (const member of ids) {
          const node = nodes.get(member)!
          expect([node.x >= frame!.x - 0.5, node.y >= frame!.y - 0.5,
            node.x + node.width <= frame!.x + frame!.width + 0.5, node.y + node.height <= frame!.y + frame!.height + 0.5],
          `${member} inside ${id} (${look})\n${source}`).toEqual([true, true, true, true])
        }
      }
    }), fcParameters({ numRuns: 40, seed: SEED, examples: FRAME_BREACH_EXAMPLES.map(example => [example]) }))
  })
})
