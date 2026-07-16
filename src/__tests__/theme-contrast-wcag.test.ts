// WCAG AA guard for diagram text. Diagram labels derive their colour from
// --fg via the MIX weights (see src/theme.ts). The muted tier carries real
// informational text — sequence message labels, ER/class member types,
// timeline events, quadrant axis ticks — so it must stay legible: WCAG 1.4.3
// AA requires 4.5:1 for normal text. Before this guard the muted tier was
// fg mixed at 40% and scored ~2.4:1 on the default themes (below AA, below
// even the 3:1 floor). This test fails if MIX.textMuted (or textSec) regresses.
import { describe, it, expect } from 'bun:test'
import { resolveColors, DEFAULTS } from '../theme.ts'

// --- WCAG 2.x relative luminance + contrast ratio (sRGB) ---
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]
}
function relativeLuminance(hex: string): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = parseHex(hex)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function contrast(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

const AA = 4.5
// Well-contrasted themes whose base fg/bg can support an AA muted tier. (Low-
// contrast palettes like Solarized cannot, by construction — when full fg/bg
// is only ~5:1 a "muted" tier that also clears 4.5:1 would equal primary text;
// those lift to >=3:1 instead.) bg/fg only, so the tiers are the derived mix.
const THEME_CASES: ReadonlyArray<readonly [string, string, string]> = [
  ['engine default (zinc light)', DEFAULTS.bg, DEFAULTS.fg],
  ['warm light (paper)', '#F5F0E4', '#221E16'],
  ['warm dark (dusk)', '#2A2521', '#E9DFCC'],
]

describe('diagram text contrast (WCAG AA)', () => {
  for (const [name, bg, fg] of THEME_CASES) {
    it(`muted diagram text clears AA ${AA}:1 on ${name}`, () => {
      const { textMuted } = resolveColors({ bg, fg })
      expect(contrast(textMuted, bg)).toBeGreaterThanOrEqual(AA)
    })
    it(`secondary diagram text clears AA ${AA}:1 on ${name}`, () => {
      const { textSec } = resolveColors({ bg, fg })
      expect(contrast(textSec, bg)).toBeGreaterThanOrEqual(AA)
    })
  }

  it('preserves the text hierarchy primary > secondary > muted > faint by contrast', () => {
    const { textSec, textMuted, textFaint } = resolveColors({ bg: DEFAULTS.bg, fg: DEFAULTS.fg })
    const cPrimary = contrast(DEFAULTS.fg, DEFAULTS.bg)
    const cSec = contrast(textSec, DEFAULTS.bg)
    const cMuted = contrast(textMuted, DEFAULTS.bg)
    const cFaint = contrast(textFaint, DEFAULTS.bg)
    expect(cPrimary).toBeGreaterThan(cSec)
    expect(cSec).toBeGreaterThan(cMuted)
    expect(cMuted).toBeGreaterThan(cFaint)
  })
})
