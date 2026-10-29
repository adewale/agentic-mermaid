// ============================================================================
// State text: the one codec for a state's label, a transition label and a
// note's text, for the render parser (src/parser.ts) and the typed body
// (src/agent/state-body.ts) alike.
//
// Layers, in the order Mermaid reads them:
//   entity   `#name;` / `#123;` codes (src/shared/mermaid-entities.ts), which
//            upstream turns into markers before its State grammar runs.
//   display  `<br>` and markdown emphasis (normalizeBrTags), read from the
//            text as written, before its entity codes: an entity never forms
//            a line break or emphasis.
//
// The public string holds the codes read; a sidecar (LabelContent) keeps the
// text as written and its display reading, so an entity-produced `<b>` stays
// literal and the writer spells the codes back as they were written.
// ============================================================================

import { normalizeBrTags } from '../multiline-utils.ts'
import { encodeMermaidAuthoredEntities, encodeMermaidEntities, mermaidEntityPrepass } from '../shared/mermaid-entities.ts'
import { decodeMermaidEntities, type EntityRefusal } from '../shared/mermaid-entity-display.ts'
import { prepareDisplayText, replaceDisplayTextTokens, type LabelContent } from '../shared/display-text.ts'

const STATE_ENTITY_REFUSAL: EntityRefusal = { subject: 'State text entity', example: 'A : I #9829; states' }
const ENTITY_CODE = /#\w+;/g
const decodeStateEntity = (token: string): string => decodeMermaidEntities(token, STATE_ENTITY_REFUSAL)

/** State text as written (a transition label, a note's lines joined with
 *  `\n`): the string it displays, and, where it holds an entity code, the
 *  sidecar that keeps how it was written. */
export function readStateText(authored: string): { text: string; content?: LabelContent } {
  return read(normalizeBrTags(authored), authored)
}

/** A state's label as written, one piece per line (a `state "…" as` name and
 *  the descriptions under it), read as readStateText reads text. The text as
 *  written spells its line breaks `<br/>` and drops the quotes around a
 *  piece, which reading drops too, as the writer writes the label in
 *  `state "…" as X`, so the label reads back the same from either. */
export function readStateLabel(pieces: readonly string[]): { text: string; content?: LabelContent } {
  const unquoted = pieces.map(piece => piece.startsWith('"') && piece.endsWith('"') ? piece.slice(1, -1) : piece)
  return read(pieces.map(piece => normalizeBrTags(piece)).join('\n'), unquoted.join('\n').replace(/\r\n?|\n/g, '<br/>'))
}

function read(normalized: string, authored: string): { text: string; content?: LabelContent } {
  const text = decodeMermaidEntities(normalized, STATE_ENTITY_REFUSAL)
  if (!/#\w+;/.test(authored)) return { text }
  const prepared = replaceDisplayTextTokens(prepareDisplayText(normalized), ENTITY_CODE, decodeStateEntity)
  return { text, content: Object.freeze({ value: text, prepared, authored }) }
}

/**
 * Write State text so that Mermaid and ours read `text` back: as written
 * while `content` still describes it, else with `#`, a backslash before `n`
 * and the `reserved` characters spelled as entity codes. Line breaks stay
 * `\n`; a label's writer spells them `<br/>`.
 */
export function writeStateText(text: string, content?: LabelContent, reserved = ''): string {
  const authored = content?.value === text ? content.authored : undefined
  const written = authored !== undefined ? encodeMermaidAuthoredEntities(authored, reserved) : encodeMermaidEntities(text, reserved).replace(/\\(?=n)/g, '#92;')
  // Public Mermaid preprocessing recognizes directives even inside text.
  return written.replace(/%%(?=\{)/g, '#37;%')
}

/**
 * Write the text after a description or transition-label colon, after
 * `line` on its line. Mermaid's DESCR token ends at a `;`, at a `:` another
 * follows and at a final `:`, so those are written as entity codes.
 */
export function writeStateDescription(text: string, content: LabelContent | undefined, line: string): string {
  const written = writeStateText(text, content, ';').replace(/\r\n?|\n/g, '<br/>').replace(/:(?=:|$)/g, '#58;')
  return keepStateTextFromPrepass(written, line)
}

/**
 * Text written on a line after `before`, kept from upstream's style/classDef
 * prepass: where that would strip a `;` from the line, every colon of the
 * text is written `#58;`, as the Sequence writer does, so none is left for
 * the prepass to match.
 */
export function keepStateTextFromPrepass(written: string, before = ''): string {
  return mermaidEntityPrepass(before + written) === before + written ? written : written.replace(/:/g, '#58;')
}
