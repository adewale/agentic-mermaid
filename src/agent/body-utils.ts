import { labelOverflowWarning, type LabelEmphasis } from './label-metrics.ts'
import { DEFAULT_LABEL_CHAR_CAP, err, ok, type LayoutWarning, type MutationError, type Result, type VerifyOptions } from './types.ts'

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
  emphasis?: LabelEmphasis,
): (target: string, text: string) => void {
  return (target, text) => {
    const warning = labelOverflowWarning(target, text, cap, emphasis)
    if (warning) warnings.push(warning)
  }
}

/** The optional-field rule of `set_title`-style ops: `null` removes the field;
 * any other value must pass the family's validator, whose result is stored.
 * Families keep their validators (and so their wording); this owns only the
 * clear-or-validate-then-assign mechanics. */
export function setOptionalField<Body extends object, Field extends keyof Body, Value>(
  body: Body,
  field: Field,
  value: Value | null,
  validate: (value: Value) => Result<Exclude<Body[Field], undefined>, MutationError>,
): Result<void, MutationError> {
  if (value === null) {
    delete body[field]
    return ok(undefined)
  }
  const valid = validate(value)
  if (!valid.ok) return valid
  body[field] = valid.value
  return ok(undefined)
}

/** The insert-position rule of `index`-taking add ops: an omitted index
 * appends; otherwise it must be an integer in 0..length. */
export function resolveInsertIndex(index: number | undefined, length: number, family: string): Result<number, MutationError> {
  if (index === undefined) return ok(length)
  if (!Number.isInteger(index) || index < 0 || index > length) {
    return err({ code: 'INVALID_OP', message: `${family} insert index ${index} out of range (0..${length})` })
  }
  return ok(index)
}
