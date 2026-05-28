// ============================================================================
// mutate: typed, total structural edits on a ValidDiagram
//
// Six MutationOp kinds: add_node, remove_node, rename_node, set_label,
// add_edge, remove_edge. Each is total — applies cleanly or returns a
// typed MutationError. By construction every reachable ValidDiagram
// produced by mutate is a parseable, serializable Mermaid program.
// ============================================================================

import type {
  ValidDiagram,
  MutationOp,
  MutationError,
  Result,
} from './types.ts'
import { ok, err } from './types.ts'
import type { MermaidGraph, MermaidNode, MermaidEdge } from '../types.ts'

export function mutate(
  d: ValidDiagram,
  op: MutationOp,
): Result<ValidDiagram, MutationError> {
  if (d.body.kind !== 'flowchart') {
    return err({
      code: 'UNSUPPORTED_FAMILY',
      message: `mutate is implemented for flowchart and state diagrams only; got ${d.kind}`,
    })
  }

  const graph = cloneGraph(d.body.graph)

  switch (op.kind) {
    case 'add_node':
      return applyAddNode(d, graph, op)
    case 'remove_node':
      return applyRemoveNode(d, graph, op)
    case 'rename_node':
      return applyRenameNode(d, graph, op)
    case 'set_label':
      return applySetLabel(d, graph, op)
    case 'add_edge':
      return applyAddEdge(d, graph, op)
    case 'remove_edge':
      return applyRemoveEdge(d, graph, op)
    default: {
      const exhaustiveCheck: never = op
      return err({
        code: 'INVALID_OP',
        message: `Unknown op kind: ${JSON.stringify(exhaustiveCheck)}`,
      })
    }
  }
}

// ---- Op implementations --------------------------------------------------

function applyAddNode(
  d: ValidDiagram,
  graph: MermaidGraph,
  op: Extract<MutationOp, { kind: 'add_node' }>,
): Result<ValidDiagram, MutationError> {
  if (graph.nodes.has(op.id)) {
    return err({
      code: 'DUPLICATE_NODE',
      message: `Node "${op.id}" already exists`,
    })
  }
  const node: MermaidNode = {
    id: op.id,
    label: op.label,
    shape: op.shape ?? 'rectangle',
  }
  graph.nodes.set(op.id, node)

  if (op.parent) {
    const parent = findSubgraph(graph, op.parent)
    if (!parent) {
      return err({
        code: 'INVALID_OP',
        message: `Parent group "${op.parent}" not found`,
      })
    }
    parent.nodeIds.push(op.id)
  }

  return ok(rebuild(d, graph))
}

function applyRemoveNode(
  d: ValidDiagram,
  graph: MermaidGraph,
  op: Extract<MutationOp, { kind: 'remove_node' }>,
): Result<ValidDiagram, MutationError> {
  if (!graph.nodes.has(op.id)) {
    return err({ code: 'NODE_NOT_FOUND', message: `Node "${op.id}" not found` })
  }
  graph.nodes.delete(op.id)
  graph.edges = graph.edges.filter(e => e.source !== op.id && e.target !== op.id)
  for (const sg of graph.subgraphs) {
    removeFromSubgraph(sg, op.id)
  }
  graph.classAssignments.delete(op.id)
  graph.nodeStyles.delete(op.id)
  return ok(rebuild(d, graph))
}

function applyRenameNode(
  d: ValidDiagram,
  graph: MermaidGraph,
  op: Extract<MutationOp, { kind: 'rename_node' }>,
): Result<ValidDiagram, MutationError> {
  if (!graph.nodes.has(op.from)) {
    return err({ code: 'NODE_NOT_FOUND', message: `Node "${op.from}" not found` })
  }
  if (graph.nodes.has(op.to)) {
    return err({
      code: 'DUPLICATE_NODE',
      message: `Cannot rename to "${op.to}" — already exists`,
    })
  }
  const node = graph.nodes.get(op.from)!
  graph.nodes.delete(op.from)
  // Preserve the prior label if it was equal to the prior id (idiomatic
  // case: `A --> B` declared nodes implicitly with id == label).
  const nextLabel = node.label === op.from ? op.to : node.label
  graph.nodes.set(op.to, { ...node, id: op.to, label: nextLabel })
  for (const e of graph.edges) {
    if (e.source === op.from) e.source = op.to
    if (e.target === op.from) e.target = op.to
  }
  for (const sg of graph.subgraphs) {
    renameInSubgraph(sg, op.from, op.to)
  }
  if (graph.classAssignments.has(op.from)) {
    graph.classAssignments.set(op.to, graph.classAssignments.get(op.from)!)
    graph.classAssignments.delete(op.from)
  }
  if (graph.nodeStyles.has(op.from)) {
    graph.nodeStyles.set(op.to, graph.nodeStyles.get(op.from)!)
    graph.nodeStyles.delete(op.from)
  }
  return ok(rebuild(d, graph))
}

function applySetLabel(
  d: ValidDiagram,
  graph: MermaidGraph,
  op: Extract<MutationOp, { kind: 'set_label' }>,
): Result<ValidDiagram, MutationError> {
  // First try node.
  if (graph.nodes.has(op.target)) {
    const n = graph.nodes.get(op.target)!
    graph.nodes.set(op.target, { ...n, label: op.label })
    return ok(rebuild(d, graph))
  }
  // Then try edge by id (we identify edges as `source->target`).
  const edgeIdx = findEdgeIndexById(graph, op.target)
  if (edgeIdx >= 0) {
    graph.edges[edgeIdx]!.label = op.label
    return ok(rebuild(d, graph))
  }
  return err({
    code: 'NODE_NOT_FOUND',
    message: `Target "${op.target}" matches no node or edge`,
  })
}

function applyAddEdge(
  d: ValidDiagram,
  graph: MermaidGraph,
  op: Extract<MutationOp, { kind: 'add_edge' }>,
): Result<ValidDiagram, MutationError> {
  ensureImplicitNode(graph, op.from)
  ensureImplicitNode(graph, op.to)
  const edge: MermaidEdge = {
    source: op.from,
    target: op.to,
    label: op.label,
    style: op.style ?? 'solid',
    hasArrowStart: false,
    hasArrowEnd: true,
  }
  graph.edges.push(edge)
  return ok(rebuild(d, graph))
}

function applyRemoveEdge(
  d: ValidDiagram,
  graph: MermaidGraph,
  op: Extract<MutationOp, { kind: 'remove_edge' }>,
): Result<ValidDiagram, MutationError> {
  const idx = findEdgeIndexById(graph, op.id)
  if (idx < 0) {
    return err({ code: 'EDGE_NOT_FOUND', message: `Edge "${op.id}" not found` })
  }
  graph.edges.splice(idx, 1)
  return ok(rebuild(d, graph))
}

// ---- Helpers -------------------------------------------------------------

/**
 * Edges don't have stable IDs in MermaidGraph. The agent surface uses
 * `${source}->${target}` as the canonical edge ID; when multiple edges
 * share endpoints, an index suffix `#0`, `#1` disambiguates.
 */
export function edgeIdOf(edge: MermaidEdge, sameEndpointIdx: number = 0): string {
  return sameEndpointIdx === 0
    ? `${edge.source}->${edge.target}`
    : `${edge.source}->${edge.target}#${sameEndpointIdx}`
}

function findEdgeIndexById(graph: MermaidGraph, id: string): number {
  const [endpoints, suffix] = id.split('#')
  const [from, to] = (endpoints ?? '').split('->')
  if (!from || !to) return -1
  const occurrence = suffix ? parseInt(suffix, 10) : 0
  let seen = 0
  for (let i = 0; i < graph.edges.length; i++) {
    const e = graph.edges[i]!
    if (e.source === from && e.target === to) {
      if (seen === occurrence) return i
      seen++
    }
  }
  return -1
}

function ensureImplicitNode(graph: MermaidGraph, id: string): void {
  if (!graph.nodes.has(id)) {
    graph.nodes.set(id, { id, label: id, shape: 'rectangle' })
  }
}

function findSubgraph(graph: MermaidGraph, id: string) {
  for (const sg of graph.subgraphs) {
    if (sg.id === id) return sg
    const child = findSubgraphIn(sg, id)
    if (child) return child
  }
  return null
}

function findSubgraphIn(sg: MermaidGraph['subgraphs'][number], id: string): MermaidGraph['subgraphs'][number] | null {
  for (const child of sg.children) {
    if (child.id === id) return child
    const found = findSubgraphIn(child, id)
    if (found) return found
  }
  return null
}

function removeFromSubgraph(sg: MermaidGraph['subgraphs'][number], id: string): void {
  sg.nodeIds = sg.nodeIds.filter(n => n !== id)
  for (const c of sg.children) removeFromSubgraph(c, id)
}

function renameInSubgraph(sg: MermaidGraph['subgraphs'][number], from: string, to: string): void {
  sg.nodeIds = sg.nodeIds.map(n => (n === from ? to : n))
  for (const c of sg.children) renameInSubgraph(c, from, to)
}

function cloneGraph(graph: MermaidGraph): MermaidGraph {
  return {
    direction: graph.direction,
    nodes: new Map(Array.from(graph.nodes, ([k, v]) => [k, { ...v }])),
    edges: graph.edges.map(e => ({ ...e })),
    subgraphs: graph.subgraphs.map(cloneSubgraph),
    classDefs: new Map(Array.from(graph.classDefs, ([k, v]) => [k, { ...v }])),
    classAssignments: new Map(graph.classAssignments),
    nodeStyles: new Map(Array.from(graph.nodeStyles, ([k, v]) => [k, { ...v }])),
    linkStyles: new Map(Array.from(graph.linkStyles, ([k, v]) => [k, { ...v }])),
  }
}

function cloneSubgraph(sg: MermaidGraph['subgraphs'][number]): MermaidGraph['subgraphs'][number] {
  return {
    id: sg.id,
    label: sg.label,
    nodeIds: [...sg.nodeIds],
    children: sg.children.map(cloneSubgraph),
    direction: sg.direction,
  }
}

function rebuild(d: ValidDiagram, graph: MermaidGraph): ValidDiagram {
  return {
    ...d,
    body: { kind: 'flowchart', graph },
  }
}
