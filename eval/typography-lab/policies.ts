// The typography options under evaluation, each a replacement body for
// src/typography.ts's typeSize(tier, fallback). `fallback` is the family's
// current default for that text; `base` is the body size the option is
// rendered at (13 is today's body size).

export type LabOption = 'current' | 'option1' | 'option2' | 'option3' | 'probe'

export interface LabPolicy {
  readonly option: LabOption
  readonly base: number
}

export const OPTION_LABELS: Readonly<Record<LabOption, string>> = {
  current: 'Today',
  option1: 'Option 1: shared type scale',
  option2: 'Option 2: per-family proportions',
  option3: 'Option 3: independent tier tokens',
  probe: 'Coverage probe (every routed size ×1.5)',
}

/** Option 1 ratios of the base, chosen so base 13 gives 18 / 12 / 13 / 11. */
export const TIER_RATIOS = { title: 18 / 13, heading: 12 / 13, body: 1, detail: 11 / 13 } as const
/** Option 3 tokens: body follows the base; the other tiers stay fixed. */
export const TIER_TOKENS = { title: 18, heading: 12, detail: 11 } as const
export const TODAY_BODY = 13
/** Small enough to stay inside architecture's 10–24px clamp. */
export const PROBE_FACTOR = 1.5

export function policySource(policy: LabPolicy): string {
  const base = Number(policy.base)
  if (!Number.isFinite(base) || base <= 0) throw new Error(`invalid base ${policy.base}`)
  const half = 'const half = (v: number) => Math.round(v * 2) / 2'
  const body = (() => {
    switch (policy.option) {
      case 'current': return 'return fallback'
      case 'probe': return `return fallback * ${PROBE_FACTOR}`
      case 'option2': return `return half(fallback * ${base} / ${TODAY_BODY})`
      case 'option1': return `if (tier === 'mark') return half(fallback * ${base} / ${TODAY_BODY})
  const ratios: Record<string, number> = ${JSON.stringify(TIER_RATIOS)}
  return half(ratios[tier]! * ${base})`
      case 'option3': return `if (tier === 'mark') return fallback
  if (tier === 'body') return ${base}
  const tokens: Record<string, number> = ${JSON.stringify(TIER_TOKENS)}
  return tokens[tier]!`
    }
  })()
  return `export type TextTier = 'title' | 'heading' | 'body' | 'detail' | 'mark'
${half}
export function typeSize(tier: TextTier, fallback: number): number {
  ${body}
}
`
}
