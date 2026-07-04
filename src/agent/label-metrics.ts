// ============================================================================
// Label display metrics — the LABEL_OVERFLOW cap measures what the renderer
// draws, not raw source characters. The render pipeline decodes XML entities
// (renderMermaidSVG runs decodeXML before parsing), converts <br> tags and
// literal \n to line breaks, and strips formatting tags before measuring text
// (multiline-utils.ts). Counting source chars instead flags legitimately-fine
// multi-line labels whose markup (`<br/>`, `&#160;`) pads the count.
// ============================================================================

import { decodeXML } from 'entities'
import { normalizeBrTags, stripFormattingTags } from '../multiline-utils.ts'
import type { LayoutWarning } from './types.ts'

/**
 * Length of a label as rendered: the longest line after entity decoding,
 * <br>/\n splitting, and formatting-tag stripping. `&#160;` counts as one
 * character; `<br/>` starts a new line and counts as zero.
 */
export function labelDisplayLength(label: string): number {
  const rendered = stripFormattingTags(normalizeBrTags(decodeXML(label)))
  return rendered.split('\n').reduce((max, line) => Math.max(max, line.length), 0)
}

/** Build a LABEL_OVERFLOW warning when the rendered length exceeds the cap, else null. */
export function labelOverflowWarning(target: string, text: string, cap: number): LayoutWarning | null {
  const charCount = labelDisplayLength(text)
  return charCount > cap ? { code: 'LABEL_OVERFLOW', target, charCount, limit: cap } : null
}
