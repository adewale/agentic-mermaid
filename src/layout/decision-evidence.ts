import type { GraphLayoutDecision } from './backend.ts'

// Keep immutable producer evidence independent of runtime providers. Private
// cache copies and operation wrappers share this single authority.
const decisions = new WeakMap<object, readonly GraphLayoutDecision[]>()

export function immutableDecision(decision: GraphLayoutDecision): GraphLayoutDecision {
  return Object.freeze({ ...decision, attempts: Object.freeze(decision.attempts.map(attempt => Object.freeze({ ...attempt }))) })
}


export function retainGraphLayoutDecision(request: object, decision: GraphLayoutDecision): void {
  const retained = decisions.get(request) ?? []
  const value = immutableDecision(decision)
  if (retained.some(previous => JSON.stringify(previous) === JSON.stringify(value))) return
  decisions.set(request, Object.freeze([...retained, value]))
}

export function graphLayoutDecisionsOf(request: object): readonly GraphLayoutDecision[] {
  return decisions.get(request) ?? Object.freeze([])
}

/** Cache copies retain immutable producer evidence without attaching fields
 * to family geometry or changing its per-request primary/companion role. */
export function transferGraphLayoutDecisions(source: object, target: object): void {
  const retained = decisions.get(source)
  if (retained) decisions.set(target, retained)
}

