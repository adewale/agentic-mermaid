import type { MermaidGraph } from '../types.ts'

export function isIndexedForestGraph(graph: MermaidGraph): boolean {
  if (graph.nodes.size < 2 || graph.subgraphs.length > 0 || graph.stateNotes?.length || graph.edges.length >= graph.nodes.size
    || [...graph.nodes.values()].some(node => node.shape !== 'rectangle')) return false
  const incoming = new Map<string, number>(), outgoing = new Map<string, string[]>()
  for (const edge of graph.edges) {
    if (edge.label !== undefined || (edge.length ?? 1) !== 1 || edge.source === edge.target
      || !graph.nodes.has(edge.source) || !graph.nodes.has(edge.target) || incoming.has(edge.target)) return false
    incoming.set(edge.target, 1)
    const peers = outgoing.get(edge.source)
    if (peers) peers.push(edge.target)
    else outgoing.set(edge.source, [edge.target])
  }
  const queue = [...graph.nodes.keys()].filter(id => !incoming.has(id))
  for (let cursor = 0; cursor < queue.length; cursor++) for (const child of outgoing.get(queue[cursor]!) ?? []) queue.push(child)
  return queue.length === graph.nodes.size
}

