import { decodeXML } from 'entities'
import { normalizeMermaidSource, type NormalizedMermaidSource } from '../mermaid-source.ts'
import { isHtmlEntityName } from '../shared/html-entity-table.ts'
import { XML_NAMED_ENTITIES } from '../shared/mermaid-entities.ts'
import type { ParserGrammarTrace } from '../shared/parser-source.ts'
import { scanSequenceStatementLines } from './statements.ts'

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
function sequenceGrammarReference(reference: string, doubled: string | undefined, body: string | undefined): string {
  if (doubled !== undefined) {
    if (!isCharacterReference(doubled)) return `&${doubled};`
    return `#38;${doubled.replace('#', '#35;')}#59;`
  }
  if (!body!.startsWith('#') && !XML_NAMED_ENTITIES.has(body!)) return isHtmlEntityName(body!) ? `#${body};` : reference
  const decoded = decodeXML(reference)
  return decoded === '#' ? '#35;' : decoded === ';' ? '#59;' : decoded
}

export function sequenceGrammarText(authored: string): string {
  return authored.includes('&') ? authored.replace(REFERENCE, sequenceGrammarReference) : authored
}

/** The same entity projection with boundary provenance, used only on failure. */
export function sequenceGrammarSource(authored: string): { text: string; sourceOffset: (offset: number) => number } {
  const edits: Array<{ start: number; end: number; originalStart: number; originalEnd: number }> = []
  let delta = 0
  const text = authored.replace(REFERENCE, (reference, doubled: string | undefined, body: string | undefined, offset: number) => {
    const replacement = sequenceGrammarReference(reference, doubled, body)
    if (reference !== replacement) {
      edits.push({ start: offset + delta, end: offset + delta + replacement.length, originalStart: offset, originalEnd: offset + reference.length })
      delta += replacement.length - reference.length
    }
    return replacement
  })
  return { text, sourceOffset(offset) {
    let low = 0, high = edits.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (edits[middle]!.start <= offset) low = middle + 1
      else high = middle
    }
    const edit = edits[low - 1]
    return !edit ? offset : offset < edit.end ? edit.originalStart : edit.originalEnd + offset - edit.end
  } }
}

/** Sequence owns entity and inline-accessibility provenance; other families
 * can align generic source errors without loading this grammar's scanner. */
export const sequenceGrammarTrace: ParserGrammarTrace = {
  project: sequenceGrammarSource,
  statements: (rows, text) => /^sequenceDiagram\b/i.test(rows[0]?.text.trim() ?? '') && /;\s*acc(?:Title|Descr)\b/i.test(text)
    ? scanSequenceStatementLines(rows.map(row => row.text)).map(span => ({ text: span.raw, offset: rows[span.line]!.offset + span.column }))
    : rows,
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
