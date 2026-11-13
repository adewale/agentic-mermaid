import type { FamilyOperations } from '../agent/families.ts'
import { diagnoseFamilyConfig } from '../shared/family-config-diagnostics.ts'
import { C4_CONFIG_VALUE_RULES } from './config.ts'

export const diagnoseC4Config: NonNullable<FamilyOperations['configDiagnostics']> = context =>
  diagnoseFamilyConfig('c4', context, C4_CONFIG_VALUE_RULES)
