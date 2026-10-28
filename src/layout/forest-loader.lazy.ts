import { DeferredDependencyError } from './backend.ts'

let implementation: typeof import('./forest-implementation.ts') | undefined
let pending: Promise<void> | undefined

export async function loadForest(): Promise<void> {
  await (pending ??= import('./forest-implementation.ts').then(module => {
    implementation = module
  }).catch((error: unknown) => { pending = undefined; throw error }))
}

export function readyForest(): NonNullable<typeof implementation> {
  if (!implementation) throw new DeferredDependencyError('Forest layout', loadForest)
  return implementation
}
