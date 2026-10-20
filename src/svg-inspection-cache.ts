// Inspection results live only for one synchronous graphical execution. Keys
// are the exact immutable SVG bytes; every rewrite therefore gets new evidence.
// Bounds also apply to hostile extension output and nested render calls.
let active: Map<string, Map<string, unknown>> | undefined
let retainedCharacters = 0
const MAX_CHARACTERS = 512 * 1024
const MAX_ENTRIES = 512
let entries = 0

export function withSvgInspectionCache<T>(run: () => T): T {
  const previous = active
  const previousCharacters = retainedCharacters
  const previousEntries = entries
  active = new Map()
  retainedCharacters = 0
  entries = 0
  try { return run() } finally {
    active = previous
    retainedCharacters = previousCharacters
    entries = previousEntries
  }
}

export function inspectSvgOnce<T>(kind: string, source: string, inspect: () => T): T {
  if (!active) return inspect()
  let results = active.get(kind)
  if (results?.has(source)) return results.get(source) as T
  const result = inspect()
  if (entries < MAX_ENTRIES && retainedCharacters + source.length <= MAX_CHARACTERS) {
    if (!results) { results = new Map(); active.set(kind, results) }
    results.set(source, result)
    retainedCharacters += source.length
    entries++
  }
  return result
}
