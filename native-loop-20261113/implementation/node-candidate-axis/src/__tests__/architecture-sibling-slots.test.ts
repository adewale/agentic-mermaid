import { describe, expect, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as graphLayout from '../layout-engine.ts'
import { layoutArchitectureDiagram } from '../architecture/layout.ts'
import { improveArchitectureSiblingSlots } from '../layout/architecture-sibling-slots.ts'
import { parseArchitectureDiagram } from '../architecture/parser.ts'
import type { ArchitectureDiagram, PositionedArchitectureEdge, PositionedArchitectureService } from '../architecture/types.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { GraphLayoutUnsupportedError, withGraphLayoutDecisionObserver } from '../layout/backend.ts'
import { layoutMermaidWithReceipt } from '../agent/core.ts'
import { measureQuality } from '../agent/quality.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { countOpposingRouteOverlaps, countParallelRouteOverlaps } from '../layout-rubric.ts'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'

const native = { graphLayout: { backend: 'agentic' as const } }
const corpus = JSON.parse(readFileSync(new URL('../../eval/mermaid-docs-corpus/corpus.json', import.meta.url), 'utf8')) as Array<{ family: string; index: number; source: string }>
const witnesses = corpus.filter(entry => entry.family === 'architecture' && [0, 5].includes(entry.index))
const sharedInk = (routes: PositionedArchitectureEdge[]) => {
  const ink = routes.map(({ points }) => ({ points, style: 'solid' as const, source: '', target: '_' }))
  return countOpposingRouteOverlaps(ink) || countParallelRouteOverlaps(ink)
}

describe('Architecture final-route sibling slots', () => {
  test.each(witnesses)('removes the enrolled crossing without bends/area loss: $index', ({ source }) => {
    const model = parseArchitectureDiagram(toMermaidLines(source)), original = structuredClone(model)
    const placed = layoutArchitectureDiagram(model, native)
    expect(model).toEqual(original)
    expect(placed.services.map(service => service.id)).toEqual(model.services.map(service => service.id))
    expect(placed.edges.map(edge => [edge.source, edge.target, edge.hasArrowStart, edge.hasArrowEnd])).toEqual(model.edges.map(edge => [edge.source, edge.target, edge.hasArrowStart, edge.hasArrowEnd]))
    expect(new Set(placed.edges.flatMap(edge => [edge.source.side, edge.target.side]))).toEqual(new Set(['L', 'R', 'T', 'B']))
    expect(placed.edges.every(edge => edge.sourceFacesTarget && edge.targetFacesSource && edge.obstacleFree)).toBe(true)
    const quality = measureQuality(layoutMermaidWithReceipt(source, { ...native, debug: true }).layout)
    expect(quality.edgeCrossings).toBe(0)
    expect(quality.routeOverlaps).toEqual({ parallel: 0, opposing: 0 })
    expect(Object.fromEntries(Object.entries(quality.routeGeometry!).map(([key, value]) => [key, Math.round(value)]))).toEqual({ bends: 6, length: 596, area: 318682 })
    for (const text of [source, source.replaceAll('--', '<-->')]) {
      const rendered = renderMermaidSVGWithReceipt(text, native)
      expect(rendered.receipt.layoutCertification?.status).toBe('passed')
      expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
      const positioned = layoutArchitectureDiagram(parseArchitectureDiagram(toMermaidLines(text)), native)
      expect(positioned.edges.map(edge => [edge.hasArrowStart, edge.hasArrowEnd])).toEqual(text === source ? [[false, false], [false, false], [false, false]] : [[true, true], [true, true], [true, true]])
    }
  })

  test('default, explicit ELK and actual typed fallback retain identical placement', () => {
    const model = parseArchitectureDiagram(toMermaidLines(witnesses[0]!.source))
    const baseline = layoutArchitectureDiagram(model)
    expect(layoutArchitectureDiagram(model, { graphLayout: { backend: 'elk' } })).toEqual(baseline)
    const producer = spyOn(graphLayout, 'layoutNativeGraphPlacementSync').mockImplementation(() => { throw new GraphLayoutUnsupportedError('test capability decline') })
    const decisions: string[] = []
    try {
      const result = withGraphLayoutDecisionObserver(decision => decisions.push(decision.selected), () => layoutArchitectureDiagram(model, { graphLayout: { backend: 'agentic', fallback: 'elk' } }))
      expect(result).toEqual(baseline)
      expect(decisions).toEqual(['elk'])
    } finally { producer.mockRestore() }
  })

  const empty: ArchitectureDiagram = { services: [], junctions: [], groups: [], edges: [], rootChildren: [], alignments: [] }
  const services = (): PositionedArchitectureService[] => [{ id: 'a', label: 'A', x: 0, y: 0, width: 10, height: 10 }, { id: 'b', label: 'B', x: 30, y: 30, width: 10, height: 10 }]
  const edge = (points: Array<[number, number]>): PositionedArchitectureEdge => ({ source: { id: 'a', side: 'R', boundary: 'item' }, target: { id: 'b', side: 'L', boundary: 'item' }, points: points.map(([x, y]) => ({ x, y })), hasArrowStart: false, hasArrowEnd: false, placement: 'satisfied', sourceFacesTarget: true, targetFacesSource: true, obstacleFree: true })
  const crossing = () => [edge([[-20, 0], [20, 0]]), edge([[0, -20], [0, 20]])]

  test('retains multi-crossing inputs without constructing optional routes', () => {
    const items = services(), before = structuredClone(items)
    const routes = [edge([[-20, 0], [20, 0]]), edge([[-10, -20], [-10, 20]]), edge([[10, -20], [10, 20]])]
    expect(countPolylineCrossings(routes)).toBe(2)
    expect(improveArchitectureSiblingSlots(empty, items, routes, () => { throw new Error('multi-crossing input routed') }, () => true, sharedInk)).toBe(routes)
    expect(items).toEqual(before)
  })

  test('returns the first legal zero-crossing repair without spending another trial', () => {
    const items = services(), routes = crossing()
    const repaired = [edge([[-20, 0], [20, 0]]), edge([[30, -20], [30, 20]])]
    let calls = 0
    expect(improveArchitectureSiblingSlots(empty, items, routes, () => { calls++; return repaired }, () => true, sharedInk)).toBe(repaired)
    expect(calls).toBe(1)
    expect(items.map(({ x, y }) => [x, y])).toEqual([[30, 0], [0, 30]])
  })

  test('rejected legality and non-improving trials restore exact coordinates', () => {
    for (const valid of [false, true]) {
      const items = services(), before = structuredClone(items), routes = crossing()
      let calls = 0
      expect(improveArchitectureSiblingSlots(empty, items, routes, () => { calls++; return crossing() }, () => valid, sharedInk)).toBe(routes)
      expect(items).toEqual(before)
      expect(calls).toBe(valid ? 2 : 0)
    }
  })

  test.each(['unequal size', 'different parent', 'alignment', 'label', 'group terminal', 'obstacle limit'])('retains excluded placement exactly: %s', reason => {
    const items = services(), diagram = structuredClone(empty), routes = crossing()
    if (reason === 'unequal size') items[1]!.width++
    if (reason === 'different parent') items[1]!.parentId = 'other'
    if (reason === 'alignment') diagram.alignments = [{ axis: 'row', members: ['a', 'b'] }]
    if (reason === 'label') diagram.edges = [{ ...routes[0]!, label: 'kept' }]
    if (reason === 'group terminal') diagram.edges = [{ ...routes[0]!, source: { ...routes[0]!.source, boundary: 'group' } }]
    if (reason === 'obstacle limit') diagram.junctions = Array.from({ length: 23 }, (_, index) => ({ id: `j${index}` }))
    const before = structuredClone(items)
    expect(improveArchitectureSiblingSlots(diagram, items, routes, () => { throw new Error('excluded trial routed') }, () => true, sharedInk)).toBe(routes)
    expect(items).toEqual(before)
  })

  test.each(['parallel', 'opposing'] as const)('rejects a crossing reduction concealed in %s shared ink', direction => {
    const items = services(), before = structuredClone(items), routes = crossing()
    const shared = () => [edge([[-20, 0], [20, 0]]), edge(direction === 'parallel' ? [[-10, 0], [10, 0]] : [[10, 0], [-10, 0]])]
    expect(improveArchitectureSiblingSlots(empty, items, routes, shared, () => true, sharedInk)).toBe(routes)
    expect(items).toEqual(before)
    const distantShared = shared().map(route => ({ ...route, points: route.points.map(point => ({ ...point, y: point.y + 100 })) }))
    const sharedBaseline = [...crossing(), ...distantShared]
    expect(countPolylineCrossings(sharedBaseline)).toBe(1)
    expect(sharedInk(sharedBaseline)).toBeGreaterThan(0)
    expect(improveArchitectureSiblingSlots(empty, items, sharedBaseline, () => { throw new Error('shared baseline routed') }, () => true, sharedInk)).toBe(sharedBaseline)
  })
})
