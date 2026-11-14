// Shared inline-format parser for measurement, wrapping, and SVG emission.
// Input is the repository's normalized label form (<b>, <i>, <u>, <s>).

export interface StyledSegment {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
}

/** The formatting tags, opening or closing: <b>/<strong>, <i>/<em>, <u>,
 * <s>/<del>, in any case. The one definition of which tags are formatting;
 * every other tag-like text in a label is text. */
export const FORMAT_TAG_SOURCE = '<\\/?(?:b|strong|i|em|u|s|del)\\s*>'
/** FORMAT_TAG_SOURCE with a capture group per style. */
const FORMAT_TAG_REGEX = /<(\/)?(?:(b|strong)|(i|em)|(u)|(s|del))\s*>/gi
export const HAS_FORMAT_TAGS = new RegExp(FORMAT_TAG_SOURCE, 'i')

/** Parse one line into styled runs. Unclosed opening tags intentionally keep
 * their style through end-of-line, matching SVG's normalized line model. */
export function parseInlineFormatting(line: string): StyledSegment[] {
  return parseFormattingLine(line)
}

type FormattingState = Omit<StyledSegment, 'text'>
function freshFormattingState(): FormattingState {
  return { bold: false, italic: false, underline: false, strikethrough: false }
}

function parseFormattingLine(line: string, state?: FormattingState): StyledSegment[] {
  const segments: StyledSegment[] = []
  let bold = state?.bold ?? false
  let italic = state?.italic ?? false
  let underline = state?.underline ?? false
  let strikethrough = state?.strikethrough ?? false
  let lastIndex = 0
  FORMAT_TAG_REGEX.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = FORMAT_TAG_REGEX.exec(line)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: line.slice(lastIndex, match.index), bold, italic, underline, strikethrough })
    }
    lastIndex = match.index + match[0].length
    const isClosing = Boolean(match[1])
    if (match[2]) bold = !isClosing
    else if (match[3]) italic = !isClosing
    else if (match[4]) underline = !isClosing
    else if (match[5]) strikethrough = !isClosing
  }

  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex), bold, italic, underline, strikethrough })
  }
  if (state) {
    state.bold = bold
    state.italic = italic
    state.underline = underline
    state.strikethrough = strikethrough
  }
  return segments
}

/** A closed span may cross authored hard breaks. Unmatched openings retain
 * the standalone parser's line-local behavior; aliases still share boolean
 * state rather than introducing a nested-tag grammar. */
export function parseMultilineFormatting(lines: readonly string[]): StyledSegment[][] {
  if (lines.length === 1) return [parseInlineFormatting(lines[0]!)]
  const lastClosing = { bold: -1, italic: -1, underline: -1, strikethrough: -1 }
  let offset = 0
  for (const line of lines) {
    FORMAT_TAG_REGEX.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = FORMAT_TAG_REGEX.exec(line)) !== null) {
      if (!match[1]) continue
      if (match[2]) lastClosing.bold = offset + match.index
      else if (match[3]) lastClosing.italic = offset + match.index
      else if (match[4]) lastClosing.underline = offset + match.index
      else if (match[5]) lastClosing.strikethrough = offset + match.index
    }
    offset += line.length + 1
  }
  const state = freshFormattingState(), result: StyledSegment[][] = []
  offset = 0
  for (const line of lines) {
    result.push(parseFormattingLine(line, state))
    offset += line.length + 1
    if (lastClosing.bold < offset) state.bold = false
    if (lastClosing.italic < offset) state.italic = false
    if (lastClosing.underline < offset) state.underline = false
    if (lastClosing.strikethrough < offset) state.strikethrough = false
  }
  return result
}

/** Canonical formatting-tag serialization used when wrapping reconstructs a
 * line from styled runs. */
export function plainTextFromInlineFormatting(text: string): string {
  return text.split('\n').map(line => parseInlineFormatting(line).map(segment => segment.text).join('')).join('\n')
}

export function serializeStyledSegment(segment: StyledSegment): string {
  let text = segment.text
  if (segment.strikethrough) text = `<s>${text}</s>`
  if (segment.underline) text = `<u>${text}</u>`
  if (segment.italic) text = `<i>${text}</i>`
  if (segment.bold) text = `<b>${text}</b>`
  return text
}
