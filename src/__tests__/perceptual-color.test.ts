// Unit + property tests for the perceptual-color primitives (OKLab/OKLCH,
// ΔE_OK, APCA). These are pure, deterministic functions of concrete sRGB hex,
// so the contracts are exact: round-trips, monotonicity, and known anchors.

import { describe, it, expect } from 'bun:test'
import fc from 'fast-check'
import {
  hexToOklab,
  oklabToHex,
  hexToOklch,
  oklchToHex,
  oklabToOklch,
  deltaEOK,
  minPairwiseDeltaEOK,
  apcaLc,
  apcaContrast,
} from '../shared/perceptual-color.ts'

const hexColorArb = fc
  .integer({ min: 0, max: 0xffffff })
  .map(n => '#' + n.toString(16).padStart(6, '0'))

describe('OKLab / OKLCH conversions', () => {
  it('anchors: white L≈1, black L≈0, both achromatic', () => {
    const white = hexToOklab('#ffffff')!
    const black = hexToOklab('#000000')!
    expect(white.L).toBeCloseTo(1, 3)
    expect(black.L).toBeCloseTo(0, 3)
    expect(Math.hypot(white.a, white.b)).toBeLessThan(1e-3)
    expect(Math.hypot(black.a, black.b)).toBeLessThan(1e-3)
  })

  it('hex → OKLCH → hex round-trips exactly for in-gamut colors', () => {
    fc.assert(
      fc.property(hexColorArb, hex => {
        expect(oklchToHex(hexToOklch(hex)!)).toBe(hex)
      }),
      { numRuns: 300 },
    )
  })

  it('hex → OKLab → hex round-trips exactly', () => {
    fc.assert(
      fc.property(hexColorArb, hex => {
        expect(oklabToHex(hexToOklab(hex)!)).toBe(hex)
      }),
      { numRuns: 300 },
    )
  })

  it('OKLCH lightness is monotone in luminance (lighter grey ⇒ larger L)', () => {
    const greys = ['#111111', '#444444', '#888888', '#cccccc', '#eeeeee']
    const Ls = greys.map(g => hexToOklch(g)!.L)
    for (let i = 1; i < Ls.length; i++) expect(Ls[i]!).toBeGreaterThan(Ls[i - 1]!)
  })

  it('hue is defined in degrees [0,360) and chroma is non-negative', () => {
    fc.assert(
      fc.property(hexColorArb, hex => {
        const { h, C } = oklabToOklch(hexToOklab(hex)!)
        expect(h).toBeGreaterThanOrEqual(0)
        expect(h).toBeLessThan(360)
        expect(C).toBeGreaterThanOrEqual(0)
      }),
      { numRuns: 200 },
    )
  })

  it('returns null on unparseable input', () => {
    expect(hexToOklab('var(--x)')).toBeNull()
    expect(hexToOklch('nonsense')).toBeNull()
    expect(deltaEOK('#fff', 'var(--x)')).toBeNull()
  })
})

describe('ΔE_OK perceptual distance', () => {
  it('is zero for identical colors and symmetric', () => {
    fc.assert(
      fc.property(hexColorArb, hexColorArb, (a, b) => {
        expect(deltaEOK(a, a)).toBe(0)
        expect(deltaEOK(a, b)).toBeCloseTo(deltaEOK(b, a)!, 10)
      }),
      { numRuns: 200 },
    )
  })

  it('black↔white is the largest separation (~1 L unit)', () => {
    expect(deltaEOK('#000000', '#ffffff')).toBeCloseTo(1, 2)
  })

  it('minPairwiseDeltaEOK finds the closest pair', () => {
    const cols = ['#000000', '#ffffff', '#fefefe'] // white/near-white are closest
    expect(minPairwiseDeltaEOK(cols)).toBeCloseTo(deltaEOK('#ffffff', '#fefefe')!, 10)
  })

  it('is Infinity for fewer than two colors', () => {
    expect(minPairwiseDeltaEOK([])).toBe(Infinity)
    expect(minPairwiseDeltaEOK(['#abcdef'])).toBe(Infinity)
  })
})

describe('APCA lightness contrast', () => {
  it('is polarity-signed: dark-on-light positive, light-on-dark negative', () => {
    expect(apcaLc('#000000', '#ffffff')!).toBeGreaterThan(50)
    expect(apcaLc('#ffffff', '#000000')!).toBeLessThan(-50)
  })

  it('a color against itself has zero contrast', () => {
    fc.assert(
      fc.property(hexColorArb, hex => {
        expect(apcaLc(hex, hex)).toBe(0)
      }),
      { numRuns: 100 },
    )
  })

  it('catches dark-on-dark that WCAG overstates', () => {
    // A dim slate on a near-black page: APCA correctly reports near-invisible,
    // where a naive WCAG ratio can still clear a low decorative threshold.
    const lc = apcaContrast('#2a2d3a', '#1a1b26')!
    expect(lc).toBeLessThan(15)
  })

  it('|Lc| grows as a fill separates in lightness from a dark background', () => {
    const bg = '#1a1b26'
    const dim = apcaContrast('#3a3d4a', bg)!
    const bright = apcaContrast('#c9ccd9', bg)!
    expect(bright).toBeGreaterThan(dim)
  })

  it('returns null on unparseable input', () => {
    expect(apcaLc('#fff', 'var(--bg)')).toBeNull()
    expect(apcaContrast('rgb(0,0,0)', '#fff')).toBeNull()
  })
})
