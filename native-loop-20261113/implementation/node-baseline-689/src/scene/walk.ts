import type { SceneNode } from './ir.ts'

/** Visit every Scene node in paint (pre-)order, descending into groups. */
export function visitSceneNodes(nodes: readonly SceneNode[], visit: (node: SceneNode) => void): void {
  for (const node of nodes) {
    visit(node)
    if (node.kind === 'group') visitSceneNodes(node.children.map(child => child.node), visit)
  }
}
