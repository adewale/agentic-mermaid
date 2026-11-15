import { DeferredDependencyError } from './layout/certification-error.ts'

let constructor: (new () => unknown) | undefined

async function load(): Promise<void> {
  // Native dynamic import shares fetching and evaluation across concurrent
  // callers; only successful constructor loading needs a separate cache.
  // @ts-ignore — the bundled ELK runtime has no module declaration.
  constructor = (await import('elkjs/lib/elk.bundled.js')).default as new () => unknown
}

/** Build-only twin for the async browser entry. Certified native forests
 * never call it, so their render neither downloads nor initializes ELK. */
export function elkConstructor(): new () => unknown {
  if (!constructor) throw new DeferredDependencyError('ELK', load)
  return constructor
}
