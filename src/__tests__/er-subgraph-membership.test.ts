// Which subgraph keeps an ER entity (BUG-11). Pinned Mermaid 11.16 has no ER
// subgraphs; upstream added them in 11.17 (erDiagram.jison, erDb.ts), with
// the flowchart rule: a subgraph lists what its own body names (each
// declaration, both ends of each relation, and each nested subgraph's id),
// and `makeUniq` lets the first subgraph to close keep an id, listed once.
// That rule is src/shared/subgraph-membership.ts, itself checked against
// pinned upstream's flowchart DB. Here both ER parsers must place entities as
// that rule does, for the TODO entry's case and for generated programs.

import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { asEr, parseRegisteredMermaid } from '../agent/index.ts'
import { parseErDiagram } from '../er/parser.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { resolveSubgraphMembership } from '../shared/subgraph-membership.ts'

interface Placement {
  /** Entities in creation order, each with the subgraph that keeps it. */
  entities: Array<[id: string, group?: string]>
  /** Subgraphs in source order, with their parent and kept entities (in the
   * order the subgraph's body named them). */
  groups: Array<[id: string, parent: string | undefined, entityIds: string[]]>
}

/** How the renderer and the typed body place the source's entities. The
 * typed body keeps no member lists: its subgraph members are the entities
 * that name it as their group, which must be the renderer's list as a set. */
function placements(source: string): { renderer: Placement; typed: Placement } {
  const drawn = parseErDiagram(normalizeMermaidSource(source).familyLines)
  const parsed = parseRegisteredMermaid(source)
  const er = parsed.ok ? asEr(parsed.value) : null
  if (!er) throw new Error(`typed body is not structured for:\n${source}`)
  const drawnMembers = new Map(drawn.groups.map(group => [group.id, group.entityIds]))
  return {
    renderer: {
      entities: drawn.entities.map(entity => entity.groupId ? [entity.id, entity.groupId] : [entity.id]),
      groups: drawn.groups.map(group => [group.id, group.parentId, group.entityIds]),
    },
    typed: {
      entities: er.body.entities.map(entity => entity.groupId ? [entity.id, entity.groupId] : [entity.id]),
      groups: (er.body.groups ?? []).map(group => {
        const members = new Set(er.body.entities.filter(entity => entity.groupId === group.id).map(entity => entity.id))
        // In the renderer's order when they are the same set, so a difference shows.
        const listed = drawnMembers.get(group.id) ?? []
        const ordered = listed.length === members.size && listed.every(id => members.has(id)) ? listed : [...members]
        return [group.id, group.parentId, ordered]
      }),
    },
  }
}

describe('ER subgraph membership, as upstream places entities', () => {
  test.each<[string, string, Placement]>([
    // The TODO entry's case: G2 closes first and keeps A; G1 does not list it.
    ['a relation keeps both ends in the first subgraph to close',
      'erDiagram\n  subgraph G2\n    C ||--o{ A : r\n  end\n  subgraph G1\n    A\n  end',
      { entities: [['C', 'G2'], ['A', 'G2']], groups: [['G2', undefined, ['C', 'A']], ['G1', undefined, []]] }],
    ['an inner subgraph closes before the outer one',
      'erDiagram\n  subgraph O\n    A\n    subgraph I\n      A\n    end\n  end',
      { entities: [['A', 'I']], groups: [['O', undefined, []], ['I', 'O', ['A']]] }],
    ['a relation inside a subgraph places an end first named at the top level',
      'erDiagram\n  A\n  subgraph G\n    A ||--o{ B : r\n  end',
      { entities: [['A', 'G'], ['B', 'G']], groups: [['G', undefined, ['A', 'B']]] }],
    ['a top-level statement places nothing',
      'erDiagram\n  subgraph G\n    A\n  end\n  B ||--o{ A : r',
      { entities: [['A', 'G'], ['B']], groups: [['G', undefined, ['A']]] }],
    ['a nested subgraph keeps an entity its parent names first',
      'erDiagram\n  subgraph P\n    A ||--o{ B : r\n    subgraph C\n      B\n    end\n  end',
      { entities: [['A', 'P'], ['B', 'C']], groups: [['P', undefined, ['A']], ['C', 'P', ['B']]] }],
  ])('%s', (_name, source, expected) => {
    expect({ source, ...placements(source) }).toEqual({ source, renderer: expected, typed: expected })
  })
})

// A program of declarations, relations and nested subgraphs over a few ids.
type Item =
  | { kind: 'declare'; id: string }
  | { kind: 'relate'; from: string; to: string }
  | { kind: 'subgraph'; body: Item[] }
const IDS = ['A', 'B', 'C', 'D', 'E']
const idArb = fc.constantFrom(...IDS)

const { program: programArb } = fc.letrec<{ item: Item; program: Item[] }>(tie => ({
  item: fc.oneof(
    { maxDepth: 3, depthIdentifier: 'er-membership' },
    { weight: 2, arbitrary: idArb.map(id => ({ kind: 'declare' as const, id })) },
    { weight: 2, arbitrary: fc.tuple(idArb, idArb).map(([from, to]) => ({ kind: 'relate' as const, from, to })) },
    fc.array(tie('item'), { minLength: 1, maxLength: 4, depthIdentifier: 'er-membership' }).map(body => ({ kind: 'subgraph' as const, body })),
  ),
  program: fc.array(tie('item'), { minLength: 1, maxLength: 6, depthIdentifier: 'er-membership' }),
}))

/** The source, and what the rule makes of it: creation order, each
 * subgraph's own mentions in close order, and the subgraphs in open order. */
function compile(program: Item[]): { source: string; expected: Placement } {
  const lines = ['erDiagram']
  const created: string[] = []
  const create = (id: string): string => {
    if (!created.includes(id)) created.push(id)
    return id
  }
  const closeOrder: Array<{ id: string; members: string[] }> = []
  const opened: string[] = []
  let next = 0
  const emit = (items: Item[], depth: number): string[] => items.flatMap(item => {
    const indent = '  '.repeat(depth)
    if (item.kind === 'declare') {
      lines.push(`${indent}${item.id}`)
      return [create(item.id)]
    }
    if (item.kind === 'relate') {
      lines.push(`${indent}${item.from} ||--o{ ${item.to} : r`)
      return [create(item.from), create(item.to)]
    }
    const id = `G${next++}`
    opened.push(id)
    lines.push(`${indent}subgraph ${id}`)
    const members = emit(item.body, depth + 1)
    lines.push(`${indent}end`)
    closeOrder.push({ id, members })
    return [id]
  })
  emit(program, 1)
  const kept = new Map(resolveSubgraphMembership(closeOrder).map(group => [group.id, group.members]))
  const owner = new Map([...kept].flatMap(([group, members]) => members.map(member => [member, group] as const)))
  return {
    source: lines.join('\n'),
    expected: {
      entities: created.map(id => owner.has(id) ? [id, owner.get(id)!] : [id]),
      groups: opened.map(id => [id, owner.get(id), kept.get(id)!.filter(member => IDS.includes(member))]),
    },
  }
}

describe('property: both ER parsers place entities by the first subgraph to close', () => {
  test('generated programs of declarations, relations and nested subgraphs', () => {
    let withSubgraphs = 0
    fc.assert(fc.property(programArb, program => {
      const { source, expected } = compile(program)
      if (source.includes('subgraph')) withSubgraphs++
      expect({ source, ...placements(source) }).toEqual({ source, renderer: expected, typed: expected })
    }), { numRuns: 300 })
    expect(withSubgraphs).toBeGreaterThan(0)
  })
})
