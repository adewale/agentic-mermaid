import type { LayoutWarning } from './types.ts'
import { normalizeV11Shape } from '../flowchart-shapes.ts'
import { parseMetadataEntries } from '../parser.ts'

export interface FlowchartStatement {
  text: string
  line: number
}

// Edge IDs (`e1@-->`) are MODELED structured edge identity (plan §Flowchart 7)
// and no longer force the opaque fallback or a lint. Node metadata with only
// documented `shape`/`label` keys is modeled too (repo #44); everything else
// under `@{ ... }` (icon/img/animate/undocumented shapes) keeps the lossless
// opaque fallback. Markdown strings render (backticks consumed, emphasis
// stripped — repo #102 layer 1) but stay opaque so the source round-trips
// byte-verbatim.
export function containsFlowchartOpaqueSyntax(source: string): boolean {
  if (/`/.test(source)) return true
  return flowchartStatements(source).some(({ text }) =>
    hasUnmodeledMetadata(text)
    || isFlowchartInteractionDirective(text)
  )
}

export function flowchartUnsupportedSyntaxWarnings(source: string): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  for (const { text, line } of flowchartStatements(source)) {
    if (isUnsupportedEdgeMetadataStatement(text)) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_edge_metadata', message: 'Flowchart edge metadata is preserved as source but ignored by the local renderer/layout.' })
    }
    if (hasUnmodeledNodeMetadata(text)) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_node_metadata', message: 'Flowchart node metadata with an undocumented shape name or icon/img keys is preserved as source; its label renders on a rectangle fallback. Documented v11 shape/label metadata is modeled.' })
    }
    if (isFlowchartInteractionDirective(text)) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_interaction_directive', message: 'Flowchart click/href directives are preserved as source but ignored by the local renderer for security and layout.' })
    }
    if (/`/.test(text)) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_markdown_string', message: 'Flowchart markdown strings render as plain text (backticks consumed, **bold**/*italic* markers stripped); styled runs are not rendered. The source is preserved verbatim.' })
    }
    const malformed = malformedFlowchartStatement(text)
    if (malformed) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: malformed.syntax, message: malformed.message })
    }
  }
  return warnings
}

// ---- `@{ ... }` metadata classification ------------------------------------

/** Every balanced `id@{ … }` object body in the statement (quote-aware). */
function metadataObjects(statement: string): string[] {
  const out: string[] = []
  const re = /([\w-]+)@\s*\{/g
  let match: RegExpExecArray | null
  while ((match = re.exec(statement)) !== null) {
    const before = match.index === 0 ? '' : statement[match.index - 1]!
    if (before && /[\w-]/.test(before)) continue
    const open = statement.indexOf('{', match.index + match[1]!.length)
    const end = findBalancedBraceEnd(statement, open)
    if (end < 0) {
      out.push(statement.slice(open + 1))
      break
    }
    out.push(statement.slice(open + 1, end))
    re.lastIndex = end + 1
  }
  return out
}

function findBalancedBraceEnd(text: string, start: number): number {
  if (start < 0 || text[start] !== '{') return -1
  let depth = 0
  let quote: '"' | "'" | null = null
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Modeled = only shape/label keys, and any shape names a documented v11
 *  shape — via the SAME entry grammar (parser.parseMetadataEntries) and the
 *  ONE shape table (src/flowchart-shapes.ts) the render parser consumes. */
function isModeledNodeMetadata(metadata: string): boolean {
  const entries = parseMetadataEntries(metadata)
  if (entries.size === 0) return false
  for (const key of entries.keys()) {
    if (key !== 'shape' && key !== 'label') return false
  }
  const shape = entries.get('shape')
  if (shape === undefined) return true
  return normalizeV11Shape(shape.trim()) !== null
}

function hasUnmodeledMetadata(statement: string): boolean {
  return metadataObjects(statement).some(metadata => !isModeledNodeMetadata(metadata))
}

/** Unmodeled metadata that is NODE metadata (shape/label/icon/img keys) —
 *  the flowchart_node_metadata lint; edge metadata has its own lint. */
function hasUnmodeledNodeMetadata(statement: string): boolean {
  return metadataObjects(statement).some(metadata => isNodeMetadata(metadata) && !isModeledNodeMetadata(metadata))
}

// Keyword statements where brackets/quotes are free text (subgraph labels) or
// carry no node/edge content that an unclosed delimiter could swallow.
const FLOWCHART_KEYWORD_STATEMENT = /^(?:subgraph\s|end$|direction\s|classDef\s|class\s|style\s|linkStyle\s|click\s|href\s)/i

/**
 * Detect node/edge statements with an unclosed bracket, quote, or |label|
 * delimiter. The legacy parser recovers by regex-matching whatever prefix it
 * can, silently dropping everything after the unclosed delimiter — including
 * arrows, so `A[Start --> B` loses the A→B edge entirely (audit: silent
 * content loss passed verify clean). Surfaced as UNSUPPORTED_SYNTAX so the
 * loss is announced rather than silent, mirroring the other checks above.
 */
function malformedFlowchartStatement(statement: string): { syntax: string; message: string } | null {
  if (FLOWCHART_KEYWORD_STATEMENT.test(statement)) return null
  // Metadata (`id@{ … }`) may span source lines and markdown strings go
  // opaque; both already have dedicated warnings above — skip to avoid noise.
  if (/(?:^|[\s;&])[\w-]+@\s*\{/.test(statement) || /`/.test(statement)) return null

  let depth = 0
  let inQuote = false
  let pipes = 0
  let escaped = false
  for (const ch of statement) {
    if (inQuote) {
      // Backslash escapes only exist inside quoted labels (consumeQuotedNode);
      // outside quotes `\` is literal — lean/trapezoid shapes spell `A[\x\]`.
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === '"') inQuote = false
      continue
    }
    if (ch === '"') { inQuote = true; continue }
    if (ch === '|' && depth === 0) { pipes++; continue }
    if (pipes % 2 === 1) continue  // inside a |edge label|
    if (ch === '[' || ch === '(' || ch === '{') depth++
    // Stray closers are tolerated: `A>text]` (asymmetric) closes without opening.
    else if (ch === ']' || ch === ')' || ch === '}') depth = Math.max(0, depth - 1)
  }
  if (inQuote) {
    return { syntax: 'flowchart_unclosed_quote', message: 'Unclosed double quote — the parser drops or mangles everything after it (labels, arrows, edges). Close the quote.' }
  }
  if (pipes % 2 === 1) {
    return { syntax: 'flowchart_unclosed_pipe', message: 'Unclosed |edge label| delimiter — the parser drops the label and the edge target after it. Close the label with a second |.' }
  }
  if (depth > 0) {
    return { syntax: 'flowchart_unclosed_bracket', message: 'Unclosed bracket — the parser drops or mangles everything after it, including arrows and edges (e.g. `A[Start --> B` loses the A→B edge). Close the bracket or quote the label.' }
  }
  return null
}

export function flowchartStatements(source: string): FlowchartStatement[] {
  const statements: FlowchartStatement[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 1; i < lines.length; i++) {
    let raw = lines[i]!
    const startLine = i + 1
    // A `id@{ ... }` metadata block may span lines (the form Mermaid's docs
    // use). Join it into ONE statement anchored at the opening line, so the
    // node-metadata lint sees the same unit the parser tokenizes — otherwise
    // the multiline form silently misses the UNSUPPORTED_SYNTAX warning the
    // single-line form gets.
    while (i + 1 < lines.length && hasUnclosedMetadataBlock(raw)) {
      i++
      raw += ' ' + lines[i]!
    }
    for (const text of splitFlowchartStatements(raw)) {
      const trimmed = text.trim()
      if (!trimmed || trimmed.startsWith('%%')) continue
      statements.push({ text: trimmed, line: startLine })
    }
  }
  return statements
}

function hasUnclosedMetadataBlock(text: string): boolean {
  const at = text.search(/[\w-]+@\s*\{/)
  if (at < 0) return false
  let depth = 0
  let quote: '"' | "'" | '`' | null = null
  let escaped = false
  for (let i = at; i < text.length; i++) {
    const ch = text[i]!
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return false }
  }
  return depth > 0
}

function isFlowchartInteractionDirective(statement: string): boolean {
  return /^(?:click|href)\s+/i.test(statement.trim())
}

function isUnsupportedEdgeMetadataStatement(statement: string): boolean {
  const match = statement.trim().match(/^[\w-]+@\s*\{([\s\S]*)\}\s*$/)
  if (!match) return false
  const metadata = match[1]!
  // Node metadata is source-preserved by the opaque fallback. Edge metadata
  // has animate/curve semantics only Mermaid itself understands today.
  return !isNodeMetadata(metadata)
}

function isNodeMetadata(metadata: string): boolean {
  const entries = parseMetadataEntries(metadata)
  return entries.has('shape') || entries.has('label') || entries.has('icon') || entries.has('img')
}

function splitFlowchartStatements(line: string): string[] {
  const out: string[] = []
  let start = 0
  let depth = 0
  let quote: '"' | "'" | '`' | null = null
  let escaped = false
  let inPipeLabel = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '|' && depth === 0) { inPipeLabel = !inPipeLabel; continue }
    if (inPipeLabel) continue
    if (ch === '[' || ch === '(' || ch === '{') depth++
    else if (ch === ']' || ch === ')' || ch === '}') depth = Math.max(0, depth - 1)
    else if (ch === ';' && depth === 0 && !semicolonInsideTextArrowLabel(line, i, start)) {
      const part = line.slice(start, i).trim()
      if (part) out.push(part)
      start = i + 1
    }
  }

  const tail = line.slice(start).trim()
  if (tail) out.push(tail)
  return out
}

function semicolonInsideTextArrowLabel(line: string, index: number, start: number): boolean {
  const before = line.slice(start, index)
  const after = line.slice(index + 1)
  const openerRe = /(?:^|\s)(?:[\w-]+@\s*)?(?:<)?(?:-{2,}|-\.+|={2,})\s+/g
  const closerRe = /(?:^|\s)(?:-{2,}>|-{3,}|\.+->|-\.+-|={2,}>|={3,})/
  let activeTextLabel = false
  for (const match of before.matchAll(openerRe)) {
    const tail = before.slice((match.index ?? 0) + match[0].length)
    if (!closerRe.test(tail)) activeTextLabel = true
  }
  return activeTextLabel && closerRe.test(after)
}
