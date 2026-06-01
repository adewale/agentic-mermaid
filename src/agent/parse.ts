// ============================================================================
// parseMermaid: source → ValidDiagram (multi-error).
//
// v4 sequence fidelity: parseSequenceBody returns null if it encounters ANY
// non-blank, non-comment line it doesn't fully understand. parse then falls
// back to an opaque body (lossless round-trip via canonicalSource) rather
// than silently dropping the unrecognized construct.
// ============================================================================

import { parseMermaid as parseFlowchartLegacy } from '../parser.ts'
import { normalizeMermaidSource, detectLooseDiagramTypeFromFirstLine } from '../mermaid-source.ts'
import { parseClassBody } from './class-body.ts'
import { parseErBody } from './er-body.ts'
import type {
  ValidDiagram, ParseError, Result, DiagramKind, ValidDiagramMeta,
  SourceMap, InitDirective, SequenceBody, SequenceParticipant,
  SequenceMessage, SequenceMessageStyle,
} from './types.ts'
import { ok, err } from './types.ts'

const FRONTMATTER_REGEX = /^﻿?\s*---\s*\r?\n([\s\S]*?)\r?\n\s*---\s*(?:\r?\n|$)/
const INIT_DIRECTIVE_REGEX = /^\s*%%\{\s*(?:init|initialize)\s*:\s*([\s\S]*?)\}\s*%%\s*(?:\r?\n|$)?/gm
const COMMENT_LINE_REGEX = /^\s*%%(?!\{)\s*(.*)$/
const ACC_TITLE_REGEX = /^\s*accTitle\s*:\s*(.+)$/i
const ACC_DESCR_INLINE_REGEX = /^\s*accDescr\s*:\s*(.+)$/i
const ACC_DESCR_BLOCK_START = /^\s*accDescr\s*\{\s*$/i

export function parseMermaid(source: string): Result<ValidDiagram, ParseError[]> {
  const errors: ParseError[] = []
  // Normalize once and reuse its frontmatter in extractMeta, rather than
  // re-running the full preprocess a second time just for frontmatter.
  const normalized = normalizeMermaidSource(source)
  const meta = extractMeta(source, normalized.frontmatter)
  const canonicalSource = normalized.text
  // For opaque bodies, preserve original indentation/blank lines so the
  // serializer can re-emit the untouched body. canonicalSource at the
  // ValidDiagram level remains the normalized (line-trimmed) form for
  // back-compat with the existing flowchart/legacy paths.
  const opaqueSource = normalized.body

  if (normalized.lines.length === 0) {
    errors.push({ code: 'EMPTY', message: 'Empty diagram' })
    return err(errors)
  }

  const header = normalized.lines[0]!.toLowerCase()
  const kind = detectKind(header)
  if (!kind) {
    errors.push({ code: 'UNKNOWN_HEADER', message: `Unrecognized header: "${normalized.lines[0]}"`, line: 1 })
    return err(errors)
  }

  const sourceMap = emptySourceMap()

  if (kind === 'flowchart' || kind === 'state') {
    try {
      const graph = parseFlowchartLegacy(canonicalSource)
      indexFlowchartSource(canonicalSource, graph.nodes.keys(), sourceMap)
      return ok<ValidDiagram>({ kind, meta, body: { kind: 'flowchart', graph }, source: sourceMap, canonicalSource })
    } catch (e) {
      errors.push({ code: 'PARSE_FAILED', message: e instanceof Error ? e.message : String(e) })
      return err(errors)
    }
  }

  if (kind === 'sequence') {
    const body = parseSequenceBody(normalized.lines.slice(1))
    if (body) return ok<ValidDiagram>({ kind, meta, body, source: sourceMap, canonicalSource })
    return ok<ValidDiagram>({
      kind, meta, body: { kind: 'opaque', family: kind, source: opaqueSource }, source: sourceMap, canonicalSource,
    })
  }

  if (kind === 'timeline') {
    const body = /^timeline\s*$/i.test(normalized.lines[0]?.trim() ?? '') ? parseTimelineBody(normalized.lines.slice(1)) : null
    if (body) return ok<ValidDiagram>({ kind, meta, body, source: sourceMap, canonicalSource })
    return ok<ValidDiagram>({
      kind, meta, body: { kind: 'opaque', family: kind, source: opaqueSource }, source: sourceMap, canonicalSource,
    })
  }

  if (kind === 'class') {
    const body = parseClassBody(normalized.lines.slice(1))
    if (body) return ok<ValidDiagram>({ kind, meta, body, source: sourceMap, canonicalSource })
    return ok<ValidDiagram>({
      kind, meta, body: { kind: 'opaque', family: kind, source: opaqueSource }, source: sourceMap, canonicalSource,
    })
  }

  if (kind === 'er') {
    const body = parseErBody(normalized.lines.slice(1))
    if (body) return ok<ValidDiagram>({ kind, meta, body, source: sourceMap, canonicalSource })
    return ok<ValidDiagram>({
      kind, meta, body: { kind: 'opaque', family: kind, source: opaqueSource }, source: sourceMap, canonicalSource,
    })
  }

  return ok<ValidDiagram>({
    kind, meta, body: { kind: 'opaque', family: kind, source: opaqueSource }, source: sourceMap, canonicalSource,
  })
}

// ---- Timeline body parser (structured-or-null, same pattern as sequence) ---

const TL_TITLE_RE = /^title\s+(.+)$/i
const TL_SECTION_RE = /^section\s+(.+)$/i
const TL_PERIOD_RE = /^([^:]+?)\s*:\s*(.*)$/
const TL_CONT_RE = /^:\s*(.+)$/  // continuation of previous period

import type { TimelineBody, TimelineSection, TimelinePeriod, TimelineEvent } from './types.ts'

/**
 * Parse the body lines of a timeline diagram. Returns a structured body only
 * if EVERY non-blank, non-comment line is one of: title, section, period
 * (`<label> : <event>` and `: <event>` continuations), or a multi-event line
 * with extra `:` separators. Otherwise returns null so caller falls back to
 * a lossless opaque body.
 *
 * Mirrors the legacy parser's accepted syntax (src/timeline/parser.ts).
 */
function normalizeTimelineText(value: string): string {
  return value.split(/\r?\n/).map(part => part.trim()).filter(Boolean).join(' ')
}

function validTimelineText(value: string, opts: { allowColon: boolean }): boolean {
  return value.length > 0 && (opts.allowColon || !value.includes(':'))
}

function parseTimelineEventSegments(raw: string): string[] | null {
  if (raw.trim().length === 0) return []
  const segments = raw.split(':').map(normalizeTimelineText)
  if (segments.some(segment => !validTimelineText(segment, { allowColon: false }))) return null
  return segments
}

export function parseTimelineBody(lines: string[]): TimelineBody | null {
  const body: TimelineBody = { kind: 'timeline', sections: [] }
  let currentSection: TimelineSection | undefined
  let currentPeriod: TimelinePeriod | undefined
  let sIdx = 0, pIdx = 0, eIdx = 0

  const implicitSection = (): TimelineSection => {
    if (!currentSection) {
      currentSection = { id: `section-${sIdx++}`, periods: [] }
      body.sections.push(currentSection)
    }
    return currentSection
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('%%')) continue

    const tm = line.match(TL_TITLE_RE)
    if (tm) {
      const title = normalizeTimelineText(tm[1]!)
      if (!validTimelineText(title, { allowColon: true })) return null
      body.title = title
      continue
    }

    const sm = line.match(TL_SECTION_RE)
    if (sm) {
      const label = normalizeTimelineText(sm[1]!)
      if (!validTimelineText(label, { allowColon: true })) return null
      currentSection = { id: `section-${sIdx++}`, label, periods: [] }
      body.sections.push(currentSection)
      currentPeriod = undefined
      continue
    }

    // `: <continuation>` — extra event on the previous period.
    const cont = line.match(TL_CONT_RE)
    if (cont && !line.match(TL_PERIOD_RE)) {
      if (!currentPeriod) return null
      const text = normalizeTimelineText(cont[1]!)
      if (!validTimelineText(text, { allowColon: false })) return null
      currentPeriod.events.push({ id: `event-${eIdx++}`, text })
      continue
    }

    // `<label> : <event> [ : <event2> : <event3> …]`
    const pm = line.match(TL_PERIOD_RE)
    if (pm) {
      const label = normalizeTimelineText(pm[1]!)
      if (!validTimelineText(label, { allowColon: false })) return null
      const restRaw = pm[2]!
      // Multi-event lines allow `: extra` segments to add more events to the same period.
      const eventTexts = parseTimelineEventSegments(restRaw)
      if (!eventTexts) return null
      const events: TimelineEvent[] = eventTexts.map(text => ({
        id: `event-${eIdx++}`, text,
      }))
      const period: TimelinePeriod = { id: `period-${pIdx++}`, label, events }
      implicitSection().periods.push(period)
      currentPeriod = period
      continue
    }

    // Unmodeled line → opaque fallback.
    return null
  }

  return body
}

// ---- Sequence body parser (structured-or-null) ---------------------------

const PARTICIPANT_RE = /^(participant|actor)\s+([A-Za-z_][\w]*)(?:\s+as\s+(.+))?$/i
const MESSAGE_RE = /^([A-Za-z_][\w]*)\s*(-->>|--x|-->|->>|->|-x)\s*([A-Za-z_][\w]*)\s*:\s*(.+)$/
// Lines we recognize as "structurally empty" — title is metadata-ish but we
// can't round-trip it structurally, so its presence forces the opaque path.

/**
 * Parse the body lines of a sequence diagram. Returns a structured body only
 * if EVERY non-blank, non-comment line is fully understood. Otherwise returns
 * null so the caller falls back to a lossless opaque body.
 */
export function parseSequenceBody(lines: string[]): SequenceBody | null {
  const participants: SequenceParticipant[] = []
  const messages: SequenceMessage[] = []
  const seen = new Set<string>()

  // NB: do NOT name this `declare` — that's a TypeScript keyword and bun's
  // transpiler misparses `declare(x)` as an ambient declaration, silently
  // dropping the statements that follow it. (Caught by running the parser.)
  const ensureParticipant = (id: string) => {
    if (!seen.has(id)) { participants.push({ id, label: id, kind: 'participant' }); seen.add(id) }
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('%%')) continue

    const part = line.match(PARTICIPANT_RE)
    if (part) {
      const kind = part[1]!.toLowerCase() === 'actor' ? 'actor' : 'participant'
      const id = part[2]!.trim()
      const label = part[3]?.trim() ?? id
      if (!seen.has(id)) { participants.push({ id, label, kind }); seen.add(id) }
      else { // update an implicitly-declared participant with explicit info
        const existing = participants.find(p => p.id === id)!
        existing.label = label
        existing.kind = kind
      }
      continue
    }

    const msg = line.match(MESSAGE_RE)
    if (msg) {
      const from = msg[1]!.trim()
      const arrow = msg[2]!.trim()
      const to = msg[3]!.trim()
      const text = msg[4]!.trim()
      ensureParticipant(from)
      ensureParticipant(to)
      messages.push({ from, to, text, style: styleForArrow(arrow) })
      continue
    }

    // Anything else (Note, alt, loop, activate, autonumber, title, +/-, etc.)
    // → we don't model it. Bail to the opaque fallback so nothing is lost.
    return null
  }

  return { kind: 'sequence', participants, messages }
}

function styleForArrow(a: string): SequenceMessageStyle {
  switch (a) {
    case '->>': return 'sync'
    case '-->>': return 'reply'
    case '->': return 'async'
    case '-->': return 'async-dashed'
    case '-x': return 'lost'
    case '--x': return 'lost-dashed'
    default: return 'sync'
  }
}

// ---- Family detection ----------------------------------------------------
// Use the shared renderer detector for routed families; the agent layer only
// splits state diagrams out from the renderer's flowchart route because state
// and flowchart share the same legacy graph body but remain distinct families.

function detectKind(header: string): DiagramKind | null {
  if (/^statediagram(?:-v2)?\s*$/i.test(header)) return 'state'
  const routed = detectLooseDiagramTypeFromFirstLine(header)
  if (!routed) return null
  return routed
}

// ---- Meta extraction -----------------------------------------------------

function extractMeta(rawSource: string, frontmatter?: Record<string, unknown>): ValidDiagramMeta {
  const meta: ValidDiagramMeta = { initDirectives: [], comments: [], accessibility: {} }

  if (frontmatter && Object.keys(frontmatter).length > 0) {
    meta.frontmatter = frontmatter as ValidDiagramMeta['frontmatter']
  }

  const directiveRegex = new RegExp(INIT_DIRECTIVE_REGEX.source, 'gm')
  let m: RegExpExecArray | null
  while ((m = directiveRegex.exec(rawSource)) !== null) {
    meta.initDirectives.push({ raw: m[0], parsed: tryParseInitObject((m[1] ?? '').trim()) as InitDirective['parsed'] })
  }

  const stripped = rawSource
    .replace(FRONTMATTER_REGEX, '')
    .replace(new RegExp(INIT_DIRECTIVE_REGEX.source, 'gm'), '')
  const lines = stripped.split(/\r?\n/)
  let inAccDescr = false
  let buf: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (inAccDescr) {
      if (/^\s*\}\s*$/.test(line)) { meta.accessibility.descr = buf.join('\n').trim(); inAccDescr = false; buf = [] }
      else buf.push(line)
      continue
    }
    if (ACC_DESCR_BLOCK_START.test(line)) { inAccDescr = true; continue }
    const at = line.match(ACC_TITLE_REGEX)
    if (at) { meta.accessibility.title = at[1]!.trim(); continue }
    const ad = line.match(ACC_DESCR_INLINE_REGEX)
    if (ad) { meta.accessibility.descr = ad[1]!.trim(); continue }
    const cm = line.match(COMMENT_LINE_REGEX)
    if (cm) meta.comments.push({ text: cm[1]!, line: i + 1 })
  }

  return meta
}

function tryParseInitObject(inner: string): Record<string, unknown> {
  try { return JSON.parse(inner) as Record<string, unknown> }
  catch {
    try {
      const quoted = inner.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      return JSON.parse(quoted) as Record<string, unknown>
    } catch { return {} }
  }
}

function emptySourceMap(): SourceMap {
  return { nodes: new Map(), edges: new Map(), groups: new Map() }
}

function indexFlowchartSource(source: string, nodeIds: IterableIterator<string>, map: SourceMap): void {
  const lines = source.split(/\r?\n/)
  for (const id of Array.from(nodeIds)) {
    const re = new RegExp(`\\b${escapeRegex(id)}\\b`)
    for (let i = 0; i < lines.length; i++) {
      const idx = lines[i]!.search(re)
      if (idx >= 0) { map.nodes.set(id, { line: i + 1, col: idx + 1 }); break }
    }
  }
}

function escapeRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
