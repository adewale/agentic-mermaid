import { safeCssColor, safeCssPaint } from '../shared/css-color.ts'
import { safeCssFontFamily } from '../shared/css-font.ts'
import { SCENE_ROLE_DESCRIPTORS, type BuiltinSceneRole } from './roles.ts'
import {
  BINDABLE_ROLE_STYLE_PROPERTIES,
  BINDABLE_SCENE_ROLES,
  EXACT_STYLE_SCENE_ROLES,
  ROLE_STYLE_PROPERTY_DESCRIPTORS,
  type BindableSceneRole,
  type ExactStyleSceneRole,
  type RoleStyleFor,
  type RoleStyleSpec,
  type RoleStyles,
} from './role-style-contract.ts'
export {
  BINDABLE_ROLE_STYLE_PROPERTIES,
  BINDABLE_SCENE_ROLES,
  EXACT_ROLE_STYLE_CONTRACT,
  EXACT_STYLE_SCENE_ROLES,
  ROLE_STYLE_PROPERTY_DESCRIPTORS,
} from './role-style-contract.ts'
export type {
  BindableSceneRole,
  ExactStyleSceneRole,
  RoleStyleFor,
  RoleStyleSpec,
  RoleStyles,
} from './role-style-contract.ts'
import { JSON_CONFIG_ADMISSION_LIMITS, limitJsonConfigDiagnostics } from '../shared/json-config-admission.ts'
import {
  BRAND_CONSTRAINT_DESCRIPTORS,
  BRAND_CONSTRAINT_KINDS,
  brandConstraintFields,
  brandConstraintProperties,
  requiredBrandConstraintFields,
  type BrandConstraint,
  type BrandConstraintFieldDescriptor,
} from './brand-constraint-contract.ts'
export { BRAND_CONSTRAINT_DESCRIPTORS, BRAND_CONSTRAINT_KINDS } from './brand-constraint-contract.ts'
export type { BrandConstraint, BrandConstraintAction, BrandConstraintKind } from './brand-constraint-contract.ts'

/**
 * The persisted StyleSpec wire format. Inputs may omit the version; registry
 * and stack resolution normalize it to this value before returning a spec.
 */
export const STYLE_SPEC_FORMAT_VERSION = 1 as const

type FieldGroup = 'metadata' | 'palette' | 'typography' | 'roles' | 'policy' | 'stroke' | 'fill' | 'page' | 'advisory'

interface FieldBase {
  readonly group: FieldGroup
  readonly description: string
}

interface ConstField extends FieldBase {
  readonly kind: 'const'
  readonly value: typeof STYLE_SPEC_FORMAT_VERSION
}

interface StringField extends FieldBase {
  readonly kind: 'string'
  readonly runtimeValidator?: 'safeCssFontFamily'
}

interface BooleanField extends FieldBase {
  readonly kind: 'boolean'
}

interface NumberField extends FieldBase {
  readonly kind: 'number' | 'integer'
  readonly minimum?: number
  readonly exclusiveMinimum?: number
  readonly maximum?: number
  readonly expected: string
}

interface EnumField<Values extends readonly string[] = readonly string[]> extends FieldBase {
  readonly kind: 'enum'
  readonly values: Values
}

interface ColorsField extends FieldBase {
  readonly kind: 'colors'
}

interface RolesField extends FieldBase {
  readonly kind: 'roles'
}
interface SemanticSlotsField extends FieldBase { readonly kind: 'semanticSlots' }
interface BindingsField extends FieldBase { readonly kind: 'bindings' }
interface ConstraintsField extends FieldBase { readonly kind: 'constraints' }

type StyleFieldDescriptor =
  | ConstField
  | StringField
  | BooleanField
  | NumberField
  | EnumField
  | ColorsField
  | RolesField
  | SemanticSlotsField
  | BindingsField
  | ConstraintsField

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

/**
 * One authority for the public palette vocabulary. The runtime validator,
 * TypeScript type, JSON Schema, and generated field reference all project
 * from this record.
 */
export const STYLE_COLOR_TOKEN_DESCRIPTORS = deepFreeze({
  bg: { description: 'Diagram page background.' },
  fg: { description: 'Primary text and foreground paint.' },
  line: { description: 'Connector and secondary line paint.' },
  accent: { description: 'Accent paint for emphasis and data series.' },
  muted: { description: 'Muted text and secondary data paint.' },
  surface: { description: 'Node and group surface fill.' },
  border: { description: 'Node and group border paint.' },
} as const)

export type StyleColors = {
  -readonly [Key in keyof typeof STYLE_COLOR_TOKEN_DESCRIPTORS]?: string
}

type RolePropertyDescriptor = (typeof ROLE_STYLE_PROPERTY_DESCRIPTORS)[keyof typeof ROLE_STYLE_PROPERTY_DESCRIPTORS]

// V1 exposes only channels with typed family emitters and renderer witnesses.
// Additions require census evidence, layout/render consumption, and diagnostics.
export const SEMANTIC_BINDING_CHANNELS = Object.freeze(['category'] as const)
export type SemanticBindingChannel = typeof SEMANTIC_BINDING_CHANNELS[number]
export interface SemanticBinding {
  readonly channel: SemanticBindingChannel
  readonly value: string
  readonly slot: string
  readonly role?: BindableSceneRole
}
export type SemanticSlots = Readonly<Record<string, Readonly<RoleStyleSpec>>>

/**
 * One authority for every public StyleSpec field and constraint. Keep
 * renderer-private face defaults out of this manifest: they are not part of
 * the external style contract.
 */
export const STYLE_SPEC_FIELD_DESCRIPTORS = deepFreeze({
  formatVersion: {
    kind: 'const',
    value: STYLE_SPEC_FORMAT_VERSION,
    group: 'metadata',
    description: 'Persisted wire-format version. Optional on input and normalized to 1 on output.',
  },
  $schema: {
    kind: 'string',
    group: 'metadata',
    description: 'Optional JSON Schema pointer for file-backed styles; ignored while rendering.',
  },
  name: {
    kind: 'string',
    group: 'metadata',
    description: 'Canonical look:name or palette:name identity; required only when registering a style.',
  },
  blurb: {
    kind: 'string',
    group: 'metadata',
    description: 'Short human-readable description used by discovery surfaces.',
  },
  colors: {
    kind: 'colors',
    group: 'palette',
    description: 'Partial palette of safe, non-fetching CSS color tokens.',
  },
  font: {
    kind: 'string',
    runtimeValidator: 'safeCssFontFamily',
    group: 'typography',
    description: 'Safe, non-fetching CSS font family or stack; the rendering environment supplies the font face.',
  },
  roles: {
    kind: 'roles',
    group: 'roles',
    description: 'Partial semantic SceneRole defaults. Family-authored styling remains authoritative.',
  },
  semanticSlots: {
    kind: 'semanticSlots', group: 'policy',
    description: 'Named brand-neutral role-style slots selected by semantic bindings.',
  },
  bindings: {
    kind: 'bindings', group: 'policy',
    description: 'Ordered equality bindings from authored/domain meaning to semantic slots.',
  },
  constraints: {
    kind: 'constraints', group: 'policy',
    description: 'Closed inspect-only brand constraints with warn or error actions.',
  },
  stroke: {
    kind: 'enum',
    values: ['crisp', 'jittered', 'freehand'],
    group: 'stroke',
    description: 'Stroke treatment; crisp is the default renderer.',
  },
  roughness: {
    kind: 'number', minimum: 0, maximum: 10, expected: 'between 0 and 10',
    group: 'stroke', description: 'Rough.js stroke irregularity.',
  },
  bowing: {
    kind: 'number', minimum: 0, maximum: 10, expected: 'between 0 and 10',
    group: 'stroke', description: 'Rough.js line bowing.',
  },
  passes: {
    kind: 'integer', minimum: 1, maximum: 8, expected: 'an integer from 1 through 8',
    group: 'stroke', description: 'Number of sketch strokes; 1 is single-pass and 2 is the usual double stroke.',
  },
  strokeWidth: {
    kind: 'number', exclusiveMinimum: 0, maximum: 20, expected: 'greater than 0 and at most 20',
    group: 'stroke', description: 'Base stroke width in SVG user units.',
  },
  fill: {
    kind: 'enum',
    values: ['none', 'hachure', 'solid', 'wash'],
    group: 'fill',
    description: 'Fill policy for rough/hybrid rendering; none and solid require a final stack that activates one of those backends.',
  },
  hachureAngle: {
    kind: 'number', minimum: -360, maximum: 360, expected: 'between -360 and 360',
    group: 'fill', description: 'Hachure line angle in degrees; requires fill hachure in the final stack.',
  },
  hachureGap: {
    kind: 'number', exclusiveMinimum: 0, maximum: 100, expected: 'greater than 0 and at most 100',
    group: 'fill', description: 'Gap between hachure lines; requires fill hachure in the final stack.',
  },
  fillWeight: {
    kind: 'number', exclusiveMinimum: 0, maximum: 20, expected: 'greater than 0 and at most 20',
    group: 'fill', description: 'Hachure line weight; requires fill hachure in the final stack.',
  },
  washOpacity: {
    kind: 'number', minimum: 0, maximum: 1, expected: 'between 0 and 1',
    group: 'fill', description: 'Watercolor glaze opacity; requires fill wash in the final stack.',
  },
  washEdge: {
    kind: 'number', minimum: 0, maximum: 1, expected: 'between 0 and 1',
    group: 'fill', description: 'Watercolor edge-darkening opacity; requires fill wash in the final stack.',
  },
  backdrop: {
    kind: 'enum',
    values: ['plain', 'paper-ruled', 'grid'],
    group: 'page',
    description: 'Flat page furniture drawn behind the diagram.',
  },
  intent: {
    kind: 'enum',
    values: ['premium', 'draft', 'lofi'],
    group: 'advisory',
    description: 'Advisory intent metadata for pickers and quality tooling.',
  },
  mono: {
    kind: 'boolean',
    group: 'advisory',
    description: 'Advisory monochrome contract: express tone through shading and weight.',
  },
} as const satisfies Record<string, StyleFieldDescriptor>)

type DescriptorValue<Descriptor> =
  Descriptor extends { readonly kind: 'const'; readonly value: infer Value } ? Value
    : Descriptor extends { readonly kind: 'string' } ? string
      : Descriptor extends { readonly kind: 'boolean' } ? boolean
        : Descriptor extends { readonly kind: 'number' | 'integer' } ? number
          : Descriptor extends { readonly kind: 'enum'; readonly values: readonly (infer Value)[] } ? Value
            : Descriptor extends { readonly kind: 'colors' } ? StyleColors
              : Descriptor extends { readonly kind: 'roles' } ? RoleStyles
                : Descriptor extends { readonly kind: 'semanticSlots' } ? SemanticSlots
                  : Descriptor extends { readonly kind: 'bindings' } ? readonly SemanticBinding[]
                    : Descriptor extends { readonly kind: 'constraints' } ? readonly BrandConstraint[]
                      : never

/** A partial, composable public description of how diagrams look. */
export type StyleSpec = {
  -readonly [Key in keyof typeof STYLE_SPEC_FIELD_DESCRIPTORS]?: DescriptorValue<(typeof STYLE_SPEC_FIELD_DESCRIPTORS)[Key]>
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function numberIsValid(value: unknown, descriptor: Pick<NumberField, 'minimum' | 'exclusiveMinimum' | 'maximum'> & { kind?: string }): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (descriptor.kind === 'integer' && !Number.isInteger(value)) return false
  if (descriptor.minimum !== undefined && value < descriptor.minimum) return false
  if (descriptor.exclusiveMinimum !== undefined && value <= descriptor.exclusiveMinimum) return false
  if (descriptor.maximum !== undefined && value > descriptor.maximum) return false
  return true
}

export const STYLE_OWNED_PAINT_VARIABLES = Object.freeze([
  '--bg', '--fg', '--_text', '--_text-sec', '--_text-muted', '--_text-faint',
  '--_line', '--_arrow', '--_node-fill', '--_node-stroke', '--_group-fill',
  '--_group-hdr', '--_inner-stroke', '--_key-badge',
] as const)
const STYLE_OWNED_PAINT_VARIABLE_SET: ReadonlySet<string> = new Set(STYLE_OWNED_PAINT_VARIABLES)
function safeRoleColor(value: unknown): value is string {
  if (typeof value !== 'string' || safeCssPaint(value) === undefined) return false
  const variables = [...value.matchAll(/var\(\s*(--[a-z0-9_-]+)/gi)].map(match => match[1]!)
  return variables.every(variable => STYLE_OWNED_PAINT_VARIABLE_SET.has(variable))
}

const SCENE_ROLE_BY_NAME = new Map(SCENE_ROLE_DESCRIPTORS.map(descriptor => [descriptor.role, descriptor] as const))
const EXACT_SCENE_ROLE_DESCRIPTORS = EXACT_STYLE_SCENE_ROLES.map(role => SCENE_ROLE_BY_NAME.get(role)!)
const BINDABLE_SCENE_ROLE_SET: ReadonlySet<string> = new Set(BINDABLE_SCENE_ROLES)
const SLOT_NAME = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/
const FORBIDDEN_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function validateRoleStyleRecord(raw: unknown, path: string, applicable?: ReadonlySet<string>): string[] {
  if (!isPlainRecord(raw)) return [`"${path}" must be an object`]
  const problems: string[] = []
  for (const [property, candidate] of Object.entries(raw)) {
    if (!Object.hasOwn(ROLE_STYLE_PROPERTY_DESCRIPTORS, property)) {
      problems.push(`unknown role style field "${path.slice(path.indexOf('.') + 1)}.${property}"`)
      continue
    }
    if (applicable && !applicable.has(property)) {
      problems.push(`role style field "${path}.${property}" is not applicable`)
      continue
    }
    const descriptor = (ROLE_STYLE_PROPERTY_DESCRIPTORS as Record<string, RolePropertyDescriptor>)[property]!
    const leaf = `${path}.${property}`
    if (candidate === undefined) continue
    if (descriptor.kind === 'number' && !numberIsValid(candidate, descriptor)) problems.push(`"${leaf}" must be ${descriptor.expected}`)
    else if (descriptor.kind === 'font' && (typeof candidate !== 'string' || safeCssFontFamily(candidate) === undefined)) problems.push(`"${leaf}" must be a safe non-fetching CSS font family or stack`)
    else if (descriptor.kind === 'color' && !safeRoleColor(candidate)) problems.push(`"${leaf}" must be a safe non-fetching CSS paint`)
    else if (descriptor.kind === 'enum' && (typeof candidate !== 'string' || !(descriptor.values as readonly string[]).includes(candidate))) problems.push(`"${leaf}" must be one of ${descriptor.values.join(' | ')}`)
  }
  return problems
}

function validateRoleStyles(value: unknown): string[] {
  if (!isPlainRecord(value)) return ['"roles" must be an object of SceneRole records']
  const problems: string[] = []
  for (const [role, raw] of Object.entries(value)) {
    const roleDescriptor = SCENE_ROLE_BY_NAME.get(role as BuiltinSceneRole)
    if (!roleDescriptor) { problems.push(`unknown scene role "${role}"`); continue }
    if (roleDescriptor.traits.styleConsumption === 'fallback-only') {
      problems.push(`scene role "${role}" is fallback-only; set roles.${roleDescriptor.style.fallbackRole} instead`)
      continue
    }
    const applicable = new Set<string>(roleDescriptor.style.applicableProperties)
    const roleProblems = validateRoleStyleRecord(raw, `roles.${role}`, applicable)
      .map(problem => problem === `"roles.${role}" must be an object` ? problem
        : problem.replace(`role style field "roles.${role}.`, `role style field "${role}.`)
          .replace('" is not applicable', `" is not applicable to ${role} roles`))
    problems.push(...roleProblems)
  }
  return problems
}

function validSlotName(value: unknown): value is string {
  return typeof value === 'string' && SLOT_NAME.test(value) && !FORBIDDEN_RECORD_KEYS.has(value)
}

function validateSemanticSlots(value: unknown): string[] {
  if (!isPlainRecord(value)) return ['"semanticSlots" must be an object of named role-style slots']
  if (Object.keys(value).length > JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer) return [`"semanticSlots" must contain at most ${JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer} slots`]
  const problems: string[] = []
  for (const [slot, raw] of Object.entries(value)) {
    if (!validSlotName(slot)) { problems.push(`invalid semantic slot name "${slot}"`); continue }
    problems.push(...validateRoleStyleRecord(raw, `semanticSlots.${slot}`))
  }
  return problems
}

function validateBindings(value: unknown): string[] {
  if (!Array.isArray(value)) return ['"bindings" must be an array']
  if (value.length > JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer) return [`"bindings" must contain at most ${JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer} entries`]
  const problems: string[] = []
  value.forEach((raw, index) => {
    const path = `bindings[${index}]`
    if (!isPlainRecord(raw)) { problems.push(`"${path}" must be an object`); return }
    for (const field of Object.keys(raw)) if (!['channel', 'value', 'slot', 'role'].includes(field)) problems.push(`unknown binding field "${path}.${field}"`)
    if (typeof raw.channel !== 'string' || !(SEMANTIC_BINDING_CHANNELS as readonly string[]).includes(raw.channel)) problems.push(`"${path}.channel" must be one of ${SEMANTIC_BINDING_CHANNELS.join(' | ')}`)
    if (typeof raw.value !== 'string' || raw.value.length === 0 || raw.value.length > 256 || /[\r\n\0]/.test(raw.value)) problems.push(`"${path}.value" must be a non-empty single-line string of at most 256 characters`)
    if (!validSlotName(raw.slot)) problems.push(`"${path}.slot" must be a valid semantic slot name`)
    if (raw.role !== undefined && !BINDABLE_SCENE_ROLE_SET.has(raw.role as string)) problems.push(`"${path}.role" must be a SceneRole with an executable category-binding consumer (${BINDABLE_SCENE_ROLES.join(' | ')})`)
  })
  return problems
}

function validateConstraints(value: unknown): string[] {
  if (!Array.isArray(value)) return ['"constraints" must be an array']
  if (value.length > JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer) return [`"constraints" must contain at most ${JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer} entries`]
  const problems: string[] = []
  value.forEach((raw, index) => {
    const path = `constraints[${index}]`
    if (!isPlainRecord(raw)) { problems.push(`"${path}" must be an object`); return }
    if (typeof raw.kind !== 'string' || !(BRAND_CONSTRAINT_KINDS as readonly string[]).includes(raw.kind)) {
      problems.push(`"${path}.kind" must be one of ${BRAND_CONSTRAINT_KINDS.join(' | ')}`)
      return
    }
    const kind = raw.kind as keyof typeof BRAND_CONSTRAINT_DESCRIPTORS
    const properties = brandConstraintProperties(kind)
    const allowed = new Set(brandConstraintFields(kind))
    for (const field of Object.keys(raw)) if (!allowed.has(field)) problems.push(`unknown constraint field "${path}.${field}"`)
    if (raw.action !== 'warn' && raw.action !== 'error') problems.push(`"${path}.action" must be one of warn | error`)
    for (const [field, fieldDescriptor] of Object.entries(properties)) {
      const candidate = raw[field]
      if (candidate === undefined) {
        if (fieldDescriptor.required) problems.push(`"${path}.${field}" is required for ${kind}`)
        continue
      }
      if (fieldDescriptor.kind === 'role' && !SCENE_ROLE_BY_NAME.has(candidate as BuiltinSceneRole)) {
        problems.push(`"${path}.${field}" must be a registered built-in SceneRole`)
      } else if (fieldDescriptor.kind === 'number' && !numberIsValid(candidate, fieldDescriptor)) {
        problems.push(`"${path}.${field}" must be between ${fieldDescriptor.minimum} and ${fieldDescriptor.maximum}`)
      }
    }
  })
  return problems
}

/**
 * Validate untrusted JSON-like input against the canonical field manifest.
 * Style data is declarative by construction: it cannot carry markup or URLs,
 * and colors must pass the shared non-fetching CSS-color policy.
 */
export function validateStyleSpec(value: unknown): string[] {
  if (!isPlainRecord(value)) return ['style spec must be a plain object']
  if (Object.keys(value).length > JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer) return [`style spec must contain at most ${JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer} fields`]

  const problems: string[] = []
  for (const [key, fieldValue] of Object.entries(value)) {
    if (!Object.hasOwn(STYLE_SPEC_FIELD_DESCRIPTORS, key)) {
      problems.push(`unknown field "${key}"`)
      continue
    }
    const descriptor = (STYLE_SPEC_FIELD_DESCRIPTORS as Record<string, StyleFieldDescriptor>)[key]!
    if (fieldValue === undefined) continue

    switch (descriptor.kind) {
      case 'const':
        if (fieldValue !== descriptor.value) problems.push(`"${key}" must be ${descriptor.value}`)
        break
      case 'string':
        if (typeof fieldValue !== 'string') problems.push(`"${key}" must be a string`)
        else if (descriptor.runtimeValidator === 'safeCssFontFamily' && safeCssFontFamily(fieldValue) === undefined) {
          problems.push(`"${key}" must be a safe non-fetching CSS font family or stack`)
        }
        break
      case 'boolean':
        if (typeof fieldValue !== 'boolean') problems.push(`"${key}" must be a boolean`)
        break
      case 'number':
      case 'integer':
        if (!numberIsValid(fieldValue, descriptor)) problems.push(`"${key}" must be ${descriptor.expected}`)
        break
      case 'enum':
        if (typeof fieldValue !== 'string' || !descriptor.values.includes(fieldValue)) {
          problems.push(`"${key}" must be one of ${descriptor.values.join(' | ')}`)
        }
        break
      case 'roles':
        problems.push(...validateRoleStyles(fieldValue))
        break
      case 'semanticSlots':
        problems.push(...validateSemanticSlots(fieldValue))
        break
      case 'bindings':
        problems.push(...validateBindings(fieldValue))
        break
      case 'constraints':
        problems.push(...validateConstraints(fieldValue))
        break
      case 'colors': {
        if (!isPlainRecord(fieldValue)) {
          problems.push('"colors" must be an object of color tokens')
          break
        }
        for (const [token, color] of Object.entries(fieldValue)) {
          if (!Object.hasOwn(STYLE_COLOR_TOKEN_DESCRIPTORS, token)) problems.push(`unknown color token "${token}"`)
          else if (color !== undefined && typeof color !== 'string') problems.push(`color token "${token}" must be a string`)
          else if (color !== undefined && safeCssColor(color) === undefined) problems.push(`color token "${token}" must be a safe non-fetching CSS color`)
        }
        break
      }
    }
  }
  return limitJsonConfigDiagnostics(problems, 'Style validation')
}

type JsonSchema = Readonly<Record<string, unknown>>

function rolePropertyJsonSchemas(): Record<string, unknown> {
  return Object.fromEntries(Object.entries(ROLE_STYLE_PROPERTY_DESCRIPTORS).map(([name, property]) => {
    if (property.kind === 'number') {
      const numeric = property as { minimum?: number; exclusiveMinimum?: number; maximum?: number; description: string }
      return [name, { type: 'number', ...(numeric.minimum !== undefined ? { minimum: numeric.minimum } : {}), ...(numeric.exclusiveMinimum !== undefined ? { exclusiveMinimum: numeric.exclusiveMinimum } : {}), ...(numeric.maximum !== undefined ? { maximum: numeric.maximum } : {}), description: numeric.description }]
    }
    if (property.kind === 'enum') return [name, { type: 'string', enum: [...property.values], description: property.description }]
    return [name, { type: 'string', description: property.description, 'x-agentic-mermaid-runtime-validator': property.kind === 'font' ? 'safeCssFontFamily' : 'safeStylePaint' }]
  }))
}

function roleStyleJsonSchema(properties: readonly string[] = Object.keys(ROLE_STYLE_PROPERTY_DESCRIPTORS)): JsonSchema {
  const schemas = rolePropertyJsonSchemas()
  return { type: 'object', additionalProperties: false, maxProperties: properties.length, properties: Object.fromEntries(properties.map(property => [property, schemas[property]])) }
}

function roleStyleDefinitionName(role: (typeof SCENE_ROLE_DESCRIPTORS)[number]): string {
  return `roleStyle-${role.role}`
}

const SLOT_NAME_PATTERN = '^[A-Za-z][A-Za-z0-9._-]{0,63}$'

function fieldJsonSchema(descriptor: StyleFieldDescriptor): JsonSchema {
  switch (descriptor.kind) {
    case 'const':
      return { const: descriptor.value, description: descriptor.description }
    case 'string':
      return {
        type: 'string',
        description: descriptor.description,
        ...(descriptor.runtimeValidator ? { 'x-agentic-mermaid-runtime-validator': descriptor.runtimeValidator } : {}),
      }
    case 'boolean':
      return { type: 'boolean', description: descriptor.description }
    case 'enum':
      return { type: 'string', enum: [...descriptor.values], description: descriptor.description }
    case 'number':
    case 'integer':
      return {
        type: descriptor.kind,
        ...(descriptor.minimum !== undefined ? { minimum: descriptor.minimum } : {}),
        ...(descriptor.exclusiveMinimum !== undefined ? { exclusiveMinimum: descriptor.exclusiveMinimum } : {}),
        ...(descriptor.maximum !== undefined ? { maximum: descriptor.maximum } : {}),
        description: descriptor.description,
      }
    case 'roles':
      return {
        type: 'object', additionalProperties: false, description: descriptor.description,
        properties: Object.fromEntries(EXACT_SCENE_ROLE_DESCRIPTORS.map(role => [role.role, { $ref: `#/$defs/${roleStyleDefinitionName(role)}` }])),
      }
    case 'semanticSlots':
      return {
        type: 'object', description: descriptor.description,
        maxProperties: JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer,
        propertyNames: { pattern: SLOT_NAME_PATTERN, not: { enum: [...FORBIDDEN_RECORD_KEYS] } },
        additionalProperties: { $ref: '#/$defs/roleStyle-any' },
      }
    case 'bindings':
      return {
        type: 'array', description: descriptor.description,
        maxItems: JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer,
        items: {
          type: 'object', additionalProperties: false, maxProperties: 4, required: ['channel', 'value', 'slot'],
          properties: {
            channel: { type: 'string', enum: [...SEMANTIC_BINDING_CHANNELS] },
            value: { type: 'string', minLength: 1, maxLength: 256, pattern: '^[^\\r\\n\\u0000]+$' },
            slot: { type: 'string', pattern: SLOT_NAME_PATTERN, not: { enum: [...FORBIDDEN_RECORD_KEYS] } },
            role: { type: 'string', enum: [...BINDABLE_SCENE_ROLES] },
          },
        },
      }
    case 'constraints': {
      const action = { type: 'string', enum: ['warn', 'error'] }
      const role = { type: 'string', enum: SCENE_ROLE_DESCRIPTORS.map(item => item.role) }
      const schemas = BRAND_CONSTRAINT_KINDS.map(kind => {
        const properties = brandConstraintProperties(kind)
        const payload = Object.fromEntries(Object.entries(properties).map(([field, fieldDescriptor]) => [
          field,
          fieldDescriptor.kind === 'role'
            ? role
            : { type: 'number', minimum: fieldDescriptor.minimum, maximum: fieldDescriptor.maximum },
        ]))
        return {
          type: 'object', additionalProperties: false,
          required: [...requiredBrandConstraintFields(kind)],
          properties: { kind: { const: kind }, action, ...payload },
        }
      })
      return {
        type: 'array', description: descriptor.description,
        maxItems: JSON_CONFIG_ADMISSION_LIMITS.maxItemsPerContainer,
        items: { oneOf: schemas },
      }
    }
    case 'colors':
      return {
        type: 'object',
        additionalProperties: false,
        maxProperties: Object.keys(STYLE_COLOR_TOKEN_DESCRIPTORS).length,
        description: `${descriptor.description} Runtime validation applies the stricter safe-color policy.`,
        properties: Object.fromEntries(Object.entries(STYLE_COLOR_TOKEN_DESCRIPTORS).map(([token, metadata]) => [token, {
          type: 'string',
          description: `${metadata.description} Must be a safe, non-fetching CSS color.`,
          'x-agentic-mermaid-runtime-validator': 'safeCssColor',
        }])),
      }
  }
}

/** JSON Schema projected from the same descriptors used at runtime. */
export function styleSpecJsonSchema(): JsonSchema {
  const roleStyleDefinitions = Object.fromEntries(
    EXACT_SCENE_ROLE_DESCRIPTORS.map(descriptor => [
      roleStyleDefinitionName(descriptor),
      roleStyleJsonSchema(descriptor.style.applicableProperties),
    ]),
  )
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://agentic-mermaid.dev/schemas/style-spec.schema.json',
    title: 'Agentic Mermaid StyleSpec',
    description: 'A partial declarative style record for Agentic Mermaid rendering. All fields, including formatVersion, are optional on input; resolved and registered specs normalize formatVersion to 1.',
    type: 'object',
    additionalProperties: false,
    maxProperties: Object.keys(STYLE_SPEC_FIELD_DESCRIPTORS).length,
    properties: Object.fromEntries(Object.entries(STYLE_SPEC_FIELD_DESCRIPTORS).map(([name, descriptor]) => [name, fieldJsonSchema(descriptor)])),
    $defs: { ...roleStyleDefinitions, 'roleStyle-any': roleStyleJsonSchema() },
  }
}

function fieldTypeLabel(descriptor: StyleFieldDescriptor): string {
  switch (descriptor.kind) {
    case 'const': return `\`${descriptor.value}\``
    case 'string': return '`string`'
    case 'boolean': return '`boolean`'
    case 'number':
    case 'integer': {
      const constraints = [
        descriptor.minimum !== undefined ? `minimum ${descriptor.minimum}` : undefined,
        descriptor.exclusiveMinimum !== undefined ? `greater than ${descriptor.exclusiveMinimum}` : undefined,
        descriptor.maximum !== undefined ? `maximum ${descriptor.maximum}` : undefined,
      ].filter((value): value is string => value !== undefined)
      return [`\`${descriptor.kind}\``, ...constraints].join('; ')
    }
    case 'enum': return descriptor.values.map(value => `\`${value}\``).join(' \\| ')
    case 'roles': return `object: partial records keyed by exact-style \`SceneRole\``
    case 'semanticSlots': return '`Record<string, RoleStyleSpec>`'
    case 'bindings': return '`SemanticBinding[]`'
    case 'constraints': return '`BrandConstraint[]`'
    case 'colors': return `object: ${Object.keys(STYLE_COLOR_TOKEN_DESCRIPTORS).map(token => `\`${token}\``).join(', ')}`
  }
}

/** Markdown field table projected from the canonical descriptors. */
export function styleSpecFieldReferenceMarkdown(): string {
  const header = '| Group | Field | Type / values | Meaning |\n|---|---|---|---|'
  const rows = Object.entries(STYLE_SPEC_FIELD_DESCRIPTORS).map(([name, descriptor]) =>
    `| ${descriptor.group} | \`${name}\` | ${fieldTypeLabel(descriptor)} | ${descriptor.description} |`,
  )
  return [header, ...rows].join('\n')
}

function rolePropertyTypeScript(name: string): string {
  const descriptor = ROLE_STYLE_PROPERTY_DESCRIPTORS[name as keyof typeof ROLE_STYLE_PROPERTY_DESCRIPTORS]
  if (descriptor.kind === 'number') return 'number'
  if (descriptor.kind === 'enum') return descriptor.values.map(value => JSON.stringify(value)).join(' | ')
  return 'string'
}

function styleFieldTypeScript(descriptor: StyleFieldDescriptor): string {
  if (descriptor.kind === 'const') return String(descriptor.value)
  if (descriptor.kind === 'string') return 'string'
  if (descriptor.kind === 'boolean') return 'boolean'
  if (descriptor.kind === 'number' || descriptor.kind === 'integer') return 'number'
  if (descriptor.kind === 'enum') return descriptor.values.map(value => JSON.stringify(value)).join(' | ')
  if (descriptor.kind === 'colors') return 'StyleColors'
  if (descriptor.kind === 'roles') return 'RoleStyles'
  if (descriptor.kind === 'semanticSlots') return 'Readonly<Record<string, Readonly<RoleStyleSpec>>>'
  if (descriptor.kind === 'bindings') return 'readonly SemanticBinding[]'
  return 'readonly BrandConstraint[]'
}

function constraintTypeScript(kind: keyof typeof BRAND_CONSTRAINT_DESCRIPTORS, compact: boolean): string {
  const properties: Readonly<Record<string, BrandConstraintFieldDescriptor>> = brandConstraintProperties(kind)
  const separator = compact ? ';' : '; '
  const payload = Object.entries(properties).map(([field, fieldDescriptor]) => {
    const optional = fieldDescriptor.required ? '' : '?'
    const type = fieldDescriptor.kind === 'role' ? 'SceneStyleRole' : 'number'
    return `${field}${optional}:${type}`
  })
  return `{kind:${JSON.stringify(kind)}${separator}action:'warn'|'error'${payload.length ? separator : ''}${payload.join(separator)}}`
}

/** Exact agent-facing declaration generated from the runtime/schema authority. */
export function styleSpecTypeScriptDeclaration(options: { readonly compact?: boolean } = {}): string {
  const roleInterface = (name: string, properties: readonly string[]) => {
    const stem = `StyleRole_${name.replace(/[^A-Za-z0-9_]/g, '_')}`
    const fields = properties.map(property => `  ${JSON.stringify(property)}?: ${rolePropertyTypeScript(property)}`).join('\n')
    return { stem, declaration: `interface ${stem} {\n${fields}\n}` }
  }
  const anyRole = roleInterface('Any', Object.keys(ROLE_STYLE_PROPERTY_DESCRIPTORS))
  const exactRoles = EXACT_SCENE_ROLE_DESCRIPTORS.map(descriptor => ({
    role: descriptor.role,
    ...roleInterface(descriptor.role, descriptor.style.applicableProperties),
  }))
  const colors = Object.keys(STYLE_COLOR_TOKEN_DESCRIPTORS).map(token => `  ${token}?: string`).join('\n')
  const roles = exactRoles.map(role => `  ${JSON.stringify(role.role)}?: Readonly<${role.stem}>`).join('\n')
  const styleFields = Object.entries(STYLE_SPEC_FIELD_DESCRIPTORS)
    .map(([name, descriptor]) => `  ${JSON.stringify(name)}?: ${styleFieldTypeScript(descriptor)}`)
    .join('\n')
  const sceneRoleUnion = SCENE_ROLE_DESCRIPTORS.map(role => JSON.stringify(role.role)).join(' | ')
  const exactSceneRoleUnion = EXACT_SCENE_ROLE_DESCRIPTORS.map(role => JSON.stringify(role.role)).join(' | ')
  const bindableSceneRoleUnion = BINDABLE_SCENE_ROLES.map(role => JSON.stringify(role)).join(' | ')
  const compactConstraintUnion = BRAND_CONSTRAINT_KINDS.map(kind => constraintTypeScript(kind, true)).join('|')
  const constraintUnion = BRAND_CONSTRAINT_KINDS.map(kind => `  | ${constraintTypeScript(kind, false)}`).join('\n')
  if (options.compact) {
    const compactRole = Object.keys(ROLE_STYLE_PROPERTY_DESCRIPTORS)
      .map(name => `${JSON.stringify(name)}?:${rolePropertyTypeScript(name)}`).join(';')
    const propertyGroups = new Map<string, string[]>()
    for (const descriptor of EXACT_SCENE_ROLE_DESCRIPTORS) {
      const signature = [...descriptor.style.applicableProperties].sort().join('|')
      propertyGroups.set(signature, [...(propertyGroups.get(signature) ?? []), descriptor.role])
    }
    const roleStyleCases = [...propertyGroups.entries()].map(([signature, roles]) => {
      const match = roles.map(value => JSON.stringify(value)).join(' | ')
      const properties = signature.length === 0 ? 'never' : `Pick<RoleStyleSpec, ${signature.split('|').map(value => JSON.stringify(value)).join(' | ')}>`
      return `R extends ${match}?${properties}:`
    }).join('')
    const compactStyle = Object.entries(STYLE_SPEC_FIELD_DESCRIPTORS)
      .map(([name, descriptor]) => `${JSON.stringify(name)}?:${styleFieldTypeScript(descriptor)}`).join(';')
    const compactColors = Object.keys(STYLE_COLOR_TOKEN_DESCRIPTORS).map(token => `${token}?:string`).join(';')
    return `interface StyleColors {${compactColors}}\ntype SceneStyleRole=${sceneRoleUnion}\ntype ExactSceneStyleRole=${exactSceneRoleUnion}\ntype BindableSceneStyleRole=${bindableSceneRoleUnion}\ntype RoleStyleSpec={${compactRole}}\ntype RoleStyleFor<R extends ExactSceneStyleRole>=${roleStyleCases}never\ntype RoleStyles={[R in ExactSceneStyleRole]?:Readonly<RoleStyleFor<R>>}\ntype SemanticBindingChannel=${SEMANTIC_BINDING_CHANNELS.map(value => JSON.stringify(value)).join(' | ')}\ninterface SemanticBinding {channel:SemanticBindingChannel;value:string;slot:string;role?:BindableSceneStyleRole}\ntype BrandConstraint=${compactConstraintUnion}\ninterface StyleSpec {${compactStyle}}\ntype StyleInput=string|StyleSpec`
  }
  return `interface StyleColors {\n${colors}\n}\ntype SceneStyleRole = ${sceneRoleUnion}\ntype ExactSceneStyleRole = ${exactSceneRoleUnion}\ntype BindableSceneStyleRole = ${bindableSceneRoleUnion}\n${anyRole.declaration}\ntype RoleStyleSpec = StyleRole_Any\n${exactRoles.map(role => role.declaration).join('\n')}\ninterface RoleStyles {\n${roles}\n}\ntype SemanticBindingChannel = ${SEMANTIC_BINDING_CHANNELS.map(value => JSON.stringify(value)).join(' | ')}\ninterface SemanticBinding { channel: SemanticBindingChannel; value: string; slot: string; role?: BindableSceneStyleRole }\ntype BrandConstraint =\n${constraintUnion}\ninterface StyleSpec {\n${styleFields}\n}\ntype StyleInput = string | StyleSpec`
}
