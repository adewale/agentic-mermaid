// ============================================================================
// Shared Unicode range tables.
//
// Both the ASCII renderer (src/ascii/width.ts) and the SVG text-metrics
// module (src/text-metrics.ts) need to know which codepoints are wide
// (CJK), which are emoji, and which are zero-width (combining marks,
// ZWJ, variation selectors). Cross-importing between ascii/ and core
// would violate the substrate lint (ascii should not pull core; core
// should not pull ascii). This neutral module is the shared substrate.
//
// Conventions:
//   - Ranges are inclusive [start, end] pairs of codepoints.
//   - Helpers operate on codepoint integers, not string chars, so callers
//     can iterate via `for ... of` (which yields codepoints, not UTF-16
//     code units) and pass the result of `String.prototype.codePointAt`.
// ============================================================================

export type CodepointRange = readonly [number, number]

// ----------------------------------------------------------------------------
// CJK + Hangul ranges — fullwidth in terminals and 2x width in proportional
// fonts. Sourced from Unicode East Asian Width Wide/Fullwidth ranges plus
// CJK Unified Ideographs and related supplements.
// ----------------------------------------------------------------------------
export const CJK_RANGES: readonly CodepointRange[] = [
  [0x2e80, 0x2eff], // CJK Radicals Supplement
  [0x2f00, 0x2fdf], // Kangxi Radicals
  [0x3000, 0x303f], // CJK Symbols and Punctuation
  [0x3040, 0x309f], // Hiragana
  [0x30a0, 0x30ff], // Katakana
  [0x3100, 0x312f], // Bopomofo
  [0x3190, 0x31ff], // Kanbun + extensions
  [0x3200, 0x33ff], // Enclosed CJK + Compatibility
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0x20000, 0x2ffff], // CJK Extension B and beyond
]

// ----------------------------------------------------------------------------
// Hangul ranges — Korean syllabic block. Separate from CJK_RANGES so callers
// can distinguish Korean from Han characters when needed (e.g., font shaping).
// ----------------------------------------------------------------------------
export const HANGUL_RANGES: readonly CodepointRange[] = [
  [0x1100, 0x115f], // Hangul Jamo (leading)
  [0x3130, 0x318f], // Hangul Compatibility Jamo
  [0xac00, 0xd7af], // Hangul Syllables
]

// ----------------------------------------------------------------------------
// Fullwidth ASCII and symbol ranges — the U+FF00 block plus angle brackets
// and a few other "halfwidth-and-fullwidth forms" that render as 2 cells.
// ----------------------------------------------------------------------------
export const FULLWIDTH_RANGES: readonly CodepointRange[] = [
  [0x2329, 0x232a], // Angle brackets
  [0xfe10, 0xfe19], // Vertical forms
  [0xfe30, 0xfe6f], // CJK Compatibility Forms + Small Form Variants
  [0xff00, 0xff60], // Fullwidth ASCII
  [0xffe0, 0xffe6], // Fullwidth symbols
]

// ----------------------------------------------------------------------------
// Emoji presentation ranges — the SMP planes where emoji live by default.
// The Unicode regex `\p{Emoji_Presentation}|\p{Extended_Pictographic}` is a
// more precise check for individual characters; these ranges are useful for
// fast codepoint-integer checks and for callers that cannot afford a regex.
// ----------------------------------------------------------------------------
export const EMOJI_RANGES: readonly CodepointRange[] = [
  [0x1f300, 0x1faff], // Misc Symbols & Pictographs through Symbols & Pictographs Extended-A
]

// ----------------------------------------------------------------------------
// Combining-mark and zero-width ranges. Iterating codepoints and treating
// these as width 0 keeps display-width math correct for accented Latin and
// Devanagari/Arabic shaping marks.
// ----------------------------------------------------------------------------
export const COMBINING_RANGES: readonly CodepointRange[] = [
  [0x0300, 0x036f], // Combining Diacritical Marks
  [0x1ab0, 0x1aff], // Combining Diacritical Marks Extended
  [0x1dc0, 0x1dff], // Combining Diacritical Marks Supplement
  [0x20d0, 0x20ff], // Combining Diacritical Marks for Symbols
  [0xfe20, 0xfe2f], // Combining Half Marks
]

// ----------------------------------------------------------------------------
// Special zero-width codepoints. Separate from COMBINING_RANGES because they
// have semantic meaning beyond "no advance":
//   - U+200B  ZERO WIDTH SPACE
//   - U+200C  ZERO WIDTH NON-JOINER
//   - U+200D  ZERO WIDTH JOINER (binds emoji into sequences)
//   - U+FEFF  ZERO WIDTH NO-BREAK SPACE / BOM
// ----------------------------------------------------------------------------
export const ZERO_WIDTH_CODEPOINTS: ReadonlySet<number> = new Set([
  0x200b, 0x200c, 0x200d, 0xfeff,
])

// ----------------------------------------------------------------------------
// Variation selectors — modify the preceding base codepoint:
//   - U+FE0E  Text-presentation selector (force width 1)
//   - U+FE0F  Emoji-presentation selector (force width 2)
// ----------------------------------------------------------------------------
export const VS_TEXT = 0xfe0e
export const VS_EMOJI = 0xfe0f
export const ZWJ = 0x200d

// ----------------------------------------------------------------------------
// Range-membership helpers.
// ----------------------------------------------------------------------------

function inRanges(cp: number, ranges: readonly CodepointRange[]): boolean {
  for (const [lo, hi] of ranges) if (cp >= lo && cp <= hi) return true
  return false
}

/**
 * Is the codepoint wide (CJK / Hangul / Fullwidth / Emoji)?
 *
 * Note: emoji ZWJ sequences and variation selectors are NOT handled here —
 * the caller (visualWidth) must apply them on top of this base check.
 */
export function isWideRange(cp: number): boolean {
  return (
    inRanges(cp, CJK_RANGES) ||
    inRanges(cp, HANGUL_RANGES) ||
    inRanges(cp, FULLWIDTH_RANGES) ||
    inRanges(cp, EMOJI_RANGES)
  )
}

/**
 * Is the codepoint zero-width (combining mark or a special ZWS/ZWJ/BOM)?
 */
export function isZeroWidth(cp: number): boolean {
  return inRanges(cp, COMBINING_RANGES) || ZERO_WIDTH_CODEPOINTS.has(cp)
}
