import { measureLabelConflicts } from '../layout/label-conflicts.ts'
import { countEdgeCrossings, countOpposingRouteOverlaps, countParallelRouteOverlaps } from '../layout-rubric.ts'
import { refineOwnedLayoutCandidate as refineNative, certifyOwnedLayoutCandidate as certifyNative } from '../layout/agentic-producer-core.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { describe, expect, test } from 'bun:test'
import { certifyCandidate, positionedGeometryViolations, positionedHeaderRouteViolations, retainSelection, certifyLayoutCandidates, certifyLayoutWithRouteAlternative, LayoutCertificationError, MAX_LAYOUT_CANDIDATES } from '../layout/certification.ts'
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
import { assessLayout, hardViolations } from '../layout-rubric.ts'
import { invalidEndpointApproaches, laneContextFor, directLaneBlockers } from '../route-contracts.ts'
import type { MermaidGraph, PositionedGraph, PositionedGroup } from '../types.ts'

const source = 'flowchart LR\nA -- first --> B\nB -- second --> A'

// These two literal fixtures contain only rectangular nodes and external frame
// contacts. Verify their actual complete routes independently of certification.
function expectClearZeroFixture(positioned: PositionedGraph): void {
  expect(positioned.nodes.map(node => node.id).sort()).toEqual(['a1', 'a2', 'b1', 'b2', 'c1', 'c2'])
  expect(positioned.edges.map(edge => [edge.source, edge.target]).sort()).toEqual([
    ['a1', 'a2'], ['b1', 'b2'], ['c1', 'a2'], ['c1', 'c2'], ['one', 'two'], ['three', 'two'], ['two', 'c2'],
  ])
  const groups = [...positioned.groups]
  for (let cursor = 0; cursor < groups.length; cursor++) groups.push(...groups[cursor]!.children)
  const owners = new Map([...positioned.nodes, ...groups].map(owner => [owner.id, owner]))
  const crosses = (a: { x: number; y: number }, b: { x: number; y: number }, box: { x: number; y: number; width: number; height: number }): boolean =>
    box.width > 0 && box.height > 0 && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width
      && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
  for (const edge of positioned.edges) {
    expect([edge.hasArrowStart, edge.hasArrowEnd, edge.label ?? null]).toEqual([false, true, null])
    for (let cursor = 1; cursor < edge.points.length; cursor++) {
      const a = edge.points[cursor - 1]!, b = edge.points[cursor]!
      expect(a.x === b.x || a.y === b.y).toBe(true)
      for (const node of positioned.nodes) { expect(node.shape).toBe('rectangle'); expect(crosses(a, b, node)).toBe(false) }
      for (const group of groups) {
        expect(Number.isFinite(group.headerHeight) && group.headerHeight! >= 0).toBe(true)
        if (!group.concurrencyRegion) expect(crosses(a, b, { ...group, height: group.headerHeight! })).toBe(false)
      }
    }
    for (const [id, start] of [[edge.source, true], [edge.target, false]] as const) {
      const owner = owners.get(id)!, point = start ? edge.points[0]! : edge.points.at(-1)!
      const next = (start ? edge.points : edge.points.toReversed()).find(next => next.x !== point.x || next.y !== point.y)!
      expect(point.x === owner.x && next.x < point.x && next.y === point.y
        || point.x === owner.x + owner.width && next.x > point.x && next.y === point.y
        || point.y === owner.y && next.y < point.y && next.x === point.x
        || point.y === owner.y + owner.height && next.y > point.y && next.x === point.x).toBe(true)
    }
  }
}

function routeWitness(graph: MermaidGraph, positions: Record<string, [number, number]>, routes: Array<Array<[number, number]>>, width = 360, height = 280): PositionedGraph {
  return {
    width, height, groups: [],
    nodes: [...graph.nodes.values()].map(node => ({ ...node, x: positions[node.id]![0], y: positions[node.id]![1], width: 40, height: 40 })),
    edges: graph.edges.map((edge, index) => ({ ...edge, edgeIndex: index, points: routes[index]!.map(([x, y]) => ({ x, y })) })),
  }
}

const certifyOwnedLayoutCandidate = (...args: [Parameters<typeof certifyNative>[0], Parameters<typeof certifyNative>[1], Parameters<typeof certifyNative>[2]]) =>
  certifyNative(...args, { certifyCandidate, retainSelection })

const refineOwnedLayoutCandidate = (...args: [Parameters<typeof refineNative>[0], Parameters<typeof refineNative>[1], Parameters<typeof refineNative>[2], Parameters<typeof refineNative>[3]]) =>
  refineNative(...args, { certifyCandidate, retainSelection, countEdgeCrossings, countOpposingRouteOverlaps, countParallelRouteOverlaps, measureLabelConflicts })

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

  test('certifies a compact candidate after an orientation decline', () => {
    const { graph, first, other, style } = crossingWitness()
    expect(refineOwnedLayoutCandidate(graph, style, first, [
      { strategy: 'orientation', produce: () => { throw new GraphLayoutUnsupportedError('optional orientation limit') } },
      { strategy: 'compact-ranks', produce: () => other },
    ])).toBe(other)
    expect(other.certification).toMatchObject({ status: 'passed', strategy: 'compact-ranks' })
  })

  test('bounds optional owned trials while retaining the feasible primary', () => {
    const { graph, first, other, style } = crossingWitness()
    other.edges[0]!.points = []
    expect(refineOwnedLayoutCandidate(graph, style, first, [
      { strategy: 'orientation', produce: () => { throw new GraphLayoutUnsupportedError('optional orientation limit') } },
      { strategy: 'invalid-compact', produce: () => other },
      { strategy: 'outside-budget', produce: () => { throw new Error('must not execute beyond two alternatives') } },
    ])).toBe(first)
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
    expect(positioned.nodes.map(node => node.id).sort()).toEqual(['A', 'B'])
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual([
      ['A', 'B', 'first'], ['B', 'A', 'second'],
    ])
    for (const edge of positioned.edges) expect(edge.labelBlock?.fontSize).toBe(24)
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
    const narrow = routeWitness(graph, { A: [20, 140], B: [260, 140], C: [20, 20], D: [300, 220] }, [
      [[60, 160], [260, 160]], [[40, 60], [40, 80], [320, 80], [320, 220]],
    ])
    const wide = routeWitness(graph, { A: [20, 140], B: [260, 140], C: [140, 20], D: [140, 220] }, [
      [[60, 160], [260, 160]], [[180, 40], [890, 40], [890, 120], [160, 120], [160, 220]],
    ], 900)
    const title = graph.subgraphs[0]!.label, style = resolveRenderStyle({})
    narrow.groups = [{ id: 'S', label: title, x: 0, y: 80, width: 320, height: 120, children: [] }]
    wide.groups = [{ id: 'S', label: title, x: 0, y: 80, width: 880, height: 120, children: [] }]
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
      expect(crossing.certification?.preference.compared).toHaveLength(1)
      calls = 0
      const alreadySeparate = layoutGraphSync(parseMermaid('flowchart TB\nc1-->a2\nsubgraph one\ndirection TB\na1\nend\na1-->a2\nsubgraph two\nb1-->b2\nend\nsubgraph three\nc2\nend\nc1-->c2\none --> two\nthree --> two\ntwo --> c2'))
      // A header-clear, zero-crossing placement has no reason to run the
      // saved unbundled proposal solely to satisfy a comparison count.
      expect(calls).toBe(1)
      expect(alreadySeparate.certification).toMatchObject({ status: 'passed', hardViolations: 0, attempts: 1,
        preference: { reason: 'first-certified', selectedScore: { edgeCrossings: 0, labelConflicts: 0 } } })
      expect(alreadySeparate.certification?.preference.compared).toHaveLength(1)
      expect(alreadySeparate.certification?.preference.routing).toBeUndefined()
      expectClearZeroFixture(alreadySeparate)
    } finally { firstPass.run = run }
  })

  test('a real crossing graph bounds comparisons while retaining authored endpoints and zero-crossing ink', () => {
    const graph = parseMermaid('flowchart TB\nc1-->a2\nsubgraph one\na1\nend\na1-->a2\nsubgraph two\nb1-->b2\nend\nsubgraph three\nc2\nend\nc1-->c2\none --> two\nthree --> two\ntwo --> c2')
    const positioned = layoutGraphSync(graph), certification = positioned.certification!, preference = certification.preference
    expect(certification).toMatchObject({ status: 'passed', hardViolations: 0 })
    // Rejected proposals consume the existing fallback budget; only certified
    // placements appear in the comparison evidence below.
    expect(certification.attempts).toBeLessThanOrEqual(MAX_LAYOUT_CANDIDATES)
    expect(certification.attempts).toBeGreaterThanOrEqual(preference.compared.length)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual(['a1', 'a2', 'b1', 'b2', 'c1', 'c2'])
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label ?? null]).sort()).toEqual([
      ['a1', 'a2', null], ['b1', 'b2', null], ['c1', 'a2', null], ['c1', 'c2', null],
      ['one', 'two', null], ['three', 'two', null], ['two', 'c2', null],
    ])
    expect(positioned.groups.map(group => ({ id: group.id, nodes: group.nodeIds?.toSorted() })).sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'one', nodes: ['a1'] }, { id: 'three', nodes: ['c2'] }, { id: 'two', nodes: ['b1', 'b2'] },
    ])
    // The default placement certifies only by detouring routes around title
    // bands, so it defers to the separate-hierarchy placement, which needs none.
    expect(preference.reason).toBe('unreadableTitles')
    expect(preference.compared.map(candidate => [candidate.strategy, candidate.score.unreadableTitles])).toEqual([['default', 1], ['separate-hierarchy', 0]])
    const placement = preference.compared.find(candidate => candidate.strategy === certification.strategy)
    expect(placement).toBeDefined()
    // The selected placement already has zero crossings and label conflicts;
    // the bounded selector correctly avoids a cosmetic routing production.
    expect(preference.routing).toBeUndefined()
    expect(preference.selectedScore).toEqual(placement!.score)
    expect(preference.selectedScore.labelConflicts).toBe(0)
    expectClearZeroFixture(positioned)
    // This fixture has no title-band projection: its score describes this canvas.
    expect(preference.selectedScore.area).toBeCloseTo(positioned.width * positioned.height, 5)
    expect(preference.selectedScore.edgeCrossings).toBe(0)
    const assessed = assessLayout(graph, positioned, resolveRenderStyle({}))
    expect(hardViolations(assessed)).toEqual([])
    expect(assessed.metrics).toMatchObject({ edgeCrossings: preference.selectedScore.edgeCrossings, totalBends: preference.selectedScore.totalBends })
    expect(positioned.edges.toSorted((a, b) => a.edgeIndex! - b.edgeIndex!).map(edge => [edge.edgeIndex, edge.source, edge.target])).toEqual(graph.edges.map((edge, index) => [index, edge.source, edge.target]))
    const nodes = new Map(positioned.nodes.map(node => [node.id, node]))
    expect(positioned.edges.map(edge => invalidEndpointApproaches(edge, nodes.get(edge.source), nodes.get(edge.target)))).toEqual(graph.edges.map(() => 0))
    const a1 = nodes.get('a1')!
    const repaired = positioned.edges.find(edge => edge.source === 'a1' && edge.target === 'a2')!
    const contact = repaired.points[0]!
    const side = contact.x === a1.x ? 'W' : contact.x === a1.x + a1.width ? 'E' : contact.y === a1.y ? 'N' : 'S'
    expect(contact).toEqual(side === 'W' ? { x: a1.x, y: a1.y + a1.height / 2 }
      : side === 'E' ? { x: a1.x + a1.width, y: a1.y + a1.height / 2 }
        : { x: a1.x + a1.width / 2, y: side === 'N' ? a1.y : a1.y + a1.height })
    expect(repaired.routeCertificate).toMatchObject({ sourcePort: side, sourcePortAssignment: { side, port: side, slotIndex: 0, slotCount: 1 } })
    const endpoints = new Map([...positioned.nodes, ...positioned.groups].map(endpoint => [endpoint.id, endpoint]))
    const noise = 1e-6
    for (const edge of positioned.edges) {
      for (const [id, contact] of [[edge.source, edge.points[0]!], [edge.target, edge.points.at(-1)!]] as const) {
        const endpoint = endpoints.get(id)!
        const verticalFace = (Math.abs(contact.x - endpoint.x) < noise || Math.abs(contact.x - endpoint.x - endpoint.width) < noise) && contact.y >= endpoint.y - noise && contact.y <= endpoint.y + endpoint.height + noise
        const horizontalFace = (Math.abs(contact.y - endpoint.y) < noise || Math.abs(contact.y - endpoint.y - endpoint.height) < noise) && contact.x >= endpoint.x - noise && contact.x <= endpoint.x + endpoint.width + noise
        expect(verticalFace || horizontalFace).toBe(true)
        for (let i = 1; i < edge.points.length; i++) {
          const a = edge.points[i - 1]!, b = edge.points[i]!
          const crosses = a.y === b.y
            ? a.y > endpoint.y + noise && a.y < endpoint.y + endpoint.height - noise && Math.max(a.x, b.x) > endpoint.x + noise && Math.min(a.x, b.x) < endpoint.x + endpoint.width - noise
            : a.x === b.x && a.x > endpoint.x + noise && a.x < endpoint.x + endpoint.width - noise && Math.max(a.y, b.y) > endpoint.y + noise && Math.min(a.y, b.y) < endpoint.y + endpoint.height - noise
          expect(crosses).toBe(false)
        }
      }
    }
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

  // Issue A7: report layout safety draws a graph no candidate certifies from its
  // best drawable candidate instead of refusing it. The rule is deterministic:
  // fewest misleading violations, then fewest violations, then candidate order;
  // a candidate that changed authored meaning is never drawn.
  test('report safety draws the best drawable candidate when none certifies', () => {
    const graph = parseMermaid('flowchart LR\n  A --> B\n  C')
    const base = layoutGraphSync(graph)
    const detour = (positioned: PositionedGraph): void => {
      const [a, b] = positioned.edges[0]!.points
      const mid = (a!.x + b!.x) / 2
      positioned.edges[0]!.points = [a!, { x: mid, y: a!.y }, { x: mid + 4, y: a!.y + 4 }, { x: mid + 4, y: b!.y }, b!]
    }
    const variants: Record<string, (positioned: PositionedGraph) => void> = {
      // Only a changed label: no geometry failure, but it misstates the source.
      'changed-label': positioned => { positioned.nodes[0]!.label = 'changed' },
      // C drawn over B: one misleading violation.
      overlap: positioned => {
        const b = positioned.nodes.find(node => node.id === 'B')!, c = positioned.nodes.find(node => node.id === 'C')!
        c.x = b.x + 4; c.y = b.y + 4
      },
      // A diagonal detour on a route certified straight: two cosmetic violations.
      'straight-detour': detour,
      // The same detour without the straight certificate: one cosmetic violation.
      detour: positioned => { delete positioned.edges[0]!.routeCertificate; detour(positioned) },
      'later-detour': positioned => { delete positioned.edges[0]!.routeCertificate; detour(positioned) },
    }
    const candidates = (names: string[]) => names.map(strategy => {
      const positioned = structuredClone(base)
      variants[strategy]!(positioned)
      return { strategy, produce: () => positioned }
    })
    const all = ['changed-label', 'overlap', 'straight-detour', 'detour']
    const drawn = certifyLayoutCandidates(graph, resolveRenderStyle({}), candidates(all), undefined, true)
    expect(drawn.certification).toBeUndefined()
    expect(drawn.uncertifiedLayout).toEqual({
      status: 'uncertified', strategy: 'detour', attempts: 4,
      violations: [{ kind: 'diagonalSegments', targets: ['A->B#0'], detail: 'A->B segment 2' }],
    })
    expect(drawn.nodes.find(node => node.id === 'A')!.label).toBe('A')
    // A misleading violation outranks any number of cosmetic ones.
    expect(certifyLayoutCandidates(graph, resolveRenderStyle({}), candidates(['overlap', 'straight-detour']), undefined, true).uncertifiedLayout!.strategy).toBe('straight-detour')
    // Equal counts keep the established candidate order.
    expect(certifyLayoutCandidates(graph, resolveRenderStyle({}), candidates(['later-detour', 'detour']), undefined, true).uncertifiedLayout!.strategy).toBe('later-detour')
    // Identical input selects identical geometry.
    expect(certifyLayoutCandidates(graph, resolveRenderStyle({}), candidates(all), undefined, true)).toEqual(drawn)
    // Strict safety, and a graph whose only candidates change meaning, still refuse.
    expect(() => certifyLayoutCandidates(graph, resolveRenderStyle({}), candidates(all))).toThrow(LayoutCertificationError)
    expect(() => certifyLayoutCandidates(graph, resolveRenderStyle({}), candidates(['changed-label']), undefined, true)).toThrow(LayoutCertificationError)
  })

  // The State hook reaches the same candidate loop through its own options.
  // Reduced counterexample: a self-loop crossing a directed composite's title
  // band, which no candidate avoided when this was written.
  test('State drawings share the report-safety fallback', () => {
    const source = 'stateDiagram-v2\n  state G0 {\n    direction LR\n    a\n    b\n  }\n  b --> b\n  b --> c\n  c --> G0'
    const { svg, receipt } = renderMermaidSVGWithReceipt(source)
    expect(svg.startsWith('<svg')).toBe(true)
    const geometry = (receipt.layoutCertification as { geometry?: { violations: Array<{ kind: string }> } } | undefined)?.geometry
    if (!geometry) return
    const verdict = verifyMermaid(source)
    expect(verdict.ok).toBe(false)
    const named = verdict.warnings.flatMap(warning => warning.code === 'LAYOUT_UNCERTIFIED' ? [warning.violation] : warning.code === 'GROUP_BREACH' ? ['groupBreaches'] : [])
    expect(geometry.violations.map(violation => violation.kind).filter(kind => !named.includes(kind))).toEqual([])
    expect(() => renderMermaidSVGWithReceipt(source, { layoutSafety: 'strict' })).toThrow(LayoutCertificationError)
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


describe('final full group-header route geometry', () => {
  test.each([
    { name: 'unrelated root header', target: 'dst', points: [[80, 20], [80, 80]], hit: 'root' },
    { name: 'nested header below the parent band', target: 'dst', points: [[70, 70], [70, 110]], hit: 'nested' },
    { name: 'authored north exterior contact', target: 'root', points: [[80, 20], [80, 40]], hit: undefined },
    { name: 'own endpoint approached through its header interior', target: 'root', points: [[80, 80], [80, 40]], hit: 'root' },
    { name: 'border-only north contact', target: 'dst', points: [[30, 40], [130, 40]], hit: undefined },
    { name: 'invisible route', target: 'dst', points: [[80, 20], [80, 80]], invisible: true, hit: undefined },
    { name: 'concurrency region has no own header', target: 'dst', points: [[80, 20], [80, 80]], concurrency: true, hit: undefined },
    { name: 'explicit zero header', target: 'dst', points: [[80, 20], [80, 80]], height: 0, hit: undefined },
    { name: 'missing height retains measured band', target: 'dst', points: [[80, 20], [80, 75]], height: undefined, measured: true, hit: 'root' },
    { name: 'missing height does not reserve the whole group', target: 'dst', points: [[80, 69], [80, 75]], height: undefined, measured: true, hit: undefined },
  ])('$name', row => {
    const nested: PositionedGroup = { id: 'nested', label: 'Nested', x: 50, y: 80, width: 60, height: 80, headerHeight: 10, nodeIds: [], children: [] }
    const root: PositionedGroup = { id: 'root', label: 'Root', x: 30, y: 40, width: 100, height: 160, headerHeight: 'height' in row ? row.height : 20, nodeIds: [], children: [nested], ...('measured' in row ? { labelBlock: graphTextBlock('Root', resolveRenderStyle(), 'group') } : {}), ...('concurrency' in row ? { concurrencyRegion: true as const } : {}) }
    const positioned: PositionedGraph = { width: 200, height: 240, nodes: [], groups: [root], edges: [{ source: 'src', target: row.target, style: 'invisible' in row ? 'invisible' : 'solid', hasArrowStart: false, hasArrowEnd: true, points: row.points.map(([x, y]) => ({ x: x!, y: y! })) }] }
    const findings = positionedGeometryViolations(positioned, resolveRenderStyle()).filter(value => value.startsWith('group-header '))
    expect(findings).toEqual(row.hit ? [`group-header ${row.hit}: edge src->${row.target} segment 1 enters reserved band`] : [])
  })
})


describe('group headers gate completed candidate consumers', () => {
  const witness = () => {
    const graph = parseMermaid('flowchart TB\nsubgraph G[Group]\nX\nend\nA --> B')
    const positioned = routeWitness(graph, { X: [130, 120], A: [0, 10], B: [80, 180] }, [[[40, 30], [220, 30], [220, 200], [120, 200]]], 260, 230)
    positioned.groups = [{ id: 'G', label: 'Group', x: 60, y: 60, width: 120, height: 110, headerHeight: 28, nodeIds: ['X'], children: [] }]
    const crossesHeader = structuredClone(positioned)
    crossesHeader.edges[0]!.points = [{ x: 40, y: 30 }, { x: 100, y: 30 }, { x: 100, y: 180 }]
    return { graph, positioned, crossesHeader, style: resolveRenderStyle() }
  }

  test('a clear shorter shaft cannot make a reserved-header candidate feasible', () => {
    const { graph, positioned, crossesHeader, style } = witness()
    expect(hardViolations(assessLayout(graph, crossesHeader, style))).toEqual([])
    const rejected = certifyCandidate(graph, style, { strategy: 'crosses-header', produce: () => crossesHeader })
    expect(rejected.certified).toBeUndefined()
    expect(rejected.attempt.violations).toContain('group-header G: edge A->B segment 2 enters reserved band')
    expect(certifyLayoutCandidates(graph, style, [
      { strategy: 'crosses-header', produce: () => crossesHeader },
      { strategy: 'clear-detour', produce: () => positioned },
    ])).toBe(positioned)
  })

  test('a route alternative with fewer bends cannot overwrite a header-clear baseline', () => {
    const { graph, positioned, crossesHeader, style } = witness()
    const chosen = certifyLayoutWithRouteAlternative(graph, style,
      [{ strategy: 'clear-detour', produce: () => positioned }],
      () => ({ strategy: 'without-generic-bundling', produce: () => crossesHeader }))
    expect(chosen).toBe(positioned)
    expect(chosen.certification?.preference?.routing?.preference.reason).toBe('alternative-invalid')
  })
})

describe('retained header bands are independent of frame height', () => {
  const style = resolveRenderStyle()
  const rows = [
    {
      name: 'zero-width band above zero frame',
      width: 0,
      frame: 0,
      height: 28,
      points: [
        [80, 20],
        [80, 90],
      ],
      expected: 'clear',
    },
    {
      name: 'positive-width full band beyond frame',
      width: 100,
      frame: 0,
      height: 28,
      points: [
        [80, 50],
        [80, 60],
      ],
      expected: 'cross',
    },
    {
      name: 'below full retained band',
      width: 100,
      frame: 1,
      height: 28,
      points: [
        [80, 69],
        [80, 90],
      ],
      expected: 'clear',
    },
    {
      name: 'exact lower boundary',
      width: 100,
      frame: 1,
      height: 28,
      points: [
        [30, 68],
        [130, 68],
      ],
      expected: 'clear',
    },
    {
      name: 'missing height uses actual text fallback',
      width: 100,
      frame: 0,
      height: undefined,
      points: [
        [80, 50],
        [80, 60],
      ],
      expected: 'cross',
    },
    {
      name: 'negative retained height',
      width: 100,
      frame: 0,
      height: -1,
      points: [
        [80, 69],
        [80, 90],
      ],
      expected: 'invalid',
    },
    {
      name: 'nonfinite retained height',
      width: 100,
      frame: 0,
      height: NaN,
      points: [
        [80, 69],
        [80, 90],
      ],
      expected: 'invalid',
    },
    {
      name: 'infinite retained height',
      width: 100,
      frame: 0,
      height: Infinity,
      points: [
        [80, 69],
        [80, 90],
      ],
      expected: 'invalid',
    },
  ]
  for (const row of rows)
    test('final band: ' + row.name, () => {
      const group = { id: 'g', label: 'Group', x: 30, y: 40, width: row.width, height: row.frame, headerHeight: row.height, children: [] },
        edge = { source: 'src', target: 'dst', style: 'solid' as const, hasArrowStart: false, hasArrowEnd: true, points: row.points.map(([x, y]) => ({ x: x!, y: y! })) }
      const findings = positionedHeaderRouteViolations({ width: 200, height: 240, nodes: [], groups: [group], edges: [edge] }, style)
      expect(findings).toEqual(row.expected === 'clear' ? [] : row.expected === 'invalid' ? ['group-header g: invalid retained height'] : ['group-header g: edge src->dst segment 1 enters reserved band'])
    })
  for (const row of [
    { name: 'inside measured band beyond frame', height: 28, frame: 0, lo: 50, hi: 60, block: true },
    { name: 'below measured band beyond frame', height: 28, frame: 1, lo: 69, hi: 90, block: false },
    { name: 'missing height conservatively reserves whole frame', height: undefined, frame: 160, lo: 100, hi: 120, block: true },
    { name: 'negative height conservative', height: -1, frame: 0, lo: 100, hi: 120, block: true },
    { name: 'nonfinite height conservative', height: NaN, frame: 0, lo: 100, hi: 120, block: true },
    { name: 'infinite height conservative', height: Infinity, frame: 0, lo: 100, hi: 120, block: true },
  ])
    test('lane band: ' + row.name, () => {
      const edge = {
          source: 'src',
          target: 'dst',
          style: 'solid' as const,
          hasArrowStart: false,
          hasArrowEnd: true,
          points: [
            { x: 80, y: row.lo },
            { x: 80, y: row.hi },
          ],
        },
        group = { id: 'g', label: 'Group', x: 30, y: 40, width: 100, height: row.frame, headerHeight: row.height, children: [] }
      const { ctx } = laneContextFor([], [edge], 'TB', style, [group])
      expect(directLaneBlockers(edge, 80, row.lo, row.hi, ctx)).toEqual(row.block ? [{ kind: 'group-header', id: 'g' }] : [])
    })
  test('public empty golden group retains authored identity and its zero-area band', () => {
    const source = 'graph LR\nsubgraph one\nend\nA --> B\n'
    const rendered = renderMermaidSVGWithReceipt(source, { embedFontImport: false })
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    expect(rendered.svg).toContain('data-id="one"')
    expect(rendered.svg).toContain('data-id="A"')
    expect(rendered.svg).toContain('data-id="B"')
    expect(rendered.svg).toContain('data-from="A" data-to="B"')
    expect(rendered.svg).toContain('marker-end=')
    const group = /<g\b[^>]*data-id="one"[^>]*>([\s\S]*?)<\/g>/.exec(rendered.svg)![1]!
    const rect = /<rect\b[^>]*>/.exec(group)![0]
    expect(rect).toContain('width="0"')
    expect(rect).toContain('height="0"')
    const path = /<path\b[^>]*d="([^"]+)"/.exec(group)![1]!,
      n = path.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)!.map(Number)
    expect(n).toHaveLength(5)
    expect(n[0]).toBe(n[2])
    expect(n[2]).toBe(n[4])
    expect(n[3]! - n[1]!).toBe(28)
  })
})
