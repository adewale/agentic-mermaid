// ============================================================================
// State-diagram parse core — the ONE note/pseudostate grammar (plan §State 1-2,
// repo #118). Two consumers: the render parser (src/parser.ts
// parseStateDiagram) and the structured agent body (src/agent/state-body.ts).
// The class/journey parse-core precedent: a construct is modeled here once, so
// the renderer and the agent surface cannot drift on what a line means.
//
// Modeled constructs:
//   note left|right of X : text          — single-line note
//   note left|right of X … end note     — block note (body joined with \n)
//   state X <<fork|join|choice>>         — pseudostate stereotype declaration
//   state X <<history|H|deephistory|H*>> — history declaration (PR #5700 forms)
//   from --> to where either endpoint is [H] / [H*] / Base[H] / Base[H*]
//   --                                   — concurrency region separator
// and the statements on the lines (readStateStatements, at the end).
// ============================================================================

import { normalizeBrTags } from '../multiline-utils.ts'
import { STATE_NOTE_OPEN_RE, STATE_NOTE_OPEN_TEXT_RE, STATE_NOTE_END_RE, scanStateComments, type StateSourceLine } from './comment.ts'

export type StateNoteSide = 'left' | 'right'

export interface StateNoteLineMatch {
  target: string
  side: StateNoteSide
  text: string
}

export interface StateNoteOpenMatch {
  target: string
  side: StateNoteSide
}

/** Canonical stereotype ids. `<<H>>` normalizes to 'history', `<<H*>>` and
 *  `<<deephistory>>` to 'deep-history' (PR #5700 accepts all four spellings). */
export type StateStereotype = 'fork' | 'join' | 'choice' | 'history' | 'deep-history'

export interface StateStereotypeMatch {
  id: string
  stereotype: StateStereotype
  /** Quoted alias label (`state "Label" as id <<choice>>`), when present. */
  label?: string
}

const NOTE_LINE_RE = /^note\s+(left|right)\s+of\s+([\w\p{L}-]+)\s*:\s*(.+)$/iu
const STEREOTYPE_RE = /^state\s+(?:"([^"]+)"\s+as\s+)?([\w\p{L}-]+)\s*<<\s*(fork|join|choice|history|deephistory|H\*|H)\s*>>$/u
const SEPARATOR_RE = /^-{2,}$/
/** History transition endpoints: bare `[H]`/`[H*]` or suffixed `Base[H]`/`Base[H*]`. */
const HISTORY_ENDPOINT_RE = /^([\w\p{L}-]*)\[(H\*?)\]$/u
const STATE_NODE_ID_RE = /^[\w\p{L}-]+$/u

/** Ordinary simple-state/note identifier grammar (hyphens allowed). */
export function isStateNodeId(id: string): boolean {
  return STATE_NODE_ID_RE.test(id)
}

/** Simple declarations accept both `Idle` and `state Idle`. */
export function matchStateDeclarationLine(line: string): string | null {
  const explicit = line.match(/^state\s+([\w\p{L}-]+)$/u)
  return explicit?.[1] ?? (isStateNodeId(line) ? line : null)
}

/** Upstream accepts these layout directives without declaring states/edges.
 * Preserve them in opaque source; our renderer uses its own layout policy. */
export function matchStateLayoutDirective(line: string): 'scale' | 'hide_empty_description' | null {
  if (/^scale\s+\d+\s+width$/i.test(line)) return 'scale'
  if (/^hide empty description$/i.test(line)) return 'hide_empty_description'
  return null
}

export { stripStateComment } from './comment.ts'

/** `class Moving, Crash movement` (or `cssClass`) allows spaces around commas. */
export function matchStateClassAssignment(line: string): { ids: string[]; className: string } | null {
  const match = line.match(/^(?:class|cssClass)\s+(.+?)\s+([\w-]+)$/u)
  if (!match) return null
  const ids = match[1]!.split(',').map(id => id.trim())
  if (ids.some(id => !isStateNodeId(id))) return null
  return { ids, className: match[2]! }
}

/** `note left|right of X : text` — single-line note. */
export function matchNoteLine(line: string): StateNoteLineMatch | null {
  const m = line.match(NOTE_LINE_RE)
  if (!m) return null
  return { side: m[1]!.toLowerCase() as StateNoteSide, target: m[2]!, text: m[3]!.trim() }
}

/** `note left|right of X` — opens a block note terminated by `end note`. */
export function matchNoteOpen(line: string): StateNoteOpenMatch | null {
  const m = line.match(STATE_NOTE_OPEN_RE)
  if (!m) return null
  return { side: m[1]!.toLowerCase() as StateNoteSide, target: m[2]! }
}

/** A note's text from its body lines (one for a single-line note). Note text
 *  is a label like any other: `<br>` breaks it and markdown-lite emphasis
 *  formats it, as upstream's note nodes do, whichever form wrote it. */
export function stateNoteText(bodyLines: readonly string[]): string {
  return normalizeBrTags(bodyLines.join('\n'))
}

/** `end note` — closes a block note. */
export function isNoteEnd(line: string): boolean {
  return STATE_NOTE_END_RE.test(line)
}

/** `state X <<fork>>` (optionally `state "Label" as X <<…>>`). */
export function matchStereotypeDecl(line: string): StateStereotypeMatch | null {
  const m = line.match(STEREOTYPE_RE)
  if (!m) return null
  const raw = m[3]!
  const stereotype: StateStereotype =
    raw === 'H' || raw === 'history' ? 'history'
    : raw === 'H*' || raw === 'deephistory' ? 'deep-history'
    : (raw as StateStereotype)
  return { id: m[2]!, stereotype, ...(m[1] !== undefined ? { label: m[1] } : {}) }
}

/** `--` — concurrency region separator inside a composite. */
export function isConcurrencySeparator(line: string): boolean {
  return SEPARATOR_RE.test(line)
}

export interface HistoryEndpointMatch {
  /** The composite the history belongs to; '' for a bare `[H]` (enclosing scope). */
  base: string
  deep: boolean
}

/** `[H]`, `[H*]`, `Base[H]`, `Base[H*]` as a transition endpoint. */
export function matchHistoryEndpoint(endpoint: string): HistoryEndpointMatch | null {
  const m = endpoint.match(HISTORY_ENDPOINT_RE)
  if (!m) return null
  return { base: m[1]!, deep: m[2] === 'H*' }
}

/** Display label for a history pseudostate node. */
export function historyLabel(deep: boolean): 'H' | 'H*' {
  return deep ? 'H*' : 'H'
}

/** Transition-line matcher shared by both parsers. Endpoints accept `[*]`,
 *  plain ids, and the history forms. Returns null when the line is not a
 *  transition. */
const TRANSITION_ENDPOINT = String.raw`\[\*\]|[\w\p{L}-]+\[H\*?\]|\[H\*?\]|[\w\p{L}-]+`
const TRANSITION_RE = new RegExp(
  `^(${TRANSITION_ENDPOINT})(?::::([\\w-]+))?\\s*-->\\s*(${TRANSITION_ENDPOINT})(?::::([\\w-]+))?(?:\\s*:\\s*(.+))?$`,
  'u',
)

export interface StateTransitionMatch {
  from: string
  to: string
  fromClass?: string
  toClass?: string
  label?: string
}

export function matchTransitionLine(line: string): StateTransitionMatch | null {
  const m = line.match(TRANSITION_RE)
  if (!m) return null
  const rawLabel = m[5]?.trim()
  return {
    from: m[1]!,
    ...(m[2] ? { fromClass: m[2] } : {}),
    to: m[3]!,
    ...(m[4] ? { toClass: m[4] } : {}),
    ...(rawLabel ? { label: rawLabel } : {}),
  }
}

/** True when a transition endpoint is a history reference. */
export function isHistoryEndpoint(endpoint: string): boolean {
  return HISTORY_ENDPOINT_RE.test(endpoint)
}

/** Canonical serialized form of a stereotype declaration. */
export function stereotypeMarker(stereotype: StateStereotype): string {
  return stereotype === 'deep-history' ? '<<deephistory>>' : `<<${stereotype}>>`
}

// Residual statement grammar shared by the render and editable projections.
export const STATE_DIRECTION_RE = /^direction\s+(TD|TB|LR|BT|RL)\s*$/i
export const STATE_ALIAS_RE = /^state\s+"([^"]+)"\s+as\s+([\w\p{L}-]+)\s*$/u
export const STATE_COMPOSITE_OPEN_RE = /^state\s+(?:"([^"]+)"\s+as\s+)?([\w\p{L}-]+)\s*\{$/u
export const STATE_DESCRIPTION_RE = /^([\w\p{L}-]+)\s*:\s*(.+)$/u
export const STATE_CLASS_DEF_RE = /^classDef\s+([\w,-]+)\s+(.+)$/
export const STATE_STYLE_RE = /^style\s+([\w\p{L},-]+)\s+(.+)$/u
export const STATE_LINK_STYLE_RE = /^linkStyle\s+(default|[\d,\s]+)\s+(.+)$/

// ---- Statements -------------------------------------------------------------
//
// Mermaid's State lexer does not read one statement per line: statements may
// share a line with nothing between them (`A B`, `A --> B C --> D`), braces
// are tokens (`state X { A }`, `} B`), a `state` declaration may take its `{`
// from the next line, inside a composite a line break is only whitespace
// (`A\n--> B`), and quoted names and block-note text run across lines.
// readStateStatements cuts the comment-scanned lines into the one-statement
// texts both parsers match. Ours also ends a statement at `;` (mermaid#5410),
// which pinned Mermaid reads into a state name. Text after a description
// colon and a keyword statement (`classDef`, `note`, `direction`, …) run to
// the end of their line, and a line ours cannot read to its end stays whole,
// as before. Mermaid rejects a composite the source never closes, and so do
// both parsers (unclosedLines), rather than draw its members without it; but
// a `}` ending the source's last description closes a composite nothing else
// closes, which is what `state X { A : text }` means.

export interface StateStatement {
  text: string
  /** Index of the input line the statement starts on. */
  line: number
  /** A block note's body line, read verbatim. */
  noteBody?: boolean
  /** A `state … {` that opens a composite. */
  opens?: boolean
}

export interface StateStatementScan {
  statements: StateStatement[]
  /** Input lines where `;` separates statements. */
  semicolonLines: number[]
  /** Input lines where a statement follows another with nothing between. */
  juxtaposedLines: number[]
  /** Input lines where `}` closes a composite right after a name. */
  braceNameLines: number[]
  /** Input lines where a `}` (not after a name) closes no composite. */
  unopenedBraceLines: number[]
  /** Input lines where a `}` ending the source's last description or
   *  transition label closes a composite nothing else closes. */
  braceTextLines: number[]
  /** Input lines where `state "…" as X` is followed by `:::c`, or by a
   *  description holding a colon, which Mermaid splits off and drops. */
  aliasSuffixLines: number[]
  /** Input lines of the composites the source never closes. */
  unclosedLines: number[]
}

// A name starts with a letter or digit; a hyphen continues it unless it
// starts an arrow (`A-->B`).
const STATEMENT_ENDPOINT_AT = /(?:\[\*\]|\[H\*?\]|[\w\p{L}](?:[\w\p{L}]|-(?!->))*(?:\[H\*?\])?)(?::::(?:\w|-(?!->))+)?/uy
const STATEMENT_KEYWORD_AT = /(?:classDef|class|cssClass|style|linkStyle|direction|scale|hide|note|end|click)(?=[ \t]|$)/y
const STATE_KEYWORD_AT = /state[ \t]+/y
const STATE_ID_AT = /[\w\p{L}-]+/uy
const STATE_AS_AT = /[ \t]+as[ \t]+/y
const STATE_AS_WORD_AT = /[ \t]+as(?=[ \t]|$)/y
const STEREOTYPE_AT = /[ \t]*<<[^>\n]*>>/y
const OPEN_BRACE_AT = /[ \t]*\{/y
const CLASS_SHORTHAND_AT = /:::[\w-]+/y
const SEPARATOR_AT = /-{2,}(?=[ \t;}]|$)/y

function matchAt(pattern: RegExp, text: string, index: number): string | null {
  pattern.lastIndex = index
  return pattern.exec(text)?.[0] ?? null
}

function skipBlank(text: string, index: number): number {
  while (text[index] === ' ' || text[index] === '\t') index++
  return index
}

/** A name ends at a blank, `;`, `}`, a description colon or an arrow. */
function endsName(text: string, index: number): boolean {
  return index >= text.length || ' \t;}:'.includes(text[index]!) || text.startsWith('-->', index)
}

/** The last of the lines a string left open at `start` joins: up to its
 *  closing quote. */
function quotedRunEnd(lines: readonly StateSourceLine[], start: number): number {
  let end = start
  while (lines[end]!.openQuote && end + 1 < lines.length) end++
  return end
}

/** For each source line, the last line of the statement that starts there:
 *  Mermaid's State lexer reads a quoted name or note text to its closing
 *  quote, and block-note text to its `end note`, across line breaks. Source
 *  normalization reads no line inside one as an accTitle/accDescr. */
export function stateStatementEnds(source: readonly string[]): number[] {
  const lines = scanStateComments(source)
  return lines.map((line, index) => {
    if (!line.noteOpen) return quotedRunEnd(lines, index)
    let end = index
    while (end + 1 < lines.length && lines[end + 1]!.noteBody) end++
    // The note's text ends at its `end note` line, which closes the body.
    return Math.min(end + 1, lines.length - 1)
  })
}

export function readStateStatements(lines: readonly StateSourceLine[]): StateStatementScan {
  // A string left open joins the lines up to its closing quote.
  const logical: Array<{ text: string; line: number; noteBody: boolean; noteOpen: boolean }> = []
  for (let index = 0; index < lines.length; index++) {
    const start = index
    index = quotedRunEnd(lines, start)
    const text = lines.slice(start, index + 1).map(line => line.text).join('\n')
    if (text || lines[start]!.noteBody) logical.push({ text, line: start, noteBody: lines[start]!.noteBody, noteOpen: lines[start]!.noteOpen })
  }
  const statements: StateStatement[] = []
  const semicolonLines = new Set<number>()
  const juxtaposedLines = new Set<number>()
  const braceNameLines = new Set<number>()
  const unopenedBraceLines = new Set<number>()
  const braceTextLines = new Set<number>()
  const aliasSuffixLines = new Set<number>()
  // Mermaid's name token takes a `}` right after it. Such a brace is
  // reported as that (braceNameLines), not as one opening nothing; its row
  // and column are kept for the brace's own reading.
  const nameBraces = new Set<string>()
  const noteBraceAfter = (at: number, index: number): void => {
    if (logical[at]!.text[index] !== '}') return
    braceNameLines.add(logical[at]!.line)
    nameBraces.add(`${at}:${index}`)
  }
  // The renderer drops `//` lines outside strings before it reads
  // (parseMermaid), so they come after no row here either.
  let lastRow = logical.length - 1
  while (lastRow > 0 && !logical[lastRow]!.noteBody && logical[lastRow]!.text.startsWith('//')) lastRow--
  /** Where the text after a colon ends: the end of its line, as Mermaid
   *  reads it, except that on the source's last row a `}` the text does not
   *  open closes a composite still open, which Mermaid rejects as unclosed. */
  const textEnd = (text: string, colon: number, row: number): number => {
    let end = text.length
    if (row !== lastRow) return end
    let excess = 0
    for (let index = colon + 1; index < end; index++) excess += text[index] === '}' ? 1 : text[index] === '{' ? -1 : 0
    const first = skipBlank(text, colon + 1)
    for (let closes = 0; closes < depth && excess > 0; closes++, excess--) {
      let brace = end - 1
      while (text[brace] === ' ' || text[brace] === '\t') brace--
      // The text keeps at least one character of its own.
      if (text[brace] !== '}' || brace <= first) break
      end = brace
    }
    return end
  }
  let depth = 0
  let row = 0
  let column = 0
  let delimited = true
  const emit = (text: string, line: number, delimitsNext: boolean): void => {
    if (!delimited) juxtaposedLines.add(line)
    statements.push({ text, line })
    delimited = delimitsNext
  }
  const statementRowAfter = (index: number): boolean => {
    const next = logical[index + 1]
    return next !== undefined && !next.noteBody && !next.noteOpen
  }
  // Inside a composite a line break is whitespace (Mermaid's struct state).
  const skipSpace = (cursor: { row: number; column: number }): void => {
    for (;;) {
      const text = logical[cursor.row]!.text
      cursor.column = skipBlank(text, cursor.column)
      if (cursor.column < text.length || depth === 0 || !statementRowAfter(cursor.row)) return
      cursor.row++
      cursor.column = 0
    }
  }
  /** `A` or `A --> B`, either with a description; null leaves the cursor. */
  const readIdStatement = (): string | null => {
    const first = logical[row]!.text
    const left = matchAt(STATEMENT_ENDPOINT_AT, first, column)
    if (left === null || !endsName(first, column + left.length)) return null
    noteBraceAfter(row, column + left.length)
    const cursor = { row, column: column + left.length }
    let statement = left
    const arrow = { ...cursor }
    skipSpace(arrow)
    if (logical[arrow.row]!.text.startsWith('-->', arrow.column)) {
      arrow.column += 3
      skipSpace(arrow)
      const text = logical[arrow.row]!.text
      const right = matchAt(STATEMENT_ENDPOINT_AT, text, arrow.column)
      if (right === null || !endsName(text, arrow.column + right.length)) return null
      noteBraceAfter(arrow.row, arrow.column + right.length)
      statement += ` --> ${right}`
      cursor.row = arrow.row
      cursor.column = arrow.column + right.length
    }
    const text = logical[cursor.row]!.text
    const colon = skipBlank(text, cursor.column)
    if (text[colon] === ':') {
      const end = textEnd(text, colon, cursor.row)
      if (end < text.length) braceTextLines.add(logical[cursor.row]!.line)
      statement += ` ${text.slice(colon, end).trimEnd()}`
      cursor.column = end
    }
    row = cursor.row
    column = cursor.column
    return statement
  }
  /** `: text` or `:::c` after `state "label" as id`. Mermaid's name after
   *  `as` runs to a `{` or the line's end, and it splits that name at `:`
   *  (stateDiagram.jison): the text up to a second colon describes the state,
   *  as `id : text` does. Ours reads the whole text so, and `id:::c` as the
   *  state's class, which Mermaid drops for an empty description; both are
   *  reported (aliasSuffixLines). Null leaves the cursor. */
  const readAliasSuffix = (text: string, label: string, id: string, at: number): { text: string; opens: boolean; also?: string } | null => {
    const line = logical[row]!.line
    const declaration = `state ${label}${id}`
    const colon = skipBlank(text, at)
    const shorthand = matchAt(CLASS_SHORTHAND_AT, text, colon)
    if (shorthand !== null) {
      const next = skipBlank(text, colon + shorthand.length)
      if (next < text.length && text[next] !== ';' && text[next] !== '}') return null
      noteBraceAfter(row, next)
      aliasSuffixLines.add(line)
      column = colon + shorthand.length
      return { text: declaration, opens: false, also: `${id}${shorthand}` }
    }
    // A `{` makes Mermaid read a composite named `id : text`.
    if (text.startsWith(':::', colon) || text.includes('{', colon)) return null
    const end = textEnd(text, colon, row)
    if (end < text.length) braceTextLines.add(line)
    const description = text.slice(colon + 1, end).trim()
    if (description.includes(':')) aliasSuffixLines.add(line)
    column = end
    return { text: declaration, opens: false, ...(description ? { also: `${id} : ${description}` } : {}) }
  }
  /** `state ["label" as] id [<<stereotype>>] [{]`; null leaves the cursor. */
  const readStateDeclaration = (from: number): { text: string; opens: boolean; also?: string } | null => {
    const text = logical[row]!.text
    let at = from
    let label = ''
    if (text[at] === '"') {
      const close = text.indexOf('"', at + 1)
      const as = close < 0 ? null : matchAt(STATE_AS_AT, text, close + 1)
      if (as === null) return null
      label = `${text.slice(at, close + 1)} as `
      at = close + 1 + as.length
    }
    const id = matchAt(STATE_ID_AT, text, at)
    if (id === null) return null
    at += id.length
    // Mermaid's `as` follows only a quoted label: it rejects `state X as Y`.
    if (!label && matchAt(STATE_AS_WORD_AT, text, at) !== null) return null
    if (label && text[skipBlank(text, at)] === ':') return readAliasSuffix(text, label, id, at)
    const stereotype = matchAt(STEREOTYPE_AT, text, at)
    if (stereotype !== null) at += stereotype.length
    const brace = matchAt(OPEN_BRACE_AT, text, at)
    let opens = brace !== null
    const next = skipBlank(text, at)
    if (brace !== null) at += brace.length
    else if (at < text.length && !' \t;}'.includes(text[at]!)) return null
    else if (stereotype === null && next === text.length && statementRowAfter(row) && logical[row + 1]!.text.startsWith('{')) {
      // `state X` with its `{` on the next line, as Mermaid's STATE lexer reads it.
      row++
      at = 1
      opens = true
    } else if (label && stereotype === null && next < text.length) {
      // Mermaid's name after `as` runs to a `{` or the line's end, so another
      // statement cannot follow it: `state "L" as X Y` names one state `X Y`,
      // which ours cannot hold. Its `}` is read into the name too.
      if (text[next] !== ';' && text[next] !== '}') return null
      noteBraceAfter(row, next)
    }
    column = at
    return { text: `state ${label}${id}${stereotype === null ? '' : ` ${stereotype.trim()}`}${opens ? ' {' : ''}`, opens }
  }

  // Where the statements read from the current row begin, so a row ours
  // cannot read to its end is kept whole, as authored.
  let mark = { statements: 0, depth: 0, column: 0 }
  while (row < logical.length) {
    const entry = logical[row]!
    if (column === 0) {
      delimited = true
      mark = { statements: statements.length, depth, column: 0 }
      if (entry.noteBody) {
        statements.push({ text: entry.text, line: entry.line, noteBody: true })
        row++
        continue
      }
      const opener = entry.noteOpen ? entry.text.match(STATE_NOTE_OPEN_TEXT_RE) : null
      if (opener) {
        statements.push({ text: `note ${opener[1]} of ${opener[2]}`, line: entry.line }, { text: opener[3]!, line: entry.line, noteBody: true })
        row++
        continue
      }
    }
    const text = entry.text
    column = skipBlank(text, column)
    if (column >= text.length) {
      row++
      column = 0
      continue
    }
    const line = entry.line
    const character = text[column]!
    if (character === ';') {
      semicolonLines.add(line)
      column++
      delimited = true
      continue
    }
    if (character === '}') {
      if (depth === 0 && !nameBraces.has(`${row}:${column}`)) unopenedBraceLines.add(line)
      statements.push({ text: '}', line })
      depth = Math.max(0, depth - 1)
      column++
      delimited = true
      continue
    }
    const separator = depth > 0 ? matchAt(SEPARATOR_AT, text, column) : null
    if (separator !== null) {
      statements.push({ text: separator, line })
      column += separator.length
      delimited = true
      continue
    }
    if (matchAt(STATEMENT_KEYWORD_AT, text, column) !== null) {
      // A keyword statement runs to the end of its line.
      emit(text.slice(column), line, false)
      row++
      column = 0
      continue
    }
    const startRow = row
    const keyword = matchAt(STATE_KEYWORD_AT, text, column)
    const declaration = keyword === null ? null : readStateDeclaration(column + keyword.length)
    const statement = declaration?.text ?? (keyword === null ? readIdStatement() : null)
    if (statement !== null) {
      emit(statement, line, declaration?.opens ?? false)
      if (declaration?.opens) {
        statements.at(-1)!.opens = true
        depth++
      }
      // `state "L" as X : text` is read as `state "L" as X` and `X : text`.
      if (declaration?.also !== undefined) statements.push({ text: declaration.also, line })
      if (row !== startRow) mark = { statements: statements.length, depth, column }
      continue
    }
    // Ours cannot read the rest of the row: keep it whole, so the parsers
    // report it as written rather than accept a fragment of it.
    statements.length = mark.statements
    depth = mark.depth
    juxtaposedLines.delete(line)
    semicolonLines.delete(line)
    braceNameLines.delete(line)
    unopenedBraceLines.delete(line)
    braceTextLines.delete(line)
    aliasSuffixLines.delete(line)
    statements.push({ text: text.slice(mark.column).trim(), line })
    row++
    column = 0
  }
  const open: number[] = []
  for (const statement of statements) {
    if (statement.opens) open.push(statement.line)
    else if (statement.text === '}' && !statement.noteBody) open.pop()
  }
  return {
    statements, semicolonLines: [...semicolonLines], juxtaposedLines: [...juxtaposedLines],
    braceNameLines: [...braceNameLines], unopenedBraceLines: [...unopenedBraceLines], braceTextLines: [...braceTextLines], aliasSuffixLines: [...aliasSuffixLines], unclosedLines: open,
  }
}
