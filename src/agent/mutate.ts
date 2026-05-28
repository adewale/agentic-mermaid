// ============================================================================
// mutate: typed, total structural edits.
//
// v3: overloaded by family. Flowchart and sequence diagrams have
// first-class structured mutation; other families don't typecheck.
// ============================================================================

import type {
  FlowchartValidDiagram,
  SequenceValidDiagram,
  FlowchartMutationOp,
  SequenceMutationOp,
  MutationError,
  Result,
} from './types.ts'
import { ok, err } from './types.ts'
import type { MermaidGraph, MermaidNode, MermaidEdge } from '../types.ts'

// ============================================================================
// mutate overloads
// ============================================================================

export function mutate(
  d: FlowchartValidDiagram,
  op: FlowchartMutationOp,
): Result<FlowchartValidDiagram, MutationError>
export function mutate(
  d: SequenceValidDiagram,
  op: SequenceMutationOp,
): Result<SequenceValidDiagram, MutationError>
export function mutate(
  d: FlowchartValidDiagram | SequenceValidDiagram,
  op: FlowchartMutationOp | SequenceMutationOp,
): Result<FlowchartValidDiagram | SequenceValidDiagram, MutationError> {
  if (d.body.kind === 'flowchart') {
    return mutateFlowchart(d as FlowchartValidDiagram, op as FlowchartMutationOp)
  }
  return mutateSequence(d as SequenceValidDiagram, op as SequenceMutationOp)
}

// ============================================================================
// Flowchart mutation
// ============================================================================

function mutateFlowchart(
  d: FlowchartValidDiagram,
  op: FlowchartMutationOp,
): Result<FlowchartValidDiagram, MutationError> {
  const graph = cloneGraph(d.body.graph)
  switch (op.kind) {
    case 'add_node':    return applyAddNode(d, graph, op)
    case 'remove_node': return applyRemoveNode(d, graph, op)
    case 'rename_node': return applyRenameNode(d, graph, op)
    case 'set_label':   return applySetLabel(d, graph, op)
    case 'add_edge':    return applyAddEdge(d, graph, op)
    case 'remove_edge': return applyRemoveEdge(d, graph, op)
    default: {
      const _exhaustive: never = op
      return err({ code: 'INVALID_OP', message: `Unknown op: ${JSON.stringify(_exhaustive)}` })
    }
  }
}

function applyAddNode(
  d: FlowchartValidDiagram,
  graph: MermaidGraph,
  op: Extract<FlowchartMutationOp, { kind: 'add_node' }>,
): Result<FlowchartValidDiagram, MutationError> {
  if (graph.nodes.has(op.id)) {
    return err({ code: 'DUPLICATE_NODE', message: `Node "${op.id}" already exists` })
  }
  graph.nodes.set(op.id, { id: op.id, label: op.label, shape: op.shape ?? 'rectangle' })
  if (op.parent) {
    const parent = findSubgraph(graph, op.parent)
    if (!parent) return err({ code: 'INVALID_OP', message: `Parent group "${op.parent}" not found` })
    parent.nodeIds.push(op.id)
  }
  return ok(rebuildFlowchart(d, graph))
}

function applyRemoveNode(
  d: FlowchartValidDiagram,
  graph: MermaidGraph,
  op: Extract<FlowchartMutationOp, { kind: 'remove_node' }>,
): Result<FlowchartValidDiagram, MutationError> {
  if (!graph.nodes.has(op.id)) {
    return err({ code: 'NODE_NOT_FOUND', message: `Node "${op.id}" not found` })
  }
  graph.nodes.delete(op.id)
  graph.edges = graph.edges.filter(e => e.source !== op.id && e.target !== op.id)
  for (const sg of graph.subgraphs) removeFromSubgraph(sg, op.id)
  graph.classAssignments.delete(op.id)
  graph.nodeStyles.delete(op.id)
  return ok(rebuildFlowchart(d, graph))
}

function applyRenameNode(
  d: FlowchartValidDiagram,
  graph: MermaidGraph,
  op: Extract<FlowchartMutationOp, { kind: 'rename_node' }>,
): Result<FlowchartValidDiagram, MutationError> {
  if (!graph.nodes.has(op.from)) {
    return err({ code: 'NODE_NOT_FOUND', message: `Node "${op.from}" not found` })
  }
  if (graph.nodes.has(op.to)) {
    return err({ code: 'DUPLICATE_NODE', message: `Cannot rename to "${op.to}" — already exists` })
  }
  const node = graph.nodes.get(op.from)!
  graph.nodes.delete(op.from)
  const nextLabel = node.label === op.from ? op.to : node.label
  graph.nodes.set(op.to, { ...node, id: op.to, label: nextLabel })
  for (const e of graph.edges) {
    if (e.source === op.from) e.source = op.to
    if (e.target === op.from) e.target = op.to
  }
  for (const sg of graph.subgraphs) renameInSubgraph(sg, op.from, op.to)
  if (graph.classAssignments.has(op.from)) {
    graph.classAssignments.set(op.to, graph.classAssignments.get(op.from)!)
    graph.classAssignments.delete(op.from)
  }
  if (graph.nodeStyles.has(op.from)) {
    graph.nodeStyles.set(op.to, graph.nodeStyles.get(op.from)!)
    graph.nodeStyles.delete(op.from)
  }
  return ok(rebuildFlowchart(d, graph))
}

function applySetLabel(
  d: FlowchartValidDiagram,
  graph: MermaidGraph,
  op: Extract<FlowchartMutationOp, { kind: 'set_label' }>,
): Result<FlowchartValidDiagram, MutationError> {
  if (graph.nodes.has(op.target)) {
    const n = graph.nodes.get(op.target)!
    graph.nodes.set(op.target, { ...n, label: op.label })
    return ok(rebuildFlowchart(d, graph))
  }
  const idx = findEdgeIndexById(graph, op.target)
  if (idx >= 0) {
    graph.edges[idx]!.label = op.label
    return ok(rebuildFlowchart(d, graph))
  }
  return err({ code: 'NODE_NOT_FOUND', message: `Target "${op.target}" matches no node or edge` })
}

function applyAddEdge(
  d: FlowchartValidDiagram,
  graph: MermaidGraph,
  op: Extract<FlowchartMutationOp, { kind: 'add_edge' }>,
): Result<FlowchartValidDiagram, MutationError> {
  ensureImplicitNode(graph, op.from)
  ensureImplicitNode(graph, op.to)
  graph.edges.push({
    source: op.from,
    target: op.to,
    label: op.label,
    style: op.style ?? 'solid',
    hasArrowStart: false,
    hasArrowEnd: true,
  })
  return ok(rebuildFlowchart(d, graph))
}

function applyRemoveEdge(
  d: FlowchartValidDiagram,
  graph: MermaidGraph,
  op: Extract<FlowchartMutationOp, { kind: 'remove_edge' }>,
): Result<FlowchartValidDiagram, MutationError> {
  const idx = findEdgeIndexById(graph, op.id)
  if (idx < 0) return err({ code: 'EDGE_NOT_FOUND', message: `Edge "${op.id}" not found` })
  graph.edges.splice(idx, 1)
  return ok(rebuildFlowchart(d, graph))
}

// ============================================================================
// Sequence mutation
// ============================================================================

function mutateSequence(
  d: SequenceValidDiagram,
  op: SequenceMutationOp,
): Result<SequenceValidDiagram, MutationError> {
  const participants = d.body.participants.map(p => ({ ...p }))
  const messages = d.body.messages.map(m => ({ ...m }))

  switch (op.kind) {
    case 'add_participant': {
      if (participants.some(p => p.id === op.id)) {
        return err({ code: 'DUPLICATE_PARTICIPANT', message: `Participant "${op.id}" already exists` })
      }
      participants.push({
        id: op.id,
        label: op.label ?? op.id,
        kind: op.participantKind ?? 'participant',
      })
      break
    }
    case 'remove_participant': {
      const idx = participants.findIndex(p => p.id === op.id)
      if (idx < 0) return err({ code: 'PARTICIPANT_NOT_FOUND', message: `Participant "${op.id}" not found` })
      participants.splice(idx, 1)
      // Cascade: drop messages that reference the removed participant.
      const filtered = messages.filter(m => m.from !== op.id && m.to !== op.id)
      return ok(rebuildSequence(d, participants, filtered))
    }
    case 'add_message': {
      ensureParticipant(participants, op.from)
      ensureParticipant(participants, op.to)
      messages.push({
        from: op.from,
        to: op.to,
        text: op.text,
        style: op.style ?? 'sync',
      })
      break
    }
    case 'remove_message': {
      if (op.index < 0 || op.index >= messages.length) {
        return err({ code: 'MESSAGE_NOT_FOUND', message: `No message at index ${op.index}` })
      }
      messages.splice(op.index, 1)
      break
    }
    case 'set_message_text': {
      if (op.index < 0 || op.index >= messages.length) {
        return err({ code: 'MESSAGE_NOT_FOUND', message: `No message at index ${op.index}` })
      }
      messages[op.index]!.text = op.text
      break
    }
    default: {
      const _exhaustive: never = op
      return err({ code: 'INVALID_OP', message: `Unknown op: ${JSON.stringify(_exhaustive)}` })
    }
  }

  return ok(rebuildSequence(d, participants, messages))
}

function ensureParticipant(
  participants: import('./types.ts').SequenceParticipant[],
  id: string,
): void {
  if (!participants.some(p => p.id === id)) {
    participants.push({ id, label: id, kind: 'participant' })
  }
}

function rebuildSequence(
  d: SequenceValidDiagram,
  participants: import('./types.ts').SequenceParticipant[],
  messages: import('./types.ts').SequenceMessage[],
): SequenceValidDiagram {
  return {
    ...d,
    body: { kind: 'sequence', participants, messages },
  } as SequenceValidDiagram
}

// ---- shared flowchart helpers --------------------------------------------

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

interface SubgraphLike {
  id: string
  label: string
  nodeIds: string[]
  children: SubgraphLike[]
  direction?: import('../types.ts').Direction
}

function findSubgraph(graph: MermaidGraph, id: string): SubgraphLike | null {
  const search = (list: SubgraphLike[]): SubgraphLike | null => {
    for (const sg of list) {
      if (sg.id === id) return sg
      const child = search(sg.children)
      if (child) return child
    }
    return null
  }
  return search(graph.subgraphs as SubgraphLike[])
}

function removeFromSubgraph(sg: SubgraphLike, id: string): void {
  sg.nodeIds = sg.nodeIds.filter(n => n !== id)
  for (const c of sg.children) removeFromSubgraph(c, id)
}

function renameInSubgraph(sg: SubgraphLike, from: string, to: string): void {
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

function rebuildFlowchart(d: FlowchartValidDiagram, graph: MermaidGraph): FlowchartValidDiagram {
  return { ...d, body: { kind: 'flowchart', graph } } as FlowchartValidDiagram
}
