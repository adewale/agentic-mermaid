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
import {
  PNG_DEFAULT_MIN_LABEL_PX,
  pngRasterDimensions,
  resolvePortablePngOutputPolicy,
  svgIntrinsicDimensions,
  type PortablePngOutputOptions,
} from '../png-contract.ts'

// A labeled edge puts the smallest configured text (edge label, 11px) on the
// canvas, so the base minimum is stable and known.
const SOURCE = 'flowchart LR\n  A[Start] -- go --> B[Finish]'

function legibilityWarnings(source: string, opts: Parameters<typeof renderMermaidPNG>[1]): PngLegibilityWarning[] {
  const collected: PngRasterWarning[] = []
  renderMermaidPNG(source, { ...opts, onWarning: w => collected.push(w) })
  return collected.filter((w): w is PngLegibilityWarning => w.code === 'BELOW_READABLE_SIZE')
}

function warningsForSvg(svg: string, output: PortablePngOutputOptions): PngLegibilityWarning[] {
  const policy = resolvePortablePngOutputPolicy(output)
  return buildPngLegibilityWarnings(svg, policy, pngRasterDimensions(svg, policy))
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
    expect(warning.effectiveScale).toBeCloseTo(
      Math.ceil(100 * warning.naturalHeight / warning.naturalWidth) / warning.naturalHeight,
      10,
    )
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
    expect(warnings[0]!.effectiveScale).toBeCloseTo(
      Math.ceil(warnings[0]!.naturalHeight * 0.3) / warnings[0]!.naturalHeight,
      10,
    )
  })

  test('minLabelPx: 0 disables the gate entirely', () => {
    expect(legibilityWarnings(SOURCE, { scale: 0.1, minLabelPx: 0 })).toHaveLength(0)
  })

  test('a raised floor warns even at the default scale', () => {
    const warnings = legibilityWarnings(SOURCE, { minLabelPx: 30 })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.floorPx).toBe(30)
    expect(warnings[0]!.effectiveMinLabelPx).toBeCloseTo(
      11 * Math.ceil(warnings[0]!.naturalHeight * 2) / warnings[0]!.naturalHeight,
      10,
    )
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

  test('property: warning presence follows finalized integer raster geometry', () => {
    const svg = renderMermaidSVG(SOURCE)
    const bounds = svgIntrinsicDimensions(svg)
    fc.assert(fc.property(fc.integer({ min: 30, max: 4000 }), width => {
      const policy = resolvePortablePngOutputPolicy({ fitTo: { width } })
      const raster = pngRasterDimensions(svg, policy)
      const warnings = buildPngLegibilityWarnings(svg, policy, raster)
      const predicted = (raster.height / bounds.height) * 11 < PNG_DEFAULT_MIN_LABEL_PX
      expect(warnings.length).toBe(predicted ? 1 : 0)
    }), { numRuns: 250 })
  })

  test('uses the final rounded raster height at the width-fit warning boundary', () => {
    // The nominal width ratio puts 11px text just below 9px, but the approved
    // 97px integer height puts it just above. A pre-allocation oracle warned.
    expect(11 * (283 / 346.638)).toBeLessThan(PNG_DEFAULT_MIN_LABEL_PX)
    expect(legibilityWarnings(SOURCE, { fitTo: { width: 283 } })).toHaveLength(0)
  })

  test('fitTo height uses the exact finalized vertical scale', () => {
    const warnings = legibilityWarnings(SOURCE, { fitTo: { height: 48 } })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.effectiveScale).toBe(48 / warnings[0]!.naturalHeight)
    expect(warnings[0]!.cause).toBe('fitTo')
  })

  test('an SVG with no text never warns', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><rect width="10" height="10"/></svg>'
    expect(warningsForSvg(svg, { fitTo: { width: 10 } })).toHaveLength(0)
  })

  test('extension SVG text is measured only when it declares a literal font size', () => {
    const inherited = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><text x="0" y="20">Extension</text></svg>'
    const explicit = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><text x="0" y="20" font-size="12">Extension</text></svg>'

    expect(warningsForSvg(inherited, { fitTo: { width: 10 } })).toHaveLength(0)
    const warnings = warningsForSvg(explicit, { fitTo: { width: 10 } })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      code: 'BELOW_READABLE_SIZE',
      baseMinLabelPx: 12,
    })
    expect(warnings[0]!.effectiveMinLabelPx).toBeCloseTo(1.2, 10)
  })

  test('scales extension font sizes from viewBox user units, not root pixels', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 1000 500"><text font-size="12">Extension</text></svg>'
    const warnings = warningsForSvg(svg, { scale: 1 })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      naturalWidth: 100,
      naturalHeight: 50,
      baseMinLabelPx: 12,
      effectiveScale: 0.1,
    })
    expect(warnings[0]!.effectiveMinLabelPx).toBeCloseTo(1.2, 10)
  })

  test('accepts exponent notation for literal SVG font sizes', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><text font-size="1.2e1">Extension</text></svg>'
    const warning = warningsForSvg(svg, { fitTo: { width: 10 } })[0]!
    expect(warning.baseMinLabelPx).toBe(12)
    expect(warning.effectiveMinLabelPx).toBeCloseTo(1.2, 10)
  })

  test('abstains when transforms or CSS make the effective text size unresolved', () => {
    const scaled = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><g transform="scale(10)"><text font-size="1">scaled</text></g></svg>'
    const overridden = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><style>text { font-size: 24px }</style><text font-size="1">styled</text></svg>'
    const laterInlineOverride = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><rect style="fill:red"/><text font-size="1" style="font-size:24px">styled</text></svg>'
    const shorthandOverride = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><style>text { font: 24px sans-serif }</style><text font-size="1">styled</text></svg>'
    expect(warningsForSvg(scaled, {})).toHaveLength(0)
    expect(warningsForSvg(overridden, {})).toHaveLength(0)
    expect(warningsForSvg(laterInlineOverride, {})).toHaveLength(0)
    expect(warningsForSvg(shorthandOverride, {})).toHaveLength(0)
  })

  test('continues through size-preserving translate and rotate transforms', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><g transform="translate(2 3)"><text transform="rotate(-45, 10, 10)" font-size="12">rotated</text></g></svg>'
    expect(warningsForSvg(svg, { fitTo: { width: 10 } })).toHaveLength(1)
  })

  test('measures literal sizes on SVG text-content elements without matching lookalikes', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">
      <!-- <text font-size="1">comment</text> -->
      <g font-size="2"><text data-font-size="3" font-size = '12'>Text <tspan font-size='6'>small</tspan></text></g>
      <text><textPath font-size="8px">path</textPath></text>
    </svg>`
    const warnings = warningsForSvg(svg, { fitTo: { width: 50 } })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.baseMinLabelPx).toBe(6)
    expect(warnings[0]!.effectiveMinLabelPx).toBe(3)
  })

  test('treats a literal zero-size label as a measurable below-floor failure', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><text font-size="0">hidden</text></svg>'
    const warnings = warningsForSvg(svg, {})
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ baseMinLabelPx: 0, effectiveMinLabelPx: 0 })
  })

  test('warning policy never changes PNG bytes', () => {
    const warnings: PngRasterWarning[] = []
    const enabled = renderMermaidPNG(SOURCE, { scale: 0.3, onWarning: warning => warnings.push(warning) })
    const disabled = renderMermaidPNG(SOURCE, { scale: 0.3, minLabelPx: 0, onWarning: () => {} })
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'BELOW_READABLE_SIZE' }))
    expect(disabled).toEqual(enabled)
  })

  test('large finite floors remain finite in the diagnostic message', () => {
    const warning = legibilityWarnings(SOURCE, { minLabelPx: 1e308 })[0]!
    expect(warning.floorPx).toBe(1e308)
    expect(warning.message).toContain('1e+308px')
    expect(warning.message).not.toContain('Infinity')
  })

  test('negative or non-finite minLabelPx is rejected at the policy boundary', () => {
    expect(() => resolvePortablePngOutputPolicy({ minLabelPx: -1 })).toThrow(RangeError)
    expect(() => resolvePortablePngOutputPolicy({ minLabelPx: Number.NaN })).toThrow(RangeError)
    expect(resolvePortablePngOutputPolicy({}).minLabelPx).toBe(PNG_DEFAULT_MIN_LABEL_PX)
  })
})
