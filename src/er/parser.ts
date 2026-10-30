import { assertErDiagramWork } from '../shared/diagram-limits.ts'
import { parserObservationActive, observeParserStatement, observeParserMutation } from '../shared/parser-observation.ts'
import type { ErDiagram, ErEntity, ErAttribute, ErRelationship, Cardinality } from './types.ts'
import type { Direction } from '../types.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { requireClosedAccessibility, scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { parseDirectionStatement } from '../shared/direction-statement.ts'
import { parseStyleProps } from '../shared/style-props.ts'
import { mermaidEntityPrepass } from '../shared/mermaid-entities.ts'
import { stripTrailingComment, trailingCommentStart } from '../shared/trailing-comment.ts'
import { createErCreationFold, type ErPlacement } from './creation.ts'
import { decodeErText, erTextLabel, erTextContent, type ErQuotedTextReport, readErQuotedName, readErRelationLabel } from './text.ts'

// Mermaid ER accepts ordinary names, numeric/decimal names, and fully quoted
// names (e.g. `1`, `2.5`, `"Entity<br>Name"`). Keep this grammar in one
// place so declarations, blocks, relationships, and the agent body agree.
// A bare name ends where the lexer's word ends: `id1||--||id2` is two names.
// Mermaid's ER lexer takes every non-ASCII code unit as a name character
// (`éx`, `x٣`, `一¼`, `a😀`), so astral characters count through their
// surrogate halves.
const ER_BARE_ENTITY_ID_SOURCE = String.raw`[A-Za-z0-9_\u0080-\uFFFF][\w.\-\u0080-\uFFFF]*(?![\w.\-\u0080-\uFFFF])`
// A quoted name as the lexer hands it over. A `\"` stays inside the token, and
// readErQuotedName reads it as `"` (Mermaid ER quoted text has no escapes).
const ER_QUOTED_NAME_SOURCE = String.raw`"(?:\\.|[^"\\])*"`
const ER_QUOTED_NAME_RE = new RegExp(`^${ER_QUOTED_NAME_SOURCE}$`)
const ER_ENTITY_ID_SOURCE = `(?:${ER_QUOTED_NAME_SOURCE}|${ER_BARE_ENTITY_ID_SOURCE})`
const ER_ENTITY_ID_RE = new RegExp(`^${ER_BARE_ENTITY_ID_SOURCE}$`)
const ER_ENTITY_REFERENCE_SOURCE = String.raw`${ER_ENTITY_ID_SOURCE}(?:\[\s*(?:${ER_QUOTED_NAME_SOURCE}|[^\]"\r\n]+)\s*\])?(?::::[\w-]+(?:,[\w-]+)*)?`
// The same reference with its id, quoted alias, bare alias and classes captured.
const ER_ENTITY_REFERENCE_RE = new RegExp(String.raw`^(${ER_ENTITY_ID_SOURCE})(?:\[\s*(?:(${ER_QUOTED_NAME_SOURCE})|([^\]"\r\n]+))\s*\])?(?::::([\w-]+(?:,[\w-]+)*))?$`)
// Mermaid 11.16.0 accepts word/numeric aliases for the same four crow's-foot
// cardinalities. This is the single lexer vocabulary for renderer and agent.
// Keep the glyph-candidate fallback so malformed crow's-foot tokens still reach
// parseErCardinality and raise the existing fail-loud error.
const ER_CARDINALITY_SOURCE = String.raw`(?:one or zero|zero or one|one or more|one or many|zero or more|zero or many|only one|many\(0\)|many\(1\)|1\+|0\+|many|one|1|u(?=[.\-|])|[|o}{]+)`
// A crow's-foot token needs no space to part it from a name (`id1||--||id2`);
// a word or numeric alias does.
const ER_GLYPH_SOURCE = String.raw`(?:\|\||\|o|o\||\}o|o\{|\}\||\|\{|\bu(?=[.\-|]))`
const ER_RELATIONSHIP_RE = new RegExp(
  `^(${ER_ENTITY_REFERENCE_SOURCE})(?:[ \\t]+(${ER_CARDINALITY_SOURCE})|(${ER_GLYPH_SOURCE}))` +
  `(?:([ \\t]*(?:--|\\.\\.|\\.-|-\\.)[ \\t]*)|([ \\t]+(?:optionally to|to)[ \\t]+))` +
  `(?:(${ER_CARDINALITY_SOURCE})[ \\t]+|(${ER_GLYPH_SOURCE}))(${ER_ENTITY_REFERENCE_SOURCE})(?:[ \\t]*:[ \\t]*([^\\r\\n]*))?$`,
  'i',
)

export interface ParsedErEntityReference {
  /** The entity's identity: a bare name, or a quoted name as written. */
  id: string
  /** The alias as written (`ID["Alias"]`, `ID[Alias]`), quotes removed. */
  alias?: string
  /** Mermaid `:::class1,class2` styling in source order, space-separated. */
  className?: string
  /** Set when the id was written quoted. */
  quoted?: true
}

/** Shared renderer/agent grammar for bare and aliased ER entity references.
 * `report` hears quoted text Mermaid rejects (src/er/text.ts). */
export function parseErEntityReference(value: string, report?: ErQuotedTextReport): ParsedErEntityReference | null {
  const match = value.trim().match(ER_ENTITY_REFERENCE_RE)
  if (!match) return null
  const id = match[1]!.startsWith('"') ? readErQuotedName(match[1]!, 'ER entity name', report) : match[1]!
  const alias = match[2] !== undefined ? readErQuotedName(match[2], 'ER entity alias', report) : match[3]?.trim()
  return {
    id,
    ...(alias !== undefined ? { alias } : {}),
    ...(match[4] ? { className: match[4].replaceAll(',', ' ') } : {}),
    ...(match[1]!.startsWith('"') ? { quoted: true as const } : {}),
  }
}

/** The text the renderer draws for an entity: its alias, else its name. A
 * quoted name is text (`"Entity<br>Name"`); a bare name is drawn as written. */
function erEntityDisplayText(id: string, alias: string | undefined): Pick<ErEntity, 'label' | 'labelContent'> {
  if (alias !== undefined) return erTextLabel(alias, true)
  return ER_ENTITY_ID_RE.test(id) ? { label: id } : erTextLabel(id, true)
}

/** Shared renderer/agent grammar for a plain ER entity identifier. */
export function parseErEntityId(value: string): string | null {
  const id = value.trim()
  return ER_ENTITY_ID_RE.test(id) ? id : null
}

/** Mermaid's `class id,id name,name` lists share one bounded lexer on both paths. */
export function parseErClassAssignment(line: string, report?: ErQuotedTextReport): { ids: string[]; classNames: string[] } | null {
  const prefix = /^class[ \t]+/i.exec(line)
  if (!prefix) return null
  const content = line.slice(prefix[0].length).trimEnd()
  let cursor = content.length
  const reversedNames: string[] = []
  const isNameChar = (char: string): boolean => /[A-Za-z0-9_-]/.test(char)
  while (cursor > 0) {
    const end = cursor
    while (cursor > 0 && isNameChar(content[cursor - 1]!)) cursor--
    if (cursor === end) return null
    reversedNames.push(content.slice(cursor, end))

    const afterName = cursor
    while (cursor > 0 && (content[cursor - 1] === ' ' || content[cursor - 1] === '\t')) cursor--
    if (content[cursor - 1] === ',') {
      cursor--
      while (cursor > 0 && (content[cursor - 1] === ' ' || content[cursor - 1] === '\t')) cursor--
      continue
    }
    if (cursor === afterName || cursor === 0) return null
    const refs = content.slice(0, cursor).split(',').map(value => parseErEntityReference(value.trim(), report))
    if (refs.length === 0 || refs.some(value => value === null)) return null
    return { ids: refs.map(value => value!.id), classNames: reversedNames.reverse() }
  }
  return null
}

export function recordErClassNames(byEntity: Map<string, string[]>, id: string, names: readonly string[]): void {
  const existing = byEntity.get(id)
  if (existing) for (const name of names) existing.push(name)
  else byEntity.set(id, [...names])
}

// ============================================================================
// ER diagram parser
//
// Parses Mermaid erDiagram syntax into an ErDiagram structure.
//
// Supported syntax:
//   CUSTOMER ||--o{ ORDER : places
//   CUSTOMER {
//     string name PK
//     int age
//     string email UK "user email"
//   }
//   ORDER { int id PK date placed }
//
// Mermaid's attribute block skips newlines, so `{`, attributes and `}` may
// share a line, and a statement may follow `}` (readErLine).
//
// Cardinality notation (same token set both sides, matching Mermaid's lexer):
//   ||  exactly one
//   o|  zero or one (also |o)
//   }|  one or more (also |{)
//   o{  zero or more (also }o)
//   {o, o}, |}, {| are not Mermaid tokens and are rejected with an error.
//
// Line style:
//   --  identifying (solid line)
//   ..  non-identifying (dashed line)
// ============================================================================

const ER_GROUP_HEADER_RE = new RegExp(String.raw`^subgraph\s+(${ER_QUOTED_NAME_SOURCE}|\S+?)(?:\s*\[([^\]]+)\])?$`, 'i')

/** A subgraph header: its id as written, and its bracketed title as written. */
export function parseErGroupHeader(line: string, report?: ErQuotedTextReport): { id: string; title?: string } | null {
  const explicit = line.match(ER_GROUP_HEADER_RE)
  if (!explicit) return null
  const id = explicit[1]!.startsWith('"') ? readErQuotedName(explicit[1]!, 'ER subgraph id', report) : explicit[1]!
  const title = explicit[2]?.trim()
  if (!title) return { id }
  return { id, title: ER_QUOTED_NAME_RE.test(title) ? readErQuotedName(title, 'ER subgraph title', report) : title }
}

// What Mermaid's ER style lexer cannot read: it takes only letters of any
// script, digits, `_`, `-`, `*`, `#`, `:`, `,`, `;` and blanks.
const ER_STYLE_UNREAD_RE = /[^\x80-\uFFFF\w\s*#:,;-]/

// A decimal entity code in ER style text (`#46;` for `.`). Mermaid's
// entity prepass keeps it as a code when a later `;` ends the line, and the
// SVG it writes resolves it, so it spells what the ER style lexer cannot read.
// Two, five and seven digits are never CSS hex colours. Padding preserves that
// distinction through the complete Unicode codepoint range.
const ER_STYLE_ENTITY_RE = /#(\d{2}|\d{5}|\d{7});/g

function erStyleEntity(char: string): string | undefined {
  const code = char.codePointAt(0)!
  // XML cannot retain these C0 characters/noncharacters or lone surrogates;
  // HTML numeric references also reinterpret C1 controls. TAB/CR/LF survive.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ud800-\udfff\ufffe\uffff]/u.test(char)) return undefined
  return `#${String(code).padStart(code <= 99 ? 2 : code <= 99999 ? 5 : 7, '0')};`
}

/** ER `style`/`classDef` properties, their entity codes read as characters. */
function readErStyleText(authored: string): Record<string, string> {
  // Classify delimiters before decoding: an escaped comma, semicolon or colon
  // belongs to its field, never to the property-list grammar. The absent
  // prefix makes these opaque tokens collision-free, even for authored text
  // resembling the token spelling; replacements expand exactly once.
  let tokenPrefix = 'ER_STYLE_ENTITY_'
  while (authored.includes(tokenPrefix)) tokenPrefix += '_'
  const values: string[] = []
  const protectedText = authored.replace(ER_STYLE_ENTITY_RE, (_, code: string) => {
    const point = Number(code)
    values.push(point <= 0x10ffff ? String.fromCodePoint(point) : '\ufffd')
    return `${tokenPrefix}${values.length - 1}_`
  })
  const token = new RegExp(`${tokenPrefix}(\\d+)_`, 'g')
  const read = (value: string) => value.replace(token, (_, index: string) => values[Number(index)]!)
  return Object.fromEntries(Object.entries(parseStyleProps(protectedText)).map(([key, value]) => [read(key), read(value)]))
}

/** ER style properties as Mermaid's ER style lexer reads them: a character it
 * cannot read, whitespace it would skip, and field punctuation as entity
 * codes. Undefined only for characters with no lossless SVG spelling. */
export function writeErStyleText(style: Readonly<Record<string, string>>): string | undefined {
  const pairs: string[] = []
  const part = (value: string): string | undefined => {
    let written = ''
    for (const char of value) {
      const entity = erStyleEntity(char)
      if (!entity) return undefined
      if (!ER_STYLE_UNREAD_RE.test(char) && !',:;ﬂ¶'.includes(char) && !/\s/.test(char)) {
        written += char; continue
      }
      written += entity
    }
    return written
  }
  for (const [key, value] of Object.entries(style)) {
    const writtenKey = part(key), writtenValue = part(value)
    if (writtenKey === undefined || writtenValue === undefined) return undefined
    pairs.push(`${writtenKey}:${writtenValue}`)
  }
  return pairs.join(',')
}

/** The global prepass can remove a semicolon twice, starting in the target
 * or class name and reaching an entity in a later field. Derive the padding
 * from the complete production; it must leave every field byte untouched. */
export function writeErStyleStatement(prefix: string, style: Readonly<Record<string, string>>): string | undefined {
  const text = writeErStyleText(style)
  if (text === undefined) return undefined
  const line = `${prefix} ${text}`, probe = `${line};;`
  const padding = probe.length - mermaidEntityPrepass(probe).length
  const written = line + ';'.repeat(padding)
  if (mermaidEntityPrepass(written) !== line) throw new Error('ER style statement did not preserve its fields through the entity prepass')
  return written
}

/** A `direction` statement. Upstream's lexer reads it to the end of its
 * line, so a `%%` after it is not a comment but part of the statement. */
export function readErDirection(line: string): Direction | undefined {
  return parseDirectionStatement(stripTrailingComment(line))
}

/**
 * Whether one ER body line carries a trailing `%%` comment. Mermaid ER has
 * none: after any statement but a `direction`, `%%` is a syntax error
 * upstream. Both parsers read it as a comment (stripTrailingComment) and
 * verify reports it. (A whole-line `%%` comment is removed before the grammar
 * runs, and `%%` inside a quoted relation label is text.)
 */
export function hasErTrailingComment(line: string): boolean {
  return trailingCommentStart(line) >= 0 && readErDirection(line) === undefined
}

/** One ER body statement outside an attribute block, as both the renderer
 * and the typed body read it. */
export type ErStatementLine =
  | { kind: 'direction'; direction: Direction }
  | { kind: 'group-open'; id: string; title?: string }
  | { kind: 'end' }
  | { kind: 'class-def'; names: string[]; props: Record<string, string> }
  | { kind: 'class'; ids: string[]; classNames: string[] }
  | { kind: 'style'; ids: string[]; props: Record<string, string> }
  | { kind: 'block-open'; reference: ParsedErEntityReference }
  | { kind: 'relation'; relation: ParsedErRelationshipSyntax }
  | { kind: 'entity'; reference: ParsedErEntityReference }

/**
 * Read one statement outside an attribute block, given without its trailing
 * `%%` comment (readErLine strips it once per line): the statement it is, or
 * null when it is none. Throws a syntax error for one ours cannot read. `end`
 * closes a subgraph only while one is open; otherwise it names an entity.
 * `report` hears quoted text Mermaid rejects (src/er/text.ts).
 */
export function readErStatement(line: string, inGroup: boolean, report?: ErQuotedTextReport): ErStatementLine | null {
  const direction = parseDirectionStatement(line)
  if (direction) return { kind: 'direction', direction }

  // --- ER subgraphs: identity, nesting and scoped direction. ---
  const groupHeader = parseErGroupHeader(line, report)
  if (groupHeader) return { kind: 'group-open', ...groupHeader }
  if (line === 'end' && inGroup) return { kind: 'end' }

  // --- Entity paint directives (upstream ER grammar) ---
  const classDef = line.match(/^classDef\s+([\w,-]+)\s+(.+)$/is)
  if (classDef) {
    return { kind: 'class-def', names: classDef[1]!.split(',').map(value => value.trim()).filter(Boolean), props: readErStyleText(classDef[2]!) }
  }
  const classAssignment = parseErClassAssignment(line, report)
  if (classAssignment) return { kind: 'class', ...classAssignment }
  if (/^class(?:[ \t]|$)/i.test(line)) throw new Error(`Invalid ER class assignment: ${line}`)
  const inlineStyle = line.match(/^style\s+(.+?)\s+(.+)$/is)
  if (inlineStyle) {
    const references = inlineStyle[1]!.split(',').map(value => parseErEntityReference(value.trim(), report))
    if (references.some(reference => reference === null)) throw new Error(`Invalid ER style assignment: ${line}`)
    const ids = references.map(reference => reference!.id)
    return { kind: 'style', ids, props: readErStyleText(inlineStyle[2]!) }
  }

  // --- Relationship: `ENTITY1 cardinality1--cardinality2 ENTITY2 : label` ---
  // Before a block start, so `A {o--|| B` keeps its cardinality error.
  const relation = parseErRelationshipSyntax(line, report)
  if (relation) return { kind: 'relation', relation }

  // --- Entity block start: `ENTITY_NAME {`, perhaps with its attributes ---
  const block = line.match(ER_BLOCK_OPEN_RE)
  const blockReference = block ? parseErEntityReference(block[1]!, report) : null
  if (blockReference) return { kind: 'block-open', reference: blockReference }

  // A bare or aliased declaration, as the typed serializer writes one.
  const reference = parseErEntityReference(line, report)
  return reference ? { kind: 'entity', reference } : null
}

const ER_BLOCK_OPEN_RE = new RegExp(`^(${ER_ENTITY_REFERENCE_SOURCE})\\s*\\{`)
// The declaration a run of declarations starts with (`A` in `A B`).
const ER_ENTITY_REFERENCE_PREFIX_RE = new RegExp(`^${ER_ENTITY_REFERENCE_SOURCE}`)
// What Mermaid's lexer reads as a cardinality or a link, not a name, where a
// declaration could start: a crow's-foot glyph, a word or numeric alias (`1`
// only before what it qualifies), a line, or `u`, its parent marker, which
// ours does not model (`PROJECT u--o{ TEAM : r`).
const ER_LINK_TOKEN_RE = new RegExp(String.raw`^(?:\|\||\|o|o\||\}o|o\{|\}\||\|\{|--|\.\.|\.-|-\.|u(?=[.|-])|1\+|0\+|1(?=\s+[\w"']|--|\.\.|\.-|-\.)|(?:one or zero|zero or one|one or more|one or many|zero or more|zero or many|only one|many\(0\)|many\(1\)|many|one|optionally to|to)(?!\w))`, 'i')
// What Mermaid's lexer reads as a keyword, never a name: a statement keyword,
// or `direction TB` (BT, LR, RL), which makes the whole line a direction.
const ER_RUN_KEYWORD_RE = /^(?:(?:subgraph|end|style|classDef|class|erDiagram)(?!\w)|direction\s+(?:TB|BT|LR|RL))/i

/** Whether Mermaid's lexer reads this bare name as a keyword, a cardinality
 * or a link (`end`, `one`, `u-turn`), so it cannot be the name it spells. */
export function isErKeywordName(id: string): boolean {
  return ER_RUN_KEYWORD_RE.test(id) || ER_LINK_TOKEN_RE.test(id)
}

/** Whether a name must be written quoted for Mermaid to read it back as one
 * name: a keyword name, or one that starts with a number, which Mermaid's
 * lexer takes first (`2px` reads as `2` and `px`). */
export function erNameNeedsQuotes(id: string): boolean {
  // `1` becomes ONLY_ONE when whitespace (including a newline) separates it
  // from another name. Quote it independently of the next emitted statement.
  return id === '1' || isErKeywordName(id) || (/^\d/.test(id) && !/^\d+(?:\.\d+)?$/.test(id))
}

/** Offset of the `}` that ends an attribute block in `text`, or -1: the
 * first one outside an attribute word or comment's quoting. */
function erBlockEndAt(text: string): number {
  let comment = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (comment) {
      if (char === '"') comment = false
    } else if (char === '"') comment = true
    else if (char === '`' && (index === 0 || /\s/.test(text[index - 1]!))) {
      // Only a complete word owns this quote. A literal tick in a generous
      // field cannot borrow a later word or comment's closing tick.
      const end = text.indexOf('`', index + 1)
      if (end > index + 1 && !/\s/.test(text.slice(index + 1, end))) index = end
    } else if (char === '}') return index
  }
  return -1
}

/** A token of an attribute block, as Mermaid's block lexer reads it: a word,
 * a quoted comment, or a stray quote. */
interface ErBlockToken {
  kind: 'word' | 'comment' | 'stray'
  text: string
  /** Zero-based line, and where on it the token starts and ends. */
  line: number
  start: number
  end: number
  /** The line it ends on, for a comment that runs across lines. */
  endLine?: number
}

// A `~` before a name character opens a generic type's argument
// (`Map~string`); any other `~` closes one (`int~`, `~~`, `~,`).
const ER_GENERIC_OPENER_RE = /[\w*\u00C0-\uFFFF]/

/**
 * The block tokens in `raw` from `from` to `to`. A word runs to the next space
 * or quote, unless its first `~` opens a generic type that closes further on:
 * Mermaid's lexer reads `Map~string, int~` as one word. Each `~` is paired
 * with the one that closes it, as brackets are, so nested arguments
 * (`Map~string, List~int~~`) close where they should.
 */
function lexErBlockText(raw: string, line: number, from: number, to: number): ErBlockToken[] {
  const text = raw.slice(from, to)
  const closer = new Map<number, number>()
  const opened: number[] = []
  for (let at = 0, quoted = false; at < text.length; at++) {
    if (text[at] === '"') quoted = !quoted
    else if (text[at] !== '~' || quoted) continue
    else if (ER_GENERIC_OPENER_RE.test(text[at + 1] ?? '')) opened.push(at)
    else if (opened.length > 0) closer.set(opened.pop()!, at)
  }
  const wordEnd = (start: number): number => {
    let end = start
    while (end < text.length && !/[\s"]/.test(text[end]!)) end++
    return end
  }
  const tokens: ErBlockToken[] = []
  const push = (kind: ErBlockToken['kind'], start: number, end: number): void => {
    tokens.push({ kind, text: text.slice(start, end), line, start: from + start, end: from + end })
  }
  for (let at = 0; at < text.length;) {
    if (/\s/.test(text[at]!)) at++
    else if (text[at] === '"') {
      const close = text.indexOf('"', at + 1)
      push(close < 0 ? 'stray' : 'comment', at, close < 0 ? at + 1 : close + 1)
      at = close < 0 ? at + 1 : close + 1
    } else {
      let end = wordEnd(at)
      const first = text.slice(at, end).indexOf('~')
      const close = first < 0 ? undefined : closer.get(at + first)
      if (close !== undefined && close >= end) end = wordEnd(close + 1)
      push('word', at, end)
      at = end
    }
  }
  return tokens
}

/** An attribute Mermaid's attribute grammar is reading: its tokens so far,
 * and the last part they spell. After its type it needs a name; after its
 * name it may take keys and a comment; after its comment it is complete. */
interface ErOpenAttribute {
  tokens: ErBlockToken[]
  last: 'type' | 'name' | 'comment'
}

// Mermaid's attribute word (ATTRIBUTE_WORD in erDiagram.jison), or a generic
// type (`List~int~`). Its lexer reads `PK`, `FK` and `UK` as keys first.
const ER_ATTRIBUTE_WORD_RE = /^[*A-Za-z_\u00C0-\uFFFF][\w\-[\]().,\u00C0-\uFFFF*]*$/
const ER_QUOTED_ATTRIBUTE_WORD_RE = /^`[^`]+`$/
const isErAttributeWord = (token: ErBlockToken, text = token.text): boolean => token.kind === 'word'
  && ((text.match(/~/g)?.length ?? 0) >= 2 || ER_ATTRIBUTE_WORD_RE.test(text) || ER_QUOTED_ATTRIBUTE_WORD_RE.test(text)) && !/^(?:PK|FK|UK)\b/i.test(text)
const isErKeyList = (token: ErBlockToken): boolean =>
  token.kind === 'word' && token.text.split(',').every(part => !part || /^(?:PK|FK|UK)$/i.test(part))

/**
 * Read block tokens on from an open attribute, as Mermaid's attribute grammar
 * does: a type (perhaps marked optional with `?`), a name, then keys and one
 * quoted comment. Line breaks between them do not matter. The attributes the
 * tokens complete and the one still open, or null when the grammar cannot
 * read them.
 */
function readErAttributeTokens(open: ErOpenAttribute | undefined, tokens: readonly ErBlockToken[]): { done: ErOpenAttribute[]; open?: ErOpenAttribute } | null {
  const done: ErOpenAttribute[] = []
  let current = open && { tokens: [...open.tokens], last: open.last }
  for (const token of tokens) {
    if (current?.last === 'type') {
      if (token.text === '?' && current.tokens.length === 1 && !current.tokens[0]!.text.endsWith('?')) current.tokens.push(token)
      else if (isErAttributeWord(token)) current = { tokens: [...current.tokens, token], last: 'name' }
      else return null
    } else if (current?.last === 'name' && isErKeyList(token)) current.tokens.push(token)
    else if (current?.last === 'name' && token.kind === 'comment') current = { tokens: [...current.tokens, token], last: 'comment' }
    else if (isErAttributeWord(token, token.text.replace(/\?$/, ''))) {
      if (current) done.push(current)
      current = { tokens: [token], last: 'type' }
    } else return null
  }
  return { done, ...(current ? { open: current } : {}) }
}

function erAttribute(type: string, name: string, keys: ErAttribute['keys'], quoted: string | undefined): ErAttribute {
  // Backticks delimit attribute words; they are not part of the type/name.
  // Keep tokens and the typed body's attribute text authored for export.
  const word = (value: string): string => value.replace(/^`([^`]+)`(\?)?$/, (_match, text: string, optional: string | undefined) => text + (optional ?? ''))
  // A quoted comment may hold <br> tags and entity codes.
  const comment = quoted === undefined ? undefined : decodeErText(normalizeBrTags(quoted))
  const commentContent = quoted === undefined ? undefined : erTextContent(quoted, comment!, true)
  return { type: word(type), name: word(name), keys, comment, ...(commentContent ? { commentContent } : {}) }
}

/** Whether an attribute's keys form Mermaid's key list, parted by commas
 * (`PK, FK`); ours also reads keys parted by spaces only (`PK FK`). */
function erKeysCommaParted({ tokens }: ErOpenAttribute): boolean {
  const optional = tokens[1]?.text === '?' ? 1 : 0
  const keys = tokens.slice(2 + optional).filter(token => token.kind === 'word').map(token => token.text).join(' ')
  return keys === '' || /^(?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*$/i.test(keys)
}

/** The attribute a complete ErOpenAttribute spells. */
function erAttributeOf({ tokens }: ErOpenAttribute): ErAttribute {
  const optional = tokens[1]?.text === '?' ? 1 : 0
  const keys = tokens.slice(2 + optional).filter(token => token.kind === 'word')
    .flatMap(token => token.text.split(',')).filter(Boolean).map(key => key.toUpperCase() as 'PK' | 'FK' | 'UK')
  const comment = tokens.find(token => token.kind === 'comment')
  return erAttribute(tokens[0]!.text + (optional ? '?' : ''), tokens[1 + optional]!.text, keys, comment?.text.slice(1, -1))
}

/** An attribute as one line of text: its tokens spaced as written, with one
 * space where a line break parted two of them. */
function erAttributeText(lines: readonly string[], { tokens }: ErOpenAttribute): string {
  return tokens.map((token, index) => {
    const before = tokens[index - 1]
    if (!before) return token.text
    return ((before.endLine ?? before.line) === token.line ? lines[token.line]!.slice(before.end, token.start) : ' ') + token.text
  }).join('')
}

/**
 * The statements outside an attribute block in `text`, the rest of one line,
 * each with where it starts and ends: one statement, or declarations Mermaid
 * reads one after another (`A B`, `A["x"] B ||--o{ C : r`) when the whole
 * rest reads that way. A block start ends them; its attributes follow it.
 * A run never takes for a name what Mermaid reads as a cardinality, a link or
 * a keyword (ER_LINK_TOKEN_RE, ER_RUN_KEYWORD_RE). Otherwise the rest is one
 * statement ours cannot read.
 */
function readErOuterStatements(text: string, inGroup: boolean, report?: ErQuotedTextReport): Array<{ syntax: ErStatementLine | { kind: 'unknown' }; start: number; end: number }> {
  const ending = (syntax: ErStatementLine, at: number) => ({
    syntax, start: at,
    // The block's attributes start after the `{` readErStatement matched.
    end: syntax.kind === 'block-open' ? at + ER_BLOCK_OPEN_RE.exec(text.slice(at))![0].length : text.length,
  })
  const relation = readErRelationBeforeRun(text, inGroup, report)
  if (relation) return relation
  const whole = readErStatement(text, inGroup, report)
  if (whole) return [ending(whole, 0)]
  // Quoted text is reported only once the whole run reads.
  const run: Array<{ syntax: ErStatementLine; start: number; end: number }> = []
  const heard: Array<[string, string]> = []
  const unread = [{ syntax: { kind: 'unknown' as const }, start: 0, end: text.length }]
  for (let at = 0; at < text.length;) {
    const rest = text.slice(at)
    // A link here makes the line a relationship ours cannot read; check it
    // before `u--o{` could read as a block start.
    if (ER_LINK_TOKEN_RE.test(rest)) return unread
    if (at > 0) {
      const attempt: Array<[string, string]> = []
      const relation = readErRelationBeforeRun(rest, inGroup, (what, portable) => attempt.push([what, portable]))
      if (relation) {
        run.push(...relation.map(statement => ({ ...statement, start: statement.start + at, end: statement.end + at })))
        heard.push(...attempt)
        break
      }
      const next = readErStatement(rest, inGroup, (what, portable) => attempt.push([what, portable]))
      if (next) {
        run.push(ending(next, at))
        heard.push(...attempt)
        break
      }
    }
    if (ER_RUN_KEYWORD_RE.test(rest)) return unread
    const lead = ER_ENTITY_REFERENCE_PREFIX_RE.exec(rest)
    const reference = lead && parseErEntityReference(lead[0], (what, portable) => heard.push([what, portable]))
    if (!reference) return unread
    run.push({ syntax: { kind: 'entity', reference }, start: at, end: at + lead[0].length })
    at += lead[0].length
    at += text.slice(at).length - text.slice(at).trimStart().length
  }
  if (report) for (const [what, portable] of heard) report(what, portable)
  return run
}

// A relationship whose label is a quoted string, up to its closing quote.
const ER_QUOTED_LABEL_RELATION_RE = /^(?:[^":]|"[^"]*")*?:\s*"[^"]*"/

/**
 * A relationship whose quoted label is followed by more text on its line:
 * Mermaid's label ends at its closing quote, and the names after it are the
 * declarations that follow (`A ||--o{ B : "x" y` declares y), as in a run of
 * declarations. Null where that does not read the whole line.
 */
function readErRelationBeforeRun(text: string, inGroup: boolean, report?: ErQuotedTextReport): Array<{ syntax: ErStatementLine; start: number; end: number }> | null {
  const labelEnd = ER_QUOTED_LABEL_RELATION_RE.exec(text)?.[0].length ?? -1
  if (labelEnd < 0 || !text.slice(labelEnd).trim()) return null
  const heard: Array<[string, string]> = []
  const hear = (what: string, portable: string): void => { heard.push([what, portable]) }
  let relation: ReturnType<typeof readErStatement>
  let rest: ReturnType<typeof readErOuterStatements>
  const after = text.length - text.slice(labelEnd).trimStart().length
  try {
    relation = readErStatement(text.slice(0, labelEnd), inGroup, hear)
    if (relation?.kind !== 'relation') return null
    rest = readErOuterStatements(text.slice(after), inGroup, hear)
  } catch {
    return null
  }
  if (rest.some(statement => statement.syntax.kind === 'unknown')) return null
  if (report) for (const [what, portable] of heard) report(what, portable)
  return [
    { syntax: relation, start: 0, end: labelEnd },
    ...rest.map(statement => ({ ...statement, syntax: statement.syntax as ErStatementLine, start: statement.start + after, end: statement.end + after })),
  ]
}

export interface ErSourceStatement {
  /** The statement's source, from `column` on `line` to `endColumn` on
   * `endLine`. Statements partition each line they share: each runs from
   * where the one before it ended, the first from the line's start and the
   * last to its end. */
  raw: string
  /** Zero-based line in the supplied grammar view, where the statement starts. */
  line: number
  column: number
  /** Where it ends: an attribute may run across lines. */
  endLine: number
  endColumn: number
  groupId?: string
  entityId?: string
  relationEntityIds?: string[]
  syntax: ErStatementLine
    | { kind: 'attribute'; attribute: ErAttribute; text: string; generous?: true }
    | { kind: 'block-close' }
    | { kind: 'unknown' | 'comment' | 'blank' }
}

/** A statement as found, before its context is known: where its text starts
 * (`line`, `start`) and ends (`endLine`, `end`). */
interface ErFoundStatement {
  syntax: ErSourceStatement['syntax']
  line: number
  start: number
  endLine: number
  end: number
}

/**
 * The statements of an ER body in source order. Mermaid's ER lexer treats a
 * line break as one more separator between statements, and as plain space
 * inside an attribute block, so one line may hold several statements
 * (`A B`, `Z { string id } Y`) and an attribute may run across lines. A block
 * line Mermaid's attribute grammar cannot read is read on its own as one
 * generous attribute (readGenerousErAttribute), or else is unknown.
 */
function findErStatements(lines: readonly string[], report?: (what: string, portable: string, line: number) => void, continued?: Map<number, number>): ErFoundStatement[] {
  const found: ErFoundStatement[] = []
  let groupDepth = 0
  // The open attribute block, the attribute it is reading, and a comment a
  // quote left open at a line's end: where it starts, and its lines so far.
  let block: { open?: ErOpenAttribute; comment?: { line: number; start: number; parts: string[] } } | undefined
  // Mermaid's COMMENT token, `"[^"]*"`, runs on to the next quote; a quote
  // no later line closes is read on its own line, as before.
  const lastQuoteLine = lines.findLastIndex(line => line.includes('"'))
  const settle = (attribute: ErOpenAttribute): void => {
    const first = attribute.tokens[0]!
    const last = attribute.tokens.at(-1)!
    found.push({
      syntax: attribute.last === 'type' ? { kind: 'unknown' } : {
        kind: 'attribute', attribute: erAttributeOf(attribute), text: erAttributeText(lines, attribute),
        ...(erKeysCommaParted(attribute) ? {} : { generous: true as const }),
      },
      line: first.line, start: first.start, endLine: last.endLine ?? last.line, end: last.end,
    })
  }
  for (let line = 0; line < lines.length; line++) {
    const raw = lines[line]!
    const text = raw.trim()
    // The comment left open closes at this line's first quote. A blank line
    // inside it is dropped, as in other text, and a `%%` line too, as
    // Mermaid removes one before lexing.
    const pending: ErBlockToken[] = []
    let from = 0
    const comment = block?.comment
    if (comment && text && !text.startsWith('%%')) {
      const close = raw.indexOf('"')
      comment.parts.push((close < 0 ? raw : raw.slice(0, close)).trim())
      continued?.set(line, close < 0 ? raw.length : close + 1)
      if (close < 0) continue
      pending.push({ kind: 'comment', text: `"${comment.parts.join('\n')}"`, line: comment.line, start: comment.start, endLine: line, end: close + 1 })
      block!.comment = undefined
      from = close + 1
    } else if (!text || text.startsWith('%%')) {
      found.push({ syntax: { kind: text ? 'comment' : 'blank' }, line, start: 0, endLine: line, end: raw.length })
      continue
    }
    const rest = raw.slice(from)
    const stop = from + rest.length - rest.trimStart().length + stripTrailingComment(rest.trim()).length
    const skipSpace = (from: number): number => {
      while (from < stop && /\s/.test(raw[from]!)) from++
      return from
    }
    for (let at = skipSpace(from); at < stop || pending.length > 0;) {
      if (block) {
        const close = erBlockEndAt(raw.slice(at, stop))
        const runEnd = close < 0 ? stop : at + close
        let tokens = [...pending.splice(0), ...lexErBlockText(raw, line, at, runEnd)]
        const stray = line < lastQuoteLine ? tokens.findIndex(token => token.kind === 'stray') : -1
        if (stray >= 0) {
          block.comment = { line, start: tokens[stray]!.start, parts: [raw.slice(tokens[stray]!.start + 1, stop).trimEnd()] }
          tokens = tokens.slice(0, stray)
        }
        const read = readErAttributeTokens(block.open, tokens)
        if (read) {
          for (const attribute of read.done) settle(attribute)
          block.open = read.open
        } else {
          if (block.open) settle(block.open)
          block.open = undefined
          block.comment = undefined
          const run = raw.slice(at, runEnd).trimEnd()
          const attribute = readGenerousErAttribute(run)
          found.push({ syntax: attribute ? { kind: 'attribute', attribute, text: run, generous: true } : { kind: 'unknown' }, line, start: at, endLine: line, end: at + run.length })
        }
        if (close < 0) break
        if (block.open) settle(block.open)
        found.push({ syntax: { kind: 'block-close' }, line, start: runEnd, endLine: line, end: runEnd + 1 })
        block = undefined
        at = skipSpace(runEnd + 1)
      } else {
        const statements = readErOuterStatements(raw.slice(at, stop), groupDepth > 0,
          report ? (what, portable) => report(what, portable, line) : undefined)
        for (const { syntax, start, end } of statements) {
          found.push({ syntax, line, start: at + start, endLine: line, end: at + end })
          if (syntax.kind === 'group-open') groupDepth++
          else if (syntax.kind === 'end') groupDepth--
          else if (syntax.kind === 'block-open') block = {}
        }
        at = skipSpace(at + statements.at(-1)!.end)
      }
    }
  }
  // An attribute is found when it completes; it belongs where it starts,
  // before any comment line inside it.
  return found.sort((a, b) => a.line - b.line || a.start - b.start)
}

/** Whole physical rows owned by style declarations, before model projection
 * or parser observation. Attribute comments and compact rows are excluded. */
export function erStyleStatementLines(lines: readonly string[]): ReadonlySet<number> {
  const result = new Set<number>()
  for (const statement of findErStatements(lines)) {
    if ((statement.syntax.kind === 'style' || statement.syntax.kind === 'class-def')
      && statement.line === statement.endLine
      && lines[statement.line]!.slice(statement.start, statement.end).trim() === lines[statement.line]!.trim()) {
      result.add(statement.line + 1)
    }
  }
  return result
}

/** The lossless ER grammar view. Scope and creation are decided here, before
 * either consumer projects statements into its own model. */
export function readErStatements(lines: readonly string[], report?: (what: string, portable: string, line: number) => void): {
  statements: ErSourceStatement[]
  placement: ErPlacement
  /** Each line a comment opened on an earlier line runs onto, and the column
   * its text ends at there: after its closing quote, or the line's end. */
  continuedComments: ReadonlyMap<number, number>
} {
  const continuedComments = new Map<number, number>()
  const found = findErStatements(lines, report, continuedComments)
  // Partition each line among the statements on it (ErSourceStatement.raw).
  const followed: boolean[] = []
  const startLines = new Set<number>()
  for (let index = found.length - 1; index >= 0; index--) {
    followed[index] = startLines.has(found[index]!.endLine)
    startLines.add(found[index]!.line)
  }
  const endedAt = new Map<number, number>()
  const statements: ErSourceStatement[] = []
  const fold = createErCreationFold()
  let entityId: string | undefined
  for (const [index, { syntax, line, endLine, end: lastColumn }] of found.entries()) {
    const column = endedAt.get(line) ?? 0
    const endColumn = followed[index] ? lastColumn : lines[endLine]!.length
    endedAt.set(endLine, endColumn)
    const raw = line === endLine
      ? lines[line]!.slice(column, endColumn)
      : [lines[line]!.slice(column), ...lines.slice(line + 1, endLine), lines[endLine]!.slice(0, endColumn)].join('\n')
    const context = { line, column, endLine, endColumn, ...(fold.innermost !== undefined ? { groupId: fold.innermost } : {}), ...(entityId !== undefined ? { entityId } : {}) }
    const entry: ErSourceStatement = { raw, ...context, syntax }
    statements.push(entry)
    if (parserObservationActive('er')) observeParserStatement('er', syntax.kind, entry.raw, { line: line + 2, unit: 'normalized' })
    switch (syntax.kind) {
      case 'group-open':
        fold.open(syntax.id)
        if (parserObservationActive('er')) observeParserMutation('er', 'openGroup', { id: syntax.id, enclosingGroupId: context.groupId }, { line: line + 2, unit: 'normalized' })
        break
      case 'end':
        fold.close()
        if (parserObservationActive('er')) observeParserMutation('er', 'closeGroup', { id: context.groupId, enclosingGroupId: fold.innermost }, { line: line + 2, unit: 'normalized' })
        break
      case 'block-open':
        entityId = syntax.reference.id
        fold.declare(entityId, syntax.reference.alias)
        if (parserObservationActive('er')) observeParserMutation('er', 'declareEntity', { ...syntax.reference, groupId: context.groupId }, { line: line + 2, unit: 'normalized' })
        break
      case 'block-close':
        entityId = undefined
        break
      case 'entity':
        fold.declare(syntax.reference.id, syntax.reference.alias)
        if (parserObservationActive('er')) observeParserMutation('er', 'declareEntity', { ...syntax.reference, groupId: context.groupId }, { line: line + 2, unit: 'normalized' })
        break
      case 'relation':
        entry.relationEntityIds = [syntax.relation.entity1, syntax.relation.entity2]
          .filter(end => {
            const isEntity = fold.relationEnd(end.id, end.alias)
            if (parserObservationActive('er')) observeParserMutation('er', 'nameRelationshipEndpoint', { ...end, isEntity, groupId: context.groupId }, { line: line + 2, unit: 'normalized' })
            return isEntity
          }).map(end => end.id)
        break
      case 'style':
        for (const id of syntax.ids) {
          fold.style(id)
          if (parserObservationActive('er')) observeParserMutation('er', 'ensureStyledEntity', { id }, { line: line + 2, unit: 'normalized' })
        }
        break
    }
  }
  if (entityId !== undefined) throw new Error(`ER_UNCLOSED_ENTITY: entity '${entityId}' needs a closing }`)
  const placement = fold.finish()
  if (parserObservationActive('er')) observeParserMutation('er', 'resolvePlacement', placement)
  return { statements, placement, continuedComments }
}

/**
 * Parse a Mermaid ER diagram.
 * Expects the first line to be "erDiagram".
 */
export function parseErDiagram(lines: string[]): ErDiagram {
  const accessibility = scanAccessibilityDirectives(lines)
  requireClosedAccessibility(accessibility)
  lines = accessibility.familyLines
  const diagram: ErDiagram = {
    entities: [],
    classDefs: new Map(),
    relationships: [],
    groups: [],
    ...(accessibility.accessibility.title !== undefined
      ? { accessibilityTitle: normalizeBrTags(accessibility.accessibility.title) }
      : {}),
    ...(accessibility.accessibility.descr !== undefined
      ? { accessibilityDescription: normalizeBrTags(accessibility.accessibility.descr) }
      : {}),
  }

  if (parserObservationActive('er')) {
    observeParserStatement('er', 'header', lines[0] ?? '', { line: 1, unit: 'normalized' })
    observeParserMutation('er', 'initialize', diagram)
  }

  // Which statement creates each entity, and which subgraph keeps it.
  const source = readErStatements(lines.slice(1))
  // Entity records by id; their order and subgraphs come from the fold.
  const entityMap = new Map<string, ErEntity>()
  // Keep repeated assignments linear; materialize the public string once.
  const classNamesByEntity = new Map<string, string[]>()
  const ensureStyledEntity = (id: string, className?: string): ErEntity => {
    const entity = ensureEntity(entityMap, id)
    if (className) {
      recordErClassNames(classNamesByEntity, id, className.split(' '))
      if (parserObservationActive('er')) observeParserMutation('er', 'appendEntityClasses', { id, classNames: classNamesByEntity.get(id) })
    }
    return entity
  }
  const declare = (reference: ParsedErEntityReference): ErEntity => {
    return ensureStyledEntity(reference.id, reference.className)
  }
  // Subgraph labels and scoped directions; nesting and members come from the fold.
  const groupById = new Map<string, Omit<ErDiagram['groups'][number], 'entityIds'>>()
  for (const entry of source.statements) {
    const statement = entry.syntax
    switch (statement.kind) {
      case 'unknown':
        throw new Error(`ER_UNSUPPORTED_STATEMENT: line ${entry.line + 2}: ${entry.raw.trim()}`)
      case 'attribute':
        entityMap.get(entry.entityId!)!.attributes.push(statement.attribute)
        if (parserObservationActive('er')) observeParserMutation('er', 'addAttribute', { entityId: entry.entityId, attribute: statement.attribute }, { line: entry.line + 2, unit: 'normalized' })
        break
      case 'direction': {
        const group = entry.groupId !== undefined ? groupById.get(entry.groupId) : undefined
        if (group) group.direction = statement.direction
        else diagram.direction = statement.direction
        if (parserObservationActive('er')) observeParserMutation('er', 'setDirection', { direction: statement.direction, groupId: group?.id }, { line: entry.line + 2, unit: 'normalized' })
        break
      }
      case 'group-open':
        groupById.set(statement.id, { id: statement.id, ...erTextLabel(statement.title ?? statement.id, true) })
        if (parserObservationActive('er')) observeParserMutation('er', 'upsertGroup', groupById.get(statement.id), { line: entry.line + 2, unit: 'normalized' })
        break
      case 'end':
        break
      case 'class-def':
        for (const name of statement.names) {
          diagram.classDefs.set(name, { ...statement.props })
          if (parserObservationActive('er')) observeParserMutation('er', 'setClassDefinition', { name, props: diagram.classDefs.get(name) }, { line: entry.line + 2, unit: 'normalized' })
        }
        break
      case 'class':
        for (const id of statement.ids) {
          // Mermaid only applies `class` to entities that already exist.
          if (entityMap.has(id)) {
            recordErClassNames(classNamesByEntity, id, statement.classNames)
            if (parserObservationActive('er')) observeParserMutation('er', 'appendEntityClasses', { id, classNames: classNamesByEntity.get(id) }, { line: entry.line + 2, unit: 'normalized' })
          }
        }
        break
      case 'style':
        for (const id of statement.ids) {
          const entity = ensureEntity(entityMap, id)
          entity.inlineStyle = { ...entity.inlineStyle, ...statement.props }
          if (parserObservationActive('er')) observeParserMutation('er', 'setEntityStyle', { id, props: entity.inlineStyle }, { line: entry.line + 2, unit: 'normalized' })
        }
        break
      case 'block-open':
        declare(statement.reference)
        break
      case 'relation': {
        diagram.relationships.push(relationshipFrom(statement.relation, entry.raw))
        if (parserObservationActive('er')) observeParserMutation('er', 'addRelationship', diagram.relationships.at(-1), { line: entry.line + 2, unit: 'normalized' })
        // Group endpoints retain group identity instead of minting phantom entities.
        for (const end of [statement.relation.entity1, statement.relation.entity2]) {
          if (entry.relationEntityIds!.includes(end.id)) ensureStyledEntity(end.id, end.className)
        }
        break
      }
      case 'entity':
        // Bare entities are emitted by the typed serializer.
        declare(statement.reference)
        break
    }
  }

  const placement = source.placement
  for (const [id, names] of classNamesByEntity) {
    entityMap.get(id)!.className = names.join(' ')
    if (parserObservationActive('er')) observeParserMutation('er', 'resolveEntityClasses', { id, className: entityMap.get(id)!.className })
  }
  diagram.entities = placement.order.map(id => {
    const entity = entityMap.get(id)!
    Object.assign(entity, erEntityDisplayText(id, placement.alias.get(id)))
    const owner = placement.owner.get(id)
    if (parserObservationActive('er')) observeParserMutation('er', 'resolveEntity', { ...entity, groupId: owner })
    return owner !== undefined ? { ...entity, groupId: owner } : entity
  })
  diagram.groups = placement.groups.map(group => {
    const resolved = {
      ...groupById.get(group.id)!,
      ...(group.parentId !== undefined ? { parentId: group.parentId } : {}),
      entityIds: group.entityIds,
    }
    if (parserObservationActive('er')) observeParserMutation('er', 'resolveGroup', resolved)
    return resolved
  })
  assertErDiagramWork(diagram)
  return diagram
}

/** Ensure an entity exists in the map; its label is set once the fold has
 * its first alias. */
function ensureEntity(entityMap: Map<string, ErEntity>, id: string): ErEntity {
  let entity = entityMap.get(id)
  if (!entity) {
    entity = { id, label: id, attributes: [] }
    entityMap.set(id, entity)
    if (parserObservationActive('er')) observeParserMutation('er', 'createEntity', entity)
  }
  return entity
}

/**
 * Parse one attribute written as text, without its trailing `%%` comment
 * (hasErTrailingComment); one that still has one is none. It reads as an
 * attribute block reads it: by Mermaid's attribute grammar, else in the
 * generous form (readGenerousErAttribute). A `}` outside a quoted word or
 * comment ends the block, so no unquoted field holds one.
 */
export function parseErAttribute(line: string): ErAttribute | null {
  if (trailingCommentStart(line) >= 0 || erBlockEndAt(line) >= 0) return null
  return readMermaidErAttribute(line) ?? readGenerousErAttribute(line)
}

/** One attribute as Mermaid's attribute grammar reads it, or none. */
function readMermaidErAttribute(line: string): ErAttribute | null {
  const read = readErAttributeTokens(undefined, lexErBlockText(line, 0, 0, line.length))
  return read?.done.length === 0 && read.open && read.open.last !== 'type' && erKeysCommaParted(read.open) ? erAttributeOf(read.open) : null
}

/**
 * An attribute's text as Mermaid can read it. Text only the generous form
 * reads is written with its keys comma-joined before the comment
 * (`int id PK, FK "c"`) when Mermaid reads that as the same attribute;
 * other text is kept as written.
 */
export function portableErAttributeText(text: string): string {
  if (readMermaidErAttribute(text)) return text
  const generous = parseErAttribute(text)
  if (!generous) return text
  const comment = (text.match(/^\S+\s+\S+\s+(.+)$/)?.[1] ?? '').match(/"[^"]*"/)?.[0]
  const portable = [generous.type, generous.name, generous.keys.join(', '), comment ?? ''].filter(Boolean).join(' ')
  const read = readMermaidErAttribute(portable)
  const same = read && read.type === generous.type && read.name === generous.name
    && read.keys.join() === generous.keys.join() && read.comment === generous.comment
  return same ? portable : text
}

/** Whether the text the writer emits for an attribute is one Mermaid's
 * attribute grammar reads: a typed edit writes no other (an attribute type
 * or name starting with a digit has no Mermaid spelling). */
export function writesPortableErAttribute(text: string): boolean {
  return parseErAttribute(text) !== null && readMermaidErAttribute(portableErAttributeText(text)) !== null
}

/**
 * The generous attribute form Mermaid's grammar does not read (`--string id`,
 * `string id "c" PK`): a type and a name of any text without spaces, then keys
 * and one quoted comment in any order. Its type is never a key or a quoted
 * comment, which Mermaid reads as the end of the attribute before it, and its
 * type and name each hold a letter or digit, so stray punctuation
 * (`TEAM : "parent"`) is not read as an attribute.
 */
function readGenerousErAttribute(line: string): ErAttribute | null {
  // Format: type name [PK|FK|UK [...]] ["comment"]
  const match = line.match(/^(\S+)\s+(\S+)(?:\s+(.+))?$/)
  if (!match || /^(?:"|(?:PK|FK|UK)\b)/i.test(match[1]!) || !match.slice(1, 3).every(part => /[^\W_]|[\u00C0-\uFFFF]/.test(part!))) return null
  if (trailingCommentStart(line) >= 0 || erBlockEndAt(line) >= 0) return null

  const type = match[1]!
  const name = match[2]!
  const rest = match[3]?.trim() ?? ''

  // Extract the quoted comment first, then the key constraints (PK, FK, UK).
  const commentMatch = rest.match(/"([^"]*)"/)
  const keys: ErAttribute['keys'] = []
  for (const part of rest.replace(/"[^"]*"/, '').trim().split(/[\s,]+/)) {
    const upper = part.toUpperCase()
    if (upper === 'PK' || upper === 'FK' || upper === 'UK') {
      keys.push(upper as 'PK' | 'FK' | 'UK')
    } else if (part) return null
  }

  return erAttribute(type, name, keys, commentMatch?.[1])
}

/**
 * Parse a relationship line.
 *
 * Cardinality tokens (same set on both sides, matching Mermaid's lexer and
 * the agent ER body parser in src/agent/er-body.ts):
 *   ||  |o  o|  }o  o{  }|  |{
 * Line: -- (identifying) or .. (non-identifying)
 *
 * Forms like {o, o}, |}, {| are not Mermaid tokens; a relationship-shaped
 * line carrying one throws instead of being silently dropped.
 *
 * Full pattern examples: CUSTOMER ||--o{ ORDER : places; CUSTOMER ||--o{ ORDER
 */
export interface ParsedErRelationshipSyntax {
  entity1: ParsedErEntityReference
  entity2: ParsedErEntityReference
  leftToken: string
  rightToken: string
  identifying: boolean
  /** The label as written, quotes removed (src/er/text.ts reads it). */
  label: string
  /** Set when the label is several unquoted words, or a word and a quoted
   * name (`x"y"`): Mermaid's label is one token, so it reads the first word as
   * the label and the rest as entities. */
  unquotedWords?: true
  /** Set when Mermaid reads no label here (erLabelUnread): there is none, or
   * its lexer reads other tokens in the label's place. */
  unreadLabel?: true
}

/**
 * Whether Mermaid reads no label from what follows a relationship's `:`. Its
 * label is required, on the relationship's line, and is a quoted string or a
 * word its lexer reads as text: one that a keyword, a cardinality, a link, a
 * number or punctuation does not claim first (`end`, `one`, `1`, `#x`), and
 * that punctuation, which starts no statement, does not follow (`h[s`), nor a
 * quote that nothing on the line closes (`x"`). A line
 * holding a direction is read as a direction instead (er_direction_line), and
 * a word or a quoted name after the label as more statements (er_label_words).
 * Mermaid encodes an entity code (`#quot;`) as non-ASCII text before lexing.
 */
function erLabelUnread(written: string): boolean {
  const text = written.replace(/#\w+;/g, '§')
  if (text.startsWith('"') || /direction\s+(?:TB|BT|LR|RL)/i.test(text)) return false
  const word = /^(?:\P{ASCII}|[\w*.-])*/u.exec(text)![0]
  const rest = text.slice(word.length)
  return word === '' || /^\d/.test(word) || isErKeywordName(text) || /^[^\s"]/.test(rest) || (rest.match(/"/g)?.length ?? 0) % 2 === 1
}

/** Shared relationship grammar. Alias text may contain spaces; entity styling
 * suffixes normalize to the same stable id instead of becoming phantom ids. */
export function parseErRelationshipSyntax(line: string, report?: ErQuotedTextReport): ParsedErRelationshipSyntax | null {
  const match = line.match(ER_RELATIONSHIP_RE)
  if (!match) return null
  const leftToken = match[2] ?? match[3]!
  // Mermaid's numeric `1` lexer recognizes a glyph operator only when it is
  // adjacent on the left. Other aliases may have whitespace before the glyph.
  if (leftToken === '1' && /^[ \t]/.test(match[4] ?? '')) return null
  const entity1 = parseErEntityReference(match[1]!, report)
  const entity2 = parseErEntityReference(match[8]!, report)
  if (!entity1 || !entity2) return null
  const operator = (match[4] ?? match[5]!).trim().replace(/[ \t]+/g, ' ').toLowerCase()
  return {
    entity1,
    entity2,
    leftToken,
    rightToken: match[6] ?? match[7]!,
    identifying: operator === '--' || operator === 'to',
    label: readErRelationLabel(match[9] ?? '', report),
    ...(erLabelUnread(match[9]?.trim() ?? '') ? { unreadLabel: true as const }
      // Outside a block Mermaid parts words only at blanks and tabs; U+2028
      // and U+2029 are word characters there.
      : /^[^"\s][^ \t"]*(?:[ \t]+\S|")/.test(match[9]?.trim() ?? '') ? { unquotedWords: true as const } : {}),
  }
}

function relationshipFrom(syntax: ParsedErRelationshipSyntax, line: string): ErRelationship {
  const cardinality1 = parseErCardinality(syntax.leftToken)
  const cardinality2 = parseErCardinality(syntax.rightToken)

  if (!cardinality1 || !cardinality2) {
    throw new Error(
      `Invalid ER cardinality "${syntax.leftToken}${syntax.identifying ? '--' : '..'}${syntax.rightToken}" in "${line}" ` +
      `(valid tokens include ||, |o, o|, }o, o{, }|, |{ and Mermaid's word/numeric aliases)`,
    )
  }

  return {
    entity1: syntax.entity1.id,
    entity2: syntax.entity2.id,
    cardinality1,
    cardinality2,
    ...erTextLabel(syntax.label, true),
    identifying: syntax.identifying,
  }
}

/**
 * Does this ER source carry the tolerated flowchart-style subgraph construct
 * (repo #103) — either riding the header (`erDiagram subgraph X`) or as body
 * `subgraph …` openers? Consumed by verify to emit the UNSUPPORTED_SYNTAX
 * lint that announces the dropped grouping; lives beside the tolerance so the
 * announcement cannot drift from what the parser actually ignores.
 */
export function erContainsSubgraphConstruct(lines: string[]): boolean {
  if (/^erdiagram\s+subgraph\b/i.test(lines[0] ?? '')) return true
  return lines.slice(1).some(line => /^subgraph\b/.test(line))
}

/** Parse a cardinality notation string into a Cardinality type */
export function parseErCardinality(str: string): Cardinality | null {
  switch (str.toLowerCase()) {
    case 'u': return 'parent'
    case '||': case 'only one': case '1': case 'one': return 'one'
    case '|o': case 'o|': case 'one or zero': case 'zero or one': return 'zero-one'
    case '}|': case '|{': case 'one or more': case 'one or many': case 'many(1)': case '1+': return 'many'
    case '}o': case 'o{': case 'zero or more': case 'zero or many': case 'many(0)': case '0+': case 'many': return 'zero-many'
    default: return null
  }
}
