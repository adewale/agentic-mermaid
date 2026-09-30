/**
 * The flowchart label codec: the text a label is authored as ⇄ the label the
 * model holds, for node shapes, pipe and text-arrow edge labels, subgraph
 * titles and `@{ label }` values. Three layers, in upstream's order:
 *   - lexical: the context's quoting, which flowchart-lexer.ts delimits (a
 *     quoted label has no escapes), then trimming, as upstream's DB trims;
 *   - display: `<br>` breaks the line, and so does `\n` outside a markdown
 *     string ("`…`"), where it stays literal (upstream since 11.13); a
 *     markdown string styles `**`, `*` and `~~`;
 *   - entity: Mermaid's `#…;` codes (shared/mermaid-entity-display.ts), which
 *     upstream reads before any grammar and shows after all of it. They are
 *     decoded last, in the text between formatting tags, so an entity never
 *     spells markup: `#lt;br#gt;` is the text `<br>`, and codes that would
 *     spell a formatting tag (`#lt;b#gt;`) keep their spelling, since the
 *     label model has no way to hold a literal formatting tag (upstream shows
 *     the tag's text). An HTML numeric character reference (`&#60;`,
 *     `&#x3C;`) is not read as an entity code: it belongs to the HTML layer
 *     the render path decodes before any grammar (render-contract.ts), and
 *     this parser keeps it as written. (Upstream reads its `#…;` as a code,
 *     showing `&<`.)
 * The writer inverts the three layers: for every label x the parser reads
 * writeFlowchartLabelText(x) back as x, and upstream shows it as x.
 */

import { normalizeBrTags, normalizePlainLabel } from './multiline-utils.ts'
import { encodeMermaidEntities } from './shared/mermaid-entities.ts'
import { decodeMermaidEntities, type EntityRefusal } from './shared/mermaid-entity-display.ts'
import { FORMAT_TAG_SOURCE } from './shared/inline-format.ts'

export interface ParsedFlowchartLabel {
  text: string
  markdown: boolean
}

const ENTITY_REFUSAL: EntityRefusal = { subject: 'Flowchart label entity', example: 'A["#35;"]' }

/** Formatting tags split out of a label (a capture group, for `split`). */
const FORMAT_TAG_SPLIT = new RegExp(`(${FORMAT_TAG_SOURCE})`, 'i')
/** HTML numeric character references split out of a text run. */
const CHARACTER_REFERENCE_SPLIT = /(&#(?:\d+|[xX][0-9a-fA-F]+);)/
/** Markup a decoded entity must not spell: the formatting tags. (A decoded
 * `<br>` is text: the label's line breaks are already `\n` by then.) */
const LABEL_MARKUP = new RegExp(FORMAT_TAG_SOURCE, 'gi')

function markupCount(text: string): number {
  return text.match(LABEL_MARKUP)?.length ?? 0
}

const ENTITY_CODE = /#\w+;/g

/** Decode the entity codes of one text run (no formatting tags in it). Codes
 * that would spell a formatting tag keep their spelling: first those showing
 * `<` or `>`, and, if a tag still forms, all of them. */
function decodeTextRun(run: string): string {
  const decoded = decodeMermaidEntities(run, ENTITY_REFUSAL)
  if (markupCount(decoded) === 0) return decoded
  const angles = run.replace(ENTITY_CODE, code => {
    const shown = decodeMermaidEntities(code, ENTITY_REFUSAL)
    return shown === '<' || shown === '>' ? code : shown
  })
  return markupCount(angles) === 0 ? angles : run
}

/** Entity decoding for a label whose display layer has already run: codes
 * decode in the text runs between formatting tags and character references,
 * never into new markup. */
function decodeLabelEntities(text: string): string {
  return text.split(FORMAT_TAG_SPLIT)
    .map((part, index) => index % 2 === 1 ? part : part.split(CHARACTER_REFERENCE_SPLIT)
      .map((run, runIndex) => runIndex % 2 === 1 ? run : decodeTextRun(run))
      .join(''))
    .join('')
}

/**
 * ONE label reading for node, edge and subgraph labels: a quoted backtick
 * string ("`…`") is a Mermaid markdown string — backticks consumed, styling
 * retained as formatted runs, `\n` literal — while everything else is plain
 * text whose `*`/`~` stay literal and whose `\n` breaks the line, as upstream
 * renders them. Both trim boundary whitespace like upstream's flowchart DB
 * (before entities decode, so `#32;` keeps a space), and typed mutations trim
 * to match (agent/flowchart-body.ts); upstream keeps it in a `@{ label }`
 * value, which renders the same, and trimming there too lets the serializer's
 * bracket form re-parse to the same label. Upstream's quoted strings
 * have no escapes: a `"` always closes one and `\` is literal; a label spells
 * `"` as `#quot;`. `alreadyUnquoted` marks callers whose grammar consumed the
 * double quotes (a quoted shape, `@{ label }`).
 */
export function parseFlowchartLabel(raw: string, alreadyUnquoted = false): ParsedFlowchartLabel {
  const unquoted = !alreadyUnquoted && raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')
    ? raw.slice(1, -1)
    : raw
  const quoteConsumed = alreadyUnquoted || unquoted !== raw
  if (quoteConsumed && unquoted.length >= 2 && unquoted.startsWith('`') && unquoted.endsWith('`')) {
    return { text: decodeLabelEntities(normalizeBrTags(unquoted.slice(1, -1).trim(), false)), markdown: true }
  }
  return { text: decodeLabelEntities(normalizePlainLabel(unquoted.trim())), markdown: false }
}

/** Characters no label text holds literally: `"` would close a quoted label
 * (or open a string in a bare one), and `<` could spell a line-break tag or
 * the `<word …>` span upstream's preprocessor rewrites. */
const RESERVED = '"<'

/** An `&` right before a numeric code would make it a character reference,
 * which the reader keeps as written: such an `&` is written `#amp;` as well. */
function escapeReferenceOpeners(text: string): string {
  return text.replace(/&+(?=#\d+;)/g, ampersands => '#amp;'.repeat(ampersands.length))
}

function writeText(text: string): string {
  return text.split(CHARACTER_REFERENCE_SPLIT).map((run, index) => index % 2 === 1
    ? run
    // A `\` before `n` is written `#92;`, so the display layer never reads
    // the pair as a line break.
    : escapeReferenceOpeners(encodeMermaidEntities(run, RESERVED).replace(/\\(?=n)/g, '#92;')))
    .join('')
}

/**
 * The label text as authored inside its quotes or brackets: line breaks as
 * `<br>`, formatting tags as written, and every other character that would
 * not read back as itself as a Mermaid entity code (`#quot;`, `#lt;`,
 * `#35;` before entity-shaped text, `#92;n`, boundary whitespace).
 */
export function writeFlowchartLabelText(label: string): string {
  const lines = label.split(/\r?\n/).map(line =>
    line.split(FORMAT_TAG_SPLIT).map((part, index) => index % 2 === 1 ? part : writeText(part)).join(''))
  const text = lines.join('<br>')
  // The parser trims a label, so boundary whitespace is written as codes.
  const lead = text.length - text.trimStart().length
  const trail = text.trim() === '' ? 0 : text.length - text.trimEnd().length
  if (lead === 0 && trail === 0) return text
  const codes = (run: string): string => [...run].map(character => `#${character.codePointAt(0)};`).join('')
  const middle = text.slice(lead, text.length - trail)
  return codes(text.slice(0, lead)) + (trail > 0 ? middle.replace(/&+$/, ampersands => '#amp;'.repeat(ampersands.length)) : middle)
    + codes(text.slice(text.length - trail))
}
