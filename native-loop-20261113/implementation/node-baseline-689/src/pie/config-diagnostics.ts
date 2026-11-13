import type { FamilyOperations } from '../agent/families.ts'
import { diagnoseFamilyConfig } from '../shared/family-config-diagnostics.ts'
import { oneOf, range, type ConfigValueRule } from '../shared/config-value-rules.ts'

const VALUE_RULES: Record<string, ConfigValueRule> = { textPosition: range(0, 1), donutHole: range(0, 0.9), legendPosition: oneOf('top', 'bottom', 'left', 'right', 'center') }

export const diagnosePieConfig: NonNullable<FamilyOperations['configDiagnostics']> = context =>
  diagnoseFamilyConfig('pie', context, VALUE_RULES)
