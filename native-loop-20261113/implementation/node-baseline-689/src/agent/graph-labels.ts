import type { MermaidGraph, MermaidSubgraph } from '../types.ts'

/** Read prose from the interpreted topology, including nested group titles. */
export function graphLabels(graph: MermaidGraph): Array<{ target: string; text: string }> {
  const labels = [...graph.nodes.values()].map(node => ({ target: node.id, text: node.label || node.id }))
  graph.edges.forEach((edge, index) => { if (edge.label) labels.push({ target: edge.id ?? `edge#${index}`, text: edge.label }) })
  const visit = (group: MermaidSubgraph): void => {
    labels.push({ target: group.id, text: group.label || group.id })
    group.children.forEach(visit)
  }
  graph.subgraphs.forEach(visit)
  return labels
}
