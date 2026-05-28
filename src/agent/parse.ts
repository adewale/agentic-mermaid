// ============================================================================
// parseMermaid: source → ValidDiagram (multi-error).
//
// v3: parses sequence diagrams into a structured SequenceBody (participants
// + messages) instead of opaque body. Other 6 families remain opaque.
// ============================================================================

import { parseMermaid as parseFlowchartLegacy } from '../parser.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import type {
  ValidDiagram,
  ParseError,
  Result,
  DiagramKind,
  ValidDiagramMeta,
  SourceMap,
  InitDirective,
  SequenceBody,
  SequenceParticipant,
  SequenceMessage,
  SequenceMessageStyle,
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
  const meta = extractMeta(source)
  const normalized = normalizeMermaidSource(source)
  const canonicalSource = normalized.text

  if (normalized.lines.length === 0) {
    errors.push({ code: 'EMPTY', message: 'Empty diagram' })
    return err(errors)
  }

  const header = normalized.lines[0]!.toLowerCase()
  const kind = detectKind(header)
  if (!kind) {
    errors.push({
      code: 'UNKNOWN_HEADER',
      message: `Unrecognized header: "${normalized.lines[0]}"`,
      line: 1,
    })
    return err(errors)
  }

  const sourceMap = emptySourceMap()

  if (kind === 'flowchart' || kind === 'state') {
    try {
      const graph = parseFlowchartLegacy(canonicalSource)
      indexFlowchartSource(canonicalSource, graph.nodes.keys(), sourceMap)
      return ok<ValidDiagram>({
        kind,
        meta,
        body: { kind: 'flowchart', graph },
        source: sourceMap,
        canonicalSource,
      })
    } catch (e) {
      errors.push({
        code: 'PARSE_FAILED',
        message: e instanceof Error ? e.message : String(e),
      })
      return err(errors)
    }
  }

  if (kind === 'sequence') {
    const body = parseSequenceBody(normalized.lines.slice(1))
    return ok<ValidDiagram>({
      kind,
      meta,
      body,
      source: sourceMap,
      canonicalSource,
    })
  }

  return ok<ValidDiagram>({
    kind,
    meta,
    body: { kind: 'opaque', family: kind, source: canonicalSource },
    source: sourceMap,
    canonicalSource,
  })
}

// ---- Sequence body parser ------------------------------------------------

const PARTICIPANT_RE = /^\s*(participant|actor)\s+([^\s]+?)(?:\s+as\s+(.+))?\s*$/i

// Arrow forms (longest-first so -->> matches before -->, --x before -x).
// Participant IDs are identifier-like (no dashes/angle brackets), which avoids
// the regex eating the dash that's actually part of an arrow.
const MESSAGE_RE = /^\s*([A-Za-z_][\w]*)\s*(-->>|--x|-->|->>|->|-x)\s*([A-Za-z_][\w]*)\s*:\s*(.+)$/

export function parseSequenceBody(lines: string[]): SequenceBody {
  const participants: SequenceParticipant[] = []
  const messages: SequenceMessage[] = []
  const seen = new Set<string>()

  const declareIfMissing = (id: string) => {
    if (!seen.has(id)) {
      participants.push({ id, label: id, kind: 'participant' })
      seen.add(id)
    }
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    const partMatch = line.match(PARTICIPANT_RE)
    if (partMatch) {
      const kind = partMatch[1]!.toLowerCase() === 'actor' ? 'actor' : 'participant'
      const id = partMatch[2]!.trim()
      const label = partMatch[3]?.trim() ?? id
      if (!seen.has(id)) {
        participants.push({ id, label, kind })
        seen.add(id)
      }
      continue
    }

    const msgMatch = line.match(MESSAGE_RE)
    if (msgMatch) {
      const from = msgMatch[1]!.trim()
      const arrow = msgMatch[2]!.trim()
      const to = msgMatch[3]!.trim()
      const text = msgMatch[4]!.trim()
      declareIfMissing(from)
      declareIfMissing(to)
      messages.push({ from, to, text, style: styleForArrow(arrow) })
    }
  }

  return { kind: 'sequence', participants, messages }
}

function styleForArrow(a: string): SequenceMessageStyle {
  switch (a) {
    case '->>': return 'sync'
    case '-->>': return 'reply'
    case '->':  return 'async'
    case '-->': return 'async-dashed'
    case '-x':  return 'lost'
    case '--x': return 'lost-dashed'
    default:    return 'sync'
  }
}

// ---- Family detection ----------------------------------------------------

function detectKind(header: string): DiagramKind | null {
  if (/^statediagram(-v2)?\b/i.test(header)) return 'state'
  if (/^(graph|flowchart)\b/i.test(header)) return 'flowchart'
  if (/^sequencediagram\b/i.test(header)) return 'sequence'
  if (/^classdiagram\b/i.test(header)) return 'class'
  if (/^erdiagram\b/i.test(header)) return 'er'
  if (/^timeline\b/i.test(header)) return 'timeline'
  if (/^journey\b/i.test(header)) return 'journey'
  if (/^xychart(-beta)?\b/i.test(header)) return 'xychart'
  if (/^architecture(-beta)?\b/i.test(header)) return 'architecture'
  return null
}

// ---- Meta extraction -----------------------------------------------------

function extractMeta(rawSource: string): ValidDiagramMeta {
  const meta: ValidDiagramMeta = {
    initDirectives: [],
    comments: [],
    accessibility: {},
  }

  if (FRONTMATTER_REGEX.test(rawSource)) {
    try {
      const norm = normalizeMermaidSource(rawSource)
      if (Object.keys(norm.frontmatter).length > 0) meta.frontmatter = norm.frontmatter
    } catch {
      /* ignore */
    }
  }

  const directiveRegex = new RegExp(INIT_DIRECTIVE_REGEX.source, 'gm')
  let m: RegExpExecArray | null
  while ((m = directiveRegex.exec(rawSource)) !== null) {
    const directive: InitDirective = {
      raw: m[0],
      parsed: tryParseInitObject((m[1] ?? '').trim()) as InitDirective['parsed'],
    }
    meta.initDirectives.push(directive)
  }

  const stripped = rawSource
    .replace(FRONTMATTER_REGEX, '')
    .replace(new RegExp(INIT_DIRECTIVE_REGEX.source, 'gm'), '')
  const lines = stripped.split(/\r?\n/)
  let inAccDescr = false
  let accDescrBuf: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (inAccDescr) {
      if (/^\s*\}\s*$/.test(line)) {
        meta.accessibility.descr = accDescrBuf.join('\n').trim()
        inAccDescr = false
        accDescrBuf = []
      } else {
        accDescrBuf.push(line)
      }
      continue
    }
    if (ACC_DESCR_BLOCK_START.test(line)) {
      inAccDescr = true
      continue
    }
    const accTitle = line.match(ACC_TITLE_REGEX)
    if (accTitle) {
      meta.accessibility.title = accTitle[1]!.trim()
      continue
    }
    const accDescr = line.match(ACC_DESCR_INLINE_REGEX)
    if (accDescr) {
      meta.accessibility.descr = accDescr[1]!.trim()
      continue
    }
    const cm = line.match(COMMENT_LINE_REGEX)
    if (cm) meta.comments.push({ text: cm[1]!, line: i + 1 })
  }

  return meta
}

function tryParseInitObject(inner: string): Record<string, unknown> {
  try {
    return JSON.parse(inner) as Record<string, unknown>
  } catch {
    try {
      const quoted = inner.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      return JSON.parse(quoted) as Record<string, unknown>
    } catch {
      return {}
    }
  }
}

function emptySourceMap(): SourceMap {
  return { nodes: new Map(), edges: new Map(), groups: new Map() }
}

function indexFlowchartSource(
  source: string,
  nodeIds: IterableIterator<string>,
  map: SourceMap,
): void {
  const ids = Array.from(nodeIds)
  const lines = source.split(/\r?\n/)
  for (const id of ids) {
    const regex = new RegExp(`\\b${escapeRegex(id)}\\b`)
    for (let i = 0; i < lines.length; i++) {
      const idx = lines[i]!.search(regex)
      if (idx >= 0) {
        map.nodes.set(id, { line: i + 1, col: idx + 1 })
        break
      }
    }
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
