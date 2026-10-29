// Tests for the LayoutPass abstraction (docs/design/system/route-contracts.md §8):
// production runPipeline enforcement and the geometry its passes produce.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { complicatedFixtures, simpleFixtures } from '../../eval/visual-rubric/fixtures.ts'
import type { LayoutPass, MetricBudget, PassContextBase, RubricMetric } from '../layout/pass.ts'
import * as passContract from '../layout/pass.ts'
const { LayoutMetricBudgetError, LayoutPassContractError, runPipeline } = passContract
import { LAYOUT_PIPELINE, convertToElkFormat, layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { renderMermaidSVG } from '../index.ts'
import { verifyMermaid } from '../agent/index.ts'
import { withPerformanceExperiments } from '../experimental-performance.ts'
import * as rubric from '../layout-rubric.ts'
const { assessLayout, countOpposingRouteOverlaps, countParallelRouteOverlaps, hardViolations, measureRubricMetrics, onShapeOutline } = rubric
import { resolveRenderStyle } from '../styles.ts'
import { labelRect } from '../route-contracts.ts'
import * as routeContracts from '../route-contracts.ts'
import { applySymmetricParallelEdgeLanes, applyParallelDuplicateLanes } from '../layout/passes/index.ts'
import { graphEdgeTextBlock } from '../graph-text.ts'
import { bundleEdgePaths } from '../layout/passes/edge-bundling.ts'
import { opposingRoutePartners } from '../shared/edge-overlaps.ts'
import { createTextMeasurementExecution, withTextMeasurementExecution } from '../text-measurement-profile.ts'
import type { PositionedEdge, PositionedGraph, PositionedNode } from '../types.ts'

describe('source-aware ELK child order', () => {
  test.each([
    ['ready nodes released ahead of earlier queued nodes', 'flowchart TD\nA\nB\nC\nD\nE\nE --> B\nB --> D\nA --> C', ['A', 'C', 'E', 'B', 'D']],
    ['authored tie order after multiple releases', 'flowchart TD\nA\nB\nC\nD\nE\nE --> B\nE --> A\nD --> C', ['D', 'C', 'E', 'A', 'B']],
    ['feedback and parallel edges retain author-order roles', 'flowchart TD\nA\nB\nC\nD\nC --> B\nB --> A\nA --> C\nD --> B\nD --> B', ['C', 'D', 'B', 'A']],
  ])('%s', (_name, source, expected) => {
    expect(convertToElkFormat(parseMermaid(source)).children!.map(node => node.id)).toEqual(expected)
  })

  test('root container mapping and internal source order remain separate', () => {
    const elk = convertToElkFormat(parseMermaid('flowchart TD\nsubgraph Z\nB\nA\nA --> B\nend\nC\nC --> A'))
    expect(elk.children!.map(node => node.id)).toEqual(['C', 'Z'])
    expect(elk.children!.find(node => node.id === 'Z')!.children!.map(node => node.id)).toEqual(['A', 'B'])
  })
})

describe('declared pass budgets on actual native geometry', () => {
  test.each(['LR', 'RL', 'TD', 'BT'] as const)('%s: final closure repairs a late false bundle certificate before public output', direction => {
    withPerformanceExperiments(['text-spans', 'indexed-layout'], () => {
      const source = `flowchart ${direction}\nA[Start] --> B[Done]`
      const baseline = renderMermaidSVG(source, { embedFontImport: false })
      const pass = LAYOUT_PIPELINE.find(candidate => candidate.id === 'separateEdgeLabelPills')!, run = pass.run
      let injected = 0
      pass.run = context => {
        run(context)
        const edge = context.edges[0]!, a = edge.points[0]!, b = edge.points.at(-1)!
        const horizontal = direction === 'LR' || direction === 'RL'
        const first = horizontal ? a.x + (b.x - a.x) / 3 : a.y + (b.y - a.y) / 3
        const second = horizontal ? a.x + (b.x - a.x) * 2 / 3 : a.y + (b.y - a.y) * 2 / 3
        edge.points = horizontal
          ? [a, { x: first, y: a.y }, { x: first, y: a.y + 12 }, { x: second, y: a.y + 12 }, { x: second, y: b.y }, b]
          : [a, { x: a.x, y: first }, { x: a.x + 12, y: first }, { x: a.x + 12, y: second }, { x: b.x, y: second }, b]
        const { straightened: _straightened, ...saved } = edge.routeCertificate!
        edge.routeCertificate = { ...saved, invariant: 'bundle', bendCount: 4 }
        injected++
      }
      try {
        expect(renderMermaidSVG(source, { embedFontImport: false })).toBe(baseline)
        const verified = verifyMermaid(source)
        expect(verified.ok).toBe(true)
        expect(verified.warnings).toEqual([])
        expect(verified.layout.edges[0]!.path).toHaveLength(2)
        expect(injected).toBeGreaterThanOrEqual(2)
      } finally { pass.run = run }
    })
  })

  test.each([
    ['canonical reciprocal ports', `flowchart LR
N0{{warnings}}
N1["ok"]
N2[(same word ok)]
N3{{a longer label goes here}}
N4["x"]
N5[(errors)]
N5 ===> N2
N2 ---> N5
N5 ---->|same word ok| N0
N0 -->|a longer label goes here| N3
N3 ===> N0`],
    ['mixed decision fan', `flowchart BT
D{ok}
D -->|yes| T0["ok"]
D -->|no| T1["same word ok"]
D -->|yes| T2["a longer label goes here"]
D -->|no| T3["x"]
D -->|yes| T4["errors"]
D -->|no| T5["q"]
S0["ok"] --> D
S1["same word ok"] --> D`],
  ])('keeps feasible geometry when a cosmetic proposal loses: %s', (_name, source) => {
    const graph = parseMermaid(source)
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target])).toEqual(graph.edges.map(edge => [edge.source, edge.target]))
    expect(hardViolations(assessLayout(graph, positioned))).toEqual([])
    expect(positioned.edges.every(edge => edge.routeCertificate !== undefined)).toBe(true)
    expect(renderMermaidSVG(source)).toContain('<svg')
    expect(renderMermaidSVG(source)).toBe(renderMermaidSVG(source))
  })

  test.each([
    ['through-node straight route', 'flowchart RL\nN6((a longer label goes here))\nN2 ---> N0\nN6 ===>|warnings| N0\nN1 ----> N6'],
    ['two-point diagonals', 'flowchart TD\nA["done"] -->|done| B["b"]\nA --> B\nA --> B\nB --> C'],
    ['detached feedback endpoint', 'flowchart TD\nS0["warnings"] --> H["hub"]\nS1["ok"] --> H\nS2["same word ok"] --> H\nS3["a longer label goes here"] --> H\nH --> T["out"]\nT --> S3'],
  ])('route certification may repair an infeasible early route: %s', (_name, source) => {
    const graph = parseMermaid(source)
    const pass = LAYOUT_PIPELINE.find(candidate => candidate.id === 'applyRouteContracts')!, run = pass.run
    const repairs: Array<{ bundled: boolean; placement: unknown; before: number; after: number }> = []
    pass.run = context => {
      const measure = () => measureRubricMetrics(graph, { nodes: context.nodes, edges: context.edges, groups: context.groups, width: 0, height: 0 }, ['hard', 'endpointApproaches'], context.style)
      const before = measure()
      run(context)
      const after = measure()
      repairs.push({
        bundled: context.mergeEdges,
        placement: context.elkResult,
        before: before.hard! + before.endpointApproaches!,
        after: after.hard! + after.endpointApproaches!,
      })
    }
    try {
      const positioned = layoutGraphSync(graph)
      expect(positioned.edges).toHaveLength(graph.edges.length)
      expect(hardViolations(assessLayout(graph, positioned))).toEqual([])
      // These feasible fixtures need at most two placement strategies, followed
      // by one unbundled proposal on the selected placement. Every producer must
      // independently repair an infeasible route or preserve an already clean
      // route before its completed geometry is scored.
      const bundled = repairs.filter(repair => repair.bundled)
      const unbundled = repairs.filter(repair => !repair.bundled)
      expect(bundled.length).toBeGreaterThanOrEqual(1)
      expect(bundled.length).toBeLessThanOrEqual(2)
      expect(unbundled.length).toBeLessThanOrEqual(1)
      for (const repair of repairs) {
        expect(repair.after).toBe(0)
        if (repair.before > 0) expect(repair.after).toBeLessThan(repair.before)
      }
      for (const repair of unbundled) {
        expect(bundled.some(previous => previous.placement === repair.placement)).toBe(true)
        expect(repairs.at(-1)).toBe(repair)
      }
    } finally { pass.run = run }
  })

  test('canonical contacts cannot yield without a measured higher-priority repair', () => {
    const pass = LAYOUT_PIPELINE.find(candidate => candidate.id === 'applyRouteContracts')!, run = pass.run
    let calls = 0, failure: unknown
    pass.run = context => {
      calls++; run(context)
      context.edges[0]!.points = context.edges[0]!.points.map(point => ({ x: point.x, y: point.y + 3 }))
    }
    // Pin ELK's canonical straight contact rather than the forest's dogleg.
    try { withPerformanceExperiments([], () => layoutGraphSync(parseMermaid('flowchart LR\nA-->B'))) } catch (error) { failure = error } finally { pass.run = run }
    expect(failure).toBeInstanceOf(LayoutMetricBudgetError)
    expect(failure).toMatchObject({ pass: 'applyRouteContracts', metric: 'portRate', before: 1, after: 0, allowance: 0 })
    expect(calls).toBe(1)
  })

  test('outward slanted-corner contact differs from a tangent or interior shaft', () => {
    const source: PositionedNode = { id: 'A', label: '', shape: 'lean-r', x: 0, y: 0, width: 100, height: 40 }
    const edge: PositionedEdge = { source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: true, points: [{ x: 100, y: 0 }, { x: 120, y: 0 }] }
    expect(routeContracts.invalidEndpointApproaches(edge, source)).toBe(0)
    expect(routeContracts.invalidEndpointApproaches({ ...edge, points: [{ x: 50, y: 0 }, { x: 120, y: 0 }] }, source)).toBe(1)
    expect(routeContracts.invalidEndpointApproaches({ ...edge, points: [{ x: 100, y: 0 }, { x: 80, y: 0 }] }, source)).toBe(1)
  })

  test('opposing shared ink excludes fan trunks, endpoint contacts and ordinary crossings', () => {
    const edge: PositionedEdge = { source: 'A', target: 'B', style: 'solid', hasArrowStart: false, hasArrowEnd: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }
    const paired = (points: PositionedEdge['points']) => countOpposingRouteOverlaps([edge, { ...edge, source: 'C', target: 'D', points }])
    expect(paired([{ x: 8, y: 0 }, { x: 2, y: 0 }])).toBe(1)
    expect(paired([{ x: 2, y: 0 }, { x: 8, y: 0 }])).toBe(0)
    expect(paired([{ x: 20, y: 0 }, { x: 10, y: 0 }])).toBe(0)
    expect(paired([{ x: 5, y: -5 }, { x: 5, y: 5 }])).toBe(0)
  })
  for (const direction of ['LR', 'RL'] as const) test.each([
    ['invisible', '~~~', ''],
    ['thick', '==>', ''],
    ['dotted', '-.->', ''],
    ['different colour', '-->', '\nlinkStyle 0 stroke:red'],
    ['different marker', '--o', ''],
  ])(`${direction}: a %s cross-relation cannot license a solid complete-join bus`, (_name, operator, styling) => {
    const graph = parseMermaid(`flowchart ${direction}\nB ${operator} D\nA --> C\nB --> C\nA --> D${styling}`)
    const positioned = layoutGraphSync(graph)
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.style])).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.style]))
    expect(countOpposingRouteOverlaps(positioned.edges)).toBe(0)
    expect(renderMermaidSVG(`flowchart ${direction}\nB ${operator} D\nA --> C\nB --> C\nA --> D${styling}`)).toContain('<svg')
  })
  test('bundling cannot exchange an existing misleading overlap for a new peer', () => {
    const node = (id: string, x: number, y: number): PositionedNode => ({ id, label: id, shape: 'rectangle', x, y, width: 60, height: 36.9 })
    const nodes = [node('A', 40, 40), node('C', 148, 40), node('D', 148, 104.9), node('E', 300, 200), node('F', 400, 300), node('G', 500, 400), node('H', 600, 500)]
    const edge = (source: string, target: string, points: number[][]): PositionedEdge => ({ source, target, style: 'solid', hasArrowStart: false, hasArrowEnd: true, points: points.map(([x, y]) => ({ x: x!, y: y! })) })
    const edges = [
      edge('A', 'C', [[100, 58.45], [148, 58.45]]),
      edge('A', 'D', [[100, 58.45], [112, 58.45], [112, 123.35], [148, 123.35]]),
      edge('E', 'F', [[300, 218.45], [112, 218.45], [112, 10], [430, 10], [430, 300]]),
      edge('G', 'H', [[500, 418.45], [124, 418.45], [124, 20], [630, 20], [630, 500]]),
    ]
    const subject = edges[1]!, peers = edges.slice(2)
    expect(opposingRoutePartners(subject, peers)).toEqual([edges[2]!])
    const bundled = bundleEdgePaths(edges, nodes, [], 'LR', resolveRenderStyle())
    expect(opposingRoutePartners(subject, peers)).toEqual([edges[2]!])
    expect(bundled.has(subject)).toBe(false)
  })
  test('the engine rejects actual detour bends before fallback without audit options', () => {
    const pass = LAYOUT_PIPELINE.find(candidate => candidate.id === 'alignLayerNodes')!
    const run = pass.run
    let producerCalls = 0
    pass.run = context => {
      producerCalls++
      run(context)
      const edge = context.edges[0]!
      const start = edge.points[0]!, end = edge.points.at(-1)!
      edge.points = [
        start,
        { x: start.x + 8, y: start.y },
        { x: start.x + 8, y: start.y + 12 },
        { x: end.x - 8, y: start.y + 12 },
        { x: end.x - 8, y: end.y },
        end,
      ]
    }
    let failure: unknown
    try {
      withPerformanceExperiments([], () => layoutGraphSync(parseMermaid('flowchart LR\nA --> B')))
    } catch (error) {
      failure = error
    } finally {
      pass.run = run
    }
    expect(failure).toBeInstanceOf(LayoutMetricBudgetError)
    expect(failure).toMatchObject({ pass: 'alignLayerNodes', metric: 'bends', before: 0, after: 4, allowance: 0 })
    expect(producerCalls).toBe(1)
  })

  test('a late edge pass moving a frozen node is a production contract failure, not a fallback candidate', () => {
    const pass = LAYOUT_PIPELINE.find(candidate => candidate.id === 'repairLabelsOffOwnRoute')!
    const run = pass.run
    let calls = 0, failure: unknown
    pass.run = context => { calls++; run(context); context.nodes[0]!.x += 9 }
    try {
      layoutGraphSync(parseMermaid('flowchart LR\nA --> B'))
    } catch (error) {
      failure = error
    } finally {
      pass.run = run
    }
    expect(failure).toBeInstanceOf(LayoutPassContractError)
    expect(failure).toMatchObject({ pass: 'repairLabelsOffOwnRoute', contract: 'freeze' })
    expect(calls).toBe(1)
  })

  test('separating already distinct parallel routes cannot buy a crossing merely to remove bends', () => {
    const graph = parseMermaid('flowchart TD\nN2-->N0\nN1-->N2\nN0-->N1\nN2-->N0\nN0-->N1')
    const positioned = layoutGraphSync(graph)
    expect(positioned.edges).toHaveLength(5)
    const pair = positioned.edges.filter(edge => edge.source === 'N2' && edge.target === 'N0')
    expect(pair[0]!.points).not.toEqual(pair[1]!.points)
    expect(assessLayout(graph, positioned).metrics.edgeCrossings).toBe(0)
  })

  test('labeled parallel lanes retain a crossing-free feedback route and both labels', () => {
    const graph = parseMermaid('flowchart LR\nN2-.-|note 0|N0\nN0-.-N1\nN2-.-|note 5|N0\nN1-.-N2')
    const positioned = layoutGraphSync(graph)
    expect(positioned.certification?.status).toBe('passed')
    expect(positioned.edges).toHaveLength(4)
    const pair = positioned.edges.filter(edge => edge.source === 'N2' && edge.target === 'N0')
    expect(pair.map(edge => edge.label)).toEqual(['note 0', 'note 5'])
    expect(pair[0]!.points).not.toEqual(pair[1]!.points)
    for (const edge of pair) {
      expect(edge.labelPosition).toBeDefined()
      expect(edge.labelBlock).toBeDefined()
    }
    for (const edge of positioned.edges) {
      expect(onShapeOutline(positioned.nodes.find(node => node.id === edge.source)!, edge.points[0]!)).toBe(true)
      expect(onShapeOutline(positioned.nodes.find(node => node.id === edge.target)!, edge.points.at(-1)!)).toBe(true)
    }
    const { metrics } = assessLayout(graph, positioned)
    expect(metrics.edgeCrossings).toBe(0)
    expect(metrics.labelOffRoute).toBe(0)
    const boxes = pair.map(edge => labelRect(edge, resolveRenderStyle())!)
    for (const box of boxes) {
      for (const node of positioned.nodes) {
        const overlapWidth = Math.min(box.x + box.w, node.x + node.width) - Math.max(box.x, node.x)
        const overlapHeight = Math.min(box.y + box.h, node.y + node.height) - Math.max(box.y, node.y)
        expect(overlapWidth > 0 && overlapHeight > 0).toBe(false)
      }
    }
    const [first, second] = boxes
    expect(Math.min(first!.x + first!.w, second!.x + second!.w) <= Math.max(first!.x, second!.x)
      || Math.min(first!.y + first!.h, second!.y + second!.h) <= Math.max(first!.y, second!.y)).toBe(true)
    expect(countParallelRouteOverlaps(pair)).toBe(0)
  })

  test.each([true, false])('parallel label lanes reserve transformed, tracked text width (retained: %s)', retained => {
    const graph = parseMermaid('flowchart TB\nA-->|straße|B\nA-->|straße|B')
    const style = resolveRenderStyle({ styleFace: { edge: { textTransform: 'uppercase', letterSpacing: 6 } } })
    const block = retained
      ? withTextMeasurementExecution(createTextMeasurementExecution({
        id: 'test:retained-lane-labels', version: '1.0.0', measure: ({ text }) => text.length * 20,
      }, 'Inter'), () => graphEdgeTextBlock('straße', style))
      : graphEdgeTextBlock('straße', style)
    const nodes: PositionedNode[] = [
      { id: 'A', label: 'A', shape: 'rectangle', x: 200, y: 0, width: 100, height: 40 },
      { id: 'B', label: 'B', shape: 'rectangle', x: 200, y: 400, width: 100, height: 40 },
    ]
    const edges: PositionedEdge[] = graph.edges.map((edge, edgeIndex) => ({
      ...edge, edgeIndex, labelBlock: retained ? block : undefined,
      points: [{ x: 225 + edgeIndex * 50, y: 40 }, { x: 225 + edgeIndex * 50, y: 400 }],
    }))
    applySymmetricParallelEdgeLanes(nodes, edges, [], graph, new Set(), style)
    expect(block.text).toBe('STRASSE')
    expect(edges[0]!.labelPosition!.x + (block.width + 16) / 2).toBeLessThanOrEqual(200 - 18)
    expect(edges[1]!.labelPosition!.x - (block.width + 16) / 2).toBeGreaterThanOrEqual(300 + 18)
    if (retained) for (const edge of edges) expect(edge.labelBlock).toBe(block)
  })

  test.each([false, true])('mixed duplicate admission proves the label seat it publishes (Native clearance: %s)', native => {
    const graph = parseMermaid('flowchart LR\nA-->B\nA-->|first<br/>second<br/>third|B\nO\nP\nQ')
    const nodes: PositionedNode[] = [
      { id: 'A', label: 'A', shape: 'rectangle', x: 0, y: 0, width: 120, height: 160 },
      { id: 'B', label: 'B', shape: 'rectangle', x: 400, y: 100, width: 120, height: 160 },
      { id: 'O', label: 'O', shape: 'rectangle', x: 250, y: 202, width: 10, height: 20 },
      { id: 'P', label: 'P', shape: 'rectangle', x: 275, y: 202, width: 10, height: 20 },
      { id: 'Q', label: 'Q', shape: 'rectangle', x: 380, y: 100, width: 10, height: 10 },
    ]
    // The longest-segment midpoint covers O and P. A later seat on the same
    // shaft is clear; Q blocks the mirrored route, so rejecting a fictitious
    // midpoint would leave both authored relationships collapsed together.
    const edges: PositionedEdge[] = graph.edges.map((edge, edgeIndex) => ({
      ...edge, edgeIndex,
      points: [{ x: 120, y: 80 }, { x: 260, y: 80 }, { x: 260, y: 180 }, { x: 400, y: 180 }],
      ...(edge.label ? { labelPosition: { x: 260, y: 80 } } : {}),
    }))
    const style = resolveRenderStyle()
    applyParallelDuplicateLanes(nodes, edges, [], graph, new Set(), style, native ? style : undefined)
    expect(countParallelRouteOverlaps(edges)).toBe(0)
    const box = labelRect(edges[1]!, style)!
    expect(box.x).toBeGreaterThan(285)
    for (const node of nodes) expect(Math.min(box.x + box.w, node.x + node.width) > Math.max(box.x, node.x)
      && Math.min(box.y + box.h, node.y + node.height) > Math.max(box.y, node.y)).toBe(false)
    for (let i = 1; i < edges[0]!.points.length; i++) {
      const a = edges[0]!.points[i - 1]!, b = edges[0]!.points[i]!
      const enters = a.x === b.x
        ? a.x > box.x && a.x < box.x + box.w && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.h
        : a.y > box.y && a.y < box.y + box.h && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.w
      expect(enters).toBe(false)
    }
  })

  for (const direction of ['TB', 'BT', 'LR', 'RL'] as const) for (const mixed of [false, true]) {
    test(`near-aligned duplicate ports keep exact orthogonal routes: ${direction}, mixed=${mixed}`, () => {
      const horizontal = direction === 'LR' || direction === 'RL'
      const reverse = direction === 'BT' || direction === 'RL'
      const graph = parseMermaid(`flowchart ${direction}\nA-->B\nA${mixed ? '-->|label|' : '-->'}B`)
      const point = (main: number, cross: number) => horizontal ? { x: main, y: cross } : { x: cross, y: main }
      const box = (main: number, cross: number): PositionedNode => ({ id: '', label: '', shape: 'rectangle', ...point(main, cross), width: 80, height: 80 })
      const source = { ...box(reverse ? 300 : 0, 0), id: 'A', label: 'A' }
      const target = { ...box(reverse ? 0 : 300, 0.0566666666667), id: 'B', label: 'B' }
      const startMain = reverse ? 300 : 80, endMain = reverse ? 80 : 300
      const edges: PositionedEdge[] = graph.edges.map((edge, edgeIndex) => ({ ...edge, edgeIndex,
        points: [point(startMain, 40), point(190, 40), point(190, 40.0566666666667), point(endMain, 40.0566666666667)],
        ...(edge.label ? { labelPosition: point(190, 40) } : {}),
      }))
      applyParallelDuplicateLanes([source, target], edges, [], graph, new Set(), resolveRenderStyle())
      expect(edges).toHaveLength(2)
      expect(edges[0]!.points).not.toEqual(edges[1]!.points)
      for (const edge of edges) {
        expect(edge.points[0]![horizontal ? 'y' : 'x'] - edge.points.at(-1)![horizontal ? 'y' : 'x']).not.toBe(0)
        for (let i = 1; i < edge.points.length; i++) {
          const a = edge.points[i - 1]!, b = edge.points[i]!
          expect(a.x === b.x || a.y === b.y).toBe(true)
        }
        expect(onShapeOutline(source, edge.points[0]!)).toBe(true)
        expect(onShapeOutline(target, edge.points.at(-1)!)).toBe(true)
      }
    })
  }

  for (const direction of ['TB', 'BT', 'LR', 'RL'] as const) for (const occupied of [49, 74]) {
    test(`duplicate lanes preserve a labelled peer's marker seat: ${direction}, peer=${occupied}`, () => {
      const horizontal = direction === 'LR' || direction === 'RL', reverse = direction === 'BT' || direction === 'RL'
      const graph = parseMermaid(`flowchart ${direction}\nA-->B\nA-->B\nP-->|label|B`)
      const point = (main: number, cross: number) => horizontal ? { x: main, y: cross } : { x: cross, y: main }
      const box = (main: number, cross: number): PositionedNode => ({ id: '', label: '', shape: 'rectangle', ...point(main, cross), width: horizontal ? 40 : 80, height: horizontal ? 80 : 40 })
      const nodes = [{ ...box(reverse ? 200 : 0, 0), id: 'A' }, { ...box(reverse ? 0 : 200, 0), id: 'B' }, { ...box(reverse ? 200 : 0, 120), id: 'P' }]
      const start = reverse ? 200 : 40, end = reverse ? 40 : 200, jog = reverse ? 50 : 190
      const edges: PositionedEdge[] = graph.edges.map((edge, edgeIndex) => ({ ...edge, edgeIndex,
        points: edgeIndex < 2 ? [point(start, edgeIndex ? 60 : 20), point(end, edgeIndex ? 60 : 20)]
          : [point(start, 160), point(jog, 160), point(jog, occupied), point(end, occupied)],
        ...(edge.label ? { labelPosition: point((start + jog) / 2, 160) } : {}),
      }))
      const before = edges.map(edge => edge.points)
      applyParallelDuplicateLanes(nodes, edges, [], graph, new Set(), resolveRenderStyle())
      const cross = horizontal ? 'y' : 'x'
      const positions = edges.map(edge => edge.points.at(-1)![cross])
      // These literal width1 hidden arrowheads have 5px full cross span.
      // Identical target identity/colors cannot erase a distinct marker seat.
      for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) expect(Math.abs(positions[i]! - positions[j]!)).toBeGreaterThanOrEqual(5)
      if (occupied === 49) expect(edges[2]!.points).toBe(before[2]!)
      else {
        expect(positions.slice(0, 2)).toEqual([33, 47])
        expect(edges[2]!.points).toBe(before[2]!)
      }
    })
  }

  test('cyclic-19 labelled arrival keeps separated final marker ports', () => {
    const source = readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-19.mmd', import.meta.url), 'utf8')
    const graph = parseMermaid(source), positioned = layoutGraphSync(graph)
    const arrivals = positioned.edges.filter(edge => edge.source === 'n0' && edge.target === 'n4')
    expect(arrivals).toHaveLength(3)
    expect(arrivals.map(edge => edge.label)).toEqual(graph.edges.filter(edge => edge.source === 'n0' && edge.target === 'n4').map(edge => edge.label))
    for (let i = 0; i < arrivals.length; i++) for (let j = i + 1; j < arrivals.length; j++) expect(Math.abs(arrivals[i]!.points.at(-1)!.x - arrivals[j]!.points.at(-1)!.x)).toBeGreaterThanOrEqual(5)
  })

  test('seeded separation sample78 preserves the three live circle-marker seats', () => {
    const source = "flowchart RL\n  N0[\\n0\\]\n  N1((n1))\n  N2{n2}\n  N3(n3)\n  N0 --> N1\n  N3 --> N0\n  N1 --> N2\n  N0 --> N1\n  N3 -- go --> N1\n  N0 -- go --> N2\n  N2 --> N1"
    const graph = parseMermaid(source), positioned = layoutGraphSync(graph)
    const pair = positioned.edges.filter(edge => edge.source === 'N0' && edge.target === 'N1')
    expect(pair).toHaveLength(2)
    const gap = (a: {x:number;y:number}, b: {x:number;y:number}) => Math.hypot(a.x-b.x,a.y-b.y)
    expect(gap(pair[0]!.points[0]!,pair[1]!.points[0]!)).toBeGreaterThanOrEqual(11)
    expect(gap(pair[0]!.points.at(-1)!,pair[1]!.points.at(-1)!)).toBeGreaterThanOrEqual(11)
    expect(positioned.edges.map(edge=>[edge.source,edge.target,edge.label])).toEqual(graph.edges.map(edge=>[edge.source,edge.target,edge.label]))
  })

  for (const [flipX,flipY] of [[false,false],[true,false],[false,true],[true,true]] as const) test(`margin-endpoint slots clear the live labelled circle arrival (${flipX},${flipY})`, () => {
    const source = "flowchart RL\n  N0[\\n0\\]\n  N1((n1))\n  N2{n2}\n  N3(n3)\n  N0 --> N1\n  N3 --> N0\n  N1 --> N2\n  N0 --> N1\n  N3 -- go --> N1\n  N0 -- go --> N2\n  N2 --> N1"
    const graph = parseMermaid(source)
    graph.direction = flipX ? 'LR' : 'RL'
    const originals: PositionedNode[] = [
      {"id": "N3", "label": "n3", "shape": "rounded", "x": 426.53999999999996, "y": 102.73749999999998, "width": 60, "height": 36.900000000000006},
      {"id": "N0", "label": "n0", "shape": "lean-l", "x": 301.77, "y": 62.9375, "width": 76.77, "height": 36.900000000000006},
      {"id": "N1", "label": "n1", "shape": "circle", "x": 180.76999999999998, "y": 91.60999999999999, "width": 73, "height": 73},
      {"id": "N2", "label": "n2", "shape": "diamond", "x": 52.000000000000014, "y": 47.34, "width": 80.77, "height": 80.77},
    ]
    const originalsRoutes = [
      {"points": [[307.52774999999997, 81.3875], [265.77, 81.3875], [265.77, 106.21], [246.47, 106.21]]},
      {"points": [[426.53999999999996, 115.0375], [390.53999999999996, 115.0375], [390.53999999999996, 81.3875], [372.78225, 81.3875]]},
      {"points": [[180.76999999999998, 128.10999999999999], [92.38500000000002, 128.10999999999999]]},
      {"points": [[310.40662499999996, 90.61250000000001], [277.77, 90.61250000000001], [277.77, 120.80999999999999], [253.0325502446344, 120.80999999999999]]},
      {"points": [[426.53999999999996, 127.33749999999999], [335.29999999999995, 127.33749999999999], [335.29999999999995, 138.8375], [265.77, 138.8375], [265.77, 135.40999999999997], [253.0325502446344, 135.40999999999997]], "labelPosition": [312.53499999999997, 137.9875]},
      {"points": [[304.648875, 72.1625], [214.29999999999995, 72.1625], [214.29999999999995, 51], [144.76999999999998, 51], [144.76999999999998, 74.26333333333334], [119.30833333333335, 74.26333333333334]], "labelPosition": [191.53499999999997, 50.15]},
      {"points": [[52.000000000000014, 87.725], [40.000000000000014, 87.725], [40.000000000000014, 172.3], [265.77, 172.3], [265.77, 150.01], [246.46999999999997, 150.01]]},
    ]
    const nodes = originals.map(node=>({...node, x:flipX?-node.x-node.width:node.x, y:flipY?-node.y-node.height:node.y,
      shape:node.shape==='lean-l'&&flipX!==flipY?'lean-r' as const:node.shape}))
    const reflect = (p: readonly number[]) => ({x:flipX?-p[0]!:p[0]!,y:flipY?-p[1]!:p[1]!})
    const edges: PositionedEdge[] = graph.edges.map((edge,edgeIndex)=>({...edge,edgeIndex,points:originalsRoutes[edgeIndex]!.points.map(reflect),
      ...('labelPosition' in originalsRoutes[edgeIndex]! ? {labelPosition:reflect(originalsRoutes[edgeIndex]!.labelPosition!)} : {})}))
    const before = edges.map(edge=>edge.points)
    const beforeLabels = edges.map(edge=>edge.labelPosition && {...edge.labelPosition})
    const beforeCrossings = rubric.countEdgeCrossings(edges)
    applyParallelDuplicateLanes(nodes,edges,[],graph,new Set(),resolveRenderStyle())
    const first=edges[0]!,second=edges[3]!
    expect(Math.hypot(first.points[0]!.x-second.points[0]!.x,first.points[0]!.y-second.points[0]!.y)).toBeGreaterThanOrEqual(11)
    expect(Math.hypot(first.points.at(-1)!.x-second.points.at(-1)!.x,first.points.at(-1)!.y-second.points.at(-1)!.y)).toBeGreaterThanOrEqual(11)
    for(let i=0;i<edges.length;i++) if(i!==0&&i!==3) expect(edges[i]!.points).toBe(before[i]!)
    expect(edges.map(edge=>edge.labelPosition)).toEqual(beforeLabels)
    expect(rubric.countEdgeCrossings(edges)).toBeLessThanOrEqual(beforeCrossings)
    // Default literal width-one hidden arrow viewport: eight pixels behind
    // its tip and five across. These all have horizontal terminal tangents.
    const markers=edges.map(edge=>{
      const tip=edge.points.at(-1)!,previous=edge.points.at(-2)!
      expect(tip.y).toBe(previous.y)
      const back=tip.x+(previous.x>tip.x?8:-8)
      return {x0:Math.min(tip.x,back),x1:Math.max(tip.x,back),y0:tip.y-2.5,y1:tip.y+2.5}
    })
    for(const index of [0,3]) for(let peer=0;peer<markers.length;peer++) if(peer!==index){
      const a=markers[index]!,b=markers[peer]!
      expect(a.x0<b.x1&&b.x0<a.x1&&a.y0<b.y1&&b.y0<a.y1).toBe(false)
    }
    for(const edge of [first,second]) for(let i=1;i<edge.points.length;i++) expect(edge.points[i-1]!.x===edge.points[i]!.x||edge.points[i-1]!.y===edge.points[i]!.y).toBe(true)
  })

  test('three blocked marker domains retain every original route atomically', () => {
    const graph=parseMermaid('flowchart TB\nA-->B\nA-->B\nP0-->|a|B\nP1-->|b|B\nP2-->|c|B')
    const nodes:PositionedNode[]=[{id:'A',label:'A',shape:'rectangle',x:0,y:0,width:80,height:40},{id:'B',label:'B',shape:'rectangle',x:0,y:200,width:80,height:40},
      ...[0,1,2].map(index=>({id:`P${index}`,label:'P',shape:'rectangle' as const,x:120+120*index,y:0,width:80,height:40}))]
    const edges:PositionedEdge[]=graph.edges.map((edge,edgeIndex)=>({...edge,edgeIndex,points:edgeIndex<2?[{x:edgeIndex?60:20,y:40},{x:edgeIndex?60:20,y:200}]:
      [{x:160+120*(edgeIndex-2),y:40},{x:160+120*(edgeIndex-2),y:190},{x:[49,7,73][edgeIndex-2]!,y:190},{x:[49,7,73][edgeIndex-2]!,y:200}]}))
    const before=JSON.stringify(edges),refs=edges.map(edge=>edge.points)
    applyParallelDuplicateLanes(nodes,edges,[],graph,new Set(),resolveRenderStyle())
    expect(JSON.stringify(edges)).toBe(before)
    for(let i=0;i<edges.length;i++)expect(edges[i]!.points).toBe(refs[i]!)
  })

  test('one crossing may resolve one actual collapsed duplicate route, without losing either authored edge', () => {
    const graph = parseMermaid('flowchart LR\nN0-->N1\nN0-->N1\nN0-->N2')
    const positioned = layoutGraphSync(graph)
    expect(positioned.edges).toHaveLength(3)
    const pair = positioned.edges.filter(edge => edge.source === 'N0' && edge.target === 'N1')
    expect(pair[0]!.points).not.toEqual(pair[1]!.points)
    expect(countParallelRouteOverlaps(pair)).toBe(0)
    expect(assessLayout(graph, positioned).metrics.edgeCrossings).toBe(1)
  })

  test.each(['LR', 'RL', 'TD', 'BT'] as const)('%s duplicate lanes preserve orthogonal segments at subpixel offsets', direction => {
    const point = (main: number, cross: number) => direction === 'LR' ? { x: main, y: cross }
      : direction === 'RL' ? { x: -main, y: cross } : direction === 'TD' ? { x: cross, y: main } : { x: cross, y: -main }
    const node = (id: string, main: number, cross: number): PositionedNode => {
      const a = point(main, cross), b = point(main + 100, cross + 80)
      return { id, label: id, shape: 'rectangle', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
    }
    for (const offset of [-0.05, -0.005, -0.0005, 0, 0.0005, 0.005, 0.05]) for (const mixed of [false, true]) {
      const graph = parseMermaid(`flowchart ${direction}\nA-->B\nA-->${mixed ? '|label|' : ''}B`)
      const nodes = [node('A', 0, 0), node('B', 300, offset)]
      const edges: PositionedEdge[] = graph.edges.map((edge, edgeIndex) => ({
        ...edge, edgeIndex, points: [point(100, 40), point(200, 40), point(200, 40 + offset), point(300, 40 + offset)],
      }))
      applyParallelDuplicateLanes(nodes, edges, [], graph, new Set(), resolveRenderStyle())
      expect(edges[0]!.points).not.toEqual(edges[1]!.points)
      for (const edge of edges) {
        expect(onShapeOutline(nodes[0]!, edge.points[0]!)).toBe(true)
        expect(onShapeOutline(nodes[1]!, edge.points.at(-1)!)).toBe(true)
        for (let index = 1; index < edge.points.length; index++) {
          const a = edge.points[index - 1]!, b = edge.points[index]!
          expect(a.x === b.x || a.y === b.y, `${direction} offset=${offset} mixed=${mixed}`).toBe(true)
        }
      }
    }
  })

  test('a target bucket cannot separate one pair by collapsing another parallel pair', () => {
    const graph = parseMermaid('flowchart BT\nN0-.-N2\nN1-->N2\nN1-->N2\nN0-->N2')
    const positioned = layoutGraphSync(graph)
    expect(positioned.certification?.status).toBe('passed')
    expect(positioned.edges).toHaveLength(4)
    expect(countParallelRouteOverlaps(positioned.edges)).toBe(0)
  })

  test('port-lane centering preserves contacts and route simplicity across placement proposals', () => {
    const pass = LAYOUT_PIPELINE.find(candidate => candidate.id === 'alignPortLanes')!, run = pass.run
    const samples: Array<{ before: ReturnType<typeof measureRubricMetrics>; after: ReturnType<typeof measureRubricMetrics> }> = []
    pass.run = context => {
      const metrics = () => measureRubricMetrics(context.graph, { nodes: context.nodes, edges: context.edges, groups: context.groups, width: 0, height: 0 }, ['portRate', 'bends', 'straight'], context.style, context.bundled)
      const before = metrics(), rollback = run(context)
      samples.push({ before, after: metrics() })
      return rollback
    }
    try {
      const positioned = layoutGraphSync(parseMermaid('flowchart LR\nN2-->N3\nN1-->N2\nN0-->N3\nN0-->N2'))
      expect(positioned.certification?.status).toBe('passed')
      expect(samples.length).toBeGreaterThan(0)
      for (const { before, after } of samples) {
        expect(after.portRate!).toBeGreaterThanOrEqual(before.portRate!)
        expect(after.portRate!).toBeGreaterThanOrEqual(0.25)
        expect(after.bends!).toBeLessThanOrEqual(before.bends!)
        expect(after.straight!).toBeGreaterThanOrEqual(before.straight!)
      }
    } finally { pass.run = run }
  })

  test('canonical contacts can yield when route certification repairs an actual diagonal', () => {
    const graph = parseMermaid('flowchart BT\nN0-->N3\nN3-->N2\nN0-->N2\nN1-->N3\nN0-->N2')
    const positioned = layoutGraphSync(graph)
    expect(positioned.certification?.status).toBe('passed')
    expect(assessLayout(graph, positioned).metrics.diagonalSegments).toBe(0)
  })

  test('an invisible layout edge changing ports cannot degrade the visible-route budget', () => {
    const graph = parseMermaid('flowchart BT\nN0-->N3\nN3~~~N2\nN0-->N2\nN1-->N3\nN0-.-N2')
    const positioned = layoutGraphSync(graph)
    expect(positioned.certification?.status).toBe('passed')
    expect(positioned.edges.find(edge => edge.style === 'invisible')?.points).toHaveLength(2)
  })

  test('canonical contacts may yield to separating actual opposing shared ink', () => {
    const graph = parseMermaid('flowchart LR\nN2-->N3\nN4-->N0\nN2-.-N0\nN0-->N2\nN4-->N1')
    const pass = LAYOUT_PIPELINE.find(candidate => candidate.id === 'applyRouteContracts')!, run = pass.run
    const overlaps: number[] = []
    pass.run = context => { overlaps.push(countOpposingRouteOverlaps(context.edges)); run(context); overlaps.push(countOpposingRouteOverlaps(context.edges)) }
    try {
      const positioned = layoutGraphSync(graph)
      expect(positioned.certification?.status).toBe('passed')
      // The generic bundler no longer admits a junction that lays N4's
      // fan-out elbow along N0->N2, so contracts receive no opposing ink here.
      // N4->N0 then enters N0 on its own lane instead of N0's centre port.
      expect(overlaps).toEqual([0, 0])
      expect(assessLayout(graph, positioned).metrics.portEndpointRate).toBeGreaterThanOrEqual(0.5)
      expect(assessLayout(graph, positioned).metrics.edgeCrossings).toBe(0)
    } finally { pass.run = run }
    // Contracts still own the repair when handed that shared lane: the straight
    // reciprocal gives up its canonical contacts to leave the bundled elbow.
    const box = (id: string, x: number, y: number): PositionedNode => ({ id, label: id, shape: 'rectangle', x, y, width: 60, height: 36.9 })
    const nodes = [box('N2', 40, 95.675), box('N3', 124, 40), box('N4', 40, 163.65), box('N0', 148, 104.9), box('N1', 148, 163.65)]
    const routes: Record<string, [number, number][]> = {
      'N2>N3': [[100, 104.9], [112, 104.9], [112, 58.45], [124, 58.45]],
      'N4>N0': [[100, 182.1], [124, 182.1], [124, 123.35], [148, 123.35]],
      'N2>N0': [[100, 114.125], [148, 114.125]],
      'N0>N2': [[148, 123.35], [100, 123.35]],
      'N4>N1': [[100, 182.1], [124, 182.1], [148, 182.1]],
    }
    const edges: PositionedEdge[] = graph.edges.map((edge, edgeIndex) => ({ ...edge, edgeIndex, points: routes[`${edge.source}>${edge.target}`]!.map(([x, y]) => ({ x, y })) }))
    expect(countOpposingRouteOverlaps(edges)).toBe(1)
    routeContracts.applyRouteContracts({ nodes, edges, groups: [] }, graph, new Set([edges[1]!, edges[4]!]), resolveRenderStyle())
    expect(countOpposingRouteOverlaps(edges)).toBe(0)
  })

  test.each([...simpleFixtures(), ...complicatedFixtures()])('$id', fixture => {
    const positioned = layoutGraphSync(parseMermaid(fixture.source))
    expect(positioned.certification?.status).toBe('passed')
  })
})

describe('runPipeline invariant enforcement', () => {
  interface TestCtx extends PassContextBase {
    log: string[]
    edges?: Array<{ points: Array<{ x: number; y: number }>; labelPosition?: { x: number; y: number }; routeCertificate?: unknown }>
  }
  const mkPass = (over: Partial<LayoutPass<TestCtx>> & { id: string }): LayoutPass<TestCtx> => ({
    doc: '',
    after: [],
    mutates: ['edges'],
    determinism: 'in-place',
    run: c => {
      c.log.push(over.id)
    },
    ...over,
  })
  const moveFirstNode = (c: TestCtx) => {
    const n = c.nodes[0]
    if (n) n.x = 9
  }

  test('captures ordered own budget entries and keeps allowance conditions live', () => {
    const reads: string[] = []
    const budget = { worsenBy: 0, whenImproves: 'bends' as RubricMetric }
    const budgets = Object.create({ hard: 'improve-only' }) as Partial<Record<RubricMetric, MetricBudget>>
    Object.defineProperties(budgets, {
      symErr: { enumerable: true, get: () => { reads.push('symErr'); return budget } },
      bends: { enumerable: true, get: () => { reads.push('bends'); return 'improve-only' } },
    })
    const requested: RubricMetric[][] = []
    const context: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    runPipeline(context, [mkPass({ id: 'live-budget', mayChangeMetrics: budgets, run: c => {
      c.nodes[0]!.x = 1
      budget.worsenBy = 1
      budget.whenImproves = 'crossings'
      budgets.portRate = 'improve-only'
    } })], { measureMetrics: (c, metrics) => {
      requested.push([...metrics])
      return { symErr: c.nodes[0]!.x, bends: 0, crossings: 1 - c.nodes[0]!.x }
    } })
    expect(reads).toEqual(['symErr', 'bends'])
    expect(requested).toEqual([['symErr', 'bends'], ['symErr', 'bends']])
  })

  test('requested arrays belong to one run even if custom measurement mutates them', () => {
    const starts: RubricMetric[][] = []
    const pass = mkPass({ id: 'request-ownership', mayChangeMetrics: { bends: 'improve-only' } })
    for (let run = 0; run < 2; run++) {
      let first = true
      runPipeline({ frozen: false, nodes: [], log: [] }, [pass], { measureMetrics: (_context, metrics) => {
        if (first) {
          starts.push([...metrics])
          const mutable = metrics as RubricMetric[]
          mutable.push('hard')
          first = false
        }
        return { bends: 0, hard: 0 }
      } })
    }
    expect(starts).toEqual([['bends'], ['bends']])
  })

  test('runs passes in array order and honors enabled()', () => {
    const ctx: TestCtx = { frozen: false, nodes: [], log: [] }
    runPipeline(ctx, [mkPass({ id: 'a' }), mkPass({ id: 'b', enabled: () => false }), mkPass({ id: 'c' })])
    expect(ctx.log).toEqual(['a', 'c'])
  })

  test('production ordering rejects an out-of-order `after`', () => {
    const ctx: TestCtx = { frozen: false, nodes: [], log: [] }
    expect(() => runPipeline(ctx, [mkPass({ id: 'b', after: ['a'] }), mkPass({ id: 'a' })])).toThrow(/must run after/)
  })

  test('a positions pass moving a frozen node always fails', () => {
    const ctx: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    expect(() => runPipeline(ctx, [mkPass({ id: 'freeze', freezesNodes: true }), mkPass({ id: 'move', mutates: ['positions'], run: moveFirstNode })])).toThrow(/freeze/)
  })

  test('a whole-graph translate after the freeze is allowed', () => {
    const ctx: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    expect(() => runPipeline(ctx, [mkPass({ id: 'freeze', freezesNodes: true }), mkPass({ id: 'translate', mutates: ['translate'], run: moveFirstNode })])).not.toThrow()
    expect(ctx.nodes[0]!.x).toBe(9)
  })

  test('a post-freeze edge rewrite dropping its certificate always fails', () => {
    const ctx: TestCtx = {
      frozen: false,
      nodes: [],
      edges: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
          routeCertificate: { invariant: 'straight' },
        },
      ],
      log: [],
    }
    expect(() =>
      runPipeline(
        ctx,
        [
          mkPass({ id: 'freeze', freezesNodes: true }),
          mkPass({
            id: 'bad-edge-rewrite',
            mutates: ['edges'],
            run: c => {
              c.edges![0]!.points = [
                { x: 0, y: 0 },
                { x: 5, y: 5 },
                { x: 10, y: 0 },
              ]
              c.edges![0]!.routeCertificate = undefined
            },
          }),
        ],
      ),
    ).toThrow(/routeCertificate/)
  })

  test('a post-freeze edge rewrite reissuing its certificate is allowed', () => {
    const ctx: TestCtx = {
      frozen: false,
      nodes: [],
      edges: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
          routeCertificate: { invariant: 'straight' },
        },
      ],
      log: [],
    }
    expect(() =>
      runPipeline(
        ctx,
        [
          mkPass({ id: 'freeze', freezesNodes: true }),
          mkPass({
            id: 'good-edge-rewrite',
            mutates: ['edges'],
            run: c => {
              c.edges![0]!.points = [
                { x: 0, y: 0 },
                { x: 5, y: 5 },
                { x: 10, y: 0 },
              ]
              c.edges![0]!.routeCertificate = { invariant: 'explained-detour' }
            },
          }),
        ],
      ),
    ).not.toThrow()
    expect(ctx.edges![0]!.points).toEqual([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }])
    expect(ctx.edges![0]!.routeCertificate).toEqual({ invariant: 'explained-detour' })
  })

  test('production rejects node movement even from a pass declaring only edge effects', () => {
    const ctx: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    expect(() => runPipeline(ctx, [mkPass({ id: 'freeze', freezesNodes: true }), mkPass({ id: 'move', mutates: ['edges'], run: moveFirstNode })])).toThrow(/freeze/)
  })

  test('declaring translate does not permit non-uniform node movement', () => {
    const ctx: TestCtx = { frozen: true, nodes: [{ x: 0, y: 0, width: 1, height: 1 }, { x: 10, y: 0, width: 1, height: 1 }], log: [] }
    expect(() => runPipeline(ctx, [mkPass({ id: 'false-translate', mutates: ['translate'], run: moveFirstNode })])).toThrow(/uniform translation/)
  })

  test('a translation must move retained groups, routes and labels with the nodes', () => {
    const ctx: TestCtx = {
      frozen: true, log: [], nodes: [{ x: 0, y: 0, width: 1, height: 1 }],
      groups: [{ id: 'parent', x: -2, y: -2, width: 5, height: 5 }],
      edges: [{ points: [{ x: 1, y: 0 }, { x: 10, y: 0 }], labelPosition: { x: 5, y: 0 }, routeCertificate: {} }],
    }
    expect(() => runPipeline(ctx, [mkPass({ id: 'leaves-group-behind', mutates: ['translate'], run: moveFirstNode })])).toThrow(/uniform translation/)
    ctx.nodes[0]!.x = 0
    expect(() => runPipeline(ctx, [mkPass({ id: 'complete-translate', mutates: ['translate'], run: c => {
      c.nodes[0]!.x += 9
      c.groups![0]!.x += 9
      for (const point of c.edges![0]!.points) point.x += 9
      c.edges![0]!.labelPosition!.x += 9
    } })])).not.toThrow()
  })

  test('an existing certificate is stale after a post-freeze route rewrite', () => {
    const ctx: TestCtx = { frozen: true, nodes: [], log: [], edges: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], routeCertificate: { invariant: 'straight' } }] }
    expect(() => runPipeline(ctx, [mkPass({ id: 'stale-certificate', run: c => { c.edges![0]!.points.splice(1, 0, { x: 5, y: 5 }) } })])).toThrow(/re-issuing routeCertificate/)
  })

  test('onAfterPass fires only for passes that actually ran', () => {
    const ctx: TestCtx = { frozen: false, nodes: [], log: [] }
    const fired: string[] = []
    runPipeline(ctx, [mkPass({ id: 'a' }), mkPass({ id: 'skip', enabled: () => false }), mkPass({ id: 'b' })], {
      onAfterPass: p => {
        fired.push(p.id)
      },
    })
    expect(fired).toEqual(['a', 'b'])
  })

  test('a geometry pass cannot silently exceed its bend allowance', () => {
    const ctx: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    expect(() =>
      runPipeline(
        ctx,
        [
          mkPass({
            id: 'reroute',
            mayChangeMetrics: { bends: { worsenBy: 2 } },
            run: moveFirstNode,
          }),
        ],
        { measureMetrics: c => ({ bends: c.nodes[0]!.x }) },
      ),
    ).toThrow(/reroute.*bends.*allowance 2/)
  })

  test('a losing cosmetic proposal restores its owned geometry before dependent passes', () => {
    const node = { x: 0, y: 0, width: 1, height: 1 }
    const ctx: TestCtx = { frozen: false, nodes: [node], log: [] }
    const executions: string[] = []
    runPipeline(ctx, [mkPass({ id: 'proposal', proposal: true, mayChangeMetrics: { symErr: 'improve-only' }, run: c => {
      executions.push('proposal')
      const x = c.nodes[0]!.x
      c.nodes[0]!.x = 9
      return () => { executions.push('rollback'); c.nodes[0]!.x = x }
    } }), mkPass({ id: 'dependent', after: ['proposal'], run: c => { executions.push('dependent'); expect(c.nodes[0]).toBe(node); expect(node.x).toBe(0) } })], {
      measureMetrics: c => ({ symErr: c.nodes[0]!.x, hard: 0 }),
    })
    expect(executions).toEqual(['proposal', 'rollback', 'dependent'])
    expect(ctx.nodes[0]).toBe(node)
    expect(node.x).toBe(0)
  })

  test.each(['hard', 'freeze', 'measurement'] as const)('a cosmetic rollback cannot conceal a %s failure', kind => {
    const ctx: TestCtx = { frozen: kind === 'freeze', nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    let restored = false
    const pass = mkPass({ id: 'invalid', proposal: true, mayChangeMetrics: { [kind === 'hard' ? 'hard' : 'symErr']: 'improve-only' }, run: c => {
      c.nodes[0]!.x = 9
      return () => { restored = true; c.nodes[0]!.x = 0 }
    } })
    expect(() => runPipeline(ctx, [pass], { measureMetrics: c => kind === 'measurement' ? { symErr: Number.NaN } : { hard: c.nodes[0]!.x, symErr: c.nodes[0]!.x } })).toThrow()
    expect(restored).toBe(false)
  })

  test.each([9, 2])('an incomplete cosmetic rollback cannot leave symmetry at %s', restored => {
    const ctx: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    const proposal = mkPass({ id: 'incomplete', proposal: true, mayChangeMetrics: { symErr: 'improve-only' }, run: c => {
      c.nodes[0]!.x = 9
      return () => { c.nodes[0]!.x = restored }
    } })
    expect(() => runPipeline(ctx, [proposal], { measureMetrics: c => ({ symErr: c.nodes[0]!.x, hard: 0 }) }))
      .toThrow(LayoutMetricBudgetError)
  })

  test('a cosmetic rollback cannot introduce an undeclared hard regression', () => {
    const ctx: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [], edges: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }] }
    const proposal = mkPass({ id: 'invalid-restore', proposal: true, mayChangeMetrics: { symErr: 'improve-only' }, run: c => {
      c.edges![0]!.points[1]!.y = 1
      return () => { c.edges![0]!.points[1]!.y = 0; c.nodes[0]!.x = 99 }
    } })
    expect(() => runPipeline(ctx, [proposal], { measureMetrics: c => ({ symErr: c.edges![0]!.points[1]!.y, hard: c.nodes[0]!.x }) }))
      .toThrow(/invalid-restore.*hard.*99/)
  })

  test('a cosmetic rollback cannot invalidate frozen geometry after repairing its score', () => {
    const ctx: TestCtx = { frozen: true, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [], edges: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], routeCertificate: {} }] }
    const proposal = mkPass({ id: 'invalid-restore', proposal: true, mayChangeMetrics: { symErr: 'improve-only' }, run: c => {
      c.edges![0]!.points[1]!.y = 1
      c.edges![0]!.routeCertificate = {}
      return () => { c.edges![0]!.points[1]!.y = 0; c.nodes[0]!.x = 99 }
    } })
    expect(() => runPipeline(ctx, [proposal], { measureMetrics: c => ({ symErr: c.edges![0]!.points[1]!.y, hard: 0 }) }))
      .toThrow(/invalid-restore.*frozen geometry/)
  })

  test('a cosmetic rollback cannot leave a stale frozen route certificate', () => {
    const ctx: TestCtx = { frozen: true, nodes: [], log: [], edges: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], labelPosition: { x: 0.5, y: 0 }, routeCertificate: {} }] }
    const proposal = mkPass({ id: 'invalid-restore', proposal: true, mayChangeMetrics: { symErr: 'improve-only' }, run: c => {
      c.edges![0]!.labelPosition!.y = 1
      return () => { c.edges![0]!.labelPosition!.y = 0; c.edges![0]!.points[1]!.y = 2 }
    } })
    expect(() => runPipeline(ctx, [proposal], { measureMetrics: c => ({ symErr: c.edges![0]!.labelPosition!.y, hard: 0 }) }))
      .toThrow(/re-issuing routeCertificate/)
  })

  test('returning a rollback requires an explicit cosmetic proposal contract', () => {
    const ctx: TestCtx = { frozen: false, nodes: [], log: [] }
    expect(() => runPipeline(ctx, [mkPass({ id: 'undeclared', run: () => () => {} })]))
      .toThrow(/without declaring a cosmetic proposal/)
  })

  test('a cosmetic rollback cannot replace a finite score with a non-finite one', () => {
    const ctx: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    const proposal = mkPass({ id: 'invalid-restore', proposal: true, mayChangeMetrics: { symErr: 'improve-only' }, run: c => {
      c.nodes[0]!.x = 9
      return () => { c.nodes[0]!.x = Number.NaN }
    } })
    expect(() => runPipeline(ctx, [proposal], { measureMetrics: c => ({ symErr: c.nodes[0]!.x, hard: 0 }) }))
      .toThrow(/no finite measurement/)
  })

  test('rate improvements are allowed and a missing measurement fails closed', () => {
    const ctx: TestCtx = { frozen: false, nodes: [{ x: 0, y: 0, width: 1, height: 1 }], log: [] }
    const pass = mkPass({
      id: 'attach',
      mayChangeMetrics: { portRate: 'improve-only' },
      run: c => {
        c.nodes[0]!.x = 1
      },
    })
    expect(() => runPipeline(ctx, [pass], { measureMetrics: c => ({ portRate: c.nodes[0]!.x }) })).not.toThrow()
    expect(() => runPipeline(ctx, [pass])).toThrow(/no geometry measurement/)
  })

  test('ports may yield to fewer bends only when the higher-priority metric improves', () => {
    const make = (): TestCtx => ({ frozen: false, nodes: [{ x: 1, y: 2, width: 1, height: 1 }], log: [] })
    const measureMetrics = (c: TestCtx) => ({ portRate: c.nodes[0]!.x, bends: c.nodes[0]!.y })
    const pass = (removeBends: boolean) =>
      mkPass({
        id: 'straighten',
        mayChangeMetrics: { portRate: { worsenBy: 1, whenImproves: 'bends' } },
        run: c => {
          c.nodes[0]!.x = 0
          if (removeBends) c.nodes[0]!.y = 0
        },
      })
    expect(() => runPipeline(make(), [pass(true)], { measureMetrics })).not.toThrow()
    expect(() => runPipeline(make(), [pass(false)], { measureMetrics })).toThrow(/straighten.*portRate/)
  })

  test('each extra crossing needs a separately repaired parallel overlap, rather than bend reduction', () => {
    const make = (): TestCtx => ({ frozen: false, nodes: [{ x: 0, y: 2, width: 5, height: 1 }], log: [] })
    const measureMetrics = (context: TestCtx) => ({ crossings: context.nodes[0]!.x, parallelOverlaps: context.nodes[0]!.y, bends: context.nodes[0]!.width })
    const pass = (crossings: number, overlaps: number) => mkPass({ id: 'separate', mayChangeMetrics: { crossings: { worsenBy: 1, whenImproves: 'parallelOverlaps', perImprovement: true } }, run: c => { c.nodes[0]!.x = crossings; c.nodes[0]!.y = overlaps; c.nodes[0]!.width = 0 } })
    expect(() => runPipeline(make(), [pass(2, 0)], { measureMetrics })).not.toThrow()
    expect(() => runPipeline(make(), [pass(2, 1)], { measureMetrics })).toThrow(/crossings.*allowance 1/)
    expect(() => runPipeline(make(), [pass(1, 2)], { measureMetrics })).toThrow(/crossings.*allowance 0/)
  })
})

describe('requested production budget metrics', () => {
  test('parallel ambiguity measures shared route spans rather than nearby endpoints', () => {
    const graph = parseMermaid('flowchart LR\nA-->B\nA-->B')
    const close = graph.edges.map((edge, index) => ({ ...edge, points: [{ x: 0, y: index }, { x: 20, y: index }] }))
    expect(countParallelRouteOverlaps(close)).toBe(0)
    close[0]!.points = [{ x: 0, y: -10 }, { x: 5, y: -10 }, { x: 5, y: 0 }, { x: 15, y: 0 }, { x: 15, y: -10 }, { x: 20, y: -10 }]
    close[1]!.points = [{ x: 0, y: 10 }, { x: 5, y: 10 }, { x: 5, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 10 }, { x: 20, y: 10 }]
    expect(countParallelRouteOverlaps(close)).toBe(1)
  })
  test('early bend measurement does not run later endpoint, label or collision certification', () => {
    const graph = parseMermaid('flowchart LR\nA --> B')
    const positioned: PositionedGraph = { width: 0, height: 0, groups: [], nodes: [{ ...graph.nodes.get('A')!, x: 0, y: 0, width: 10, height: 10 }], edges: [{ ...graph.edges[0]!, points: [] }] }
    expect(measureRubricMetrics(graph, positioned, ['bends', 'straight'], resolveRenderStyle({}))).toEqual({ bends: 0, straight: 0 })
  })

  test('crossing measurement counts proper intersections once, excluding endpoints and an edge crossing itself', () => {
    const graph = parseMermaid('flowchart LR\nA-->B\nC-->D\nE-->F')
    const positioned: PositionedGraph = { width: 100, height: 100, nodes: [], groups: [], edges: [
      { ...graph.edges[0]!, points: [{ x: 0, y: 5 }, { x: 10, y: 5 }] },
      { ...graph.edges[1]!, points: [{ x: 5, y: 0 }, { x: 5, y: 10 }] },
      { ...graph.edges[2]!, points: [{ x: 20, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 0 }] },
    ] }
    expect(measureRubricMetrics(graph, positioned, ['crossings'], resolveRenderStyle({}))).toEqual({ crossings: 1 })
    positioned.edges.push({ ...graph.edges[0]!, points: [{ x: 10, y: 5 }, { x: 15, y: 0 }] })
    expect(measureRubricMetrics(graph, positioned, ['crossings'], resolveRenderStyle({}))).toEqual({ crossings: 1 })
  })
})
