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
