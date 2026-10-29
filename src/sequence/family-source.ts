import { decodeXML } from 'entities'
import { normalizeMermaidSource, type NormalizedMermaidSource } from '../mermaid-source.ts'
import { isHtmlEntityName } from '../shared/html-entity-table.ts'
import { XML_NAMED_ENTITIES } from '../shared/mermaid-entities.ts'

/** A double-encoded reference (`&amp;nbsp;`), or a numeric or named one. */
const REFERENCE = /&amp;(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z\d]{0,31});|&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z\d]{0,31});/g

/** Whether `&body;` names a character: numeric, one of XML's five, or HTML5. */
export function isCharacterReference(body: string): boolean {
  return body.startsWith('#') || XML_NAMED_ENTITIES.has(body) || isHtmlEntityName(body)
}

/**
 * The text the Sequence grammar reads from authored source. The render waist
 * decodes every XML reference before any grammar runs, so entity-encoded
 * source keeps its structure (`A-&gt;&gt;B`). Two characters it can produce
 * would end or comment out Sequence text that Mermaid reads as text, `;` and
 * `#`; they read as Mermaid's own entities (`#59;`, `#35;`) instead. An HTML
 * named reference the waist leaves as written (`&nbsp;`) would end its
 * statement at its `;`; it reads as `#nbsp;`, which displays its character.
 * A name that is no reference (`R&D;`) stays as written, so its `;` still
 * ends the statement. One pass: a double-encoded reference (`&amp;nbsp;`) is
 * literal text, its `&`, `#` and `;` written as entities so no later read
 * takes it for a reference.
 */
export function sequenceGrammarText(authored: string): string {
  if (!authored.includes('&')) return authored
  return authored.replace(REFERENCE, (reference, doubled: string | undefined, body: string | undefined) => {
    if (doubled !== undefined) {
      if (!isCharacterReference(doubled)) return `&${doubled};`
      return `#38;${doubled.replace('#', '#35;')}#59;`
    }
    if (!body!.startsWith('#') && !XML_NAMED_ENTITIES.has(body!)) return isHtmlEntityName(body!) ? `#${body};` : reference
    const decoded = decodeXML(reference)
    return decoded === '#' ? '#35;' : decoded === ';' ? '#59;' : decoded
  })
}

/**
 * `source` as the Sequence grammar reads it, for every projection that reads
 * Sequence statements (SVG, terminal, the typed body and its verify lints), so
 * they split and read them alike. `read` names the text `source` was
 * normalized from: the waist's decoded text, or the authored text.
 */
export function sequenceFamilySource(source: NormalizedMermaidSource, read: 'decoded' | 'authored'): NormalizedMermaidSource {
  const authored = source.originalText
  if (!authored.includes('&')) return source
  const grammar = sequenceGrammarText(authored)
  return grammar === (read === 'decoded' ? decodeXML(authored) : authored) ? source : normalizeMermaidSource(grammar)
}
