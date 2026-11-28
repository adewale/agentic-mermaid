// Reuse keyed by a record's content rather than by a list of the fields some
// consumer happens to read. A revision holds every own enumerable field of the
// record and its value; a cached result is reused only while each of them is
// still the same value (Object.is) and no field was added or removed. Because
// the comparison enumerates the record, a field added to a type later is
// covered without anyone remembering to list it.
//
// A frozen nested value compares by identity: it cannot change. A mutable
// plain object or array (a caller's route, an inline style) is compared by its
// contents, so an in-place edit is seen as well. Layout routes are values and
// the finished graph is frozen (route-values.ts, positioned-values.ts), and
// prepared text blocks are frozen by construction, so in practice only small
// containers such as points and inline styles are walked.

export type RecordRevision = readonly unknown[]

const OPEN = Symbol('open'), CLOSE = Symbol('close')
// Positioned records nest points two levels deep; anything deeper compares by
// identity rather than walking an unbounded structure.
const MAX_DEPTH = 4

function mutableContainer(value: unknown, depth: number): value is Record<string, unknown> {
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object' || Object.isFrozen(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === Array.prototype || prototype === null
}

function capture(fields: unknown[], value: unknown, depth: number): void {
  if (!mutableContainer(value, depth)) { fields.push(value); return }
  fields.push(OPEN, value)
  for (const key in value) { fields.push(key); capture(fields, value[key], depth + 1) }
  fields.push(CLOSE)
}

/** Index after `value` in `revision` starting at `index`, or -1 if it changed. */
function compare(revision: RecordRevision, index: number, value: unknown, depth: number): number {
  if (!mutableContainer(value, depth)) return index < revision.length && Object.is(revision[index], value) ? index + 1 : -1
  if (revision[index] !== OPEN || revision[index + 1] !== value) return -1
  index += 2
  for (const key in value) {
    if (revision[index] !== key) return -1
    index = compare(revision, index + 1, value[key], depth + 1)
    if (index < 0) return -1
  }
  return revision[index] === CLOSE ? index + 1 : -1
}

/** Every own enumerable field of `record` except `omit`, which the caller
 * passes to its computation separately. */
export function recordRevision(record: object, omit?: string): RecordRevision {
  const fields: unknown[] = []
  for (const key in record) if (key !== omit) { fields.push(key); capture(fields, (record as Record<string, unknown>)[key], 1) }
  return fields
}

/** Whether `record` still has exactly the fields and values of `revision`. */
export function sameRevision(revision: RecordRevision, record: object, omit?: string): boolean {
  let index = 0
  for (const key in record) {
    if (key === omit) continue
    if (revision[index] !== key) return false
    index = compare(revision, index + 1, (record as Record<string, unknown>)[key], 1)
    if (index < 0) return false
  }
  return index === revision.length
}
