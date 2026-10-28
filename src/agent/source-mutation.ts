import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'

export interface SourceEdit { readonly start: number; readonly end: number; readonly text: string }

/** Apply an atomic, nonoverlapping plan while copying every untouched byte. */
export function applySourceEdits(source: string, edits: readonly SourceEdit[]): string {
  const ordered = [...edits].sort((left, right) => left.start - right.start || left.end - right.end)
  let end = 0, previousStart = -1, length = source.length
  for (const edit of ordered) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < 0 || edit.end < edit.start || edit.end > source.length || typeof edit.text !== 'string'
      || edit.start < end || edit.start === previousStart) throw new RangeError('Source edit plan has invalid, overlapping or ambiguous boundaries')
    length += edit.text.length - (edit.end - edit.start)
    end = edit.end
    previousStart = edit.start
  }
  assertDiagramWorkLimit('sourceCharacters', length)
  const parts: string[] = []
  let cursor = 0
  for (const edit of ordered) {
    parts.push(source.slice(cursor, edit.start), edit.text)
    cursor = edit.end
  }
  parts.push(source.slice(cursor))
  return parts.join('')
}

/** Append a declaration without normalizing any authored bytes. */
export function appendSourceStatement(source: string, statement: string): readonly SourceEdit[] {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  return [{ start: source.length, end: source.length, text: (/[\r\n]$/.test(source) ? '' : newline) + statement.replace(/\r?\n/g, newline) + newline }]
}

/** Compare complete native parser values, retaining Map and array order.
 * Optional record fields may be absent or explicitly undefined. */
export function sameSourceMeaning(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  if (left instanceof Map || right instanceof Map) {
    if (!(left instanceof Map) || !(right instanceof Map) || left.size !== right.size) return false
    const entries = right.entries()
    for (const [key, value] of left) {
      const other = entries.next().value!
      if (!sameSourceMeaning(key, other[0]) || !sameSourceMeaning(value, other[1])) return false
    }
    return true
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameSourceMeaning(value, right[index]))
  }
  const leftPrototype = Object.getPrototypeOf(left), rightPrototype = Object.getPrototypeOf(right)
  if (leftPrototype !== null && leftPrototype !== Object.prototype || rightPrototype !== null && rightPrototype !== Object.prototype) return false
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>
  let fields = 0
  for (const key of Object.keys(a)) {
    if (a[key] === undefined) continue
    if (!Object.hasOwn(b, key) || !sameSourceMeaning(a[key], b[key])) return false
    fields++
  }
  for (const key of Object.keys(b)) if (b[key] !== undefined) fields--
  return fields === 0
}
