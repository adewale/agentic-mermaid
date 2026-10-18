import type { FamilyOperations } from '../agent/families.ts'
import { diagnoseFamilyConfig } from '../shared/family-config-diagnostics.ts'
import { positive, nonNegative, boolean, type ConfigValueRule } from '../shared/config-value-rules.ts'

const VALUE_RULES: Record<string, ConfigValueRule> = Object.fromEntries([
  ...['chartWidth', 'chartHeight', 'titleFontSize', 'quadrantLabelFontSize', 'xAxisLabelFontSize', 'yAxisLabelFontSize', 'pointLabelFontSize', 'pointRadius'].map(key => [key, positive]),
  ...['titlePadding', 'quadrantPadding', 'xAxisLabelPadding', 'yAxisLabelPadding', 'pointTextPadding', 'quadrantInternalBorderStrokeWidth', 'quadrantExternalBorderStrokeWidth'].map(key => [key, nonNegative]),
  ['useMaxWidth', boolean],
])

export const diagnoseQuadrantConfig: NonNullable<FamilyOperations['configDiagnostics']> = context =>
  diagnoseFamilyConfig('quadrant', context, VALUE_RULES)
