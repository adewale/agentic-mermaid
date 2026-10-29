import { preservedMermaidFamilyText, type NormalizedMermaidSource } from '../mermaid-source.ts'
import { parseAccessibilityDirective } from '../shared/accessibility-directives.ts'

/** CSV identities retain lone CR inside quoted fields. Coalesce quoted
 * records here, normalizing their CRLF to LF, so the physical-row parser
 * cannot mistake a retained payload CR for another line terminator.
 * Read the shared XML-decoded view so transport decoding still happens once. */
export function sankeyFamilyLines(source: NormalizedMermaidSource): string[] {
  const body = preservedMermaidFamilyText(source)
  if (!body.includes('\r')) return body.split('\n')
  // The shared payload view already normalized original CRLF pairs. A CR
  // adjacent to LF here is retained payload, so do not collapse it again.
  const physicalLines = body.split(/\r|\n/)
  const endings = body.match(/\r|\n/g) ?? []
  const lines: string[] = []
  let line = ''
  let continuedRows = 0
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
    if (quoted && endings[index] !== undefined) {
      line += endings[index] === '\r' ? '\r' : '\n'
      continuedRows++
    }
    else {
      lines.push(line)
      // The CSV parser reports physical row numbers. Placeholders keep later
      // records at their original rows after a quoted record was coalesced.
      while (continuedRows > 0) { lines.push(''); continuedRows-- }
      line = ''
    }
  }
  return lines
}
