import { labelOverflowWarning } from './label-metrics.ts'
import { DEFAULT_LABEL_CHAR_CAP, type LayoutWarning, type VerifyOptions } from './types.ts'

/** Deterministic lowest-free `${prefix}-${n}` allocation shared by bodies. */
export function indexedIdAllocator(existing: Iterable<string>, prefix: string): () => string {
  const seen = new Set(existing)
  let index = 0
  return () => {
    while (seen.has(`${prefix}-${index}`)) index++
    const id = `${prefix}-${index}`
    seen.add(id)
    index++
    return id
  }
}

/** Build the repeated verifier closure without moving family label selection
 * into a generic framework. Families remain responsible for which text is a
 * label and this helper owns only the identical warning mechanics. */
export function labelOverflowCollector(
  warnings: LayoutWarning[],
  opts: VerifyOptions,
  cap = opts.labelCharCap ?? DEFAULT_LABEL_CHAR_CAP,
): (target: string, text: string) => void {
  return (target, text) => {
    const warning = labelOverflowWarning(target, text, cap)
    if (warning) warnings.push(warning)
  }
}
