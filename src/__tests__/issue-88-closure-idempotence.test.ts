import { describe, expect, test } from 'bun:test'
import { denseDag, diamondFan } from '../../eval/degenerate-etn/generators.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import {
  allocateRoutePorts,
  classifyRoutes,
  closeRouteContracts,
  findLabelSlot,
  findRouteHitches,
  labelRect,
  straightLaneFor,
} from '../route-contracts.ts'
import { resolveRenderStyle } from '../styles.ts'

describe('final route-contract closer invariants (issue #88)', () => {
  test('a real late-closure regression is straight and byte-idempotent', () => {
    const graph = parseMermaid(denseDag(1656))
    const positioned = layoutGraphSync(graph)
    const edge = positioned.edges.find(item => item.source === 'N1' && item.target === 'N4')!

    // This route has four points on main at 027cb4b0. Final closure removes
    // both bends, and invoking the same proof again must preserve every byte.
    expect(edge.points).toHaveLength(2)
    expect(edge.routeCertificate).toMatchObject({ invariant: 'straight', bendCount: 0, directLaneClear: true })
    const once = JSON.stringify(positioned.edges)
    closeRouteContracts(positioned, graph, resolveRenderStyle({}))
    expect(JSON.stringify(positioned.edges)).toBe(once)
  })

  test('a context-only regression keeps its bend when settled label halos conflict', () => {
    const graph = parseMermaid(diamondFan(269))
    const positioned = layoutGraphSync(graph)
    const edge = positioned.edges.find(item => item.source === 'D' && item.target === 'T1')!
    const source = positioned.nodes.find(node => node.id === edge.source)!
    const target = positioned.nodes.find(node => node.id === edge.target)!
    const style = resolveRenderStyle({})
    const classes = classifyRoutes(graph)
    const axis = { main: 'x', cross: 'y', sign: -1 } as const
    const looseContext = {
      nodes: positioned.nodes,
      edges: positioned.edges,
      axis,
      style,
      classes,
      sideUse: allocateRoutePorts(positioned, graph, classes).sideUse,
    }

    const lane = straightLaneFor(edge, source, target, looseContext, axis)
    expect(lane).not.toBeNull()
    if (lane === null) throw new Error('expected the legacy loose-label proof to find a lane')

    // Intersect that horizontal RL lane with the source diamond's left facet
    // and the rectangular target's right side.
    const sourceCenterY = source.y + source.height / 2
    const sourceHalfWidth = source.width / 2
    const sourceHalfHeight = source.height / 2
    const sourceX = source.x + sourceHalfWidth * (Math.abs(lane - sourceCenterY) / sourceHalfHeight)
    const start = { x: sourceX, y: lane }
    const end = { x: target.x + target.width, y: lane }
    const looseSlot = findLabelSlot(edge, start, end, looseContext)
    expect(looseSlot).not.toBeNull()
    if (looseSlot === null) throw new Error('expected a slot under the legacy 2px clearance')

    const candidateRect = labelRect({ ...edge, labelPosition: looseSlot }, style)
    const neighborRect = labelRect(positioned.edges[0]!, style)
    if (!candidateRect || !neighborRect) throw new Error('expected both settled label pills')
    const verticalGap = Math.max(candidateRect.y, neighborRect.y) -
      Math.min(candidateRect.y + candidateRect.h, neighborRect.y + neighborRect.h)
    expect(verticalGap).toBeGreaterThanOrEqual(2)
    expect(verticalGap).toBeLessThan(16)

    const finalContext = { ...looseContext, finalLabelClearance: true }
    expect(findLabelSlot(edge, start, end, finalContext)).toBeNull()
    expect(straightLaneFor(edge, source, target, finalContext, axis)).toBeNull()
    expect(edge.points).toHaveLength(4)
    expect(findRouteHitches(positioned, graph)).toEqual([])
  })

  test('closing a synthetic hitch conserves identity and renews its certificate', () => {
    const graph = parseMermaid('flowchart LR\n  A --> B')
    const positioned = layoutGraphSync(graph)
    const edge = positioned.edges[0]!
    const [start, end] = edge.points
    const middle = (start!.x + end!.x) / 2
    edge.points = [
      start!,
      { x: middle, y: start!.y },
      { x: middle, y: start!.y + 10 },
      { x: end!.x, y: start!.y + 10 },
      end!,
    ]
    const { straightened: _straightened, ...savedCertificate } = edge.routeCertificate!
    const staleCertificate = {
      ...savedCertificate,
      invariant: 'explained-detour' as const,
      bendCount: 3,
      directLaneClear: false,
      directLaneBlockedBy: [{ kind: 'span' as const, id: 'synthetic-stale-certificate' }],
    }
    edge.routeCertificate = staleCertificate
    expect(findRouteHitches(positioned, graph)).toHaveLength(1)
    const identity = positioned.edges.map(item => [item.source, item.target, item.edgeIndex])

    closeRouteContracts(positioned, graph, resolveRenderStyle({}))

    expect(findRouteHitches(positioned, graph)).toEqual([])
    expect(positioned.edges.map(item => [item.source, item.target, item.edgeIndex])).toEqual(identity)
    expect(edge.points).toEqual([start!, end!])
    expect(edge.routeCertificate).not.toBe(staleCertificate)
    expect(edge.routeCertificate).toMatchObject({ invariant: 'straight', bendCount: 0, directLaneClear: true })
    expect(edge.routeCertificate).not.toHaveProperty('directLaneBlockedBy')
  })
})
