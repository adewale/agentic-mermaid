// One perceptual contract for peer-category colors at every count. Before this
// suite the contract was asserted only from seven colors upward, while the
// legacy ladder that serves one to six colors had neither a separation nor a
// visibility guarantee (at six series every built-in style held a pair below
// ΔE_OK 0.06). The ladder stays as the starting point, and colors that already
// meet the contract keep their exact bytes.
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { BUILTIN_PALETTE_DEFINITIONS } from '../palette-catalog.ts'
import { renderMermaidSVG } from '../index.ts'
import { categoricalPalette } from '../shared/categorical-palette.ts'
import { wcagContrastRatio } from '../shared/color-math.ts'
import { apcaContrast, minPairwiseDeltaEOK } from '../shared/perceptual-color.ts'
import { getSeriesColor } from '../xychart/colors.ts'

const MIN_DELTA_E = 0.1
const hexArb = fc.integer({ min: 0, max: 0xffffff }).map(value => `#${value.toString(16).padStart(6, '0')}`)

function visible(color: string, bg: string): boolean {
  return wcagContrastRatio(color, bg)! >= 1.25 && Math.abs(apcaContrast(color, bg)!) >= 15
}

describe('peer-category palette contract', () => {
  it('separates every pair and keeps every color visible, for any accent, background, and count', () => {
    fc.assert(
      fc.property(hexArb, hexArb, fc.integer({ min: 1, max: 24 }), (accent, bg, count) => {
        const colors = categoricalPalette(count, { accent, bg })
        expect(colors).toHaveLength(count)
        if (count > 1) expect(minPairwiseDeltaEOK(colors)!).toBeGreaterThanOrEqual(MIN_DELTA_E)
        for (const color of colors) expect(visible(color, bg)).toBe(true)
      }),
      { numRuns: 400 },
    )
  })

  it('keeps the legacy ladder byte-for-byte wherever it already meets the contract', () => {
    fc.assert(
      fc.property(hexArb, hexArb, fc.integer({ min: 1, max: 6 }), (accent, bg, count) => {
        const ladder = Array.from({ length: count }, (_unused, index) => getSeriesColor(index, accent, bg))
        const meets = (count < 2 || minPairwiseDeltaEOK(ladder)! >= MIN_DELTA_E) && ladder.every(color => visible(color, bg))
        if (meets) expect(categoricalPalette(count, { accent, bg })).toEqual(ladder)
      }),
      { numRuns: 400 },
    )
  })

  it('renders separated peer colors in every built-in style for two to eight series', () => {
    const styles: Array<string | undefined> = [undefined, ...BUILTIN_PALETTE_DEFINITIONS.map(palette => palette.inputName)]
    for (const style of styles) {
      for (let count = 2; count <= 8; count++) {
        const options = style ? { style } : {}
        const pie = renderMermaidSVG(`pie\n${Array.from({ length: count }, (_unused, index) => `  "S${index}" : ${10 + index}`).join('\n')}`, options)
        const pieFills = [...pie.matchAll(/class="pie-slice"[^>]*?fill="(#[0-9a-fA-F]{6})"/g)].map(match => match[1]!)
        const xy = renderMermaidSVG(`xychart-beta\n  x-axis [A, B]\n  y-axis 0 --> 100\n${Array.from({ length: count }, (_unused, index) => `  line "S${index}" [${10 + index}, ${20 + index}]`).join('\n')}`, options)
        const series = [...xy.matchAll(/--xychart-color-\d+:\s*(#[0-9a-fA-F]{6})/g)].map(match => match[1]!)
        for (const [family, colors] of [['pie', pieFills], ['xychart', series]] as const) {
          expect({ style: style ?? 'default', count, family, found: colors.length }).toEqual({ style: style ?? 'default', count, family, found: count })
          expect({ style: style ?? 'default', count, family, separated: minPairwiseDeltaEOK(colors)! >= MIN_DELTA_E })
            .toEqual({ style: style ?? 'default', count, family, separated: true })
        }
      }
    }
  })
})
