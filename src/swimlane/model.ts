import type { MermaidGraph, MermaidSubgraph } from '../types.ts'

export interface SwimlanePartition { id: string; label: string; source?: MermaidSubgraph; nodes: Set<string> }

/** Authored lane ownership is shared before either output lays out geometry. */
export function swimlanePartitions(graph: MermaidGraph): SwimlanePartition[] {
  const assigned = new Set<string>(), groupIds = new Set<string>()
  const descendants = (group: MermaidSubgraph, ids: Set<string>): void => {
    groupIds.add(group.id)
    for (const id of group.nodeIds) if (graph.nodes.has(id)) { ids.add(id); assigned.add(id) }
    group.children.forEach(child => descendants(child, ids))
  }
  const lanes: SwimlanePartition[] = graph.subgraphs.map(source => {
    const nodes = new Set<string>()
    descendants(source, nodes)
    return { id: source.id, label: source.label, source, nodes }
  })
  const loose = new Set([...graph.nodes.keys()].filter(id => !assigned.has(id) && !groupIds.has(id)))
  if (loose.size) {
    let id = '__swimlane_default__'
    while (graph.nodes.has(id) || groupIds.has(id)) id += '_'
    lanes.push({ id, label: '', nodes: loose })
  }
  return lanes
}
