// WCAG AA guard for diagram text. Diagram labels derive their colour from
// --fg via the MIX weights (see src/theme.ts). The muted tier carries real
// informational text — sequence message labels, ER/class member types,
// timeline events, quadrant axis ticks — so it must stay legible: WCAG 1.4.3
// AA requires 4.5:1 for normal text. Before this guard the muted tier was
// fg mixed at 40% and scored ~2.4:1 on the default themes (below AA, below
// even the 3:1 floor). This test fails if MIX.textMuted (or textSec) regresses.
import { describe, it, expect } from 'bun:test'
import { resolveColors, diagramColorVariables, DEFAULTS } from '../theme.ts'
import { knownStyleDescriptors, resolveStyleStack } from '../index.ts'
import { layoutMermaid, measureQuality, parseRegisteredMermaid, renderMermaidSVG } from '../agent/index.ts'
import { renderedTextPairs } from '../../scripts/characterization/visual-quality.ts'

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

describe('derived structural outline contrast', () => {
  it('default outlines clear 3:1 against the palette page', () => {
    const colors = resolveColors(DEFAULTS)
    expect(contrast(colors.nodeStroke, colors.bg)).toBeGreaterThanOrEqual(3)
  })

  it('every built-in look × palette keeps derived outlines legible on its page', () => {
    const descriptors = knownStyleDescriptors().filter(style => style.identity.provenance.source === 'built-in')
    const looks = descriptors.filter(style => style.kind === 'look')
    const palettes = descriptors.filter(style => style.kind === 'palette')
    expect(looks.length).toBeGreaterThan(0)
    expect(palettes.length).toBeGreaterThan(0)
    const failures: string[] = []
    for (const look of looks) {
      for (const palette of palettes) {
        const colors = resolveColors({ ...DEFAULTS, ...resolveStyleStack([look.inputName, palette.inputName])!.colors })
        const ratio = contrast(colors.nodeStroke, colors.bg)
        if (!(ratio >= 3)) failures.push(`${look.inputName} × ${palette.inputName}: ${ratio}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('repairs a global border candidate without changing its authored palette token', () => {
    const palette = { bg: '#282a36', fg: '#f8f8f2', border: '#26262b' }
    const colors = resolveColors(palette)
    expect(contrast(colors.nodeStroke, palette.bg)).toBeGreaterThanOrEqual(3)
    expect(diagramColorVariables(palette)!.get('border')).toBe('#26262b')
    expect(resolveColors({ ...palette, border: '#f8f8f2' }).nodeStroke).toBe('#f8f8f2')
    // Alternating the same page/foreground with another border must not make
    // the cache reuse that border's repaired paint.
    expect(resolveColors(palette)).toEqual(colors)
    for (const border of ['black', 'rgb(38,38,43)', 'hsl(240,6%,16%)', '#26262bff']) {
      const repaired = resolveColors({ ...palette, border }).nodeStroke
      expect(contrast(repaired, palette.bg), border).toBeGreaterThanOrEqual(3)
    }
    expect(resolveColors({ ...palette, border: 'white' }).nodeStroke).toBe('white')
    const cssPalette = resolveColors({ bg: 'rgb(40,42,54)', fg: 'white', border: 'hsl(240,6%,16%)' })
    expect(Object.values(cssPalette).join(' ')).not.toContain('NaN')
    expect(contrast(cssPalette.nodeStroke, palette.bg)).toBeGreaterThanOrEqual(3)
  })

  it('does not invent a contrast result for unresolved or translucent paints', () => {
    for (const border of ['var(--host-border)', 'currentColor', 'transparent', '#282a3680', 'rgba(40,42,54,0.5)']) {
      expect(resolveColors({ bg: '#282a36', fg: '#f8f8f2', border }).nodeStroke).toBe(border)
    }
    for (const bg of ['var(--host-page)', '#282a3680', 'rgba(40,42,54,0.5)']) {
      expect(resolveColors({ bg, fg: '#f8f8f2', border: '#26262b' }).nodeStroke).toBe('#26262b')
    }
  })
})

/** Weakest WCAG ratio over every text run and the surface it is painted on. */
function renderedMinimumTextContrast(source: string): number | null {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(`could not parse: ${source}`)
  const svg = renderMermaidSVG(source, { embedFontImport: false })
  return measureQuality(layoutMermaid(parsed.value), { textPairs: renderedTextPairs(svg) }).minimumTextContrast
}

describe('rendered text contrast', () => {
  it('pie slice labels clear AA against their slice', () => {
    // Slice labels take the higher-contrast of black and white against their
    // slice, so the pie's weakest text clears WCAG AA (it was 3.68:1).
    expect(renderedMinimumTextContrast('pie title Pets\n  "Cats" : 4\n  "Dogs" : 6\n  "Birds" : 2')).toBeGreaterThanOrEqual(AA)
  })

  it('class diagram text keeps its default-theme contrast', () => {
    const source = 'classDiagram\n  class Animal\n  class Dog\n  class Cat\n  Animal <|-- Dog\n  Animal <|-- Cat'
    expect(renderedMinimumTextContrast(source)).toBeCloseTo(13.54, 2)
  })
})
