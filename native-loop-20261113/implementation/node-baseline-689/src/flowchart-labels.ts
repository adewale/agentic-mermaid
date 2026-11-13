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
 *     spells markup: `#lt;br#gt;` is the text `<br>`, and formatting-tag
 *     text such as `#lt;b#gt;` retains literal runs beside genuine formatting.
 *     An HTML numeric character reference (`&#60;`,
 *     `&#x3C;`) is not read as an entity code: it belongs to the HTML layer
 *     the render path decodes before any grammar (render-contract.ts), and
 *     this parser keeps it as written. (Upstream reads its `#…;` as a code,
 *     showing `&<`.)
 * The writer inverts the three layers: for every label x the parser reads
 * writeFlowchartLabelText(x) back as x, and upstream shows it as x.
 */

import { normalizeBrTags, normalizePlainLabel, displayText } from './multiline-utils.ts'
import { encodeMermaidEntities, encodeMermaidAuthoredEntities } from './shared/mermaid-entities.ts'
import { decodeMermaidEntities, type EntityRefusal } from './shared/mermaid-entity-display.ts'
import { FORMAT_TAG_SOURCE } from './shared/inline-format.ts'
import { prepareDisplayText, preparedDisplayTextValue, replaceDisplayTextTokens, type LabelContent } from './shared/display-text.ts'

export interface ParsedFlowchartLabel {
  text: string
  markdown: boolean
  labelContent?: LabelContent
}

const ENTITY_REFUSAL: EntityRefusal = { subject: 'Flowchart label entity', example: 'A["#35;"]' }

/** Formatting tags split out of a label (a capture group, for `split`). */
const FORMAT_TAG_SPLIT = new RegExp(`(${FORMAT_TAG_SOURCE})`, 'i')
/** HTML numeric character references split out of a text run. */
const CHARACTER_REFERENCE_SPLIT = /(&#(?:\d+|[xX][0-9a-fA-F]+);)/
/** Entity decoding for a label whose display layer has already run: codes
 * decode in the text runs between formatting tags and character references,
 * never into new markup. */
function decodeLabelEntities(text: string): string {
  return text.split(FORMAT_TAG_SPLIT)
    .map((part, index) => index % 2 === 1 ? part : part.split(CHARACTER_REFERENCE_SPLIT)
      .map((run, runIndex) => runIndex % 2 === 1 ? run : decodeMermaidEntities(run, ENTITY_REFUSAL))
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
  const unquoted = alreadyUnquoted ? raw : unquoteFlowchartLabel(raw)
  const quoteConsumed = alreadyUnquoted || unquoted !== raw
  const markdown = quoteConsumed && unquoted.length >= 2 && unquoted.startsWith('`') && unquoted.endsWith('`')
  const authored = markdown ? `\`${unquoted.slice(1, -1).trim()}\`` : unquoted.trim()
  const normalized = markdown ? normalizeBrTags(unquoted.slice(1, -1).trim(), false) : normalizePlainLabel(authored)
  // Only entity decoding can make the public string need a distinct display
  // reading. Ordinary labels have no sidecar to retain or compare here.
  if (!normalized.includes('#') && !normalized.includes('ﬂ°')) return { text: normalized, markdown }
  const text = decodeLabelEntities(normalized)
  const prepared = replaceDisplayTextTokens(prepareDisplayText(normalized), /&#(?:\d+|[xX][0-9a-fA-F]+);|#\w+;/g,
    token => token.startsWith('&') ? token : decodeMermaidEntities(token, ENTITY_REFUSAL))
  // Ordinary labels keep their compact string representation. Only a literal
  // entity-produced formatting tag needs runs to distinguish it from markup.
  const labelContent = preparedDisplayTextValue(prepared) === displayText(text) ? undefined : { value: text, prepared, authored }
  return { text, markdown, ...(labelContent ? { labelContent } : {}) }
}

/** Label text as authored, without the quotes of a string: the whole text
 * quoted (`"a"`), or a string upstream's text joins to the text after it
 * (`"a" b` is `a b` there), when that text holds no `"`. A markdown string
 * keeps its quotes unless it is the whole text. */
export function unquoteFlowchartLabel(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"')) return raw
  if (raw.endsWith('"')) return raw.slice(1, -1)
  const close = raw.indexOf('"', 1)
  return close > 0 && !raw.startsWith('"`') && !raw.includes('"', close + 1) ? raw.slice(1, close) + raw.slice(close + 1) : raw
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
export function writeFlowchartLabelText(label: string, content?: LabelContent): string {
  if (content?.value === label && content.authored !== undefined) {
    const tags = new RegExp(`(${FORMAT_TAG_SOURCE}|<br\\s*\\/?>)`, 'gi')
    return content.authored.split(tags).map((part, index) => index % 2 ? part : encodeMermaidAuthoredEntities(part, RESERVED)).join('')
  }
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
