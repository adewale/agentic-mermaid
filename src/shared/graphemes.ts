// Unicode extended-grapheme segmentation shared by pixel and terminal wraps.
// Intl.Segmenter follows UAX #29 and is deterministic for grapheme boundaries.
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Split text without separating ZWJ emoji, modifiers, or combining marks. */
export function graphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), segment => segment.segment)
}
