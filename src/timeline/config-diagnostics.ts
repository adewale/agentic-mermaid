import type { FamilyOperations } from '../agent/families.ts'
import { diagnoseFamilyConfig } from '../shared/family-config-diagnostics.ts'
import { boolean, stringArray, type ConfigValueRule } from '../shared/config-value-rules.ts'

const VALUE_RULES: Record<string, ConfigValueRule> = { disableMulticolor: boolean, sectionFills: stringArray, sectionColours: stringArray }

export const diagnoseTimelineConfig: NonNullable<FamilyOperations['configDiagnostics']> = context =>
  diagnoseFamilyConfig('timeline', context, VALUE_RULES)
