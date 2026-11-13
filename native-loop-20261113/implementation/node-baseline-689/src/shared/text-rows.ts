import type { PixelTextBlock } from './prepared-text.ts'

/** Prepared pixel rows, in authored order. Callers own labels, styling, wrapping
 * and placement of the stack; the same retained blocks size and paint each row. */
export function layoutTextRows<T extends { block: PixelTextBlock; reservedWidth?: number }>(
  items: readonly T[],
  options: { gap: number; top?: number; minRowHeight?: number; align?: 'start' | 'center'; trailingGap?: boolean },
): { width: number; height: number; bottom: number; rows: Array<{ item: T; top: number; height: number; textY: number }> } {
  let top = options.top ?? 0, width = 0, contentHeight = 0
  const rows = items.map(item => {
    const height = Math.max(options.minRowHeight ?? 0, item.block.height)
    const row = { item, top, height, textY: top + (options.align === 'start' ? item.block.height : height) / 2 }
    width = Math.max(width, item.block.width, item.reservedWidth ?? 0)
    contentHeight += height
    top += height + options.gap
    return row
  })
  const gaps = Math.max(0, items.length - (options.trailingGap ? 0 : 1))
  const bottom = top - (items.length && !options.trailingGap ? options.gap : 0)
  return { width, height: contentHeight + gaps * options.gap, bottom, rows }
}

/** Pack retained rows into at most two columns, reading across then down.
 * Families own wrapping and the leading artwork. Packing never remeasures text. */
export function layoutTextColumns<T extends { block: PixelTextBlock; reservedWidth?: number }>(
  items: readonly T[],
  options: { gap: number; columnGap: number; leadingWidth: number; maxWidth?: number; top?: number; minRowHeight?: number },
): { width: number; height: number; columns: 1 | 2; rows: Array<{ item: T; x?: number; top: number; height: number; textY: number }> } {
  const single = layoutTextRows(items, options)
  const one = { width: options.leadingWidth + single.width, height: single.height, columns: 1 as const, rows: single.rows }
  if (options.maxWidth === undefined || items.length < 4) return one
  const widths = [0, 0]
  for (const [index, item] of items.entries()) {
    if (item.block.lines.length !== 1) return one
    const column = index % 2
    widths[column] = Math.max(widths[column]!, options.leadingWidth + item.block.width, options.leadingWidth + (item.reservedWidth ?? 0))
  }
  const width = widths[0]! + options.columnGap + widths[1]!
  if (width > options.maxWidth + 0.01) return one
  const rows = []
  let top = options.top ?? 0, height = 0
  for (let index = 0; index < items.length; index += 2) {
    const pair = items.slice(index, index + 2)
    const rowHeight = Math.max(options.minRowHeight ?? 0, ...pair.map(item => item.block.height))
    for (const [column, item] of pair.entries()) rows.push({ item, x: column ? widths[0]! + options.columnGap : 0, top, height: rowHeight, textY: top + rowHeight / 2 })
    height += rowHeight
    top += rowHeight + options.gap
  }
  height += (Math.ceil(items.length / 2) - 1) * options.gap
  return height < single.height ? { width, height, columns: 2, rows } : one
}
