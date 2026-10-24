import type { UnifiedWorkload } from './types.ts'

type DisplayTransform = 'identity' | 'uppercase' | 'lowercase' | 'capitalize'
export interface StyleDisplayPlan {
  transforms: readonly DisplayTransform[]
  scope: 'style-declared uniform display retention' | 'style-admitted display retention; role correspondence unmeasured'
  blockedReason?: string
}
type OutputQualifier = (workload: UnifiedWorkload, output: unknown, format: string) => { ok: boolean; findings: string[]; scope: string }
const object = (value: unknown): Record<string, unknown> | undefined => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)

/** Expectations are projected from the public style input, before rendering.
 * Mixed role transforms admit only declared display variants; they do not
 * establish which authored label belongs to which rendered role. */
export function styleDisplayTransforms(specs: readonly unknown[]): StyleDisplayPlan {
  const roles = new Map<string, Record<string, unknown>>()
  const blocked = (reason: string): StyleDisplayPlan => ({ transforms: [], scope: 'style-admitted display retention; role correspondence unmeasured', blockedReason: reason })
  if (!specs.length) return blocked('No public style specification supplied')
  for (const value of specs) {
    const spec = object(value)
    if (!spec) return blocked('Public style specification is unavailable; display expectations are unmeasured')
    if (spec.roles === undefined) continue
    const declared = object(spec.roles)
    if (!declared) return blocked('Public style roles are not an object')
    for (const [name, value] of Object.entries(declared)) {
      const role = object(value)
      if (!role) return blocked(`Public style role ${name} is not an object`)
      if (role.textTransform !== undefined && (typeof role.textTransform !== 'string' || !['uppercase', 'lowercase', 'capitalize'].includes(role.textTransform))) return blocked(`Unsupported public textTransform on ${name}: ${String(role.textTransform)}`)
      const prior = roles.get(name) ?? {}
      roles.set(name, { ...prior, ...Object.fromEntries(Object.entries(role).filter(([, entry]) => entry !== undefined)) })
    }
  }
  const fallback = roles.get('label')?.textTransform ?? 'identity'
  const transforms = new Set<DisplayTransform>(['node', 'edge', 'group'].map(role => (roles.get(role)?.textTransform ?? fallback) as DisplayTransform))
  for (const role of roles.values()) if (role.textTransform !== undefined) transforms.add(role.textTransform as DisplayTransform)
  return { transforms: [...transforms], scope: transforms.size === 1 ? 'style-declared uniform display retention' : 'style-admitted display retention; role correspondence unmeasured' }
}
function project(label: string, transform: DisplayTransform): string {
  if (transform === 'uppercase') return label.toUpperCase()
  if (transform === 'lowercase') return label.toLowerCase()
  if (transform === 'capitalize') return label.replace(/(?<![\p{L}\p{M}\p{N}\p{Pc}])\p{L}/gu, letter => letter.toUpperCase())
  return label
}

/** Delegate every permitted expectation to the existing visible-text guard.
 * This never reads renderer output to invent a successful expectation. */
export function qualifyStyleOutput(workload: UnifiedWorkload, output: unknown, format: string, plan: StyleDisplayPlan, qualify: OutputQualifier): { ok: boolean; findings: string[]; scope: string } {
  if (plan.blockedReason) return { ok: false, findings: [plan.blockedReason], scope: plan.scope }
  const envelope = qualify({ ...workload, expectedLabels: [] }, output, format)
  if (!envelope.ok) return { ...envelope, scope: plan.scope }
  const findings = (workload.expectedLabels ?? []).flatMap(label => {
    const variants = [...new Set(plan.transforms.map(transform => project(label, transform)))]
    return variants.some(expected => qualify({ ...workload, expectedLabels: [expected] }, output, format).ok) ? [] : [`Missing style-admitted authored label: ${JSON.stringify(label)}; allowed displays: ${variants.map(value => JSON.stringify(value)).join(', ')}`]
  })
  return { ok: !findings.length, findings, scope: workload.expectedLabels?.length ? plan.scope : 'style output envelope only; no authored label expectations' }
}
