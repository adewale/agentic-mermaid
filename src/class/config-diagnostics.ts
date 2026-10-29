import type { FamilyOperations } from '../agent/families.ts'
import { diagnoseFamilyConfig } from '../shared/family-config-diagnostics.ts'
import { nonNegative, boolean, type ConfigValueRule } from '../shared/config-value-rules.ts'

const VALUE_RULES: Record<string, ConfigValueRule> = { nodeSpacing: nonNegative, rankSpacing: nonNegative, hierarchicalNamespaces: boolean }

export const diagnoseClassConfig: NonNullable<FamilyOperations['configDiagnostics']> = context =>
  diagnoseFamilyConfig('class', context, VALUE_RULES)
