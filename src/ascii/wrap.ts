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

import { visualWidth } from './width.ts'

/** Options for wrapText/wrapParagraph/breakWord. */
export interface WrapOptions {
  /**
   * Append '-' where a word is broken mid-line (suppressed between
   * double-width clusters, and when the hyphen itself would not fit).
   * Default: true. Glyph strips (e.g. the journey score strip) disable it.
   */
  hyphenate?: boolean
}

/** Grapheme segmentation is locale-independent (UAX #29), so this is deterministic. */
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Split a string into grapheme clusters (emoji ZWJ sequences stay whole). */
export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), s => s.segment)
}

/**
 * Wrap text to at most `maxWidth` display cells per line. Embedded '\n' are
 * hard breaks. Without a positive finite maxWidth, only splits on '\n'.
 */
export function wrapText(text: string, maxWidth: number | undefined, options?: WrapOptions): string[] {
  if (!maxWidth || !Number.isFinite(maxWidth) || maxWidth <= 0) return text.split('\n')
  const limit = Math.max(1, Math.floor(maxWidth))
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    lines.push(...wrapParagraph(paragraph, limit, options))
  }
  return lines.length > 0 ? lines : ['']
}

/**
 * Wrap a single paragraph (no '\n') at word boundaries by display width.
 * Words wider than maxWidth are broken by `breakWord`.
 */
export function wrapParagraph(text: string, maxWidth: number, options?: WrapOptions): string[] {
  if (visualWidth(text) <= maxWidth) return [text]
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']

  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (!current) {
      const chunks = breakWord(word, maxWidth, options)
      lines.push(...chunks.slice(0, -1))
      current = chunks[chunks.length - 1] ?? ''
      continue
    }

    const candidate = `${current} ${word}`
    if (visualWidth(candidate) <= maxWidth) {
      current = candidate
      continue
    }

    lines.push(current)
    const chunks = breakWord(word, maxWidth, options)
    lines.push(...chunks.slice(0, -1))
    current = chunks[chunks.length - 1] ?? ''
  }
  if (current) lines.push(current)
  return lines
}

/**
 * Break a single word into chunks of at most maxWidth cells. Greedy over
 * grapheme clusters: each line takes as many whole clusters as fit,
 * reserving one cell for the trailing hyphen when its break needs one.
 * A cluster wider than maxWidth still gets emitted alone (nothing narrower
 * exists to emit), matching the pre-grapheme behavior.
 */
export function breakWord(word: string, maxWidth: number, options?: WrapOptions): string[] {
  if (visualWidth(word) <= maxWidth) return [word]
  const hyphenate = options?.hyphenate ?? true
  const clusters = graphemes(word)
  const lines: string[] = []
  let start = 0
  while (start < clusters.length) {
    let end = start + 1 // always consume at least one cluster per line
    while (end < clusters.length && fitsWithBreak(clusters, start, end + 1, maxWidth, hyphenate)) end++
    const chunk = clusters.slice(start, end).join('')
    const hyphen = end < clusters.length
      && breakNeedsHyphen(clusters[end - 1]!, clusters[end]!, hyphenate)
      && visualWidth(chunk) + 1 <= maxWidth
    lines.push(hyphen ? `${chunk}-` : chunk)
    start = end
  }
  return lines
}

/** Would clusters[start..end) fit in maxWidth, counting the hyphen its break would need? */
function fitsWithBreak(
  clusters: string[],
  start: number,
  end: number,
  maxWidth: number,
  hyphenate: boolean,
): boolean {
  const width = visualWidth(clusters.slice(start, end).join(''))
  const hyphen = end < clusters.length && breakNeedsHyphen(clusters[end - 1]!, clusters[end]!, hyphenate) ? 1 : 0
  return width + hyphen <= maxWidth
}

/**
 * A mid-word break takes a hyphen unless it falls between two double-width
 * clusters (CJK, fullwidth forms, emoji), where hyphenation is not a text
 * convention.
 */
function breakNeedsHyphen(before: string, after: string, hyphenate: boolean): boolean {
  if (!hyphenate) return false
  return !(visualWidth(before) === 2 && visualWidth(after) === 2)
}
