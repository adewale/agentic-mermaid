import { MUTATION_OPS_BY_FAMILY } from './generated/mutation-op-kinds.ts'
import type { DiagramKind } from './types.ts'
import { formatUnknownOpMessage } from './unknown-op.ts'
export { MUTATION_OPS_BY_FAMILY } from './generated/mutation-op-kinds.ts'

// The build derives this lightweight runtime menu from schema insertion order.
// Mutators can name legal operations without loading admission schemas/docs.
export type MutableFamilyId = keyof typeof MUTATION_OPS_BY_FAMILY

/** The valid mutation-op `kind`s for a family, as a display string — for
 *  prescriptive "unknown op" errors that hand the caller the actual menu. */
export function validOpsFor(family: DiagramKind): string {
  const ops = (MUTATION_OPS_BY_FAMILY as Record<string, readonly string[]>)[family]
  return ops ? ops.join(', ') : '(none — this family has no structured ops)'
}

/** Message for an op whose `kind` a family's mutator does not recognize: names
 *  the offending kind AND the family's valid ops, so the caller can correct it
 *  from the error alone instead of guessing which ops exist. */
export function unknownOpMessage(family: DiagramKind, op: unknown): string {
  return formatUnknownOpMessage(family, op, validOpsFor(family))
}
