import { decodeXML } from 'entities'

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
