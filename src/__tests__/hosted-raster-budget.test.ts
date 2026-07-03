// Pixel budget for hosted render_png (website/src/raster-budget.ts): output
// pixels = SVG bounds × scale², so a large scale or a huge diagram must be
// rejected before rasterization allocates the buffer.

import { describe, expect, test } from 'bun:test'
import { assertRasterBudget, MAX_PNG_PIXELS } from '../../website/src/raster-budget.ts'
import { renderMermaidSVG } from '../index.ts'

describe('hosted raster budget', () => {
  test('a real small diagram passes at the maximum clamped scale', () => {
    const svg = renderMermaidSVG('flowchart LR\n  A --> B')
    expect(() => assertRasterBudget(svg, 8)).not.toThrow()
  })

  test('bounds × scale² over the budget is rejected with the cap named', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10000 10000"></svg>'
    expect(() => assertRasterBudget(svg, 8)).toThrow(/MP/)
    expect(() => assertRasterBudget(svg, 0.1)).not.toThrow()
  })

  test('the budget matches its documented ~4096² ceiling', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4000 4000"></svg>'
    expect(() => assertRasterBudget(svg, 1)).not.toThrow()
    expect(() => assertRasterBudget(svg, 2)).toThrow(/MP/)
    expect(MAX_PNG_PIXELS).toBe(16_777_216)
  })

  test('an SVG without parseable bounds is rejected rather than trusted', () => {
    expect(() => assertRasterBudget('<svg>no viewbox</svg>', 2)).toThrow(/bounds/)
  })
})
