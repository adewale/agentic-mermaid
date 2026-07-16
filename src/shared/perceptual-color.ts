// ============================================================================
// Perceptual color math — OKLab/OKLCH, ΔE_OK, and APCA lightness contrast.
//
// The companion to color-math.ts. That module owns hex parsing, sRGB mixing,
// and the WCAG 2.x luminance/ratio used for the *accessibility gate*. This one
// owns the *perceptually-uniform* primitives the categorical palettes want:
//
//   • OKLab / OKLCH (Ottosson 2020) — a color space where equal coordinate
//     steps read as equal perceived steps, so a constant-lightness hue sweep
//     produces slices that separate evenly. HSL does not: equal HSL lightness
//     across hues is UNEQUAL perceived lightness (yellow at L=50 reads far
//     lighter than blue at L=50), which is exactly why the two-tier HSL ladder
//     let hue-adjacent pie slices collapse toward each other.
//   • ΔE_OK — Euclidean distance in OKLab, a perceptual distance. Used as a
//     minimum-separation floor so no two categorical fills read as the same.
//   • APCA Lc (Somers / Myndex, WCAG-3 candidate) — polarity-signed lightness
//     contrast. WCAG 2.x is polarity-blind and *overstates* dark-on-dark, so a
//     wedge that "passes" WCAG can vanish on a dark theme; APCA scores it
//     correctly.
//
// Everything here is a pure, deterministic function of concrete sRGB hex — no
// DOM, no rasterization, no PRNG — so it preserves the repo's "identical input
// → identical output" contract and drops in beside the WCAG primitives.
// Matrices/constants are the published OKLab values (bottosson.github.io) and
// the APCA-W3 0.1.9 constants.
// ============================================================================

import { tryParseHex, toHex } from './color-math.ts'

export interface Oklab {
  /** Perceived lightness, ~0 (black) … ~1 (white). */
  L: number
  a: number
  b: number
}

export interface Oklch {
  /** Perceived lightness, ~0 … ~1. */
  L: number
  /** Chroma, 0 (grey) … ~0.4 (most saturated sRGB). */
  C: number
  /** Hue angle in degrees, 0 … 360. */
  h: number
}

/** sRGB channel (0..1) → linear-light. */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Linear-light channel → sRGB (0..1). */
function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
}

/** Concrete sRGB hex → OKLab, or null when the hex is unparseable. */
export function hexToOklab(hex: string): Oklab | null {
  const rgb = tryParseHex(hex)
  if (!rgb) return null
  const r = srgbToLinear(rgb[0] / 255)
  const g = srgbToLinear(rgb[1] / 255)
  const b = srgbToLinear(rgb[2] / 255)

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b

  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)

  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  }
}

/** OKLab → concrete sRGB hex (gamut-clamped per channel). */
export function oklabToHex(lab: Oklab): string {
  const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b
  const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b
  const s_ = lab.L - 0.0894841775 * lab.a - 1.2914855480 * lab.b

  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_

  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s

  return toHex(
    linearToSrgb(r) * 255,
    linearToSrgb(g) * 255,
    linearToSrgb(b) * 255,
  )
}

/** OKLab → OKLCH (cylindrical: hue in degrees, chroma as the radius). */
export function oklabToOklch(lab: Oklab): Oklch {
  const C = Math.hypot(lab.a, lab.b)
  const h = ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360
  return { L: lab.L, C, h }
}

/** OKLCH → OKLab. */
export function oklchToOklab(lch: Oklch): Oklab {
  const rad = (lch.h * Math.PI) / 180
  return { L: lch.L, a: lch.C * Math.cos(rad), b: lch.C * Math.sin(rad) }
}

/** OKLCH → concrete sRGB hex. */
export function oklchToHex(lch: Oklch): string {
  return oklabToHex(oklchToOklab(lch))
}

/** Concrete sRGB hex → OKLCH, or null when unparseable. */
export function hexToOklch(hex: string): Oklch | null {
  const lab = hexToOklab(hex)
  return lab ? oklabToOklch(lab) : null
}

/**
 * ΔE_OK — perceptual distance between two hex colors (Euclidean in OKLab),
 * or null when either is unparseable. Rough anchors: ~0.02 is a just-noticeable
 * difference; ~0.1 reads as a clearly distinct step.
 */
export function deltaEOK(a: string, b: string): number | null {
  const la = hexToOklab(a)
  const lb = hexToOklab(b)
  if (!la || !lb) return null
  return Math.hypot(la.L - lb.L, la.a - lb.a, la.b - lb.b)
}

/** Smallest ΔE_OK over every unordered pair in `colors` (Infinity for <2). */
export function minPairwiseDeltaEOK(colors: string[]): number {
  let min = Infinity
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const d = deltaEOK(colors[i]!, colors[j]!)
      if (d !== null && d < min) min = d
    }
  }
  return min
}

// ---------------------------------------------------------------------------
// APCA — Accessible Perceptual Contrast Algorithm (WCAG-3 candidate).
// Constants from APCA-W3 0.1.9. Returns signed lightness contrast Lc in the
// range ~[-108, 106]: positive = dark text on light bg, negative = the reverse.
// ---------------------------------------------------------------------------

const APCA_TRC = 2.4
const APCA_R = 0.2126729
const APCA_G = 0.7151522
const APCA_B = 0.0721750
const APCA_BLACK_THRESHOLD = 0.022
const APCA_BLACK_CLAMP = 1.414
const APCA_SCALE_BOW = 1.14
const APCA_SCALE_WOB = 1.14
const APCA_LO_BOW_OFFSET = 0.027
const APCA_LO_WOB_OFFSET = 0.027
const APCA_DELTA_Y_MIN = 0.0005
const APCA_LO_CLIP = 0.1

/** APCA screen luminance Y (0..1) for a concrete sRGB hex, or null. */
function apcaLuminance(hex: string): number | null {
  const rgb = tryParseHex(hex)
  if (!rgb) return null
  const y =
    APCA_R * (rgb[0] / 255) ** APCA_TRC +
    APCA_G * (rgb[1] / 255) ** APCA_TRC +
    APCA_B * (rgb[2] / 255) ** APCA_TRC
  // Soft-clamp very dark luminance so near-blacks don't over-report contrast.
  return y < APCA_BLACK_THRESHOLD ? y + (APCA_BLACK_THRESHOLD - y) ** APCA_BLACK_CLAMP : y
}

/**
 * Signed APCA lightness contrast (Lc) of `text` against `background`, or null
 * when either color is unparseable. Polarity-aware: unlike WCAG's ratio it does
 * not overstate dark-on-dark.
 */
export function apcaLc(text: string, background: string): number | null {
  const ytxt = apcaLuminance(text)
  const ybg = apcaLuminance(background)
  if (ytxt === null || ybg === null) return null
  if (Math.abs(ybg - ytxt) < APCA_DELTA_Y_MIN) return 0

  let sapc: number
  let output: number
  if (ybg > ytxt) {
    // Normal polarity: darker text on a lighter background.
    sapc = (ybg ** 0.56 - ytxt ** 0.57) * APCA_SCALE_BOW
    output = sapc < APCA_LO_CLIP ? 0 : sapc - APCA_LO_BOW_OFFSET
  } else {
    // Reverse polarity: lighter text on a darker background.
    sapc = (ybg ** 0.65 - ytxt ** 0.62) * APCA_SCALE_WOB
    output = sapc > -APCA_LO_CLIP ? 0 : sapc + APCA_LO_WOB_OFFSET
  }
  return output * 100
}

/**
 * Absolute APCA contrast — |Lc| — a polarity-independent legibility magnitude,
 * or null when unparseable. Handy as a "this mark is visible against the page"
 * floor for large color areas (wedges, bars) where WCAG mis-scores dark themes.
 */
export function apcaContrast(a: string, b: string): number | null {
  const lc = apcaLc(a, b)
  return lc === null ? null : Math.abs(lc)
}
