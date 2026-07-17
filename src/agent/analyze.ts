// ============================================================================
// analyzeMermaid — deterministic facts without inventing Mermaid syntax.
//
// Issue #26 WS14 / issue #38 closure slice: expose the analysis facts that
// already exist in the implementation (graph feedback classification, Gantt
// critical path/slack, and source-only action records) through a stable API.
// This module never executes callbacks and never mutates source/render output.
// ============================================================================

import { parseRegisteredMermaid } from './parse.ts'
import type { DiagramActionRecord, DiagramAnalysis, ParseError, Result, ParsedDiagram } from './types.ts'
import { err, ok } from './types.ts'
import { classifyRoutes } from '../route-contracts.ts'
import { parseMermaid as parseFlowchartLegacy, splitFlowchartStatements } from '../parser.ts'
import { stateBodyToGraph } from './state-body.ts'
import { parseGanttModel, applyGanttFrontmatterConfig } from '../gantt/parser.ts'
import { resolveGanttSchedule } from '../gantt/schedule.ts'
import { normalizeMermaidSource, toMermaidLines } from '../mermaid-source.ts'
import {
  expandInlineNamespaceStatement,
  parseClassDeclaration,
  parseClassInteraction,
  parseClassReference,
} from '../class/parser.ts'
import type { MermaidGraph } from '../types.ts'
import { isSafeActionHref } from '../output-security.ts'
import { parseActorLinks } from '../sequence/parser.ts'

export function analyzeMermaid(d: ParsedDiagram): DiagramAnalysis {
  return {
    kind: d.kind,
    feedbackEdges: feedbackEdges(d),
    actions: collectActionRecords(d),
    ...(d.body.kind === 'gantt' ? ganttAnalysis(d) : {}),
  }
}

export function analyzeMermaidSource(source: string): Result<DiagramAnalysis, ParseError[]> {
  const parsed = parseRegisteredMermaid(source)
  return parsed.ok ? ok(analyzeMermaid(parsed.value)) : err(parsed.error)
}

function feedbackEdges(d: ParsedDiagram): DiagramAnalysis['feedbackEdges'] {
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

function ganttAnalysis(d: ParsedDiagram): Pick<DiagramAnalysis, 'gantt'> {
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

export function collectActionRecords(d: ParsedDiagram): DiagramActionRecord[] {
  const source = d.body.kind === 'opaque' || d.body.kind === 'extension' || d.body.kind === 'preserved'
    ? d.body.source
    : d.canonicalSource
  const records: DiagramActionRecord[] = []
  if (d.kind === 'flowchart') records.push(...collectFlowchartActions(source))
  if (d.kind === 'class') records.push(...collectClassActions(source))
  if (d.kind === 'sequence') records.push(...collectSequenceActions(source))
  if (d.body.kind === 'gantt') records.push(...collectGanttActions(d))
  const seen = new Map<string, number>()
  return records.map(record => {
    const key = `${record.family}:${record.target}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    return { id: `action:${record.family}:${record.target}:${n}`, regionId: `node:${record.target}`, ...record }
  })
}

function collectClassActions(source: string): DiagramActionRecord[] {
  const out: DiagramActionRecord[] = []
  let inClassBody = false
  for (const sourceLine of actionSourceLines(source)) {
    for (const text of expandInlineNamespaceStatement(sourceLine.text)) {
      if (inClassBody) {
        if (text.trim() === '}') inClassBody = false
        continue
      }
      const declaration = parseClassDeclaration(text)
      if (declaration?.opensBody) {
        inClassBody = true
        continue
      }
      const embedded = parseClassInteraction(text)
      if (embedded) {
        out.push(actionRecord('class', embedded.id, 'href', embedded.href, sourceLine.line))
        continue
      }
      const callback = text.match(/^(callback)\s+(`[^`]+`(?:~[^~]+~)?|[\w$]+(?:~[^~]+~)?)\s+(.+)$/i)
      if (callback) {
        const ref = parseClassReference(callback[2]!)
        if (ref) out.push(actionRecord('class', ref.id, 'callback', callback[3]!, sourceLine.line))
        continue
      }
      const match = text.match(/^(click|link)\s+(`[^`]+`(?:~[^~]+~)?|[\w$]+(?:~[^~]+~)?)\s+(.+)$/i)
      if (!match) continue
      const ref = parseClassReference(match[2]!)
      if (!ref) continue
      const rest = match[3]!.trim()
      const explicit = rest.match(/^(href|call|callback)\s+(.+)$/i)
      const kind = explicit?.[1]?.toLowerCase()
      if (kind === 'call' || kind === 'callback') {
        out.push(actionRecord('class', ref.id, kind, explicit![2]!, sourceLine.line))
      } else {
        const raw = kind === 'href' ? explicit![2]! : rest
        out.push(actionRecord(
          'class',
          ref.id,
          match[1]!.toLowerCase() === 'link' || looksLikeHref(raw) ? 'href' : 'callback',
          raw,
          sourceLine.line,
        ))
      }
    }
  }
  return out
}

function collectFlowchartActions(source: string): DiagramActionRecord[] {
  const out: DiagramActionRecord[] = []
  for (const sourceLine of actionSourceLines(source, true)) {
    for (const text of splitFlowchartStatements(sourceLine.text)) {
      if (!text || text.startsWith('%%')) continue
      let m = text.match(/^href\s+(\S+)\s+(.+)$/i)
      if (m) {
        out.push(actionRecord('flowchart', m[1]!, 'href', m[2]!, sourceLine.line))
        continue
      }
      m = text.match(/^click\s+(\S+)\s+(.+)$/i)
      if (!m) continue
      const target = m[1]!
      const rest = m[2]!.trim()
      const explicit = rest.match(/^(href|call)\s+(.+)$/i)
      const callback = rest.match(/^callback(?:\s+(.+))?$/i)
      if (explicit?.[1]?.toLowerCase() === 'href') out.push(actionRecord('flowchart', target, 'href', explicit[2]!, sourceLine.line))
      else if (explicit?.[1]?.toLowerCase() === 'call') out.push(actionRecord('flowchart', target, 'call', explicit[2]!, sourceLine.line))
      else if (callback) out.push(actionRecord('flowchart', target, 'callback', callback[1] ?? '', sourceLine.line))
      else out.push(actionRecord('flowchart', target, looksLikeHref(rest) ? 'href' : 'callback', rest, sourceLine.line))
    }
  }
  return out
}

/** Top-level authored lines with accessibility prose removed. Block contents
 * may legally resemble Mermaid statements but must never become actions. */
function actionSourceLines(source: string, maskMarkdownStrings = false): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = []
  const lines = source.split(/\r?\n/)
  let inAccessibilityBlock = false
  let inMarkdownString = false
  for (let index = 0; index < lines.length; index++) {
    const preserveActionText = maskMarkdownStrings && !inMarkdownString
      && splitFlowchartStatements(lines[index]!).some(statement => /^(?:click|href)\s+/i.test(statement.trim()))
    const masked: { text: string; open: boolean } = maskMarkdownStrings && !preserveActionText
      ? maskMarkdownStringContent(lines[index]!, inMarkdownString)
      : { text: lines[index]!, open: false }
    inMarkdownString = masked.open
    const text = masked.text.trim()
    if (inAccessibilityBlock) {
      if (text.includes('}')) inAccessibilityBlock = false
      continue
    }
    const block = text.match(/^accDescr\s*:?\s*\{\s*(.*)$/i)
    if (block) {
      if (!block[1]!.includes('}')) inAccessibilityBlock = true
      continue
    }
    if (/^acc(?:Title|Descr)(?:\s*:|\s+)/i.test(text)) continue
    out.push({ text, line: index + 1 })
  }
  return out
}

function collectSequenceActions(source: string): DiagramActionRecord[] {
  return actionSourceLines(source).flatMap(sourceLine => {
    const parsed = parseActorLinks(sourceLine.text)
    return parsed ? Object.values(parsed.links).map(href =>
      actionRecord('sequence', parsed.actorId, 'href', href, sourceLine.line),
    ) : []
  })
}

/** Keep the statement text outside Mermaid markdown strings while masking
 * their prose. The renderer coalesces an open backtick string across physical
 * lines before parsing; action extraction must use the same lexical boundary
 * or prose such as `click A href ...` becomes a phantom action. */
function maskMarkdownStringContent(line: string, initiallyOpen: boolean): { text: string; open: boolean } {
  let open = initiallyOpen
  let escaped = false
  let text = ''
  for (const character of line) {
    if (escaped) {
      text += open ? ' ' : character
      escaped = false
      continue
    }
    if (character === '\\') {
      text += open ? ' ' : character
      escaped = true
      continue
    }
    if (character === '`') {
      text += ' '
      open = !open
      continue
    }
    text += open ? ' ' : character
  }
  return { text, open }
}

function collectGanttActions(d: ParsedDiagram): DiagramActionRecord[] {
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
  const quote = trimmed[0]
  if (quote === '"' || quote === "'") {
    let token = ''
    for (let index = 1; index < trimmed.length; index++) {
      const character = trimmed[index]!
      if (character === quote) return token
      if (character === '\\' && index + 1 < trimmed.length) {
        const next = trimmed[index + 1]!
        if (next === quote || next === '\\') {
          token += next
          index++
          continue
        }
      }
      token += character
    }
    return token
  }
  return trimmed.split(/\s+/)[0] ?? ''
}

function isSafeHref(href: string): boolean {
  return isSafeActionHref(href)
}

function looksLikeHref(raw: string): boolean {
  const trimmed = raw.trim()
  const token = firstActionToken(raw)
  const quoted = trimmed[0] === '"' || trimmed[0] === "'"
  return quoted || (isSafeHref(token) && /^(?:https?:|mailto:|#|\/|\.\/|\.\.)/i.test(token))
}
