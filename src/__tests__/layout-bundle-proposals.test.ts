import { renderMermaidSVGWithReceipt } from '../index.ts'
import { scanSvgStartTags } from '../svg-structure.ts'
import { describe, expect, test } from 'bun:test'
import { LAYOUT_PIPELINE, layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { withRenderStageObserver } from '../render-stages.ts'
import { assessLayout, hardViolations } from '../layout-rubric.ts'
import { bundleEdgePaths } from '../layout/passes/edge-bundling.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { PositionedEdge, PositionedNode } from '../types.ts'
import { flowchartMesh } from '../../eval/shared/graph-fixtures.ts'

// This existing dense fixture still benefits from a route comparison after
// placement selection. The former small skip-link fixture is now clean in its
// first proposal because layer alignment preserves outward terminal shafts.
const source = flowchartMesh(50, 20)

describe('bundle complete foreign ink admission', () => {
  const state = `stateDiagram-v2\n[*] --> Still\nStill --> [*]\nStill --> Moving\nMoving --> Still\nMoving --> Crash\nCrash --> [*]`
  for (const [name, source] of [['State0', `---\ntitle: Simple sample\n---\n${state}`], ['State1', state.replace('stateDiagram-v2', 'stateDiagram')], ['State16', state.replace('Still --> Moving', '%% comment\nStill --> Moving')]] as const) {
    test(`${name}: Still-to-end shaft and markers clear the whole Moving artwork`, () => {
      const result = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'elk', fallback: 'none' } })
      const tags = scanSvgStartTags(result.svg).map(tag => ({ name: tag.name, ...Object.fromEntries(tag.attributes.map(a => [a.name, a.value])) })) as Array<Record<string, string>>
      const artwork = tags.find(tag => tag['data-id'] === 'node-shape:Moving')!
      const route = tags.find(tag => tag['data-from'] === 'Still' && tag['data-to'] === '_end')!
      expect(artwork).toBeDefined()
      expect(route.name).toBe('polyline')
      const points = route.points!.split(/\s+/).map(token => { const [x, y] = token.split(',').map(Number); return { x: x!, y: y! } })
      const half = Number(route['stroke-width']) / 2, border = Number(artwork['stroke-width']) / 2
      const x = Number(artwork.x), y = Number(artwork.y), width = Number(artwork.width), height = Number(artwork.height)
      const box = { x0: x - border, x1: x + width + border, y0: y - border, y1: y + height + border }
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!, b = points[i]!
        expect(a.x === b.x || a.y === b.y).toBe(true)
        expect(Math.max(a.x, b.x) + half > box.x0 && Math.min(a.x, b.x) - half < box.x1
          && Math.max(a.y, b.y) + half > box.y0 && Math.min(a.y, b.y) - half < box.y1).toBe(false)
      }
      // This literal emitted resource is hidden-viewport arrowhead8×5/ref8,2.5,
      // on a width1 southward terminal. Its whole painted viewport clears Moving.
      const marker = tags.find(tag => tag.name === 'marker' && tag.id === 'arrowhead')!
      expect([marker.markerWidth, marker.markerHeight, marker.refX, marker.refY]).toEqual(['8', '5', '8', '2.5'])
      expect(route['stroke-width']).toBe('1')
      const tip = points.at(-1)!, previous = points.at(-2)!
      expect(tip.x).toBe(previous.x)
      expect(tip.y).toBeGreaterThan(previous.y)
      expect(tip.x + 2.5 > box.x0 && tip.x - 2.5 < box.x1 && tip.y > box.y0 && tip.y - 8 < box.y1).toBe(false)
      const authored = parseMermaid(state).edges.map(e => [e.source, e.target, String(e.hasArrowStart), String(e.hasArrowEnd)])
      expect(tags.filter(tag => tag['data-role'] === 'edge').map(tag => [tag['data-from'], tag['data-to'], tag['data-arrow-start'], tag['data-arrow-end']])).toEqual(authored)
      if (name === 'State0') expect(result.svg).toContain('Simple sample')

    })
  }

  test.each([true, false])('a bundle marker cannot paint a foreign tiny card (marked=%s)', marked => {
    const nodes: PositionedNode[] = [
      { id: 'A', label: 'A', shape: 'rectangle', x: 40, y: 0, width: 40, height: 40 },
      { id: 'B', label: 'B', shape: 'rectangle', x: 40, y: 100, width: 40, height: 40 },
      { id: 'C', label: 'C', shape: 'rectangle', x: 140, y: 100, width: 40, height: 40 },
      { id: 'P', label: '', shape: 'rectangle', x: 57.51, y: 92.01, width: 0.05, height: 0.02 },
    ]
    const edges: PositionedEdge[] = ['B', 'C'].map(target => ({ source: 'A', target, points: [{ x: 80, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 120 }, { x: target === 'B' ? 80 : 140, y: 120 }], style: 'solid', hasArrowStart: false, hasArrowEnd: marked }))
    const before = edges.map(edge => edge.points)
    const bundled = bundleEdgePaths(edges, nodes, [], 'TB', resolveRenderStyle())
    expect(bundled.size).toBe(marked ? 0 : 2)
    if (marked) for (let i = 0; i < edges.length; i++) expect(edges[i]!.points).toBe(before[i]!)
  })
  test.each(['var(--edge-width)', '2%', '1px'])('unknown authored width cannot authorize a bundle: %s', width => {
    const nodes: PositionedNode[] = [
      { id: 'A', label: 'A', shape: 'rectangle', x: 40, y: 0, width: 40, height: 40 },
      { id: 'B', label: 'B', shape: 'rectangle', x: 40, y: 100, width: 40, height: 40 },
      { id: 'C', label: 'C', shape: 'rectangle', x: 140, y: 100, width: 40, height: 40 },
    ]
    const edges: PositionedEdge[] = ['B', 'C'].map(target => ({ source: 'A', target, points: [{ x: 80, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 120 }, { x: target === 'B' ? 80 : 140, y: 120 }], style: 'solid', hasArrowStart: false, hasArrowEnd: true, inlineStyle: { 'stroke-width': width } }))
    const before = edges.map(edge => edge.points)
    const bundled = bundleEdgePaths(edges, nodes, [], 'TB', resolveRenderStyle())
    expect(bundled.size).toBe(width === '1px' ? 2 : 0)
    if (width !== '1px') for (let i = 0; i < edges.length; i++) expect(edges[i]!.points).toBe(before[i]!)
  })

  test('a shaft touching the full header by its stroke retains its old route', () => {
    const nodes: PositionedNode[] = [
      { id: 'A', label: 'A', shape: 'rectangle', x: 40, y: 0, width: 40, height: 40 },
      { id: 'B', label: 'B', shape: 'rectangle', x: 40, y: 100, width: 40, height: 40 },
      { id: 'C', label: 'C', shape: 'rectangle', x: 140, y: 100, width: 40, height: 40 },
    ]
    const edges: PositionedEdge[] = ['B', 'C'].map(target => ({ source: 'A', target, points: [{ x: 80, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 120 }, { x: target === 'B' ? 80 : 140, y: 120 }], style: 'solid', hasArrowStart: false, hasArrowEnd: false }))
    const before = edges.map(edge => edge.points)
    const bundled = bundleEdgePaths(edges, nodes, [{ id: 'G', label: 'G', x: 60.1, y: 45, width: 6, height: 4, headerHeight: 4, children: [] }], 'TB', resolveRenderStyle())
    expect(bundled.size).toBe(0)
    for (let i = 0; i < edges.length; i++) expect(edges[i]!.points).toBe(before[i]!)
  })

})

describe('bounded generic bundle proposals', () => {
  test.each([
    { name: 'dense mesh', source: flowchartMesh(50, 20), maxCrossings: 62, maxLabelConflicts: 3 },
    {
      name: 'detached feedback',
      source: 'flowchart TD\nS0["warnings"] --> H["hub"]\nS1["ok"] --> H\nS2["same word ok"] --> H\nS3["a longer label goes here"] --> H\nH --> T["out"]\nT --> S3',
      maxCrossings: 0, maxLabelConflicts: 0,
    },
  ])('preserves the measured quality gain and authored meaning: $name', fixture => {
    const graph = parseMermaid(fixture.source)
    const first = LAYOUT_PIPELINE[0]!, run = first.run
    let routeProposals = 0
    first.run = context => { if (!context.mergeEdges) routeProposals++; run(context) }
    let selected: ReturnType<typeof layoutGraphSync>
    try { selected = layoutGraphSync(graph) } finally { first.run = run }
    const assessment = assessLayout(graph, selected)
    expect(hardViolations(assessment)).toEqual([])
    expect(assessment.metrics.edgeCrossings).toBeLessThanOrEqual(fixture.maxCrossings)
    expect(assessment.metrics.labelConflicts).toBeLessThanOrEqual(fixture.maxLabelConflicts)
    expect(routeProposals).toBeLessThanOrEqual(1)
    expect(selected.nodes.map(node => [node.id, node.label]).sort()).toEqual(
      [...graph.nodes.values()].map(node => [node.id, node.label]).sort())
    expect(selected.edges.map(edge => [edge.edgeIndex, edge.source, edge.target, edge.label, edge.style, edge.hasArrowStart, edge.hasArrowEnd])).toEqual(
      graph.edges.map((edge, index) => [index, edge.source, edge.target, edge.label, edge.style, edge.hasArrowStart, edge.hasArrowEnd]))
    expect(selected.certification?.preference.selectedScore).toMatchObject({
      edgeCrossings: assessment.metrics.edgeCrossings, labelConflicts: assessment.metrics.labelConflicts,
    })
  })

  test('only the selected placement compares an unbundled proposal and it reuses that ELK result', () => {
    const baseline = layoutGraphSync(parseMermaid(source), { compareRoutePreferences: false })
    const first = LAYOUT_PIPELINE[0]!, run = first.run
    const pipelines: Array<{ elkResult: unknown; bundled: boolean }> = []
    first.run = context => { pipelines.push({ elkResult: context.elkResult, bundled: context.mergeEdges }); run(context) }
    let elkCalls = 0
    let selected: ReturnType<typeof layoutGraphSync>
    try {
      selected = withRenderStageObserver(sample => { if (sample.stage === 'elk') elkCalls++ },
        () => layoutGraphSync(parseMermaid(source)))
    } finally {
      first.run = run
    }
    const placements = pipelines.filter(pipeline => pipeline.bundled)
    const routeProposals = pipelines.filter(pipeline => !pipeline.bundled)
    expect(placements).toHaveLength(2)
    expect(routeProposals).toHaveLength(1)
    expect(elkCalls).toBe(placements.length)
    expect(pipelines.at(-1)).toBe(routeProposals[0])
    expect(placements.some(placement => placement.elkResult === routeProposals[0]!.elkResult)).toBe(true)
    expect(selected.certification).toMatchObject({ status: 'passed', attempts: 2, hardViolations: 0 })
    expect(selected.certification!.preference.selectedScore.edgeCrossings).toBeLessThan(
      baseline.certification!.preference.selectedScore.edgeCrossings)
    expect(selected.certification?.preference.routing).toMatchObject({
      strategy: 'without-generic-bundling',
      preference: { reason: 'edgeCrossings' },
    })
    const alternatives = selected.certification!.preference.routing!.preference.compared
    expect(alternatives).toHaveLength(2)
    expect(alternatives[1]!.score.totalBends).toBeGreaterThan(alternatives[0]!.score.totalBends)
    expect(alternatives[1]!.score.nonCanonicalEndpointRate).toBeGreaterThan(alternatives[0]!.score.nonCanonicalEndpointRate)
  })

  test('an ordinary alternative failure retains the certified bundled proposal', () => {
    const first = LAYOUT_PIPELINE[0]!, run = first.run
    let rejected = 0
    first.run = context => {
      if (!context.mergeEdges) { rejected++; throw new Error('unbundled geometry producer failed') }
      run(context)
    }
    try {
      const graph = parseMermaid(source), selected = layoutGraphSync(graph)
      expect(rejected).toBe(1)
      expect(selected.certification).toMatchObject({ status: 'passed', hardViolations: 0 })
      expect(selected.certification?.preference.routing).toMatchObject({
        strategy: 'bundled',
        preference: { reason: 'alternative-invalid' },
      })
      expect(hardViolations(assessLayout(graph, selected))).toEqual([])
      expect(selected.edges.map(edge => [edge.edgeIndex, edge.source, edge.target])).toEqual(
        graph.edges.map((edge, index) => [index, edge.source, edge.target]))
      expect(selected.edges.every(edge => edge.points.length >= 2)).toBe(true)
    } finally {
      first.run = run
    }
  })

  test('parallel edges keep their specialized lanes instead of buying fewer proper crossings with ambiguous contacts', () => {
    const parallelSource = String.raw`flowchart BT
  N0[\n0\]
  N1[/n1\]
  N2([n2])
  N3[\n3/]
  N4(n4)
  N5[[n5]]
  N3 --> N1
  N4 --> N0
  N1 --> N2
  N4 --> N0
  N4 --> N0
  N5 --> N0`
    const baseline = layoutGraphSync(parseMermaid(parallelSource), { compareRoutePreferences: false })
    const first = LAYOUT_PIPELINE[0]!, run = first.run
    let calls = 0
    first.run = context => { calls++; run(context) }
    try {
      const graph = parseMermaid(parallelSource), selected = layoutGraphSync(graph)
      expect(calls).toBe(1)
      expect(selected.certification?.preference.routing).toBeUndefined()
      expect(selected.edges.map(edge => [edge.edgeIndex, edge.source, edge.target])).toEqual(
        graph.edges.map((edge, index) => [index, edge.source, edge.target]))
      expect(selected.edges.map(edge => edge.points)).toEqual(baseline.edges.map(edge => edge.points))
      const duplicates = selected.edges.filter(edge => edge.source === 'N4' && edge.target === 'N0')
      expect(duplicates).toHaveLength(3)
      const gap = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
      for (let i = 0; i < duplicates.length; i++) for (let j = i + 1; j < duplicates.length; j++) {
        expect(gap(duplicates[i]!.points[0]!, duplicates[j]!.points[0]!)).toBeGreaterThanOrEqual(11)
        expect(gap(duplicates[i]!.points.at(-1)!, duplicates[j]!.points.at(-1)!)).toBeGreaterThanOrEqual(11)
      }
    } finally {
      first.run = run
    }
  })

  test('clean symmetric fans, placement-only calls and graphs over the work bound skip the second pipeline', () => {
    const first = LAYOUT_PIPELINE[0]!, run = first.run
    let calls = 0
    first.run = context => { calls++; run(context) }
    try {
      const symmetric = layoutGraphSync(parseMermaid('flowchart TD\nA --> B\nA --> C\nA --> D'))
      expect(calls).toBe(1)
      expect(symmetric.certification?.preference.routing).toBeUndefined()
      calls = 0
      const placement = layoutGraphSync(parseMermaid(source), { compareRoutePreferences: false })
      expect(calls).toBe(1)
      expect(placement.certification?.preference.routing).toBeUndefined()
      calls = 0
      const large = parseMermaid(source)
      for (let i = large.nodes.size; i < 65; i++) large.nodes.set(`N${i}`, { id: `N${i}`, label: `N${i}`, shape: 'rectangle' })
      const bounded = layoutGraphSync(large)
      expect(calls).toBe(1)
      expect(bounded.certification?.preference.routing).toBeUndefined()
    } finally {
      first.run = run
    }
  })
})
