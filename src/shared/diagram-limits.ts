import type { ArchitectureDiagram } from '../architecture/types.ts'
import type { ClassDiagram, ClassNamespace } from '../class/types.ts'
import type { C4Body } from '../c4/types.ts'
import type { ErDiagram } from '../er/types.ts'
import type { MermaidGraph, MermaidSubgraph } from '../types.ts'

/** Host work budgets. Mermaid source, frontmatter, and Style cannot raise them. */
export const DIAGRAM_WORK_LIMITS = Object.freeze({ nodes: 5_000, edges: 5_000, nesting: 64 })
export type DiagramWorkResource = keyof typeof DIAGRAM_WORK_LIMITS

export class DiagramWorkLimitError extends RangeError {
  readonly code = 'DIAGRAM_WORK_LIMIT'

  readonly resource: DiagramWorkResource
  readonly requested: number

  constructor(resource: DiagramWorkResource, requested: number) {
    super(`DIAGRAM_WORK_LIMIT: expanded graph ${resource} ${requested} exceeds the host limit of ${DIAGRAM_WORK_LIMITS[resource]}; split the diagram or reduce its ${resource}`)
    this.name = 'DiagramWorkLimitError'
    this.resource = resource
    this.requested = requested
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
    // Leaves consume node work, but only containers add syntactic nesting.
    assertDiagramWorkLimit('nesting', node.children === undefined ? depth - 1 : depth)
    assertDiagramWorkLimit('nodes', ++nodes)
    edges += node.edges?.length ?? 0
    assertDiagramWorkLimit('edges', edges)
    assertDiagramWorkLimit('nodes', nodes + pending.length + (node.children?.length ?? 0))
    for (const child of node.children ?? []) pending.push({ node: child, depth: depth + 1 })
  }
}

/** Count authored namespaces before Class measurement or recursive ELK conversion. */
export function assertClassDiagramWork(diagram: ClassDiagram): void {
  let nodes = diagram.classes.length + diagram.notes.length
  assertDiagramWorkLimit('nodes', nodes + diagram.namespaces.length)
  assertDiagramWorkLimit('edges', diagram.relationships.length)
  const pending: Array<{ namespace: ClassNamespace; depth: number }> = diagram.namespaces.map(namespace => ({ namespace, depth: 1 }))
  const seen = new Set<ClassNamespace>()
  while (pending.length) {
    const { namespace, depth } = pending.pop()!
    if (seen.has(namespace)) throw new TypeError('Class namespaces must form a tree without repeated namespace objects')
    seen.add(namespace)
    assertDiagramWorkLimit('nesting', depth)
    assertDiagramWorkLimit('nodes', ++nodes + pending.length + namespace.children.length)
    for (const child of namespace.children) pending.push({ namespace: child, depth: depth + 1 })
  }
}

/** ER frames are authored work even when their entities use a flat ELK graph. */
export function assertErDiagramWork(diagram: ErDiagram): void {
  assertFlatGroupWork(diagram.entities.length, diagram.relationships.length, diagram.groups, 'ER')
}

export function assertArchitectureDiagramWork(diagram: ArchitectureDiagram): void {
  assertFlatGroupWork(diagram.services.length + diagram.junctions.length, diagram.edges.length, diagram.groups, 'Architecture')
}

/** C4 lays out relationships and authored direction constraints independently. */
export function assertC4DiagramWork(diagram: C4Body): void {
  assertFlatGroupWork(diagram.elements.length, diagram.relationships.length + diagram.layout.hints.length, diagram.boundaries, 'C4')
  const boundaries = new Set(diagram.boundaries.map(boundary => boundary.id))
  const identities = new Set(boundaries)
  for (const element of diagram.elements) {
    if (identities.has(element.id)) throw new TypeError(`C4 elements and boundaries must have distinct identities: ${element.id}`)
    identities.add(element.id)
  }
  for (const item of [...diagram.elements, ...diagram.boundaries]) {
    if (item.parentId !== undefined && !boundaries.has(item.parentId)) throw new TypeError(`C4 ${item.id} has no boundary parent ${item.parentId}`)
  }
}

function assertFlatGroupWork(leaves: number, edges: number, authoredGroups: readonly { id: string; parentId?: string }[], family: string): void {
  assertDiagramWorkLimit('nodes', leaves + authoredGroups.length)
  assertDiagramWorkLimit('edges', edges)
  const groups = new Map(authoredGroups.map(group => [group.id, group]))
  if (groups.size !== authoredGroups.length) throw new TypeError(`${family} groups must have distinct identities`)
  const depths = new Map<string, number>()
  for (const group of authoredGroups) {
    const path: string[] = []
    const seen = new Set<string>()
    let current: typeof group | undefined = group
    while (current && !depths.has(current.id)) {
      if (seen.has(current.id)) throw new TypeError(`${family} groups must form an acyclic hierarchy`)
      seen.add(current.id)
      path.push(current.id)
      assertDiagramWorkLimit('nesting', path.length)
      current = current.parentId === undefined ? undefined : groups.get(current.parentId)
    }
    let depth = current ? depths.get(current.id)! : 0
    for (const id of path.reverse()) {
      assertDiagramWorkLimit('nesting', ++depth)
      depths.set(id, depth)
    }
  }
}
