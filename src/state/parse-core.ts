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

import { STATE_NOTE_OPEN_RE, STATE_NOTE_OPEN_TEXT_RE, STATE_NOTE_END_RE, scanStateComments, type StateSourceLine } from './comment.ts'
import { mermaidEntityPrepass } from '../shared/mermaid-entities.ts'

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

const NOTE_LINE_RE = /^note\s+(left|right)\s+of\s+([\w\p{L}\p{M}\p{N}-]+)\s*:\s*([^\r\n]+)$/iu
const STEREOTYPE_RE = /^state\s+(?:"([^"]+)"\s+as\s+)?([\w\p{L}\p{M}\p{N}-]+)\s*<<\s*(fork|join|choice|history|deephistory|H\*|H)\s*>>$/iu
const SEPARATOR_RE = /^-{2,}$/
/** History transition endpoints: bare `[H]`/`[H*]` or suffixed `Base[H]`/`Base[H*]`. */
const HISTORY_ENDPOINT_RE = /^([\w\p{L}\p{M}\p{N}-]*)\[(H\*?)\]$/u
const STATE_NODE_ID_RE = /^[\w\p{L}\p{M}\p{N}-]+$/u

/** Ordinary simple-state/note identifier grammar (hyphens allowed). */
export function isStateNodeId(id: string): boolean {
  return STATE_NODE_ID_RE.test(id)
}

/** Simple declarations accept both `Idle` and `state Idle`. */
export function matchStateDeclarationLine(line: string): string | null {
  const explicit = line.match(/^state\s+([\w\p{L}\p{M}\p{N}-]+)$/u)
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
  const match = line.match(/^(?:class|cssClass)\s+(.+?)\s+([\w-]+)$/iu)
  if (!match) return null
  const ids = match[1]!.split(',').map(id => id.trim())
  if (ids.some(id => !isStateNodeId(id))) return null
  return { ids, className: match[2]! }
}

/** State text as pinned Mermaid's lexer meets it: after its prepass, it
 *  reads an entity code (`#59;`), so the code's `;` ends no text. */
export function lexedStateText(text: string): string {
  return mermaidEntityPrepass(text).replace(/#\w+;/g, '#')
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

/** The quoted payload can span physical lines; readStateStatements has
 * already joined the string without interpreting its note-like contents. */
export function matchFloatingNote(line: string): { id: string; text: string } | null {
  const match = /^note\s+"([^"]*)"\s+as\s+([\w\p{L}\p{M}\p{N}-]+)\s*$/iu.exec(line)
  return match ? { id: match[2]!, text: match[1]! } : null
}


/** `end note` — closes a block note. */
export function isNoteEnd(line: string): boolean {
  return STATE_NOTE_END_RE.test(line)
}

/** `state X <<fork>>` (optionally `state "Label" as X <<…>>`). */
export function matchStereotypeDecl(line: string): StateStereotypeMatch | null {
  const m = line.match(STEREOTYPE_RE)
  if (!m) return null
  const raw = m[3]!.toLowerCase()
  const stereotype: StateStereotype =
    raw === 'h' || raw === 'history' ? 'history'
    : raw === 'h*' || raw === 'deephistory' ? 'deep-history'
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
const TRANSITION_ENDPOINT = String.raw`\[\*\]|[\w\p{L}\p{M}\p{N}-]+\[H\*?\]|\[H\*?\]|[\w\p{L}\p{M}\p{N}-]+`
const TRANSITION_RE = new RegExp(
  `^(${TRANSITION_ENDPOINT})(?::::([\\w-]+))?\\s*-->\\s*(${TRANSITION_ENDPOINT})(?::::([\\w-]+))?(?:\\s*:\\s*([^\\r\\n]+))?$`,
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
export const STATE_ALIAS_RE = /^state\s+"([^"]+)"\s+as\s+([\w\p{L}\p{M}\p{N}-]+)\s*$/u
export const STATE_COMPOSITE_OPEN_RE = /^state\s+(?:"([^"]+)"\s+as\s+)?([\w\p{L}\p{M}\p{N}-]+)\s*\{$/u
export const STATE_DESCRIPTION_RE = /^([\w\p{L}\p{M}\p{N}-]+)\s*:\s*([^\r\n]+)$/u
export const STATE_CLASS_DEF_RE = /^classDef\s+([\w,-]+)\s+(.+)$/i
export const STATE_STYLE_RE = /^style\s+([\w\p{L}\p{M}\p{N},-]+)\s+(.+)$/iu
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

/** A place in the input lines as the comment scan reads them: a line's
 *  index and a column in its text. */
export interface StatePosition {
  line: number
  column: number
}

export interface StateStatement {
  text: string
  /** Index of the input line the statement starts on. */
  line: number
  /** Where its text runs, when it is not a note's: a description's or a
   *  transition label's from its colon, a quoted name's from its quote. */
  textSpan?: { start: StatePosition; end: StatePosition }
  /** The input line a transition's target starts on. */
  toLine?: number
  /** For a transition's source and target, whether a blank or a line break
   *  follows the name: Mermaid's lexer reads a keyword such as `note` only
   *  before one. */
  nameBlanks?: boolean[]
  /** A block note's body line, read verbatim. */
  noteBody?: boolean
  /** A `state … {` that opens a composite. */
  opens?: boolean
  /** Read from the rest of a `state "…" as id` line, which Mermaid reads
   *  as the name to the line's end. */
  afterAlias?: boolean
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
   *  transition label closes a composite nothing else closes, and Mermaid
   *  reads it into the text. */
  braceTextLines: number[]
  /** Input lines where `state "…" as X` is followed by `:::c`, or by a
   *  description holding a colon, which Mermaid splits off and drops. */
  aliasSuffixLines: number[]
  /** Input lines of the composites the source never closes. */
  unclosedLines: number[]
}

// A name starts with a letter or digit; a hyphen continues it unless it
// starts an arrow (`A-->B`), as in a class name after `:::`.
const STATEMENT_ENDPOINT_AT = /\[\*\]|\[H\*?\]|[\w\p{L}\p{M}\p{N}](?:[\w\p{L}\p{M}\p{N}]|-(?!->))*(?:\[H\*?\])?/uy
const ENDPOINT_CLASS_AT = /(?:\w|-(?!->))+/y
// Mermaid's State lexer is case-insensitive, so its keywords are read in any
// case. `end` and `hide` are keywords only in `end note` and `hide empty
// description`, and names otherwise, as upstream; `direction` with any word
// after it stays a statement, which ours rejects unless it names a
// direction. `cssClass` and `linkStyle` are ours.
const STATEMENT_KEYWORD_AT = /(?:(?:classDef|class|style|note|scale|click|direction)(?=[ \t]|$)|end(?=[ \t]+note(?:[ \t]|$))|hide(?=[ \t]+empty[ \t]+description(?:[ \t]|$)))/iy
const OWN_KEYWORD_AT = /(?:cssClass|linkStyle)(?=[ \t]|$)/y
const STATE_KEYWORD_AT = /state[ \t]+/iy
const STATE_ID_AT = /[\w\p{L}\p{M}\p{N}-]+/uy
const STATE_AS_AT = /[ \t]+as[ \t]+/iy
const STATE_AS_WORD_AT = /[ \t]+as(?=[ \t]|$)/iy
const STEREOTYPE_AT = /[ \t]*(?:<<[^>\n]*>>|\[\[(fork|join|choice)\]\])/iy
const OPEN_BRACE_AT = /[ \t]*\{/y
const CLASS_SHORTHAND_AT = /:::[ \t]*([\w-]+)/y
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

/** A statement read from a row, with the one read after it on its line:
 *  `state "L" as X : text` is `state "L" as X` and `X : text`. */
interface StatementRead {
  text: string
  opens?: boolean
  textSpan?: StateStatement['textSpan']
  toLine?: number
  nameBlanks?: boolean[]
  also?: string
  alsoSpan?: StateStatement['textSpan']
}

export function readStateStatements(lines: readonly StateSourceLine[]): StateStatementScan {
  // A string left open joins the lines up to its closing quote.
  const logical: Array<{ text: string; line: number; noteBody: boolean; noteOpen: boolean; commentGlued: boolean }> = []
  for (let index = 0; index < lines.length; index++) {
    const start = index
    index = quotedRunEnd(lines, start)
    const text = lines.slice(start, index + 1).map(line => line.text).join('\n')
    if (text || lines[start]!.noteBody) logical.push({ text, line: start, noteBody: lines[start]!.noteBody, noteOpen: lines[start]!.noteOpen, commentGlued: lines[index]!.commentGlued })
  }
  /** The input line and column of a column in a row, which joins the
   *  lines a string runs across. */
  const at = (row: number, column: number): StatePosition => {
    const text = logical[row]!.text
    let line = logical[row]!.line
    let start = 0
    for (let index = text.indexOf('\n'); index >= 0 && index < column; index = text.indexOf('\n', index + 1)) {
      line++
      start = index + 1
    }
    return { line, column: column - start }
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
  /** An endpoint at the cursor: a name, `[*]` or a history reference, with
   *  an optional `:::class`. Mermaid's lexer skips the blanks around `:::`
   *  (inside a composite, line breaks too), so `A ::: c` is `A:::c`, as it is
   *  written here. Advances the cursor past it; null leaves the cursor. */
  const readEndpoint = (cursor: { row: number; column: number }, blanks: boolean[]): string | null => {
    const name = matchAt(STATEMENT_ENDPOINT_AT, logical[cursor.row]!.text, cursor.column)
    if (name === null) return null
    let endpoint = name
    const end = { row: cursor.row, column: cursor.column + name.length }
    // A comment glued to the name (`note%%`) ends it with no blank.
    const after = logical[cursor.row]!.text.slice(end.column, end.column + 1)
    blanks.push(/^[ \t\n]/.test(after) || (after === '' && !logical[cursor.row]!.commentGlued))
    const shorthand = { ...end }
    skipSpace(shorthand)
    if (logical[shorthand.row]!.text.startsWith(':::', shorthand.column)) {
      shorthand.column += 3
      skipSpace(shorthand)
      const className = matchAt(ENDPOINT_CLASS_AT, logical[shorthand.row]!.text, shorthand.column)
      if (className === null) return null
      endpoint += `:::${className}`
      end.row = shorthand.row
      end.column = shorthand.column + className.length
    }
    if (!endsName(logical[end.row]!.text, end.column)) return null
    noteBraceAfter(end.row, end.column)
    cursor.row = end.row
    cursor.column = end.column
    return endpoint
  }
  /** `A` or `A --> B`, either with a description; null leaves the cursor. */
  const readIdStatement = (): StatementRead | null => {
    const cursor = { row, column }
    const nameBlanks: boolean[] = []
    const left = readEndpoint(cursor, nameBlanks)
    if (left === null) return null
    let statement = left
    const arrow = { ...cursor }
    skipSpace(arrow)
    const transition = logical[arrow.row]!.text.startsWith('-->', arrow.column)
    let toLine: number | undefined
    if (transition) {
      arrow.column += 3
      skipSpace(arrow)
      toLine = at(arrow.row, arrow.column).line
      const right = readEndpoint(arrow, nameBlanks)
      if (right === null) return null
      statement += ` --> ${right}`
      cursor.row = arrow.row
      cursor.column = arrow.column
    }
    const text = logical[cursor.row]!.text
    const colon = skipBlank(text, cursor.column)
    const read: StatementRead = { text: statement, ...(toLine !== undefined ? { toLine, nameBlanks } : {}) }
    if (text[colon] === ':') {
      const end = textEnd(text, colon, cursor.row)
      // Mermaid reads the `}` into the text, unless a `;` or `::` ends the
      // text before it (stateUnsupportedSyntaxWarnings reports those).
      if (end < text.length && !/;|::/.test(lexedStateText(text.slice(colon + 1, end)))) braceTextLines.add(logical[cursor.row]!.line)
      const description = text.slice(colon, end).trimEnd()
      const textSpan = { start: at(cursor.row, colon), end: at(cursor.row, end) }
      // `A:::c : text` is A's class and its description, read as the two
      // statements `A:::c` and `A : text`.
      const shorthand = transition ? -1 : left.indexOf(':::')
      if (shorthand < 0) Object.assign(read, { text: `${statement} ${description}`, textSpan })
      else Object.assign(read, { also: `${left.slice(0, shorthand)} ${description}`, alsoSpan: textSpan })
      cursor.column = end
    }
    row = cursor.row
    column = cursor.column
    return read
  }
  /** `: text` or `:::c` after `state "label" as id`. Mermaid's name after
   *  `as` runs to a `{` or the line's end, and it splits that name at `:`
   *  (stateDiagram.jison): the text up to a second colon describes the state,
   *  as `id : text` does. Ours reads the whole text so, and `id:::c` as the
   *  state's class, which Mermaid drops for an empty description; both are
   *  reported (aliasSuffixLines). Null leaves the cursor. */
  const readAliasSuffix = (text: string, label: string, id: string, from: number): StatementRead | null => {
    const line = logical[row]!.line
    const declaration = `state ${label}${id}`
    const colon = skipBlank(text, from)
    CLASS_SHORTHAND_AT.lastIndex = colon
    const shorthand = CLASS_SHORTHAND_AT.exec(text)
    if (shorthand !== null) {
      const next = skipBlank(text, colon + shorthand[0].length)
      if (next < text.length && text[next] !== ';' && text[next] !== '}') return null
      noteBraceAfter(row, next)
      aliasSuffixLines.add(line)
      column = colon + shorthand[0].length
      return { text: declaration, opens: false, also: `${id}:::${shorthand[1]}` }
    }
    // A `{` makes Mermaid read a composite named `id : text`.
    if (text.startsWith(':::', colon) || text.includes('{', colon)) return null
    const end = textEnd(text, colon, row)
    if (end < text.length) braceTextLines.add(line)
    const description = text.slice(colon + 1, end).trim()
    if (description.includes(':')) aliasSuffixLines.add(line)
    const alsoSpan = { start: at(row, colon), end: at(row, end) }
    column = end
    return { text: declaration, opens: false, ...(description ? { also: `${id} : ${description}`, alsoSpan } : {}) }
  }
  /** `state ["label" as] id [<<stereotype>>] [{]`; null leaves the cursor. */
  const readStateDeclaration = (from: number): StatementRead | null => {
    const text = logical[row]!.text
    let index = from
    let label = ''
    let textSpan: StatementRead['textSpan']
    if (text[index] === '"') {
      const close = text.indexOf('"', index + 1)
      const as = close < 0 ? null : matchAt(STATE_AS_AT, text, close + 1)
      if (as === null) return null
      label = `${text.slice(index, close + 1)} as `
      textSpan = { start: at(row, index), end: at(row, close + 1) }
      index = close + 1 + as.length
    }
    const id = matchAt(STATE_ID_AT, text, index)
    if (id === null) return null
    index += id.length
    // Mermaid's `as` follows only a quoted label: it rejects `state X as Y`.
    if (!label && matchAt(STATE_AS_WORD_AT, text, index) !== null) return null
    if (label && text[skipBlank(text, index)] === ':') {
      const suffix = readAliasSuffix(text, label, id, index)
      return suffix && { ...suffix, textSpan }
    }
    // Mermaid also spells a fork, join or choice `[[fork]]`, read as `<<fork>>`.
    STEREOTYPE_AT.lastIndex = index
    const marker = STEREOTYPE_AT.exec(text)
    if (marker !== null) index += marker[0].length
    const stereotype = marker === null ? null : marker[1] !== undefined ? `<<${marker[1]}>>` : marker[0]
    const brace = matchAt(OPEN_BRACE_AT, text, index)
    let opens = brace !== null
    const next = skipBlank(text, index)
    if (brace !== null) index += brace.length
    else if (index < text.length && !' \t;}'.includes(text[index]!)) return null
    else if (stereotype === null && next === text.length && statementRowAfter(row) && logical[row + 1]!.text.startsWith('{')) {
      // `state X` with its `{` on the next line, as Mermaid's STATE lexer reads it.
      row++
      index = 1
      opens = true
    } else if (label && stereotype === null && next < text.length) {
      // Mermaid's name after `as` runs to a `{` or the line's end, so another
      // statement cannot follow it: `state "L" as X Y` names one state `X Y`,
      // which ours cannot hold. Its `}` is read into the name too.
      if (text[next] !== ';' && text[next] !== '}') return null
      noteBraceAfter(row, next)
    }
    column = index
    return { text: `state ${label}${id}${stereotype === null ? '' : ` ${stereotype.trim()}`}${opens ? ' {' : ''}`, opens, ...(textSpan ? { textSpan } : {}) }
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
    if (matchAt(STATEMENT_KEYWORD_AT, text, column) !== null || matchAt(OWN_KEYWORD_AT, text, column) !== null) {
      // A keyword statement runs to the end of its line.
      const keyword = text.slice(column)
      emit(keyword, line, false)
      row++
      column = 0
      // A block note opened after another statement on its line, which the
      // comment scan sees only at a line's start: its text runs to its
      // `end note`, line by line, as Mermaid's NOTE_TEXT reads it.
      if (STATE_NOTE_OPEN_RE.test(keyword) && logical[row]?.noteBody === false) {
        const end = logical.findIndex((entry, index) => index >= row && STATE_NOTE_END_RE.test(entry.text))
        for (; end > 0 && row < end; row++) statements.push({ text: logical[row]!.text, line: logical[row]!.line, noteBody: true })
      }
      continue
    }
    const startRow = row
    const startColumn = column
    const keyword = matchAt(STATE_KEYWORD_AT, text, column)
    let declaration = keyword === null ? null : readStateDeclaration(column + keyword.length)
    // A `State` spelled otherwise than `state` that starts no declaration, or
    // one a transition or description follows (`State X --> Y`), is a name,
    // as ours read it before reading the keyword in every case.
    const named = keyword !== null && !keyword.startsWith('state')
    if (named && declaration !== null && !declaration.opens) {
      const next = skipBlank(logical[row]!.text, column)
      if (logical[row]!.text.startsWith('-->', next) || logical[row]!.text[next] === ':') {
        row = startRow
        column = startColumn
        declaration = null
      }
    }
    const read = declaration ?? (keyword === null || named ? readIdStatement() : null)
    if (read !== null) {
      emit(read.text, line, read.opens ?? false)
      const emitted = statements.at(-1)!
      if (read.textSpan) emitted.textSpan = read.textSpan
      if (read.toLine !== undefined) emitted.toLine = read.toLine
      if (read.nameBlanks) emitted.nameBlanks = read.nameBlanks
      if (read.opens) {
        emitted.opens = true
        depth++
      }
      // `state "L" as X : text` is read as `state "L" as X` and `X : text`.
      if (read.also !== undefined) statements.push({ text: read.also, line, ...(read.alsoSpan ? { textSpan: read.alsoSpan } : {}), ...(declaration !== null ? { afterAlias: true } : {}) })
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
  // Mermaid trims a block note's text: the blank lines it starts or ends
  // with are not text, as the blank lines inside it are.
  const kept = statements.filter((statement, index) => {
    if (!statement.noteBody || statement.text) return true
    const blankUpTo = (step: number): boolean => {
      let at = index
      while (statements[at]?.noteBody && !statements[at]!.text) at += step
      return !statements[at]?.noteBody
    }
    return !blankUpTo(-1) && !blankUpTo(1)
  })
  const open: number[] = []
  for (const statement of kept) {
    if (statement.opens) open.push(statement.line)
    else if (statement.text === '}' && !statement.noteBody) open.pop()
  }
  return {
    statements: kept, semicolonLines: [...semicolonLines], juxtaposedLines: [...juxtaposedLines],
    braceNameLines: [...braceNameLines], unopenedBraceLines: [...unopenedBraceLines], braceTextLines: [...braceTextLines], aliasSuffixLines: [...aliasSuffixLines], unclosedLines: open,
  }
}
