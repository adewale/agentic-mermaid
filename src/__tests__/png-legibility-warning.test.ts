// BELOW_READABLE_SIZE — the raster legibility gate. Rasterization scales
// every glyph by the resolved fitTo/scale ratio (the root is pinned, font
// sizes are never rewritten), so text can silently shrink below legibility.
// These tests pin the warning's presence predicate, its structured fields,
// the minLabelPx floor contract (default 9, 0 disables), and determinism.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { renderMermaidPNG, type PngRasterWarning, type PngLegibilityWarning } from '../agent/png.ts'
import { renderMermaidSVG } from '../index.ts'
import { buildPngLegibilityWarnings } from '../shared/png-legibility-warnings.ts'
import { PNG_DEFAULT_MIN_LABEL_PX, resolvePortablePngOutputPolicy, svgIntrinsicDimensions } from '../png-contract.ts'

// A labeled edge puts the smallest configured text (edge label, 11px) on the
// canvas, so the base minimum is stable and known.
const SOURCE = 'flowchart LR\n  A[Start] -- go --> B[Finish]'

function legibilityWarnings(source: string, opts: Parameters<typeof renderMermaidPNG>[1]): PngLegibilityWarning[] {
  const collected: PngRasterWarning[] = []
  renderMermaidPNG(source, { ...opts, onWarning: w => collected.push(w) })
  return collected.filter((w): w is PngLegibilityWarning => w.code === 'BELOW_READABLE_SIZE')
}

describe('BELOW_READABLE_SIZE raster legibility warning', () => {
  test('a small fitTo width emits exactly one structured warning with cause fitTo', () => {
    const warnings = legibilityWarnings(SOURCE, { fitTo: { width: 100 } })
    expect(warnings).toHaveLength(1)
    const warning = warnings[0]!
    expect(warning.cause).toBe('fitTo')
    expect(warning.floorPx).toBe(PNG_DEFAULT_MIN_LABEL_PX)
    expect(warning.baseMinLabelPx).toBe(11)
    expect(warning.naturalWidth).toBeGreaterThan(100)
    expect(warning.effectiveScale).toBeCloseTo(100 / warning.naturalWidth, 10)
    expect(warning.effectiveMinLabelPx).toBeCloseTo(11 * warning.effectiveScale, 10)
    expect(warning.effectiveMinLabelPx).toBeLessThan(PNG_DEFAULT_MIN_LABEL_PX)
    expect(warning.message).toContain('legibility floor')
  })

  test('the default render does not warn', () => {
    expect(legibilityWarnings(SOURCE, {})).toHaveLength(0)
  })

  test('an explicit small scale warns with cause scale', () => {
    const warnings = legibilityWarnings(SOURCE, { scale: 0.3 })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.cause).toBe('scale')
    expect(warnings[0]!.effectiveScale).toBe(0.3)
  })

  test('minLabelPx: 0 disables the gate entirely', () => {
    expect(legibilityWarnings(SOURCE, { scale: 0.1, minLabelPx: 0 })).toHaveLength(0)
  })

  test('a raised floor warns even at the default scale', () => {
    const warnings = legibilityWarnings(SOURCE, { minLabelPx: 30 })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.floorPx).toBe(30)
    expect(warnings[0]!.effectiveMinLabelPx).toBe(22)
  })

  test('exactly at the floor does not warn; one step below does', () => {
    expect(legibilityWarnings(SOURCE, { scale: 1, minLabelPx: 11 })).toHaveLength(0)
    expect(legibilityWarnings(SOURCE, { scale: 1, minLabelPx: 11.5 })).toHaveLength(1)
  })

  test('warnings are deterministic across renders', () => {
    const first = legibilityWarnings(SOURCE, { fitTo: { width: 120 } })
    const second = legibilityWarnings(SOURCE, { fitTo: { width: 120 } })
    expect(second).toEqual(first)
  })

  test('property: warning presence matches the resolution math for any fit width', () => {
    const svg = renderMermaidSVG(SOURCE)
    const bounds = svgIntrinsicDimensions(svg)
    fc.assert(fc.property(fc.integer({ min: 30, max: 4000 }), width => {
      const policy = resolvePortablePngOutputPolicy({ fitTo: { width } })
      const warnings = buildPngLegibilityWarnings(svg, policy)
      const predicted = (width / bounds.width) * 11 < PNG_DEFAULT_MIN_LABEL_PX
      expect(warnings.length).toBe(predicted ? 1 : 0)
    }), { numRuns: 250 })
  })

  test('an SVG with no text never warns', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><rect width="10" height="10"/></svg>'
    const policy = resolvePortablePngOutputPolicy({ fitTo: { width: 10 } })
    expect(buildPngLegibilityWarnings(svg, policy)).toHaveLength(0)
  })

  test('negative or non-finite minLabelPx is rejected at the policy boundary', () => {
    expect(() => resolvePortablePngOutputPolicy({ minLabelPx: -1 })).toThrow(RangeError)
    expect(() => resolvePortablePngOutputPolicy({ minLabelPx: Number.NaN })).toThrow(RangeError)
    expect(resolvePortablePngOutputPolicy({}).minLabelPx).toBe(PNG_DEFAULT_MIN_LABEL_PX)
  })
})
