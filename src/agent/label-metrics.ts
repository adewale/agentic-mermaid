// ============================================================================
// Label display metrics — the LABEL_OVERFLOW cap measures what the renderer
// draws, not raw source characters. The render pipeline decodes XML entities
// (renderMermaidSVG runs decodeXML before parsing); a family then reads the
// label through the shared display interpretation (multiline-utils.ts
// displayText): formatted labels break at <br> and literal \n and drop their
// formatting tags, literal labels are drawn as written. Counting source chars
// instead flags legitimately-fine multi-line labels whose markup (`<br/>`,
// `&#160;`) pads the count.
// ============================================================================

import { decodeXML } from 'entities'
import { displayText, normalizeBrTags, normalizePlainLabel } from '../multiline-utils.ts'
import type { LayoutWarning } from './types.ts'

/** How a family's renderer reads label text: flowchart plain labels keep
 * `*`/`~` literal (`plain`); most families render markdown-lite emphasis;
 * Pie, Timeline, Gantt, XYChart, GitGraph and Radar draw labels as written
 * (`literal`), so `<br/>` and formatting tags count as characters there. */
export type LabelEmphasis = 'markdown-lite' | 'plain' | 'literal'

/**
 * Length of a label as rendered: the longest line after entity decoding and
 * the family's display interpretation. `&#160;` counts as one character; in a
 * formatted label `<br/>` starts a new line and counts as zero.
 */
export function labelDisplayLength(label: string, emphasis: LabelEmphasis = 'markdown-lite'): number {
  const decoded = decodeXML(label)
  const rendered = emphasis === 'literal'
    ? displayText(decoded, 'literal')
    : displayText(emphasis === 'plain' ? normalizePlainLabel(decoded) : normalizeBrTags(decoded))
  return rendered.split('\n').reduce((max, line) => Math.max(max, line.length), 0)
}

/** Build a LABEL_OVERFLOW warning when the rendered length exceeds the cap, else null. */
export function labelOverflowWarning(target: string, text: string, cap: number, emphasis?: LabelEmphasis): LayoutWarning | null {
  const charCount = labelDisplayLength(text, emphasis)
  return charCount > cap ? { code: 'LABEL_OVERFLOW', target, charCount, limit: cap } : null
}
