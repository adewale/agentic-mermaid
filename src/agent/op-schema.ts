import { OP_SCHEMAS as SCHEMAS, type FieldSpec, type FieldType, type RecordShape } from './op-schema-definitions.ts'
import { unknownOpMessage, type MutableFamilyId } from './mutation-ops.ts'

// ============================================================================
// op-schema: shape validation for every family's structured mutation ops.
//
// The typed `mutate` surface is guaranteed by the compiler — but the MCP and
// CLI boundaries hand it ops as untyped JSON, where those guarantees evaporate:
// a model that writes `{kind:'add_class', name:'Duck'}` (using `name` where
// `id` is expected) slips a shapeless object past the type system, and the
// mutator silently produces `class undefined`. This layer restores the missing
// check at the one place untyped ops arrive: it validates op SHAPE (field
// presence, primitive type, enum membership) BEFORE the mutator runs, and
// rejects a malformed op with a PRESCRIPTIVE INVALID_OP error that names the
// offending field and lists the valid ones (with a nearest-match suggestion
// for an obvious typo).
//
// Scope: shape only. Semantic checks — does the referenced class exist, is the
// id already taken, is the index in range — stay in the existing mutators. The
// two layers compose: shape first (here), semantics second (the mutator). The
// shape records in op-schema-definitions.ts describe the *MutationOp unions
// in types.ts; the whole unit suite exercising
// the mutators through the checked core is the proof (see apply.ts).
// ============================================================================


export type OpFamily = MutableFamilyId

/** True when `family` has a shape schema (i.e. is a mutable structured family).
 *  Own-property only: `family in SCHEMAS` would report inherited Object.prototype
 *  names (`toString`, `constructor`, `__proto__`, …) as families and mis-narrow them. */
export function hasOpSchema(family: string): family is OpFamily {
  return Object.hasOwn(SCHEMAS, family)
}

// ---- Prescriptive error ---------------------------------------------------

/**
 * Structured, model-actionable validation error. `code` is always INVALID_OP
 * (so it flows through the existing MutationError channel unchanged), but the
 * payload names the exact problem and enumerates the legal fields so a weak
 * model can self-correct in one turn.
 */
export interface OpValidationError {
  code: 'INVALID_OP'
  /** 'expected_single_op' | 'unknown_kind' | 'unknown_field' | 'missing_field' | 'wrong_type' | 'require_one_of' */
  reason: string
  message: string
  family: OpFamily
  opKind?: string
  /** the offending field, when applicable */
  field?: string
  /** valid field names for this op (or valid op kinds, for unknown_kind) */
  validFields?: string[]
  /** nearest valid name to a typo'd field/kind, when an obvious match exists.
   *  For an op missing `kind` whose op kind sits under another key (`field`,
   *  e.g. `{op:'add_node'}`), `kind`; the message shows the corrected op. */
  didYouMean?: string
}

function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0]![j] = j
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[m]![n]!
}

/** Nearest candidate within an edit-distance threshold (typo tolerance). */
function nearest(target: string, candidates: string[]): string | undefined {
  let best: string | undefined
  let bestD = Infinity
  for (const c of candidates) {
    const dist = levenshtein(target.toLowerCase(), c.toLowerCase())
    if (dist < bestD) {
      bestD = dist
      best = c
    }
  }
  // Only suggest when the match is close (<= ~40% of the longer string).
  return best !== undefined && bestD <= Math.max(2, Math.ceil(best.length * 0.4)) ? best : undefined
}

function typeName(f: FieldType): string {
  switch (f.type) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'number-or-null':
      return 'number | null'
    case 'boolean-or-null':
      return 'boolean | null'
    case 'string-or-null':
      return 'string | null'
    case 'string-array':
      return 'string[]'
    case 'number-array':
      return 'number[]'
    case 'object':
      return 'object'
    case 'object-array':
      return 'object[]'
    case 'object-or-null':
      return 'object | null'
    case 'enum':
      return `one of ${f.values.map(v => JSON.stringify(v)).join(', ')}${f.nullable ? ' | null' : ''}`
  }
}

function matchesType(spec: FieldType, value: unknown): boolean {
  switch (spec.type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'number-or-null':
      return value === null || (typeof value === 'number' && Number.isFinite(value))
    case 'boolean-or-null':
      return value === null || typeof value === 'boolean'
    case 'string-or-null':
      return value === null || typeof value === 'string'
    case 'string-array':
      return Array.isArray(value) && value.every(v => typeof v === 'string')
    case 'number-array':
      return Array.isArray(value) && value.every(v => typeof v === 'number' && Number.isFinite(v))
    case 'object-array':
      return Array.isArray(value) && value.every(item => item !== null && typeof item === 'object' && !Array.isArray(item))
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value)
    case 'object-or-null':
      return value === null || (typeof value === 'object' && !Array.isArray(value))
    case 'enum':
      return (spec.nullable === true && value === null) || (typeof value === 'string' && spec.values.includes(value))
  }
}

type AdmittedOpRecord = { ok: true; value: unknown } | { ok: false; message: string }

/**
 * Snapshot JSON-shaped operation data without invoking accessors in the
 * mutator. Direct library callers are untrusted too: custom prototypes,
 * symbols, accessors, cycles, sparse arrays, and proxy trap failures are not
 * plain JSON and are rejected at this one choke point.
 */
export function admitOpRecord(value: unknown): AdmittedOpRecord {
  const seen = new Set<object>()
  const snapshot = (input: unknown): unknown => {
    if (input === null || input === undefined || typeof input === 'string' || typeof input === 'boolean' || typeof input === 'number') return input
    if (typeof input !== 'object') throw new TypeError('operation values must be plain JSON data')
    if (seen.has(input)) throw new TypeError('operation data must not contain cycles')
    seen.add(input)
    try {
      if (Array.isArray(input)) {
        const prototype = Object.getPrototypeOf(input)
        if (prototype !== Array.prototype) throw new TypeError('operation arrays must use the standard array prototype')
        const descriptors = Object.getOwnPropertyDescriptors(input) as Record<string, PropertyDescriptor>
        const length = descriptors.length?.value
        if (!Number.isSafeInteger(length) || length < 0) throw new TypeError('operation arrays must have a readable length')
        const keys = Reflect.ownKeys(input)
        if (keys.some(key => typeof key === 'symbol' || (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key)))) {
          throw new TypeError('operation arrays must not carry symbols or named properties')
        }
        const output: unknown[] = []
        for (let index = 0; index < length; index++) {
          const descriptor = descriptors[String(index)]
          if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
            throw new TypeError('operation arrays must be dense own-data arrays')
          }
          output.push(snapshot(descriptor.value))
        }
        return output
      }
      const prototype = Object.getPrototypeOf(input)
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('operation records must be plain objects')
      }
      const descriptors = Object.getOwnPropertyDescriptors(input) as Record<string, PropertyDescriptor>
      const output: Record<string, unknown> = Object.create(null)
      for (const key of Reflect.ownKeys(input)) {
        if (typeof key === 'symbol') throw new TypeError('operation records must not carry symbol keys')
        const descriptor = descriptors[key]
        if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
          throw new TypeError('operation records must contain enumerable own data fields')
        }
        output[key] = snapshot(descriptor.value)
      }
      return output
    } finally {
      seen.delete(input)
    }
  }
  try {
    return { ok: true, value: snapshot(value) }
  } catch {
    return { ok: false, message: 'operation must be a plain own-data JSON object' }
  }
}

function unreadableOp(family: OpFamily, message: string): OpValidationError {
  return {
    code: 'INVALID_OP',
    reason: 'unreadable_op',
    family,
    message,
    validFields: Object.keys(SCHEMAS[family]),
  }
}

/** Keys an op author commonly writes where the discriminator `kind` belongs
 * (the CLI flag is `--op`; other tool schemas say `type`, `action`, …). */
const DISCRIMINATOR_SLIPS = new Set(['op', 'type', 'action', 'name', 'operation', 'opKind', 'op_kind', 'opType', 'op_type', 'method', 'command', 'cmd', 'verb', 'mutation'])

/** An op without `kind` that carries a valid op kind (or a near typo of one)
 * under a likely-mistaken key: an alias above, or a typo of `kind` itself. An
 * exact op kind wins over a near one; otherwise the first such key in order. */
function misnamedDiscriminator(rec: Record<string, unknown>, validKinds: string[]): { key: string; kind: string } | undefined {
  let near: { key: string; kind: string } | undefined
  for (const [key, value] of Object.entries(rec)) {
    if (typeof value !== 'string') continue
    if (!DISCRIMINATOR_SLIPS.has(key) && levenshtein(key.toLowerCase(), 'kind') > 1) continue
    if (validKinds.includes(value)) return { key, kind: value }
    const guess = nearest(value, validKinds)
    if (guess && !near) near = { key, kind: guess }
  }
  return near
}

/**
 * Validate one op's SHAPE against its family schema. Returns null when valid.
 * The one and only shape choke point: every untyped edit path (declarative
 * applyOps / buildChecked and the Code Mode facade) calls this — through
 * mutateChecked — before touching a mutator.
 */
function validateAdmittedOp(family: OpFamily, op: unknown): OpValidationError | null {
  const schema = SCHEMAS[family]
  // An op array is the common "apply these ops" slip — give it a dedicated
  // reason so a caller can branch on it, and a message that names the batch fix.
  if (Array.isArray(op)) {
    return { code: 'INVALID_OP', reason: 'expected_single_op', family, message: unknownOpMessage(family, op), validFields: Object.keys(schema) }
  }
  if (!op || typeof op !== 'object') {
    return { code: 'INVALID_OP', reason: 'unknown_kind', family, message: unknownOpMessage(family, op), validFields: Object.keys(schema) }
  }
  const rec = op as Record<string, unknown>
  const kind = rec.kind
  // Own-property only: `kind in schema` treats inherited Object.prototype names
  // (`toString`, `constructor`, `__proto__`, …) as real op kinds, then dereferences
  // the inherited function as an op spec below and crashes on Object.keys(spec.fields).
  if (typeof kind !== 'string' || !Object.hasOwn(schema, kind)) {
    const validKinds = Object.keys(schema)
    const misnamed = kind === undefined ? misnamedDiscriminator(rec, validKinds) : undefined
    if (misnamed) {
      const { [misnamed.key]: _used, ...rest } = rec
      const corrected = JSON.stringify({ kind: misnamed.kind, ...rest })
      return {
        code: 'INVALID_OP',
        reason: 'unknown_kind',
        family,
        field: misnamed.key,
        message: `${unknownOpMessage(family, op)}. The op discriminator key is "kind", not "${misnamed.key}". Did you mean ${corrected}?`,
        validFields: validKinds,
        didYouMean: 'kind',
      }
    }
    const dym = typeof kind === 'string' ? nearest(kind, validKinds) : undefined
    // Reuse the mutator's own prescriptive phrasing ("valid ops: …") so the
    // message is identical no matter which layer catches the unknown kind; add
    // a typo suggestion on top.
    return {
      code: 'INVALID_OP',
      reason: 'unknown_kind',
      family,
      opKind: typeof kind === 'string' ? kind : undefined,
      message: `${unknownOpMessage(family, op)}${dym ? ` Did you mean "${dym}"?` : ''}`,
      validFields: validKinds,
      didYouMean: dym,
    }
  }

  return validateFields(family, kind, rec, schema[kind]!, '')
}

/** A field of a nested record named exactly `key`, as a dotted path relative
 *  to `fields` (`min` → `range.min`): the author wrote it one level too high. */
function nestedFieldPath(key: string, fields: Record<string, FieldSpec>, seen: Set<RecordShape> = new Set()): string | undefined {
  for (const [name, spec] of Object.entries(fields)) {
    const shape = recordShape(spec)
    if (!shape || seen.has(shape)) continue
    if (Object.hasOwn(shape.fields, key)) return `${name}${spec.type === 'object-array' ? '[]' : ''}.${key}`
    const deeper = nestedFieldPath(key, shape.fields, new Set([...seen, shape]))
    if (deeper) return `${name}${spec.type === 'object-array' ? '[]' : ''}.${deeper}`
  }
  return undefined
}

function recordShape(spec: FieldSpec): RecordShape | undefined {
  return spec.type === 'object' || spec.type === 'object-or-null' || spec.type === 'object-array' ? spec.shape : undefined
}

/** Validate `rec` against `shape`: the op itself (`path` empty) or a nested
 *  record at `path` (`axis.`, `block.children[0].`). Unknown keys, missing
 *  required fields, requireOneOf and primitive types are checked at this level
 *  before any nested record, so the first error is the outermost one. */
function validateFields(family: OpFamily, kind: string, rec: Record<string, unknown>, shape: RecordShape, path: string): OpValidationError | null {
  const names = Object.keys(shape.fields)
  const validFields = names.map(name => path + name)
  const owner = path ? ` of ${path.slice(0, -1)}` : ''

  // 1) Unknown / misnamed fields (this catches the `name`-instead-of-`id` bug).
  for (const key of Object.keys(rec)) {
    if (!path && key === 'kind') continue
    // Own-property only: an inherited field name (`toString`, `constructor`, …) must be
    // reported as an unknown field, not silently accepted via the prototype chain.
    if (!Object.hasOwn(shape.fields, key)) {
      const near = nestedFieldPath(key, shape.fields) ?? nearest(key, names)
      const dym = near === undefined ? undefined : path + near
      return {
        code: 'INVALID_OP',
        reason: 'unknown_field',
        family,
        opKind: kind,
        field: path + key,
        message: `Unknown field "${path + key}" for ${family} op "${kind}".${dym ? ` Did you mean "${dym}"?` : ''} Valid fields${owner}: ${names.join(', ')}.`,
        validFields,
        didYouMean: dym,
      }
    }
  }

  // 2) Missing required fields.
  for (const [name, fspec] of Object.entries(shape.fields)) {
    if (!fspec.required) continue
    if (rec[name] === undefined) {
      return {
        code: 'INVALID_OP',
        reason: 'missing_field',
        family,
        opKind: kind,
        field: path + name,
        message: `Missing required field "${path + name}" (${typeName(fspec)}) for ${family} op "${kind}". Fields${owner}: ${names.join(', ')}.`,
        validFields,
      }
    }
  }

  // 3) requireOneOf (e.g. remove_edge needs index OR id).
  if (shape.requireOneOf && !shape.requireOneOf.some(f => rec[f] !== undefined)) {
    return {
      code: 'INVALID_OP',
      reason: 'require_one_of',
      family,
      opKind: kind,
      ...(path ? { field: path.slice(0, -1) } : {}),
      message: `${family} op "${kind}"${path ? ` field "${path.slice(0, -1)}"` : ''} requires at least one of: ${shape.requireOneOf.map(f => path + f).join(', ')}.`,
      validFields,
    }
  }

  // 4) Present fields must match their declared type.
  for (const [name, fspec] of Object.entries(shape.fields)) {
    if (rec[name] === undefined) continue
    if (!matchesType(fspec, rec[name])) {
      return {
        code: 'INVALID_OP',
        reason: 'wrong_type',
        family,
        opKind: kind,
        field: path + name,
        message: `Field "${path + name}" of ${family} op "${kind}" must be ${typeName(fspec)}, got ${JSON.stringify(rec[name])}.`,
        validFields,
      }
    }
  }

  // 5) Nested records with a declared shape, outermost first.
  for (const [name, fspec] of Object.entries(shape.fields)) {
    const nested = recordShape(fspec)
    const value = rec[name]
    if (!nested || value === undefined || value === null) continue
    const items = fspec.type === 'object-array' ? (value as Record<string, unknown>[]).map((item, index) => [item, `${path}${name}[${index}].`] as const) : [[value as Record<string, unknown>, `${path}${name}.`] as const]
    for (const [item, itemPath] of items) {
      const problem = validateFields(family, kind, item, nested, itemPath)
      if (problem) return problem
    }
  }

  return null
}

export function validateOp(family: OpFamily, op: unknown): OpValidationError | null {
  const admitted = admitOpRecord(op)
  if (!admitted.ok) return unreadableOp(family, admitted.message)
  try {
    return validateAdmittedOp(family, admitted.value)
  } catch {
    return unreadableOp(family, 'operation could not be validated as plain JSON data')
  }
}

/** Machine-readable op menu for a family — { opKind: [fieldName, …] } — the
 *  basis for tool-discovery output. Optional fields are marked with a trailing
 *  `?`; the op's `kind` is implicit and omitted. */
export function opMenu(family: OpFamily): Record<string, string[]> {
  if (!hasOpSchema(family)) {
    throw new RangeError(`family must be one of: ${Object.keys(SCHEMAS).join(', ')}`)
  }
  const out: Record<string, string[]> = {}
  for (const [kind, spec] of Object.entries(SCHEMAS[family])) {
    out[kind] = Object.entries(spec.fields).map(([n, f]) => (f.required ? n : `${n}?`))
  }
  return out
}

/** One field of an op, as a model needs it to fill the op correctly: the name,
 *  whether it is required, and a human type that spells out enum values inline
 *  (e.g. `one of "inheritance", "composition", …`). */
export interface OpFieldDoc {
  name: string
  required: boolean
  type: string
  note?: string
  /** The fields of a nested record (`object`, `object | null`, or each item of
   *  `object[]`), when the shape layer validates them. Omitted where a record
   *  repeats its own shape (block `children`), or is named by reference in
   *  the note (an update record with its add record's fields). */
  fields?: OpFieldDoc[]
}

/** A record that nests records of its own shape (a block's children) is
 *  spelled out where an op field holds it, not again inside a record. */
function describeFields(fields: Record<string, FieldSpec>, nested = false): OpFieldDoc[] {
  return Object.entries(fields).map(([name, f]) => {
    const shape = recordShape(f)
    const selfNesting = shape !== undefined && Object.values(shape.fields).some(field => recordShape(field) === shape)
    return {
      name, required: f.required, type: typeName(f),
      ...(f.note !== undefined ? { note: f.note } : {}),
      ...(shape && !shape.byReference && !(nested && selfNesting) ? { fields: describeFields(shape.fields, true) } : {}),
    }
  })
}

/** Full field shapes for every op of a family — the thing a model must know to
 *  author a correct op without guessing (which the prescriptive INVALID_OP error
 *  only teaches AFTER a wrong guess). Surfaced in `am capabilities --json` and
 *  the declarative MCP tool descriptions so field names, required-ness, and enum
 *  vocabularies are discoverable up front. */
export function describeOps(family: OpFamily): Record<string, OpFieldDoc[]> {
  if (!hasOpSchema(family)) {
    throw new RangeError(`family must be one of: ${Object.keys(SCHEMAS).join(', ')}`)
  }
  const out: Record<string, OpFieldDoc[]> = {}
  for (const [kind, spec] of Object.entries(SCHEMAS[family])) {
    out[kind] = describeFields(spec.fields)
  }
  return out
}

/** Compact one-line signatures for a family's ops — `add_relation(from, to,
 *  relKind, label?)` — for embedding in a tool description. Optional fields carry
 *  a trailing `?`; enum values are left to `describeOps`/the error to keep the
 *  menu short. */
export function opSignatures(family: OpFamily): string[] {
  const menu = opMenu(family)
  return Object.entries(menu).map(([kind, fields]) => `${kind}(${fields.join(', ')})`)
}
