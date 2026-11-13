/** Locale-independent lexicographic order by Unicode code point. */
export function compareCodePointStrings(a: string, b: string): number {
  const left = [...a].map(char => char.codePointAt(0)!)
  const right = [...b].map(char => char.codePointAt(0)!)
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index++) {
    const delta = left[index]! - right[index]!
    if (delta !== 0) return delta
  }
  return left.length - right.length
}
