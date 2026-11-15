import { describe, expect, test } from 'bun:test'
import { verifyMermaid } from '../agent/verify.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { estimateLayoutCost, LAYOUT_COST_THRESHOLDS, layoutCostReceipt, type RelaxedLayoutOption } from '../layout/layout-cost.ts'
import { parseMermaid } from '../parser.ts'
import type { PaintLayoutCertification } from '../scene/paint-certification.ts'

const flowchart = (edges: Array<[string, string]>): string => ['flowchart TD', ...edges.map(([a, b]) => `${a} --> ${b}`)].join('\n')
const complete = (n: number): Array<[string, string]> => Array.from({ length: n }, (_, i) => Array.from({ length: n - i - 1 }, (_, k): [string, string] => [`k${i}`, `k${i + k + 1}`])).flat()
const chain = (n: number): Array<[string, string]> => Array.from({ length: n - 1 }, (_, i): [string, string] => [`n${i}`, `n${i + 1}`])
/** A chain with `links` nested long edges n_i -> n_(n-1-i). */
const nestedLinks = (n: number, links: number): Array<[string, string]> => [...chain(n), ...Array.from({ length: links }, (_, i): [string, string] => [`n${i}`, `n${n - 1 - i}`])]

describe('layered layout cost estimate', () => {
  test('counts long-edge dummies and the densest gap from the graph alone', () => {
    // Expected values follow from longest-path layering in model order.
    const cases: Array<{ name: string; edges: Array<[string, string]>; dummySegments: number; maxGapEdges: number; layers: number }> = [
      // Edge i -> j spans j - i layers: Σ (j - i - 1) = C(n, 3); the middle gap carries ⌊n/2⌋·⌈n/2⌉.
      { name: 'complete DAG 12', edges: complete(12), dummySegments: 220, maxGapEdges: 36, layers: 12 },
      // Edge by edge, b0..b4 are declared before a1..a6, so those edges point b -> a.
      { name: 'bipartite 7 x 5', edges: Array.from({ length: 7 }, (_, i) => Array.from({ length: 5 }, (_, j): [string, string] => [`a${i}`, `b${j}`])).flat(), dummySegments: 0, maxGapEdges: 30, layers: 3 },
      { name: 'chain 9', edges: chain(9), dummySegments: 0, maxGapEdges: 1, layers: 9 },
      // Links span n-1-2i layers; every gap inside the innermost link carries all of them.
      { name: 'nested links', edges: nestedLinks(10, 3), dummySegments: 8 + 6 + 4, maxGapEdges: 4, layers: 10 },
      // A back edge is oriented by model order, so the cycle adds no layer.
      { name: 'cycle', edges: [['x', 'y'], ['y', 'z'], ['z', 'x']], dummySegments: 1, maxGapEdges: 2, layers: 3 },
      { name: 'self-loop and parallel pair', edges: [['p', 'p'], ['p', 'q'], ['p', 'q']], dummySegments: 0, maxGapEdges: 2, layers: 2 },
    ]
    for (const { name, edges, ...expected } of cases) {
      const estimate = estimateLayoutCost(parseMermaid(flowchart(edges)))
      expect({ name, dummySegments: estimate.dummySegments, maxGapEdges: estimate.maxGapEdges, layers: estimate.layers }).toEqual({ name, ...expected })
    }
    // `&` declares every source before any target: one gap carries all 35.
    const fan = estimateLayoutCost(parseMermaid('flowchart TD\na0 & a1 & a2 & a3 & a4 & a5 & a6 --> b0 & b1 & b2 & b3 & b4'))
    expect([fan.layers, fan.dummySegments, fan.maxGapEdges]).toEqual([2, 0, 35])
    // Seven fan-outs of 5 and five fan-ins of 7, each admitted against 35 routes.
    expect(fan.bundleWork).toBe(70 * 35)
  })

  test('each relaxation follows its own threshold', () => {
    const fan = (from: string, to: string, n: number): string => `${Array.from({ length: n }, (_, i) => `${from}${i}`).join(' & ')} --> ${Array.from({ length: n }, (_, i) => `${to}${i}`).join(' & ')}`
    const cases: Array<{ name: string; source: string; relaxed: RelaxedLayoutOption[] | undefined }> = [
      { name: 'long edges only', source: flowchart(nestedLinks(80, 20)), relaxed: ['model-order'] },
      // Two stacked 19 x 19 fans: 361 edges per gap, but 1,444 fan members x 722 edges.
      { name: 'stacked fans', source: `flowchart TD\n${fan('a', 'b', 19)}\n${fan('b', 'c', 19)}`, relaxed: ['edge-bundling'] },
      { name: 'one 20 x 20 gap', source: `flowchart TD\n${fan('a', 'b', 20)}`, relaxed: ['model-order'] },
      { name: 'one 23 x 23 gap', source: `flowchart TD\n${fan('a', 'b', 23)}`, relaxed: ['model-order', 'edge-bundling'] },
      { name: 'below every threshold', source: `flowchart TD\n${fan('a', 'b', 19)}`, relaxed: undefined },
    ]
    for (const { name, source, relaxed } of cases) expect({ name, relaxed: layoutCostReceipt(parseMermaid(source))?.relaxed }).toEqual({ name, relaxed })
  })

  test('a graph above a threshold records the bounded profile in the receipt and as an advisory finding', () => {
    // 20 nested links on an 80-node chain: Σ (78 - 2i) = 1,180 dummy segments.
    const heavy = flowchart(nestedLinks(80, 20))
    expect(estimateLayoutCost(parseMermaid(heavy)).dummySegments).toBeGreaterThanOrEqual(LAYOUT_COST_THRESHOLDS.dummySegments)
    const certification = renderMermaidSVGWithReceipt(heavy).receipt.layoutCertification as PaintLayoutCertification | undefined
    expect(certification?.layoutCost).toEqual({
      // 40 fan-out and 40 fan-in members (the 20 linked pairs) x 99 edges.
      estimate: { nodes: 80, edges: 99, layers: 80, dummySegments: 1180, maxGapEdges: 21, bundleWork: 7920 },
      relaxed: ['model-order'], maxCandidates: 2, maxElkAttemptsPerCandidate: 2,
    })
    expect(certification?.geometry).toBeUndefined()
    const verified = verifyMermaid(heavy)
    expect(verified.ok).toBe(true)
    expect(verified.warnings.filter(warning => warning.code === 'LAYOUT_LIMIT_EXCEEDED')).toEqual([
      expect.objectContaining({ constraint: 'layout.cost', message: expect.stringContaining('1180 long-edge dummy segments') }),
    ])
    expect(verifyMermaid(heavy, { suppress: ['LAYOUT_LIMIT_EXCEEDED'] }).warnings.some(warning => warning.code === 'LAYOUT_LIMIT_EXCEEDED')).toBe(false)
  })

  test('a graph below both thresholds keeps the full search and no cost receipt', () => {
    const light = flowchart(nestedLinks(80, 10))
    const estimate = estimateLayoutCost(parseMermaid(light))
    expect(estimate.dummySegments).toBe(690)
    expect((renderMermaidSVGWithReceipt(light).receipt.layoutCertification as PaintLayoutCertification | undefined)?.layoutCost).toBeUndefined()
    expect(verifyMermaid(light).warnings.some(warning => warning.code === 'LAYOUT_LIMIT_EXCEEDED')).toBe(false)
  })
})
