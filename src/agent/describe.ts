// ============================================================================
// describeMermaid — natural-language summary of a diagram.
//
// Loop 9 M12. Returns a one- or two-sentence prose summary per family covering
// entities, edges, and notable structure. Intended for screen-reader output,
// doc generation, and LLM context compaction without re-parsing.
//
// Library: describeMermaid(d, opts?) — accepts a ValidDiagram. Convenience
// describeMermaidSource(source) wraps parseMermaid for callers (CLI/MCP) that
// only have a string.
// ============================================================================

import { parseMermaid } from './parse.ts'
import type {
  ValidDiagram, FlowchartValidDiagram, SequenceValidDiagram, TimelineValidDiagram,
  ClassValidDiagram, ErValidDiagram,
} from './types.ts'

export interface DescribeOptions {
  /** Reserved — currently always returns text. JSON shape is in scope for a future loop. */
  format?: 'text' | 'json'
}

export function describeMermaidSource(source: string, opts: DescribeOptions = {}): string {
  const r = parseMermaid(source)
  if (!r.ok) {
    const first = Array.isArray(r.error) ? r.error[0] : undefined
    return `Unparseable Mermaid source: ${first?.message ?? 'parse error'}.`
  }
  return describeMermaid(r.value, opts)
}

export function describeMermaid(d: ValidDiagram, _opts: DescribeOptions = {}): string {
  if (d.body.kind === 'flowchart') return describeFlowchart(d as FlowchartValidDiagram)
  if (d.body.kind === 'sequence') return describeSequence(d as SequenceValidDiagram)
  if (d.body.kind === 'timeline') return describeTimeline(d as TimelineValidDiagram)
  if (d.body.kind === 'class') return describeClass(d as ClassValidDiagram)
  if (d.body.kind === 'er') return describeEr(d as ErValidDiagram)
  return `A ${d.kind} diagram (structured editing not yet supported).`
}

function describeFlowchart(d: FlowchartValidDiagram): string {
  const g = d.body.graph
  const nodes = Array.from(g.nodes.values())
  const nodeIds = nodes.map(n => n.id)
  const edges = g.edges
  const labels = nodes.map(n => n.label || n.id)
  const incoming = new Map<string, number>()
  const outgoing = new Map<string, number>()
  for (const id of nodeIds) { incoming.set(id, 0); outgoing.set(id, 0) }
  for (const e of edges) {
    outgoing.set(e.source, (outgoing.get(e.source) ?? 0) + 1)
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1)
  }
  const entries = nodeIds.filter(id => (incoming.get(id) ?? 0) === 0 && (outgoing.get(id) ?? 0) > 0)
  const sinks = nodeIds.filter(id => (outgoing.get(id) ?? 0) === 0 && (incoming.get(id) ?? 0) > 0)
  const edgeStr = edges.map(e => {
    const lbl = e.label ? ` (${e.label})` : ''
    return `${e.source} -> ${e.target}${lbl}`
  })
  let s = `A ${nodes.length}-node flowchart with ${edges.length} edges. Nodes: ${labels.join(', ')}.`
  if (edgeStr.length > 0) s += ` Edges: ${edgeStr.join('; ')}.`
  if (entries.length > 0) s += ` Entry points: ${entries.join(', ')}.`
  if (sinks.length > 0) s += ` Sinks: ${sinks.join(', ')}.`
  return s
}

function describeSequence(d: SequenceValidDiagram): string {
  const parts = d.body.participants
  const msgs = d.body.messages
  const partStr = parts.map(p => p.label || p.id).join(', ')
  const msgStr = msgs.map(m => `${m.from} -> ${m.to}: ${m.text}`)
  let s = `A sequence diagram between ${partStr || '(no participants)'}.`
  if (msgStr.length > 0) s += ` Messages in order: ${msgStr.join('; ')}.`
  return s
}

function describeTimeline(d: TimelineValidDiagram): string {
  const sections = d.body.sections
  const sectionLabels = sections.map(s => s.label || s.id)
  const periodLabels: string[] = []
  for (const s of sections) for (const p of s.periods) periodLabels.push(p.label)
  let s = `A timeline with ${sections.length} sections.`
  if (sectionLabels.length > 0) s += ` Sections: ${sectionLabels.join(', ')}.`
  if (periodLabels.length > 0) s += ` Periods: ${periodLabels.join(', ')}.`
  return s
}

function describeClass(d: ClassValidDiagram): string {
  const classes = d.body.classes
  const relations = d.body.relations
  const names = classes.map(c => c.id)
  const relStr = relations.map(r => `${r.from} ${r.kind} ${r.to}`)
  let s = `A class diagram with ${classes.length} classes.`
  if (names.length > 0) s += ` Classes: ${names.join(', ')}.`
  if (relStr.length > 0) s += ` Relations: ${relStr.join('; ')}.`
  return s
}

function describeEr(d: ErValidDiagram): string {
  const entities = d.body.entities
  const relations = d.body.relations
  const names = entities.map(e => e.id)
  const relStr = relations.map(r => {
    const lbl = r.label ? ` (${r.label})` : ''
    return `${r.from} ${r.leftCard}-${r.rightCard} ${r.to}${lbl}`
  })
  let s = `An ER diagram with ${entities.length} entities.`
  if (names.length > 0) s += ` Entities: ${names.join(', ')}.`
  if (relStr.length > 0) s += ` Relations: ${relStr.join('; ')}.`
  return s
}
