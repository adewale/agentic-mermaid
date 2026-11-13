import type { FamilyOperations } from '../agent/families.ts'
import { diagnoseFamilyConfig, configSection } from '../shared/family-config-diagnostics.ts'
import { boolean, range, boundedPositive, boundedNonNegative, type ConfigValueRule } from '../shared/config-value-rules.ts'
import { RADAR_CONFIG_LIMITS, RADAR_THEME_FIELDS } from './config.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import { safeCssColor } from '../shared/css-color.ts'
import type { ConfigDiagnostic } from '../types.ts'

const VALUE_RULES: Record<string, ConfigValueRule> = {
  width: boundedPositive(RADAR_CONFIG_LIMITS.dimension), height: boundedPositive(RADAR_CONFIG_LIMITS.dimension),
  marginTop: boundedNonNegative(RADAR_CONFIG_LIMITS.margin), marginRight: boundedNonNegative(RADAR_CONFIG_LIMITS.margin),
  marginBottom: boundedNonNegative(RADAR_CONFIG_LIMITS.margin), marginLeft: boundedNonNegative(RADAR_CONFIG_LIMITS.margin),
  axisScaleFactor: boundedPositive(RADAR_CONFIG_LIMITS.factor), axisLabelFactor: range(RADAR_CONFIG_LIMITS.axisLabelFactorMin, RADAR_CONFIG_LIMITS.factor), curveTension: range(0, 1),
  useMaxWidth: boolean, tickLabels: boolean,
}

function radarThemeDiagnostics(root: unknown): ConfigDiagnostic[] {
  const themeVariables = configSection(root, 'themeVariables')
  if (!themeVariables || !('radar' in themeVariables)) return []
  const radar = configSection(themeVariables, 'radar')
  if (!radar) return [{
    code: 'INEFFECTIVE_CONFIG',
    field: 'themeVariables.radar',
    message: 'themeVariables.radar must be an object; the invalid value has no effect.',
  }]
  const known = new Set<string>(RADAR_THEME_FIELDS)
  const diagnostics: ConfigDiagnostic[] = []
  const lineWidthFields = new Set(['axisStrokeWidth', 'curveStrokeWidth', 'graticuleStrokeWidth'])
  const fontSizeFields = new Set(['axisLabelFontSize', 'legendFontSize'])
  const opacityFields = new Set(['curveOpacity', 'graticuleOpacity'])
  const colorFields = new Set(['axisColor', 'graticuleColor'])
  for (const key of Object.keys(radar).sort(compareCodePointStrings)) {
    const value = radar[key]
    let expected: string | undefined
    if (!known.has(key)) expected = 'a documented radar theme field'
    else if (lineWidthFields.has(key) && !boundedPositive(RADAR_CONFIG_LIMITS.lineWidth).valid(value)) expected = boundedPositive(RADAR_CONFIG_LIMITS.lineWidth).expected
    else if (fontSizeFields.has(key) && !boundedPositive(RADAR_CONFIG_LIMITS.fontSize).valid(value)) expected = boundedPositive(RADAR_CONFIG_LIMITS.fontSize).expected
    else if (key === 'legendBoxSize' && !boundedPositive(RADAR_CONFIG_LIMITS.legendBoxSize).valid(value)) expected = boundedPositive(RADAR_CONFIG_LIMITS.legendBoxSize).expected
    else if (opacityFields.has(key) && !range(0, 1).valid(value)) expected = 'a finite number from 0 through 1'
    else if (colorFields.has(key) && !safeCssColor(value)) expected = 'a safe CSS color without url(), variables, or context-breaking characters'
    if (expected) diagnostics.push({
      code: 'INEFFECTIVE_CONFIG',
      field: `themeVariables.radar.${key}`,
      message: `themeVariables.radar.${key} must be ${expected}; the invalid value has no effect.`,
    })
  }
  return diagnostics
}

export const diagnoseRadarConfig: NonNullable<FamilyOperations['configDiagnostics']> = context => [
  ...radarThemeDiagnostics(context.root),
  ...diagnoseFamilyConfig('radar', context, VALUE_RULES),
]
