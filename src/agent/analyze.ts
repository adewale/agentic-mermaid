// ============================================================================
// analyzeMermaid — deterministic facts without inventing Mermaid syntax.
//
// Issue #26 WS14 / issue #38 closure slice: expose the analysis facts that
// already exist in the implementation (graph feedback classification, Gantt
// critical path/slack, and source-only action records) through a stable API.
// This module never executes callbacks and never mutates source/render output.
// ============================================================================

import { parseMermaid } from './parse.ts'
import type { DiagramActionRecord, DiagramAnalysis, ParseError, Result, ValidDiagram } from './types.ts'
import { err, ok } from './types.ts'
import { classifyRoutes } from '../route-contracts.ts'
import { parseMermaid as parseFlowchartLegacy } from '../parser.ts'
import { stateBodyToGraph } from './state-body.ts'
import { parseGanttModel, applyGanttFrontmatterConfig } from '../gantt/parser.ts'
import { resolveGanttSchedule } from '../gantt/schedule.ts'
import { normalizeMermaidSource, toMermaidLines } from '../mermaid-source.ts'
import type { MermaidGraph } from '../types.ts'

export function analyzeMermaid(d: ValidDiagram): DiagramAnalysis {
  return {
    kind: d.kind,
    feedbackEdges: feedbackEdges(d),
    actions: collectActionRecords(d),
    ...(d.body.kind === 'gantt' ? ganttAnalysis(d) : {}),
  }
}

export function analyzeMermaidSource(source: string): Result<DiagramAnalysis, ParseError[]> {
  const parsed = parseMermaid(source)
  return parsed.ok ? ok(analyzeMermaid(parsed.value)) : err(parsed.error)
}

function feedbackEdges(d: ValidDiagram): DiagramAnalysis['feedbackEdges'] {
  let graph: MermaidGraph | null = null
  if (d.body.kind === 'flowchart') graph = d.body.graph
  else if (d.body.kind === 'state') graph = stateBodyToGraph(d.body)
  else if (d.kind === 'flowchart' && d.body.kind === 'opaque') {
    try { graph = parseFlowchartLegacy(d.canonicalSource) } catch { graph = null }
  }
  if (!graph) return []

  const classes = classifyRoutes(graph)
  return graph.edges.flatMap((edge, edgeIndex) => classes[edgeIndex] === 'feedback'
    ? [{ edgeIndex, from: edge.source, to: edge.target, label: edge.label, routeClass: 'feedback' as const }]
    : [])
}

function ganttAnalysis(d: ValidDiagram): Pick<DiagramAnalysis, 'gantt'> {
  if (d.body.kind !== 'gantt') return {}
  try {
    const normalized = normalizeMermaidSource(d.canonicalSource)
    const model = applyGanttFrontmatterConfig(parseGanttModel(normalized.lines), normalized.frontmatter)
    const schedule = resolveGanttSchedule(model)
    return schedule.analysis ? { gantt: {
      criticalPathTaskIds: [...schedule.analysis.criticalPathTaskIds],
      slackByTaskId: { ...schedule.analysis.slackByTaskId },
      projectStart: schedule.analysis.projectStart,
      projectEnd: schedule.analysis.projectEnd,
      entryTaskIds: [...schedule.analysis.entryTaskIds],
      sinkTaskIds: [...schedule.analysis.sinkTaskIds],
    } } : {}
  } catch {
    return {}
  }
}

export function collectActionRecords(d: ValidDiagram): DiagramActionRecord[] {
  const source = d.body.kind === 'opaque' ? d.body.source : d.canonicalSource
  const records: DiagramActionRecord[] = []
  if (d.kind === 'flowchart') records.push(...collectFlowchartActions(source))
  if (d.body.kind === 'gantt') records.push(...collectGanttActions(d))
  const seen = new Map<string, number>()
  return records.map(record => {
    const key = `${record.family}:${record.target}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    return { id: `action:${record.family}:${record.target}:${n}`, regionId: `node:${record.target}`, ...record }
  })
}

function collectFlowchartActions(source: string): DiagramActionRecord[] {
  const out: DiagramActionRecord[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.trim()
    if (!text || text.startsWith('%%')) continue
    let m = text.match(/^href\s+(\S+)\s+(.+)$/i)
    if (m) {
      out.push(actionRecord('flowchart', m[1]!, 'href', m[2]!, i + 1))
      continue
    }
    m = text.match(/^click\s+(\S+)\s+(.+)$/i)
    if (!m) continue
    const target = m[1]!
    const rest = m[2]!.trim()
    const explicit = rest.match(/^(href|call)\s+(.+)$/i)
    if (explicit?.[1]?.toLowerCase() === 'href') out.push(actionRecord('flowchart', target, 'href', explicit[2]!, i + 1))
    else if (explicit?.[1]?.toLowerCase() === 'call') out.push(actionRecord('flowchart', target, 'call', explicit[2]!, i + 1))
    else out.push(actionRecord('flowchart', target, looksLikeHref(rest) ? 'href' : 'callback', rest, i + 1))
  }
  return out
}

function collectGanttActions(d: ValidDiagram): DiagramActionRecord[] {
  if (d.body.kind !== 'gantt') return []
  try {
    const model = parseGanttModel(toMermaidLines(d.canonicalSource))
    return model.clicks.map(click => actionRecord('gantt', click.taskId, click.action, click.rest, click.line))
  } catch {
    return []
  }
}

function actionRecord(
  family: DiagramActionRecord['family'],
  target: string,
  action: DiagramActionRecord['action'],
  raw: string,
  line?: number,
): DiagramActionRecord {
  const href = action === 'href' ? firstActionToken(raw) : undefined
  const unsafe = href !== undefined && !isSafeHref(href)
  return {
    family,
    target,
    action,
    raw,
    line,
    href,
    executable: false,
    security: action === 'href' ? (unsafe ? 'unsafe' : 'safe') : 'source-only',
    message: action === 'href'
      ? (unsafe ? 'Unsafe href is source-only and must be stripped by strict renderers.' : 'Href is an action record; non-SVG renderers keep it as source-only metadata.')
      : 'Callbacks/calls are recorded for analysis but are never executed.',
  }
}

function firstActionToken(raw: string): string {
  const trimmed = raw.trim()
  const quoted = trimmed.match(/^["']([^"']+)["']/)
  if (quoted) return quoted[1]!
  return trimmed.split(/\s+/)[0] ?? ''
}

function isSafeHref(href: string): boolean {
  const trimmed = href.trim()
  if (/^(?:https?:|mailto:)/i.test(trimmed)) return true
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false
  return trimmed.length > 0
}

function looksLikeHref(raw: string): boolean {
  const token = firstActionToken(raw)
  return isSafeHref(token) && (/^(?:https?:|mailto:|#|\/|\.\/|\.\.)/i.test(token) || !/^[a-z][a-z0-9+.-]*:/i.test(token))
}
