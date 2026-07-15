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
//   - lightness alternates between two tiers held at CONSTANT OKLCH lightness,
//     not HSL: equal HSL lightness across hues is unequal PERCEIVED lightness
//     (a yellow reads far lighter than a blue at the same HSL L), which is what
//     let hue-adjacent slices collapse toward each other. OKLCH tiers separate
//     evenly by construction (idea #1).
//   - a minimum ΔE_OK floor is then enforced pairwise, so no two slice fills
//     read as the same color, up to a couple dozen slices (idea #2). Past that
//     the sRGB gamut is exhausted and the pass becomes best-effort: it
//     maximizes separation and never repeats a color or drops a wedge below the
//     visibility floors, but the ΔE target can slip (a >27-slice pie is
//     unreadable regardless). The realistic range is covered by the test.
//   - every color is nudged (deterministically) away from the background until
//     it clears BOTH a WCAG floor (the historical guard) and an APCA lightness-
//     contrast floor. APCA is polarity-aware, so it catches wedges that WCAG
//     calls visible but that vanish on a dark theme (idea #3).
// The perceptual primitives live in src/shared/perceptual-color.ts, beside the
// WCAG ones in src/shared/color-math.ts.
//
// pie1..pie12 theme variables override the derived color at their index, in
// SOURCE order, cycling past twelve (fixes upstream #5314, where colors are
// assigned after d3 sorts slices by value).
// ============================================================================

import { getSeriesColor, isDarkBackground, isValidHex, CHART_ACCENT_FALLBACK } from '../xychart/colors.ts'
import { wcagContrastRatio } from '../shared/color-math.ts'
import { hexToOklch, oklchToHex, apcaContrast, deltaEOK, type Oklch } from '../shared/perceptual-color.ts'

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

/** Wedge-visibility floor: a slice fill must clear this WCAG ratio vs the bg. */
const BG_CONTRAST_FLOOR = 1.25

/** Wedge-visibility floor in APCA lightness contrast (|Lc|). ~15 is the APCA
 *  guidance for large, non-text color areas; unlike WCAG it does not overstate
 *  dark-on-dark, so it catches wedges that vanish on a dark theme. */
const BG_APCA_FLOOR = 15

/** Minimum perceptual separation (ΔE_OK) between any two slice fills. 0.10 sits
 *  comfortably above the just-noticeable ~0.02 and above the 0.053 the old HSL
 *  ladder degenerated to, so no two wedges read as the same color. */
const MIN_SLICE_DELTA_E = 0.10

/** OKLCH hue anchoring the wheel when the accent has no meaningful hue (the
 *  default grey theme) — the indigo family the derived palettes lean on. */
const NEUTRAL_BASE_HUE = 264

/** Accent chroma is clamped into a lively-but-printable band before the sweep. */
const SLICE_CHROMA_MIN = 0.11
const SLICE_CHROMA_MAX = 0.16

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
  const accentLch = hexToOklch(accent) ?? { L: 0.6, C: SLICE_CHROMA_MAX, h: NEUTRAL_BASE_HUE }
  // Neutral accents (the default grey theme) have no meaningful hue; anchor the
  // wheel on the indigo family the derived palettes lean on.
  const neutral = accentLch.C < 0.03
  const baseHue = neutral ? NEUTRAL_BASE_HUE : accentLch.h
  const chroma = Math.max(SLICE_CHROMA_MIN, Math.min(SLICE_CHROMA_MAX, neutral ? SLICE_CHROMA_MAX : accentLch.C))
  const dark = bg !== undefined && isDarkBackground(bg)
  // Two CONSTANT-OKLCH-LIGHTNESS tiers so hue-adjacent slices separate in
  // perceived lightness by a fixed amount at every hue (HSL's flaw was that its
  // fixed L is unequal perceived L across hues). On dark backgrounds both tiers
  // sit lighter than the page; on light backgrounds both sit darker.
  const tiers: [number, number] = dark ? [0.74, 0.60] : [0.56, 0.70]
  const step = 360 / count
  const colors = Array.from({ length: count }, (_unused, index) => {
    // Preserve the exact accent when it is visible; otherwise apply the same
    // background-visibility construction used for every other derived slice.
    if (index === 0 && isVisible(accent, bg)) return accent
    const hue = index === 0 ? baseHue : ((baseHue + index * step) % 360 + 360) % 360
    const startL = index === 0 ? accentLch.L : tiers[index % 2]!
    return ensureBgContrast({ L: startL, C: chroma, h: hue }, bg, dark)
  })
  return enforceMinDeltaE(colors, bg, dark)
}

/** A fill is "visible" when it clears BOTH the WCAG and APCA wedge floors (or
 *  when the background is unknown, in which case any fill passes). */
function isVisible(hex: string, bg: string | undefined): boolean {
  if (bg === undefined) return true
  const wcag = wcagContrastRatio(hex, bg)
  const apca = apcaContrast(hex, bg)
  return (wcag === null || wcag >= BG_CONTRAST_FLOOR) && (apca === null || apca >= BG_APCA_FLOOR)
}

/**
 * Deterministically step OKLCH lightness away from the background until the
 * fill clears both wedge-visibility floors (bounded walk; returns the last
 * candidate when the bound is hit so output is always defined).
 */
function ensureBgContrast(lch: Oklch, bg: string | undefined, darkBg: boolean): string {
  let L = lch.L
  let hex = oklchToHex({ ...lch, L })
  if (bg === undefined) return hex
  for (let i = 0; i < 16; i++) {
    if (isVisible(hex, bg)) return hex
    L = darkBg ? Math.min(0.97, L + 0.04) : Math.max(0.08, L - 0.04)
    hex = oklchToHex({ ...lch, L })
  }
  return hex
}

/**
 * Guarantee every pair of fills is at least MIN_SLICE_DELTA_E apart in OKLCH.
 * Colors are visited in source order; a fill too close to an already-accepted
 * one is separated by a bounded, deterministic local search. Slice 0 (the exact
 * accent, when visible) is never moved.
 */
function enforceMinDeltaE(colors: string[], bg: string | undefined, darkBg: boolean): string[] {
  const out: string[] = []
  for (let index = 0; index < colors.length; index++) {
    const hex = colors[index]!
    const anchored = index === 0 && isVisible(hex, bg)
    out.push(anchored || minDeltaTo(hex, out) >= MIN_SLICE_DELTA_E
      ? hex
      : separate(hex, out, bg, darkBg))
  }
  return out
}

/** Smallest ΔE_OK from `hex` to any already-accepted color (Infinity if none). */
function minDeltaTo(hex: string, accepted: string[]): number {
  let min = Infinity
  for (const other of accepted) {
    const d = deltaEOK(hex, other)
    if (d !== null && d < min) min = d
  }
  return min
}

const clampL = (L: number): number => Math.max(0.08, Math.min(0.97, L))

/**
 * Deterministically nudge `hex` away from every accepted color until it clears
 * MIN_SLICE_DELTA_E while staying background-visible. Candidates are tried in a
 * fixed order (lightness both ways, then hue rotation, then a combination) at
 * growing magnitude — the first that clears the floor wins; if none does (a
 * pathological count with no gamut headroom), the most-separated visible
 * candidate is kept so the output is always defined and never regresses.
 */
function separate(hex: string, accepted: string[], bg: string | undefined, darkBg: boolean): string {
  const base = hexToOklch(hex)
  if (!base) return hex
  let best = hex
  let bestMin = minDeltaTo(hex, accepted)
  for (let k = 1; k <= 12; k++) {
    const dL = k * 0.03
    const dH = k * 7
    const candidates: Oklch[] = [
      { ...base, L: clampL(base.L + dL) },
      { ...base, L: clampL(base.L - dL) },
      { ...base, h: (base.h + dH) % 360 },
      { ...base, h: (base.h - dH + 360) % 360 },
      { ...base, L: clampL(darkBg ? base.L + dL : base.L - dL), h: (base.h + dH) % 360 },
    ]
    for (const cand of candidates) {
      const candHex = oklchToHex(cand)
      if (bg !== undefined && !isVisible(candHex, bg)) continue
      const m = minDeltaTo(candHex, accepted)
      if (m >= MIN_SLICE_DELTA_E) return candHex
      if (m > bestMin) { bestMin = m; best = candHex }
    }
  }
  return best
}
