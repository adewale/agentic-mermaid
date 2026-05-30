// ============================================================================
// mutate: typed structural edits. Overloaded by family.
// ============================================================================

import type {
  FlowchartValidDiagram, SequenceValidDiagram, TimelineValidDiagram,
  ClassValidDiagram, ErValidDiagram, MutableValidDiagram,
  FlowchartMutationOp, SequenceMutationOp, TimelineMutationOp,
  ClassMutationOp, ErMutationOp, AnyMutationOp,
  MutationError, Result, SequenceParticipant, SequenceMessage,
  TimelineBody, TimelineSection, TimelinePeriod,
} from './types.ts'
import { ok, err } from './types.ts'
import type { MermaidGraph, MermaidNode, MermaidEdge } from '../types.ts'
import { mutateClass as _mutateClass } from './class-body.ts'
import { mutateEr as _mutateEr } from './er-body.ts'
import { renderMeta, renderTimeline } from './serialize.ts'
import { renderClass } from './class-body.ts'
import { renderEr } from './er-body.ts'

export function mutate(d: FlowchartValidDiagram, op: FlowchartMutationOp): Result<FlowchartValidDiagram, MutationError>
export function mutate(d: SequenceValidDiagram, op: SequenceMutationOp): Result<SequenceValidDiagram, MutationError>
export function mutate(d: TimelineValidDiagram, op: TimelineMutationOp): Result<TimelineValidDiagram, MutationError>
export function mutate(d: ClassValidDiagram, op: ClassMutationOp): Result<ClassValidDiagram, MutationError>
export function mutate(d: ErValidDiagram, op: ErMutationOp): Result<ErValidDiagram, MutationError>
export function mutate(
  d: MutableValidDiagram,
  op: AnyMutationOp,
): Result<MutableValidDiagram, MutationError> {
  if (d.body.kind === 'flowchart') return mutateFlowchart(d as FlowchartValidDiagram, op as FlowchartMutationOp)
  if (d.body.kind === 'sequence') return mutateSequence(d as SequenceValidDiagram, op as SequenceMutationOp)
  if (d.body.kind === 'timeline') return mutateTimeline(d as TimelineValidDiagram, op as TimelineMutationOp)
  if (d.body.kind === 'class') return mutateClass(d as ClassValidDiagram, op as ClassMutationOp)
  if (d.body.kind === 'er') return mutateEr(d as ErValidDiagram, op as ErMutationOp)
  return err({ code: 'INVALID_OP', message: `Unsupported mutable body kind: ${(d as { body: { kind: string } }).body.kind}` })
}

function mutateClass(d: ClassValidDiagram, op: ClassMutationOp): Result<ClassValidDiagram, MutationError> {
  const r = _mutateClass(d.body, op)
  if (!r.ok) return r
  const next: ClassValidDiagram = { ...d, body: r.value }
  const meta = renderMeta(d.meta)
  const canonicalSource = meta + renderClass(r.value)
  return ok({ ...next, canonicalSource })
}

function mutateEr(d: ErValidDiagram, op: ErMutationOp): Result<ErValidDiagram, MutationError> {
  const r = _mutateEr(d.body, op)
  if (!r.ok) return r
  const next: ErValidDiagram = { ...d, body: r.value }
  const meta = renderMeta(d.meta)
  const canonicalSource = meta + renderEr(r.value)
  return ok({ ...next, canonicalSource })
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

// ---- Sequence -------------------------------------------------------------

function mutateSequence(d: SequenceValidDiagram, op: SequenceMutationOp): Result<SequenceValidDiagram, MutationError> {
  const participants = d.body.participants.map(p => ({ ...p }))
  const messages = d.body.messages.map(m => ({ ...m }))

  switch (op.kind) {
    case 'add_participant': {
      if (participants.some(p => p.id === op.id)) return err({ code: 'DUPLICATE_PARTICIPANT', message: `Participant "${op.id}" already exists` })
      participants.push({ id: op.id, label: op.label ?? op.id, kind: op.participantKind ?? 'participant' })
      break
    }
    case 'remove_participant': {
      const idx = participants.findIndex(p => p.id === op.id)
      if (idx < 0) return err({ code: 'PARTICIPANT_NOT_FOUND', message: `Participant "${op.id}" not found` })
      participants.splice(idx, 1)
      return ok(rebuildSeq(d, participants, messages.filter(m => m.from !== op.id && m.to !== op.id)))
    }
    case 'add_message': {
      ensureParticipant(participants, op.from); ensureParticipant(participants, op.to)
      messages.push({ from: op.from, to: op.to, text: op.text, style: op.style ?? 'sync' })
      break
    }
    case 'remove_message': {
      if (op.index < 0 || op.index >= messages.length) return err({ code: 'MESSAGE_NOT_FOUND', message: `No message at index ${op.index}` })
      messages.splice(op.index, 1)
      break
    }
    case 'set_message_text': {
      if (op.index < 0 || op.index >= messages.length) return err({ code: 'MESSAGE_NOT_FOUND', message: `No message at index ${op.index}` })
      messages[op.index]!.text = op.text
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: `Unknown op: ${JSON.stringify(_x)}` })
    }
  }
  return ok(rebuildSeq(d, participants, messages))
}

function ensureParticipant(ps: SequenceParticipant[], id: string): void {
  if (!ps.some(p => p.id === id)) ps.push({ id, label: id, kind: 'participant' })
}

function rebuildSeq(d: SequenceValidDiagram, participants: SequenceParticipant[], messages: SequenceMessage[]): SequenceValidDiagram {
  return { ...d, body: { kind: 'sequence', participants, messages } } as SequenceValidDiagram
}

// ============================================================================
// Timeline mutation
// ============================================================================

function cloneTimeline(b: TimelineBody): TimelineBody {
  return {
    kind: 'timeline',
    title: b.title,
    sections: b.sections.map(s => ({
      id: s.id, label: s.label,
      periods: s.periods.map(p => ({ id: p.id, label: p.label, events: p.events.map(e => ({ id: e.id, text: e.text })) })),
    })),
  }
}

function makeTimelineIdAllocator(body: TimelineBody): (prefix: 'section' | 'period' | 'event') => string {
  const seen = new Set<string>()
  for (const s of body.sections) {
    seen.add(s.id)
    for (const p of s.periods) { seen.add(p.id); for (const e of p.events) seen.add(e.id) }
  }
  return prefix => {
    let n = 0
    while (seen.has(`${prefix}-${n}`)) n++
    const id = `${prefix}-${n}`
    seen.add(id)
    return id
  }
}

function normalizeTimelineMutationText(value: string): string {
  return value.split(/\r?\n/).map(part => part.trim()).filter(Boolean).join(' ')
}

function validTimelineMutationText(value: string, opts: { allowColon: boolean }): boolean {
  return value.length > 0 && (opts.allowColon || !value.includes(':'))
}

function normalizeTimelineOpText(value: string, opts: { field: string; allowColon?: boolean }): Result<string, MutationError> {
  if (typeof value !== 'string') return err({ code: 'INVALID_OP', message: `Timeline ${opts.field} must be a string` })
  const normalized = normalizeTimelineMutationText(value)
  if (!validTimelineMutationText(normalized, { allowColon: opts.allowColon ?? true })) {
    return err({ code: 'INVALID_OP', message: `Timeline ${opts.field} must be non-empty${opts.allowColon === false ? ' and must not contain :' : ''}` })
  }
  return ok(normalized)
}

function mutateTimeline(d: TimelineValidDiagram, op: TimelineMutationOp): Result<TimelineValidDiagram, MutationError> {
  const body = cloneTimeline(d.body)
  const nextTimelineId = makeTimelineIdAllocator(body)

  const getSection = (i: number): TimelineSection | undefined => body.sections[i]
  const getPeriod = (si: number, pi: number): TimelinePeriod | undefined => getSection(si)?.periods[pi]

  switch (op.kind) {
    case 'set_title': {
      if (op.title === null) delete body.title
      else {
        const title = normalizeTimelineOpText(op.title, { field: 'title' })
        if (!title.ok) return title
        body.title = title.value
      }
      break
    }
    case 'add_section': {
      const label = normalizeTimelineOpText(op.label, { field: 'section label' })
      if (!label.ok) return label
      body.sections.push({ id: nextTimelineId('section'), label: label.value, periods: [] })
      break
    }
    case 'remove_section': {
      if (!getSection(op.index)) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.index}` })
      body.sections.splice(op.index, 1)
      break
    }
    case 'set_section_label': {
      const s = getSection(op.index)
      if (!s) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.index}` })
      const label = normalizeTimelineOpText(op.label, { field: 'section label' })
      if (!label.ok) return label
      s.label = label.value
      break
    }
    case 'add_period': {
      const s = getSection(op.sectionIndex)
      if (!s) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.sectionIndex}` })
      const label = normalizeTimelineOpText(op.label, { field: 'period label', allowColon: false })
      if (!label.ok) return label
      const events: TimelinePeriod['events'] = []
      for (const raw of op.events ?? []) {
        const text = normalizeTimelineOpText(raw, { field: 'event text', allowColon: false })
        if (!text.ok) return text
        events.push({ id: nextTimelineId('event'), text: text.value })
      }
      const period: TimelinePeriod = {
        id: nextTimelineId('period'),
        label: label.value,
        events,
      }
      s.periods.push(period)
      break
    }
    case 'remove_period': {
      const s = getSection(op.sectionIndex)
      if (!s) return err({ code: 'SECTION_NOT_FOUND', message: `No section at index ${op.sectionIndex}` })
      if (!s.periods[op.periodIndex]) return err({ code: 'PERIOD_NOT_FOUND', message: `No period at index ${op.periodIndex}` })
      s.periods.splice(op.periodIndex, 1)
      if (s.label === undefined && s.periods.length === 0) body.sections.splice(op.sectionIndex, 1)
      break
    }
    case 'set_period_label': {
      const p = getPeriod(op.sectionIndex, op.periodIndex)
      if (!p) return err({ code: 'PERIOD_NOT_FOUND', message: `No period at (${op.sectionIndex},${op.periodIndex})` })
      const label = normalizeTimelineOpText(op.label, { field: 'period label', allowColon: false })
      if (!label.ok) return label
      p.label = label.value
      break
    }
    case 'add_event': {
      const p = getPeriod(op.sectionIndex, op.periodIndex)
      if (!p) return err({ code: 'PERIOD_NOT_FOUND', message: `No period at (${op.sectionIndex},${op.periodIndex})` })
      const text = normalizeTimelineOpText(op.text, { field: 'event text', allowColon: false })
      if (!text.ok) return text
      p.events.push({ id: nextTimelineId('event'), text: text.value })
      break
    }
    case 'remove_event': {
      const p = getPeriod(op.sectionIndex, op.periodIndex)
      if (!p) return err({ code: 'PERIOD_NOT_FOUND', message: `No period at (${op.sectionIndex},${op.periodIndex})` })
      if (!p.events[op.eventIndex]) return err({ code: 'EVENT_NOT_FOUND', message: `No event at index ${op.eventIndex}` })
      p.events.splice(op.eventIndex, 1)
      const section = getSection(op.sectionIndex)
      if (section && section.label === undefined && section.periods.length === 0) body.sections.splice(op.sectionIndex, 1)
      break
    }
    case 'set_event_text': {
      const p = getPeriod(op.sectionIndex, op.periodIndex)
      if (!p) return err({ code: 'PERIOD_NOT_FOUND', message: `No period at (${op.sectionIndex},${op.periodIndex})` })
      const e = p.events[op.eventIndex]
      if (!e) return err({ code: 'EVENT_NOT_FOUND', message: `No event at index ${op.eventIndex}` })
      const text = normalizeTimelineOpText(op.text, { field: 'event text', allowColon: false })
      if (!text.ok) return text
      e.text = text.value
      break
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: `Unknown op: ${JSON.stringify(_x)}` })
    }
  }
  const canonicalSource = renderMeta(d.meta) + renderTimeline(body)
  return ok({ ...d, body, canonicalSource } as TimelineValidDiagram)
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
