// ============================================================================
// describeMermaid — natural-language summary of a diagram.
//
// Loop 9 M12. Returns a one- or two-sentence prose summary per family covering
// entities, edges, and notable structure. Intended for screen-reader output,
// doc generation, and LLM context compaction without re-parsing.
//
// Library: describeMermaid(d, opts?) — accepts a ValidDiagram. Convenience
// describeMermaidSource(source) wraps parseRegisteredMermaid for callers (CLI/MCP) that
// only have a string.
// ============================================================================

import { parseRegisteredMermaid } from './parse.ts'
import type {
  ValidDiagram, ParsedDiagram, FamilyId, FlowchartValidDiagram, SequenceValidDiagram, TimelineValidDiagram,
  ClassValidDiagram, ErValidDiagram,
} from './types.ts'
import { getFamily, extractLabelsGeneric } from './families.ts'
import { describeMermaidFacts } from './facts.ts'
import { parseGanttModel } from '../gantt/parser.ts'
import { resolveGanttSchedule, formatGanttInstant } from '../gantt/schedule.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { sequenceMessageContexts, sequenceMessages } from './sequence-body.ts'

export interface DescribeOptions {
  /** 'text' (default): prose summary. 'json': structured AX tree (#7349). 'facts': deterministic semantic facts. */
  format?: 'text' | 'json' | 'facts'
}

/** Structured accessibility tree (#7349): the graph as a list of nodes + edges. */
export interface DescribeTree {
  kind: string
  nodes: Array<{ id: string; label: string }>
  edges: Array<{
    from: string
    to: string
    label?: string
    sequence?: { fragmentIndex: number; branchIndex: number; fragmentKind: string; branchLabel?: string }
  }>
  entryPoints: string[]
  sinks: string[]
}

export function describeMermaidSource(source: string, opts: DescribeOptions = {}): string {
  const r = parseRegisteredMermaid(source)
  if (!r.ok) {
    const first = Array.isArray(r.error) ? r.error[0] : undefined
    if (opts.format === 'json') {
      return JSON.stringify({ error: first?.message ?? 'parse error', nodes: [], edges: [] })
    }
    if (opts.format === 'facts') return `error parse ${first?.message ?? 'parse error'}`
    return `Unparseable Mermaid source: ${first?.message ?? 'parse error'}.`
  }
  return describeMermaid(r.value, opts)
}

export function describeMermaid(d: ParsedDiagram, opts: DescribeOptions = {}): string {
  if (opts.format === 'json') return JSON.stringify(describeMermaidTree(d))
  if (opts.format === 'facts') return describeMermaidFacts(d).join('\n')
  if (d.body.kind === 'flowchart') return describeFlowchart(d as FlowchartValidDiagram)
  if (d.body.kind === 'state') return describeState(d.body)
  if (d.body.kind === 'sequence') return describeSequence(d as SequenceValidDiagram)
  if (d.body.kind === 'timeline') return describeTimeline(d as TimelineValidDiagram)
  if (d.body.kind === 'class') return describeClass(d as ClassValidDiagram)
  if (d.body.kind === 'er') return describeEr(d as ErValidDiagram)
  if (d.body.kind === 'journey') return describeJourney(d.body)
  if (d.body.kind === 'architecture') return describeArchitecture(d.body)
  if (d.body.kind === 'xychart') return describeXyChart(d.body)
  if (d.body.kind === 'gantt') return describeGantt(d as ValidDiagram & { body: import('./types.ts').GanttBody })
  if (d.body.kind === 'pie') return describePie(d.body)
  if (d.body.kind === 'quadrant') return describeQuadrant(d.body)
  if (d.body.kind === 'mindmap') return describeMindmap(d.body)
  if (d.body.kind === 'gitgraph') return describeGitGraph(d.body)
  if (d.body.kind === 'radar') {
    const axes = d.body.axes.map(a => a.label).join(', ')
    const curves = d.body.curves.map(c => c.label).join(', ')
    const title = d.body.title ? `"${d.body.title}" ` : ''
    return `A radar chart ${title}comparing ${d.body.curves.length} curve(s)${curves ? ` (${curves})` : ''} across ${d.body.axes.length} axis/axes${axes ? ` (${axes})` : ''}.`
  }
  if (d.body.kind === 'opaque') return describeOpaque(d.kind, d.body.source)
  if (d.body.kind === 'extension') return describeOpaque(d.kind, d.body.source)
  if (d.body.kind === 'preserved') return `An unregistered ${d.body.preservation.upstreamFamilyId ?? d.body.preservation.header} diagram preserved as source. ${d.body.diagnostic.message}`
  // Exhaustiveness guard: a new family must declare its prose here. This is why
  // pie/quadrant silently fell through to a "not yet supported" line for months.
  const _never: never = d.body
  void _never
  return `A ${d.kind} diagram.`
}

/**
 * #7349: machine-readable accessibility tree — the graph as a flat node/edge
 * list with entry points and sinks. More useful to agents and screen-reader
 * tooling than prose. Covers the structured families; source-level/opaque
 * families expose extracted labels as nodes and no edges.
 */
export function describeMermaidTree(d: ParsedDiagram): DescribeTree {
  const tree: DescribeTree = { kind: d.kind, nodes: [], edges: [], entryPoints: [], sinks: [] }
  if (d.body.kind === 'flowchart') {
    const g = d.body.graph
    for (const n of g.nodes.values()) tree.nodes.push({ id: n.id, label: n.label || n.id })
    for (const e of g.edges) tree.edges.push({ from: e.source, to: e.target, label: e.label || undefined })
  } else if (d.body.kind === 'state') {
    const visit = (states: import('./types.ts').StateNode[], transitions: import('./types.ts').StateTransition[]) => {
      for (const s of states) {
        tree.nodes.push({ id: s.id, label: s.label || s.id })
        if (s.regions) for (const region of s.regions) visit(region.states, region.transitions)
        else if (s.states !== undefined) visit(s.states, s.transitions ?? [])
      }
      for (const t of transitions) tree.edges.push({ from: t.from, to: t.to, label: t.label || undefined })
    }
    visit(d.body.states, d.body.transitions)
  } else if (d.body.kind === 'sequence') {
    for (const p of d.body.participants) tree.nodes.push({ id: p.id, label: p.label || p.id })
    sequenceMessageContexts(d.body).forEach(context => {
      const m = context.message
      tree.edges.push({
        from: m.from, to: m.to, label: m.text || undefined,
        ...(context.scope === 'fragment' ? {
          sequence: {
            fragmentIndex: context.fragmentIndex,
            branchIndex: context.branchIndex,
            fragmentKind: context.fragmentKind,
            ...((context.branchLabel ?? (context.branchIndex === 0 ? context.fragmentLabel : undefined))
              ? { branchLabel: context.branchLabel ?? context.fragmentLabel }
              : {}),
          },
        } : {}),
      })
    })
  } else if (d.body.kind === 'class') {
    for (const c of d.body.classes) tree.nodes.push({ id: c.id, label: c.label || c.id })
    for (const r of d.body.relations) tree.edges.push({ from: r.from, to: r.to, label: r.label || r.kind })
  } else if (d.body.kind === 'er') {
    for (const e of d.body.entities) tree.nodes.push({ id: e.id, label: e.label || e.id })
    for (const r of d.body.relations) tree.edges.push({ from: r.from, to: r.to, label: r.label || undefined })
  } else if (d.body.kind === 'timeline') {
    for (const s of d.body.sections) for (const p of s.periods) {
      tree.nodes.push({ id: p.id, label: p.label })
    }
  } else if (d.body.kind === 'journey') {
    // Tasks carry their journey semantics (score + actors) in the label, the
    // same way pie embeds values and quadrant embeds coordinates — an agent
    // reading the tree can find the pain points without re-parsing source.
    for (const s of d.body.sections) for (const t of s.tasks) {
      const actors = t.actors.length ? `; ${t.actors.join(', ')}` : ''
      tree.nodes.push({ id: t.id, label: `${t.text} (score ${t.score}${actors})` })
    }
  } else if (d.body.kind === 'architecture') {
    for (const g of d.body.groups) tree.nodes.push({ id: g.id, label: g.label || g.id })
    for (const s of d.body.services) tree.nodes.push({ id: s.id, label: s.label || s.id })
    for (const j of d.body.junctions) tree.nodes.push({ id: j.id, label: j.id })
    for (const e of d.body.edges) tree.edges.push({ from: e.source.id, to: e.target.id, label: e.label || undefined })
  } else if (d.body.kind === 'xychart') {
    // Series are the nodes of an xychart AX tree; charts have no edges.
    for (const s of d.body.series) tree.nodes.push({ id: s.id, label: s.name || `${s.kind} series` })
  } else if (d.body.kind === 'gantt') {
    // Tasks are the nodes; after/until references are the edges, so the
    // generic entry/sink pass below reports dependency entry tasks and sinks.
    for (const s of d.body.sections) for (const t of s.tasks) {
      tree.nodes.push({ id: t.taskId ?? t.id, label: t.label })
    }
    const idOf = new Map<string, string>()
    for (const s of d.body.sections) for (const t of s.tasks) if (t.taskId) idOf.set(t.taskId, t.taskId)
    for (const s of d.body.sections) for (const t of s.tasks) {
      for (const [expr, label] of [[t.start, 'after'], [t.end, 'until']] as const) {
        const m = expr?.match(/^(?:after|until)\s+(.+)$/)
        if (!m || !expr!.startsWith(label)) continue
        for (const ref of m[1]!.split(/\s+/).filter(Boolean)) {
          if (idOf.has(ref)) tree.edges.push({ from: ref, to: t.taskId ?? t.id, label })
        }
      }
    }
  } else if (d.body.kind === 'pie') {
    // Slices are the nodes of a pie AX tree; charts have no edges.
    for (const sl of d.body.slices) tree.nodes.push({ id: sl.id, label: `${sl.label} (${sl.value})` })
  } else if (d.body.kind === 'quadrant') {
    // Plotted points are the nodes; quadrant charts have no edges.
    d.body.points.forEach((p, i) => tree.nodes.push({ id: `point-${i}`, label: `${p.label} [${p.x}, ${p.y}]` }))
  } else if (d.body.kind === 'mindmap') {
    const visit = (node: import('../mindmap/types.ts').MindmapNode, parent?: string): void => {
      tree.nodes.push({ id: node.id, label: node.label })
      if (parent) tree.edges.push({ from: parent, to: node.id })
      node.children.forEach(child => visit(child, node.id))
    }
    visit(d.body.root)
  } else if (d.body.kind === 'gitgraph') {
    for (const commit of d.body.commits) {
      tree.nodes.push({ id: commit.id, label: commit.message || commit.id })
      commit.parents.forEach(parent => tree.edges.push({ from: parent, to: commit.id, label: commit.source === 'commit' ? undefined : commit.source }))
    }
  } else if (d.body.kind === 'radar') {
    // Axes and curves are the nodes of a radar AX tree; charts have no edges.
    d.body.axes.forEach((a, i) => tree.nodes.push({ id: `axis-${i}`, label: a.label }))
    d.body.curves.forEach((c, i) => tree.nodes.push({ id: `curve-${i}`, label: c.label }))
  } else if (d.body.kind === 'opaque') {
    const plugin = getFamily(d.kind)
    const labels = (plugin?.extractLabels ?? extractLabelsGeneric)(d.body.source)
    labels.forEach((label, index) => tree.nodes.push({ id: label.target || `label-${index}`, label: label.text }))
  } else if (d.body.kind === 'extension') {
    const plugin = getFamily(d.kind)
    const labels = (plugin?.extractLabels ?? extractLabelsGeneric)(d.body.source)
    labels.forEach((label, index) => tree.nodes.push({ id: label.target || `label-${index}`, label: label.text }))
  } else if (d.body.kind === 'preserved') {
    // Preserved sources have no registered semantic contract to project.
  } else {
    // Exhaustiveness guard: a new structured family must add a node/edge branch
    // above rather than silently producing an empty accessibility tree.
    const _never: never = d.body
    void _never
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

function describeMindmap(body: import('./types.ts').MindmapBody): string {
  let count = 0
  let leaves = 0
  const top = body.root.children.map(node => node.label)
  const visit = (node: import('../mindmap/types.ts').MindmapNode): void => {
    count++
    if (node.children.length === 0) leaves++
    node.children.forEach(visit)
  }
  visit(body.root)
  return `A ${count}-node mindmap rooted at ${body.root.label}, with ${leaves} leaves.${top.length ? ` Main branches: ${top.join(', ')}.` : ''}`
}

function describeGitGraph(body: import('./types.ts').GitGraphBody): string {
  const merges = body.commits.filter(commit => commit.source === 'merge').length
  const cherries = body.commits.filter(commit => commit.source === 'cherry-pick').length
  return `A GitGraph with ${body.commits.length} commits across ${body.branches.length} branches, including ${merges} merges and ${cherries} cherry-picks. Branches: ${body.branches.map(branch => branch.name).join(', ')}.`
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

function describeState(body: import('./types.ts').StateBody): string {
  const flat: import('./types.ts').StateNode[] = []
  const allTransitions: import('./types.ts').StateTransition[] = []
  const collect = (states: import('./types.ts').StateNode[], transitions: import('./types.ts').StateTransition[]) => {
    for (const s of states) {
      flat.push(s)
      if (s.regions) for (const region of s.regions) collect(region.states, region.transitions)
      else if (s.states !== undefined) collect(s.states, s.transitions ?? [])
    }
    allTransitions.push(...transitions)
  }
  collect(body.states, body.transitions)
  const composites = flat.filter(s => s.states !== undefined || s.regions !== undefined)
  const stateLabels = flat.map(s => s.label || s.id)
  const transStr = allTransitions.map(t => {
    const lbl = t.label ? ` (${t.label})` : ''
    return `${t.from} -> ${t.to}${lbl}`
  })
  const starts = body.transitions.filter(t => t.from === '[*]').map(t => t.to)
  let s = `A state diagram with ${flat.length} states and ${allTransitions.length} transitions.`
  if (composites.length > 0) s += ` Composite states: ${composites.map(c => c.label || c.id).join(', ')}.`
  if (stateLabels.length > 0) s += ` States: ${stateLabels.join(', ')}.`
  const stereotypes = flat.filter(state => state.stereotype).map(state => `${state.label || state.id} (${state.stereotype})`)
  if (stereotypes.length > 0) s += ` Pseudostates: ${stereotypes.join(', ')}.`
  if ((body.notes ?? []).length > 0) {
    s += ` Notes: ${body.notes!.map(note => `${note.side} of ${note.target}: ${note.text}`).join('; ')}.`
  }
  if (transStr.length > 0) s += ` Transitions: ${transStr.join('; ')}.`
  if (starts.length > 0) s += ` Initial: ${starts.join(', ')}.`
  return s
}

function describeSequence(d: SequenceValidDiagram): string {
  const parts = d.body.participants
  const partStr = parts.map(p => p.label || p.id).join(', ')
  let s = `A sequence diagram between ${partStr || '(no participants)'}.`
  const interactions: string[] = []
  let fragmentIndex = 0
  for (const statement of d.body.statements) {
    if (statement.kind === 'message') {
      const message = d.body.messages[statement.ref]
      if (message) interactions.push(`message ${message.from} -> ${message.to}: ${message.text}`)
      continue
    }
    if (statement.kind !== 'fragment') continue
    const branches = statement.fragment.branches.map((branch, branchIndex) => {
      const label = branch.label ?? (branchIndex === 0 ? statement.fragment.label : undefined)
      const messages = branch.messages.map(m => `${m.from} -> ${m.to}: ${m.text}`).join('; ') || 'no messages'
      return `branch ${branchIndex}${label ? ` (${label})` : ''}: ${messages}`
    })
    interactions.push(`fragment ${fragmentIndex} (${statement.fragment.fragmentKind}): ${branches.join(' | ')}`)
    fragmentIndex++
  }
  if (interactions.length > 0) s += ` Interactions in source order: ${interactions.join('; ')}.`
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

function describeJourney(body: import('./types.ts').JourneyBody): string {
  const sections = body.sections
  const taskCount = sections.reduce((n, s) => n + s.tasks.length, 0)
  const actors = [...new Set(sections.flatMap(s => s.tasks.flatMap(t => t.actors)))]
  let s = `A user journey${body.title ? ` titled "${body.title}"` : ''} with ${sections.length} sections and ${taskCount} tasks.`
  const sectionLabels = sections.map(sec => sec.label).filter((l): l is string => l !== undefined)
  if (sectionLabels.length > 0) s += ` Sections: ${sectionLabels.join(', ')}.`
  const taskStr = sections.flatMap(sec => sec.tasks.map(t => `${t.text} (${t.score})`))
  if (taskStr.length > 0) s += ` Tasks: ${taskStr.join(', ')}.`
  if (actors.length > 0) s += ` Actors: ${actors.join(', ')}.`
  return s
}

function describeArchitecture(body: import('./types.ts').ArchitectureBody): string {
  const groups = body.groups
  const services = body.services
  const junctions = body.junctions
  const edges = body.edges
  let s = `An architecture diagram${body.title ? ` titled "${body.title}"` : ''} with ${groups.length} groups, ${services.length} services, and ${edges.length} connections.`
  if (body.accessibilityTitle) s += ` Accessible title: ${body.accessibilityTitle}.`
  if (body.accessibilityDescription) s += ` Accessible description: ${body.accessibilityDescription.replace(/\n/g, ' ')}.`
  if (groups.length > 0) s += ` Groups: ${groups.map(g => g.label || g.id).join(', ')}.`
  if (services.length > 0) s += ` Services: ${services.map(sv => sv.label || sv.id).join(', ')}.`
  if (junctions.length > 0) s += ` Junctions: ${junctions.map(j => j.id).join(', ')}.`
  const edgeStr = edges.map(e => `${e.source.id} -> ${e.target.id}${e.label ? ` (${e.label})` : ''}`)
  if (edgeStr.length > 0) s += ` Connections: ${edgeStr.join('; ')}.`
  return s
}

function describeXyChart(body: import('./types.ts').XyChartBody): string {
  const series = body.series
  const orientation = body.horizontal ? 'horizontal ' : ''
  let s = `An ${orientation}XY chart${body.title ? ` titled "${body.title}"` : ''} with ${series.length} series.`
  const axisDesc = (label: string, axis: import('./types.ts').XyChartAxis | undefined): string | undefined => {
    if (!axis) return undefined
    const parts: string[] = []
    if (axis.name !== undefined) parts.push(`"${axis.name}"`)
    if (axis.categories) parts.push(`categories ${axis.categories.join(', ')}`)
    if (axis.range) parts.push(`range ${axis.range.min}–${axis.range.max}`)
    return parts.length > 0 ? `${label}: ${parts.join(', ')}` : undefined
  }
  const axes = [axisDesc('x-axis', body.xAxis), axisDesc('y-axis', body.yAxis)].filter((a): a is string => a !== undefined)
  if (axes.length > 0) s += ` Axes — ${axes.join('; ')}.`
  const seriesStr = series.map(se => `${se.kind}${se.name ? ` ${se.name}` : ''} [${se.values.join(', ')}]`)
  if (seriesStr.length > 0) s += ` Series: ${seriesStr.join('; ')}.`
  return s
}

function describePie(body: import('./types.ts').PieBody): string {
  let s = `A pie chart${body.title ? ` titled "${body.title}"` : ''} with ${body.slices.length} slices.`
  const sliceStr = body.slices.map(sl => `${sl.label} (${sl.value})`)
  if (sliceStr.length > 0) s += ` Slices: ${sliceStr.join(', ')}.`
  return s
}

function describeQuadrant(body: import('./types.ts').QuadrantBody): string {
  let s = `A quadrant chart${body.title ? ` titled "${body.title}"` : ''} with ${body.points.length} points.`
  const regions = body.quadrants.filter((q): q is string => Boolean(q))
  if (regions.length > 0) s += ` Quadrants: ${regions.join(', ')}.`
  const pointStr = body.points.map(p => `${p.label} [${p.x}, ${p.y}]`)
  if (pointStr.length > 0) s += ` Points: ${pointStr.join(', ')}.`
  return s
}

function describeClass(d: ClassValidDiagram): string {
  const classes = d.body.classes
  const relations = d.body.relations
  const names = classes.map(c => c.generic ? `${c.id}<${c.generic}>` : c.id)
  const relStr = relations.map(r => `${r.from} ${r.kind} ${r.to}`)
  let s = `A class diagram with ${classes.length} classes.`
  if (names.length > 0) s += ` Classes: ${names.join(', ')}.`
  // Namespace membership (repo #118): name each namespace with its members.
  const namespaces = d.body.namespaces ?? []
  if (namespaces.length > 0) {
    const nsStr = namespaces.map(ns => {
      const members = classes.filter(c => c.namespace === ns.name).map(c => c.id)
      return `${ns.name} [${members.join(', ')}]`
    })
    s += ` Namespaces: ${nsStr.join('; ')}.`
  }
  if (relStr.length > 0) s += ` Relations: ${relStr.join('; ')}.`
  return s
}

function describeEr(d: ErValidDiagram): string {
  const entities = d.body.entities
  const relations = d.body.relations
  const names = entities.map(e => e.label ? `${e.id} ("${e.label}")` : e.id)
  const relStr = relations.map(r => {
    const lbl = r.label ? ` (${r.label})` : ''
    return `${r.from} ${r.leftCard}-${r.rightCard} ${r.to}${lbl}`
  })
  let s = `An ER diagram with ${entities.length} entities.`
  if (names.length > 0) s += ` Entities: ${names.join(', ')}.`
  if (relStr.length > 0) s += ` Relations: ${relStr.join('; ')}.`
  return s
}

function describeGantt(d: ValidDiagram & { body: import('./types.ts').GanttBody }): string {
  const body = d.body
  const tasks = body.sections.flatMap(s => s.tasks)
  let s = `A Gantt chart${body.title ? ` titled "${body.title}"` : ''} with ${body.sections.filter(sec => sec.label !== undefined).length} sections and ${tasks.length} tasks.`

  // Resolve the schedule for date range / critical path; raw expressions are
  // the fallback when the source needs context this body cannot see.
  try {
    const schedule = resolveGanttSchedule(parseGanttModel(toMermaidLines(d.canonicalSource)))
    const fmt = schedule.dateOnly ? '%Y-%m-%d' : '%Y-%m-%d %H:%M'
    s += ` Schedule: ${formatGanttInstant(schedule.timeMin, fmt)} to ${formatGanttInstant(schedule.timeMax, fmt)}.`
    if (schedule.analysis && schedule.analysis.criticalPathTaskIds.length > 0) {
      s += ` Critical path: ${schedule.analysis.criticalPathTaskIds.join(' -> ')}.`
    }
  } catch { /* unresolvable schedule: keep the structural summary */ }

  const sectionLabels = body.sections.map(sec => sec.label).filter((l): l is string => l !== undefined)
  if (sectionLabels.length > 0) s += ` Sections: ${sectionLabels.join(', ')}.`
  const taskStr = tasks.map(t => {
    const bits: string[] = []
    const status = t.tags.find(tag => tag === 'done' || tag === 'active' || tag === 'crit')
    if (status) bits.push(status)
    if (t.tags.includes('milestone')) bits.push('milestone')
    if (t.tags.includes('vert')) bits.push('vert marker')
    if (t.start) bits.push(t.start)
    bits.push(t.end)
    return `${t.label} (${bits.join(', ')})`
  })
  if (taskStr.length > 0) s += ` Tasks: ${taskStr.join('; ')}.`
  return s
}

function describeOpaque(kind: FamilyId, source: string): string {
  const plugin = getFamily(kind)
  const labels = (plugin?.extractLabels ?? extractLabelsGeneric)(source).map(label => label.text)
  const unique = Array.from(new Set(labels)).filter(Boolean)
  const family = kind === 'xychart' ? 'XY chart' : kind
  let s = `A ${family} diagram with a source-level body (structured editing not exposed).`
  if (unique.length > 0) s += ` Labels: ${unique.join(', ')}.`
  return s
}
