import { encodeMermaidEntities, toEntityMarkers } from '../shared/mermaid-entities.ts'
import { projectEntityMarkers } from '../shared/mermaid-entity-display.ts'

export type TimelineTextRole = 'title' | 'section' | 'period' | 'event' | 'accessibility'

/** Entity codes are opaque lexical text in Mermaid. Expand their display
 * value only after the statement and its fields have been identified. */
export function timelineLexicalLines(lines: readonly string[]): string[] {
  return lines.map(line => toEntityMarkers(line.trimStart()))
}

export function normalizeTimelineBreaks(value: string): string {
  return value.replace(/<br>/g, '\n')
}

export function readTimelineText(value: string, role: TimelineTextRole): string {
  const text = role === 'title' || role === 'accessibility' ? value : normalizeTimelineBreaks(value)
  return projectEntityMarkers(text, { subject: 'Timeline text entity', example: '2025 : #35;' })
}

/** A field's delimiters belong to the writer, never to its text value.
 * Line breaks in node labels use Timeline's one formatting token; encoded
 * tag-like text is decoded later and cannot introduce that token. */
export function writeTimelineText(value: string, role: TimelineTextRole): string {
  // The statement contributes its required separator; this second blank is
  // the SECTION token's non-colon payload, which the reader trims to empty.
  if (value === '' && role === 'section') return ' '
  if (!value.length) throw new Error(`Timeline ${role} text must be non-empty`)
  const nodeLabel = role === 'section' || role === 'period' || role === 'event'
  const reserved = '#&' + (nodeLabel ? ':<>' : '') + (role === 'accessibility' ? '{}' : '')
    + (value.includes('%%') || role === 'period' && value.startsWith('%') ? '%' : '')
  let text = nodeLabel
    ? value.split('\n').map(line => encodeMermaidEntities(line, reserved)).join('<br>')
    : encodeMermaidEntities(value, reserved)
  // These tokens can start an INITIAL-state statement. Shield their first
  // character so the grammar sees one period token in every list position.
  if (role === 'period' && /^(?:timeline\b|title(?:\s|$)|section(?:\s|$)|acc(?:Title|Descr)(?:\s|$|[:{]))/i.test(text)) {
    text = `#${text.codePointAt(0)!};${text.slice(1)}`
  }
  return text
}
