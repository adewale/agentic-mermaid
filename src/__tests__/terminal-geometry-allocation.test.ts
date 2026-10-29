import { describe, expect, test } from 'bun:test'
import { OccupancyMap } from '../ascii/occupancy.ts'
import { getPath } from '../ascii/pathfinder.ts'
import { allocateBoxRoutes, paintBoxRoute, type BoxRoute } from '../ascii/class-like-layout.ts'
import { TerminalDocument, type TerminalMarker } from '../ascii/terminal-document.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf } from '../ascii/terminal-document.ts'
import { allocateTerminalRoute, paintTerminalRoute } from '../ascii/terminal-route.ts'
import { reserveGraphEdgeCapacity } from '../ascii/graph-capacity.ts'
import { convertToAsciiGraph } from '../ascii/converter.ts'
import { parseMermaid } from '../parser.ts'
import { gridToDrawingCoord } from '../ascii/grid.ts'
import { drawBox } from '../ascii/draw.ts'

describe('bounded terminal search occupancy', () => {
  test('current bounds follow replacement, deletion, cloning and clearing', () => {
    const cells = new OccupancyMap([['8,3', true], ['2,7', true], ['8,1', true]] as const)
    expect(Object.isFrozen(cells.extent)).toBe(true)
    cells.set('8,3', true)
    expect(cells.extent).toEqual({ maxX: 8, maxY: 7 })
    cells.delete('8,3')
    expect(cells.extent).toEqual({ maxX: 8, maxY: 7 })
    cells.delete('8,1')
    expect(cells.extent).toEqual({ maxX: 2, maxY: 7 })
    const clone = new OccupancyMap(cells)
    cells.clear()
    expect(cells.extent).toEqual({ maxX: 0, maxY: 0 })
    expect(clone.extent).toEqual({ maxX: 2, maxY: 7 })
    clone.delete('2,7')
    expect(clone.extent).toEqual({ maxX: 0, maxY: 0 })
  })

  test('routing consumes occupancy and known bounds without an iterable node map', () => {
    const occupied = new Set(['1,0'])
    const occupancy = { has: (key: string) => occupied.has(key), extent: { maxX: 1, maxY: 0 } }
    expect(getPath(occupancy, { x: 0, y: 0 }, { x: 2, y: 0 })).toEqual([
      { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 0 },
    ])
  })
})

describe('allocated terminal routes', () => {
  const boxes = [{ id: 'A', x: 4, y: 4, width: 8, height: 6 }, { id: 'B', x: 30, y: 4, width: 8, height: 6 }]
  const relation = { id: 'AB', from: 'A', to: 'B' }
  const owner = { ...relation, kind: 'edge' as const }

  test('undersized faces fail before allocating coincident or corner ports', () => {
    const cramped = boxes.map(box => ({ ...box, height: 3 }))
    expect(() => allocateBoxRoutes(cramped, Array.from({ length: 4 }, (_, index) => ({ ...relation, id: `AB${index}` })), 'LR')).toThrow('port capacity')
  })

  test('routes retain immutable source labels, unit steps and both port normals', () => {
    const lines = ['original']
    const [route] = allocateBoxRoutes(boxes, [{ ...relation, lines }], 'LR')
    lines[0] = 'changed later'
    expect(route!.label!.lines).toEqual(['original'])
    expect(route!.relation.lines).toEqual(['original'])
    expect(Object.isFrozen(route)).toBe(true)
    expect(Object.isFrozen(route!.points)).toBe(true)
    expect(Object.isFrozen(route!.points[0])).toBe(true)
    expect(Object.isFrozen(route!.label)).toBe(true)
    expect(Object.isFrozen(route!.label!.lines)).toBe(true)
    expect(route!.points[0]).toEqual(route!.source)
    expect(route!.points.at(-1)).toEqual(route!.target)
    expect(route!.points[1]).toEqual({ x: route!.source.x + 1, y: route!.source.y })
    expect(route!.points.at(-2)).toEqual({ x: route!.target.x - 1, y: route!.target.y })
    for (let index = 1; index < route!.points.length; index++) {
      const a = route!.points[index - 1]!, b = route!.points[index]!
      expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1)
    }
  })

  test('painting rejects fabricated routes or mismatched semantic endpoints before mutation', () => {
    const [route] = allocateBoxRoutes(boxes, [relation], 'LR')
    const document = new TerminalDocument()
    const forged = { relation, source: route!.source, target: route!.target, points: [] } as unknown as BoxRoute
    expect(() => paintBoxRoute(document, forged, owner, false)).toThrow('box allocation')
    expect(() => paintBoxRoute(document, { ...route!, points: [] }, owner, false)).toThrow('box allocation')
    expect(() => paintBoxRoute(document, route!, { ...owner, to: 'C' }, false)).toThrow('allocated endpoints')
    expect(document.occupiedCells).toBe(0)
    expect(document.regions()).toEqual([])
    paintBoxRoute(document, route!, owner, false)
    expect(document.regions().find(region => region.id === 'AB')?.ports).toEqual([
      { nodeId: 'A', ...route!.source, end: 'start' }, { nodeId: 'B', ...route!.target, end: 'end' },
    ])
  })

  test('box routes refuse late obstacles without partial ink or endpoint metadata', () => {
    const [route] = allocateBoxRoutes(boxes, [relation], 'LR'), doc = new TerminalDocument()
    const point = route!.points.at(-1)!
    doc.text(point.x, point.y, 'protected', { owner: { id: 'label', kind: 'node' } })
    const before = doc.serialize()
    expect(() => paintBoxRoute(doc, route!, owner, false)).toThrow('conflicts with admitted geometry')
    expect(doc.serialize()).toBe(before)
    expect(doc.regions().some(region => region.id === relation.id)).toBe(false)
  })
})

describe('exact physical terminal attachments', () => {
  const source = { nodeId: 'A', end: 'start' as const, side: 'R' as const, x: 0, y: 1 }
  const target = { nodeId: 'B', end: 'end' as const, side: 'L' as const, x: 6, y: 1 }
  const points = [1, 2, 3, 4, 5].map(x => ({ x, y: 1 }))
  const owner = { id: 'attachment', kind: 'edge' as const, from: 'A', to: 'B' }

  test('binds immutable border ports to complete outward-adjacent route ink', () => {
    const input = points.map(point => ({ ...point })), from = { ...source }
    const route = allocateTerminalRoute(owner.id, from, target, input)
    from.x = 20; input[0]!.x = 20
    expect(route.source.x).toBe(0)
    expect(route.points[0]!.x).toBe(1)
    expect(Object.isFrozen(route.points[0])).toBe(true)
    const doc = new TerminalDocument()
    doc.stroke(0, 1, 5, { owner: { id: 'A', kind: 'node' } })
    doc.stroke(6, 1, 5, { owner: { id: 'B', kind: 'node' } })
    expect(paintTerminalRoute(doc, route, owner, false, 'dotted')).toBe(true)
    expect(doc.regions().find(region => region.id === owner.id)?.ports).toEqual([source, target])
    for (let x = 1; x <= 5; x++) expect(doc.cell(x, 1)).toMatchObject({ glyph: '┄', stroke: { mask: 10 }, owners: [owner] })
    expect(doc.cell(0, 1)?.owners.map(element => element.id)).toEqual(['A'])
    expect(doc.cell(6, 1)?.owners.map(element => element.id)).toEqual(['B'])
    expect(doc.diagnostics).toEqual([])
  })

  test('late occupied text refuses the entire route without partial ink or attachment ports', () => {
    const route = allocateTerminalRoute(owner.id, source, target, points)
    const doc = new TerminalDocument()
    doc.text(4, 1, '界', { owner: { id: 'protected', kind: 'node' } })
    const before = { text: doc.serialize(), cells: doc.occupiedCells, regions: doc.regions(), width: doc.width, height: doc.height }
    expect(paintTerminalRoute(doc, route, owner, false)).toBe(false)
    expect({ text: doc.serialize(), cells: doc.occupiedCells, regions: doc.regions(), width: doc.width, height: doc.height }).toEqual(before)
    expect(doc.regions().some(region => region.id === owner.id)).toBe(false)
    expect(doc.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['TERMINAL_TEXT_COLLISION'])
  })

  test('one immutable owner snapshot binds nested references across stroke and port admission', () => {
    let reads = 0
    const parent = { get id() { return ++reads === 1 ? 'first' : 'changed' }, kind: 'cluster' as const }
    const route = allocateTerminalRoute(owner.id, source, target, points), doc = new TerminalDocument()
    expect(paintTerminalRoute(doc, route, { ...owner, parent }, false)).toBe(true)
    expect(reads).toBe(1)
    expect(doc.regions().find(region => region.id === owner.id)).toMatchObject({ parentId: 'first', parentKind: 'cluster', ports: [source, target] })
    expect(doc.diagnostics).toEqual([])
  })

  test('allocated endpoint markers cannot change through their source definitions', () => {
    const marker: TerminalMarker = { shape: 'circle', direction: 'L' }
    const markers = [marker], from = { ...source, markers }
    const route = allocateTerminalRoute(owner.id, from, target, points), doc = new TerminalDocument()
    marker.shape = 'cross'; markers.push({ shape: 'diamond' })
    expect(route.source.markers).toEqual([{ shape: 'circle', direction: 'L' }])
    expect(Object.isFrozen(route.source.markers)).toBe(true)
    expect(Object.isFrozen(route.source.markers![0])).toBe(true)
    expect(paintTerminalRoute(doc, route, owner, false)).toBe(true)
    markers.length = 0
    const admitted = doc.regions().find(region => region.id === owner.id)!.ports![0]!
    expect(admitted.markers).toEqual([{ shape: 'circle', direction: 'L' }])
    expect(Object.isFrozen(admitted.markers![0])).toBe(true)
  })

  test('a port extent overflow is refused before publishing route ink or ports', () => {
    const x = Number.MAX_SAFE_INTEGER
    const doc = new TerminalDocument()
    expect(() => {
      const route = allocateTerminalRoute(owner.id,
        { ...source, side: 'L', x }, { ...target, side: 'R', x: x - 4 },
        [x - 1, x - 2, x - 3].map(x => ({ x, y: 1 })))
      paintTerminalRoute(doc, route, owner, false)
    }).toThrow('physical ports')
    expect(doc.occupiedCells).toBe(0)
    expect(doc.regions()).toEqual([])
    expect({ width: doc.width, height: doc.height }).toEqual({ width: 0, height: 0 })
  })

  test('rejects discontinuity, inward approaches and forged endpoint evidence before painting', () => {
    expect(() => allocateTerminalRoute(owner.id, source, target, [points[0]!, points[4]!])).toThrow('contiguous')
    expect(() => allocateTerminalRoute(owner.id, source, target, [{ x: 2, y: 1 }, ...points.slice(1)])).toThrow('physical ports')
    const inward = [{ x: 1, y: 1 }, { x: 0, y: 1 }, ...[0, 1, 2, 3, 4, 5].map(x => ({ x, y: 2 })), { x: 5, y: 1 }]
    expect(() => allocateTerminalRoute(owner.id, source, target, inward)).toThrow('physical ports')
    const route = allocateTerminalRoute(owner.id, source, target, points), doc = new TerminalDocument()
    expect(() => paintTerminalRoute(doc, { ...route, points: [] }, owner, false)).toThrow('complete path allocation')
    expect(() => paintTerminalRoute(doc, route, { ...owner, to: 'wrong' }, false)).toThrow('physical endpoints')
    expect(doc.occupiedCells).toBe(0)
    expect(doc.regions()).toEqual([])
  })
})

test('an unarrowed Architecture face port connects to its card without inventing a branch', () => {
  const rendered = renderMermaidASCIIWithReceipt('architecture-beta\nservice a(server)[A]\nservice b(server)[B]\na:R --> L:b', { useAscii: true, colorMode: 'none' })
  const document = terminalDocumentOf(rendered)!
  const edge = document.regions().find(region => region.kind === 'edge')!
  const source = edge.ports!.find(port => port.end === 'start')!
  expect(document.cell(source.x - 1, source.y)?.owners.some(owner => owner.kind === 'node' && owner.id === 'a')).toBe(true)
  expect(document.cell(source.x, source.y)?.glyph).toBe('-')
  expect(document.cell(source.x, source.y)?.stroke?.mask).toBe(10)
  expect(document.cell(source.x + 1, source.y)?.owners.some(owner => owner.id === edge.id)).toBe(true)
})

test.each(['LR', 'RL', 'TD', 'BT'] as const)('terminal escape capacity grows the trailing spacer, not an adjacent body (%s)', direction => {
  const horizontal = direction === 'LR' || direction === 'RL', reverse = direction === 'RL' || direction === 'BT'
  const graph = convertToAsciiGraph(parseMermaid('flowchart LR\nA --> B\nA --> B\nA --> B'), {
    useAscii: false, paddingX: 3, paddingY: 3, boxBorderPadding: 1, graphDirection: horizontal ? 'LR' : 'TD',
  })
  graph.nodes[0]!.gridCoord = horizontal ? { x: reverse ? 3 : 0, y: 0 } : { x: 0, y: reverse ? 3 : 0 }
  graph.nodes[1]!.gridCoord = horizontal ? { x: reverse ? 0 : 3, y: 0 } : { x: 0, y: reverse ? 0 : 3 }
  graph.columnWidth = new Map([[0, 1], [1, 5], [2, 1], [3, 1], [4, 5], [5, 1]])
  graph.rowHeight = new Map([[0, 1], [1, 5], [2, 1], [3, 1], [4, 5], [5, 1]])
  const measure = () => new Map(graph.nodes.map(node => {
    const origin = gridToDrawingCoord(graph, node.gridCoord!), body = drawBox(node, graph)
    return [node, { minX: origin.x, minY: origin.y, maxX: origin.x + body.width - 1, maxY: origin.y + body.height - 1 }] as const
  }))
  const before = measure()
  reserveGraphEdgeCapacity(graph, measure, new Set(graph.edges))
  const after = measure(), axis = horizontal ? 'X' : 'Y'
  const intervals = graph.nodes.map(node => {
    const old = before.get(node)!, current = after.get(node)!
    expect(current[`max${axis}`] - current[`min${axis}`]).toBe(old[`max${axis}`] - old[`min${axis}`])
    return [current[`min${axis}`], current[`max${axis}`]] as const
  }).sort((a, b) => a[0] - b[0])
  // Three independently allocated contacts need two approach cells, a bend
  // cell, and two lanes each. The body painter is the dimension oracle.
  expect(intervals[1]![0] - intervals[0]![1]).toBeGreaterThanOrEqual(9)
})
