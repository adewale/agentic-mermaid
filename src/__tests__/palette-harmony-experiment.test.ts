import { describe, expect, it } from 'bun:test'
import { categoricalPalette } from '../shared/categorical-palette.ts'
import {
  HARMONY_TEMPLATES,
  bestHarmonyFit,
  harmonizePalette,
  harmonyLoss,
} from '../../eval/palette-harmony/harmony.ts'

describe('optional {1,2,3,4} harmony experiment', () => {
  it('encodes the published Matsuda sector geometry', () => {
    expect(HARMONY_TEMPLATES.find(template => template.name === 'i')!.sectors).toEqual([{ offset: 0, width: 18 }])
    expect(HARMONY_TEMPLATES.find(template => template.name === 'T')!.sectors).toEqual([{ offset: 0, width: 180 }])
    expect(HARMONY_TEMPLATES.find(template => template.name === 'X')!.sectors).toEqual([
      { offset: 0, width: 93.6 }, { offset: 180, width: 93.6 },
    ])
    expect(HARMONY_TEMPLATES.find(template => template.name === 'L')!.sectors[1]).toEqual({ offset: 90, width: 79.2 })
  })

  it('deterministically reduces the fitted harmony loss', () => {
    const base = categoricalPalette(12, { accent: '#0969da', bg: '#ffffff' })
    const fit = bestHarmonyFit(base)
    const harmony = harmonizePalette(base, fit)
    expect(fit).toEqual(bestHarmonyFit(base))
    expect(harmony).toEqual(harmonizePalette(base, fit))
    expect(harmonyLoss(harmony, fit.template, fit.orientation)).toBeLessThan(fit.loss)
  })
})
