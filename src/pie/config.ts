// ============================================================================
// Pie chart runtime config — upstream's `pie` config section plus the pie
// theme variables, resolved in ONE place for every surface (SVG layout,
// renderer, ASCII, verify's INEFFECTIVE_CONFIG lint).
//
// Upstream contract (config.schema.yaml + pieRenderer.ts, v11.16.0):
//   pie.textPosition   number 0..1, default 0.75 — axial label position
//   pie.donutHole      number, valid (0, 0.9], anything else resolves to 0
//   pie.legendPosition 'top'|'bottom'|'left'|'right'|'center', default 'right'
//   pie.highlightSlice string — static cross-format target, or reserved `hover`
// Theme variables (theming.html):
//   pie1..pie12                      slice fills, honored in SOURCE order
//                                    (upstream assigns after d3 sorts — #5314;
//                                    source order is the fix)
//   pieStrokeColor / pieStrokeWidth  per-slice border
//   pieOuterStrokeWidth / pieOuterStrokeColor  outer circle (drawn only when
//                                    configured — the crisp default has none)
//   pieOpacity                       slice fill opacity
//   pieSectionTextSize / pieSectionTextColor   on-slice percentage labels
//   pieTitleTextSize/Color, pieLegendTextSize/Color — title/legend typography
//
// Wire-or-warn (P4): every documented key is either resolved here or named in
// the PIE_NOOP_* lists that verify surfaces as Tier-3 INEFFECTIVE_CONFIG.
// ============================================================================

import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import { getFrontmatterMap } from '../mermaid-source.ts'
import { safeCssColor } from '../shared/css-color.ts'

export type PieLegendPosition = 'top' | 'bottom' | 'left' | 'right' | 'center'

export interface PieVisualConfig {
  /** Axial position of on-slice labels: 0 = center, 1 = rim. Upstream default 0.75. */
  textPosition: number
  /** Donut hole ratio (0..0.9]; invalid values resolve to 0 (no hole). */
  donutHole: number
  /** Legend placement relative to the circle. Upstream default 'right'. */
  legendPosition: PieLegendPosition
  /** Static slice label to emphasize, or `hover` for interactive-only emphasis. */
  highlightSlice?: string
  /** pie1..pie12 fills, index = source order; unset entries use the derived palette. */
  paletteOverrides: Array<string | undefined>
  strokeColor?: string
  strokeWidth?: number
  outerStrokeWidth?: number
  outerStrokeColor?: string
  opacity?: number
  sectionTextSize?: number
  sectionTextColor?: string
  titleTextSize?: number
  titleTextColor?: string
  legendTextSize?: number
  legendTextColor?: string
}

export const DEFAULT_PIE_VISUAL_CONFIG: PieVisualConfig = {
  textPosition: 0.75,
  donutHole: 0,
  legendPosition: 'right',
  paletteOverrides: [],
}

const LEGEND_POSITIONS: readonly PieLegendPosition[] = ['top', 'bottom', 'left', 'right', 'center']

/** Accept a number or an upstream-style "17px" string; undefined otherwise. */
function cssSize(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const m = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:px)?$/.exec(value.trim())
    if (m) {
      const n = Number.parseFloat(m[1]!)
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return undefined
}


export function resolvePieVisualConfig(frontmatter: MermaidFrontmatterMap = {}): PieVisualConfig {
  const pie = getFrontmatterMap(frontmatter, ['pie']) ?? {}
  const vars = getFrontmatterMap(frontmatter, ['themeVariables']) ?? {}
  const config: PieVisualConfig = { ...DEFAULT_PIE_VISUAL_CONFIG, paletteOverrides: [] }

  const textPosition = pie.textPosition
  if (typeof textPosition === 'number' && Number.isFinite(textPosition) && textPosition >= 0 && textPosition <= 1) {
    config.textPosition = textPosition
  }

  // Upstream clamp semantics (pieRenderer.ts): used only when > 0 and <= 0.9.
  const donutHole = pie.donutHole
  if (typeof donutHole === 'number' && Number.isFinite(donutHole) && donutHole > 0 && donutHole <= 0.9) {
    config.donutHole = donutHole
  }

  const legendPosition = pie.legendPosition
  if (typeof legendPosition === 'string' && (LEGEND_POSITIONS as readonly string[]).includes(legendPosition)) {
    config.legendPosition = legendPosition as PieLegendPosition
  }
  if (typeof pie.highlightSlice === 'string' && pie.highlightSlice.trim()) {
    config.highlightSlice = pie.highlightSlice.trim()
  }

  for (let i = 0; i < 12; i++) {
    const fill = safeCssColor(vars[`pie${i + 1}`])
    if (fill !== undefined) config.paletteOverrides[i] = fill
  }

  const strokeColor = safeCssColor(vars.pieStrokeColor)
  if (strokeColor !== undefined) config.strokeColor = strokeColor
  const strokeWidth = cssSize(vars.pieStrokeWidth)
  if (strokeWidth !== undefined) config.strokeWidth = strokeWidth
  const outerStrokeWidth = cssSize(vars.pieOuterStrokeWidth)
  if (outerStrokeWidth !== undefined) config.outerStrokeWidth = outerStrokeWidth
  const outerStrokeColor = safeCssColor(vars.pieOuterStrokeColor)
  if (outerStrokeColor !== undefined) config.outerStrokeColor = outerStrokeColor
  const opacity = vars.pieOpacity
  if (typeof opacity === 'number' && Number.isFinite(opacity) && opacity >= 0 && opacity <= 1) {
    config.opacity = opacity
  }
  const sectionTextSize = cssSize(vars.pieSectionTextSize)
  if (sectionTextSize !== undefined) config.sectionTextSize = sectionTextSize
  const sectionTextColor = safeCssColor(vars.pieSectionTextColor)
  if (sectionTextColor !== undefined) config.sectionTextColor = sectionTextColor
  const titleTextSize = cssSize(vars.pieTitleTextSize)
  if (titleTextSize !== undefined) config.titleTextSize = titleTextSize
  const titleTextColor = safeCssColor(vars.pieTitleTextColor)
  if (titleTextColor !== undefined) config.titleTextColor = titleTextColor
  const legendTextSize = cssSize(vars.pieLegendTextSize)
  if (legendTextSize !== undefined) config.legendTextSize = legendTextSize
  const legendTextColor = safeCssColor(vars.pieLegendTextColor)
  if (legendTextColor !== undefined) config.legendTextColor = legendTextColor

  return config
}

/** Documented-but-unwired pie config section fields (Tier-3 INEFFECTIVE_CONFIG). */
export const PIE_NOOP_CONFIG_FIELDS = ['useMaxWidth', 'useWidth'] as const

/** Documented-but-unwired pie theme variables (Tier-3 INEFFECTIVE_CONFIG). */
export const PIE_NOOP_THEME_VARIABLES = [] as const

/**
 * Scan pie config sections and themeVariables maps for documented-but-unwired
 * keys. Returns the sorted field names that should carry INEFFECTIVE_CONFIG.
 */
export function pieIneffectiveConfigFields(
  pieConfigs: unknown[],
  themeVariableMaps: unknown[],
): string[] {
  const present = new Set<string>()
  for (const config of pieConfigs) {
    if (!config || typeof config !== 'object') continue
    for (const field of PIE_NOOP_CONFIG_FIELDS) {
      if (field in (config as Record<string, unknown>)) present.add(field)
    }
  }
  for (const vars of themeVariableMaps) {
    if (!vars || typeof vars !== 'object') continue
    for (const field of PIE_NOOP_THEME_VARIABLES) {
      if (field in (vars as Record<string, unknown>)) present.add(field)
    }
  }
  return [...present].sort()
}
