/**
 * Interpret untrusted C0/C1 controls as inert display characters.
 * Semantic identifiers and source remain separate; structural scans may retain CR/LF.
 */
export function sanitizeTextControls(
  value: string,
  preserveLineBreaks = false,
): string {
  if (!/[\u0000-\u001f\u007f-\u009f]/.test(value)) return value
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

/** Preserve displayed line boundaries while neutralizing controls within a line. */
export function sanitizeDisplayLines(value: string): string {
  return value.split('\n').map(line => sanitizeTextControls(line)).join('\n')
}
