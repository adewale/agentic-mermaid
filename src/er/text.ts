// ============================================================================
// ER text: the one codec for text in the ER grammar.
//
// Layers, in the order pinned Mermaid 11.16 reads them (erDiagram.jison):
//   lexical  A quoted name (an entity name or alias, a subgraph id) is
//            ENTITY_NAME, `"[^"%\r\n\v\b\\]+"`. A relation label may also be
//            WORD, `"[^"]*"`. Neither has escapes: `\"` is an error, and a
//            `"` is written as the entity code `#quot;`. Ours also reads a
//            name with `%`, a backslash or nothing in it, and `\"` and `\\`
//            in either as `"` and `\`; verify reports each (ErQuotedTextReport).
//   entity   `#name;` / `#123;` codes (src/shared/mermaid-entities.ts).
//   display  `<br>` and markdown emphasis (upstream renders ER labels as
//            markdown), read from the text as written, before its entity
//            codes: an entity never forms emphasis or a line break.
//
// The parsers read quoted text here, the typed body keeps its entity codes
// read, and the serializer writes it back with writeErName /
// writeErRelationLabel, so reading what they write gives the text back.
// ============================================================================

import { breakLineTags, normalizeBrTags } from '../multiline-utils.ts'
import { encodeMermaidEntities, encodeMermaidAuthoredEntities } from '../shared/mermaid-entities.ts'
import { decodeMermaidEntities, type EntityRefusal } from '../shared/mermaid-entity-display.ts'
import { syntaxError } from '../shared/syntax-error.ts'
import { prepareDisplayText, preparedDisplayTextValue, replaceDisplayTextTokens, resolveLabelContent, type LabelContent } from '../shared/display-text.ts'

const ER_ENTITY_REFUSAL: EntityRefusal = { subject: 'ER text entity', example: 'A["I #9829; ER"]' }

/** What a quoted ER name cannot hold, written as entity codes. (Its line
 * breaks are the display layer's `<br>`.) */
const ER_NAME_RESERVED = '"%\\'

/** Hears quoted ER text Mermaid rejects that ours reads: what ours reads
 * there, and how to write it portably. */
export type ErQuotedTextReport = (what: string, portable: string) => void

/** Quoted text read generously: `\"` and `\\` are `"` and `\`. */
function unescapeErQuoted(text: string): string {
  return text.replace(/\\(["\\])/g, '$1')
}

/**
 * The text of a quoted name token (`"…"`, quotes included). The lexer keeps
 * a `\"` inside the token, which reads as `"`; `report` hears a name
 * Mermaid rejects (a backslash, a `%`, or no text).
 */
export function readErQuotedName(token: string, context: string, report?: ErQuotedTextReport): string {
  const text = token.slice(1, -1)
  if (text.includes('\\')) report?.(`${context} ${token} contains a backslash, and \\" reads as "`, 'write " as #quot; and \\ as #92;')
  else if (text.includes('%')) report?.(`${context} ${token} contains a % and is read as written`, 'write % as #37;')
  else if (text === '') report?.(`${context} ${token} is empty and is read as no text`, 'give the name some text')
  return unescapeErQuoted(text)
}

/**
 * The text of a relation label: what follows the `:`, trimmed. A quoted
 * label is one string, `"…"` with no `"` inside; ours also reads a `\"` in
 * it as `"`, and `report` hears that.
 */
export function readErRelationLabel(raw: string, report?: ErQuotedTextReport): string {
  const text = raw.trim()
  if (!text.startsWith('"')) return text
  if (/^"[^"]*"$/.test(text)) return text.slice(1, -1)
  if (/^"(?:\\.|[^"\\])*"$/.test(text)) {
    report?.(`ER relation label ${text} contains \\", which reads as "`, 'write " as #quot;')
    return unescapeErQuoted(text.slice(1, -1))
  }
  throw syntaxError({
    what: `ER relation label ${text} is not one quoted string`,
    expectedForm: 'one pair of quotes, with " written as #quot;',
    example: 'A ||--o{ B : "says #quot;hi#quot;"',
  })
}

/** The semantic text of ER text as written: its entity codes read. */
export function decodeErText(text: string): string {
  return decodeMermaidEntities(text, ER_ENTITY_REFUSAL)
}

/**
 * The text the renderer draws for ER text as written: `<br>` breaks the line
 * and markdown emphasis becomes the formatting tags, then entity codes are
 * read. Prepared runs retain literal entity-produced tags separately from
 * genuine formatting; the public label keeps its compatible string value.
 */
function normalizedErText(text: string): string {
  return normalizeBrTags(text)
    .replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<i>$1</i>')
}

export function erDisplayText(text: string): string {
  return decodeErText(normalizedErText(text))
}

/** Retain entity provenance only where the authored spelling has a second
 * reading. Formatting is parsed before codes expand into literal runs. */
export function erTextContent(authored: string, value: string, literal = false): LabelContent | undefined {
  if (!/#\w+;/.test(authored)) return undefined
  const normalized = literal ? normalizeBrTags(authored) : normalizedErText(authored)
  const prepared = replaceDisplayTextTokens(prepareDisplayText(normalized, literal ? 'literal' : 'formatted'), /#\w+;/g, decodeErText)
  return { value, prepared, authored }
}

export function erTextLabel(authored: string, display = false): { label: string; labelContent?: LabelContent } {
  const label = display ? erDisplayText(authored) : decodeErText(authored)
  const labelContent = erTextContent(authored, label)
  return { label, ...(labelContent ? { labelContent } : {}) }
}

/** An attribute comment as drawn on its row: line breaks become spaces. */
export function erCommentText(comment: string, content?: LabelContent): string {
  const prepared = resolveLabelContent(comment, content)
  if (typeof prepared !== 'string') return preparedDisplayTextValue(prepared).replace(/\s+/g, ' ').trim()
  return breakLineTags(comment).replace(/\s+/g, ' ').trim()
}

function writeErText(text: string, reserved: string, content?: LabelContent): string {
  return content?.value === text && content.authored !== undefined
    ? encodeMermaidAuthoredEntities(content.authored, reserved)
    : encodeMermaidEntities(text, reserved)
}

/** Write text as a quoted ER name (an alias). */
export function writeErName(text: string, content?: LabelContent): string {
  return `"${writeErText(text, ER_NAME_RESERVED, content)}"`
}

// Tokens the ER lexer claims before an unquoted label can: a keyword matched
// as a whole word (`one`, `one-to`, but not `ones`), in any case, and the
// parent cardinality `u` before `-`.
const ER_LABEL_KEYWORD = /^(?:(?:one|many|to|style|classDef|class|subgraph|end|erDiagram)(?!\w)|u-)/i

/** One plain word the ER lexer reads as text, not as a keyword. */
function isPlainErWord(word: string): boolean {
  return /^[A-Za-z_][\w-]*$/.test(word) && !ER_LABEL_KEYWORD.test(word)
}

/**
 * Write a relation label: bare when it is one plain word the lexer reads as
 * a label (`places`), else quoted. The empty label is `""`.
 */
export function writeErRelationLabel(text: string, content?: LabelContent): string {
  return isPlainErWord(text) ? text : `"${writeErText(text, '"', content)}"`
}

/** Write a subgraph title (`subgraph G [Title]`): plain words bare, anything
 * else as one quoted name. */
export function writeErTitle(text: string, content?: LabelContent): string {
  return text.split(' ').every(isPlainErWord) ? text : writeErName(text, content)
}
