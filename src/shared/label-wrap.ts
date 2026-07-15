// ============================================================================
// Shared measured-pixel label wrapping (SVG layouts).
//
// Extracted VERBATIM from src/journey/layout.ts (the wrapLabelToWidth
// precedent PR #141 established) so flowchart `wrappingWidth` reuses the same
// machinery instead of forking a fourth wrap implementation (P6). The ASCII
// renderers keep their cell-width sibling in src/ascii/wrap.ts — that module
// wraps by terminal display cells, this one by measured font pixels.
//
// Mid-word breaks take a trailing '-' in alphabetic scripts; CJK/fullwidth
// text breaks between any two characters without hyphenation.
// ============================================================================

import { measureFormattedTextWidth } from '../text-metrics.ts'
import { HAS_FORMAT_TAGS, parseInlineFormatting, serializeStyledSegment, type StyledSegment } from './inline-format.ts'
import { graphemes } from './graphemes.ts'

/**
 * Wrap `text` so no line measures wider than `maxWidth` px at the given font.
 * Embedded newlines are hard breaks; formatting tags (<b>, <i>, …) are
 * excluded from measurement but preserved in the output.
 */
export function wrapLabelToWidth(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontWeight: number,
  letterSpacing = 0,
): string {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return text
  if (measureFormattedTextWidth(text, fontSize, fontWeight, letterSpacing) <= maxWidth) return text

  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    if (HAS_FORMAT_TAGS.test(paragraph)) {
      lines.push(...wrapFormattedParagraph(paragraph, maxWidth, fontSize, fontWeight, letterSpacing))
      continue
    }
    const words = paragraph.split(/\s+/).filter(Boolean)
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (measureFormattedTextWidth(candidate, fontSize, fontWeight, letterSpacing) <= maxWidth) {
        current = candidate
        continue
      }
      if (current) lines.push(current)
      current = breakWordToWidth(word, maxWidth, fontSize, fontWeight, letterSpacing)
    }
    if (current) lines.push(current)
  }
  return lines.join('\n')
}

type StyledWord = StyledSegment[]

function styledWords(paragraph: string): StyledWord[] {
  const words: StyledWord[] = []
  let current: StyledWord = []
  for (const segment of parseInlineFormatting(paragraph)) {
    for (const part of segment.text.split(/(\s+)/)) {
      if (!part) continue
      if (/^\s+$/.test(part)) {
        if (current.length > 0) {
          words.push(current)
          current = []
        }
      } else {
        current.push({ ...segment, text: part })
      }
    }
  }
  if (current.length > 0) words.push(current)
  return words
}

function renderStyledWord(word: StyledWord): string {
  return word.map(serializeStyledSegment).join('')
}

function wrapFormattedParagraph(
  paragraph: string,
  maxWidth: number,
  fontSize: number,
  fontWeight: number,
  letterSpacing: number,
): string[] {
  const lines: string[] = []
  let current: string[] = []
  for (const word of styledWords(paragraph)) {
    const rendered = renderStyledWord(word)
    const candidate = [...current, rendered].join(' ')
    if (measureFormattedTextWidth(candidate, fontSize, fontWeight, letterSpacing) <= maxWidth) {
      current.push(rendered)
      continue
    }
    if (current.length > 0) lines.push(current.join(' '))
    current = []

    // Preserve formatting on ordinary long single-style words. Mixed-style
    // words are rare and stay intact rather than emitting malformed tags.
    if (word.length === 1 && measureFormattedTextWidth(rendered, fontSize, fontWeight, letterSpacing) > maxWidth) {
      const segment = word[0]!
      const broken = breakWordToWidth(
        segment.text,
        maxWidth,
        fontSize,
        segment.bold ? Math.max(700, fontWeight) : fontWeight,
        letterSpacing,
      ).split('\n')
      lines.push(...broken.slice(0, -1).map(text => serializeStyledSegment({ ...segment, text })))
      current = [serializeStyledSegment({ ...segment, text: broken.at(-1)! })]
    } else {
      current = [rendered]
    }
  }
  if (current.length > 0) lines.push(current.join(' '))
  return lines
}

export function breakWordToWidth(
  word: string,
  maxWidth: number,
  fontSize: number,
  fontWeight: number,
  letterSpacing = 0,
): string {
  if (measureFormattedTextWidth(word, fontSize, fontWeight, letterSpacing) <= maxWidth) return word
  const clusters = graphemes(word)
  const lines: string[] = []
  let start = 0
  while (start < clusters.length) {
    let current = ''
    let end = start
    while (end < clusters.length) {
      const cluster = clusters[end]!
      const candidate = current + cluster
      const hasMore = end < clusters.length - 1
      const next = clusters[end + 1] ?? ''
      const breakIsFullwidth = hasMore && isFullwidthChar(cluster) && isFullwidthChar(next)
      const measured = candidate + (hasMore && !breakIsFullwidth ? '-' : '')
      if (current && measureFormattedTextWidth(measured, fontSize, fontWeight, letterSpacing) > maxWidth) break
      current = candidate
      end++
    }

    // One unusually wide grapheme must still make progress. A hyphen is only
    // emitted when it also fits inside the promised line-width budget.
    if (end === start) {
      current = clusters[end]!
      end++
    }
    const hasMore = end < clusters.length
    const breakIsFullwidth = hasMore && isFullwidthChar(clusters[end - 1]!) && isFullwidthChar(clusters[end]!)
    const hyphenated = `${current}-`
    lines.push(hasMore && !breakIsFullwidth && measureFormattedTextWidth(hyphenated, fontSize, fontWeight, letterSpacing) <= maxWidth
      ? hyphenated
      : current)
    start = end
  }
  return lines.join('\n')
}

export function isFullwidthChar(char: string): boolean {
  return /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1FAFF}\u{20000}-\u{2FA1F}]|\p{Extended_Pictographic}|\uFE0F|\u200D/u.test(char)
}
