// ============================================================================
// Pie slice palette — the single home for slice fills, consumed by the SVG
// renderer (wedges + legend swatches) and the ASCII renderer (bars), so the
// two surfaces can never disagree about slice identity.
//
// Small charts (≤ MONO_LADDER_MAX slices) keep the existing xychart
// same-family ladder: accent-anchored shades that read as one palette across
// chart families. Past that count the ladder degenerates into near-identical
// neighbors (the Journey actor-dot defect class — plan §Pie item 4; measured:
// two of fifteen ladder colors sit at WCAG 1.01:1 against each other), so
// high-count charts switch to a hue-rotation wheel SIZED TO THE SLICE COUNT
// (P1: palettes sized to element counts instead of modulo wraps):
//   - hues spread evenly from the accent hue (360/count steps — every pair of
//     same-lightness colors is ≥ 2·(360/count) apart)
//   - lightness alternates between two tiers so hue-adjacent slices also
//     differ in lightness
//   - every color is nudged (deterministically) toward the foreground until
//     it clears a wedge-visibility contrast floor against the background,
//     using the shared WCAG primitives (src/shared/color-math.ts)
//
// pie1..pie12 theme variables override the derived color at their index, in
// SOURCE order, cycling past twelve (fixes upstream #5314, where colors are
// assigned after d3 sorts slices by value).
// ============================================================================

import { getSeriesColor, hexToHsl, hslToHex, isDarkBackground, isValidHex, CHART_ACCENT_FALLBACK } from '../xychart/colors.ts'
import { wcagContrastRatio } from '../shared/color-math.ts'

export interface PiePaletteInputs {
  /** Theme accent (any string; non-hex falls back to the chart accent). */
  accent?: string
  /** Theme background (any string; non-hex is ignored). */
  bg?: string
  /** pie1..pie12 explicit fills in source order (index i = slice i, cycling at 12). */
  overrides?: Array<string | undefined>
}

/** Largest slice count still served by the monochrome same-family ladder. */
const MONO_LADDER_MAX = 6

/** Wedge-visibility floor: a slice fill must clear this vs the background. */
const BG_CONTRAST_FLOOR = 1.25

/** Fill colors for `count` slices, in source order. Deterministic. */
export function pieSliceColors(count: number, inputs: PiePaletteInputs = {}): string[] {
  const safeAccent = inputs.accent && isValidHex(inputs.accent) ? inputs.accent : CHART_ACCENT_FALLBACK
  const safeBg = inputs.bg && isValidHex(inputs.bg) ? inputs.bg : undefined
  const derived = count <= MONO_LADDER_MAX
    ? Array.from({ length: Math.max(0, count) }, (_unused, index) => getSeriesColor(index, safeAccent, safeBg))
    : hueSpreadColors(count, safeAccent, safeBg)
  const overrides = inputs.overrides
  if (!overrides || overrides.length === 0) return derived
  return derived.map((color, index) => overrides[index % 12] ?? color)
}

function hueSpreadColors(count: number, accent: string, bg: string | undefined): string[] {
  const [accentHue, accentSat, accentLightness] = hexToHsl(accent)
  // Neutral accents (the default gray theme) have no meaningful hue; anchor
  // the wheel on the indigo family the derived palettes lean on (the journey
  // actor-palette convention).
  const baseHue = accentSat < 20 ? 230 : accentHue
  const saturation = Math.max(55, Math.min(85, accentSat < 20 ? 60 : accentSat))
  const dark = bg !== undefined && isDarkBackground(bg)
  // Two lightness tiers so hue-adjacent slices also separate in lightness.
  // On light backgrounds both tiers stay below the pastel band; on dark
  // backgrounds both stay above the murk band.
  const tiers: [number, number] = dark ? [62, 46] : [46, 64]
  const step = 360 / count
  return Array.from({ length: count }, (_unused, index) => {
    // Preserve the exact accent when it is visible; otherwise apply the same
    // background-contrast construction used for every other derived slice.
    if (index === 0) {
      const ratio = bg === undefined ? null : wcagContrastRatio(accent, bg)
      return bg === undefined || (ratio !== null && ratio >= BG_CONTRAST_FLOOR)
        ? accent
        : ensureBgContrast(accentHue, accentSat, accentLightness, bg)
    }
    const hue = ((baseHue + index * step) % 360 + 360) % 360
    return ensureBgContrast(hue, saturation, tiers[index % 2]!, bg)
  })
}

/**
 * Deterministically nudge lightness away from the background until the fill
 * clears the wedge-visibility floor (bounded walk; returns the last candidate
 * when the bound is hit so output is always defined).
 */
function ensureBgContrast(hue: number, sat: number, lightness: number, bg: string | undefined): string {
  let l = lightness
  let hex = hslToHex(hue, sat, l)
  if (bg === undefined) return hex
  const darkBg = isDarkBackground(bg)
  for (let i = 0; i < 8; i++) {
    const ratio = wcagContrastRatio(hex, bg)
    if (ratio === null || ratio >= BG_CONTRAST_FLOOR) return hex
    l = darkBg ? Math.min(92, l + 6) : Math.max(8, l - 6)
    hex = hslToHex(hue, sat, l)
  }
  return hex
}
