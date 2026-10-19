import type { FamilyOperations } from '../agent/families.ts'
import { diagnoseFamilyConfig } from '../shared/family-config-diagnostics.ts'
import { positive, boolean, nonEmptyString, safeFontFamily, stringArray, positiveCssSize, type ConfigValueRule } from '../shared/config-value-rules.ts'

const VALUE_RULES: Record<string, ConfigValueRule> = Object.fromEntries([
  ...['diagramMarginX', 'diagramMarginY', 'leftMargin', 'maxLabelWidth', 'width', 'height', 'taskMargin'].map(key => [key, positive]),
  ...['taskFontSize', 'titleFontSize'].map(key => [key, positiveCssSize]),
  ...['taskFontFamily', 'titleFontFamily'].map(key => [key, safeFontFamily]),
  ['titleColor', nonEmptyString],
  ...['actorColours', 'sectionFills', 'sectionColours'].map(key => [key, stringArray]),
  ['useMaxWidth', boolean],
])

export const diagnoseJourneyConfig: NonNullable<FamilyOperations['configDiagnostics']> = context =>
  diagnoseFamilyConfig('journey', context, VALUE_RULES)
