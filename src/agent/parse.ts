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
import { getFamily } from './families.ts'
import './families-builtin.ts'  // registers built-in family parse/serialize/mutate hooks
import type {
  ValidDiagram, ParseError, Result, DiagramKind, ValidDiagramMeta,
  SourceMap, InitDirective,
} from './types.ts'
import { ok, err } from './types.ts'

// Re-exports for callers/tests that used the previous in-tree parser homes.
export { parseSequenceBody } from './sequence-body.ts'
export { parseTimelineBody } from './timeline-body.ts'

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

  // BUILD-3: every other family dispatches through its FamilyPlugin.parse
  // hook (structured-or-opaque). Families without a hook stay source-level.
  const plugin = getFamily(kind)
  if (plugin?.parse) {
    const parsed = plugin.parse(normalized.lines, opaqueSource, meta)
    if (!parsed.ok) {
      errors.push(parsed.error)
      return err(errors)
    }
    return ok<ValidDiagram>({ kind, meta, body: parsed.value, source: sourceMap, canonicalSource })
  }

  return ok<ValidDiagram>({
    kind, meta, body: { kind: 'opaque', family: kind, source: opaqueSource }, source: sourceMap, canonicalSource,
  })
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
