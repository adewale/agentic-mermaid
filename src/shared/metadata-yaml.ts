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
import { assertDiagramWorkLimit } from './diagram-limits.ts'

// ---- `@{…}` blocks ------------------------------------------------------------

export type MetadataEntries =
  | { ok: true; entries: ReadonlyMap<string, unknown> }
  | { ok: false; message: string }

/** Protect authored codes from YAML comments without conflating them with
 * literal Mermaid markers, including markers produced by YAML escapes.
 * The delimiter has more private-use characters than any authored scalar can
 * contain. Counting Unicode escapes as well as literals makes it impossible
 * for YAML decoding or folding to manufacture a protected token. */
export function protectMetadataEntities(source: string) {
  if (!/#\w+;/.test(source)) return { text: source, restore: (value: string): string => value, sourceOffset: (at: number): number => at }
  const counts = new Map<string, number>()
  const count = (character: string): void => {
    const code = character.codePointAt(0)!
    if (code >= 0xe000 && code <= 0xf8ff) counts.set(character, (counts.get(character) ?? 0) + 1)
  }
  for (const character of source) count(character)
  for (const match of source.matchAll(/\\(?:u([\da-fA-F]{4})|U([\da-fA-F]{8}))/g)) {
    const code = Number.parseInt(match[1] ?? match[2]!, 16)
    if (code <= 0x10ffff) count(String.fromCodePoint(code))
  }
  let character = '\uE000'
  let frequency = counts.get(character) ?? 0
  for (let code = 0xe001; frequency > 0 && code <= 0xf8ff; code++) {
    const candidate = String.fromCodePoint(code), count = counts.get(candidate) ?? 0
    if (count < frequency) { character = candidate; frequency = count }
  }
  let projectedLength = source.length
  const codes = /#\w+;/g
  while (codes.test(source)) projectedLength += 2 * frequency
  // The existing source budget also covers authored metadata plus its
  // normalized YAML view; refuse before allocating that temporary view.
  assertDiagramWorkLimit('sourceCharacters', source.length + projectedLength)
  const delimiter = character.repeat(frequency + 1)
  const token = new RegExp(`${delimiter}(\\w+)${delimiter}`, 'g')
  const edits: Array<{ start: number; end: number; sourceStart: number; sourceEnd: number }> = []
  let delta = 0
  const text = source.replace(/#\w+;/g, (code: string, sourceStart: number) => {
    const marked = `${delimiter}${code.slice(1, -1)}${delimiter}`, start = sourceStart + delta
    edits.push({ start, end: start + marked.length, sourceStart, sourceEnd: sourceStart + code.length })
    delta += marked.length - code.length
    return marked
  })
  return {
    text,
    restore: (value: string): string => value.replace(token, (_token, code: string) => `#${code};`),
    sourceOffset: (at: number): number => {
      let lo = 0, hi = edits.length
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (edits[mid]!.start <= at) lo = mid + 1; else hi = mid }
      const edit = edits[lo - 1]
      return edit ? at < edit.end ? edit.sourceStart : at - edit.end + edit.sourceEnd : at
    },
  }
}

/**
 * Parse a block body (from `scanMetadataBlock`) as upstream does. Temporary
 * tokens protect each authored `#…;` code from becoming a YAML comment, then
 * restore only those codes. Literal marker-looking strings stay literal;
 * string keys and values retain authored codes for the family's label codec. Keys are
 * case-sensitive. A document that is not a mapping has no entries, except
 * that a flowchart block whose document is empty or `null` is rejected:
 * upstream reads `doc.shape` from it and throws.
 */
export function parseMetadataBody(body: string, grammar: MetadataGrammar): MetadataEntries {
  const protectedBody = protectMetadataEntities(body)
  const marked = protectedBody.text
  const parsed = parseMermaidYaml(marked.includes('\n') ? `${marked}\n` : `{\n${marked}\n}`)
  if (!parsed.ok) return parsed
  const value = parsed.value
  if (grammar === 'flowchart' && (value === null || value === undefined)) {
    return { ok: false, message: 'empty @{} metadata document' }
  }
  const entries = new Map<string, unknown>()
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    try {
      for (const [key, entry] of Object.entries(authoredCodes(value, protectedBody.restore) as Record<string, unknown>)) entries.set(key, entry)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
  return { ok: true, entries }
}

function authoredCodes(value: unknown, restore: (text: string) => string): unknown {
  if (typeof value === 'string') return restore(value)
  if (Array.isArray(value)) return value.map(entry => authoredCodes(entry, restore))
  if (value && typeof value === 'object') {
    const keys = new Set<string>()
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      const authored = restore(key)
      if (keys.has(authored)) throw new Error(`duplicate metadata key ${JSON.stringify(authored)}`)
      keys.add(authored)
      return [authored, authoredCodes(entry, restore)]
    }))
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
 * Directive-looking text shields `%` through YAML hex escapes so the global
 * Mermaid preprocessor cannot consume it before the scalar is decoded.
 * Mermaid's entity layer is the caller's: a label codec that spells `"` as
 * `#quot;` does so before calling this.
 */
export function quoteMetadataString(text: string): string {
  let out = '"'
  const shieldDirective = text.includes('%%{')
  for (const character of text) {
    const code = character.codePointAt(0)!
    if (character === '\\') out += '\\\\'
    else if (character === '"') out += '\\x22'
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || (shieldDirective && character === '%')) out += `\\x${code.toString(16).padStart(2, '0')}`
    else if (code === 0x2028 || code === 0x2029) out += `\\u${code.toString(16)}`
    else out += character
  }
  return `${out}"`
}
