import type { ElkNode } from 'elkjs'
import type { MermaidGraph } from '../types.ts'
import { layoutMeasuredForest } from '../layout/measured-forest.ts'

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

/**
 * Linear, variable-size ordered forest layout. Rectangular, flat, unlabelled
 * forests need neither rank optimization nor crossing minimization. Subtree
 * spans keep siblings disjoint, and global depth bands keep parent-child
 * channels clear. Everything else stays with the existing ELK strategies.
 */
export function indexedForestLayout(
  graph: MermaidGraph,
  input: ElkNode,
  padding: number,
  nodeSpacing: number,
  layerSpacing: number,
): ElkNode | undefined {
  const children = input.children
  if (!children || children.length < 2 || graph.subgraphs.length > 0 || graph.stateNotes?.length
    || children.length !== graph.nodes.size || graph.edges.some(edge => edge.label !== undefined || (edge.length ?? 1) !== 1)
    || [...graph.nodes.values()].some(node => node.shape !== 'rectangle')
    || ![padding, nodeSpacing, layerSpacing].every(value => Number.isFinite(value) && value >= 0)
    || nodeSpacing === 0 || layerSpacing === 0) return undefined
  const ordinal = new Map(children.map((node, index) => [node.id, index]))
  const edges = graph.edges.map(edge => ({ source: ordinal.get(edge.source) ?? -1, target: ordinal.get(edge.target) ?? -1, minSpan: 1 }))
  const measured = layoutMeasuredForest({
    nodes: children.map(node => ({ id: node.id, width: node.width!, height: node.height! })),
    edges, direction: graph.direction, padding, nodeSpacing, layerSpacing,
  })
  if (!measured) return undefined
  return {
    ...input, width: measured.width, height: measured.height,
    children: children.map((node, index) => ({ ...node, ...measured.nodes[index]! })),
    edges: graph.edges.map((edge, index) => {
      const points = measured.edges[index]!.points
      return { id: `e${index}`, sources: [edge.source], targets: [edge.target], sections: [{
        id: `e${index}_s0`, startPoint: points[0]!, bendPoints: points.slice(1, -1), endPoint: points.at(-1)!,
      }] }
    }),
  }
}
