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

import { measureTextWidth } from '../text-metrics.ts'
import { stripFormattingTags } from '../multiline-utils.ts'
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
): string {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return text
  if (measureTextWidth(stripFormattingTags(text), fontSize, fontWeight) <= maxWidth) return text

  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (measureTextWidth(stripFormattingTags(candidate), fontSize, fontWeight) <= maxWidth) {
        current = candidate
        continue
      }
      if (current) lines.push(current)
      current = breakWordToWidth(word, maxWidth, fontSize, fontWeight)
    }
    if (current) lines.push(current)
  }
  return lines.join('\n')
}

export function breakWordToWidth(word: string, maxWidth: number, fontSize: number, fontWeight: number): string {
  if (measureTextWidth(stripFormattingTags(word), fontSize, fontWeight) <= maxWidth) return word
  const lines: string[] = []
  let current = ''
  let previousCluster = ''
  for (const cluster of graphemes(word)) {
    const candidate = current + cluster
    if (current && measureTextWidth(stripFormattingTags(candidate), fontSize, fontWeight) > maxWidth) {
      // A hyphen marks a mid-word break in alphabetic scripts; CJK, emoji,
      // and other fullwidth grapheme clusters break without one.
      const breakIsFullwidth = isFullwidthChar(previousCluster) && isFullwidthChar(cluster)
      lines.push(breakIsFullwidth ? current : `${current}-`)
      current = cluster
    } else {
      current = candidate
    }
    previousCluster = cluster
  }
  if (current) lines.push(current)
  return lines.join('\n')
}

export function isFullwidthChar(char: string): boolean {
  return /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1FAFF}\u{20000}-\u{2FA1F}]|\p{Extended_Pictographic}|\uFE0F|\u200D/u.test(char)
}
