import type { LayoutWarning } from './types.ts'

export interface FlowchartStatement {
  text: string
  line: number
}

const EDGE_ID_OPERATOR_LOOKAHEAD = String.raw`(?:<)?(?:~{3,}|-\.+->|-\.+-|={2,}>|={3,}|o-{2,}[ox]|x-{2,}[ox]|-{2,}[ox]|-{2,}>|-{3,}|(?:-{2,}|-\.+|={2,})\s+)`
const EDGE_ID_REGEX = new RegExp(String.raw`(?:^|[\s&])([\w-]+)@\s*(?=${EDGE_ID_OPERATOR_LOOKAHEAD})`)

export function containsFlowchartOpaqueSyntax(source: string): boolean {
  if (/`/.test(source)) return true
  return flowchartStatements(source).some(({ text }) =>
    /^([\w-]+)@\s*\{/.test(text)
    || hasFlowchartEdgeId(text)
    || isFlowchartInteractionDirective(text)
  )
}

export function flowchartUnsupportedSyntaxWarnings(source: string): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  for (const { text, line } of flowchartStatements(source)) {
    if (hasFlowchartEdgeId(text)) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_edge_id', message: 'Flowchart edge IDs are preserved as source but not modeled as structured edge identity yet.' })
    }
    if (isUnsupportedEdgeMetadataStatement(text)) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_edge_metadata', message: 'Flowchart edge metadata is preserved as source but ignored by the local renderer/layout.' })
    }
    if (isNodeMetadataStatement(text)) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_node_metadata', message: 'Flowchart node metadata (@{ shape: ... }) is preserved as source and its label is rendered, but the v11 shape vocabulary is not yet modeled by the local renderer/layout.' })
    }
    if (isFlowchartInteractionDirective(text)) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_interaction_directive', message: 'Flowchart click/href directives are preserved as source but ignored by the local renderer for security and layout.' })
    }
    if (/`/.test(text)) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: 'flowchart_markdown_string', message: 'Flowchart markdown strings are preserved as source but not fully modeled by the local parser.' })
    }
    const malformed = malformedFlowchartStatement(text)
    if (malformed) {
      warnings.push({ code: 'UNSUPPORTED_SYNTAX', line, syntax: malformed.syntax, message: malformed.message })
    }
  }
  return warnings
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
    const raw = lines[i]!
    for (const text of splitFlowchartStatements(raw)) {
      const trimmed = text.trim()
      if (!trimmed || trimmed.startsWith('%%')) continue
      statements.push({ text: trimmed, line: i + 1 })
    }
  }
  return statements
}

function hasFlowchartEdgeId(statement: string): boolean {
  return EDGE_ID_REGEX.test(maskFlowchartLabels(statement))
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

// `id@{ shape: ... }` node metadata (Mermaid v11.3+). Preserved losslessly by the
// opaque fallback (issue #29), but still unmodeled — so it is surfaced loudly,
// like every other unsupported flowchart construct (issue #36), rather than kept
// silent. Advisory (Tier-3): it never flips verify.ok and never drops source.
function isNodeMetadataStatement(statement: string): boolean {
  const match = statement.trim().match(/^[\w-]+@\s*\{([\s\S]*)\}\s*$/)
  return match ? isNodeMetadata(match[1]!) : false
}

function isNodeMetadata(metadata: string): boolean {
  return /(?:^|,)\s*(?:shape|label|icon|img)\s*:/i.test(metadata)
}

function maskFlowchartLabels(statement: string): string {
  let masked = ''
  let start = 0
  let quote: '"' | "'" | '`' | null = null
  let escaped = false
  let pipeStart = -1
  for (let i = 0; i < statement.length; i++) {
    const ch = statement[i]!
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch !== '|') continue
    if (pipeStart < 0) {
      pipeStart = i
    } else {
      masked += statement.slice(start, pipeStart) + '| |'
      start = i + 1
      pipeStart = -1
    }
  }
  masked += statement.slice(start)
  return masked.replace(/((?:<)?(?:-{2,}|-\.+|={2,}))\s+(.+?)\s+(-{2,}>|-{3,}|\.+->|-\.+-|={2,}>|={3,})/g, '$1 $3')
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
