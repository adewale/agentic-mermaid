// ============================================================================
// Typographic readability band — characters per line.
//
// Long lines of text are hard to read: the eye loses the line-start on the
// return sweep. The classic typography guidance (Bringhurst; Dyson &
// Haselgrove's reading-speed studies) puts a comfortable single-column measure
// at roughly 45–75 characters. Diagram labels have no reason to run wider than
// a paragraph does.
//
// This is the measurement half of idea #12: readability-audit.ts uses it to
// flag a label line that runs past the band (LABEL_LINE_OVERLONG), an
// agent-facing signal to rewrap. It is pure and deterministic. (An automatic
// corrective wrap is deliberately not shipped here: every current wrap caller
// already wraps to a pixel budget narrower than this measure, so a
// readable-measure cap would never bite — see the PR notes.)
// ============================================================================

import { stripFormattingTags } from '../multiline-utils.ts'

/** Upper bound of the comfortable single-column measure, in characters. */
export const READABLE_MAX_CHARS = 75

/** Characters in the longest line of `text` (newline-separated; inline
 *  formatting tags are not counted as glyphs). */
export function longestLineChars(text: string): number {
  let longest = 0
  for (const line of text.split('\n')) {
    const chars = [...stripFormattingTags(line)].length
    if (chars > longest) longest = chars
  }
  return longest
}
