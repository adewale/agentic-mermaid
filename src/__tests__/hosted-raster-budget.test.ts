// Shared PNG allocation budget: output pixels = the resolved scale/fit
// projection, so every substrate rejects a large request before rasterization.

import { describe, expect, test } from 'bun:test'
import {
  assertPngRasterBudget,
  assertHostedPngRasterBudget,
  MAX_HOSTED_PNG_PIXELS,
  MAX_PNG_PIXELS,
  MAX_PNG_RASTER_DIMENSION,
  prepareSvgForPngRasterization,
} from '../png-contract.ts'
import { renderMermaidSVG } from '../index.ts'

describe('shared PNG raster budget', () => {
  test('a real small diagram passes at a high portable scale within budget', () => {
    const svg = renderMermaidSVG('flowchart LR\n  A --> B')
    expect(() => assertPngRasterBudget(svg, 8)).not.toThrow()
  })

  test('bounds × scale² over the budget is rejected with the cap named', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10000 10000" width="10000" height="10000"></svg>'
    expect(() => assertPngRasterBudget(svg, 8)).toThrow(/MP/)
    expect(() => assertPngRasterBudget(svg, 0.1)).not.toThrow()
  })

  test('the budget matches its documented ~4096² ceiling', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4000 4000" width="4000" height="4000"></svg>'
    expect(() => assertPngRasterBudget(svg, 1)).not.toThrow()
    expect(() => assertPngRasterBudget(svg, 2)).toThrow(/MP/)
    expect(MAX_PNG_PIXELS).toBe(16_777_216)
    expect(MAX_PNG_RASTER_DIMENSION).toBe(16_384)
  })

  test('an SVG without parseable bounds is rejected rather than trusted', () => {
    expect(() => assertPngRasterBudget('<svg>no viewbox</svg>', 2)).toThrow(/width|bounds/)
  })

  test('fit-to policies are budgeted from their final pixel dimensions', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500" width="1000" height="500"></svg>'
    expect(() => assertPngRasterBudget(svg, { scale: 8, fitTo: { mode: 'width', value: 1000 } })).not.toThrow()
    expect(() => assertPngRasterBudget(svg, { scale: 0.1, fitTo: { mode: 'height', value: 5000 } })).toThrow(/MP/)
  })

  test('rejects non-finite projections and pathological single dimensions', () => {
    const square = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"></svg>'
    const strip = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1000" width="1" height="1000"></svg>'
    expect(() => assertPngRasterBudget(square, 1e308)).toThrow(/budget/)
    expect(() => assertPngRasterBudget(strip, {
      scale: 1,
      fitTo: { mode: 'width', value: MAX_PNG_RASTER_DIMENSION + 1 },
    })).toThrow(/maximum dimension/)
  })

  test('budgets intrinsic root pixels and rejects a viewBox aspect-ratio disguise', () => {
    const scaled = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5" width="1000" height="500"></svg>'
    expect(assertPngRasterBudget(scaled, 2)).toEqual({ width: 2000, height: 1000, pixels: 2_000_000 })

    const inconsistent = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="1000" height="500"></svg>'
    expect(() => assertPngRasterBudget(inconsistent, 2)).toThrow(/inconsistent with viewBox/)
  })

  test('uses one shared ceil-and-minimum-one rule for fitted dimensions', () => {
    const wide = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1" width="1000" height="1"></svg>'
    expect(assertPngRasterBudget(wide, {
      scale: 2,
      fitTo: { mode: 'width', value: 1 },
    })).toEqual({ width: 1, height: 1, pixels: 1 })
  })

  test('hosted rasterization applies its lower pre-allocation ceiling', () => {
    expect(assertHostedPngRasterBudget({ width: 2048, height: 2048, pixels: 2048 ** 2 }))
      .toEqual({ width: 2048, height: 2048, pixels: 2048 ** 2 })
    expect(() => assertHostedPngRasterBudget({
      width: 2049,
      height: 2048,
      pixels: 2049 * 2048,
    })).toThrow(/hosted pixel cap/)
    expect(MAX_HOSTED_PNG_PIXELS).toBe(4_194_304)
  })

  test('pins rasterizer root attributes and CSS to the approved allocation', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5" width="10" height="5" style="width:9999px;height:9999px"></svg>'
    const prepared = prepareSvgForPngRasterization(svg, { width: 20, height: 10, pixels: 200 })
    expect(prepared).toContain('width="20"')
    expect(prepared).toContain('height="10"')
    expect(prepared).toContain('preserveAspectRatio="none"')
    expect(prepared).toContain('width:20px!important;height:10px!important')
  })
})
