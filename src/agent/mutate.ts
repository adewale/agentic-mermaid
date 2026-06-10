// ============================================================================
// mutate: typed structural edits. Overloaded by family.
// ============================================================================

import type {
  FlowchartValidDiagram, SequenceValidDiagram, TimelineValidDiagram,
  ClassValidDiagram, ErValidDiagram, JourneyValidDiagram, MutableValidDiagram,
  FlowchartMutationOp, SequenceMutationOp, TimelineMutationOp,
  ClassMutationOp, ErMutationOp, JourneyMutationOp, AnyMutationOp,
  MutationError, Result, DiagramKind,
} from './types.ts'
import { ok, err } from './types.ts'
import type { MermaidGraph, MermaidNode, MermaidEdge } from '../types.ts'
import { renderMeta } from './serialize.ts'
import { getFamily } from './families.ts'
import './families-builtin.ts'  // registers built-in family mutate hooks

export function mutate(d: FlowchartValidDiagram, op: FlowchartMutationOp): Result<FlowchartValidDiagram, MutationError>
export function mutate(d: SequenceValidDiagram, op: SequenceMutationOp): Result<SequenceValidDiagram, MutationError>
export function mutate(d: TimelineValidDiagram, op: TimelineMutationOp): Result<TimelineValidDiagram, MutationError>
export function mutate(d: ClassValidDiagram, op: ClassMutationOp): Result<ClassValidDiagram, MutationError>
export function mutate(d: ErValidDiagram, op: ErMutationOp): Result<ErValidDiagram, MutationError>
export function mutate(d: JourneyValidDiagram, op: JourneyMutationOp): Result<JourneyValidDiagram, MutationError>
export function mutate(
  d: MutableValidDiagram,
  op: AnyMutationOp,
): Result<MutableValidDiagram, MutationError> {
  // Flowchart/state share the legacy graph body and stay in-tree (BUILD-3
  // exception). Every other structured family mutates through its
  // FamilyPlugin hook, then rebuilds canonicalSource from the new body so a
  // mutated diagram never carries stale source.
  if (d.body.kind === 'flowchart') return mutateFlowchart(d as FlowchartValidDiagram, op as FlowchartMutationOp)
  const plugin = getFamily(d.body.kind as DiagramKind)
  if (plugin?.mutate && plugin.serialize) {
    const r = plugin.mutate(d.body, op)
    if (!r.ok) return r
    const canonicalSource = renderMeta(d.meta) + plugin.serialize(r.value)
    return ok({ ...d, body: r.value, canonicalSource } as MutableValidDiagram)
  }
  return err({ code: 'INVALID_OP', message: `Unsupported mutable body kind: ${(d as { body: { kind: string } }).body.kind}` })
}

// ---- Flowchart ------------------------------------------------------------

function mutateFlowchart(d: FlowchartValidDiagram, op: FlowchartMutationOp): Result<FlowchartValidDiagram, MutationError> {
  const graph = cloneGraph(d.body.graph)
  switch (op.kind) {
    case 'add_node': {
      if (graph.nodes.has(op.id)) return err({ code: 'DUPLICATE_NODE', message: `Node "${op.id}" already exists` })
      graph.nodes.set(op.id, { id: op.id, label: op.label, shape: op.shape ?? 'rectangle' })
      if (op.parent) {
        const parent = findSubgraph(graph, op.parent)
        if (!parent) return err({ code: 'INVALID_OP', message: `Parent group "${op.parent}" not found` })
        parent.nodeIds.push(op.id)
      }
      return ok(rebuild(d, graph))
    }
    case 'remove_node': {
      if (!graph.nodes.has(op.id)) return err({ code: 'NODE_NOT_FOUND', message: `Node "${op.id}" not found` })
      graph.nodes.delete(op.id)
      graph.edges = graph.edges.filter(e => e.source !== op.id && e.target !== op.id)
      for (const sg of graph.subgraphs) removeFromSubgraph(sg, op.id)
      graph.classAssignments.delete(op.id)
      graph.nodeStyles.delete(op.id)
      return ok(rebuild(d, graph))
    }
    case 'rename_node': {
      if (!graph.nodes.has(op.from)) return err({ code: 'NODE_NOT_FOUND', message: `Node "${op.from}" not found` })
      if (graph.nodes.has(op.to)) return err({ code: 'DUPLICATE_NODE', message: `Cannot rename to "${op.to}" — already exists` })
      const node = graph.nodes.get(op.from)!
      graph.nodes.delete(op.from)
      graph.nodes.set(op.to, { ...node, id: op.to, label: node.label === op.from ? op.to : node.label })
      for (const e of graph.edges) {
        if (e.source === op.from) e.source = op.to
        if (e.target === op.from) e.target = op.to
      }
      for (const sg of graph.subgraphs) renameInSubgraph(sg, op.from, op.to)
      if (graph.classAssignments.has(op.from)) {
        graph.classAssignments.set(op.to, graph.classAssignments.get(op.from)!); graph.classAssignments.delete(op.from)
      }
      if (graph.nodeStyles.has(op.from)) {
        graph.nodeStyles.set(op.to, graph.nodeStyles.get(op.from)!); graph.nodeStyles.delete(op.from)
      }
      return ok(rebuild(d, graph))
    }
    case 'set_label': {
      if (graph.nodes.has(op.target)) {
        const n = graph.nodes.get(op.target)!
        graph.nodes.set(op.target, { ...n, label: op.label })
        return ok(rebuild(d, graph))
      }
      const idx = findEdgeIndexById(graph, op.target)
      if (idx >= 0) { graph.edges[idx]!.label = op.label; return ok(rebuild(d, graph)) }
      return err({ code: 'NODE_NOT_FOUND', message: `Target "${op.target}" matches no node or edge` })
    }
    case 'add_edge': {
      ensureNode(graph, op.from); ensureNode(graph, op.to)
      graph.edges.push({ source: op.from, target: op.to, label: op.label, style: op.style ?? 'solid', hasArrowStart: false, hasArrowEnd: true })
      return ok(rebuild(d, graph))
    }
    case 'remove_edge': {
      const idx = findEdgeIndexById(graph, op.id)
      if (idx < 0) return err({ code: 'EDGE_NOT_FOUND', message: `Edge "${op.id}" not found` })
      graph.edges.splice(idx, 1)
      return ok(rebuild(d, graph))
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: `Unknown op: ${JSON.stringify(_x)}` })
    }
  }
}

// ---- Flowchart helpers ----------------------------------------------------

export function edgeIdOf(edge: MermaidEdge, idx = 0): string {
  return idx === 0 ? `${edge.source}->${edge.target}` : `${edge.source}->${edge.target}#${idx}`
}

function findEdgeIndexById(graph: MermaidGraph, id: string): number {
  const [endpoints, suffix] = id.split('#')
  const [from, to] = (endpoints ?? '').split('->')
  if (!from || !to) return -1
  const occ = suffix ? parseInt(suffix, 10) : 0
  let seen = 0
  for (let i = 0; i < graph.edges.length; i++) {
    const e = graph.edges[i]!
    if (e.source === from && e.target === to) { if (seen === occ) return i; seen++ }
  }
  return -1
}

function ensureNode(graph: MermaidGraph, id: string): void {
  if (!graph.nodes.has(id)) graph.nodes.set(id, { id, label: id, shape: 'rectangle' })
}

type Subgraph = import('../types.ts').MermaidSubgraph

function findSubgraph(graph: MermaidGraph, id: string): Subgraph | null {
  const search = (list: Subgraph[]): Subgraph | null => {
    for (const sg of list) { if (sg.id === id) return sg; const c = search(sg.children); if (c) return c }
    return null
  }
  return search(graph.subgraphs)
}
function removeFromSubgraph(sg: Subgraph, id: string): void {
  sg.nodeIds = sg.nodeIds.filter(n => n !== id)
  for (const c of sg.children) removeFromSubgraph(c, id)
}
function renameInSubgraph(sg: Subgraph, from: string, to: string): void {
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
  return { id: sg.id, label: sg.label, nodeIds: [...sg.nodeIds], children: sg.children.map(cloneSubgraph), direction: sg.direction }
}
function rebuild(d: FlowchartValidDiagram, graph: MermaidGraph): FlowchartValidDiagram {
  return { ...d, body: { kind: 'flowchart', graph } } as FlowchartValidDiagram
}
