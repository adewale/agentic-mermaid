// ============================================================================
// Terminal display width helpers for ASCII/Unicode rendering.
//
// Range tables live in src/shared/unicode-ranges.ts so the SVG metrics
// module can share them without the ascii/ → core import that the
// substrate lint forbids.
//
// Variation selectors (U+FE0E / U+FE0F) modify the WIDTH of the preceding
// base codepoint, so `visualWidth` does a two-pass tally rather than a
// per-codepoint sum: it remembers the last-emitted width and rewrites it
// when a selector arrives. ZWJ (U+200D) and FE0E both have width 0; FE0F
// forces the previous base to width 2.
// ============================================================================

import { isWideRange, isZeroWidth, VS_TEXT, VS_EMOJI, ZWJ } from '../shared/unicode-ranges.ts'

/** Sentinel stored in the canvas cell following a fullwidth character. */
export const WIDE_CHAR_CONTINUATION = '\x00'

/**
 * Width of a single codepoint, with no knowledge of neighbours.
 * Variation selectors are reported as zero-width here; the per-string
 * `visualWidth` applies the selector's retroactive width override.
 */
export function charVisualWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  if (code === VS_TEXT || code === VS_EMOJI || code === ZWJ) return 0
  if (isZeroWidth(code)) return 0
  if (isWideRange(code)) return 2
  return 1
}

/**
 * Terminal display width of a string, in cells.
 *
 * Iterates codepoints and applies these post-process rules:
 *   - FE0F  (emoji-presentation selector): force the preceding base to width 2
 *   - FE0E  (text-presentation selector):  force the preceding base to width 1
 *   - 200D  (ZWJ):                          zero width; binds the next base
 *           into an emoji ZWJ sequence — the next base is also forced to 0
 *           so a man-with-laptop (👨‍💻) totals 2 cells, not 4.
 */
export function visualWidth(text: string): number {
  let total = 0
  let lastBaseWidth = 0
  let zwjPending = false
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code === VS_EMOJI) {
      if (lastBaseWidth === 1) {
        total += 1
        lastBaseWidth = 2
      }
      continue
    }
    if (code === VS_TEXT) {
      if (lastBaseWidth === 2) {
        total -= 1
        lastBaseWidth = 1
      }
      continue
    }
    if (code === ZWJ) {
      zwjPending = true
      lastBaseWidth = 0
      continue
    }
    if (isZeroWidth(code)) {
      lastBaseWidth = 0
      continue
    }
    let w = isWideRange(code) ? 2 : 1
    if (zwjPending) {
      w = 0
      zwjPending = false
    }
    total += w
    lastBaseWidth = w
  }
  return total
}
