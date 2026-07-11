// ============================================================================
// Mermaid semantic facts/checks.
//
// Deterministic, single-line read-back for agents and tests. These facts are
// intentionally semantic (nodes, edges, members, tasks, points) rather than a
// source diff or a visual metric: verify.ok can prove a diagram is structurally
// renderable while these facts prove it still says the requested thing.
// ============================================================================

import { parseMermaid } from './parse.ts'
import { err, ok, type ParseError, type Result, type ValidDiagram } from './types.ts'
import { getFamily, extractLabelsGeneric } from './families.ts'
import type {
  ArchitectureBody, ClassBody, ErBody, GanttBody, JourneyBody, PieBody,
  QuadrantBody, SequenceBody, StateBody, TimelineBody, XyChartBody,
} from './types.ts'

export type MermaidFact = string

export interface CheckMermaidObjectSpec {
  /** Required facts. Aliases: expected / require / required. */
  include?: readonly string[]
  expected?: readonly string[]
  require?: readonly string[]
  required?: readonly string[]
  /** Forbidden facts. Aliases: absent / forbid / forbidden / unexpected. */
  exclude?: readonly string[]
  absent?: readonly string[]
  forbid?: readonly string[]
  forbidden?: readonly string[]
  unexpected?: readonly string[]
  /** When true, every emitted fact must be listed in the required set. */
  exact?: boolean
}

export type CheckMermaidSpec = readonly string[] | CheckMermaidObjectSpec

export interface CheckMermaidResult {
  ok: boolean
  /** Required facts not present in the diagram. */
  missing: string[]
  /** Forbidden facts that were present, or extra facts under exact:true. */
  unexpected: string[]
  /** Full deterministic fact set used for the comparison. */
  facts: string[]
}

/** Facts for a parsed diagram. Output is sorted, de-duplicated, and single-line. */
export function describeMermaidFacts(d: ValidDiagram): string[] {
  const out: string[] = []
  add(out, `family ${d.kind}`)
  if (d.meta.accessibility.title) add(out, `accessibility title ${clean(d.meta.accessibility.title)}`)
  if (d.meta.accessibility.descr) add(out, `accessibility descr ${clean(d.meta.accessibility.descr)}`)

  switch (d.body.kind) {
    case 'flowchart': {
      const g = d.body.graph
      add(out, `direction ${g.direction}`)
      for (const n of g.nodes.values()) {
        add(out, `node ${clean(n.id)} : ${clean(n.label || n.id)}`)
        add(out, `node ${clean(n.id)} shape ${clean(n.shape)}`)
      }
      const visitGroups = (items: typeof g.subgraphs, parent?: string) => {
        for (const group of items) {
          add(out, `group ${clean(group.id)} : ${clean(group.label || group.id)}`)
          if (parent) add(out, `group ${clean(group.id)} parent ${clean(parent)}`)
          if (group.direction) add(out, `group ${clean(group.id)} direction ${group.direction}`)
          for (const nodeId of group.nodeIds) add(out, `group ${clean(group.id)} contains ${clean(nodeId)}`)
          visitGroups(group.children, group.id)
        }
      }
      visitGroups(g.subgraphs)
      g.edges.forEach((e, i) => {
        const base = `edge ${clean(e.source)} -> ${clean(e.target)}`
        add(out, e.label ? `${base} : ${clean(e.label)}` : base)
        add(out, `edge#${i} ${clean(e.source)} -> ${clean(e.target)}${e.label ? ` : ${clean(e.label)}` : ''}`)
        if (e.style !== 'solid') add(out, `${base} style ${e.style}`)
      })
      break
    }
    case 'state': factsState(out, d.body); break
    case 'sequence': factsSequence(out, d.body); break
    case 'timeline': factsTimeline(out, d.body); break
    case 'class': factsClass(out, d.body); break
    case 'er': factsEr(out, d.body); break
    case 'journey': factsJourney(out, d.body); break
    case 'architecture': factsArchitecture(out, d.body); break
    case 'xychart': factsXyChart(out, d.body); break
    case 'pie': factsPie(out, d.body); break
    case 'quadrant': factsQuadrant(out, d.body); break
    case 'gantt': factsGantt(out, d.body); break
    case 'opaque': {
      add(out, `opaque ${d.body.family}`)
      const plugin = getFamily(d.kind)
      const labels = (plugin?.extractLabels ?? extractLabelsGeneric)(d.body.source)
      labels.forEach((label, i) => add(out, `label#${i} ${clean(label.target || '')} : ${clean(label.text)}`))
      break
    }
    default: {
      const _never: never = d.body
      void _never
    }
  }
  return Array.from(new Set(out)).sort()
}

/** Parse then emit facts. Parse failures are explicit Result errors. */
export function describeMermaidFactsSource(source: string): Result<string[], ParseError[]> {
  const parsed = parseMermaid(source)
  return parsed.ok ? ok(describeMermaidFacts(parsed.value)) : err(parsed.error)
}

/** Check required/forbidden semantic facts against a parsed diagram. */
export function checkMermaid(d: ValidDiagram, spec: CheckMermaidSpec): CheckMermaidResult {
  const facts = describeMermaidFacts(d)
  const have = new Set(facts)
  const required = specRequired(spec)
  const forbidden = specForbidden(spec)
  const missing = required.filter(f => !have.has(f))
  let unexpected = forbidden.filter(f => have.has(f))
  if (isObjectSpec(spec) && spec.exact) {
    const allowed = new Set(required)
    unexpected = [...unexpected, ...facts.filter(f => !allowed.has(f))]
  }
  unexpected = Array.from(new Set(unexpected)).sort()
  return { ok: missing.length === 0 && unexpected.length === 0, missing, unexpected, facts }
}

export function checkMermaidSource(source: string, spec: CheckMermaidSpec): Result<CheckMermaidResult, ParseError[]> {
  const parsed = parseMermaid(source)
  return parsed.ok ? ok(checkMermaid(parsed.value, spec)) : err(parsed.error)
}

function factsState(out: string[], body: StateBody): void {
  if (body.direction) add(out, `direction ${body.direction}`)
  const visit = (states: StateBody['states'], transitions: StateBody['transitions'], path?: string) => {
    for (const s of states) {
      add(out, `state ${clean(s.id)}`)
      if (s.label) add(out, `state ${clean(s.id)} : ${clean(s.label)}`)
      if (s.stereotype) add(out, `state ${clean(s.id)} stereotype ${clean(s.stereotype)}`)
      if (path) add(out, `state ${clean(s.id)} parent ${clean(path)}`)
      if (s.states !== undefined) {
        add(out, `composite ${clean(s.id)}`)
        if (s.direction) add(out, `state ${clean(s.id)} direction ${s.direction}`)
        visit(s.states, s.transitions ?? [], s.id)
      }
    }
    for (const t of transitions) add(out, edgeFact(t.from, t.to, t.label))
  }
  visit(body.states, body.transitions)
  for (const [index, note] of (body.notes ?? []).entries()) {
    add(out, `note#${index} ${note.side} of ${clean(note.target)} : ${clean(note.text)}`)
  }
}

function factsSequence(out: string[], body: SequenceBody): void {
  body.participants.forEach((p, i) => {
    add(out, `${p.kind} ${clean(p.id)} : ${clean(p.label || p.id)}`)
    add(out, `participant#${i} ${clean(p.id)} : ${clean(p.label || p.id)}`)
  })
  body.messages.forEach((m, i) => {
    add(out, `message ${clean(m.from)} -> ${clean(m.to)} : ${clean(m.text)}`)
    add(out, `message#${i} ${clean(m.from)} -> ${clean(m.to)} : ${clean(m.text)}`)
    if (m.style !== 'sync') add(out, `message#${i} style ${m.style}`)
  })
}

function factsTimeline(out: string[], body: TimelineBody): void {
  if (body.title) add(out, `title ${clean(body.title)}`)
  body.sections.forEach((s, si) => {
    if (s.label) add(out, `section ${clean(s.label)}`)
    s.periods.forEach((p, pi) => {
      add(out, `period ${clean(p.label)}`)
      if (s.label) add(out, `period ${clean(p.label)} section ${clean(s.label)}`)
      p.events.forEach((e, ei) => {
        add(out, `event ${clean(p.label)} : ${clean(e.text)}`)
        add(out, `event#${si}.${pi}.${ei} ${clean(p.label)} : ${clean(e.text)}`)
      })
    })
  })
}

function factsClass(out: string[], body: ClassBody): void {
  if (body.title) add(out, `title ${clean(body.title)}`)
  // Namespace declarations + membership (repo #118): both directions are
  // queryable — "what namespaces exist" and "which namespace holds class X".
  for (const ns of body.namespaces ?? []) {
    add(out, `namespace ${clean(ns.name)}${ns.label ? ` : ${clean(ns.label)}` : ''}`)
  }
  for (const c of body.classes) {
    add(out, `class ${clean(c.id)}`)
    if (c.generic) add(out, `class ${clean(c.id)} generic ${clean(c.generic)}`)
    if (c.label) add(out, `class ${clean(c.id)} : ${clean(c.label)}`)
    if (c.namespace) add(out, `class ${clean(c.id)} in namespace ${clean(c.namespace)}`)
    for (const member of c.members) add(out, `member ${clean(c.id)} ${clean(member)}`)
  }
  body.relations.forEach((r, i) => {
    const cards = `${r.fromCardinality ? ` ${clean(r.fromCardinality)}` : ''}${r.toCardinality ? ` ${clean(r.toCardinality)}` : ''}`
    add(out, `relation ${clean(r.from)} ${r.kind} ${clean(r.to)}${r.label ? ` : ${clean(r.label)}` : ''}`)
    add(out, `relation#${i} ${clean(r.from)} ${r.kind} ${clean(r.to)}${cards}${r.label ? ` : ${clean(r.label)}` : ''}`)
  })
  body.notes.forEach((n, i) => add(out, `note#${i}${n.for ? ` ${clean(n.for)}` : ''} : ${clean(n.text)}`))
}

function factsEr(out: string[], body: ErBody): void {
  for (const e of body.entities) {
    add(out, `entity ${clean(e.id)}`)
    for (const attr of e.attributes) add(out, `attribute ${clean(e.id)} ${clean(attr.text)}`)
  }
  body.relations.forEach((r, i) => {
    const line = `relation ${clean(r.from)} ${r.leftCard} ${r.dashed ? '..' : '--'} ${r.rightCard} ${clean(r.to)}${r.label ? ` : ${clean(r.label)}` : ''}`
    add(out, line)
    add(out, `relation#${i} ${line.slice('relation '.length)}`)
  })
}

function factsJourney(out: string[], body: JourneyBody): void {
  if (body.title) add(out, `title ${clean(body.title)}`)
  body.sections.forEach((s, si) => {
    if (s.label) add(out, `section ${clean(s.label)}`)
    s.tasks.forEach((t, ti) => {
      const actors = t.actors.length ? ` actors ${t.actors.map(clean).join(', ')}` : ''
      add(out, `journey task ${clean(t.text)} score ${num(t.score)}${actors}`)
      add(out, `journey task#${si}.${ti} ${clean(t.text)} score ${num(t.score)}${actors}`)
      if (s.label) add(out, `journey task ${clean(t.text)} section ${clean(s.label)}`)
    })
  })

  // Aggregates (parity spec §Describe, Facts, and Verify): score statistics
  // and participation counts make pain-point queries one checkMermaid away
  // instead of a re-parse-and-compute exercise.
  const tasks = body.sections.flatMap(s => s.tasks)
  add(out, `journey sections ${body.sections.length}`)
  add(out, `journey tasks ${tasks.length}`)
  const participation = new Map<string, number>()
  for (const t of tasks) for (const a of t.actors) participation.set(a, (participation.get(a) ?? 0) + 1)
  add(out, `journey actors ${participation.size}`)
  if (tasks.length > 0) {
    const scores = tasks.map(t => t.score)
    const min = Math.min(...scores)
    const max = Math.max(...scores)
    const average = Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100
    add(out, `journey score range ${min}..${max}`)
    add(out, `journey average score ${num(average)}`)
    for (const t of tasks) {
      if (t.score === min) add(out, `journey lowest task ${clean(t.text)} score ${num(t.score)}`)
      if (t.score === max) add(out, `journey highest task ${clean(t.text)} score ${num(t.score)}`)
    }
  }
  for (const [actor, count] of participation) add(out, `journey actor ${clean(actor)} tasks ${count}`)
}

function factsArchitecture(out: string[], body: ArchitectureBody): void {
  if (body.title) add(out, `title ${clean(body.title)}`)
  for (const g of body.groups) {
    add(out, `group ${clean(g.id)} : ${clean(g.label || g.id)}`)
    if (g.icon) add(out, `group ${clean(g.id)} icon ${clean(g.icon)}`)
    if (g.parentId) add(out, `group ${clean(g.id)} parent ${clean(g.parentId)}`)
  }
  for (const s of body.services) {
    add(out, `service ${clean(s.id)} : ${clean(s.label || s.id)}`)
    if (s.icon) add(out, `service ${clean(s.id)} icon ${clean(s.icon)}`)
    if (s.parentId) add(out, `service ${clean(s.id)} parent ${clean(s.parentId)}`)
  }
  for (const j of body.junctions) {
    add(out, `junction ${clean(j.id)}`)
    if (j.parentId) add(out, `junction ${clean(j.id)} parent ${clean(j.parentId)}`)
  }
  body.edges.forEach((e, i) => {
    const base = `edge ${clean(e.source.id)}:${e.source.side} -> ${clean(e.target.id)}:${e.target.side}`
    add(out, e.label ? `${base} : ${clean(e.label)}` : base)
    add(out, `edge#${i} ${clean(e.source.id)}:${e.source.side} -> ${clean(e.target.id)}:${e.target.side}${e.label ? ` : ${clean(e.label)}` : ''}`)
  })
}

function factsXyChart(out: string[], body: XyChartBody): void {
  if (body.title) add(out, `title ${clean(dequote(body.title))}`)
  if (body.horizontal) add(out, 'orientation horizontal')
  axisFacts(out, 'x-axis', body.xAxis)
  axisFacts(out, 'y-axis', body.yAxis)
  body.series.forEach((s, i) => {
    const name = s.name ? clean(dequote(s.name)) : `series#${i}`
    add(out, `series ${name} ${s.kind} [${s.values.map(num).join(',')}]`)
    add(out, `series#${i} ${s.kind} ${name} [${s.values.map(num).join(',')}]`)
  })
}

function factsPie(out: string[], body: PieBody): void {
  if (body.title) add(out, `title ${clean(dequote(body.title))}`)
  if (body.showData) add(out, 'showData true')
  body.slices.forEach((s, i) => {
    add(out, `slice ${clean(dequote(s.label))} = ${num(s.value)}`)
    add(out, `slice#${i} ${clean(dequote(s.label))} = ${num(s.value)}`)
  })
}

function factsQuadrant(out: string[], body: QuadrantBody): void {
  if (body.title) add(out, `title ${clean(dequote(body.title))}`)
  if (body.xAxis) add(out, `x-axis ${clean(body.xAxis.near)}${body.xAxis.far ? ` -> ${clean(body.xAxis.far)}` : ''}`)
  if (body.yAxis) add(out, `y-axis ${clean(body.yAxis.near)}${body.yAxis.far ? ` -> ${clean(body.yAxis.far)}` : ''}`)
  body.quadrants.forEach((q, i) => { if (q) add(out, `quadrant ${i + 1} : ${clean(q)}`) })
  body.points.forEach((p, i) => {
    add(out, `point ${clean(dequote(p.label))} @ ${num(p.x)},${num(p.y)}`)
    add(out, `point#${i} ${clean(dequote(p.label))} @ ${num(p.x)},${num(p.y)}`)
  })
}

function factsGantt(out: string[], body: GanttBody): void {
  if (body.title) add(out, `title ${clean(body.title)}`)
  body.sections.forEach((s, si) => {
    if (s.label) add(out, `section ${clean(s.label)}`)
    s.tasks.forEach((t, ti) => {
      add(out, `task ${clean(t.label)}`)
      add(out, `task#${si}.${ti} ${clean(t.label)}`)
      if (t.taskId) add(out, `task ${clean(t.label)} id ${clean(t.taskId)}`)
      if (s.label) add(out, `task ${clean(t.label)} section ${clean(s.label)}`)
      for (const tag of t.tags) add(out, `task ${clean(t.label)} tag ${tag}`)
      if (t.start) add(out, `task ${clean(t.label)} start ${clean(t.start)}`)
      add(out, `task ${clean(t.label)} end ${clean(t.end)}`)
    })
  })
}

function axisFacts(out: string[], label: 'x-axis' | 'y-axis', axis: XyChartBody['xAxis']): void {
  if (!axis) return
  if (axis.name) add(out, `${label} name ${clean(dequote(axis.name))}`)
  if (axis.categories) add(out, `${label} categories ${axis.categories.map(c => clean(dequote(c))).join(', ')}`)
  if (axis.range) add(out, `${label} range ${num(axis.range.min)} -> ${num(axis.range.max)}`)
}

function edgeFact(from: string, to: string, label?: string): string {
  return `edge ${clean(from)} -> ${clean(to)}${label ? ` : ${clean(label)}` : ''}`
}

function add(out: string[], fact: string): void {
  out.push(fact.replace(/\s+$/g, ''))
}

function clean(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
}

function dequote(value: string): string {
  return value.replace(/^"(.*)"$/, '$1')
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)))
}

function specRequired(spec: CheckMermaidSpec): string[] {
  if (!isObjectSpec(spec)) return [...spec]
  return unique([...(spec.include ?? []), ...(spec.expected ?? []), ...(spec.require ?? []), ...(spec.required ?? [])])
}

function specForbidden(spec: CheckMermaidSpec): string[] {
  if (!isObjectSpec(spec)) return []
  return unique([...(spec.exclude ?? []), ...(spec.absent ?? []), ...(spec.forbid ?? []), ...(spec.forbidden ?? []), ...(spec.unexpected ?? [])])
}

function isObjectSpec(spec: CheckMermaidSpec): spec is CheckMermaidObjectSpec {
  return !Array.isArray(spec)
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}
