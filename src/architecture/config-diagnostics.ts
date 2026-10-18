import type { FamilyOperations } from '../agent/families.ts'
import { diagnoseFamilyConfig } from '../shared/family-config-diagnostics.ts'
import { numericLike, type ConfigValueRule } from '../shared/config-value-rules.ts'

const VALUE_RULES: Record<string, ConfigValueRule> = {
  padding: numericLike(0), iconSize: numericLike(0, true), fontSize: numericLike(0, true),
  nodeSeparation: numericLike(0), idealEdgeLengthMultiplier: numericLike(0, true),
}

export const diagnoseArchitectureConfig: NonNullable<FamilyOperations['configDiagnostics']> = context =>
  diagnoseFamilyConfig('architecture', context, VALUE_RULES)
