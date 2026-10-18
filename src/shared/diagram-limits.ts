import type { MermaidGraph, MermaidSubgraph } from '../types.ts'

/** Host work budgets. Mermaid source, frontmatter, and Style cannot raise them. */
export const DIAGRAM_WORK_LIMITS = Object.freeze({ nodes: 5_000, edges: 5_000, nesting: 64 })
export type DiagramWorkResource = keyof typeof DIAGRAM_WORK_LIMITS

export class DiagramWorkLimitError extends RangeError {
  readonly code = 'DIAGRAM_WORK_LIMIT'

  constructor(readonly resource: DiagramWorkResource, readonly requested: number) {
    super(`DIAGRAM_WORK_LIMIT: expanded graph ${resource} ${requested} exceeds the host limit of ${DIAGRAM_WORK_LIMITS[resource]}`)
    this.name = 'DiagramWorkLimitError'
  }
}

export function assertDiagramWorkLimit(resource: DiagramWorkResource, requested: number): void {
  if (requested > DIAGRAM_WORK_LIMITS[resource]) throw new DiagramWorkLimitError(resource, requested)
}

/** Admit programmatic graphs before recursive conversion, measurement, or layout. */
export function assertMermaidGraphWork(graph: MermaidGraph): void {
  assertDiagramWorkLimit('nodes', graph.nodes.size)
  assertDiagramWorkLimit('edges', graph.edges.length)
  assertDiagramWorkLimit('nodes', graph.nodes.size + graph.subgraphs.length)
  const pending: Array<{ group: MermaidSubgraph; depth: number }> = graph.subgraphs.map(group => ({ group, depth: 1 }))
  const seen = new Set<MermaidSubgraph>()
  let nodes = graph.nodes.size
  while (pending.length) {
    const { group, depth } = pending.pop()!
    if (seen.has(group)) throw new TypeError('Graph groups must form a tree without repeated group objects')
    seen.add(group)
    assertDiagramWorkLimit('nesting', depth)
    assertDiagramWorkLimit('nodes', ++nodes)
    assertDiagramWorkLimit('nodes', nodes + pending.length + group.children.length)
    for (const child of group.children) pending.push({ group: child, depth: depth + 1 })
  }
}

interface LayoutWorkNode {
  children?: readonly LayoutWorkNode[]
  edges?: readonly unknown[]
}

/** Also covers Class/ER and other adapters that construct ELK input directly. */
export function assertLayoutGraphWork(root: LayoutWorkNode): void {
  assertDiagramWorkLimit('nodes', root.children?.length ?? 0)
  const pending = (root.children ?? []).map(node => ({ node, depth: 1 }))
  const seen = new Set<LayoutWorkNode>([root])
  let nodes = 0
  let edges = root.edges?.length ?? 0
  assertDiagramWorkLimit('edges', edges)
  while (pending.length) {
    const { node, depth } = pending.pop()!
    if (seen.has(node)) throw new TypeError('Layout graph must form a tree without repeated node objects')
    seen.add(node)
    assertDiagramWorkLimit('nesting', depth)
    assertDiagramWorkLimit('nodes', ++nodes)
    edges += node.edges?.length ?? 0
    assertDiagramWorkLimit('edges', edges)
    assertDiagramWorkLimit('nodes', nodes + pending.length + (node.children?.length ?? 0))
    for (const child of node.children ?? []) pending.push({ node: child, depth: depth + 1 })
  }
}
