import { hexToOklch, oklchToHex } from '../../src/shared/perceptual-color.ts'

export interface HarmonySector { offset: number; width: number }
export interface HarmonyTemplate { name: string; sectors: HarmonySector[] }
export interface HarmonyFit { template: HarmonyTemplate; orientation: number; loss: number }

// Cohen-Or et al. 2006, Appendix: i/L/I/Y small = 18°, L large = 79.2°,
// V/Y/X large = 93.6°, T = 180°; paired centers are 180° apart except L = 90°.
// L's reflected form is a distinct candidate because its sectors have unequal widths.
export const HARMONY_TEMPLATES: readonly HarmonyTemplate[] = Object.freeze([
  { name: 'i', sectors: [{ offset: 0, width: 18 }] },
  { name: 'V', sectors: [{ offset: 0, width: 93.6 }] },
  { name: 'L', sectors: [{ offset: 0, width: 18 }, { offset: 90, width: 79.2 }] },
  { name: 'L-mirror', sectors: [{ offset: 0, width: 18 }, { offset: -90, width: 79.2 }] },
  { name: 'I', sectors: [{ offset: 0, width: 18 }, { offset: 180, width: 18 }] },
  { name: 'T', sectors: [{ offset: 0, width: 180 }] },
  { name: 'Y', sectors: [{ offset: 0, width: 18 }, { offset: 180, width: 93.6 }] },
  { name: 'X', sectors: [{ offset: 0, width: 93.6 }, { offset: 180, width: 93.6 }] },
])

const normalizeHue = (hue: number): number => ((hue % 360) + 360) % 360
const signedHueDistance = (from: number, to: number): number => ((from - to + 540) % 360) - 180

function sectorDistance(hue: number, center: number, width: number): number {
  return Math.max(0, Math.abs(signedHueDistance(hue, center)) - width / 2)
}

function templateDistance(hue: number, template: HarmonyTemplate, orientation: number): number {
  return Math.min(...template.sectors.map(sector => sectorDistance(hue, orientation + sector.offset, sector.width)))
}

/** Chroma-weighted mean hue distance outside the template, in degrees. This is
 * the paper's hue-distance × saturation objective adapted to OKLCH chroma. */
export function harmonyLoss(colors: readonly string[], template: HarmonyTemplate, orientation: number): number {
  let weighted = 0
  let weight = 0
  for (const color of colors) {
    const lch = hexToOklch(color)
    if (!lch) continue
    const w = Math.max(lch.C, 0.001)
    weighted += templateDistance(lch.h, template, orientation) * w
    weight += w
  }
  return weight === 0 ? 0 : weighted / weight
}

/** Deterministic 1° exhaustive fit. Palettes are tiny (7..24 colors), making
 * this both cheaper and easier to reproduce than a continuous optimizer. */
export function bestHarmonyFit(colors: readonly string[]): HarmonyFit {
  let best: HarmonyFit | undefined
  for (const template of HARMONY_TEMPLATES) {
    for (let orientation = 0; orientation < 360; orientation++) {
      const loss = harmonyLoss(colors, template, orientation)
      if (!best || loss < best.loss - 1e-12) best = { template, orientation, loss }
    }
  }
  return best!
}

function assignedSector(hue: number, fit: HarmonyFit): { center: number; width: number } {
  let best: { center: number; width: number; distance: number } | undefined
  for (const sector of fit.template.sectors) {
    const center = normalizeHue(fit.orientation + sector.offset)
    const distance = sectorDistance(hue, center, sector.width)
    if (!best || distance < best.distance - 1e-12) best = { center, width: sector.width, distance }
  }
  return best!
}

/** Apply the paper's monotonic Gaussian hue contraction with σ = sectorWidth/2.
 * L and C stay unchanged in OKLCH; conversion back to sRGB is gamut-clamped. */
export function harmonizePalette(colors: readonly string[], fit: HarmonyFit): string[] {
  return colors.map(color => {
    const lch = hexToOklch(color)
    if (!lch || lch.C < 0.001) return color
    const sector = assignedSector(lch.h, fit)
    const signed = signedHueDistance(lch.h, sector.center)
    const sigma = sector.width / 2
    const gaussian = Math.exp(-(signed * signed) / (2 * sigma * sigma))
    const contracted = Math.sign(signed) * (sector.width / 2) * (1 - gaussian)
    return oklchToHex({ ...lch, h: normalizeHue(sector.center + contracted) })
  })
}
