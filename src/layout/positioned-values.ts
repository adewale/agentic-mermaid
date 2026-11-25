// The positioned graph a graph layout returns is a value. From the moment
// layout finishes, nothing edits it: a consumer that needs other geometry
// builds new objects, so an object that has not changed keeps its identity
// and a cache keyed by that identity is correct by construction. Under scene
// assertions (the unit tests) its nodes, groups, edges, labels and notes are
// frozen, so an in-place edit throws where it happens.

import type { PositionedGraph } from '../types.ts'
import { sceneAssertionsEnabled } from '../scene/assertions.ts'

/** Freeze `value` and everything reachable from it. */
function deepFreeze(value: unknown, seen: Set<object>): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key], seen)
  Object.freeze(value)
}

/**
 * Finish a positioned graph: under scene assertions, freeze its nodes, groups,
 * edges, labels, notes and title. The envelope (receipts such as
 * `certification`) stays an ordinary record.
 */
export function finishPositionedGraph<G extends PositionedGraph>(positioned: G): G {
  if (sceneAssertionsEnabled()) {
    const seen = new Set<object>()
    for (const value of [positioned.nodes, positioned.groups, positioned.edges, positioned.notes, positioned.title]) deepFreeze(value, seen)
  }
  return positioned
}
