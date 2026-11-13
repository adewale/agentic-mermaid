// One primitive XML literal reader for actual writers and their group lexer.
// Return the exact admitted UTF16 span, or zero for an invalid code unit.
export function xmlLiteralSpan(value: string, index: number, attribute: boolean): number {
  const character = value[index]!
  if (character === '<' || !attribute && character === '>' && index >= 2 && value[index - 1] === ']' && value[index - 2] === ']'
    || attribute && character === '"' || character < '\u0020' && character !== '\t' && character !== '\n' && character !== '\r'
    || character === '\ufffe' || character === '\uffff') return 0
  if (character >= '\ud800' && character <= '\udbff') {
    const next = index + 1 < value.length ? value[index + 1]! : ''
    return next >= '\udc00' && next <= '\udfff' ? 2 : 0
  }
  if (character >= '\udc00' && character <= '\udfff') return 0
  return character === '&' ? xmlReferenceLength(value, index) : 1
}

function xmlReferenceLength(value: string, start: number): number {
  const marker = start + 1 < value.length ? value[start + 1] : undefined
  if (marker === 'a') return start + 5 <= value.length && value[start + 2] === 'm' && value[start + 3] === 'p' && value[start + 4] === ';' ? 5 : 0
  if (marker === 'l' || marker === 'g') return start + 4 <= value.length && value[start + 2] === 't' && value[start + 3] === ';' ? 4 : 0
  if (marker === 'q') return start + 6 <= value.length && value[start + 2] === 'u' && value[start + 3] === 'o' && value[start + 4] === 't' && value[start + 5] === ';' ? 6 : 0
  if (marker !== '#' || start + 2 >= value.length) return 0
  const digit = value[start + 2]
  if (digit === '9') return start + 4 <= value.length && value[start + 3] === ';' ? 4 : 0
  return start + 5 <= value.length && (digit === '3' && value[start + 3] === '9' || digit === '1' && (value[start + 3] === '0' || value[start + 3] === '3')) && value[start + 4] === ';' ? 5 : 0
}
