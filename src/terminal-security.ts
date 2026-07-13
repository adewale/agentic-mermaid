/**
 * Replace untrusted terminal controls with a visible, single-cell ASCII glyph.
 * Structural source lines may retain CR/LF until parsing; rendered text may not.
 */
export function sanitizeTerminalText(
  value: string,
  preserveLineBreaks = false,
): string {
  let result = ''
  for (const character of value) {
    const code = character.codePointAt(0)!
    const control = code <= 0x1f || (code >= 0x7f && code <= 0x9f)
    if (character === '\t') result += ' '
    else if (!control || (preserveLineBreaks && (character === '\n' || character === '\r'))) result += character
    else result += '?'
  }
  return result
}
