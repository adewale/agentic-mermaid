// ============================================================================
// Radar runtime config — typed section, wire-or-warn (defect class C3).
//
// Upstream RadarDiagramConfig (mermaid.js.org config schema) keys and their
// disposition here:
//
//   WIRED (real geometry/paint effect):
//     width, height                      → plot frame size (radius derives)
//     marginTop/Right/Bottom/Left        → outer margins
//     axisScaleFactor                    → spoke length (not data/rings)
//     axisLabelFactor                    → axis-label radial distance
//     curveTension                       → smooth-curve Catmull-Rom tension
//     useMaxWidth (base config)          → responsive SVG root (100% width)
//
//   AGENTIC EXTENSION (not in upstream; off by default so parity is preserved):
//     tickLabels                         → draw the ring value labels upstream
//                                          #6473/#6481 still hasn't shipped
//
// Body options (min/max/ticks/graticule/showLegend) are NOT config keys — they
// live in the diagram body (see parser.ts), matching upstream's grammar.
//
// Per-curve colors come from the shared chart palette (accent-derived), with
// `cScale0..cScale11` theme variables overriding at their index in source
// order — the radar analogue of pie's `pie1..12`. `radar.curveOpacity` theme
// variable sets the fill translucency.
// ============================================================================

import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import { getFrontmatterMap, getFrontmatterScalar } from '../mermaid-source.ts'
import { safeCssColor } from '../shared/css-color.ts'

/** Resolved radarChart config section. Undefined field = not configured. */
export interface RadarVisualConfig {
  width?: number
  height?: number
  marginTop?: number
  marginRight?: number
  marginBottom?: number
  marginLeft?: number
  axisScaleFactor?: number
  axisLabelFactor?: number
  curveTension?: number
  useMaxWidth?: boolean
  /** Agentic extension: draw the ring value labels (default off). */
  tickLabels?: boolean
  /** Mermaid radar theme variables, validated once before reaching SVG/CSS. */
  axisColor?: string
  axisStrokeWidth?: number
  axisLabelFontSize?: number
  curveOpacity?: number
  curveStrokeWidth?: number
  graticuleColor?: string
  graticuleStrokeWidth?: number
  graticuleOpacity?: number
  legendBoxSize?: number
  legendFontSize?: number
  /** Mermaid's global themeVariables.fontSize, used by the radar title. */
  titleFontSize?: number
  titleColor?: string
  /** cScale0..11 per-curve fill overrides, index i = curve i (cycling at 12). */
  paletteOverrides?: Array<string | undefined>
}

export const RADAR_WIRED_CONFIG_FIELDS = [
  'width', 'height',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'axisScaleFactor', 'axisLabelFactor', 'curveTension',
  'useMaxWidth', 'tickLabels',
] as const

/** Accepted-but-unwired keys; each presence emits INEFFECTIVE_CONFIG. Radar
 *  theme colors flow through the Style + Palette system, so the config-section
 *  color/stroke knobs are honestly reported as no-ops rather than duplicated. */
export const RADAR_NOOP_CONFIG_FIELDS = [
  'useWidth',
] as const

export const RADAR_THEME_FIELDS = [
  'axisColor', 'axisStrokeWidth', 'axisLabelFontSize',
  'curveOpacity', 'curveStrokeWidth',
  'graticuleColor', 'graticuleStrokeWidth', 'graticuleOpacity',
  'legendBoxSize', 'legendFontSize',
] as const

const POSITIVE_FIELDS = [
  'width', 'height', 'axisScaleFactor',
] as const

/** Arithmetic/resource bounds applied before layout. They are deliberately
 * generous for exported artwork while preventing finite IEEE-754 inputs from
 * overflowing canvas geometry. */
export const RADAR_CONFIG_LIMITS = Object.freeze({
  dimension: 4096,
  margin: 4096,
  factor: 8,
  /** Values at or below Mermaid's 1.05 default are consumed by mandatory
   *  label clearance and therefore cannot be an effective user override. */
  axisLabelFactorMin: 1.1,
  fontSize: 256,
  lineWidth: 64,
  legendBoxSize: 512,
})

const NON_NEGATIVE_FIELDS = [
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
] as const

/**
 * Resolve the `radar` frontmatter/init-directive section into a typed config.
 * Non-numeric / out-of-domain values are dropped (the field stays
 * unconfigured) — mirroring the quadrant/xychart config normalizers.
 */
export function resolveRadarVisualConfig(
  frontmatter: MermaidFrontmatterMap = {},
): RadarVisualConfig {
  const section = getFrontmatterMap(frontmatter, ['radar']) ?? {}
  const config: RadarVisualConfig = {}

  for (const field of POSITIVE_FIELDS) {
    const value = getFrontmatterScalar<number>(section, [field])
    const maximum = field === 'width' || field === 'height' ? RADAR_CONFIG_LIMITS.dimension : RADAR_CONFIG_LIMITS.factor
    if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= maximum) config[field] = value
  }
  const axisLabelFactor = getFrontmatterScalar<number>(section, ['axisLabelFactor'])
  if (typeof axisLabelFactor === 'number' && Number.isFinite(axisLabelFactor) &&
      axisLabelFactor >= RADAR_CONFIG_LIMITS.axisLabelFactorMin && axisLabelFactor <= RADAR_CONFIG_LIMITS.factor) {
    config.axisLabelFactor = axisLabelFactor
  }
  for (const field of NON_NEGATIVE_FIELDS) {
    const value = getFrontmatterScalar<number>(section, [field])
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= RADAR_CONFIG_LIMITS.margin) config[field] = value
  }
  // curveTension in [0,1]; 0 degenerates the smooth curve to a polygon.
  const tension = getFrontmatterScalar<number>(section, ['curveTension'])
  if (typeof tension === 'number' && Number.isFinite(tension) && tension >= 0 && tension <= 1) {
    config.curveTension = tension
  }
  const useMaxWidth = getFrontmatterScalar<boolean>(section, ['useMaxWidth'])
  if (typeof useMaxWidth === 'boolean') config.useMaxWidth = useMaxWidth
  const tickLabels = getFrontmatterScalar<boolean>(section, ['tickLabels'])
  if (typeof tickLabels === 'boolean') config.tickLabels = tickLabels

  const radarTheme = getFrontmatterMap(frontmatter, ['themeVariables', 'radar']) ?? {}
  const positiveThemeFields = ['axisStrokeWidth', 'axisLabelFontSize', 'curveStrokeWidth', 'graticuleStrokeWidth', 'legendBoxSize', 'legendFontSize'] as const
  for (const field of positiveThemeFields) {
    const value = getFrontmatterScalar<number>(radarTheme, [field])
    const maximum = field === 'legendBoxSize'
      ? RADAR_CONFIG_LIMITS.legendBoxSize
      : field.endsWith('FontSize')
        ? RADAR_CONFIG_LIMITS.fontSize
        : RADAR_CONFIG_LIMITS.lineWidth
    if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= maximum) config[field] = value
  }
  for (const field of ['curveOpacity', 'graticuleOpacity'] as const) {
    const value = getFrontmatterScalar<number>(radarTheme, [field])
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) config[field] = value
  }
  for (const field of ['axisColor', 'graticuleColor'] as const) {
    const color = safeCssColor(getFrontmatterScalar<string>(radarTheme, [field]))
    if (color) config[field] = color
  }
  const titleColor = safeCssColor(getFrontmatterScalar<string>(frontmatter, ['themeVariables', 'titleColor']))
  if (titleColor) config.titleColor = titleColor
  const rawTitleFontSize = getFrontmatterScalar<string | number>(frontmatter, ['themeVariables', 'fontSize'])
  const titleFontSize = typeof rawTitleFontSize === 'number'
    ? rawTitleFontSize
    : typeof rawTitleFontSize === 'string' && /^\d+(?:\.\d+)?(?:px)?$/i.test(rawTitleFontSize.trim())
      ? Number.parseFloat(rawTitleFontSize)
      : Number.NaN
  if (Number.isFinite(titleFontSize) && titleFontSize > 0 && titleFontSize <= RADAR_CONFIG_LIMITS.fontSize) {
    config.titleFontSize = titleFontSize
  }

  // cScale0..cScale11 per-curve color overrides (themeVariables).
  const overrides: Array<string | undefined> = []
  let sawOverride = false
  for (let i = 0; i < 12; i++) {
    const c = safeCssColor(getFrontmatterScalar<string>(frontmatter, ['themeVariables', `cScale${i}`]))
    if (c) { overrides[i] = c; sawOverride = true }
  }
  if (sawOverride) config.paletteOverrides = overrides

  return config
}
