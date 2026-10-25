import { describe, expect, test } from 'bun:test'
import { assertFinalBoundaryContacts, createBoundaryContactValidator } from '../layout/compound-boundary-routes.ts'
import type { AgenticLayout, MeasuredGraph } from '../layout/agentic-layered-core.ts'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'

const fail = (reason: string): never => { throw new Error(reason) }
const work = (pairs = 1_000_000) => ({ pairs, arcs: 65536, swaps: 1_000_000 })

function drawing(): { input: MeasuredGraph; placed: AgenticLayout } {
  return {
    input: { nodes: Array.from({ length: 6 }, (_, index) => ({ id: `card-${index}`, width: 10, height: 10 })),
      edges: [{ source: 0, target: 1, minSpan: 1 }, { source: 2, target: 3, minSpan: 1 }, { source: 4, target: 5, minSpan: 1 }],
      direction: 'TB', padding: 20, nodeSpacing: 20, layerSpacing: 40 },
    placed: { topology: 'layered', width: 140, height: 160,
      nodes: [{ x: 40, y: 65 }, { x: 90, y: 65 }, { x: 65, y: 40 }, { x: 65, y: 110 }, { x: 40, y: 85 }, { x: 90, y: 85 }],
      edges: [
        { points: [{ x: 50, y: 70 }, { x: 90, y: 70 }] },
        { points: [{ x: 70, y: 50 }, { x: 70, y: 110 }] },
        { points: [{ x: 50, y: 90 }, { x: 90, y: 90 }] },
      ] },
  }
}

describe('final compound route contact closure', () => {
  test('checks all visible final pairs within one reserve without changing exact crossing metrics', () => {
    const { input, placed } = drawing(), original = structuredClone({ input, placed })
    const reserve = work(65)
    expect(countPolylineCrossings(placed.edges)).toBe(2)
    assertFinalBoundaryContacts(input, placed, new Set([0, 1, 2]), reserve, fail)
    expect(reserve.pairs).toBeGreaterThan(0)
    expect(countPolylineCrossings(placed.edges)).toBe(2)
    expect({ input, placed }).toEqual(original)
  })

  test('hidden pending shafts retain metadata without spending visible pair proof', () => {
    const { input, placed } = drawing()
    const routes = placed.edges.map(route => ({ ...route, style: 'solid' }))
    routes[2] = { style: 'invisible', points: Array.from({ length: 1000 }, (_, i) => ({ x: i, y: i % 2 })) }
    const reserve = work(20)
    const accept = createBoundaryContactValidator(input, 0, routes, reserve, fail)
    expect(accept(routes[0]!.points)).toBe(true)
    expect(reserve.pairs).toBeGreaterThan(0)
    routes[2] = { style: 'solid', points: [{ x: 80, y: 70 }, { x: 80, y: 110 }] }
    const late = createBoundaryContactValidator(input, 0, routes, work(), fail)
    expect(late(routes[0]!.points)).toBe(false)
  })

  test.each([
    { name: 'future rescue T contact', rescued: [0, 1, 2], shaft: false },
    { name: 'later primary T contact', rescued: [0], shaft: false },
    { name: 'shared shaft', rescued: [2], shaft: true },
    { name: 'invisible rescue retains earlier visible peers', rescued: [0, 2], shaft: false, invisible: true },
  ])('rejects $name after all routes are finalized', ({ rescued, shaft, invisible }) => {
    const { input, placed } = drawing()
    placed.edges[2]!.points = shaft ? [{ x: 60, y: 70 }, { x: 80, y: 70 }] : [{ x: 80, y: 70 }, { x: 80, y: 110 }]
    if (invisible) input.edges[2]!.visible = false
    expect(() => assertFinalBoundaryContacts(input, placed, new Set(rescued), work(), fail)).toThrow('uncertified shared contact')
  })
})
