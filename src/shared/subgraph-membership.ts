/**
 * Upstream's subgraph membership rule, for flowchart and ER subgraphs.
 *
 * Mermaid builds a subgraph's member list when the subgraph closes (`end`),
 * so an inner subgraph is finished before the one around it. It then keeps
 * each id once and drops any id that a subgraph closed earlier already holds
 * (`FlowDB.addSubGraph` → `makeUniq`, flowDb.ts in 11.16; `ErDB.addSubGraph`
 * → `makeUniq` from 11.17, which ER subgraphs first appear in). The first
 * subgraph to close keeps a node, and the node is listed once:
 *
 *   subgraph S0          S0 closes first and keeps A.
 *     A                  S1 lists A too, but A is S0's, so S1 is [B].
 *   end
 *   subgraph S1
 *     A
 *     B
 *   end
 *
 * The contract a parser must meet:
 *   - pass subgraphs in the order they CLOSE (post-order for nesting);
 *   - give each one the ids its own body mentions, in mention order, as
 *     upstream lists them: every node the body declares or references, and
 *     each nested subgraph's own id (not the nested subgraph's members);
 *   - pass trimmed ids. A blank id is dropped, as upstream drops it.
 */

export interface SubgraphMembers {
  readonly id: string
  readonly members: readonly string[]
}

/** Apply the rule to a whole diagram's subgraphs, given in close order. */
export function resolveSubgraphMembership<S extends SubgraphMembers>(closeOrder: readonly S[]): Array<S & { members: string[] }> {
  const membership = createSubgraphMembership()
  return closeOrder.map(subgraph => ({ ...subgraph, members: membership.close(subgraph.id, subgraph.members) }))
}

export interface SubgraphMembership {
  /** Close one subgraph: its members, deduplicated, less every id a
   * subgraph closed before it already keeps. */
  close(id: string, members: readonly string[]): string[]
  /** The subgraph that keeps `member`, if any has closed with it. */
  ownerOf(member: string): string | undefined
}

/** The same rule one `end` at a time, for a parser that finalises each
 * subgraph as it closes. */
export function createSubgraphMembership(): SubgraphMembership {
  const owners = new Map<string, string>()
  return {
    close(id, members) {
      const kept: string[] = []
      for (const member of members) {
        if (member.trim() === '' || owners.has(member)) continue
        owners.set(member, id)
        kept.push(member)
      }
      return kept
    },
    ownerOf: member => owners.get(member),
  }
}
