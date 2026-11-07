import type { RailroadNode } from './types.ts'

/** Rules are occurrences: Mermaid permits the same production name twice. */
export const railroadRuleId = (index: number, name: string): string => `rule#${index}:${name}`

/** These exact reductions determine which grammar owners the drawing exposes. */
export function railroadDisplayNode(node: RailroadNode): RailroadNode {
  while (node.type === 'repetition') {
    if (node.max === 0) return { type: 'sequence', elements: [] }
    if (node.min === 1 && node.max === 1) { node = node.element; continue }
    if (node.min === 0 && node.max === 1) return { type: 'optional', element: node.element }
    break
  }
  return node
}

/** Child ordinals belong to the displayed expression, including operator
 * labels and the empty optional branch; maps and labels use the same IDs. */
export function railroadDisplayChildren(node: RailroadNode): readonly RailroadNode[] {
  switch (node.type) {
    case 'sequence': return node.elements
    case 'choice': return node.alternatives
    case 'optional': return [{ type: 'sequence', elements: [] }, node.element]
    case 'predicate': return [{ type: 'special', text: `lookahead ${node.operator}` }, node.element]
    case 'exception': return [node.base, { type: 'special', text: 'except' }, node.except]
    case 'repetition': return [node.element]
    default: return []
  }
}

export function walkRailroadOwners(root: RailroadNode, id: string, visit: (node: RailroadNode, id: string) => void): void {
  const pending = [{ node: root, id }]
  while (pending.length) {
    const current = pending.pop()!, node = railroadDisplayNode(current.node)
    visit(node, current.id)
    const children = railroadDisplayChildren(node)
    for (let index = children.length - 1; index >= 0; index--) pending.push({ node: children[index]!, id: `${current.id}/${index}` })
  }
}
