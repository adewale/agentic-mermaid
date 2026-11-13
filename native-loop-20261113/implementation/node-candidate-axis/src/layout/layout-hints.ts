import type { ElkNode } from 'elkjs'
import type { GraphLayoutHints, MermaidGraph } from '../types.ts'
import { edgeSelectorIndices } from '../shared/edge-selectors.ts'

function invalidHint(reason: string): never {
  throw new Error(`LAYOUT_HINT_INVALID: ${reason}`)
}

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
    if (!entry || !graph.nodes.has(id)) invalidHint(`unknown node "${id}"`)
    return entry
  }
  const rankedParents = new Set<ElkNode>()
  if (hints.ranks) {
    for (const [id, rank] of Object.entries(hints.ranks)) {
      const { node, parent } = requireNode(id)
      if (!Number.isSafeInteger(rank) || rank < 0 || rank > 10000) invalidHint(`rank for "${id}" must be an integer in [0,10000]`)
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
    if (ids.length < 2) invalidHint('adjacent needs two or more nodes')
    const entries = ids.map(requireNode)
    const parent = entries[0]!.parent
    if (entries.some(entry => entry.parent !== parent)) invalidHint('adjacent nodes need the same container')
    for (const id of ids) {
      if (grouped.has(id)) invalidHint('a node cannot repeat in adjacency groups')
      grouped.add(id)
    }
    const children = parent.children!
    const first = Math.min(...entries.map(entry => children.indexOf(entry.node)))
    parent.children = [...children.slice(0, first), ...entries.map(entry => entry.node), ...children.slice(first).filter(node => !ids.includes(node.id))]
    parent.layoutOptions = { ...parent.layoutOptions, 'elk.layered.crossingMinimization.forceNodeModelOrder': 'true' }
  }
  const edgeIndices = edgeSelectorIndices(graph.edges)
  const preferred = new Set((hints.shortEdges ?? []).map(id => {
    const index = edgeIndices.get(id)
    if (index === undefined) invalidHint(`unknown edge "${id}"`)
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
