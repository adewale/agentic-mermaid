// Unicode extended-grapheme segmentation shared by pixel and terminal wraps.
// Intl.Segmenter follows UAX #29 and is deterministic for grapheme boundaries.
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
// Printable ASCII has no Extend, ZWJ, SpacingMark, Prepend or Regional
// Indicator characters, and UAX #29 joins only CR LF, which it excludes: every
// code unit is its own cluster. Most labels take this path, and segmenting
// them through ICU dominated typed parse time.
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/

/** Split text without separating ZWJ emoji, modifiers, or combining marks. */
export function graphemes(text: string): string[] {
  if (PRINTABLE_ASCII.test(text)) return text.split('')
  return Array.from(graphemeSegmenter.segment(text), segment => segment.segment)
}
