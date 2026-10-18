import type { FamilyOperations } from '../agent/families.ts'
import { diagnoseFamilyConfig, configSection } from '../shared/family-config-diagnostics.ts'
import { rule, positive, nonNegative, finite, boolean, oneOf, range, type ConfigValueRule } from '../shared/config-value-rules.ts'
import type { ConfigDiagnostic } from '../types.ts'

const VALUE_RULES: Record<string, ConfigValueRule> = {
  width: positive, height: positive, useMaxWidth: boolean, useWidth: positive,
  titleFontSize: positive, titlePadding: nonNegative,
  chartOrientation: oneOf('vertical', 'horizontal'), plotReservedSpacePercent: range(0, 100, false),
  showDataLabel: boolean, showDataLabelOutsideBar: boolean, showTitle: boolean, showLegend: boolean,
  legendFontSize: positive, legendPadding: nonNegative,
  xAxis: rule('an axis-config object', value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)),
  yAxis: rule('an axis-config object', value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)),
}

const XY_AXIS_VALUE_RULES: Record<string, ConfigValueRule> = {
  showLabel: boolean, labelFontSize: positive, labelPadding: nonNegative, labelRotation: finite,
  showTitle: boolean, titleFontSize: positive, titlePadding: nonNegative,
  showTick: boolean, tickLength: nonNegative, tickWidth: positive,
  showAxisLine: boolean, axisLineWidth: positive,
}

export const diagnoseXyChartConfig: NonNullable<FamilyOperations['configDiagnostics']> = context => {
  const diagnostics: ConfigDiagnostic[] = diagnoseFamilyConfig('xychart', context, VALUE_RULES)
  const config = configSection(context.root, context.config.section)
  if (!config) return diagnostics
  const warn = (field: string, expected: string): void => {
    diagnostics.push({ code: 'INEFFECTIVE_CONFIG', field, message: `${field} must be ${expected}; the invalid value has no effect.` })
  }
  for (const axis of ['xAxis', 'yAxis'] as const) {
    const value = config[axis]
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const axisConfig = value as Record<string, unknown>
    for (const key of Object.keys(axisConfig).sort()) {
      const valueRule = XY_AXIS_VALUE_RULES[key]
      if (!valueRule) warn(`xyChart.${axis}.${key}`, 'a documented axis-config field')
      else if (!valueRule.valid(axisConfig[key])) warn(`xyChart.${axis}.${key}`, valueRule.expected)
      else if (key === 'labelRotation') diagnostics.push({
        code: 'INEFFECTIVE_CONFIG',
        field: `xyChart.${axis}.${key}`,
        message: `xyChart ${axis}.${key} is accepted for Mermaid compatibility but has no effect on this renderer.`,
      })
    }
  }
  return diagnostics
}
