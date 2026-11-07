// Inspection results live only for one synchronous graphical execution. Keys
// are the exact immutable SVG bytes; every rewrite therefore gets new evidence.
// Bounds also apply to hostile extension output and nested render calls.
import { observeCache, observeGraphicalExecution } from './performance-observations.ts'
type InspectionOwner = string | symbol
let active: Map<InspectionOwner, Map<string, unknown>> | undefined
let retainedCharacters = 0
const MAX_CHARACTERS = 512 * 1024
const MAX_ENTRIES = 512
let entries = 0

export function withSvgInspectionCache<T>(run: () => T): T {
  observeGraphicalExecution()
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
  return inspectOwnedSvgOnce(kind, kind, source, inspect)
}

/** A diagnostic label is not an authority key. Each producer keeps this
 * closure private, so public probes cannot replace its inspection results. */
export function createSvgInspector<T>(label: string, inspect: (source: string) => T): (source: string) => T {
  const owner = Symbol(label)
  return source => inspectOwnedSvgOnce(owner, label, source, () => inspect(source))
}

function inspectOwnedSvgOnce<T>(owner: InspectionOwner, label: string, source: string, inspect: () => T): T {
  if (!active) { observeCache('svg-inspection', 'bypass', 'outside-graphical-scope', label); return inspect() }
  // JavaScript callers can bypass the string type. Never let a forged length
  // corrupt the shared retention allowance or observe an accessor here.
  if (typeof source !== 'string') { observeCache('svg-inspection', 'bypass', 'invalid-source', label); return inspect() }
  let results = active.get(owner)
  if (results?.has(source)) { observeCache('svg-inspection', 'hit', undefined, label); return results.get(source) as T }
  observeCache('svg-inspection', 'miss', undefined, label)
  const result = inspect()
  if (entries < MAX_ENTRIES && retainedCharacters + source.length <= MAX_CHARACTERS) {
    if (!results) { results = new Map(); active.set(owner, results) }
    results.set(source, result)
    retainedCharacters += source.length
    entries++
  } else observeCache('svg-inspection', 'store-skipped', entries >= MAX_ENTRIES ? 'entry-limit' : 'character-limit', label)
  return result
}
