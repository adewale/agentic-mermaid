// ============================================================================
// Terminal display width helpers for ASCII/Unicode rendering.
//
// Range tables live in src/shared/unicode-ranges.ts so the SVG metrics
// module can share them without the ascii/ → core import that the
// substrate lint forbids.
// ============================================================================

import { isWideRange, isZeroWidth } from '../shared/unicode-ranges.ts'

/** Sentinel stored in the canvas cell following a fullwidth character. */
export const WIDE_CHAR_CONTINUATION = '\x00'

export function charVisualWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  if (isZeroWidth(code)) return 0
  if (isWideRange(code)) return 2
  return 1
}

export function visualWidth(text: string): number {
  let width = 0
  for (const ch of text) width += charVisualWidth(ch)
  return width
}
