// ============================================================================
// parseMermaid: source → ValidDiagram (multi-error).
//
// v4 sequence fidelity: parseSequenceBody returns null if it encounters ANY
// non-blank, non-comment line it doesn't fully understand. parse then falls
// back to an opaque body (lossless round-trip via canonicalSource) rather
// than silently dropping the unrecognized construct.
// ============================================================================

import { normalizeMermaidSource, detectLooseDiagramTypeFromFirstLine } from '../mermaid-source.ts'
import { getFamily } from './families.ts'
import './families-builtin.ts'  // registers built-in family parse/serialize/mutate hooks
import { serializeMermaid } from './serialize.ts'
import type {
  ValidDiagram, ParseError, Result, DiagramKind, ValidDiagramMeta,
  SourceMap, InitDirective, SourceComment,
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

  // BUILD-3: every family dispatches through its FamilyPlugin.parse hook —
  // structured-or-opaque for the narrow families, error semantics for
  // flowchart/state. Families without a hook stay source-level.
  const plugin = getFamily(kind)
  if (plugin?.parse) {
    const parsed = plugin.parse(normalized.lines, opaqueSource, meta, canonicalSource)
    if (!parsed.ok) {
      errors.push(...parsed.error)
      return err(errors)
    }
    const sourceMap = plugin.buildSourceMap?.(parsed.value, canonicalSource) ?? emptySourceMap()
    const diagram: ValidDiagram = { kind, meta, body: parsed.value, source: sourceMap, canonicalSource }
    markDroppedComments(diagram, normalized.body)
    return ok(diagram)
  }

  return ok<ValidDiagram>({
    kind, meta, body: { kind: 'opaque', family: kind, source: opaqueSource }, source: emptySourceMap(), canonicalSource,
  })
}

/**
 * 2C comment policy: structured bodies serialize to canonical source, which
 * does not model `%%` comment lines. Rather than dropping them *silently*,
 * diff the parsed comments against what actually survives serialization
 * (wrapper comments ride along verbatim via meta.wrapperSource; sequence
 * opaque segments may preserve in-body comments) and record the casualties so
 * verify can surface the Tier 3 COMMENT_DROPPED lint. Opaque bodies preserve
 * everything and never reach here.
 */
function markDroppedComments(diagram: ValidDiagram, sourceBody: string): void {
  const comments = diagram.meta.comments
  if (diagram.body.kind === 'opaque' || comments.length === 0) return

  const sourceLines = sourceBody.split(/\r?\n/).map(line => line.trim())
  const serializedLines = serializeMermaid(diagram).split(/\r?\n/).map(line => line.trim())
  const keptSourceLines = longestCommonSubsequenceIndices(sourceLines, serializedLines)
  const keptCommentLines = new Set<number>()
  for (const sourceIndex of keptSourceLines) {
    if (COMMENT_LINE_REGEX.test(sourceLines[sourceIndex]!)) keptCommentLines.add(sourceIndex + 1)
  }

  const dropped: SourceComment[] = comments.filter(comment => !keptCommentLines.has(comment.line))
  if (dropped.length > 0) diagram.meta.droppedComments = dropped
}

function longestCommonSubsequenceIndices(a: string[], b: string[]): number[] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j]
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const indices: number[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      indices.push(i)
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++
    } else {
      j++
    }
  }
  return indices
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

  const wrapperSource = extractWrapperSource(rawSource)
  if (wrapperSource !== undefined) meta.wrapperSource = wrapperSource

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

/**
 * The leading source wrapper, byte-verbatim: an optional frontmatter block
 * followed by any run of blank lines, `%%` comments, and `%%{init}%%`
 * directives, up to (excluding) the diagram header line. This is what
 * serializeMermaid re-emits untouched by default (1C wrapper policy).
 */
function extractWrapperSource(rawSource: string): string | undefined {
  let pos = 0
  const fm = rawSource.match(FRONTMATTER_REGEX)
  if (fm) pos = fm[0].length
  const directiveAtStart = new RegExp(INIT_DIRECTIVE_REGEX.source)
  for (;;) {
    const rest = rawSource.slice(pos)
    if (rest.length === 0) break
    const dm = rest.match(directiveAtStart)
    if (dm && dm.index === 0 && dm[0].length > 0) { pos += dm[0].length; continue }
    const lineEnd = rest.indexOf('\n')
    const line = lineEnd === -1 ? rest : rest.slice(0, lineEnd)
    if (/^\s*$/.test(line) || COMMENT_LINE_REGEX.test(line)) {
      pos += lineEnd === -1 ? rest.length : lineEnd + 1
      continue
    }
    break
  }
  return pos > 0 ? rawSource.slice(0, pos) : undefined
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
  return { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
}

