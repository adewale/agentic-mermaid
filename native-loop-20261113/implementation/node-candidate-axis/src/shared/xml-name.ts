/** ASCII XML name characters used by our SVG serializer subset.
 * Start-character and qualified-name rules remain the admission owner's job. */
export function isAsciiXmlNameChar(char: string | undefined, primitive = false): boolean {
  if (char === undefined) return false
  if (!primitive) {
    const code = char.charCodeAt(0), lower = code | 32
    return (lower >= 97 && lower <= 122)
      || (code >= 48 && code <= 57) || code === 95 || code === 46 || code === 58 || code === 45
  }
  return (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z')
    || (char >= '0' && char <= '9') || char === '_' || char === '.' || char === ':' || char === '-'
}

/** Primitive UTF-16 operands shared by private XML/SVG lexical consumers. */
export function xmlTokenAt(source: string, token: string, start: number): boolean {
  if (start < 0 || start + token.length > source.length) return false
  for (let i = 0; i < token.length; i++) if (source[start + i] !== token[i]) return false
  return true
}

export function xmlIndexOf(source: string, needle: string, start: number, work?: (operations: number) => void): number {
  for (let index = start; index <= source.length - needle.length; index++) {
    work?.(needle.length)
    if (xmlTokenAt(source, needle, index)) return index
  }
  return -1
}

export function xmlSlice(source: string, start: number, end: number, work?: (operations: number) => void): string {
  work?.(Math.max(0, end - start))
  let result = ''
  for (let i = start; i < end; i++) result += source[i]!
  return result
}

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
