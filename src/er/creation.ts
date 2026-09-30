// ============================================================================
// ER creation and placement: which statement creates an entity, and which
// subgraph keeps it. One fold, used by the renderer parser (src/er/parser.ts),
// the typed body, and the typed serializer (src/agent/er-body.ts), which
// folds the statements it writes to know where re-reading them puts each
// entity.
//
// The rules (upstream erDiagram.jison and erDb.ts; ER subgraphs are 11.17's):
//   - the first statement that names an entity creates it: a declaration
//     (bare, aliased, or with attributes) or either end of a relation, first
//     end first. Here, unlike upstream, a `style` line creates one too;
//   - a relation end that names a subgraph opened before it is that
//     subgraph's boundary, not an entity;
//   - the first alias an entity is given is its alias (erDb.addEntity);
//   - each subgraph lists what its own body names (declarations, both ends of
//     each relation, and each nested subgraph's id), and the first subgraph
//     to close keeps an id (src/shared/subgraph-membership.ts). A `style`
//     line names nothing, and a top-level statement places nothing.
// ============================================================================

import { createSubgraphMembership } from '../shared/subgraph-membership.ts'
import { syntaxError } from '../shared/syntax-error.ts'

export interface ErPlacedGroup {
  id: string
  /** The subgraph that keeps this one (the one around it). */
  parentId?: string
  /** The entities it keeps, in the order its body named them. */
  entityIds: string[]
}

export interface ErPlacement {
  /** Entity ids in creation order. */
  order: string[]
  /** Each entity's first alias, as its statement wrote it. */
  alias: ReadonlyMap<string, string>
  /** The subgraph that keeps each entity or nested subgraph. */
  owner: ReadonlyMap<string, string>
  /** Subgraphs in the order they open. */
  groups: ErPlacedGroup[]
}

export interface ErCreationFold {
  /** A `subgraph` header. Throws on a subgraph id already used. */
  open(id: string): void
  /** An `end` that closes the innermost open subgraph. */
  close(): void
  /** The innermost open subgraph, if any. */
  readonly innermost: string | undefined
  /** A declaration names an entity, perhaps with an alias. */
  declare(id: string, alias?: string): void
  /** A relation end names an entity, or the boundary of a subgraph opened
   * before it; true when it is an entity. */
  relationEnd(id: string, alias?: string): boolean
  /** A `style` line names an entity: it creates it and places nothing. */
  style(id: string): void
  /** Has a statement created this entity yet? */
  created(id: string): boolean
  /** The placement, once every subgraph has closed. */
  finish(): ErPlacement
}

export function createErCreationFold(): ErCreationFold {
  const order: string[] = []
  const created = new Set<string>()
  const alias = new Map<string, string>()
  const opened: string[] = []
  const openedIds = new Set<string>()
  const stack: Array<{ id: string; names: string[] }> = []
  const kept = new Map<string, string[]>()
  const membership = createSubgraphMembership()
  const create = (id: string): void => {
    if (!created.has(id)) { created.add(id); order.push(id) }
  }
  const name = (id: string, given?: string): void => {
    create(id)
    if (given !== undefined && !alias.has(id)) alias.set(id, given)
    stack.at(-1)?.names.push(id)
  }
  return {
    open(id) {
      if (openedIds.has(id)) throw new Error(`Duplicate ER subgraph id '${id}'`)
      openedIds.add(id)
      opened.push(id)
      stack.push({ id, names: [] })
    },
    close() {
      const group = stack.pop()
      if (!group) throw new Error('ER `end` closes no subgraph')
      kept.set(group.id, membership.close(group.id, group.names))
      stack.at(-1)?.names.push(group.id)
    },
    get innermost() {
      return stack.at(-1)?.id
    },
    declare: name,
    relationEnd(id, given) {
      if (openedIds.has(id)) return false
      name(id, given)
      return true
    },
    style: create,
    created: id => created.has(id),
    finish() {
      const open = stack.at(-1)
      if (open) {
        throw syntaxError({
          what: `ER subgraph '${open.id}' is never closed`,
          expectedForm: 'each subgraph closed by an end line',
          example: 'subgraph G\n  A\nend',
        })
      }
      const owner = new Map<string, string>()
      for (const id of [...order, ...opened]) {
        const keeper = membership.ownerOf(id)
        if (keeper !== undefined) owner.set(id, keeper)
      }
      return {
        order,
        alias,
        owner,
        groups: opened.map(id => ({
          id,
          ...(owner.has(id) ? { parentId: owner.get(id)! } : {}),
          entityIds: kept.get(id)!.filter(member => created.has(member)),
        })),
      }
    },
  }
}
