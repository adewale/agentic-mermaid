/**
 * The `@{…}` metadata block lexers, one per family grammar.
 *
 * Pinned Mermaid 11.16 reads flowchart node/edge `@{}` (`flowDb.ts`
 * `addVertex`), sequence participant `@{}` (`sequenceDb.ts` `addActor`) and
 * frontmatter (`frontmatter.ts`) with one call: js-yaml `load` under its
 * `JSON_SCHEMA`, and a YAML error rejects the diagram. That reader is
 * shared/mermaid-yaml.ts; this module holds the lexers that find a block.
 *
 * Each family's lexer decides where a `@{…}` block ends before YAML runs:
 *   - flowchart (`flow.jison` shapeData): `"` is the only string delimiter
 *     and has no escapes; inside a string a line break and the indentation
 *     after it become `<br/>`; outside strings the first `}` ends the block
 *     (so `'a}b;c'` is rejected) and `^` is a lexical error.
 *   - sequence (`sequenceDiagram.jison` CONFIG): the first `}` ends the
 *     block, quotes or not; the body is trimmed and may not be empty.
 * A one-line body is parsed as a flow mapping (`{\n<body>\n}`), a multi-line
 * body as a block document, as upstream does.
 */

import { parseMermaidYaml } from './mermaid-yaml.ts'
import { scanMetadataBlock, type MetadataGrammar } from './metadata-block-scan.ts'
import { fromEntityMarkers, toEntityMarkers } from './mermaid-entities.ts'

// ---- `@{…}` blocks ------------------------------------------------------------

export type MetadataEntries =
  | { ok: true; entries: ReadonlyMap<string, unknown> }
  | { ok: false; message: string }

/**
 * Parse a block body (from `scanMetadataBlock`) as upstream does. Upstream's
 * entity prepass has already turned each `#…;` code into a marker, so a code
 * never starts a YAML comment; string keys and values come back with the
 * codes spelled as authored, for the family's label codec. Keys are
 * case-sensitive. A document that is not a mapping has no entries, except
 * that a flowchart block whose document is empty or `null` is rejected:
 * upstream reads `doc.shape` from it and throws.
 */
export function parseMetadataBody(body: string, grammar: MetadataGrammar): MetadataEntries {
  const marked = toEntityMarkers(body)
  const parsed = parseMermaidYaml(marked.includes('\n') ? `${marked}\n` : `{\n${marked}\n}`)
  if (!parsed.ok) return parsed
  const value = parsed.value
  if (grammar === 'flowchart' && (value === null || value === undefined)) {
    return { ok: false, message: 'empty @{} metadata document' }
  }
  const entries = new Map<string, unknown>()
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, entry] of Object.entries(value)) entries.set(fromEntityMarkers(key), authoredCodes(entry))
  }
  return { ok: true, entries }
}

function authoredCodes(value: unknown): unknown {
  if (typeof value === 'string') return fromEntityMarkers(value)
  if (Array.isArray(value)) return value.map(authoredCodes)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [fromEntityMarkers(key), authoredCodes(entry)]))
  }
  return value
}


export type MetadataBlock =
  | { ok: true; end: number; entries: ReadonlyMap<string, unknown> }
  | { ok: false; unclosed: boolean; message: string }

/** `scanMetadataBlock`, then `parseMetadataBody`: the whole upstream read. */
export function readMetadataBlock(text: string, open: number, grammar: MetadataGrammar): MetadataBlock {
  const scan = scanMetadataBlock(text, open, grammar)
  if (scan.kind === 'unclosed') return { ok: false, unclosed: true, message: 'unclosed @{ metadata block' }
  if (scan.kind === 'invalid') return { ok: false, unclosed: false, message: scan.message }
  const parsed = parseMetadataBody(scan.body, grammar)
  return parsed.ok ? { ok: true, end: scan.end, entries: parsed.entries } : { ok: false, unclosed: false, message: parsed.message }
}

/** A metadata value as upstream uses a text field (`if (doc?.label)`): only
 * a truthy value counts, as its string form (`12` → "12", `true` → "true"). */
export function metadataText(value: unknown): string | undefined {
  return value ? String(value) : undefined
}

/**
 * Write `text` as a YAML double-quoted scalar that upstream's flowchart lexer
 * leaves intact: no raw `"` (the lexer has no escapes, so `"` is `\x22`), no
 * raw line break (the lexer would turn it into `<br/>`), and `\` doubled.
 * Mermaid's entity layer is the caller's: a label codec that spells `"` as
 * `#quot;` does so before calling this.
 */
export function quoteMetadataString(text: string): string {
  let out = '"'
  for (const character of text) {
    const code = character.codePointAt(0)!
    if (character === '\\') out += '\\\\'
    else if (character === '"') out += '\\x22'
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) out += `\\x${code.toString(16).padStart(2, '0')}`
    else if (code === 0x2028 || code === 0x2029) out += `\\u${code.toString(16)}`
    else out += character
  }
  return `${out}"`
}
