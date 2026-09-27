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
    ? decoded.match(/^(\s*pie\b(?:\s+showData\b)?\s+title\s+)(.+)$/i)
    : decoded.match(/^(\s*title\s+)(.+)$/i)
  if (!match) return null
  const decodedPrefix = match[1]!
  let decodedOffset = 0
  let authoredOffset = 0
  while (decodedOffset < decodedPrefix.length && authoredOffset < line.length) {
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
    if (decodedPrefix.slice(decodedOffset, decodedOffset + token.length) !== token) return null
    decodedOffset += token.length
    authoredOffset += tokenLength
  }
  if (decodedOffset !== decodedPrefix.length) return null
  return { decodedPrefix, authoredTitle: line.slice(authoredOffset) }
}
