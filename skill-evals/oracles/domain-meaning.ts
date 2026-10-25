import { classRelationLineStyle, classRelationMarkers } from '../../src/agent/class-body.ts'
import type { ClassRelation, StateBody } from '../../src/agent/types.ts'

/** A relation's markers and cardinalities belong to identities, regardless of
 * which endpoint was written first in Mermaid source. */
export function classRelationshipMeaning(relation: ClassRelation): unknown[] {
  const markers = classRelationMarkers(relation)
  const endpoints = [
    [relation.from, markers.from ?? null, relation.fromCardinality ?? null],
    [relation.to, markers.to ?? null, relation.toCardinality ?? null],
  ].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  return [endpoints, classRelationLineStyle(relation), relation.label ?? null]
}

export interface StateFailureAddition {
  from: string
  id: string
  label: string
}

/** Exact outcome for the flat lifecycle fixtures, shared by saved artifacts
 * and executable hosted requests. Operation spelling and order are irrelevant. */
export function stateFailureProblems(before: StateBody, actual: StateBody, failure: StateFailureAddition): string[] {
  if (before.states.some(state => state.states || state.regions) || before.states.some(state => state.id === failure.id)) return ['state failure expectation requires a flat lifecycle and a new state identity']
  const problems: string[] = []
  const compare = (name: string, have: unknown[][], want: unknown[][]) => {
    const encode = (rows: unknown[][]) => JSON.stringify(rows.map(row => JSON.stringify(row)).sort())
    if (encode(have) !== encode(want)) problems.push(`${name} differ from the requested failure-state addition`)
  }
  const state = (value: StateBody['states'][number]) => [value.id, value.label ?? value.id, value.stereotype ?? null, !!value.states, !!value.regions]
  compare('state identities, labels and scope', actual.states.map(state), [...before.states, { id: failure.id }].map(state))
  const transition = (value: StateBody['transitions'][number]) => [value.from, value.to, value.label ?? null]
  compare('state transitions', actual.transitions.map(transition), [...before.transitions, { from: failure.from, to: failure.id, label: failure.label }, { from: failure.id, to: '[*]' }].map(transition))
  const note = (value: NonNullable<StateBody['notes']>[number]) => [value.target, value.side, value.text]
  compare('state notes', (actual.notes ?? []).map(note), (before.notes ?? []).map(note))
  const floating = (value: NonNullable<StateBody['floatingNotes']>[number]) => [value.id, value.text, value.scope?.parent ?? null, value.scope?.region ?? null]
  compare('floating state notes', (actual.floatingNotes ?? []).map(floating), (before.floatingNotes ?? []).map(floating))
  return problems
}
