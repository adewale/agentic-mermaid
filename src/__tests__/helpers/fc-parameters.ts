import fc from 'fast-check'

/** Keep local regression settings in gates, but let finder/replay controls win. */
export function fcParameters<T>(defaults: fc.Parameters<T> = {}): fc.Parameters<T> {
  const parameters = { ...defaults }
  const global = fc.readConfigureGlobal()
  if (process.env.AM_FC_SEED !== undefined) {
    // With AM_FC_SEED=random the preload leaves seed unset. Removing a local
    // pin lets fast-check choose (and report) a fresh seed for this property.
    if (global.seed === undefined) delete parameters.seed
    else parameters.seed = global.seed
  }
  if (global.numRuns !== undefined) {
    // Finder counts are a floor: never reduce an already stronger local run.
    parameters.numRuns = Math.max(defaults.numRuns ?? 100, global.numRuns)
  }
  return parameters
}
