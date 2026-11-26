// The paired gate blocks merges, so its verdict rules are a contract: hard
// losses always break, the declared objective alone decides improvement and
// regression, and secondary moves are reported without deciding.

import { expect, test } from 'bun:test'
import { layoutMermaidWithReceipt, type QualityMetrics } from '../../src/agent/index.ts'
import { classify, summarize, type CapturedSample, type GateVerdict } from './gate.ts'

const metrics = (patch: Partial<Record<'crossings' | 'conflicts' | 'bends' | 'area' | 'nodes' | 'opposing', number>> & { paint?: string } = {}) => ({
  edgeCrossings: patch.crossings ?? 2,
  labelConflicts: { total: patch.conflicts ?? 0 },
  routeGeometry: { bends: patch.bends ?? 10, length: 500, area: patch.area ?? 10_000 },
  routeOverlaps: { opposing: patch.opposing ?? 0, parallel: 0 },
  paintCertification: { status: patch.paint ?? 'passed' },
  nodeCount: patch.nodes ?? 5,
  edgeCount: 6,
  labelLegibility: 1,
}) as unknown as QualityMetrics

const sample = (digest: string, layout: QualityMetrics | undefined, ms = [10]): CapturedSample =>
  layout ? { key: 'k', ok: true, digest, layout, ms } : { key: 'k', ok: false, error: 'boom', ms }

const input = { key: 'k', family: 'flowchart', source: '', options: {} }
const run = (base: CapturedSample[], head: CapturedSample[]) => classify(input, base, head, layout => layout as QualityMetrics, () => undefined)

test.each<{ name: string; base: CapturedSample[]; head: CapturedSample[]; verdict: GateVerdict; criterion?: string }>([
  { name: 'support lost', base: [sample('a', metrics())], head: [sample('b', undefined)], verdict: 'broken' },
  { name: 'support gained', base: [sample('a', undefined)], head: [sample('b', metrics())], verdict: 'improved' },
  { name: 'head differs between identical runs', base: [sample('a', metrics())], head: [sample('b', metrics()), sample('c', metrics())], verdict: 'broken' },
  { name: 'authored node lost despite fewer crossings', base: [sample('a', metrics())], head: [sample('b', metrics({ nodes: 4, crossings: 0 }))], verdict: 'broken' },
  { name: 'geometry certification lost despite an identical score', base: [sample('a', metrics())], head: [{ ...sample('b', metrics()), geometry: { status: 'uncertified', kinds: ['indistinctOccurrences'] } }], verdict: 'broken' },
  { name: 'geometry certification regained outranks one more crossing', base: [{ ...sample('a', metrics()), geometry: { status: 'uncertified', kinds: ['indistinctOccurrences'] } }], head: [sample('b', metrics({ crossings: 3 }))], verdict: 'improved' },
  { name: 'paint certification lost', base: [sample('a', metrics())], head: [sample('b', metrics({ paint: 'unverified' }))], verdict: 'broken' },
  { name: 'paint certification regained outranks one more crossing', base: [sample('a', metrics({ paint: 'unverified' }))], head: [sample('b', metrics({ crossings: 3 }))], verdict: 'improved' },
  { name: 'one more crossing outranks fewer bends', base: [sample('a', metrics())], head: [sample('b', metrics({ crossings: 3, bends: 2 }))], verdict: 'regressed', criterion: 'edgeCrossings' },
  { name: 'fewer crossings outrank more bends', base: [sample('a', metrics())], head: [sample('b', metrics({ crossings: 1, bends: 20 }))], verdict: 'improved', criterion: 'edgeCrossings' },
  { name: 'canvas change under 1% ties', base: [sample('a', metrics())], head: [sample('b', metrics({ area: 10_050 }))], verdict: 'unchanged' },
  { name: 'canvas change under 1% ties across a 1% step', base: [sample('a', metrics({ area: 1.01 ** 925.49 }))], head: [sample('b', metrics({ area: 1.01 ** 925.51 }))], verdict: 'unchanged' },
  { name: 'canvas growth of 2% regresses on area', base: [sample('a', metrics())], head: [sample('b', metrics({ area: 10_200 }))], verdict: 'regressed', criterion: 'area' },
  { name: 'an uncertified base gaining a hard violation breaks despite fewer crossings', base: [{ ...sample('a', metrics()), geometry: { status: 'uncertified', kinds: ['indistinctOccurrences'] } }], head: [{ ...sample('b', metrics({ crossings: 1 })), geometry: { status: 'uncertified', kinds: ['indistinctOccurrences', 'edgeThroughNode'] } }], verdict: 'broken' },
  { name: 'an uncertified base repeating a hard violation breaks', base: [{ ...sample('a', metrics()), geometry: { status: 'uncertified', kinds: ['indistinctOccurrences'] } }], head: [{ ...sample('b', metrics({ crossings: 1 })), geometry: { status: 'uncertified', kinds: ['indistinctOccurrences', 'indistinctOccurrences'] } }], verdict: 'broken' },
  { name: 'shedding one of two hard violations outranks one more crossing', base: [{ ...sample('a', metrics()), geometry: { status: 'uncertified', kinds: ['indistinctOccurrences', 'edgeThroughNode'] } }], head: [{ ...sample('b', metrics({ crossings: 3 })), geometry: { status: 'uncertified', kinds: ['edgeThroughNode'] } }], verdict: 'improved' },
  { name: 'identical geometry is not rescored', base: [sample('a', metrics())], head: [sample('a', metrics({ crossings: 9 }))], verdict: 'unchanged' },
])('$name', ({ base, head, verdict, criterion }) => {
  const result = run(base, head)
  expect(result.verdict).toBe(verdict)
  expect(result.criterion).toBe(criterion as never)
})

test('secondary metrics are reported without deciding a tied objective', () => {
  const result = run([sample('a', metrics())], [sample('b', metrics({ opposing: 2 }))])
  expect(result.verdict).toBe('unchanged')
  expect(result.tradeoffs).toEqual(['opposing shared spans 0 → 2'])
})

test('layout time is the geometric mean of per-sample median ratios', () => {
  const twice = run([sample('a', metrics(), [10, 10, 30])], [sample('a', metrics(), [20, 20, 1])])
  const half = { ...twice, baseMs: 20, headMs: 10 }
  expect(twice).toMatchObject({ baseMs: 10, headMs: 20 })
  expect(summarize([twice, half]).slowdown).toBeCloseTo(1)
})

// The quality metrics carry no port or barycentre axis, so the projection
// measures them on the published layout. A symmetry or port change must decide
// in the objective's own order: before area, after bends.
const fanout = { key: 'fanout', family: 'flowchart', source: 'flowchart TD\n  A[Hub] --> B[Left]\n  A --> C[Right]\n', options: {} }
const drawn = layoutMermaidWithReceipt(fanout.source).layout
type Editable = { nodes: { id: string; x: number }[]; edges: { to: string; path: [number, number][] }[]; bounds: { w: number } }
const variant = (digest: string, change: (layout: Editable) => void): CapturedSample => {
  const layout = structuredClone(drawn) as unknown as Editable
  change(layout)
  return { key: 'fanout', ok: true, digest, layout, ms: [10] }
}
// Moves the hub and the shared-x lead of each of its routes across the flow.
const offCentre = (layout: Editable) => {
  layout.nodes.find(node => node.id === 'A')!.x += 12
  for (const edge of layout.edges) for (const point of edge.path.slice(0, 2)) point[0] += 12
}

test.each<{ name: string; base: CapturedSample; head: CapturedSample; verdict: GateVerdict; criterion: string }>([
  { name: 'hub moved off its peer barycentre', base: variant('a', () => {}), head: variant('b', offCentre), verdict: 'regressed', criterion: 'peerBarycenterDelta' },
  { name: 'centred hub outranks a wider canvas', base: variant('a', offCentre), head: variant('b', layout => { layout.bounds.w *= 1.05 }), verdict: 'improved', criterion: 'peerBarycenterDelta' },
  { name: 'arrival slid off its port', base: variant('a', () => {}), head: variant('b', layout => { for (const point of layout.edges.find(edge => edge.to === 'B')!.path.slice(-2)) point[0] += 6 }), verdict: 'regressed', criterion: 'nonCanonicalEndpointRate' },
])('$name', ({ base, head, verdict, criterion }) => {
  expect(classify(fanout, [base], [head])).toMatchObject({ verdict, criterion })
})
