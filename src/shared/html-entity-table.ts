/**
 * The HTML5 named-reference table behind Mermaid entity codes such as
 * `#hearts;` (the five XML names resolve without it; see
 * ./mermaid-entity-display.ts). Synchronous entry points load it with the code
 * that displays entities. The lazy browser build swaps this module for
 * ./html-entity-table.lazy.ts (tsup.browser-lazy.config.ts), which fetches the
 * table only when a diagram displays another named code.
 */

import { decodeHTML } from 'entities/decode'

/** Thrown by the lazy build when a named code is displayed before the table
 * has loaded. It carries the loader, so a caller can load and render again. */
export class HtmlEntityTableNotLoadedError extends Error {
  constructor(reference: string, readonly loadHtmlEntityTable: () => Promise<void>) {
    super(`${reference} needs the HTML entity table, which has not loaded`)
  }
}

/** Resolve `&name;` against the full HTML5 table, legacy prefix matches included. */
export function decodeHtmlEntityReference(reference: string): string {
  return decodeHTML(reference)
}
