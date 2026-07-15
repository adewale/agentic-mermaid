export const BRAND_CONSTRAINT_DESCRIPTORS = Object.freeze({
  contrast: Object.freeze({
    fields: Object.freeze(['kind', 'action', 'role', 'minimum'] as const),
    required: Object.freeze(['kind', 'action'] as const),
    recovery: 'Choose an authored text/surface pair that meets the requested ratio, or remove the rule; the renderer will not repaint it.',
  }),
  'accent-area': Object.freeze({
    fields: Object.freeze(['kind', 'action', 'maxFraction'] as const),
    required: Object.freeze(['kind', 'action', 'maxFraction'] as const),
    recovery: 'Reduce authored accent-filled area or raise the declared maximum; the renderer will not rewrite fills.',
  }),
  'mono-role': Object.freeze({
    fields: Object.freeze(['kind', 'action', 'role'] as const),
    required: Object.freeze(['kind', 'action', 'role'] as const),
    recovery: 'Use measurable monochrome paint for the named role or remove the rule; the renderer will not rewrite paint.',
  }),
} as const)

export type BrandConstraintKind = keyof typeof BRAND_CONSTRAINT_DESCRIPTORS
export type BrandConstraintAction = 'warn' | 'error'
export type BrandConstraintWarningCode = 'BRAND_CONSTRAINT_WARNING' | 'BRAND_CONSTRAINT_ERROR'

export const BRAND_CONSTRAINT_KINDS = Object.freeze(
  Object.keys(BRAND_CONSTRAINT_DESCRIPTORS) as BrandConstraintKind[],
)
export const BRAND_CONSTRAINT_WARNING_POLICY = Object.freeze({
  warn: Object.freeze({ code: 'BRAND_CONSTRAINT_WARNING' as const, severity: 'warning' as const, tier: 'lint' as const }),
  error: Object.freeze({ code: 'BRAND_CONSTRAINT_ERROR' as const, severity: 'error' as const, tier: 'lint' as const }),
})
