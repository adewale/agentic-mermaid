import { displayText, normalizeBrTags } from '../multiline-utils.ts'
import { isCharacterReference } from './family-source.ts'
import { encodeMermaidAuthoredEntities, encodeMermaidEntities, ENTITY_MARKER_RE, mermaidEntityPrepass } from '../shared/mermaid-entities.ts'
import { decodeMermaidEntities } from '../shared/mermaid-entity-display.ts'
import { prepareDisplayText, replaceDisplayTextTokens, resolveLabelContent, writeDisplayText, type LabelContent } from '../shared/display-text.ts'

const REFUSAL = { subject: 'Sequence text entity', example: 'A->>B: #35;' }
const DISPLAY_ENTITY = new RegExp(`#\\w+;|${ENTITY_MARKER_RE.source}`, 'g')

/** Controls are source syntax, read once before entity decoding. An encoded
 * colon or prefix therefore remains literal authored text. */
export function splitSequenceTextControl(authored: string): { text: string; wrap?: boolean } {
  const text = authored.trim()
  const control = /^:?(wrap|nowrap):/.exec(text)
  return control ? { text: text.slice(control[0].length).trim(), wrap: control[1] === 'wrap' } : { text }
}

export function writeSequenceControlledText(value: string, content: LabelContent | undefined, wrap: boolean | undefined, prefix: string): string {
  const control = wrap === undefined ? '' : wrap ? 'wrap: ' : 'nowrap: '
  let written = writeSequenceText(value, content, prefix + control)
  // A typed string is text, even when its first characters resemble a control.
  if (!control && /^:?(?:no)?wrap:/.test(written)) written = `#${written.charCodeAt(0)};${written.slice(1)}`
  return control + written
}

/** The body keeps authored formatting syntax, with entities read as text.
 * Display formatting runs are prepared before entities expand, so encoded
 * tags, emphasis and backslash-n never become new formatting instructions. */
export function readSequenceText(authored: string): { value: string; content?: LabelContent } {
  const value = decodeMermaidEntities(authored, REFUSAL)
  if (value === authored) return { value }
  const prepared = replaceDisplayTextTokens(prepareDisplayText(normalizeBrTags(authored)), DISPLAY_ENTITY,
    token => decodeMermaidEntities(token, REFUSAL))
  return { value, content: Object.freeze({ value, authored, prepared }) }
}

/** Native models retain their normalized label strings for compatibility;
 * the sidecar preserves a literal reading that the string cannot express. */
export function readSequenceLabel(authored: string): { label: string; labelContent?: LabelContent } {
  const text = readSequenceText(authored)
  const label = decodeMermaidEntities(normalizeBrTags(authored), REFUSAL)
  return { label, ...(text.content ? { labelContent: Object.freeze({ ...text.content, value: label }) } : {}) }
}

/** What the renderers draw for an authored payload: their reading of it, with
 * label quotes, line breaks and formatting interpreted. Read-back surfaces
 * (facts, describe) use this, never the body's authored string. */
export function sequencePayloadDisplayText(authored: string): string {
  const read = readSequenceLabel(authored)
  return displayText(resolveLabelContent(read.label, read.labelContent))
}

/** What the renderers draw for a typed body string: their reading of the
 * payload the writer emits for it. */
export function sequenceDisplayText(value: string, content?: LabelContent): string {
  return sequencePayloadDisplayText(writeSequenceText(value, content))
}

/** A physical line cannot occur inside a Sequence message statement. Typed
 * message operations admit it as the canonical authored line-break spelling,
 * so their returned body is also the body their export reads back. */
export function normalizeSequenceMessageText(text: string): string {
  return text.replace(/\r\n|[\r\n]/g, '<br/>')
}

function writeLiteral(text: string): string {
  return encodeMermaidEntities(text, '#;')
}

/** Parsed source keeps its authored formatting and entity tokens. New typed
 * strings keep the same formatting policy, but entity-looking text is literal:
 * callers never need to pre-escape a value passed to a mutation. */
export function writeSequenceText(value: string, content?: LabelContent, prefix = ''): string {
  let source: string
  if (content?.value === value && content.authored !== undefined) {
    source = encodeMermaidAuthoredEntities(content.authored, '#;')
  } else if (content?.value === value) {
    source = writeDisplayText(content.prepared, text => encodeMermaidEntities(text, '#;*~_<').replace(/\\(?=n)/g, '#92;'), '<br/>')
  } else {
    source = writeLiteral(value)
  }
  // An `&` the readers would take for a character reference's start
  // (./family-source.ts) is written as its entity.
  source = source.replace(/&(?=#\d+;|#[xX][0-9a-fA-F]+;|([a-zA-Z][a-zA-Z\d]{0,31});)/g, (amp, name: string | undefined) =>
    name === undefined || isCharacterReference(name) ? '#38;' : amp)
  // The readers trim statement text before decoding entities. Preserve typed
  // boundary spaces without turning them into statement indentation.
  source = normalizeSequenceMessageText(source).replace(/^ +| +$/g, spaces => '#32;'.repeat(spaces.length))
  // Comments are recognized before TXT/ALIAS payloads. Keep a literal pair
  // shielded until field decoding, including a directive-looking opener.
  source = source.replace(/%%/g, '%#37;')
  // Mermaid's global style prepass can start in an actor ID and reach a
  // label colon. Check the full statement, then hide only payload colons
  // from that lexical pass; entity expansion restores the public value.
  return mermaidEntityPrepass(prefix + source) === prefix + source ? source
    : source.replace(/:/g, '#58;')
}
