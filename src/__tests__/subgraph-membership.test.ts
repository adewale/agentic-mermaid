// Upstream's subgraph membership rule (src/shared/subgraph-membership.ts):
// the first subgraph to close keeps a node, listed once. The oracle is pinned
// upstream Mermaid's flowchart DB (`getSubGraphs()`), which applies the rule
// in `addSubGraph` → `makeUniq`.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { createSubgraphMembership, resolveSubgraphMembership } from '../shared/subgraph-membership.ts'
import { startUpstreamMermaid, type UpstreamMermaid } from './helpers/upstream-mermaid.ts'

describe('resolveSubgraphMembership', () => {
  test('the first subgraph to close keeps a node; later ones drop it; each lists it once', () => {
    expect(resolveSubgraphMembership([
      { id: 'S0', members: ['A', 'A'] },
      { id: 'S1', members: ['A', 'B', ' ', 'B'] },
      { id: 'S2', members: ['S0', 'S1', 'B', 'C'] },
    ])).toEqual([
      { id: 'S0', members: ['A'] },
      { id: 'S1', members: ['B'] },
      { id: 'S2', members: ['S0', 'S1', 'C'] },
    ])
  })

  test('the incremental form closes one subgraph at a time and names each owner', () => {
    const membership = createSubgraphMembership()
    expect(membership.close('Inner', ['A', 'B'])).toEqual(['A', 'B'])
    expect(membership.close('Outer', ['Inner', 'A', 'C'])).toEqual(['Inner', 'C'])
    expect(['A', 'C', 'Inner', 'Z'].map(id => membership.ownerOf(id))).toEqual(['Inner', 'Outer', 'Outer', undefined])
  })
})

// A flowchart of one-node statements and nested subgraphs. Each subgraph's
// body mentions are known from the program, so the rule's input comes from
// the generator and its output is compared with upstream's DB.
type Item = { kind: 'node'; id: string } | { kind: 'subgraph'; body: Item[] }
const NODE_IDS = ['A', 'B', 'C', 'D']

const { program: programArb } = fc.letrec<{ item: Item; program: Item[] }>(tie => ({
  item: fc.oneof(
    { maxDepth: 3, depthIdentifier: 'membership' },
    { weight: 3, arbitrary: fc.constantFrom(...NODE_IDS).map(id => ({ kind: 'node' as const, id })) },
    fc.array(tie('item'), { minLength: 1, maxLength: 4, depthIdentifier: 'membership' }).map(body => ({ kind: 'subgraph' as const, body })),
  ),
  program: fc.array(tie('item'), { minLength: 1, maxLength: 5, depthIdentifier: 'membership' }),
}))

/** The source, and each subgraph's own mentions in close (post-)order. */
function compile(program: Item[]): { source: string; closeOrder: Array<{ id: string; members: string[] }> } {
  const lines = ['flowchart TD']
  const closeOrder: Array<{ id: string; members: string[] }> = []
  let next = 0
  const emit = (items: Item[], depth: number): string[] => items.map(item => {
    const indent = '  '.repeat(depth)
    if (item.kind === 'node') {
      lines.push(`${indent}${item.id}`)
      return item.id
    }
    const id = `S${next++}`
    lines.push(`${indent}subgraph ${id}`)
    const members = emit(item.body, depth + 1)
    lines.push(`${indent}end`)
    closeOrder.push({ id, members })
    return id
  })
  emit(program, 1)
  return { source: lines.join('\n'), closeOrder }
}

describe('pinned upstream Mermaid assigns subgraph members by the same rule', () => {
  let upstream: UpstreamMermaid
  beforeAll(() => {
    upstream = startUpstreamMermaid()
  })
  afterAll(() => upstream.close())

  test('every generated flowchart: resolved members equal upstream\'s subgraph lists', async () => {
    let contested = 0
    await fc.assert(fc.asyncProperty(programArb, async program => {
      const { source, closeOrder } = compile(program)
      const parsed = await upstream.parse(source)
      const theirs: unknown = parsed.ok ? parsed.flowchart?.subgraphs.map(({ id, nodes }) => ({ id, members: nodes })) : parsed.error
      expect({ source, members: resolveSubgraphMembership(closeOrder) as unknown }).toEqual({ source, members: theirs })
      const mentioned = closeOrder.flatMap(subgraph => subgraph.members)
      if (new Set(mentioned).size < mentioned.length) contested++
    }), { numRuns: 150 })
    // Non-vacuity: some programs mention one id in two subgraphs (or twice).
    expect(contested).toBeGreaterThan(0)
  }, 30_000)
})
