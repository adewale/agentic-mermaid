// Impact tests for the OKLCH + ΔE_OK + APCA palette (ideas #1–3).
//
// These show the change is (a) SYSTEMATIC — the collision floor holds across
// the whole realistic count range, not just the counts spot-checked elsewhere —
// and (b) CROSS-FAMILY — because radar routes its per-curve colors through the
// same shared `pieSliceColors`, a >6-curve radar inherits the perceptually-even,
// collision-free palette end to end (the audit surfaced this reach).

import { describe, it, expect } from 'bun:test'
import { pieSliceColors } from '../pie/palette.ts'
import { renderMermaidSVG } from '../index.ts'
import { minPairwiseDeltaEOK, apcaContrast } from '../shared/perceptual-color.ts'
import { wcagContrastRatio } from '../shared/color-math.ts'
import { BUILTIN_PALETTE_DEFINITIONS } from '../palette-catalog.ts'
import { categoricalPaletteWithDiagnostics } from '../shared/categorical-palette.ts'

describe('perceptual palette — systematic impact', () => {
  it('the ΔE_OK collision floor holds across the whole realistic count range (7…24)', () => {
    // A dense sweep, not the sparse spot-checks: every high-count palette on
    // both a light and a dark theme keeps every pair ≥ 0.10 apart.
    for (let count = 7; count <= 24; count++) {
      for (const bg of ['#ffffff', '#1a1b26']) {
        const cols = pieSliceColors(count, { accent: '#3b82f6', bg })
        expect(new Set(cols).size).toBe(count)
        expect(minPairwiseDeltaEOK(cols)).toBeGreaterThanOrEqual(0.10)
      }
    }
  })

  it('every derived fill clears both visibility floors across the range', () => {
    for (let count = 7; count <= 24; count++) {
      for (const bg of ['#ffffff', '#1a1b26']) {
        for (const c of pieSliceColors(count, { accent: '#3b82f6', bg })) {
          expect(wcagContrastRatio(c, bg)!).toBeGreaterThanOrEqual(1.25)
          expect(apcaContrast(c, bg)!).toBeGreaterThanOrEqual(15)
        }
      }
    }
  })

  it('keeps the hard separation and visibility contracts across every built-in palette', () => {
    for (const { inputName: name, colors: theme } of BUILTIN_PALETTE_DEFINITIONS) {
      for (let count = 7; count <= 24; count++) {
        const cols = pieSliceColors(count, { accent: 'accent' in theme ? theme.accent : theme.fg, bg: theme.bg })
        expect(new Set(cols).size, `${name} at ${count} slices`).toBe(count)
        expect(minPairwiseDeltaEOK(cols), `${name} at ${count} slices`).toBeGreaterThanOrEqual(0.10)
        for (const color of cols) {
          expect(wcagContrastRatio(color, theme.bg)!, `${name}: ${color}`).toBeGreaterThanOrEqual(1.25)
          expect(apcaContrast(color, theme.bg)!, `${name}: ${color}`).toBeGreaterThanOrEqual(15)
        }
      }
    }
  })

  it('repairs adversarial custom accent/background pairs', () => {
    const cases = [
      { count: 24, accent: '#ff0000', bg: '#777777' }, // former ΔE_OK 0.0789 failure
      { count: 9, accent: '#b1e86f', bg: '#eafb02' }, // perceptually bright saturated page
    ]
    for (const { count, accent, bg } of cases) {
      const cols = pieSliceColors(count, { accent, bg })
      expect(new Set(cols).size).toBe(count)
      for (const color of cols) {
        expect(wcagContrastRatio(color, bg)!).toBeGreaterThanOrEqual(1.25)
        expect(apcaContrast(color, bg)!).toBeGreaterThanOrEqual(15)
      }
      expect(minPairwiseDeltaEOK(cols)).toBeGreaterThanOrEqual(0.10)
    }
  })

  it('keeps large-count work linear without relying on machine timing', () => {
    const themes = [
      { accent: '#3b82f6', bg: '#ffffff' },
      { accent: '#7aa2f7', bg: '#1a1b26' },
      { accent: '#ff0000', bg: '#777777' },
      { accent: '#888888', bg: '#888888' },
    ]

    for (const count of [25, 64, 256, 1000]) {
      for (const inputs of themes) {
        const { colors, diagnostics } = categoricalPaletteWithDiagnostics(count, inputs)
        expect(colors).toEqual(pieSliceColors(count, inputs))
        expect(colors).toHaveLength(count)
        expect(new Set(colors).size).toBe(count)
        expect(diagnostics.path).toBe('linear-tail')
        expect(diagnostics.emittedCount).toBe(count)
        expect(diagnostics.tailItems).toBe(count)
        expect(diagnostics.pairDistanceChecks).toBe(0)
        // Every search loop is statically bounded. Counting the real branch's
        // candidate work pins that invariant deterministically across machines;
        // observational latency belongs in eval/palette-performance instead.
        expect(diagnostics.candidateEvaluations).toBeLessThanOrEqual(1_201 * count)
      }
    }
  })
})

describe('perceptual palette — cross-family reach (radar)', () => {
  // Radar lowers its per-curve fills onto the shared `pieSliceColors` path
  // (docs/design/system/cross-family-aesthetics.md L3), so >6 curves get the
  // OKLCH palette for free. Extract the rendered curve fills and check them.
  const radarSource = (curves: number): string => {
    const axes = ['speed', 'safety', 'ergonomics', 'ecosystem', 'tooling', 'docs']
    const rows = Array.from({ length: curves }, (_u, i) =>
      `  curve c${i}{${axes.map((_a, j) => ((i + j) % 5) + 1).join(', ')}}`)
    return `radar-beta\n  axis ${axes.join(', ')}\n${rows.join('\n')}`
  }
  const curveFills = (svg: string): string[] => {
    // radar-area is the filled polygon per curve; read its fill regardless of
    // attribute order. Grid/axis/text use CSS vars, so only curves are hex.
    return [...svg.matchAll(/<[^>]*\bradar-area\b[^>]*>/g)]
      .map(el => el[0].match(/fill="(#[0-9a-fA-F]{6})"/)?.[1])
      .filter((c): c is string => Boolean(c))
  }

  it('an 8-curve radar renders 8 perceptually-distinct, visible curve colors', () => {
    const fills = curveFills(renderMermaidSVG(radarSource(8), { style: 'github-light' }))
    expect(fills.length).toBe(8)
    expect(new Set(fills).size).toBe(8)
    expect(minPairwiseDeltaEOK(fills)).toBeGreaterThanOrEqual(0.10)
    for (const c of fills) expect(apcaContrast(c, '#ffffff')!).toBeGreaterThanOrEqual(15)
  })

  it('is deterministic across renders', () => {
    const a = curveFills(renderMermaidSVG(radarSource(8), { style: 'github-light' }))
    const b = curveFills(renderMermaidSVG(radarSource(8), { style: 'github-light' }))
    expect(a).toEqual(b)
  })
})
