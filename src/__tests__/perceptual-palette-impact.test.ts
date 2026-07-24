// Impact tests for the OKLCH + ΔE_OK + APCA palette (ideas #1–3).
//
// These show the change is (a) SYSTEMATIC — the collision floor holds across
// the whole realistic count range, not just the counts spot-checked elsewhere —
// and (b) CROSS-FAMILY — because radar routes its per-curve colors through the
// same shared `pieSliceColors`, a >6-curve radar inherits the perceptually-even,
// collision-free palette end to end (the audit surfaced this reach).

import { describe, expect, it } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { BUILTIN_PALETTE_DEFINITIONS } from '../palette-catalog.ts'
import { pieSliceColors } from '../pie/palette.ts'
import { categoricalPaletteWithDiagnostics, ensureCompositedBgContrast } from '../shared/categorical-palette.ts'
import { mixHex, wcagContrastRatio } from '../shared/color-math.ts'
import { apcaContrast, minPairwiseDeltaEOK } from '../shared/perceptual-color.ts'

describe('perceptual palette — systematic impact', () => {
  it('the ΔE_OK collision floor holds across the whole realistic count range (7…24)', () => {
    // A dense sweep, not the sparse spot-checks: every high-count palette on
    // both a light and a dark theme keeps every pair ≥ 0.10 apart.
    for (let count = 7; count <= 24; count++) {
      for (const bg of ['#ffffff', '#1a1b26']) {
        const cols = pieSliceColors(count, { accent: '#3b82f6', bg })
        expect(new Set(cols).size).toBe(count)
        expect(minPairwiseDeltaEOK(cols)).toBeGreaterThanOrEqual(0.1)
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
        expect(minPairwiseDeltaEOK(cols), `${name} at ${count} slices`).toBeGreaterThanOrEqual(0.1)
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
      expect(minPairwiseDeltaEOK(cols)).toBeGreaterThanOrEqual(0.1)
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

describe('perceptual palette — translucent-mark compensation (ensureCompositedBgContrast)', () => {
  // The raw-paint floors above were derived for OPAQUE fills. A mark drawn at
  // partial opacity closes most of its distance to the page — measured before
  // compensation: palette colors that clear WCAG 1.25 / APCA 15 raw drop to
  // WCAG ≈1.0 / APCA 0 at 50% over several built-in backgrounds. This is the
  // effective-color contract for every translucent derived-paint consumer.
  it('the composited color clears both wedge floors across every built-in palette', () => {
    for (const { colors: theme } of BUILTIN_PALETTE_DEFINITIONS) {
      const accent = 'accent' in theme ? theme.accent : theme.fg
      for (const count of [2, 4, 6, 8, 12, 24]) {
        for (const raw of pieSliceColors(count, { accent, bg: theme.bg })) {
          const paint = ensureCompositedBgContrast(raw, theme.bg, 50)
          const effective = mixHex(paint, theme.bg, 50)
          expect(wcagContrastRatio(effective, theme.bg)!).toBeGreaterThanOrEqual(1.25)
          expect(apcaContrast(effective, theme.bg)!).toBeGreaterThanOrEqual(15)
        }
      }
    }
  })

  it('an already-visible composite returns the paint byte-identical; unknown backdrops are not repainted', () => {
    expect(ensureCompositedBgContrast('#1d4ed8', '#ffffff', 50)).toBe('#1d4ed8')
    expect(ensureCompositedBgContrast('#1d4ed8', undefined, 50)).toBe('#1d4ed8')
    expect(ensureCompositedBgContrast('#1d4ed8', 'rgba(255,255,255,0.5)', 50)).toBe('#1d4ed8')
  })
})

describe('perceptual palette — cross-family reach (sankey)', () => {
  // Sankey node fills route through the shared `pieSliceColors` path (L3), and
  // its ribbons are the repo's first translucent SOLE-ENCODING marks — the
  // ribbon at 0.5 opacity is the only visual a flow gets. Node fills are held
  // to the raw floors; ribbon strokes to the COMPOSITED floors.
  const sankeySource = (sources: number): string => {
    const rows = Array.from({ length: sources }, (_u, i) => `  S${i},Hub,${i + 1}`)
    const total = (sources * (sources + 1)) / 2
    return `sankey-beta\n${rows.join('\n')}\n  Hub,Out,${total}`
  }
  const attrColors = (svg: string, pattern: RegExp): string[] => [...svg.matchAll(pattern)].map(m => m[1]!).filter((c): c is string => Boolean(c))

  it('a 10-node sankey renders distinct, floor-clearing node fills and visible composited ribbons', () => {
    for (const [bg, options] of [
      ['#ffffff', { style: 'github-light' }],
      ['#1a1b26', { bg: '#1a1b26', fg: '#c0caf5', accent: '#7aa2f7' }],
    ] as const) {
      const svg = renderMermaidSVG(sankeySource(8), options as never)
      const fills = attrColors(svg, /class="sankey-node"[^/]*?fill="(#[0-9a-fA-F]{6})"/g)
      expect(fills.length).toBe(10)
      expect(new Set(fills).size).toBe(10)
      expect(minPairwiseDeltaEOK(fills)).toBeGreaterThanOrEqual(0.1)
      for (const fill of fills) expect(apcaContrast(fill, bg)!).toBeGreaterThanOrEqual(15)
      const strokes = attrColors(svg, /class="sankey-link"[^/]*?stroke="(#[0-9a-fA-F]{6})"/g)
      expect(strokes.length).toBe(9)
      for (const stroke of strokes) {
        const effective = mixHex(stroke, bg, 50)
        expect(wcagContrastRatio(effective, bg)!).toBeGreaterThanOrEqual(1.25)
        expect(apcaContrast(effective, bg)!).toBeGreaterThanOrEqual(15)
      }
    }
  })

  it('every linkColor mode stays composited-visible and deterministic', () => {
    for (const mode of ['source', 'target', 'gradient'] as const) {
      const source = `---\nconfig:\n  sankey:\n    linkColor: ${mode}\n---\n${sankeySource(8)}`
      const first = renderMermaidSVG(source, { style: 'github-light' })
      expect(renderMermaidSVG(source, { style: 'github-light' })).toBe(first)
      for (const stroke of attrColors(first, /class="sankey-link"[^/]*?stroke="(#[0-9a-fA-F]{6})"/g)) {
        expect(apcaContrast(mixHex(stroke, '#ffffff', 50), '#ffffff')!).toBeGreaterThanOrEqual(15)
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
    const rows = Array.from({ length: curves }, (_u, i) => `  curve c${i}{${axes.map((_a, j) => ((i + j) % 5) + 1).join(', ')}}`)
    return `radar-beta\n  axis ${axes.join(', ')}\n${rows.join('\n')}`
  }
  const curveFills = (svg: string): string[] => {
    // radar-area is the filled polygon per curve; read its fill regardless of
    // attribute order. Grid/axis/text use CSS vars, so only curves are hex.
    return [...svg.matchAll(/<[^>]*\bradar-area\b[^>]*>/g)].map(el => el[0].match(/fill="(#[0-9a-fA-F]{6})"/)?.[1]).filter((c): c is string => Boolean(c))
  }

  it('an 8-curve radar renders 8 perceptually-distinct, visible curve colors', () => {
    const fills = curveFills(renderMermaidSVG(radarSource(8), { style: 'github-light' }))
    expect(fills.length).toBe(8)
    expect(new Set(fills).size).toBe(8)
    expect(minPairwiseDeltaEOK(fills)).toBeGreaterThanOrEqual(0.1)
    for (const c of fills) expect(apcaContrast(c, '#ffffff')!).toBeGreaterThanOrEqual(15)
  })

  it('is deterministic across renders', () => {
    const a = curveFills(renderMermaidSVG(radarSource(8), { style: 'github-light' }))
    const b = curveFills(renderMermaidSVG(radarSource(8), { style: 'github-light' }))
    expect(a).toEqual(b)
  })
})
