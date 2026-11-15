// The Tier 3 compactness lint (src/layout/compactness.ts): EDGE_RANK_SLACK and
// EDGE_UNDER_GROUP_TITLE over hand-built geometry, its metamorphic
// properties, and verify reporting what the module finds.

import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { compactnessFindings, type CompactnessEdge, type CompactnessGeometry, type CompactnessGroup, type CompactnessNode } from '../layout/compactness.ts'
import { verifyMermaid } from '../agent/index.ts'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { positionFamilyArtifact } from '../agent/family-layouts.ts'
import { positionedEdgeWarningIds } from '../shared/edge-selectors.ts'
import type { Direction, MermaidGraph, PositionedGraph, PositionedGroup } from '../types.ts'

// Rows are flow-axis layers 100px apart; nodes are 120x60 in TB.
const box = (id: string, row: number, column: number): CompactnessNode => ({ id, x: column * 150, y: row * 100, w: 120, h: 60 })
const centre = (node: CompactnessNode): [number, number] => [node.x + node.w / 2, node.y + node.h / 2]
const link = (nodes: readonly CompactnessNode[], from: string, to: string, extra: Partial<CompactnessEdge> = {}): CompactnessEdge => ({
  id: `${from}->${to}`,
  from,
  to,
  path: [centre(nodes.find(node => node.id === from)!), centre(nodes.find(node => node.id === to)!)],
  ...extra,
})
const transpose = ({ nodes, edges, groups }: CompactnessGeometry): CompactnessGeometry => ({
  nodes: nodes.map(node => ({ id: node.id, x: node.y, y: node.x, w: node.h, h: node.w })),
  edges: edges.map(edge => ({ ...edge, path: edge.path.map(([x, y]) => [y, x] as const) })),
  groups,
})
const flipY = ({ nodes, edges, groups }: CompactnessGeometry): CompactnessGeometry => ({
  nodes: nodes.map(node => ({ ...node, y: 400 - node.y - node.h })),
  edges: edges.map(edge => ({ ...edge, path: edge.path.map(([x, y]) => [x, 400 - y] as const) })),
  groups,
})

// A -> B -> C -> E fills layers 0..3; S hangs off A alone, three layers down.
const chain = [box('A', 0, 0), box('B', 1, 0), box('C', 2, 0), box('E', 3, 0), box('S', 3, 1)]
const chainEdges = [link(chain, 'A', 'B'), link(chain, 'B', 'C'), link(chain, 'C', 'E')]
const pushedSink: CompactnessGeometry = { nodes: chain, edges: [...chainEdges, link(chain, 'A', 'S')], groups: [] }
const sinkFinding = { edge: 'A->S', from: 'A', to: 'S', spannedLayers: 2, requiredLayers: 0 }
const detour = [...chain, box('P', 1, 1), box('Q', 2, 1)]

// Group G spans x 0..300 from y 0 with a 28px title band; its first member M
// starts at y 80, so the strip below the title is y 28..80.
const member: CompactnessNode = { id: 'M', x: 100, y: 80, w: 100, h: 40 }
const outside: CompactnessNode = { id: 'O', x: -200, y: 24, w: 100, h: 40 }
const titled: CompactnessGroup = { id: 'G', x: 0, y: 0, w: 300, h: 200, members: ['M'], headerHeight: 28 }
const strip = (path: [number, number][]): CompactnessGeometry => ({ nodes: [outside, member], edges: [{ id: 'O->M', from: 'O', to: 'M', path }], groups: [titled] })
// Nested: G holds only child group K (y 60, 28px band) whose member N starts at y 100.
const nested: CompactnessGeometry = {
  nodes: [outside, { id: 'N', x: 100, y: 100, w: 100, h: 40 }],
  edges: [
    { id: 'O->N', from: 'O', to: 'N', path: [[-100, 44], [150, 44], [150, 100]] },
    { id: 'O->N#1', from: 'O', to: 'N', path: [[-100, 92], [150, 92], [150, 100]] },
    { id: 'O->N#2', from: 'O', to: 'N', path: [[-100, 70], [150, 70], [150, 100]] },
  ],
  groups: [
    { id: 'G', x: 0, y: 0, w: 300, h: 200, members: [], headerHeight: 28 },
    { id: 'K', x: 50, y: 60, w: 200, h: 120, members: ['N'], parentId: 'G', headerHeight: 28 },
  ],
}

describe('compactnessFindings', () => {
  const cases: Array<{ name: string; geometry: CompactnessGeometry; direction?: Direction; rankSlack?: object[]; titleStripRoutes?: object[] }> = [
    { name: 'a sink two layers below its only predecessor has slack 2', geometry: pushedSink, direction: 'TB', rankSlack: [sinkFinding] },
    {
      name: 'an alternative three-step path to the sink needs those layers',
      geometry: { nodes: detour, edges: [...pushedSink.edges, link(detour, 'A', 'P'), link(detour, 'P', 'Q'), link(detour, 'Q', 'S')], groups: [] },
      direction: 'TB',
    },
    { name: 'a back edge is ignored', geometry: { ...pushedSink, edges: [...pushedSink.edges, link(chain, 'E', 'A')] }, direction: 'TB', rankSlack: [sinkFinding] },
    { name: 'the LR mirror reports the same slack', geometry: transpose(pushedSink), direction: 'LR', rankSlack: [sinkFinding] },
    { name: 'the BT mirror reports the same slack', geometry: flipY(pushedSink), direction: 'BT', rankSlack: [sinkFinding] },
    { name: 'TB geometry read as BT has every edge backwards', geometry: pushedSink, direction: 'BT' },
    { name: 'an authored long link asks for its layers', geometry: { ...pushedSink, edges: [...chainEdges, link(chain, 'A', 'S', { length: 3 })] }, direction: 'TB' },
    { name: 'an invisible link is not reported', geometry: { ...pushedSink, edges: [...chainEdges, link(chain, 'A', 'S', { visibility: 'hidden' })] }, direction: 'TB' },
    { name: 'without a direction rank slack is not checked', geometry: pushedSink },
    {
      name: 'a horizontal segment 16px under the title, above the first member, is reported',
      geometry: strip([[-100, 44], [150, 44], [150, 80]]),
      titleStripRoutes: [{ edge: 'O->M', from: 'O', to: 'M', group: 'G', clearancePx: 16 }],
    },
    { name: 'a segment below the first member’s top is not', geometry: strip([[-100, 90], [100, 90]]) },
    { name: 'a vertical entry through the strip is not', geometry: strip([[150, -50], [150, 80]]) },
    { name: 'a segment in the title band itself belongs to certification', geometry: strip([[-100, 20], [150, 20], [150, 80]]) },
    { name: 'a segment overlapping the group by less than 8px is not', geometry: strip([[-100, 44], [5, 44]]) },
    { name: 'an empty titled group has no title strip', geometry: { ...strip([[-100, 44], [150, 44], [150, 80]]), groups: [{ ...titled, members: [] }] } },
    { name: 'an untitled group has no title strip', geometry: { ...strip([[-100, 44], [150, 44], [150, 80]]), groups: [{ ...titled, headerHeight: 0 }] } },
    {
      name: 'a nested child group counts as the first member',
      geometry: nested,
      titleStripRoutes: [
        { edge: 'O->N', from: 'O', to: 'N', group: 'G', clearancePx: 16 },
        { edge: 'O->N#1', from: 'O', to: 'N', group: 'K', clearancePx: 4 },
      ],
    },
  ]
  for (const { name, geometry, direction, rankSlack = [], titleStripRoutes = [] } of cases) {
    it(name, () => {
      expect(compactnessFindings(geometry, direction)).toEqual({ rankSlack, titleStripRoutes } as never)
    })
  }

  // Layered DAGs on a 10px grid: every edge runs from a lower row to a higher
  // one, nodes sit at (row, column), and one titled group covers a grid
  // rectangle. Grid coordinates keep every threshold comparison exact under
  // integer scaling.
  const directions = ['TB', 'BT', 'LR', 'RL'] as const
  const place = (direction: Direction, row: number, column: number): Omit<CompactnessNode, 'id'> => {
    const flow = direction === 'BT' || direction === 'RL' ? (8 - row) * 100 : row * 100
    return direction === 'LR' || direction === 'RL' ? { x: flow, y: column * 150, w: 60, h: 120 } : { x: column * 150, y: flow, w: 120, h: 60 }
  }
  const scene = fc
    .record({
      direction: fc.constantFrom(...directions),
      rows: fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 2, maxLength: 9 }),
      picks: fc.array(fc.tuple(fc.nat(), fc.nat(), fc.integer({ min: 0, max: 60 }), fc.constantFrom(1, 1, 2)), { maxLength: 16 }),
      group: fc.record({ x: fc.integer({ min: -20, max: 60 }), y: fc.integer({ min: -20, max: 60 }), w: fc.integer({ min: 1, max: 80 }), h: fc.integer({ min: 1, max: 80 }), header: fc.integer({ min: 1, max: 6 }) }),
      members: fc.array(fc.boolean(), { minLength: 9, maxLength: 9 }),
    })
    .map(({ direction, rows, picks, group, members }) => {
      const nodes = rows.map((row, column) => ({ id: `n${column}`, ...place(direction, row, column) }))
      const edges: CompactnessEdge[] = []
      for (const [a, b, bend, length] of picks) {
        const u = a % nodes.length, v = b % nodes.length
        if (rows[u]! >= rows[v]!) continue
        const [sx, sy] = centre(nodes[u]!), [tx, ty] = centre(nodes[v]!)
        edges.push({ id: `n${u}->n${v}#${edges.length}`, from: `n${u}`, to: `n${v}`, length, path: [[sx, sy], [sx, bend * 10], [tx, bend * 10], [tx, ty]] })
      }
      const titled: CompactnessGroup = { id: 'G', x: group.x * 10, y: group.y * 10, w: group.w * 10, h: group.h * 10, headerHeight: group.header * 10, members: nodes.filter((_, index) => members[index]).map(node => node.id) }
      return { direction, rows, geometry: { nodes, edges, groups: [titled] } as CompactnessGeometry }
    })

  it('uniform integer scaling and translation leave the findings unchanged', () => {
    fc.assert(
      fc.property(scene, fc.integer({ min: 1, max: 4 }), fc.integer({ min: -500, max: 500 }), fc.integer({ min: -500, max: 500 }), ({ direction, geometry }, k, dx, dy) => {
        const moved: CompactnessGeometry = {
          nodes: geometry.nodes.map(node => ({ id: node.id, x: node.x * k + dx, y: node.y * k + dy, w: node.w * k, h: node.h * k })),
          edges: geometry.edges.map(edge => ({ ...edge, path: edge.path.map(([x, y]) => [x * k + dx, y * k + dy] as const) })),
          groups: geometry.groups.map(group => ({ ...group, x: group.x * k + dx, y: group.y * k + dy, w: group.w * k, h: group.h * k, headerHeight: group.headerHeight * k })),
        }
        const before = compactnessFindings(geometry, direction)
        const after = compactnessFindings(moved, direction)
        expect(after.rankSlack).toEqual(before.rankSlack)
        expect(after.titleStripRoutes).toEqual(before.titleStripRoutes.map(finding => ({ ...finding, clearancePx: finding.clearancePx * k })))
      }),
      fcParameters({ numRuns: 500 }),
    )
  })

  it('pushing a sink further along the flow never decreases the slack of its in-edges', () => {
    fc.assert(
      fc.property(scene, fc.nat(), fc.integer({ min: 1, max: 3 }), ({ direction, rows, geometry }, pick, push) => {
        const sinks = geometry.nodes.filter(node => !geometry.edges.some(edge => edge.from === node.id))
        const sink = sinks[pick % sinks.length]!
        const column = geometry.nodes.indexOf(sink)
        const pushed = { id: sink.id, ...place(direction, rows[column]! + push, column) }
        const nodes = geometry.nodes.map(node => (node === sink ? pushed : node))
        const into = (findings: ReturnType<typeof compactnessFindings>) => findings.rankSlack.filter(finding => finding.to === sink.id)
        const after = new Map(into(compactnessFindings({ ...geometry, nodes }, direction)).map(finding => [finding.edge, finding]))
        for (const finding of into(compactnessFindings(geometry, direction))) {
          expect(after.get(finding.edge)?.requiredLayers).toBe(finding.requiredLayers)
          expect(after.get(finding.edge)!.spannedLayers).toBeGreaterThanOrEqual(finding.spannedLayers)
        }
      }),
      fcParameters({ numRuns: 500 }),
    )
  })
})

describe('verify reports the compactness lint', () => {
  // A decision tree whose short branch sits level with the long one, beside a
  // subgraph entered from the side. A premise check names the layout this
  // fixture relies on; when the layout tightens both, choose another fixture.
  const source = [
    'flowchart TD',
    '  A{Raining?} -->|yes| B{Umbrella?}',
    '  A -->|no| C([Go out])',
    '  B -->|yes| D([Walk])',
    '  B -->|no| E{Heavy?}',
    '  E -->|yes| F([Stay])',
    '  E -->|no| G([Run])',
    '  subgraph Back[Backend]',
    '    H[API] --> I[DB]',
    '  end',
    '  C --> H',
    '  F ---> I',
  ].join('\n')

  it('as EDGE_RANK_SLACK and EDGE_UNDER_GROUP_TITLE warnings, honouring suppress', () => {
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error('fixture must parse')
    const graph = (parsed.value.body as { graph: MermaidGraph }).graph
    const positioned = positionFamilyArtifact(parsed.value)!.positioned as PositionedGraph
    const ids = positionedEdgeWarningIds(positioned.edges)
    const groups: CompactnessGroup[] = []
    const visit = (group: PositionedGroup, parentId?: string): void => {
      groups.push({ id: group.id, x: group.x, y: group.y, w: group.width, h: group.height, headerHeight: group.headerHeight ?? 0, members: group.nodeIds ?? [], ...(parentId ? { parentId } : {}) })
      group.children.forEach(child => visit(child, group.id))
    }
    positioned.groups.forEach(group => visit(group))
    const expected = compactnessFindings(
      {
        nodes: positioned.nodes.map(node => ({ id: node.id, x: node.x, y: node.y, w: node.width, h: node.height })),
        edges: positioned.edges.map(edge => ({ id: ids.get(edge)!, from: edge.source, to: edge.target, path: edge.points.map(point => [point.x, point.y] as const), length: graph.edges[edge.edgeIndex!]!.length })),
        groups,
      },
      graph.direction,
    )
    expect(expected.rankSlack.length + expected.titleStripRoutes.length).toBeGreaterThan(0)

    const warnings = verifyMermaid(source).warnings
    expect(warnings.filter(warning => warning.code === 'EDGE_RANK_SLACK').map(warning => warning.code === 'EDGE_RANK_SLACK' && [warning.edge, warning.spannedLayers, warning.requiredLayers])).toEqual(
      expected.rankSlack.map(finding => [finding.edge, finding.spannedLayers, finding.requiredLayers]),
    )
    expect(warnings.filter(warning => warning.code === 'EDGE_UNDER_GROUP_TITLE').map(warning => warning.code === 'EDGE_UNDER_GROUP_TITLE' && [warning.edge, warning.group, warning.clearancePx])).toEqual(
      expected.titleStripRoutes.map(finding => [finding.edge, finding.group, Math.round(finding.clearancePx)]),
    )
    const suppressed = verifyMermaid(source, { suppress: ['EDGE_RANK_SLACK', 'EDGE_UNDER_GROUP_TITLE'] })
    expect(suppressed.warnings.filter(warning => warning.code === 'EDGE_RANK_SLACK' || warning.code === 'EDGE_UNDER_GROUP_TITLE')).toEqual([])
  })
})
