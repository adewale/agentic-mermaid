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
  }
  return warnings
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
