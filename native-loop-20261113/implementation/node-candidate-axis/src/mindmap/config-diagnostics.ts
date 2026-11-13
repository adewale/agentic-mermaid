import type { FamilyOperations } from '../agent/families.ts'
import { diagnoseFamilyConfig } from '../shared/family-config-diagnostics.ts'
import { positive, nonNegative, type ConfigValueRule } from '../shared/config-value-rules.ts'

const VALUE_RULES: Record<string, ConfigValueRule> = { padding: nonNegative, maxNodeWidth: positive }

export const diagnoseMindmapConfig: NonNullable<FamilyOperations['configDiagnostics']> = context => {
  const diagnostics = diagnoseFamilyConfig('mindmap', context, VALUE_RULES)
  const root = context.root
  const record = root && typeof root === 'object' && !Array.isArray(root) ? root as Record<string, unknown> : undefined
  if (record && 'layout' in record && !['tidy-tree', 'cose-bilkent', 'radial'].includes(String(record.layout))) diagnostics.push({
    code: 'INEFFECTIVE_CONFIG', field: 'layout',
    message: 'layout must be "cose-bilkent", "radial", or "tidy-tree" for mindmap diagrams; the invalid value has no effect.',
  })
  return diagnostics
}
