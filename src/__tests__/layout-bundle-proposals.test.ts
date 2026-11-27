import { renderMermaidSVGWithReceipt } from '../index.ts'
import { scanSvgStartTags } from '../svg-structure.ts'
import { describe, expect, test } from 'bun:test'
import { LAYOUT_PIPELINE, layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { withRenderStageObserver } from '../render-stages.ts'
import { assessLayout, hardViolations } from '../layout-rubric.ts'
import { bundleEdgePaths } from '../layout/passes/edge-bundling.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { Point, PositionedEdge, PositionedNode } from '../types.ts'
import { flowchartMesh } from '../../eval/shared/graph-fixtures.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

  test.each((['TB', 'BT', 'LR', 'RL'] as const).flatMap(direction =>
    (['plain', 'caption', 'colour', 'width', 'classes', 'marker', 'no-heads'] as const).map(paint => ({ direction, paint }))))('preserves duplicate occurrence lanes beside shared fan trunks: $direction $paint', ({ direction, paint }) => {
    const project = (x: number, y: number) => direction === 'LR' ? { x: y, y: x }
      : direction === 'RL' ? { x: 400 - y, y: x }
        : direction === 'BT' ? { x, y: 400 - y } : { x, y }
    for (const fanIn of [false, true]) {
      const nodes: PositionedNode[] = [
        { id: 'A', label: 'A', shape: 'rectangle', x: 100, y: fanIn ? 160 : 0, width: 40, height: 40 },
        ...['B', 'C', 'D'].map((id, i): PositionedNode => ({ id, label: id, shape: 'rectangle', x: i * 100, y: fanIn ? 0 : 160, width: 40, height: 40 })),
      ]
      const edges: PositionedEdge[] = ['B', 'B', 'C', 'D'].map((id, i) => {
        const a = nodes[0]!, b = nodes.find(node => node.id === id)!
        const top = fanIn ? b : a, bottom = fanIn ? a : b
        // Both duplicate lanes stay on the side away from the fan's trunk, so
        // bundling the fan crosses neither of them.
        const lane = i === 0 ? 10 : i === 1 ? 4 : 30
        const sx = top.x + lane, tx = bottom.x + lane
        return { source: top.id, target: bottom.id, edgeIndex: i,
          points: [{ x: sx, y: top.y + 40 }, { x: sx, y: 75 + i * 10 }, { x: tx, y: 75 + i * 10 }, { x: tx, y: bottom.y }].map(p => project(p.x, p.y)),
          style: 'solid', hasArrowStart: false, hasArrowEnd: true }
      })
      if (paint === 'caption') edges[0]!.label = 'private caption'
      if (paint === 'colour') { edges[2]!.inlineStyle = { stroke: '#f00' }; edges[3]!.inlineStyle = { stroke: '#00f' } }
      if (paint === 'width') { edges[2]!.inlineStyle = { 'stroke-width': 'var(--first)' }; edges[3]!.inlineStyle = { 'stroke-width': 'var(--second)' } }
      if (paint === 'classes') { edges[2]!.classNames = ['first']; edges[3]!.classNames = ['second'] }
      if (paint === 'marker') {
        if (fanIn) edges[2]!.endMarker = 'circle'
        else edges[2]!.hasArrowStart = true
      }
      if (paint === 'no-heads') for (const edge of edges) edge.hasArrowEnd = false
      for (const node of nodes) {
        const a = project(node.x, node.y), b = project(node.x + 40, node.y + 40)
        node.x = Math.min(a.x, b.x); node.y = Math.min(a.y, b.y)
      }
      const duplicatePaths = edges.slice(0, 2).map(edge => edge.points)
      const bundled = bundleEdgePaths(edges, nodes, [], direction, resolveRenderStyle())
      expect(edges[0]!.points).toBe(duplicatePaths[0]!)
      expect(edges[1]!.points).toBe(duplicatePaths[1]!)
      expect(edges[0]!.points).not.toEqual(edges[1]!.points)
      expect([...bundled]).toEqual(paint === 'plain' || paint === 'no-heads' ? edges.slice(2) : [])
      expect(edges.map(edge => [edge.edgeIndex, edge.source, edge.target])).toEqual(
        ['B', 'B', 'C', 'D'].map((id, i) => [i, fanIn ? id : 'A', fanIn ? 'A' : id]))
    }
  })

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

  test.each([false, true])('a fan keeps its separate routes when the trunk would cross a foreign shaft they avoid (foreign=%s)', foreign => {
    const box = (id: string, x: number, y: number): PositionedNode => ({ id, label: id, shape: 'rectangle', x, y, width: 40, height: 20 })
    const nodes = [box('A', 40, 0), box('B', 40, 120), box('C', 240, 120), box('F', 140, 30), box('G', 140, 100)]
    const edge = (source: string, target: string, points: Array<{ x: number; y: number }>): PositionedEdge => ({ source, target, points, style: 'solid', hasArrowStart: false, hasArrowEnd: true })
    // A -> C leaves above F; the bundled trunk would run between F and G.
    // It already has the trunk's two bends, so the crossing is the only cost.
    const fan = [edge('A', 'B', [{ x: 60, y: 20 }, { x: 60, y: 120 }]), edge('A', 'C', [{ x: 60, y: 20 }, { x: 60, y: 24 }, { x: 260, y: 24 }, { x: 260, y: 120 }])]
    const edges = foreign ? [...fan, edge('F', 'G', [{ x: 160, y: 50 }, { x: 160, y: 100 }])] : fan
    const before = fan.map(e => e.points)
    const bundled = bundleEdgePaths(edges, nodes, [], 'TB', resolveRenderStyle())
    expect(bundled.size).toBe(foreign ? 0 : 2)
    if (foreign) fan.forEach((e, i) => expect(e.points).toBe(before[i]!))
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
    let unbundledRuns = 0
    first.run = context => { if (!context.mergeEdges) unbundledRuns++; run(context) }
    let selected: ReturnType<typeof layoutGraphSync>
    try { selected = layoutGraphSync(graph) } finally { first.run = run }
    const assessment = assessLayout(graph, selected)
    expect(hardViolations(assessment)).toEqual([])
    expect(assessment.metrics.edgeCrossings).toBeLessThanOrEqual(fixture.maxCrossings)
    expect(assessment.metrics.labelConflicts).toBeLessThanOrEqual(fixture.maxLabelConflicts)
    expect(unbundledRuns).toBe(0)
    expect(selected.nodes.map(node => [node.id, node.label]).sort()).toEqual(
      [...graph.nodes.values()].map(node => [node.id, node.label]).sort())
    expect(selected.edges.map(edge => [edge.edgeIndex, edge.source, edge.target, edge.label, edge.style, edge.hasArrowStart, edge.hasArrowEnd])).toEqual(
      graph.edges.map((edge, index) => [index, edge.source, edge.target, edge.label, edge.style, edge.hasArrowStart, edge.hasArrowEnd]))
    expect(selected.certification?.preference.selectedScore).toMatchObject({
      edgeCrossings: assessment.metrics.edgeCrossings, labelConflicts: assessment.metrics.labelConflicts,
    })
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

  test('each certified placement runs the route pipeline once, bundled', () => {
    const first = LAYOUT_PIPELINE[0]!, run = first.run
    const pipelines: Array<{ elkResult: unknown; bundled: boolean }> = []
    first.run = context => { pipelines.push({ elkResult: context.elkResult, bundled: context.mergeEdges }); run(context) }
    try {
      const selected = layoutGraphSync(parseMermaid(source))
      expect(pipelines.every(pipeline => pipeline.bundled)).toBe(true)
      expect(pipelines).toHaveLength(selected.certification!.attempts)
      expect(new Set(pipelines.map(pipeline => pipeline.elkResult)).size).toBe(pipelines.length)
    } finally {
      first.run = run
    }
  })
})

// lukilabs/beautiful-mermaid#68: two fan-in groups feeding different targets.
// Each group may merge into a trunk of its own; no run of one group's routes
// may lie on a run of the other's, or the two trunks read as one.
test('two fan-in groups into different targets keep their trunks apart', () => {
  const positioned = layoutGraphSync(parseMermaid(readFileSync(join(import.meta.dir, '../../eval/layout-compare/fixtures/beautiful-mermaid-68-fan-in-groups.mmd'), 'utf8')))
  const runs = (target: string) => positioned.edges.filter(edge => edge.target === target).flatMap(edge => edge.points.slice(1).map((b, i) => [edge.points[i]!, b] as const))
  const shared = (p: readonly [Point, Point], q: readonly [Point, Point]): boolean => {
    const axis = p[0].x === p[1].x && q[0].x === q[1].x && p[0].x === q[0].x ? 'y' : p[0].y === p[1].y && q[0].y === q[1].y && p[0].y === q[0].y ? 'x' : undefined
    if (!axis) return false
    return Math.min(Math.max(p[0][axis], p[1][axis]), Math.max(q[0][axis], q[1][axis])) - Math.max(Math.min(p[0][axis], p[1][axis]), Math.min(q[0][axis], q[1][axis])) > 0.5
  }
  expect(runs('A').length * runs('B').length).toBeGreaterThan(0)
  expect(runs('A').filter(p => runs('B').some(q => shared(p, q)))).toEqual([])
})

// Fork issues where a published trunk cost the drawing something the proper
// crossing count cannot see. lukilabs/beautiful-mermaid#52: an arrival left
// the shared arrowhead of a bundle by 1.7px, so two arrowheads overlapped.
// obsidianmd/pele#100: a trunk ran 0.2px beside an unrelated edge, so the two
// read as one bus. mermaid-js/mermaid#6476: members that ran straight bought
// two bends each to join their trunks.
describe('a trunk never costs contact or bends', () => {
  const layoutOf = (name: string) => layoutGraphSync(parseMermaid(readFileSync(join(import.meta.dir, `../../eval/layout-compare/fixtures/${name}.mmd`), 'utf8')))
  const visible = (edges: readonly PositionedEdge[]) => edges.filter(edge => edge.style !== 'invisible' && edge.source !== edge.target)
  const segments = (edge: PositionedEdge) => edge.points.slice(1).map((b, i) => [edge.points[i]!, b] as const)
  const toSegment = (p: Point, [a, b]: readonly [Point, Point]) => {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy
    const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
  }
  /** Pairs of edges with no endpoint in common whose ink runs alongside
   * within 4px, or where a bend or end of one lies within 1px of the other. */
  const unrelatedContact = (edges: readonly PositionedEdge[]): string[] => {
    const found: string[] = []
    const routes = visible(edges)
    for (const a of routes) for (const b of routes) {
      if (a === b || [a.source, a.target].some(node => node === b.source || node === b.target)) continue
      const alongside = segments(a).some(([p, q]) => segments(b).some(([r, s]) => {
        const axis = p.x === q.x && r.x === s.x ? 'y' : p.y === q.y && r.y === s.y ? 'x' : undefined
        if (!axis) return false
        const across = axis === 'y' ? 'x' : 'y'
        const overlap = Math.min(Math.max(p[axis], q[axis]), Math.max(r[axis], s[axis])) - Math.max(Math.min(p[axis], q[axis]), Math.min(r[axis], s[axis]))
        return Math.abs(p[across] - r[across]) < 4 && overlap > 0.5
      }))
      const touching = a.points.some(point => segments(b).some(segment => toSegment(point, segment) < 1))
      if (alongside || touching) found.push(`${a.source}->${a.target} / ${b.source}->${b.target}`)
    }
    return found
  }
  /** Arrivals at one node whose arrowheads overlap: closer than an arrowhead's
   * height (5px at the default stroke) plus a stroke, without sharing a point.
   * (pele-100's t20 seats eight native arrivals 6.7px apart: they do not
   * overlap, though they are tighter than the 7px a planned slot keeps.) */
  const nearArrivals = (edges: readonly PositionedEdge[]): string[] => {
    const routes = visible(edges).filter(edge => edge.hasArrowEnd)
    return routes.flatMap((a, i) => routes.slice(i + 1).filter(b => {
      if (a.target !== b.target) return false
      const gap = Math.hypot(a.points.at(-1)!.x - b.points.at(-1)!.x, a.points.at(-1)!.y - b.points.at(-1)!.y)
      return gap > 0.01 && gap < 6
    }).map(b => `${a.source}->${a.target} / ${b.source}->${b.target}`))
  }

  test.each(['beautiful-mermaid-52', 'pele-100'])('%s: no unrelated edges touch and no arrivals overlap', name => {
    const positioned = layoutOf(name)
    expect(unrelatedContact(positioned.edges)).toEqual([])
    expect(nearArrivals(positioned.edges)).toEqual([])
  })

  // a3, a9 and TQBb face their trunk's port across the flow.
  test.each([
    { name: 'mermaid-6476', straight: [['a3', 'a4'], ['a5', 'a9']] },
    { name: 'beautiful-mermaid-52', straight: [['TQBb8DjbT21GBpd5bWTaAsPzhihMpKXotb', 'TL8TBpubVzBr1UWPXBXU8Pci5ZAip9SwEf']] },
  ])('$name: fan members that can run straight keep straight routes', ({ name, straight }) => {
    const positioned = layoutOf(name)
    const route = (source: string, target: string) => positioned.edges.find(edge => edge.source === source && edge.target === target)!.points
    for (const [source, target] of straight) expect([source, target, route(source!, target!).length]).toEqual([source, target, 2])
    expect(nearArrivals(positioned.edges)).toEqual([])
  })
})
