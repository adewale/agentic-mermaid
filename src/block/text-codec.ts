import { encodeMermaidAuthoredEntities } from '../shared/mermaid-entities.ts'

/** Normalize only grammar escapes that cannot introduce a formatting tag or
 * line break. Keep every other entity authored until display interpretation:
 * #lt;b#gt; must never become a bold marker. One pass also keeps #35;37; as
 * literal entity-looking text. */
export function readBlockText(authored: string): string {
  return authored.replace(/#(?:quot|0*(?:34|37|96));/g, token => token === '#quot;' ? '"' : String.fromCodePoint(Number(token.slice(1, -1))))
}

export function writeBlockText(authored: string): string {
  // Percent signs protect Mermaid's pre-grammar directive scanner; a leading
  // backtick would select the separate Markdown string token.
  return encodeMermaidAuthoredEntities(authored, '"%`')
}
