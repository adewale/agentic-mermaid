// Runtime-neutral JSON Schema mechanics. Admission budgets and domain-specific
// validators stay at the public boundary; this walk owns schema interpretation.
import { isPlainRecord } from './plain-data.ts'
import { isForbiddenJsonConfigKey } from './json-config-admission.ts'

export type JsonSchema = Readonly<Record<string, unknown>>
export type SchemaPath = readonly (string | number)[]
export interface SchemaProblem {
  readonly path: SchemaPath
  readonly message: string
  /** A field boundary may replace an ordinary mismatch with its expectation. */
  readonly generic: boolean
}

export interface SchemaValidationOptions {
  /** Field diagnostics prefer a branch with the value's runtime kind; schema
   * diagnostics retain the schema's authored union expectation. */
  readonly diagnostics?: 'field' | 'schema'
  readonly validateRuntime?: (value: unknown, schema: JsonSchema, path: SchemaPath) => SchemaProblem[]
  readonly patternMismatch?: (schema: JsonSchema) => string | undefined
}

function schemaRecord(value: unknown): JsonSchema | undefined {
  return isPlainRecord(value) ? value : undefined
}

function dereferenceSchema(schema: JsonSchema, root: JsonSchema): JsonSchema | undefined {
  const reference = schema.$ref
  if (typeof reference !== 'string' || !reference.startsWith('#/')) return undefined
  let cursor: unknown = root
  for (const encoded of reference.slice(2).split('/')) {
    if (!isPlainRecord(cursor)) return undefined
    cursor = cursor[encoded.replaceAll('~1', '/').replaceAll('~0', '~')]
  }
  return schemaRecord(cursor)
}

function schemaMatchesRuntimeKind(value: unknown, schema: JsonSchema, root: JsonSchema): boolean {
  const resolved = dereferenceSchema(schema, root)
  if (resolved) return schemaMatchesRuntimeKind(value, resolved, root)
  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf.map(schemaRecord).filter((entry): entry is JsonSchema => entry !== undefined) : []
  if (anyOf.length > 0) return anyOf.some(candidate => schemaMatchesRuntimeKind(value, candidate, root))
  switch (schema.type) {
    case 'null': return value === null
    case 'string': return typeof value === 'string'
    case 'number': case 'integer': return typeof value === 'number'
    case 'boolean': return typeof value === 'boolean'
    case 'array': return Array.isArray(value)
    case 'object': return isPlainRecord(value)
    default: return true
  }
}

export function validateJsonSchema(
  value: unknown,
  schema: JsonSchema,
  root: JsonSchema = schema,
  path: SchemaPath = [],
  options: SchemaValidationOptions = {},
): SchemaProblem[] {
  const fieldDiagnostics = options.diagnostics === 'field'
  const validate = (value: unknown, schema: JsonSchema, inheritedRoot: JsonSchema, path: SchemaPath, ancestors: Set<object>): SchemaProblem[] => {
    // Embedded schema fragments may introduce their own local references.
    const root = schemaRecord(schema.$defs) ? schema : inheritedRoot
    const problem = (message: string, generic = true): SchemaProblem[] => [{ path, message, generic }]
    if (schema.$ref !== undefined) {
      const resolved = dereferenceSchema(schema, root)
      return resolved ? validate(value, resolved, root, path, ancestors)
        : problem(fieldDiagnostics ? 'uses an unresolved schema reference' : `uses unresolved schema reference ${String(schema.$ref)}`, false)
    }

    const anyOf = Array.isArray(schema.anyOf)
      ? schema.anyOf.map(schemaRecord).filter((entry): entry is JsonSchema => entry !== undefined) : []
    if (anyOf.length > 0) {
      const compatible = fieldDiagnostics ? anyOf.filter(candidate => schemaMatchesRuntimeKind(value, candidate, root)) : []
      const candidates = compatible.length > 0 ? compatible : anyOf
      const alternatives = candidates.map(candidate => validate(value, candidate, root, path, new Set(ancestors)))
      if (!alternatives.some(problems => problems.length === 0)) {
        const expectation = schema['x-agentic-mermaid-validation-expectation']
        if ((!fieldDiagnostics || compatible.length === 0) && typeof expectation === 'string') return problem(`must be ${expectation}`)
        return alternatives.sort((left, right) => left.length - right.length)[0] ?? problem('must match an allowed shape')
      }
    }

    const oneOf = Array.isArray(schema.oneOf)
      ? schema.oneOf.map(schemaRecord).filter((entry): entry is JsonSchema => entry !== undefined) : []
    // Render fields leave exclusive unions to their runtime owner, which can
    // name the failing payload field. Wire schemas retain exact-one admission.
    if (oneOf.length > 0 && !fieldDiagnostics) {
      const matching = oneOf.filter(candidate => validate(value, candidate, root, path, new Set(ancestors)).length === 0)
      if (matching.length !== 1) return problem(`must match exactly one allowed shape (matched ${matching.length})`)
    }
    const equals = fieldDiagnostics ? (left: unknown, right: unknown) => left === right : Object.is
    if (Object.prototype.hasOwnProperty.call(schema, 'const') && !equals(value, schema.const)) return problem(`must equal ${String(schema.const)}`)
    if (Array.isArray(schema.enum) && !(fieldDiagnostics ? schema.enum.includes(value) : schema.enum.some(candidate => Object.is(candidate, value)))) {
      return problem(`must be one of ${schema.enum.map(String).join(' | ')}`)
    }

    const type = schema.type
    const typeIsValid = type === undefined
      || (type === 'null' && value === null)
      || (type === 'string' && typeof value === 'string')
      || (type === 'number' && typeof value === 'number' && Number.isFinite(value))
      || (type === 'integer' && typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value))
      || (type === 'boolean' && typeof value === 'boolean')
      || (type === 'array' && Array.isArray(value))
      || (type === 'object' && isPlainRecord(value))
    if (!typeIsValid) {
      const expected = type === 'number' ? 'a finite number'
        : type === 'integer' ? 'a finite integer'
          : type === 'object' ? 'a plain JSON object'
            : type === 'array' ? 'an array' : type === 'null' ? 'null' : `a ${String(type)}`
      return problem(`must be ${expected}`)
    }
    if (typeof value === 'number') {
      if (typeof schema.minimum === 'number' && value < schema.minimum) return problem(`must be at least ${schema.minimum}`)
      if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) return problem(`must be greater than ${schema.exclusiveMinimum}`)
      if (typeof schema.maximum === 'number' && value > schema.maximum) return problem(`must be at most ${schema.maximum}`)
    }
    if (typeof value === 'string') {
      if (typeof schema.minLength === 'number' && value.length < schema.minLength) return problem(`must contain at least ${schema.minLength} character${schema.minLength === 1 ? '' : 's'}`)
      if (typeof schema.pattern === 'string') {
        let matches: boolean
        try { matches = new RegExp(schema.pattern, fieldDiagnostics ? undefined : 'u').test(value) }
        catch { return problem('uses an invalid schema pattern', false) }
        if (!matches) return problem(options.patternMismatch?.(schema) ?? `must match ${schema.pattern}`)
      }
      if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return problem(`must contain at most ${schema.maxLength} characters`)
    }
    if (Array.isArray(value) && type === 'array') {
      if (typeof schema.minItems === 'number' && value.length < schema.minItems) return problem(`must contain at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}`)
      if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return problem(`must contain at most ${schema.maxItems} items`)
      if (ancestors.has(value)) return problem('must be acyclic', false)
      const items = schemaRecord(schema.items)
      if (items) {
        ancestors.add(value)
        try {
          const problems = value.flatMap((item, index) => validate(item, items, root, [...path, index], ancestors))
          if (problems.length > 0) return problems
        } finally { ancestors.delete(value) }
      }
    }
    if (isPlainRecord(value) && (type === 'object' || schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined)) {
      if (ancestors.has(value)) return problem('must be acyclic', false)
      ancestors.add(value)
      try {
        const properties = schemaRecord(schema.properties) ?? {}
        const required = Array.isArray(schema.required) ? schema.required.filter((entry): entry is string => typeof entry === 'string') : []
        const problems: SchemaProblem[] = []
        for (const key of required) {
          if (!Object.prototype.hasOwnProperty.call(value, key)) problems.push({ path: [...path, key], message: 'is required', generic: false })
        }
        for (const [key, child] of Object.entries(value)) {
          if (isForbiddenJsonConfigKey(key)) {
            problems.push({ path: [...path, key], message: 'uses a forbidden prototype key', generic: false })
            continue
          }
          const propertySchema = schemaRecord(properties[key])
          if (propertySchema) {
            problems.push(...validate(child, propertySchema, root, [...path, key], ancestors))
            continue
          }
          if (schema.additionalProperties === false) {
            problems.push({ path: [...path, key], message: 'is not allowed', generic: false })
            continue
          }
          const additionalSchema = schemaRecord(schema.additionalProperties)
          if (additionalSchema) problems.push(...validate(child, additionalSchema, root, [...path, key], ancestors))
        }
        if (problems.length > 0) return problems
      } finally { ancestors.delete(value) }
    }
    return options.validateRuntime?.(value, schema, path) ?? []
  }
  return validate(value, schema, root, path, new Set())
}
