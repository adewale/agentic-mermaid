// ============================================================================
// Shared categorical palette — the single home for derived peer-category
// colors used by pie/radar, xychart, journey, mindmap, and gitgraph.
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
//     the sRGB gamut is exhausted: pairwise repair stops, generation stays
//     linear, and uniqueness/separation become best-effort while background
//     visibility remains enforced. The hard range is covered by the test.
//   - every color is nudged (deterministically) away from the background until
//     it clears BOTH a WCAG floor (the historical guard) and an APCA lightness-
//     contrast floor. APCA is polarity-aware, so it catches wedges that WCAG
//     calls visible but that vanish on a dark theme (idea #3).
// The perceptual primitives live in src/shared/perceptual-color.ts, beside the
// WCAG ones in src/shared/color-math.ts.
//
// Family-specific authored palette variables are applied by each consumer
// after this derived palette, so explicit author intent remains authoritative.
// ============================================================================

import { getSeriesColor, isValidHex, CHART_ACCENT_FALLBACK } from '../xychart/colors.ts'
import { wcagContrastRatio } from './color-math.ts'
import {
  hexToOklab, hexToOklch, oklchToHex, apcaContrast, deltaEOK,
  minPairwiseDeltaEOK, type Oklab, type Oklch,
} from './perceptual-color.ts'

export interface CategoricalPaletteInputs {
  /** Theme accent (any string; non-hex falls back to the chart accent). */
  accent?: string
  /** Theme background (any string; non-hex is ignored). */
  bg?: string
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

/** The documented range in which the categorical-separation floor is a hard
 * contract. Above it, searching every color pair is both quadratic and
 * misleading: the available visible sRGB volume cannot sustain the floor. */
const GUARANTEED_DELTA_E_MAX = 24

/** OKLCH hue anchoring the wheel when the accent has no meaningful hue (the
 *  default grey theme) — the indigo family the derived palettes lean on. */
const NEUTRAL_BASE_HUE = 264

/** Accent chroma is clamped into a lively-but-printable band before the sweep. */
const SLICE_CHROMA_MIN = 0.11
const SLICE_CHROMA_MAX = 0.16

/** Shared derived palette for peer categorical series. Author-supplied family
 * overrides are deliberately applied by each renderer after this function. */
export function categoricalPalette(count: number, inputs: CategoricalPaletteInputs = {}): string[] {
  const safeAccent = inputs.accent && isValidHex(inputs.accent) ? inputs.accent : CHART_ACCENT_FALLBACK
  const safeBg = inputs.bg && isValidHex(inputs.bg) ? inputs.bg : undefined
  return count <= MONO_LADDER_MAX
    ? Array.from({ length: Math.max(0, count) }, (_unused, index) => getSeriesColor(index, safeAccent, safeBg))
    : hueSpreadColors(count, safeAccent, safeBg)
}

function hueSpreadColors(count: number, accent: string, bg: string | undefined): string[] {
  const accentLch = hexToOklch(accent) ?? { L: 0.6, C: SLICE_CHROMA_MAX, h: NEUTRAL_BASE_HUE }
  // Neutral accents (the default grey theme) have no meaningful hue; anchor the
  // wheel on the indigo family the derived palettes lean on.
  const neutral = accentLch.C < 0.03
  const baseHue = neutral ? NEUTRAL_BASE_HUE : accentLch.h
  const chroma = Math.max(SLICE_CHROMA_MIN, Math.min(SLICE_CHROMA_MAX, neutral ? SLICE_CHROMA_MAX : accentLch.C))
  // Perceived lightness, not HSL lightness, decides the starting polarity.
  // Saturated yellow/green pages can have a low HSL L while being perceptually
  // very bright; HSL sent those palettes toward the background instead of away.
  const dark = ((bg === undefined ? null : hexToOklab(bg))?.L ?? 1) < 0.55
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
  // Pairwise repair is deliberately bounded to the range whose separation
  // contract we can satisfy. Large palettes stay linear in slice count.
  return count <= GUARANTEED_DELTA_E_MAX
    ? enforceMinDeltaE(colors, bg, dark)
    : dedupeBestEffort(colors, bg, dark)
}

/** A fill is "visible" when it clears BOTH the WCAG and APCA wedge floors (or
 *  when the background is unknown, in which case any fill passes). */
function isVisible(hex: string, bg: string | undefined): boolean {
  if (bg === undefined) return true
  const wcag = wcagContrastRatio(hex, bg)
  const apca = apcaContrast(hex, bg)
  return wcag !== null && apca !== null && wcag >= BG_CONTRAST_FLOOR && apca >= BG_APCA_FLOOR
}

/**
 * Search both OKLCH-lightness directions for a visible fill. The background's
 * actual OKLab lightness chooses which direction is tried first; the opposite
 * direction remains available because chroma gamut-clamping is non-monotonic.
 */
function ensureBgContrast(lch: Oklch, bg: string | undefined, darkBg: boolean): string {
  const initial = oklchToHex(lch)
  if (bg === undefined || isVisible(initial, bg)) return initial
  const bgL = hexToOklab(bg)?.L ?? (darkBg ? 0 : 1)
  const preferred = lch.L >= bgL ? 1 : -1
  for (let i = 1; i <= 24; i++) {
    const amount = i * 0.04
    for (const direction of [preferred, -preferred]) {
      const hex = oklchToHex({ ...lch, L: clampL(lch.L + direction * amount) })
      if (isVisible(hex, bg)) return hex
    }
  }

  // A concrete valid background always has at least one visible achromatic
  // extreme. This also keeps the function total if chromatic gamut-clamping
  // collapses every searched candidate back toward the page color.
  const extremes = ['#000000', '#ffffff'].filter(hex => isVisible(hex, bg))
  if (extremes.length > 0) {
    return extremes.sort((a, b) => (apcaContrast(b, bg) ?? 0) - (apcaContrast(a, bg) ?? 0))[0]!
  }
  // Unreachable for valid six-digit hex backgrounds, retained as a totality
  // guard should the color primitives ever change.
  return initial
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
  // The local repair preserves established palettes when it succeeds. If it
  // cannot meet the documented floor, use a bounded global packing pass over
  // concrete, background-visible sRGB candidates instead of returning a known
  // contract violation.
  return minPairwiseDeltaEOK(out) >= MIN_SLICE_DELTA_E
    ? out
    : packVisibleColors(out, bg)
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

interface LabCandidate { hex: string; lab: Oklab }

/** A deterministic finite candidate corpus in concrete sRGB. It is generated
 * only when local repair fails. Gamut-clamped duplicates are removed before
 * packing. It is intentionally not cached by caller-controlled background:
 * an unbounded color-key cache would turn custom themes into a memory leak. */
function visibleCandidateCorpus(bg: string | undefined): LabCandidate[] {
  const byHex = new Map<string, LabCandidate>()
  const add = (hex: string): void => {
    if (byHex.has(hex) || (bg !== undefined && !isVisible(hex, bg))) return
    const lab = hexToOklab(hex)
    if (lab) byHex.set(hex, { hex, lab })
  }
  add('#000000')
  add('#ffffff')
  for (let li = 0; li <= 22; li++) {
    const L = 0.08 + li * 0.04
    add(oklchToHex({ L, C: 0, h: 0 }))
    for (const C of [0.04, 0.08, 0.12, 0.16, 0.20, 0.24, 0.28]) {
      for (let h = 0; h < 360; h += 10) add(oklchToHex({ L, C, h }))
    }
  }
  return [...byHex.values()]
}

const labDistance = (a: Oklab, b: Oklab): number =>
  Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b)

/** Farthest-point packing over a bounded visible candidate corpus. Slice zero
 * remains anchored when valid; each subsequent choice maximizes its minimum
 * distance to the whole accepted set. */
function packVisibleColors(targets: string[], bg: string | undefined): string[] {
  if (targets.length < 2) return targets
  const corpus = visibleCandidateCorpus(bg)
  const target0 = hexToOklab(targets[0]!)
  if (!target0) return targets
  const selected: LabCandidate[] = [{ hex: targets[0]!, lab: target0 }]
  const used = new Set([targets[0]!.toLowerCase()])

  while (selected.length < targets.length) {
    let best: LabCandidate | undefined
    let bestMin = -1
    let bestTargetDistance = Infinity
    const target = hexToOklab(targets[selected.length]!)
    for (const candidate of corpus) {
      if (used.has(candidate.hex.toLowerCase())) continue
      let min = Infinity
      for (const accepted of selected) min = Math.min(min, labDistance(candidate.lab, accepted.lab))
      const targetDistance = target ? labDistance(candidate.lab, target) : 0
      if (min > bestMin + 1e-12 || (Math.abs(min - bestMin) <= 1e-12 && targetDistance < bestTargetDistance)) {
        best = candidate
        bestMin = min
        bestTargetDistance = targetDistance
      }
    }
    if (!best) return targets
    selected.push(best)
    used.add(best.hex.toLowerCase())
  }
  return selected.map(candidate => candidate.hex)
}

/** Keep large-count generation linear while avoiding obvious repeated fills.
 * This is best-effort only; no perceptual floor is claimed above 24 slices. */
function dedupeBestEffort(colors: string[], bg: string | undefined, darkBg: boolean): string[] {
  const used = new Set<string>()
  return colors.map((hex, index) => {
    if (!used.has(hex.toLowerCase())) {
      used.add(hex.toLowerCase())
      return hex
    }
    const base = hexToOklch(hex)
    if (base) {
      for (let attempt = 1; attempt <= 24; attempt++) {
        const candidate = ensureBgContrast({
          ...base,
          L: clampL(base.L + (attempt % 2 === 0 ? 1 : -1) * Math.ceil(attempt / 2) * 0.008),
          h: (base.h + attempt * 137.508 + index * 0.01) % 360,
        }, bg, darkBg)
        if (!used.has(candidate.toLowerCase())) {
          used.add(candidate.toLowerCase())
          return candidate
        }
      }
    }
    return hex
  })
}
