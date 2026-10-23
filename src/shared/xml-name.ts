/** ASCII XML name characters used by our SVG serializer subset.
 * Start-character and qualified-name rules remain the admission owner's job. */
export function isAsciiXmlNameChar(char: string | undefined): boolean {
  if (char === undefined) return false
  const code = char.charCodeAt(0)
  const lower = code | 32
  return (lower >= 97 && lower <= 122)
    || (code >= 48 && code <= 57) || code === 95 || code === 46 || code === 58 || code === 45
}
