import '../index.ts'
import { describe, expect, test } from 'bun:test'
import { LAYOUT_PIPELINE, layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { withRenderStageObserver } from '../render-stages.ts'
import { assessLayout, hardViolations } from '../layout-rubric.ts'
import { flowchartMesh } from '../../eval/benchmark/release-bench-cases.ts'

// This existing dense fixture still benefits from a route comparison after
// placement selection. The former small skip-link fixture is now clean in its
// first proposal because layer alignment preserves outward terminal shafts.
const source = flowchartMesh(50, 20)

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
