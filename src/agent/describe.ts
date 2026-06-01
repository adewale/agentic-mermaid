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
import { getFamily, extractLabelsGeneric } from './families.ts'
import './families-builtin.ts'

export interface DescribeOptions {
  /** 'text' (default): prose summary. 'json': structured AX tree (#7349). */
  format?: 'text' | 'json'
}

/** Structured accessibility tree (#7349): the graph as a list of nodes + edges. */
export interface DescribeTree {
  kind: string
  nodes: Array<{ id: string; label: string }>
  edges: Array<{ from: string; to: string; label?: string }>
  entryPoints: string[]
  sinks: string[]
}

export function describeMermaidSource(source: string, opts: DescribeOptions = {}): string {
  const r = parseMermaid(source)
  if (!r.ok) {
    const first = Array.isArray(r.error) ? r.error[0] : undefined
    if (opts.format === 'json') {
      return JSON.stringify({ error: first?.message ?? 'parse error', nodes: [], edges: [] })
    }
    return `Unparseable Mermaid source: ${first?.message ?? 'parse error'}.`
  }
  return describeMermaid(r.value, opts)
}

export function describeMermaid(d: ValidDiagram, opts: DescribeOptions = {}): string {
  if (opts.format === 'json') return JSON.stringify(describeMermaidTree(d))
  if (d.body.kind === 'flowchart') return describeFlowchart(d as FlowchartValidDiagram)
  if (d.body.kind === 'sequence') return describeSequence(d as SequenceValidDiagram)
  if (d.body.kind === 'timeline') return describeTimeline(d as TimelineValidDiagram)
  if (d.body.kind === 'class') return describeClass(d as ClassValidDiagram)
  if (d.body.kind === 'er') return describeEr(d as ErValidDiagram)
  if (d.body.kind === 'opaque') return describeOpaque(d.kind, d.body.source)
  return `A ${d.kind} diagram (structured editing not yet supported).`
}

/**
 * #7349: machine-readable accessibility tree — the graph as a flat node/edge
 * list with entry points and sinks. More useful to agents and screen-reader
 * tooling than prose. Covers the structured families; source-level/opaque
 * families expose extracted labels as nodes and no edges.
 */
export function describeMermaidTree(d: ValidDiagram): DescribeTree {
  const tree: DescribeTree = { kind: d.kind, nodes: [], edges: [], entryPoints: [], sinks: [] }
  if (d.body.kind === 'flowchart') {
    const g = d.body.graph
    for (const n of g.nodes.values()) tree.nodes.push({ id: n.id, label: n.label || n.id })
    for (const e of g.edges) tree.edges.push({ from: e.source, to: e.target, label: e.label || undefined })
  } else if (d.body.kind === 'sequence') {
    for (const p of d.body.participants) tree.nodes.push({ id: p.id, label: p.label || p.id })
    d.body.messages.forEach(m => tree.edges.push({ from: m.from, to: m.to, label: m.text || undefined }))
  } else if (d.body.kind === 'class') {
    for (const c of d.body.classes) tree.nodes.push({ id: c.id, label: c.label || c.id })
    for (const r of d.body.relations) tree.edges.push({ from: r.from, to: r.to, label: r.label || r.kind })
  } else if (d.body.kind === 'er') {
    for (const e of d.body.entities) tree.nodes.push({ id: e.id, label: e.id })
    for (const r of d.body.relations) tree.edges.push({ from: r.from, to: r.to, label: r.label || undefined })
  } else if (d.body.kind === 'timeline') {
    for (const s of d.body.sections) for (const p of s.periods) {
      tree.nodes.push({ id: p.id, label: p.label })
    }
  } else if (d.body.kind === 'opaque') {
    const plugin = getFamily(d.kind)
    const labels = (plugin?.extractLabels ?? extractLabelsGeneric)(d.body.source)
    labels.forEach((label, index) => tree.nodes.push({ id: label.target || `label-${index}`, label: label.text }))
  }
  // Entry points (no incoming) and sinks (no outgoing) from the edge list.
  const incoming = new Set(tree.edges.map(e => e.to))
  const outgoing = new Set(tree.edges.map(e => e.from))
  for (const n of tree.nodes) {
    if (!incoming.has(n.id) && outgoing.has(n.id)) tree.entryPoints.push(n.id)
    if (!outgoing.has(n.id) && incoming.has(n.id)) tree.sinks.push(n.id)
  }
  return tree
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

function describeOpaque(kind: ValidDiagram['kind'], source: string): string {
  const plugin = getFamily(kind)
  const labels = (plugin?.extractLabels ?? extractLabelsGeneric)(source).map(label => label.text)
  const unique = Array.from(new Set(labels)).filter(Boolean)
  const family = kind === 'xychart' ? 'XY chart' : kind
  let s = `A ${family} diagram with a source-level body (structured editing not exposed).`
  if (unique.length > 0) s += ` Labels: ${unique.join(', ')}.`
  return s
}
