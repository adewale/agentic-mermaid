// Keep these predicates local to avoid an extra lazy browser request.
// Tests on UTF-16 code units, as the lexers read them with charCodeAt. Past the end of a string
// the code is NaN, which is none of these.

// Whitespace as `\s` sees it.
export function isSpace(c: number): boolean {
  if (c < 128) return c === 32 || (c >= 9 && c <= 13)
  return c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff
}

// A character of `\w`.
export function isWord(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
}
