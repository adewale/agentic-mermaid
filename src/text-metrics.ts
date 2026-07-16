// ============================================================================
// Text Metrics — Variable-width character measurement for SVG layout
// ============================================================================
//
// Provides font-agnostic text width estimation using character class buckets.
// More accurate than uniform character width for proportional fonts.
//
// Width ratios are normalized where 1.0 = average lowercase letter.
// Final pixel width = sum(charWidths) * fontSize * baseRatio
//
// CJK / emoji / combining-mark codepoint range tables live in
// src/shared/unicode-ranges.ts (shared with the ASCII renderer so both
// modules agree on which codepoints are wide).
// ============================================================================

import { isWideRange, isZeroWidth, VS_EMOJI, VS_TEXT } from './shared/unicode-ranges.ts'
import { HAS_FORMAT_TAGS, parseInlineFormatting } from './shared/inline-format.ts'
import { graphemes } from './shared/graphemes.ts'

/**
 * Narrow characters - visually thin glyphs.
 * Note: '1' is included because in proportional fonts (like Inter), it's
 * significantly narrower than other digits which use tabular/uniform width.
 */
const NARROW_CHARS = new Set(['i', 'l', 't', 'f', 'j', 'I', '1', '!', '|', '.', ',', ':', ';', "'"])

/**
 * Wide characters - visually wide glyphs
 */
const WIDE_CHARS = new Set(['W', 'M', 'w', 'm', '@', '%'])

/**
 * Very wide characters - widest Latin glyphs
 */
const VERY_WIDE_CHARS = new Set(['W', 'M'])

/**
 * Semi-narrow punctuation - brackets and slashes are narrower than letters
 * but wider than narrow chars like dots/commas
 */
const SEMI_NARROW_PUNCT = new Set(['(', ')', '[', ']', '{', '}', '/', '\\', '-', '"', '`'])

// Combining-mark / zero-width and CJK-fullwidth checks delegate to the
// shared range tables so the ASCII renderer and the SVG metrics module
// can never drift on what counts as wide / zero-width.
function isCombiningMark(code: number): boolean {
  return isZeroWidth(code) || code === VS_TEXT || code === VS_EMOJI
}

function isFullwidth(code: number): boolean {
  return isWideRange(code)
}

/**
 * Regex for emoji detection using Unicode property escapes.
 * Uses Emoji_Presentation and Extended_Pictographic (not just Emoji)
 * because \p{Emoji} includes digits and # which we don't want as fullwidth.
 */
const EMOJI_REGEX = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u

/**
 * Check if a character is an emoji (fullwidth)
 */
function isEmoji(char: string): boolean {
  return EMOJI_REGEX.test(char)
}

/**
 * Get the relative width of a single character.
 *
 * Returns a normalized width ratio where:
 * - 0.0 = zero-width (combining marks)
 * - 0.3 = space
 * - 0.4 = narrow (i, l, t, f, j, I, 1)
 * - 0.8 = semi-narrow (r)
 * - 1.0 = average lowercase
 * - 1.2 = wide lowercase / uppercase
 * - 1.5 = very wide (W, M)
 * - 2.0 = fullwidth (CJK, emoji)
 */
export function getCharWidth(char: string): number {
  const code = char.codePointAt(0)
  if (code === undefined) return 0

  // Zero-width: combining diacritical marks
  if (isCombiningMark(code)) return 0

  // Fullwidth: CJK, emoji
  if (isFullwidth(code) || isEmoji(char)) return 2.0

  // Space
  if (char === ' ') return 0.3

  // Very wide Latin
  if (VERY_WIDE_CHARS.has(char)) return 1.5

  // Wide Latin
  if (WIDE_CHARS.has(char)) return 1.2

  // Narrow Latin
  if (NARROW_CHARS.has(char)) return 0.4

  // Semi-narrow punctuation (brackets, slashes, hyphens)
  if (SEMI_NARROW_PUNCT.has(char)) return 0.5

  // Semi-narrow letter
  if (char === 'r') return 0.8

  // Uppercase (slightly wider than lowercase on average)
  if (code >= 65 && code <= 90) return 1.2

  // Digits (uniform width in most fonts)
  if (code >= 48 && code <= 57) return 1.0

  // Default: average lowercase width
  return 1.0
}

/**
 * Measure the pixel width of a text string.
 *
 * Uses character class buckets for more accurate width estimation
 * than uniform character width assumptions.
 *
 * @param text - The text to measure
 * @param fontSize - Font size in pixels
 * @param fontWeight - Font weight (affects width slightly)
 * @returns Estimated width in pixels
 */
export interface TextMeasurementContract {
  version: 3
  unit: 'px'
  fontCalibration: 'Inter-compatible proportional estimate'
  monospaceCalibration: '0.6em-per-cell'
  wideCodepoints: 'src/shared/unicode-ranges.ts'
  emojiDetection: 'Emoji_Presentation-or-Extended_Pictographic'
  ambiguousWidth: 'single-cell'
  paintedAdvanceProjection: 'svg-textLength-spacingAndGlyphs'
  naturalAdvanceExemptions: 'none'
}

export const TEXT_MEASUREMENT_CONTRACT: TextMeasurementContract = {
  version: 3,
  unit: 'px',
  fontCalibration: 'Inter-compatible proportional estimate',
  monospaceCalibration: '0.6em-per-cell',
  wideCodepoints: 'src/shared/unicode-ranges.ts',
  emojiDetection: 'Emoji_Presentation-or-Extended_Pictographic',
  ambiguousWidth: 'single-cell',
  paintedAdvanceProjection: 'svg-textLength-spacingAndGlyphs',
  naturalAdvanceExemptions: 'none',
}

export interface TextMeasurementInput {
  text: string
  fontSize: number
  fontWeight: number
}

export interface TextMeasurementResult {
  contract: TextMeasurementContract
  width: number
  charWidthUnits: number
  codePointCount: number
  fontSize: number
  fontWeight: number
  baseRatio: number
  minPadding: number
}

function textBaseRatio(fontWeight: number): number {
  // Base ratio calibrated for Inter font family.
  // Heavier weights are slightly wider.
  // Includes the +0.02 buffer that prevents edge truncation at line ends.
  return fontWeight >= 600 ? 0.60 : fontWeight >= 500 ? 0.57 : 0.54
}

export function measureText(input: TextMeasurementInput): TextMeasurementResult {
  const baseRatio = textBaseRatio(input.fontWeight)
  let charWidthUnits = 0
  let codePointCount = 0
  // Iterate over code points (handles surrogate pairs for emoji/CJK)
  for (const char of input.text) {
    charWidthUnits += getCharWidth(char)
    codePointCount++
  }
  const minPadding = input.fontSize * 0.15
  return {
    contract: TEXT_MEASUREMENT_CONTRACT,
    width: charWidthUnits * input.fontSize * baseRatio + minPadding,
    charWidthUnits,
    codePointCount,
    fontSize: input.fontSize,
    fontWeight: input.fontWeight,
    baseRatio,
    minPadding,
  }
}

export function measureTextWidth(text: string, fontSize: number, fontWeight: number): number {
  return measureText({ text, fontSize, fontWeight }).width
}

/**
 * Measure text that must remain contained when an offline/CSP-safe SVG falls
 * back from Inter to a wider system font. Inter and DejaVu browser probes put
 * W/M at up to 1.10em at weight 700; 1.85 width units reserve 1.11em while
 * leaving the shared Inter-calibrated contract unchanged for other families.
 */
export function measureSystemFontSafeTextWidth(text: string, fontSize: number, fontWeight: number): number {
  const measured = measureText({ text, fontSize, fontWeight })
  let extraVeryWideUnits = 0
  for (const char of text) {
    if (VERY_WIDE_CHARS.has(char)) extraVeryWideUnits += 1.85 - 1.5
  }
  return measured.width + extraVeryWideUnits * fontSize * measured.baseRatio
}

/** Measure normalized inline formatting with the actual weight of each run.
 * Italic/decorations do not materially change this estimator's advance width;
 * bold runs use at least weight 700. */
/** Deterministic advance for code-like monospace runs. One ordinary
 * grapheme occupies 0.6em; CJK/emoji graphemes occupy two cells. */
export function measureMonospaceTextWidth(
  text: string,
  fontSize: number,
  letterSpacing = 0,
): number {
  const clusters = graphemes(text)
  let cells = 0
  for (const cluster of clusters) {
    let width = 0
    for (const char of cluster) {
      const code = char.codePointAt(0)
      if (code === undefined || isCombiningMark(code)) continue
      width = Math.max(width, isFullwidth(code) || isEmoji(char) ? 2 : 1)
    }
    cells += width
  }
  const tracking = Math.max(0, clusters.length - 1) * letterSpacing
  return Math.max(0, cells * fontSize * 0.6 + tracking)
}

export function measureFormattedTextWidth(
  text: string,
  fontSize: number,
  fontWeight: number,
  letterSpacing = 0,
): number {
  const segments = HAS_FORMAT_TAGS.test(text) ? parseInlineFormatting(text) : [{ text, bold: false }]
  const glyphText = segments.map(segment => segment.text).join('')
  const tracking = Math.max(0, graphemes(glyphText).length - 1) * letterSpacing
  const measured = segments.reduce((width, segment) =>
    width + measureTextWidth(segment.text, fontSize, segment.bold ? Math.max(700, fontWeight) : fontWeight), 0)
  return Math.max(0, measured + tracking)
}

// ============================================================================
// Multi-line Text Measurement
// ============================================================================

/** Standard line height ratio for multi-line text (1.3 = 130% of font size) */
export const LINE_HEIGHT_RATIO = 1.3

/** Metrics for multi-line text measurement */
export interface MultilineMetrics {
  /** Maximum line width in pixels */
  width: number
  /** Total height in pixels (lines × lineHeight) */
  height: number
  /** Individual lines after splitting */
  lines: string[]
  /** Computed line height in pixels */
  lineHeight: number
}

/**
 * Measure multi-line text dimensions.
 *
 * Splits text on newlines and returns the maximum width across all lines,
 * total height based on line count, and the split lines for rendering.
 *
 * @param text - The text to measure (may contain \n)
 * @param fontSize - Font size in pixels
 * @param fontWeight - Font weight (affects width slightly)
 * @param letterSpacing - CSS/SVG tracking applied between rendered grapheme clusters
 * @returns Metrics including width, height, lines array, and lineHeight
 */
export function measureMultilineText(
  text: string,
  fontSize: number,
  fontWeight: number,
  letterSpacing = 0,
): MultilineMetrics {
  const lines = text.split('\n')
  const lineHeight = fontSize * LINE_HEIGHT_RATIO

  // Width = max of all line widths
  let maxWidth = 0
  for (const line of lines) {
    const w = measureFormattedTextWidth(line, fontSize, fontWeight, letterSpacing)
    if (w > maxWidth) maxWidth = w
  }

  return {
    width: maxWidth,
    height: lines.length * lineHeight,
    lines,
    lineHeight,
  }
}
