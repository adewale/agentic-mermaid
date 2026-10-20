import { stripMermaidInitDirectives, type NormalizedMermaidSource } from '../mermaid-source.ts'
import { parseAccessibilityDirective } from '../shared/accessibility-directives.ts'
import { cleanedMermaidOffset, originalMermaidOffset } from '../shared/mermaid-cleanup.ts'

/** CSV identities retain lone CR inside quoted fields. Structural CR and
 * CRLF are line endings; the parser rejoins quoted physical rows with LF.
 * Read the shared XML-decoded view so transport decoding still happens once. */
export function sankeyFamilyLines(source: NormalizedMermaidSource): string[] {
  const cleanup = source.cleanup
  const wrapperLength = source.wrapperSource?.length ?? 0
  // XML may itself spell the wrapper. In that case its captured prefix is in
  // the render view, while an unchanged grammar keeps the exact authored prefix.
  const authoredStart = cleanup && source.authoredWrapperLength !== undefined
    ? originalMermaidOffset(cleanup, wrapperLength, 'end', 'text')
    : wrapperLength
  const start = cleanup ? cleanedMermaidOffset(cleanup, authoredStart, 'end', 'decodedText') : authoredStart
  const body = stripMermaidInitDirectives((cleanup?.decodedText ?? source.originalText).slice(start))
  if (!body.includes('\r')) return body.split('\n')
  const physicalLines = body.split(/\r\n?|\n/)
  const endings = body.match(/\r\n?|\n/g) ?? []
  const lines: string[] = []
  let line = ''
  let quoted = false
  let directiveEnd = -1
  for (let index = 0; index < physicalLines.length; index++) {
    const text = physicalLines[index]!
    line += text
    if (!quoted && index > directiveEnd) {
      if (text.trimStart().startsWith('%%')) directiveEnd = index
      else {
        const directive = parseAccessibilityDirective(physicalLines, index)
        if (directive) directiveEnd = directive.endIndex
        else if (directive === undefined) directiveEnd = physicalLines.length - 1
      }
    }
    if (index > directiveEnd) {
      for (let offset = 0; offset < text.length; offset++) {
        if (text[offset] !== '"') continue
        if (quoted && text[offset + 1] === '"') offset++
        else quoted = !quoted
      }
    }
    if (endings[index] === '\r' && quoted) line += '\r'
    else {
      lines.push(line)
      line = ''
    }
  }
  return lines
}
