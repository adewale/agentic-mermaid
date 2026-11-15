/** Advance over ASCII XML name characters without creating a string for each
 * code unit. Start-character and QName rules remain the admission owner's job. */
export function asciiXmlNameEnd(source: string, start: number): number {
  let end = start
  while (end < source.length) {
    const code = source.charCodeAt(end)
    const lower = code | 32
    if (!((lower >= 97 && lower <= 122)
      || (code >= 48 && code <= 57) || code === 95 || code === 46 || code === 58 || code === 45)) break
    end++
  }
  return end
}
