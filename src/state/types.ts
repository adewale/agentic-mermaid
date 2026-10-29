import type { LabelContent } from '../shared/display-text.ts'

export interface StateScope {
  parent: string
  /** Zero-based concurrent region; absent for an ordinary composite. */
  region?: number
}

/** A named annotation in its own scope, with no attachment to a state. Its
 * identity is in the note namespace, independently of authored state IDs. */
export interface FloatingStateNote {
  id: string
  text: string
  textContent?: LabelContent
  scope?: StateScope
}
