/**
 * The lazy browser build's stand-in for ./html-entity-table.ts, with the same
 * exports: the ~23 KB gzip HTML5 table is fetched only when a diagram displays
 * a named code beyond the five XML names. Displaying one first throws
 * HtmlEntityTableNotLoadedError, whose loader renderLoadedFamilySvg awaits
 * before rendering again. Only the entity display imports this module, so it
 * adds no request of its own.
 */

let decodeHTML: ((reference: string) => string) | undefined

async function loadHtmlEntityTable(): Promise<void> {
  const loaded = await import('entities/decode')
  // The lazy build aliases entities/decode to its CommonJS file, whose
  // dynamic import carries the exports as `default`.
  decodeHTML ??= loaded.decodeHTML ?? (loaded as unknown as { default: typeof loaded }).default.decodeHTML
}

export class HtmlEntityTableNotLoadedError extends Error {
  readonly loadHtmlEntityTable: () => Promise<void>

  constructor(reference: string, loadHtmlEntityTable: () => Promise<void>) {
    super(`${reference} needs the HTML entity table, which has not loaded`)
    this.loadHtmlEntityTable = loadHtmlEntityTable
  }
}

export function decodeHtmlEntityReference(reference: string): string {
  if (!decodeHTML) throw new HtmlEntityTableNotLoadedError(reference, loadHtmlEntityTable)
  return decodeHTML(reference)
}
