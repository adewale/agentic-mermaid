import { describe, expect, test } from 'bun:test'
import { denseDag, diamondFan } from '../../eval/degenerate-etn/generators.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { closeRouteContracts, findRouteHitches } from '../route-contracts.ts'
import { assessLayout, hardViolations } from '../layout-rubric.ts'
import { resolveRenderStyle } from '../styles.ts'

describe('final route-contract closer invariants (issue #88)', () => {
  test('dense parallel lanes remain proved and byte-idempotent when shared lanes block straightening', () => {
    const graph = parseMermaid(denseDag(1656))
    const positioned = layoutGraphSync(graph)
    const parallel = positioned.edges.filter(item => item.source === 'N1' && item.target === 'N4')
    const blocked = positioned.edges.find(item => item.source === 'N0' && item.target === 'N1')!

    // The labeled diamond pair now has certified parallel lanes. A feedback
    // edge in the same graph still has its direct lane blocked by settled
    // channels and labels. Closing either proof again must preserve every byte.
    expect(hardViolations(assessLayout(graph, positioned))).toEqual([])
    expect(findRouteHitches(positioned, graph)).toEqual([])
    expect(parallel).toHaveLength(2)
    for (const edge of parallel) expect(edge.routeCertificate?.invariant).toBe('bundle')
    expect(blocked.routeCertificate?.directLaneClear).toBe(false)
    expect(blocked.routeCertificate?.directLaneBlockedBy?.some(blocker => blocker.kind === 'channel' || blocker.kind === 'label')).toBe(true)
    const once = JSON.stringify(positioned.edges)
    closeRouteContracts(positioned, graph, resolveRenderStyle({}))
    expect(JSON.stringify(positioned.edges)).toBe(once)
  })

  test('a context-only regression keeps its bend when settled label halos conflict', () => {
    const graph = parseMermaid(diamondFan(79))
    const positioned = layoutGraphSync(graph)
    const edge = positioned.edges.find(item => item.source === 'D' && item.target === 'T3')!

    // Under the legacy 2px label clearance this BT edge has a straight lane.
    // The final closer's label-halo clearance refuses it because the settled
    // D->T2 pill sits inside the halo, so the edge keeps its bend, and its
    // certificate names that label as the blocker.
    const certificate = edge.routeCertificate
    expect({
      points: edge.points.length,
      invariant: certificate?.invariant,
      directLaneClear: certificate?.directLaneClear,
      blockedByNeighbourLabel: certificate?.directLaneBlockedBy?.some(b => b.kind === 'label' && b.id === 'D->T2'),
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
