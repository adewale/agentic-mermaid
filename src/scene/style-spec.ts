import { safeCssColor } from '../shared/css-color.ts'
import { safeCssFontFamily } from '../shared/css-font.ts'

/**
 * The persisted StyleSpec wire format. Inputs may omit the version; registry
 * and stack resolution normalize it to this value before returning a spec.
 */
export const STYLE_SPEC_FORMAT_VERSION = 1 as const

type FieldGroup = 'metadata' | 'palette' | 'typography' | 'stroke' | 'fill' | 'page' | 'advisory'

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

type StyleFieldDescriptor =
  | ConstField
  | StringField
  | BooleanField
  | NumberField
  | EnumField
  | ColorsField

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
    description: 'Fill treatment; sketch backends interpret hachure and wash.',
  },
  hachureAngle: {
    kind: 'number', minimum: -360, maximum: 360, expected: 'between -360 and 360',
    group: 'fill', description: 'Hachure line angle in degrees.',
  },
  hachureGap: {
    kind: 'number', exclusiveMinimum: 0, maximum: 100, expected: 'greater than 0 and at most 100',
    group: 'fill', description: 'Gap between hachure lines.',
  },
  fillWeight: {
    kind: 'number', exclusiveMinimum: 0, maximum: 20, expected: 'greater than 0 and at most 20',
    group: 'fill', description: 'Hachure line weight.',
  },
  washOpacity: {
    kind: 'number', minimum: 0, maximum: 1, expected: 'between 0 and 1',
    group: 'fill', description: 'Watercolor glaze opacity.',
  },
  washEdge: {
    kind: 'number', minimum: 0, maximum: 1, expected: 'between 0 and 1',
    group: 'fill', description: 'Watercolor edge-darkening opacity.',
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

function numberIsValid(value: unknown, descriptor: NumberField): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (descriptor.kind === 'integer' && !Number.isInteger(value)) return false
  if (descriptor.minimum !== undefined && value < descriptor.minimum) return false
  if (descriptor.exclusiveMinimum !== undefined && value <= descriptor.exclusiveMinimum) return false
  if (descriptor.maximum !== undefined && value > descriptor.maximum) return false
  return true
}

/**
 * Validate untrusted JSON-like input against the canonical field manifest.
 * Style data is declarative by construction: it cannot carry markup or URLs,
 * and colors must pass the shared non-fetching CSS-color policy.
 */
export function validateStyleSpec(value: unknown): string[] {
  if (!isPlainRecord(value)) return ['style spec must be a plain object']

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
  return problems
}

type JsonSchema = Readonly<Record<string, unknown>>

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
    case 'colors':
      return {
        type: 'object',
        additionalProperties: false,
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
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://agentic-mermaid.dev/schemas/style-spec.schema.json',
    title: 'Agentic Mermaid StyleSpec',
    description: 'A partial declarative style record for Agentic Mermaid rendering. All fields, including formatVersion, are optional on input; resolved and registered specs normalize formatVersion to 1.',
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(Object.entries(STYLE_SPEC_FIELD_DESCRIPTORS).map(([name, descriptor]) => [name, fieldJsonSchema(descriptor)])),
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
