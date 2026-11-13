import type { GraphLayoutOptions, MermaidGraph, RenderOptions } from '../types.ts'

/** New native dialects use the existing certified agentic producer only for
 * unconstrained forests. Caller choices and compound/domain constraints retain
 * their existing producer. One Kahn pass bounds admission to O(nodes + edges). */
export function nativeFamilyGraphLayout(graph: MermaidGraph, options: Pick<RenderOptions, 'graphLayout' | 'layoutHints'>): GraphLayoutOptions | undefined {
  if (options.graphLayout) return options.graphLayout
  if (options.layoutHints || graph.subgraphs.length) return undefined
  const indegree = new Map<string, number>(), children = new Map<string, string[]>()
  for (const id of graph.nodes.keys()) { indegree.set(id, 0); children.set(id, []) }
  for (const edge of graph.edges) {
    if (edge.source === edge.target || edge.curve || (edge.length ?? 1) > 1 || !indegree.has(edge.source) || !indegree.has(edge.target)) return undefined
    const degree = indegree.get(edge.target)! + 1
    if (degree > 1) return undefined
    indegree.set(edge.target, degree); children.get(edge.source)!.push(edge.target)
  }
  const queue = [...indegree].flatMap(([id, degree]) => degree === 0 ? [id] : [])
  for (let cursor = 0; cursor < queue.length; cursor++) for (const child of children.get(queue[cursor]!)!) {
    const remaining = indegree.get(child)! - 1
    indegree.set(child, remaining)
    if (!remaining) queue.push(child)
  }
  return queue.length === graph.nodes.size ? { backend: 'agentic', fallback: 'elk' } : undefined
}
