import type { BuiltinSceneRole } from './roles.ts'

export type BrandConstraintAction = 'warn' | 'error'
export type BrandConstraintWarningCode = 'BRAND_CONSTRAINT_WARNING' | 'BRAND_CONSTRAINT_ERROR'

export type BrandConstraintFieldDescriptor =
  | { readonly kind: 'role'; readonly required?: true }
  | { readonly kind: 'number'; readonly minimum: number; readonly maximum: number; readonly required?: true }

/**
 * Single payload-shape authority for every public Brand constraint. Public
 * TypeScript, runtime admission, JSON Schema, diagnostics, and evaluator
 * exhaustiveness project from this record.
 */
export const BRAND_CONSTRAINT_DESCRIPTORS = Object.freeze({
  contrast: Object.freeze({
    properties: Object.freeze({
      role: Object.freeze({ kind: 'role' } as const),
      minimum: Object.freeze({ kind: 'number', minimum: 1, maximum: 21 } as const),
    }),
    recovery: 'Choose an authored text/surface pair that meets the requested ratio, or remove the rule; the renderer will not repaint it.',
  }),
  'accent-area': Object.freeze({
    properties: Object.freeze({
      maxFraction: Object.freeze({ kind: 'number', minimum: 0, maximum: 1, required: true } as const),
    }),
    recovery: 'Reduce authored accent-filled area or raise the declared maximum; the renderer will not rewrite fills.',
  }),
  'mono-role': Object.freeze({
    properties: Object.freeze({
      role: Object.freeze({ kind: 'role', required: true } as const),
    }),
    recovery: 'Use measurable monochrome paint for the named role or remove the rule; the renderer will not rewrite paint.',
  }),
} as const)

export type BrandConstraintKind = keyof typeof BRAND_CONSTRAINT_DESCRIPTORS
export const BRAND_CONSTRAINT_KINDS = Object.freeze(
  Object.keys(BRAND_CONSTRAINT_DESCRIPTORS) as BrandConstraintKind[],
)

type FieldValue<Descriptor extends BrandConstraintFieldDescriptor> =
  Descriptor['kind'] extends 'role' ? BuiltinSceneRole : number

type PropertiesOf<Kind extends BrandConstraintKind> = (typeof BRAND_CONSTRAINT_DESCRIPTORS)[Kind]['properties']
type RequiredPropertyNames<Kind extends BrandConstraintKind> = {
  [Field in keyof PropertiesOf<Kind>]: PropertiesOf<Kind>[Field] extends { readonly required: true } ? Field : never
}[keyof PropertiesOf<Kind>]
type OptionalPropertyNames<Kind extends BrandConstraintKind> = Exclude<keyof PropertiesOf<Kind>, RequiredPropertyNames<Kind>>
type ConstraintPayload<Kind extends BrandConstraintKind> = {
  readonly [Field in RequiredPropertyNames<Kind>]: PropertiesOf<Kind>[Field] extends BrandConstraintFieldDescriptor
    ? FieldValue<PropertiesOf<Kind>[Field]>
    : never
} & {
  readonly [Field in OptionalPropertyNames<Kind>]?: PropertiesOf<Kind>[Field] extends BrandConstraintFieldDescriptor
    ? FieldValue<PropertiesOf<Kind>[Field]>
    : never
}

export type BrandConstraint = {
  [Kind in BrandConstraintKind]: Readonly<{
    kind: Kind
    action: BrandConstraintAction
  } & ConstraintPayload<Kind>>
}[BrandConstraintKind]

export function brandConstraintProperties(kind: BrandConstraintKind): Readonly<Record<string, BrandConstraintFieldDescriptor>> {
  return BRAND_CONSTRAINT_DESCRIPTORS[kind].properties as Readonly<Record<string, BrandConstraintFieldDescriptor>>
}

export function brandConstraintFields(kind: BrandConstraintKind): readonly string[] {
  return Object.freeze(['kind', 'action', ...Object.keys(BRAND_CONSTRAINT_DESCRIPTORS[kind].properties)])
}

export function requiredBrandConstraintFields(kind: BrandConstraintKind): readonly string[] {
  const properties = brandConstraintProperties(kind)
  return Object.freeze(['kind', 'action', ...Object.entries(properties)
    .filter(([, descriptor]) => descriptor.required === true)
    .map(([field]) => field)])
}

export const BRAND_CONSTRAINT_WARNING_POLICY = Object.freeze({
  warn: Object.freeze({ code: 'BRAND_CONSTRAINT_WARNING' as const, severity: 'warning' as const, tier: 'lint' as const }),
  error: Object.freeze({ code: 'BRAND_CONSTRAINT_ERROR' as const, severity: 'error' as const, tier: 'lint' as const }),
})
