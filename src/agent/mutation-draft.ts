import type { AnyMutationOp, DiagramBody, MutationError, Result } from './types.ts'

type Mutator = (body: DiagramBody, op: AnyMutationOp) => Result<DiagramBody, MutationError>
export type MutationDraft = (op: AnyMutationOp) => Result<DiagramBody, MutationError>
type DraftFactory = (body: DiagramBody) => MutationDraft | undefined

const factories = new WeakMap<Mutator, DraftFactory>()

/** Internal capability of an exact built-in mutator; descriptor copies do not
 * gain a new operation, and public single-op calls keep their own clone. */
export function withMutationDraft<T extends Mutator>(mutator: T, create: DraftFactory): T {
  factories.set(mutator, create)
  return mutator
}

/** The returned closure owns its draft. No ambient scope survives interruption. */
export function beginMutationDraft(mutator: Mutator, body: DiagramBody): MutationDraft | undefined {
  return factories.get(mutator)?.(body)
}
