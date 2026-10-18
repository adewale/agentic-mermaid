// ============================================================================
// ASCII renderer — width-aware text wrapping.
//
// Shared by the journey and timeline ASCII renderers. Wrapping iterates
// grapheme clusters (Intl.Segmenter) rather than codepoints and measures
// candidates with the whole-string `visualWidth`, so FE0F emoji count their
// display width (a per-codepoint sum sees ❤️ as 1 cell; it renders as 2)
// and ZWJ sequences (👩‍🔬) are never split mid-grapheme.
//
// Mid-word breaks follow the SVG layout's breakWordToWidth convention
// (src/journey/layout.ts): the continuing chunk takes a trailing '-',
// except when the break falls between two double-width clusters — CJK and
// fullwidth text wraps at any character without hyphenation.
// ============================================================================

import { prepareCellText } from './prepared-text.ts'
import type { DisplayTextInput } from '../shared/display-text.ts'

export { graphemes } from '../shared/graphemes.ts'

export interface WrapOptions { hyphenate?: boolean }

/** Compatibility entry point for already interpreted display text. */
export function wrapText(text: DisplayTextInput, maxWidth: number | undefined, options?: WrapOptions): string[] {
  return [...prepareCellText(text, { maxWidth, ...options }).lines]
}

export function wrapParagraph(text: string, maxWidth: number, options?: WrapOptions): string[] {
  return wrapText(text, maxWidth, options)
}

export function breakWord(word: string, maxWidth: number, options?: WrapOptions): string[] {
  return wrapText(word, maxWidth, options)
}
