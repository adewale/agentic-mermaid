/**
 * Code points no output can display faithfully and safely: noncharacters
 * (which XML cannot carry at U+FFFE/U+FFFF and Unicode reserves everywhere),
 * lone surrogates (not text at all), and the bidi embedding, override and
 * isolate controls that reorder neighbouring text out of source order
 * ("Trojan source" spoofing, and cell misalignment in terminals).
 */
const UNDISPLAYABLE = /[\u202a-\u202e\u2066-\u2069\p{Noncharacter_Code_Point}\p{Cs}]/u
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\p{Noncharacter_Code_Point}\p{Cs}]/u

/**
 * Interpret untrusted text as inert display characters. C0/C1 controls become
 * `?` (TAB a space); undisplayable code points become U+FFFD, the Unicode
 * replacement character. SVG, PNG and terminal output all read display text
 * through this one projection, so they draw the same characters.
 * Semantic identifiers and source remain separate; structural scans may retain CR/LF.
 */
export function sanitizeTextControls(
  value: string,
  preserveLineBreaks = false,
): string {
  if (!UNSAFE_TEXT.test(value)) return value
  let result = ''
  for (const character of value) {
    const code = character.codePointAt(0)!
    const control = code <= 0x1f || (code >= 0x7f && code <= 0x9f)
    if (character === '\t') result += ' '
    else if (control && !(preserveLineBreaks && (character === '\n' || character === '\r'))) result += '?'
    else if (UNDISPLAYABLE.test(character)) result += '\ufffd'
    else result += character
  }
  return result
}

const XML_UNCARRIABLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\p{Cs}]/u
const XML_UNCARRIABLE_ALL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\p{Cs}]/gu

/**
 * The XML write boundary's last line of defence: XML 1.0 cannot carry C0
 * controls other than TAB/LF/CR, U+FFFE/U+FFFF or lone surrogates in any
 * form, so a string that reached markup without the display projection
 * (an identity, a data attribute, a tooltip) is written with the same inert
 * characters sanitizeTextControls draws: `?` for a control, U+FFFD otherwise.
 */
export function xmlCarriableText(value: string): string {
  if (!XML_UNCARRIABLE.test(value)) return value
  return value.replace(XML_UNCARRIABLE_ALL, character => character.charCodeAt(0) <= 0x1f ? '?' : '\ufffd')
}

/** Preserve displayed line boundaries while neutralizing controls within a line. */
export function sanitizeDisplayLines(value: string): string {
  return value.split('\n').map(line => sanitizeTextControls(line)).join('\n')
}
