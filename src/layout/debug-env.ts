import type { LayoutDebugEnv } from './geometry.ts'

// The closed set of layout debug switches read by layoutEnvFlag. Cache keys
// read these names directly instead of enumerating process.env, which costs a
// host call per variable on every render. Values are read at call time so a
// test may still toggle a switch between renders.
const LAYOUT_DEBUG_FLAGS = [
  'APL_DEBUG', 'APL_DECOUPLE_LABELS', 'APL_NO_CENTER', 'APL_NO_CORANK_FANIN',
  'APL_NO_FACET', 'APL_NO_LABELED_SOURCE_PORT', 'APL_NO_SVERTEX',
] as const satisfies readonly (keyof LayoutDebugEnv)[]
type UnlistedLayoutDebugFlag = Exclude<keyof LayoutDebugEnv, typeof LAYOUT_DEBUG_FLAGS[number]>
// A switch added to LayoutDebugEnv but not listed above fails typechecking.
export const LAYOUT_DEBUG_FLAGS_COMPLETE: [UnlistedLayoutDebugFlag] extends [never] ? true : never = true

/** Sorted [name, value] pairs for the switches that are currently set. */
export function layoutDebugEnvIdentity(): Array<[string, string]> {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  const set: Array<[string, string]> = []
  if (!env) return set
  for (const name of LAYOUT_DEBUG_FLAGS) {
    const value = env[name]
    if (value !== undefined) set.push([name, value])
  }
  return set
}
