import '../index.ts'
import { describe, expect, test } from 'bun:test'
import { certifyOwnedLayoutCandidate, refineOwnedLayoutCandidate, certifyLayoutCandidates, certifyLayoutWithRouteAlternative, LayoutCertificationError, MAX_LAYOUT_CANDIDATES } from '../layout/certification.ts'
import { LayoutMetricBudgetError } from '../layout/pass.ts'
import { DiagramWorkLimitError } from '../shared/diagram-limits.ts'
import { DeferredDependencyError, GraphLayoutUnsupportedError } from '../layout/backend.ts'
import { LAYOUT_PIPELINE, layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { withPerformanceExperiments, type PerformanceExperiment } from '../experimental-performance.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { resolveRenderRequestForExecution } from '../render-contract.ts'
import { resolveRenderStyle } from '../styles.ts'
import { positionedToRenderedLayout } from '../agent/layout-to-rendered.ts'
import { graphTextBlock } from '../graph-text.ts'
import type { MermaidGraph, PositionedGraph } from '../types.ts'

const source = 'flowchart LR\nA -- first --> B\nB -- second --> A'

function routeWitness(graph: MermaidGraph, positions: Record<string, [number, number]>, routes: Array<Array<[number, number]>>, width = 360, height = 280): PositionedGraph {
  return {
    width, height, groups: [],
    nodes: [...graph.nodes.values()].map(node => ({ ...node, x: positions[node.id]![0], y: positions[node.id]![1], width: 40, height: 40 })),
    edges: graph.edges.map((edge, index) => ({ ...edge, edgeIndex: index, points: routes[index]!.map(([x, y]) => ({ x, y })) })),
  }
}

describe('bounded final layout certification', () => {
  const crossingWitness = () => {
    const graph = parseMermaid('flowchart LR\nA --> B\nC --> D')
    const positions: Record<string, [number, number]> = { A: [0, 120], B: [300, 120], C: [100, 0], D: [100, 240] }
    const first = routeWitness(graph, positions, [[[40, 140], [300, 140]], [[120, 40], [120, 240]]], 360, 340)
    const other = routeWitness(graph, positions, [[[40, 140], [80, 140], [80, 300], [280, 300], [280, 140], [300, 140]], [[120, 40], [120, 240]]], 360, 340)
    return { graph, first, other, style: resolveRenderStyle() }
  }

  test('certifies both owned candidates before preferring fewer final crossings', () => {
    const { graph, first, other, style } = crossingWitness()
    expect(refineOwnedLayoutCandidate(graph, style, first, () => other)).toBe(other)
    expect(other.certification?.status).toBe('passed')
  })

  test('preserves the owned primary after typed decline or invalid alternative geometry', () => {
    const { graph, first, other, style } = crossingWitness()
    expect(refineOwnedLayoutCandidate(graph, style, first, () => { throw new GraphLayoutUnsupportedError('optional channel limit') })).toBe(first)
    other.edges[0]!.points = []
    expect(refineOwnedLayoutCandidate(graph, style, first, () => other)).toBe(first)
  })

  test.each([new TypeError('unexpected refinement defect'), new DiagramWorkLimitError('nodes', 5_001), new DeferredDependencyError('native', async () => {})])('propagates owned refinement failure %s', failure => {
    const { graph, first, style } = crossingWitness()
    expect(() => refineOwnedLayoutCandidate(graph, style, first, () => { throw failure })).toThrow(failure)
  })

  test('never hides changed meaning in an owned alternative', () => {
    const { graph, first, other, style } = crossingWitness()
    other.nodes[0]!.label = 'lost authored identity'
    expect(() => refineOwnedLayoutCandidate(graph, style, first, () => other)).toThrow(TypeError)
  })
  test('owned candidate correspondence failures are engine defects, not recoverable geometry', () => {
    const graph = parseMermaid('flowchart TD\nA --> B')
    const changed = layoutGraphSync(graph)
    changed.nodes[0]!.label = 'changed meaning'
    expect(() => certifyOwnedLayoutCandidate(graph, resolveRenderStyle({}), { strategy: 'owned', produce: () => changed })).toThrow(TypeError)
  })

  test('owned candidate exceptions propagate while geometric rejection stays classified', () => {
    const graph = parseMermaid('flowchart TD\nA --> B')
    const failure = new TypeError('unexpected solver failure')
    expect(() => certifyOwnedLayoutCandidate(graph, resolveRenderStyle({}), { strategy: 'owned', produce: () => { throw failure } })).toThrow(failure)
    const rejected = layoutGraphSync(graph)
    rejected.edges[0]!.points = []
    expect(() => certifyOwnedLayoutCandidate(graph, resolveRenderStyle({}), { strategy: 'owned', produce: () => rejected })).toThrow(LayoutCertificationError)
  })

  test.each([false, true])('a rejected conditional solver preserves all four fallbacks with route selection %s', routeSelection => {
    const graph = parseMermaid('flowchart LR\nA --> B')
    const clean = layoutGraphSync(graph)
    const invalid = structuredClone(clean)
    invalid.edges[0]!.points = []
    const candidates = [
      { strategy: 'default', produce: () => invalid },
      { strategy: 'separate-hierarchy', produce: () => invalid },
      { strategy: 'without-corank', produce: () => invalid },
      { strategy: 'separate-without-corank', produce: () => clean },
    ]
    const preliminary = { strategy: 'indexed-forest', produce: () => invalid }
    const selected = routeSelection
      ? certifyLayoutWithRouteAlternative(graph, resolveRenderStyle({}), candidates, () => undefined, preliminary)
      : certifyLayoutCandidates(graph, resolveRenderStyle({}), candidates, preliminary)
    expect(selected.certification).toMatchObject({ strategy: 'separate-without-corank', attempts: 5, hardViolations: 0 })
  })

  test.each([
    { flags: [] as PerformanceExperiment[], strategy: 'separate-hierarchy' },
    { flags: ['indexed-layout'] as PerformanceExperiment[], strategy: 'default' },
  ])('a failing primary producer is contained before $strategy within the public fallback budget', ({ flags, strategy }) => {
    const firstPass = LAYOUT_PIPELINE[0]!
    const run = firstPass.run
    let calls = 0
    firstPass.run = context => {
      if (++calls === 1) throw new Error('primary geometry producer failed')
      run(context)
    }
    try {
      const positioned = withPerformanceExperiments(flags, () => layoutGraphSync(parseMermaid('flowchart LR\nA --> B')))
      expect(calls).toBe(2)
      expect(positioned.certification).toMatchObject({ status: 'passed', strategy, attempts: 2, hardViolations: 0 })
      expect(positioned.nodes.map(node => node.id).sort()).toEqual(['A', 'B'])
    } finally {
      firstPass.run = run
    }
  })

  test('the public layout certifies actual styled label geometry', () => {
    const request = resolveRenderRequestForExecution(source, { style: { roles: { edge: { fontSize: 24 } } } }, 'svg')
    const { positioned } = positionResolvedFamily('flowchart', request) as { positioned: PositionedGraph }
    expect(positioned.certification?.status).toBe('passed')
    expect(positioned.certification?.hardViolations).toBe(0)
    expect(positioned.certification!.attempts).toBeLessThanOrEqual(MAX_LAYOUT_CANDIDATES)
    expect(positioned.edges.every(edge => edge.labelBlock?.fontSize === 24)).toBe(true)
  })

  test('an invalid first route yields to a certified deterministic alternative', () => {
    const graph = parseMermaid(source)
    const clean = layoutGraphSync(graph)
    const invalid = structuredClone(clean)
    invalid.edges[0]!.points = []
    const selected = certifyLayoutCandidates(graph, resolveRenderStyle({}), [
      { strategy: 'missing-route', produce: () => invalid },
      { strategy: 'clean', produce: () => clean },
    ])
    expect(selected.certification).toMatchObject({ status: 'passed', strategy: 'clean', attempts: 2, hardViolations: 0 })
    expect(selected.edges[0]!.points.length).toBeGreaterThanOrEqual(2)
  })

  test('readable container titles take precedence over a crossing reduction', () => {
    const graph = parseMermaid('flowchart LR\nsubgraph S[A deliberately long container heading whose complete readable text needs additional horizontal space]\nA --> B\nend\nC --> D')
    const narrow = routeWitness(graph, { A: [20, 100], B: [260, 100], C: [20, 20], D: [300, 220] }, [
      [[60, 120], [260, 120]], [[40, 60], [40, 80], [320, 80], [320, 220]],
    ])
    const wide = routeWitness(graph, { A: [20, 100], B: [260, 100], C: [140, 20], D: [140, 220] }, [
      [[60, 120], [260, 120]], [[160, 60], [160, 220]],
    ], 900)
    const title = graph.subgraphs[0]!.label, style = resolveRenderStyle({})
    narrow.groups = [{ id: 'S', label: title, x: 0, y: 80, width: 320, height: 80, children: [] }]
    wide.groups = [{ id: 'S', label: title, x: 0, y: 80, width: 880, height: 80, children: [] }]
    const preferNext = (positioned: PositionedGraph) => positioned.groups[0]!.width < graphTextBlock(title, style, 'group').width + 24
    const selected = certifyLayoutCandidates(graph, style, [
      { strategy: 'narrow-clear', produce: () => narrow, preferNext },
      { strategy: 'readable-crossing', produce: () => wide, preferNext },
    ])
    expect(selected).toBe(wide)
    expect(selected.certification?.preference).toMatchObject({ reason: 'unreadableTitles', selectedScore: { unreadableTitles: 0, edgeCrossings: 1 } })
    expect(selected.certification?.preference.compared[0]?.score).toMatchObject({ unreadableTitles: 1, edgeCrossings: 0 })
  })

  test('crossing reduction outranks fewer bends and a smaller canvas among feasible routes', () => {
    const graph = parseMermaid('flowchart LR\nA --> B\nC --> D')
    const crossing = routeWitness(graph, { A: [20, 100], B: [260, 100], C: [140, 20], D: [140, 220] }, [
      [[60, 120], [260, 120]], [[160, 60], [160, 220]],
    ], 320)
    const detour = routeWitness(graph, { A: [20, 100], B: [260, 100], C: [20, 20], D: [300, 220] }, [
      [[60, 120], [260, 120]], [[40, 60], [40, 80], [320, 80], [320, 220]],
    ])
    const selected = certifyLayoutCandidates(graph, resolveRenderStyle({}), [
      { strategy: 'short-crossing', produce: () => crossing }, { strategy: 'clear-detour', produce: () => detour },
    ])
    expect(selected).toBe(detour)
    expect(selected.certification?.preference).toMatchObject({ reason: 'edgeCrossings', selectedScore: { edgeCrossings: 0, totalBends: 2, area: 100800 } })
    expect(selected.certification?.preference.compared[0]?.score).toMatchObject({ edgeCrossings: 1, totalBends: 0, area: 89600 })
  })

  test('a final route comparison reuses its placement preflight and keeps placement evidence', () => {
    const graph = parseMermaid('flowchart LR\nA --> B\nC --> D')
    const crossing = routeWitness(graph, { A: [20, 100], B: [260, 100], C: [140, 20], D: [140, 220] }, [
      [[60, 120], [260, 120]], [[160, 60], [160, 220]],
    ], 320)
    const detour = routeWitness(graph, { A: [20, 100], B: [260, 100], C: [20, 20], D: [300, 220] }, [
      [[60, 120], [260, 120]], [[40, 60], [40, 80], [320, 80], [320, 220]],
    ])
    let placementPreflights = 0, routePreflights = 0
    const selected = certifyLayoutWithRouteAlternative(graph, resolveRenderStyle({}), [{
      strategy: 'placement', produce: () => crossing,
      preferNext: () => { placementPreflights++; return false },
    }], (_placed, score) => {
      expect(score.edgeCrossings).toBe(1)
      return {
        strategy: 'without-generic-bundling', produce: () => detour,
        preferNext: () => { routePreflights++; return false },
      }
    })
    expect(placementPreflights).toBe(1)
    expect(routePreflights).toBe(1)
    expect(selected).toBe(detour)
    expect(selected.certification).toMatchObject({ strategy: 'placement', attempts: 1, preference: {
      selectedScore: { edgeCrossings: 0 },
      compared: [{ strategy: 'placement', score: { edgeCrossings: 1 } }],
      routing: { strategy: 'without-generic-bundling', preference: { reason: 'edgeCrossings', selectedScore: { edgeCrossings: 0 } } },
    } })
  })

  test('a final routing callback cannot use an attached receipt to bypass placement checks', () => {
    const graph = parseMermaid(source)
    const forged = layoutGraphSync(graph)
    forged.edges[0]!.points = []
    let routeCalls = 0
    expect(() => certifyLayoutWithRouteAlternative(graph, resolveRenderStyle({}), [{
      strategy: 'forged-receipt', produce: () => forged,
    }], () => { routeCalls++; return undefined })).toThrow(LayoutCertificationError)
    expect(routeCalls).toBe(0)
  })

  function labelledWitness(crossing: boolean, conflict = false): { graph: MermaidGraph; positioned: PositionedGraph } {
    const graph = parseMermaid('flowchart LR\nA -- x --> B\nC --> D')
    const positioned = crossing
      ? routeWitness(graph, { A: [20, 100], B: [260, 100], C: [140, 20], D: [140, 220] }, [
          [[60, 120], [260, 120]], [[160, 60], [160, 220]],
        ])
      : conflict
        ? routeWitness(graph, { A: [20, 100], B: [260, 100], C: [80, 70], D: [300, 220] }, [
            [[60, 120], [260, 120]], [[100, 70], [100, 60], [320, 60], [320, 220]],
          ])
        : routeWitness(graph, { A: [20, 100], B: [260, 100], C: [20, 20], D: [300, 220] }, [
            [[60, 120], [260, 120]], [[40, 60], [40, 80], [320, 80], [320, 220]],
          ])
    positioned.edges[0]!.labelPosition = { x: 100, y: 120 }
    positioned.edges[0]!.labelBlock = graphTextBlock('x', resolveRenderStyle({}), 'edge')
    return { graph, positioned }
  }

  test('a soft label-conflict reduction cannot buy another crossing', () => {
    const { graph, positioned: occluded } = labelledWitness(false, true)
    const { positioned: clear } = labelledWitness(true)
    const selected = certifyLayoutCandidates(graph, resolveRenderStyle({}), [
      { strategy: 'occluded-without-crossings', produce: () => occluded },
      { strategy: 'readable-with-crossing', produce: () => clear },
    ])
    expect(selected).toBe(occluded)
    expect(selected.certification?.preference).toMatchObject({ reason: 'edgeCrossings', selectedScore: { edgeCrossings: 0 } })
    expect(selected.certification!.preference.selectedScore.labelConflicts).toBeGreaterThan(0)
    expect(selected.certification!.preference.compared[1]!.score).toMatchObject({ labelConflicts: 0, edgeCrossings: 1 })
  })

  test('zero crossings do not suppress a bounded label-conflict comparison', () => {
    const { graph, positioned: occluded } = labelledWitness(false, true)
    const { positioned: clear } = labelledWitness(false)
    let produced = 0
    const selected = certifyLayoutCandidates(graph, resolveRenderStyle({}), [
      { strategy: 'occluded', produce: () => occluded },
      { strategy: 'clear', produce: () => { produced++; return clear } },
    ])
    expect(produced).toBe(1)
    expect(selected).toBe(clear)
    expect(selected.certification?.preference).toMatchObject({ reason: 'labelConflicts', selectedScore: { labelConflicts: 0, edgeCrossings: 0 } })
  })

  test('continuity outranks canonical ports when crossings are equal', () => {
    const graph = parseMermaid('flowchart LR\nA --> B\nC --> D')
    const bends = routeWitness(graph, { A: [20, 100], B: [260, 100], C: [140, 20], D: [200, 220] }, [
      [[60, 120], [260, 120]], [[160, 60], [160, 180], [220, 180], [220, 220]],
    ])
    const straight = routeWitness(graph, { A: [20, 100], B: [260, 100], C: [140, 20], D: [140, 220] }, [
      [[60, 110], [260, 110]], [[160, 60], [160, 220]],
    ])
    const selected = certifyLayoutCandidates(graph, resolveRenderStyle({}), [
      { strategy: 'canonical-bends', produce: () => bends }, { strategy: 'straight-offset-ports', produce: () => straight },
    ])
    expect(selected).toBe(straight)
    expect(selected.certification?.preference).toMatchObject({ reason: 'totalBends', selectedScore: { edgeCrossings: 1, totalBends: 0, nonCanonicalEndpointRate: 0.5 } })
    expect(selected.certification?.preference.compared[0]?.score).toMatchObject({ totalBends: 2, nonCanonicalEndpointRate: 0 })
  })

  test('canonical ports outrank symmetry, which outranks compactness', () => {
    const graph = parseMermaid('flowchart LR\nA --> B\nE --> B\nC --> D')
    const fan = (hubY: number, width: number) => routeWitness(graph, { A: [20, 100], B: [260, hubY], C: [140, 20], D: [140, 260], E: [20, 180] }, [
      [[60, 120], [220, 120], [220, hubY + 20], [260, hubY + 20]],
      [[60, 200], [240, 200], [240, hubY + 20], [260, hubY + 20]],
      [[160, 60], [160, 260]],
    ], width, 320)
    const asymmetric = fan(130, 320), symmetric = fan(140, 360), offset = structuredClone(symmetric)
    offset.edges[0]!.points = [{ x: 60, y: 110 }, { x: 220, y: 110 }, { x: 220, y: 150 }, { x: 260, y: 150 }]
    const style = resolveRenderStyle({})
    const canonical = certifyLayoutCandidates(graph, style, [
      { strategy: 'symmetric-offset', produce: () => offset }, { strategy: 'canonical-asymmetric', produce: () => asymmetric },
    ])
    expect(canonical).toBe(asymmetric)
    expect(canonical.certification?.preference).toMatchObject({ reason: 'nonCanonicalEndpointRate', selectedScore: { edgeCrossings: 2, totalBends: 4, nonCanonicalEndpointRate: 0, peerBarycenterDelta: 10 } })
    const balanced = certifyLayoutCandidates(graph, style, [
      { strategy: 'compact-asymmetric', produce: () => asymmetric }, { strategy: 'larger-symmetric', produce: () => symmetric },
    ])
    expect(balanced).toBe(symmetric)
    expect(balanced.certification?.preference).toMatchObject({ reason: 'peerBarycenterDelta', selectedScore: { peerBarycenterDelta: 0, area: 115200 } })
    expect(balanced.certification?.preference.compared[0]?.score.area).toBe(102400)
  })

  test('compactness breaks quality ties and exact ties retain candidate order', () => {
    const graph = parseMermaid('flowchart LR\nA --> B\nC --> D')
    const large = routeWitness(graph, { A: [20, 100], B: [260, 100], C: [140, 20], D: [140, 220] }, [
      [[60, 120], [260, 120]], [[160, 60], [160, 220]],
    ])
    const small = { ...structuredClone(large), width: 320 }, same = structuredClone(small)
    const selected = certifyLayoutCandidates(graph, resolveRenderStyle({}), [
      { strategy: 'large', produce: () => large }, { strategy: 'small', produce: () => small },
    ])
    expect(selected).toBe(small)
    expect(selected.certification?.preference.reason).toBe('area')
    const tied = certifyLayoutCandidates(graph, resolveRenderStyle({}), [
      { strategy: 'first', produce: () => small }, { strategy: 'same', produce: () => same },
    ])
    expect(tied).toBe(small)
    expect(tied.certification?.preference.reason).toBe('candidate-order')
  })

  test.each([['nodes', 64, 2], ['nodes', 65, 1], ['edges', 128, 2], ['edges', 129, 1]] as const)('quality production respects the deterministic %s work bound at %i', (kind, size, expectedCalls) => {
    const graph = parseMermaid('flowchart LR\nA --> B\nC --> D')
    const positions: Record<string, [number, number]> = { A: [20, 100], B: [260, 100], C: [140, 20], D: [140, 220] }
    const routes: Array<Array<[number, number]>> = [[[60, 120], [260, 120]], [[160, 60], [160, 220]]]
    if (kind === 'nodes') for (let i = 4; i < size; i++) {
      graph.nodes.set(`N${i}`, { id: `N${i}`, label: `N${i}`, shape: 'rectangle' })
      positions[`N${i}`] = [500 + i % 8 * 60, Math.floor(i / 8) * 60]
    }
    if (kind === 'edges') while (graph.edges.length < size) {
      graph.edges.push({ ...graph.edges[0]! })
      routes.push([[60, 120], [260, 120]])
    }
    const first = routeWitness(graph, positions, routes, 1100, 1000), next = structuredClone(first)
    let calls = 0
    const selected = certifyLayoutCandidates(graph, resolveRenderStyle({}), [
      { strategy: 'first', produce: () => { calls++; return first } },
      { strategy: 'next', produce: () => { calls++; return next } },
    ])
    expect(calls).toBe(expectedCalls)
    expect(selected.certification?.preference.reason).toBe(expectedCalls === 1 ? 'work-budget' : 'candidate-order')
  })

  test('ordinary zero-crossing graphs and no-op strategies do not produce a cosmetic alternative', () => {
    const firstPass = LAYOUT_PIPELINE[0]!, run = firstPass.run
    let calls = 0
    firstPass.run = context => { calls++; run(context) }
    try {
      const ordinary = layoutGraphSync(parseMermaid('flowchart LR\nA --> B --> C'))
      expect(calls).toBe(1)
      expect(ordinary.certification?.preference.reason).toBe('first-certified')
      calls = 0
      const crossing = layoutGraphSync(parseMermaid('flowchart TD\nA[Start] --> B{Is it?}\nB -->|Yes| C[OK]\nC --> D[Rethink]\nD --> B\nB ---->|No| E[End]'))
      expect(calls).toBe(1)
      expect(crossing.certification?.preference).toMatchObject({ reason: 'no-alternative', selectedScore: { edgeCrossings: 1 } })
      calls = 0
      const alreadySeparate = layoutGraphSync(parseMermaid('flowchart TB\nc1-->a2\nsubgraph one\ndirection TB\na1-->a2\nend\nsubgraph two\nb1-->b2\nend\nsubgraph three\nc1-->c2\nend\none --> two\nthree --> two\ntwo --> c2'))
      // A distinct route proposal may reuse the same placement even when no
      // distinct hierarchy strategy is eligible.
      expect(calls).toBe(2)
      expect(alreadySeparate.certification?.preference.routing?.preference.compared).toHaveLength(2)
    } finally { firstPass.run = run }
  })

  test('a real small crossing graph compares one alternate hierarchy and records its routing trade-off', () => {
    const graph = parseMermaid('flowchart TB\nc1-->a2\nsubgraph one\na1-->a2\nend\nsubgraph two\nb1-->b2\nend\nsubgraph three\nc1-->c2\nend\none --> two\nthree --> two\ntwo --> c2')
    const positioned = layoutGraphSync(graph), preference = positioned.certification!.preference
    expect(positioned.certification).toMatchObject({ strategy: 'separate-hierarchy', attempts: 2 })
    expect(preference).toMatchObject({
      reason: 'totalBends', selectedScore: { edgeCrossings: 0, totalBends: 4 },
      routing: { strategy: 'without-generic-bundling', preference: { reason: 'edgeCrossings' } },
    })
    expect(preference.compared[0]?.score).toMatchObject({ edgeCrossings: 1, totalBends: 4 })
    expect(preference.compared[1]?.score).toMatchObject({ edgeCrossings: 1, totalBends: 3 })
    expect(preference.selectedScore).toEqual(preference.routing!.preference.selectedScore)
    expect(preference.selectedScore.area).toBeGreaterThan(preference.compared[0]!.score.area)
  })

  test('no candidate succeeds on non-finite geometry, even when an outline checker could miss it', () => {
    const graph = parseMermaid('flowchart LR\nA --> B')
    const invalid = layoutGraphSync(graph)
    invalid.nodes[0]!.x = Number.NaN
    expect(() => certifyLayoutCandidates(graph, resolveRenderStyle({}), [{ strategy: 'invalid', produce: () => invalid }])).toThrow(LayoutCertificationError)
  })

  test.each(['labelBlock', 'labelPosition'] as const)('a visible edge label requires retained %s before certification', field => {
    const graph = parseMermaid(source)
    const invalid = layoutGraphSync(graph)
    delete invalid.edges[0]![field]
    expect(() => certifyLayoutCandidates(graph, resolveRenderStyle({}), [{ strategy: 'missing-label-geometry', produce: () => invalid }])).toThrow(/missing retained geometry/)
  })

  test.each(['node', 'edge', 'marker', 'label', 'node-label', 'group-label', 'parent'] as const)('a candidate cannot pass by losing or changing an authored %s', field => {
    const graph = parseMermaid('flowchart LR\nsubgraph S\nA -- meaningful --> B\nend')
    const invalid = layoutGraphSync(graph)
    if (field === 'node') invalid.nodes.pop()
    if (field === 'edge') invalid.edges.pop()
    if (field === 'marker') invalid.edges[0]!.hasArrowEnd = false
    if (field === 'label') invalid.edges[0]!.label = 'changed'
    if (field === 'node-label') invalid.nodes[0]!.label = 'changed'
    if (field === 'group-label') invalid.groups[0]!.label = 'changed'
    if (field === 'parent') invalid.groups = []
    expect(() => certifyLayoutCandidates(graph, resolveRenderStyle({}), [{ strategy: 'lost-content', produce: () => invalid }])).toThrow(LayoutCertificationError)
  })

  test('a candidate cannot exchange authored members between intact group frames', () => {
    const graph = parseMermaid('flowchart LR\nsubgraph S[Left]\nA[Alpha]\nend\nsubgraph T[Right]\nB[Beta]\nend')
    const invalid = layoutGraphSync(graph)
    const a = invalid.nodes.find(node => node.id === 'A')!
    const b = invalid.nodes.find(node => node.id === 'B')!
    const { x, y } = a
    a.x = b.x
    a.y = b.y
    b.x = x
    b.y = y
    expect(() => certifyLayoutCandidates(graph, resolveRenderStyle({}), [{ strategy: 'exchanged-members', produce: () => invalid }])).toThrow(/member|ownership/)
  })

  test('public group membership retains authored identities instead of inferring ownership from coordinates', () => {
    const graph = parseMermaid('flowchart LR\nsubgraph S[Left]\nA[Alpha]\nend\nsubgraph T[Right]\nB[Beta]\nend')
    const positioned = layoutGraphSync(graph)
    const a = positioned.nodes.find(node => node.id === 'A')!
    const b = positioned.nodes.find(node => node.id === 'B')!
    const { x, y } = a
    a.x = b.x
    a.y = b.y
    b.x = x
    b.y = y
    const view = positionedToRenderedLayout(positioned, 'flowchart')
    expect(view.groups.map(group => [group.id, group.members])).toEqual([['S', ['A']], ['T', ['B']]])
  })

  test.each(['node', 'group', 'edge'] as const)('a retained %s text block cannot replace the authored label', kind => {
    const graph = parseMermaid('flowchart LR\nsubgraph S[Alpha]\nA[Alpha] -- Alpha --> B[Beta]\nend')
    const invalid = layoutGraphSync(graph)
    const style = resolveRenderStyle({})
    const owner = kind === 'node' ? invalid.nodes[0]! : kind === 'group' ? invalid.groups[0]! : invalid.edges[0]!
    owner.labelBlock = graphTextBlock('Zebra', style, kind)
    expect(() => certifyLayoutCandidates(graph, style, [{ strategy: 'changed-painted-text', produce: () => invalid }])).toThrow(/retained.*text|prepared.*text/)
  })

  test('retained formatted and transformed labels preserve their authored source', () => {
    const graph = parseMermaid('flowchart LR\nsubgraph S[<b>Outer</b>]\nA[<i>Alpha</i>] -- mixed case --> B[Beta]\nend')
    const request = resolveRenderRequestForExecution('flowchart LR\nA --> B', { style: { roles: { node: { textTransform: 'uppercase' }, group: { textTransform: 'lowercase' }, edge: { textTransform: 'capitalize' } } } }, 'svg')
    const options = { styleFace: request.appearance.face }
    const style = resolveRenderStyle(options)
    const clean = layoutGraphSync(graph, options)
    expect(clean.nodes[0]!.labelBlock!.prepared.source).toBe('<i>Alpha</i>')
    expect(clean.nodes[0]!.labelBlock!.text).not.toBe(clean.nodes[0]!.label)
    expect(certifyLayoutCandidates(graph, style, [{ strategy: 'styled', produce: () => clean }]).certification?.status).toBe('passed')
  })

  test.each(['node', 'group', 'edge'] as const)('retained %s text preserves decoded literal meaning through certification', kind => {
    const graph = parseMermaid('flowchart LR\nsubgraph S["#lt;b#gt;Outer#lt;/b#gt;"]\nA["#lt;i#gt;Alpha#lt;/i#gt;"] -- "#lt;b#gt;mixed case#lt;/b#gt;" --> B[Beta]\nend')
    const request = resolveRenderRequestForExecution('flowchart LR\nA --> B', { style: { roles: { node: { textTransform: 'uppercase' }, group: { textTransform: 'lowercase' }, edge: { textTransform: 'capitalize' } } } }, 'svg')
    const options = { styleFace: request.appearance.face }
    const style = resolveRenderStyle(options)
    const clean = layoutGraphSync(graph, options)
    const owner = kind === 'node' ? clean.nodes[0]! : kind === 'group' ? clean.groups[0]! : clean.edges[0]!
    const expected = kind === 'node' ? '<I>ALPHA</I>' : kind === 'group' ? '<b>outer</b>' : '<B>Mixed Case</B>'
    expect(owner.labelBlock!.text).toBe(expected)
    expect(owner.labelBlock!.prepared.source).not.toBe(owner.label)
    expect(certifyLayoutCandidates(graph, style, [{ strategy: 'literal', produce: () => clean }]).certification?.status).toBe('passed')

    // Re-reading the authored entity source keeps source/display/transform but
    // loses the family's token decoding. Certification must catch that loss.
    owner.labelBlock = graphTextBlock(owner.labelBlock!.prepared.source, style, kind)
    expect(() => certifyLayoutCandidates(graph, style, [{ strategy: 'reinterpreted', produce: () => clean }])).toThrow(/prepared.*text/)
  })

  test.each(['display', 'transform'] as const)('retained text cannot change its prepared %s interpretation', field => {
    const graph = parseMermaid('flowchart LR\nA[<b>Alpha</b>] --> B')
    const invalid = layoutGraphSync(graph)
    const block = invalid.nodes[0]!.labelBlock!
    invalid.nodes[0]!.labelBlock = { ...block, prepared: { ...block.prepared, [field]: field === 'display' ? 'literal' : 'uppercase' } }
    expect(() => certifyLayoutCandidates(graph, resolveRenderStyle({}), [{ strategy: 'changed-interpretation', produce: () => invalid }])).toThrow(/prepared.*text/)
  })

  test('an authored child frame cannot escape its parent with its members', () => {
    const graph = parseMermaid('flowchart LR\nsubgraph S[Outer]\nsubgraph T[Inner]\nA[Alpha]\nend\nend')
    const invalid = layoutGraphSync(graph)
    const outer = invalid.groups[0]!, inner = outer.children[0]!
    const dx = outer.x + outer.width + 30 - inner.x
    inner.x += dx
    invalid.nodes[0]!.x += dx
    invalid.width = inner.x + inner.width + 30
    expect(() => certifyLayoutCandidates(graph, resolveRenderStyle({}), [{ strategy: 'escaped-child', produce: () => invalid }])).toThrow(/parent|contain/)
  })

  test('exhaustion stops after four attempts and never returns the least-bad candidate', () => {
    const graph = parseMermaid('flowchart LR\nA --> B')
    const invalid = layoutGraphSync(graph)
    invalid.edges[0]!.points = []
    let calls = 0
    const candidates = Array.from({ length: MAX_LAYOUT_CANDIDATES + 3 }, (_, index) => ({
      strategy: `attempt-${index}`,
      produce: () => {
        calls++
        return invalid
      },
    }))
    let failure: LayoutCertificationError | undefined
    try {
      certifyLayoutCandidates(graph, resolveRenderStyle({}), candidates)
    } catch (error) {
      if (error instanceof LayoutCertificationError) failure = error
      else throw error
    }
    expect(calls).toBe(4)
    expect(failure?.attempts).toHaveLength(4)
    expect(failure?.attempts.every(attempt => attempt.violations.some(violation => violation.includes('missing route')))).toBe(true)
  })

  test('a title preference preflight exception stays inside its candidate attempt', () => {
    const graph = parseMermaid(source)
    const clean = layoutGraphSync(graph)
    let calls = 0
    const positioned = certifyLayoutCandidates(graph, resolveRenderStyle({}), [
      {
        strategy: 'preflight-fails',
        produce: () => {
          calls++
          return clean
        },
        preferNext: () => {
          throw new Error('title fit failed')
        },
      },
      {
        strategy: 'alternative',
        produce: () => {
          calls++
          return clean
        },
      },
    ])
    expect(calls).toBe(2)
    expect(positioned.certification?.strategy).toBe('alternative')
    expect(positioned.certification?.attempts).toBe(2)
  })

  test.each(['title', 'quality'] as const)('a certified fallback survives an invalid %s alternative without an extra production', preference => {
    const graph = parseMermaid('flowchart LR\nA --> B\nC --> D')
    const clean = routeWitness(graph, { A: [20, 100], B: [260, 100], C: [140, 20], D: [140, 220] }, [[[60, 120], [260, 120]], [[160, 60], [160, 220]]])
    const invalid = structuredClone(clean)
    invalid.edges[0]!.points = []
    let calls = 0
    const positioned = certifyLayoutCandidates(graph, resolveRenderStyle({}), [
      {
        strategy: 'default',
        produce: () => {
          calls++
          return clean
        },
        preferNext: () => preference === 'title',
      },
      {
        strategy: 'preferred',
        produce: () => {
          calls++
          return invalid
        },
      },
      {
        strategy: 'unused',
        produce: () => {
          calls++
          return clean
        },
      },
    ])
    expect(calls).toBe(2)
    expect(positioned.certification).toMatchObject({ status: 'passed', strategy: 'default', attempts: 2, hardViolations: 0 })
  })

  test.each([
    new LayoutMetricBudgetError('straighten', 'bends', 0, 4, 2),
    new DiagramWorkLimitError('nodes', 5_001),
    new DeferredDependencyError('ELK', async () => {}),
  ])('a non-recoverable %s cannot be hidden by an otherwise clean fallback', error => {
    const graph = parseMermaid(source)
    const clean = layoutGraphSync(graph)
    let alternateCalls = 0
    expect(() =>
      certifyLayoutCandidates(graph, resolveRenderStyle({}), [
        {
          strategy: 'budget-fails',
          produce: () => {
            throw error
          },
        },
        {
          strategy: 'clean',
          produce: () => {
            alternateCalls++
            return clean
          },
        },
      ]),
    ).toThrow(error)
    expect(alternateCalls).toBe(0)
  })
})
