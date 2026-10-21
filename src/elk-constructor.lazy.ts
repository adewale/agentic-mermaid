import { DeferredDependencyError } from './shared/deferred-dependency.ts'

let constructor: (new () => unknown) | undefined
let pending: Promise<void> | undefined

async function load(): Promise<void> {
  // @ts-ignore — the bundled ELK runtime has no module declaration.
  await (pending ??= import('elkjs/lib/elk.bundled.js').then((module: { default: unknown }) => {
    constructor = module.default as new () => unknown
  }).catch((error: unknown) => { pending = undefined; throw error }))
}

/** Build-only twin for the async browser entry. Certified native forests
 * never call it, so their render neither downloads nor initializes ELK. */
export function elkConstructor(): new () => unknown {
  if (!constructor) throw new DeferredDependencyError('ELK', load)
  return constructor
}
