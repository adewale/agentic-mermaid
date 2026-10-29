import type { FamilyOperations } from '../agent/families.ts'
import { diagnoseFamilyConfig } from '../shared/family-config-diagnostics.ts'
import { rule, positive, boolean, nonEmptyString, oneOfInsensitive, type ConfigValueRule } from '../shared/config-value-rules.ts'

const VALUE_RULES: Record<string, ConfigValueRule> = {
  displayMode: oneOfInsensitive('compact'), barHeight: positive, topAxis: boolean,
  axisFormat: nonEmptyString,
  tickInterval: rule('a positive Mermaid interval such as "1day" or "2week"', value => typeof value === 'string' && /^[1-9]\d*(?:millisecond|second|minute|hour|day|week|month)$/i.test(value.trim())),
}

export const diagnoseGanttConfig: NonNullable<FamilyOperations['configDiagnostics']> = context =>
  diagnoseFamilyConfig('gantt', context, VALUE_RULES)
