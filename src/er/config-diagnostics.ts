import type { FamilyOperations } from '../agent/families.ts'
import { diagnoseFamilyConfig } from '../shared/family-config-diagnostics.ts'
import { nonNegative, oneOfInsensitive, type ConfigValueRule } from '../shared/config-value-rules.ts'

const VALUE_RULES: Record<string, ConfigValueRule> = { layoutDirection: oneOfInsensitive('TB', 'TD', 'BT', 'LR', 'RL'), nodeSpacing: nonNegative, rankSpacing: nonNegative }

export const diagnoseErConfig: NonNullable<FamilyOperations['configDiagnostics']> = context =>
  diagnoseFamilyConfig('er', context, VALUE_RULES)
