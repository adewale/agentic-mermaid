import { describe, expect, test } from 'bun:test'
import { OccupancyMap } from '../ascii/occupancy.ts'
import { getPath } from '../ascii/pathfinder.ts'
import { allocateBoxRoutes, paintBoxRoute, type BoxRoute } from '../ascii/class-like-layout.ts'
import { TerminalDocument } from '../ascii/terminal-document.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf } from '../ascii/terminal-document.ts'

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
