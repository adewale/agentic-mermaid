/**
 * The display half of Mermaid's entity codes (see ./mermaid-entities.ts):
 * what a marker shows once the browser resolves upstream's `&name;` /
 * `&#123;` output. Numeric codes and the five XML names resolve here; any
 * other name needs the full HTML5 table, which ./html-entity-table.ts holds so
 * the lazy browser build can fetch it only when a diagram uses one.
 *
 * Projection refuses a terminal control character (C0, DEL, C1): no entity
 * may smuggle one into SVG, ASCII or ANSI output. Authored raw controls are
 * the caller's concern; only entity-produced ones are refused here.
 */

import { decodeHtmlEntityReference } from './html-entity-table.ts'
import { ENTITY_MARKER_RE, TERMINAL_CONTROL_RE, toEntityMarkers, XML_NAMED_ENTITIES } from './mermaid-entities.ts'
import { syntaxError } from './syntax-error.ts'

const windows1252 = new TextDecoder('windows-1252')

/** How a refused projection is reported: the family's subject and example. */
export interface EntityRefusal {
  subject: string
  example: string
}

const DEFAULT_REFUSAL: EntityRefusal = { subject: 'Mermaid entity', example: '#35;' }

/**
 * Expand markers as the browser does: `ﬂ°°123¶ß` is `&#123;` (0, surrogates
 * and values past U+10FFFF give U+FFFD; 0x80–0x9F map through Windows-1252),
 * and `ﬂ°name¶ß` is `&name;` resolved against the full HTML5 table, legacy
 * prefix matches included (`#notit;` → `¬it;`). An unknown name stays
 * literal as `&name;`. Throws a syntax error for a terminal control.
 */
export function projectEntityMarkers(text: string, refusal: EntityRefusal = DEFAULT_REFUSAL): string {
  return text.replace(ENTITY_MARKER_RE, (_token, numeric: string | undefined, named: string | undefined) => {
    let decoded: string
    if (numeric !== undefined) {
      const codePoint = Number(numeric)
      decoded = codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? '\ufffd'
        : codePoint >= 0x80 && codePoint <= 0x9f
          ? windows1252.decode(Uint8Array.of(codePoint))
          : String.fromCodePoint(codePoint)
    } else {
      decoded = XML_NAMED_ENTITIES.get(named!) ?? decodeHtmlEntityReference(`&${named!};`)
    }
    if (TERMINAL_CONTROL_RE.test(decoded)) {
      throw syntaxError({
        what: `${refusal.subject} projects a terminal control character`,
        expectedForm: 'an entity that displays printable text',
        example: refusal.example,
      })
    }
    return decoded
  })
}

/** The text a label displays once upstream has read its entity codes. */
export function decodeMermaidEntities(text: string, refusal: EntityRefusal = DEFAULT_REFUSAL): string {
  return projectEntityMarkers(toEntityMarkers(text), refusal)
}

