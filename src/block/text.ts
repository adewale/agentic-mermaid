import { normalizeBrTags } from '../multiline-utils.ts'
import { prepareDisplayText, replaceDisplayTextTokens, preparedDisplayTextValue } from '../shared/display-text.ts'
import { decodeHtmlEntityReference } from '../shared/html-entity-table.ts'
import { decodeMermaidEntities } from '../shared/mermaid-entity-display.ts'
import { TERMINAL_CONTROL_RE } from '../shared/mermaid-entities.ts'

/** Preserve the authored label in the Block body. Read formatting before entity
 * expansion so an encoded tag remains visible text rather than new markup. */
export function blockTextPlan(authored: string) {
  return replaceDisplayTextTokens(prepareDisplayText(normalizeBrTags(authored)), /&(?:#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);|#\w+;/g, token => {
    const value = token.startsWith('&') ? decodeHtmlEntityReference(token) : decodeMermaidEntities(token)
    if (TERMINAL_CONTROL_RE.test(value)) throw new SyntaxError('Block label entity must display printable text')
    return value
  })
}
export function blockDisplayText(authored: string): string {
  return preparedDisplayTextValue(blockTextPlan(authored))
}
