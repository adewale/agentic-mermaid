// ============================================================================
// Quadrant runtime config — typed section, wire-or-warn (defect class C3).
//
// Upstream QuadrantChartConfig (mermaid.js.org/config/schema-docs/
// config-defs-quadrant-chart-config.html) keys and their disposition here:
//
//   WIRED (real geometry/paint effect):
//     chartWidth, chartHeight            → canvas size (plot side derives)
//     titleFontSize, titlePadding        → title band
//     quadrantPadding                    → outer padding
//     quadrantLabelFontSize              → region labels
//     xAxisLabelFontSize/Padding         → x-axis labels + bottom gutter
//     yAxisLabelFontSize/Padding         → y-axis labels + left gutter
//     pointLabelFontSize, pointRadius,
//     pointTextPadding                   → point marks + label placement
//     quadrantInternalBorderStrokeWidth  → divider lines
//     quadrantExternalBorderStrokeWidth  → outer border
//     useMaxWidth (base config)          → responsive SVG root (100% width)
//
//   NOT WIRED (accepted for Mermaid config-shape compatibility; each presence
//   emits the INEFFECTIVE_CONFIG Tier-3 lint via verify — P4):
//     xAxisPosition, yAxisPosition       → axes always render bottom/left
//     quadrantTextTopPadding             → region labels are centered, never
//                                          top-anchored
//     useWidth (base config)             → no fixed-width override channel
//
// Absent config keeps this renderer's historical defaults (380px plot, 13px
// axis text, …) — upstream's larger defaults are not imposed retroactively.
// ============================================================================

import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import { getFrontmatterMap, getFrontmatterScalar } from '../mermaid-source.ts'

/** Resolved quadrantChart config section. Undefined field = not configured. */
export interface QuadrantVisualConfig {
  chartWidth?: number
  chartHeight?: number
  titleFontSize?: number
  titlePadding?: number
  quadrantPadding?: number
  quadrantLabelFontSize?: number
  xAxisLabelFontSize?: number
  yAxisLabelFontSize?: number
  xAxisLabelPadding?: number
  yAxisLabelPadding?: number
  pointLabelFontSize?: number
  pointRadius?: number
  pointTextPadding?: number
  quadrantInternalBorderStrokeWidth?: number
  quadrantExternalBorderStrokeWidth?: number
  useMaxWidth?: boolean
}

export const QUADRANT_WIRED_CONFIG_FIELDS = [
  'chartWidth', 'chartHeight',
  'titleFontSize', 'titlePadding',
  'quadrantPadding', 'quadrantLabelFontSize',
  'xAxisLabelFontSize', 'yAxisLabelFontSize',
  'xAxisLabelPadding', 'yAxisLabelPadding',
  'pointLabelFontSize', 'pointRadius', 'pointTextPadding',
  'quadrantInternalBorderStrokeWidth', 'quadrantExternalBorderStrokeWidth',
  'useMaxWidth',
] as const

/** Accepted-but-unwired keys; each presence emits INEFFECTIVE_CONFIG. */
export const QUADRANT_NOOP_CONFIG_FIELDS = [
  'quadrantTextTopPadding', 'xAxisPosition', 'yAxisPosition', 'useWidth',
] as const

const POSITIVE_FIELDS = [
  'chartWidth', 'chartHeight', 'titleFontSize', 'quadrantLabelFontSize',
  'xAxisLabelFontSize', 'yAxisLabelFontSize', 'pointLabelFontSize', 'pointRadius',
] as const

const NON_NEGATIVE_FIELDS = [
  'titlePadding', 'quadrantPadding', 'xAxisLabelPadding', 'yAxisLabelPadding',
  'pointTextPadding', 'quadrantInternalBorderStrokeWidth', 'quadrantExternalBorderStrokeWidth',
] as const

/**
 * Resolve the `quadrantChart` frontmatter/init-directive section into a typed
 * config. Non-numeric / out-of-domain values are dropped (the field stays
 * unconfigured) — mirroring the journey/xychart config normalizers.
 */
export function resolveQuadrantVisualConfig(
  frontmatter: MermaidFrontmatterMap = {},
): QuadrantVisualConfig {
  const section = getFrontmatterMap(frontmatter, ['quadrantChart']) ?? {}
  const config: QuadrantVisualConfig = {}

  for (const field of POSITIVE_FIELDS) {
    const value = getFrontmatterScalar<number>(section, [field])
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) config[field] = value
  }
  for (const field of NON_NEGATIVE_FIELDS) {
    const value = getFrontmatterScalar<number>(section, [field])
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) config[field] = value
  }
  const useMaxWidth = getFrontmatterScalar<boolean>(section, ['useMaxWidth'])
  if (typeof useMaxWidth === 'boolean') config.useMaxWidth = useMaxWidth

  return config
}
