/** Locale-independent lexicographic order by Unicode code point. */
export function compareCodePointStrings(a: string, b: string): number {
  // Fast path over UTF-16 units: two differing non-surrogate units are whole
  // code points, and the equal prefix splits into the same code points in both
  // strings, so they decide. A surrogate, or a strict prefix, takes the walk.
  const units = Math.min(a.length, b.length)
  let index = 0
  for (; index < units; index++) {
    const left = a.charCodeAt(index),
      right = b.charCodeAt(index)
    if (left === right) continue
    if ((left < 0xd800 || left > 0xdfff) && (right < 0xd800 || right > 0xdfff)) return left - right
    break
  }
  if (index === units && a.length === b.length) return 0
  const left = [...a].map(char => char.codePointAt(0)!)
  const right = [...b].map(char => char.codePointAt(0)!)
  const length = Math.min(left.length, right.length)
  for (let point = 0; point < length; point++) {
    const delta = left[point]! - right[point]!
    if (delta !== 0) return delta
  }
  return left.length - right.length
}
