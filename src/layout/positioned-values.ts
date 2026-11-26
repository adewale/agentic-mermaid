// The positioned graph a graph layout returns is a value. From the moment
// layout finishes, nothing edits it: a consumer that needs other geometry
// builds new objects, so an object that has not changed keeps its identity
// and a cache keyed by that identity is correct by construction. A finished
// graph is therefore shared, never copied: the position cache freezes it and
// hands the same graph to every hit. Under scene assertions (the unit tests)
// every finished graph, receipts included, is frozen, so an in-place edit
// throws where it happens. Freezing reaches everything the graph holds, so
// the graph holds nothing its authored MermaidGraph or caller still owns: a
// projection copies each authored object it carries (ownedLabelContent).

import type { PositionedGraph } from '../types.ts'
import { sceneAssertionsEnabled } from '../scene/assertions.ts'
import { prepareDisplayText, type LabelContent } from '../shared/display-text.ts'

const finished = new WeakSet<object>()

/** Freeze `value` and everything reachable from it. */
function deepFreeze(value: unknown, seen: Set<object>): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key], seen)
  Object.freeze(value)
}

/** Finish a positioned graph: from here on it is immutable (deep-frozen under
 * scene assertions) and may be shared by every consumer. */
export function finishPositionedGraph<G extends PositionedGraph>(positioned: G): G {
  if (sceneAssertionsEnabled()) freezePositionedGraph(positioned)
  finished.add(positioned)
  return positioned
}

/** Deep-freeze a finished graph in every mode. A cache that shares one graph
 * between renders freezes it first, so sharing is enforced, not assumed. */
export function freezePositionedGraph(positioned: object): void {
  deepFreeze(positioned, new Set())
}

/** Whether `value` is a graph layout's finished, immutable result. */
export function isFinishedPositionedGraph(value: unknown): boolean {
  return typeof value === 'object' && value !== null && finished.has(value)
}

/** The positioned graph's own copy of an authored label reading. The wrapper
 * is the authored graph's; its display plan is immutable (a caller-built plan
 * is captured as an immutable copy), so freezing the copy freezes nothing the
 * authored graph owns. */
export function ownedLabelContent(content: LabelContent): LabelContent {
  return { ...content, prepared: prepareDisplayText(content.prepared) }
}
