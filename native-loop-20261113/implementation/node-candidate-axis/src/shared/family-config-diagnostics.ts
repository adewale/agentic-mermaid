import type { FamilyId } from '../agent/types.ts'
import type { ConfigDiagnostic } from '../types.ts'
import type { FamilyConfigContract, FamilyOperations } from '../agent/families.ts'
import type { ConfigValueRule } from './config-value-rules.ts'
import { getInstalledFamilyDescriptor } from '../agent/family-router.ts'
import { compareCodePointStrings } from './deterministic-order.ts'
import { mermaidThemeConfigDiagnostics } from '../color-resolver.ts'

export type FamilyConfigSpec = FamilyConfigContract

export function configSection(root: unknown, key: string): Record<string, unknown> | undefined {
  if (!root || typeof root !== 'object' || Array.isArray(root)) return undefined
  const value = (root as Record<string, unknown>)[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function familyUnknownConfigDiagnostics(
  kind: FamilyId,
  root: unknown,
  spec?: FamilyConfigContract,
): ConfigDiagnostic[] {
  if (!spec) return []
  const record = root && typeof root === 'object' && !Array.isArray(root) ? root as Record<string, unknown> : undefined
  const config = configSection(root, spec.section)
  if (!config) return record && spec.section in record ? [{
    code: 'INEFFECTIVE_CONFIG',
    field: spec.section,
    message: `${kind} config section "${spec.section}" must be an object; the invalid value has no effect.`,
  }] : []
  const known = new Set(spec.keys)
  return Object.keys(config).filter(key => !known.has(key)).sort().map(key => ({
    code: 'INEFFECTIVE_CONFIG',
    field: `${spec.section}.${key}`,
    message: `${kind} config field "${key}" is unknown and has no effect; check the spelling or remove it.`,
  }))
}

/** Common field rules; the calling descriptor owns the rule table. */
export function diagnoseFamilyConfig(
  kind: FamilyId,
  { root, config: spec }: { root: unknown; config: FamilyConfigContract },
  rules: Readonly<Record<string, ConfigValueRule>> = {},
): ConfigDiagnostic[] {
  const diagnostics = familyUnknownConfigDiagnostics(kind, root, spec)
  const config = configSection(root, spec.section)
  if (config) {
    for (const [key, rule] of Object.entries(rules)) {
      if (key in config && !rule.valid(config[key])) {
        const field = `${spec.section}.${key}`
        diagnostics.push({ code: 'INEFFECTIVE_CONFIG', field, message: `${field} must be ${rule.expected}; the invalid value has no effect.` })
      }
    }
  }
  return [...diagnostics, ...familyNoopConfigDiagnostics(kind, root, spec, rules)]
}

export function familyNoopConfigDiagnostics(
  kind: FamilyId,
  root: unknown,
  spec?: FamilyConfigContract,
  rules: Readonly<Record<string, ConfigValueRule>> = {},
): ConfigDiagnostic[] {
  if (!spec) return []
  const config = configSection(root, spec.section)
  if (!config) return []
  const noop = new Set(spec.noopKeys ?? [])
  return Object.keys(config).filter(key => {
    if (!noop.has(key)) return false
    // An invalid value already has a more precise validity diagnostic; it
    // must not also be described as an accepted compatibility no-op.
    const valueRule = rules[key]
    return !valueRule || valueRule.valid(config[key])
  }).sort().map(key => ({
    code: 'INEFFECTIVE_CONFIG' as const,
    field: `${spec.section}.${key}`,
    message: `${kind} config field "${key}" is accepted for ${kind.includes(':') ? 'compatibility' : 'Mermaid compatibility'} but has no effect on this renderer.`,
  }))
}

function stableDiagnostics(diagnostics: ConfigDiagnostic[]): ConfigDiagnostic[] {
  const seen = new Set<string>()
  return diagnostics
    .sort((a, b) => compareCodePointStrings(a.field, b.field) || compareCodePointStrings(a.message, b.message))
    .filter(diagnostic => {
      const key = `${diagnostic.code}\u0000${diagnostic.field}\u0000${diagnostic.message}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/** Descriptor-owned diagnostics for source wrappers or explicit config roots. */
export function familyConfigDiagnostics(
  kind: FamilyId,
  roots: readonly unknown[],
  spec?: FamilyConfigContract,
  hook?: FamilyOperations['configDiagnostics'],
): ConfigDiagnostic[] {
  // `theme` is shared by every family, so a family descriptor cannot own it.
  const theme = roots.flatMap(mermaidThemeConfigDiagnostics)
  if (!spec) return stableDiagnostics(theme)
  const diagnose = hook ?? getInstalledFamilyDescriptor(kind)?.configDiagnostics
  return stableDiagnostics([...theme, ...roots.flatMap(root => diagnose
    ? [...diagnose({ root, config: spec })]
    : diagnoseFamilyConfig(kind, { root, config: spec }))])
}

/** Diagnostics for the explicit RenderOptions.mermaidConfig entry path. */
export function explicitFamilyConfigDiagnostics(
  kind: string,
  root: unknown,
  spec?: FamilyConfigContract,
  hook?: FamilyOperations['configDiagnostics'],
): ConfigDiagnostic[] {
  const descriptor = getInstalledFamilyDescriptor(kind)
  const resolvedSpec = spec ?? descriptor?.config
  return familyConfigDiagnostics(kind as FamilyId, [root], resolvedSpec, hook ?? descriptor?.configDiagnostics)
}
