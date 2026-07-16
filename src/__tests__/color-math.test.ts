/**
 * Property tests for the shared hex color math — the one implementation the
 * SVG theme system, ASCII/ANSI themes, chart palettes, and contrast helpers
 * all rely on.
 */
import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { parseHex, tryParseHex, tryParseCssColor, toHex, mixHex, isHexColor, isSixDigitHex, luma255 } from '../shared/color-math.ts'

const channel = fc.integer({ min: 0, max: 255 })
const hexColor = fc.tuple(channel, channel, channel).map(([r, g, b]) => toHex(r, g, b))

describe('shared color math', () => {
  test('parseHex ∘ toHex is the identity on channels', () => {
    fc.assert(fc.property(channel, channel, channel, (r, g, b) => {
      const [r2, g2, b2] = parseHex(toHex(r, g, b))
      return r2 === r && g2 === g && b2 === b
    }))
  })

  test('#RGB shorthand expands per channel digit', () => {
    expect(parseHex('#abc')).toEqual([0xaa, 0xbb, 0xcc])
    expect(parseHex('#fff')).toEqual([255, 255, 255])
  })

  test('mixing a color with itself is the identity at any percentage', () => {
    fc.assert(fc.property(hexColor, fc.integer({ min: 0, max: 100 }), (c, pct) =>
      mixHex(c, c, pct) === c
    ))
  })

  test('mix endpoints: 100% is fg, 0% is bg', () => {
    fc.assert(fc.property(hexColor, hexColor, (fg, bg) =>
      mixHex(fg, bg, 100) === fg && mixHex(fg, bg, 0) === bg
    ))
  })

  test('mix output channels stay within the endpoint interval', () => {
    fc.assert(fc.property(hexColor, hexColor, fc.integer({ min: 0, max: 100 }), (fg, bg, pct) => {
      const [fr, fgc, fb] = parseHex(fg)
      const [br, bgc, bb] = parseHex(bg)
      const [mr, mg, mb] = parseHex(mixHex(fg, bg, pct))
      const within = (m: number, a: number, b: number) => m >= Math.min(a, b) && m <= Math.max(a, b)
      return within(mr, fr, br) && within(mg, fgc, bgc) && within(mb, fb, bb)
    }))
  })

  test('tryParseHex accepts exactly the documented forms', () => {
    expect(tryParseHex('#3b82f6')).toEqual([0x3b, 0x82, 0xf6])
    expect(tryParseHex('#abc')).toEqual([0xaa, 0xbb, 0xcc])
    expect(tryParseHex('#3b82f6ff')).toEqual([0x3b, 0x82, 0xf6])
    expect(tryParseHex('3b82f6')).toBeNull()
    expect(tryParseHex('#3b82')).toBeNull()
    expect(tryParseHex('#xyzxyz')).toBeNull()
  })

  test('validators: every strict hex is also a loose hex', () => {
    fc.assert(fc.property(hexColor, c => isSixDigitHex(c) && isHexColor(c)))
    expect(isHexColor('#abc')).toBe(true)
    expect(isSixDigitHex('#abc')).toBe(false)
  })

  test('CSS HSL hue units resolve to the same concrete sRGB color', () => {
    const cssHex = (value: string): string => {
      const parsed = tryParseCssColor(value)!
      return toHex(parsed[0], parsed[1], parsed[2])
    }
    expect(cssHex('hsl(217 100% 60%)')).toBe('#3381ff')
    expect(cssHex('hsl(217deg 100% 60%)')).toBe('#3381ff')
    expect(cssHex('hsl(241.111111grad 100% 60%)')).toBe('#3381ff')
    expect(cssHex(`hsl(${217 * Math.PI / 180}rad 100% 60%)`)).toBe('#3381ff')
    expect(cssHex('hsl(0.6027777777777777turn 100% 60%)')).toBe('#3381ff')
    expect(tryParseCssColor('hsl(0.5turnjunk 100% 60%)')).toBeNull()
  })

  test('luma255 is bounded and monotone in each channel', () => {
    fc.assert(fc.property(channel, channel, channel, (r, g, b) => {
      const l = luma255(r, g, b)
      return l >= 0 && l <= 255 &&
        luma255(Math.min(r + 1, 255), g, b) >= l &&
        luma255(r, Math.min(g + 1, 255), b) >= l &&
        luma255(r, g, Math.min(b + 1, 255)) >= l
    }))
  })
})
