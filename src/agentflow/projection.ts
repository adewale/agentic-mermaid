import type { MermaidGraph, MermaidSubgraph, NodeShape } from '../types.ts'
import type { AgentflowBody, AgentflowRole } from './types.ts'

const shapes: Record<AgentflowRole, NodeShape> = { task: 'rounded', tool: 'subroutine', action: 'hexagon', input: 'lean-r', refdoc: 'rectangle', decision: 'diamond', connector: 'service' }

export function agentflowRoleShape(role: AgentflowRole): NodeShape { return shapes[role] }

/** Presentation consumes authored identities and family semantics. Collapsing
 * changes only the rendered endpoint projection, never the editable model. */
export function projectAgentflowGraph(body: AgentflowBody): MermaidGraph {
  const graph = structuredClone(body.graph)
  const hidden = new Set<string>(), owner = new Map<string, string>()
  const hide = (group: MermaidSubgraph, target: string): void => {
    hidden.add(group.id); owner.set(group.id, target)
    for (const id of group.nodeIds) { hidden.add(id); owner.set(id, target) }
    group.children.forEach(child => hide(child, target))
  }
  const groups = (items: MermaidSubgraph[]): MermaidSubgraph[] => items.flatMap(group => {
    if (body.metadata.get(group.id)?.view === 'collapsed') {
      group.nodeIds.forEach(id => { hidden.add(id); owner.set(id, group.id) })
      group.children.forEach(child => hide(child, group.id))
      graph.nodes.set(group.id, { id: group.id, label: group.label, labelContent: group.labelContent, shape: 'subroutine' })
      return []
    }
    const collapsed = group.children.filter(child => body.metadata.get(child.id)?.view === 'collapsed')
    group.children = groups(group.children)
    for (const child of collapsed) if (!group.nodeIds.includes(child.id)) group.nodeIds.push(child.id)
    return [group]
  })
  graph.subgraphs = groups(graph.subgraphs)
  for (const id of hidden) graph.nodes.delete(id)
  for (const [id, node] of graph.nodes) {
    const role = body.roles.get(id)
    if (role) node.shape = agentflowRoleShape(role)
    if (role === 'refdoc') { node.semanticShape = 'lin-doc'; node.authoredShape = 'lin-doc' }
    graph.classAssignments.set(id, [graph.classAssignments.get(id), `agentflow-${role ?? 'flow'}`].filter(Boolean).join(' '))
  }
  graph.edges = graph.edges.flatMap(edge => {
    const source = owner.get(edge.source) ?? edge.source, target = owner.get(edge.target) ?? edge.target
    if (source === target && edge.source !== edge.target) return []
    const data = edge.id ? body.metadata.get(edge.id) : undefined
    return [{ ...edge, source, target,
      ...(typeof data?.curve === 'string' ? { curve: data.curve } : {}),
      ...(typeof data?.animate === 'boolean' ? { animate: data.animate } : {}),
      ...(data?.animation === 'fast' || data?.animation === 'slow' ? { animation: data.animation } : {}) }]
  })
  return graph
}
