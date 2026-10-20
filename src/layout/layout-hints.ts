import type { ElkNode } from 'elkjs'
import type { GraphLayoutHints, MermaidGraph } from '../types.ts'

/** Hints only change layout metadata. Authored nodes and relationships are never removed. */
export function applyLayoutHints(root: ElkNode, graph: MermaidGraph, hints?: GraphLayoutHints): void {
  if (!hints) return
  const nodes = new Map<string, { node: ElkNode; parent: ElkNode }>()
  const visit = (parent: ElkNode) => {
    for (const node of parent.children ?? []) { nodes.set(node.id, { node, parent }); visit(node) }
  }
  visit(root)
  const requireNode = (id: string) => {
    const entry = nodes.get(id)
    if (!entry || !graph.nodes.has(id)) throw new Error(`LAYOUT_HINT_INVALID: unknown node "${id}"`)
    return entry
  }
  const rankedParents = new Set<ElkNode>()
  if (hints.ranks) {
    for (const [id, rank] of Object.entries(hints.ranks)) {
      const { node, parent } = requireNode(id)
      if (!Number.isSafeInteger(rank) || rank < 0 || rank > 10000) throw new Error(`LAYOUT_HINT_INVALID: rank for "${id}" must be an integer from 0 to 10000`)
      rankedParents.add(parent)
      parent.layoutOptions = { ...parent.layoutOptions, 'elk.partitioning.activate': 'true' }
      node.layoutOptions = { ...node.layoutOptions, 'elk.partitioning.partition': String(rank) }
    }
  }
  for (const parent of rankedParents) for (const node of parent.children ?? []) {
    node.layoutOptions = { 'elk.partitioning.partition': '0', ...node.layoutOptions }
  }
  const grouped = new Set<string>()
  for (const ids of hints.adjacent ?? []) {
    if (ids.length < 2) throw new Error('LAYOUT_HINT_INVALID: adjacent requires at least two nodes')
    const entries = ids.map(requireNode)
    const parent = entries[0]!.parent
    if (entries.some(entry => entry.parent !== parent)) throw new Error('LAYOUT_HINT_INVALID: adjacent nodes must share a container')
    if (ids.some(id => grouped.has(id)) || new Set(ids).size !== ids.length) throw new Error('LAYOUT_HINT_INVALID: a node can belong to only one adjacency group')
    ids.forEach(id => grouped.add(id))
    const children = parent.children!
    const first = Math.min(...entries.map(entry => children.indexOf(entry.node)))
    parent.children = [...children.slice(0, first), ...entries.map(entry => entry.node), ...children.slice(first).filter(node => !ids.includes(node.id))]
    parent.layoutOptions = { ...parent.layoutOptions, 'elk.layered.crossingMinimization.forceNodeModelOrder': 'true' }
  }
  const edgeIndices = new Map<string, number>()
  const occurrences = new Map<string, number>()
  graph.edges.forEach((edge, index) => {
    const pair = `${edge.source}->${edge.target}`
    const occurrence = occurrences.get(pair) ?? 0
    edgeIndices.set(occurrence ? `${pair}#${occurrence}` : pair, index)
    if (edge.id) edgeIndices.set(edge.id, index)
    occurrences.set(pair, occurrence + 1)
  })
  const preferred = new Set((hints.shortEdges ?? []).map(id => {
    const index = edgeIndices.get(id)
    if (index === undefined) throw new Error(`LAYOUT_HINT_INVALID: unknown edge "${id}"`)
    return index
  }))
  const prioritize = (container: ElkNode) => {
    for (const edge of container.edges ?? []) {
      const match = /^e(\d+)(?:_|$)/.exec(edge.id)
      if (match && preferred.has(Number(match[1]))) edge.layoutOptions = { ...edge.layoutOptions, 'elk.layered.priority.shortness': '100', 'elk.layered.priority.direction': '100' }
    }
    container.children?.forEach(prioritize)
  }
  prioritize(root)
}
