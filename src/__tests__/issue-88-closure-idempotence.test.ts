import { describe, expect, test } from 'bun:test'
import { denseDag, diamondFan } from '../../eval/degenerate-etn/generators.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { closeRouteContracts, findRouteHitches } from '../route-contracts.ts'
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

    // Under the legacy 2px label clearance this RL edge had a straight lane.
    // The final closer's label-halo clearance refuses it because the settled
    // D->T0 pill sits inside the halo, so the edge keeps its bend, and its
    // certificate names that label as the blocker.
    const certificate = edge.routeCertificate
    expect({
      points: edge.points.length,
      invariant: certificate?.invariant,
      directLaneClear: certificate?.directLaneClear,
      blockedByNeighbourLabel: certificate?.directLaneBlockedBy?.some(b => b.kind === 'label' && b.id === 'D->T0'),
    }).toEqual({ points: 4, invariant: 'explained-detour', directLaneClear: false, blockedByNeighbourLabel: true })
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
