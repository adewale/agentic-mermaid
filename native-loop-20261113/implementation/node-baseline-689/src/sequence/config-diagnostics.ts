import type { FamilyOperations } from '../agent/families.ts'
import { diagnoseFamilyConfig } from '../shared/family-config-diagnostics.ts'
import { nonNegative, boolean, type ConfigValueRule } from '../shared/config-value-rules.ts'

const VALUE_RULES: Record<string, ConfigValueRule> = Object.fromEntries([
  ...['actorMargin', 'width', 'height', 'diagramMarginX', 'diagramMarginY', 'messageMargin', 'noteMargin', 'activationWidth'].map(key => [key, nonNegative]),
  ['showSequenceNumbers', boolean],
  ['wrap', boolean],
])

export const diagnoseSequenceConfig: NonNullable<FamilyOperations['configDiagnostics']> = context =>
  diagnoseFamilyConfig('sequence', context, VALUE_RULES)
