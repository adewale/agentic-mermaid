import { decodeXML } from 'entities'
import { type NormalizedMermaidSource, normalizeMermaidSource } from '../mermaid-source.ts'
import { joinQuotedTextLines, type QuotedTextRule } from '../shared/trailing-comment.ts'

/** A "…" label runs to its closing quote across line breaks, which it keeps;
 * a title runs to the end of its line. */
export const PIE_QUOTED_TEXT: QuotedTextRule = { wholeLine: line => /^(?:pie(?:\s+showData)?\s+)?title(?:\s|$)/i.test(line) }

/**
 * Pie's grammar lines for a render request. The request decodes entities in
 * the whole source, but Mermaid Pie keys sections by the label as authored,
 * including entity spelling: decode grammar (header, separators, values) and
 * put authored label and title text back before Pie's own display projection.
 */
export function pieFamilyLines(source: NormalizedMermaidSource): string[] {
  if (!source.authoredFamilyLines) return source.familyLines
  const quotedLabel = /^\s*"(?:[^"\\]|\\.)*"/
  const hybrid = joinQuotedTextLines(source.authoredFamilyLines, PIE_QUOTED_TEXT).map((line, index) => {
    // Pie titles are display text, not grammar separators. Keep their entity
    // spelling for the family-owned projection just as with quoted labels.
    const title = splitAuthoredPieTitleLine(line, index === 0 ? 'header' : 'body')
    if (title) return title.decodedPrefix + title.authoredTitle
    const label = quotedLabel.exec(line)?.[0]
    return label === undefined ? decodeXML(line) : label + decodeXML(line.slice(label.length))
  }).join('\n')
  // Reapply normal comment/line normalization after decoding; an entity may
  // itself spell a comment opener or a grammar newline outside a label.
  return normalizeMermaidSource(hybrid).familyLines
}

/** Split the authored Pie title suffix from the directive grammar, even when
 * XML references spell whitespace or letters in the directive prefix. The
 * render waist may decode grammar, but it must not decode authored title text
 * before Pie's own entity preprocessor observes it. */
export function splitAuthoredPieTitleLine(
  line: string,
  kind: 'header' | 'body',
): { decodedPrefix: string; authoredTitle: string } | null {
  const decoded = decodeXML(line)
  const match = kind === 'header'
    ? decoded.match(/^(\s*pie\b(?:\s+showData\b)?\s+title)(\s+)(.+)$/i)
    : decoded.match(/^(\s*title)(\s+)(.+)$/i)
  if (!match) return null
  const keywordEnd = match[1]!.length
  const whitespaceEnd = keywordEnd + match[2]!.length
  let decodedOffset = 0
  let authoredOffset = 0
  const nextToken = (): { text: string; length: number; entity: boolean } => {
    let token = line[authoredOffset]!
    let tokenLength = 1
    if (token === '&') {
      const entity = line.slice(authoredOffset).match(/^&(?:#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/i)?.[0]
      if (entity) {
        const projected = decodeXML(entity)
        if (projected !== entity) {
          token = projected
          tokenLength = entity.length
        }
      }
    }
    return { text: token, length: tokenLength, entity: tokenLength > 1 }
  }
  while (decodedOffset < keywordEnd && authoredOffset < line.length) {
    const token = nextToken()
    if (decoded.slice(decodedOffset, decodedOffset + token.text.length) !== token.text) return null
    decodedOffset += token.text.length
    authoredOffset += token.length
  }
  if (decodedOffset !== keywordEnd) return null
  let hasSeparator = false
  while (decodedOffset < whitespaceEnd && authoredOffset < line.length) {
    const token = nextToken()
    // Once grammar has a separator, an entity-produced space is title text.
    // Mermaid's preprocessor holds that entity as a marker until after Pie
    // grammar parses the title, even though decodeXML makes it look like space.
    if (token.entity && hasSeparator) break
    if (!/^\s+$/u.test(token.text)) return null
    decodedOffset += token.text.length
    authoredOffset += token.length
    hasSeparator = true
  }
  if (!hasSeparator) return null
  return { decodedPrefix: decoded.slice(0, decodedOffset), authoredTitle: line.slice(authoredOffset) }
}
