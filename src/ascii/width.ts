// ============================================================================
// Terminal display width helpers for ASCII/Unicode rendering.
// ============================================================================

/** Sentinel stored in the canvas cell following a fullwidth character. */
export const WIDE_CHAR_CONTINUATION = '\x00'

export function charVisualWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  // Combining marks occupy no extra terminal cell.
  if (code >= 0x0300 && code <= 0x036f) return 0
  // East Asian wide/fullwidth ranges plus common emoji presentation ranges.
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2329 && code <= 0x232a) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    code >= 0x20000
  ) return 2
  return 1
}

export function visualWidth(text: string): number {
  let width = 0
  for (const ch of text) width += charVisualWidth(ch)
  return width
}
