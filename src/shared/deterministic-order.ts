/** Locale-independent lexicographic order by Unicode code point. */
export function compareCodePointStrings(a: string, b: string): number {
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index++) {
    const left = a.charCodeAt(index),
      right = b.charCodeAt(index)
    if (left === right) continue
    // Two non-surrogate units are whole code points, and the equal prefix
    // splits into the same code points in both strings, so they decide.
    if ((left < 0xd800 || left > 0xdfff) && (right < 0xd800 || right > 0xdfff)) return left - right
    return compareCodePoints(a, b)
  }
  return a.length === b.length ? 0 : compareCodePoints(a, b)
}

function compareCodePoints(a: string, b: string): number {
  const left = [...a].map(char => char.codePointAt(0)!)
  const right = [...b].map(char => char.codePointAt(0)!)
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index++) {
    const delta = left[index]! - right[index]!
    if (delta !== 0) return delta
  }
  return left.length - right.length
}
