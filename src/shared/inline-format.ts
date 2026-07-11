// Shared inline-format parser for measurement, wrapping, and SVG emission.
// Input is the repository's normalized label form (<b>, <i>, <u>, <s>).

export interface StyledSegment {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
}

const FORMAT_TAG_REGEX = /<(\/)?(?:(b|strong)|(i|em)|(u)|(s|del))\s*>/gi
export const HAS_FORMAT_TAGS = /<\/?(?:b|strong|i|em|u|s|del)\s*>/i

/** Parse one line into styled runs. Unclosed opening tags intentionally keep
 * their style through end-of-line, matching SVG's normalized line model. */
export function parseInlineFormatting(line: string): StyledSegment[] {
  const segments: StyledSegment[] = []
  let bold = false
  let italic = false
  let underline = false
  let strikethrough = false
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
  return segments
}

/** Canonical formatting-tag serialization used when wrapping reconstructs a
 * line from styled runs. */
export function serializeStyledSegment(segment: StyledSegment): string {
  let text = segment.text
  if (segment.strikethrough) text = `<s>${text}</s>`
  if (segment.underline) text = `<u>${text}</u>`
  if (segment.italic) text = `<i>${text}</i>`
  if (segment.bold) text = `<b>${text}</b>`
  return text
}
