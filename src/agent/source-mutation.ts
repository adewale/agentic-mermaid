/** Source-preserving edits append declarations without normalizing authored bytes. */
export function appendSourceStatement(source: string, statement: string): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  return source + (/[\r\n]$/.test(source) ? '' : newline) + statement.replace(/\r?\n/g, newline) + newline
}

/** Compare complete native parser values, retaining Map and array order.
 * Optional record fields may be absent or explicitly undefined. */
export function sameSourceMeaning(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  if (left instanceof Map || right instanceof Map) {
    return left instanceof Map && right instanceof Map && sameSourceMeaning([...left], [...right])
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameSourceMeaning(value, right[index]))
  }
  if ([left, right].some(value => ![null, Object.prototype].includes(Object.getPrototypeOf(value)))) return false
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>
  const keys = Object.keys(a).filter(key => a[key] !== undefined)
  return keys.length === Object.keys(b).filter(key => b[key] !== undefined).length
    && keys.every(key => Object.hasOwn(b, key) && sameSourceMeaning(a[key], b[key]))
}
