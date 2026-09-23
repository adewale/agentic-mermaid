// Every piece of chart text must land on the canvas. The check measures the
// real rasterizer's glyph boxes (resvg, with the bundled fonts) rather than the
// layout's own width estimates, so it cannot agree with a wrong estimate.
// Before value-axis overhang was reserved, an untitled vertical chart drew its
// top tick label above y = 0 and a horizontal chart drew its rightmost value
// label past the right edge; before bars clamped their value end, a value
// beyond an authored range drew its bar off the canvas.
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { Resvg } from '@resvg/resvg-js'
import { join } from 'node:path'

import { renderMermaidSVG } from '../index.ts'

const FONT_DIR = join(import.meta.dir, '..', '..', 'assets', 'fonts')
// Rasterizer antialiasing and the 0.01 px coordinate grid.
const TOLERANCE = 0.75

/** The SVG with every non-text mark removed, so the bounding box is text only. */
function textOnly(svg: string): string {
  return svg.replace(/<(rect|line|path|circle|polyline|polygon|ellipse)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g, '')
}

const nameArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,17}[A-Za-z0-9]$/)

const chartArb = fc.integer({ min: 1, max: 12 }).chain(count => fc.record({
  horizontal: fc.boolean(),
  title: fc.option(nameArb, { nil: undefined }),
  categories: fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]{0,11}$/), { minLength: count, maxLength: count }),
  series: fc.array(fc.record({
    kind: fc.constantFrom('bar', 'line'),
    values: fc.array(fc.integer({ min: -100, max: 100 }), { minLength: count, maxLength: count }),
  }), { minLength: 1, maxLength: 3 }),
  // Authored round ranges put ticks exactly on the plot edges, where centered
  // end labels overhang; the scale varies the label width.
  range: fc.option(fc.constantFrom([0, 100], [-100, 100], [0, 200], [-100, 0]), { nil: undefined }),
  scale: fc.constantFrom(1, 1000, 100000),
  showDataLabel: fc.boolean(),
  width: fc.integer({ min: 300, max: 900 }),
  height: fc.integer({ min: 200, max: 700 }),
}))

describe('xychart text stays on the canvas', () => {
  it('keeps every rendered glyph and bar inside the viewBox', () => {
    fc.assert(
      fc.property(chartArb, chart => {
        const source = [
          '---',
          'config:',
          '  xyChart:',
          `    width: ${chart.width}`,
          `    height: ${chart.height}`,
          `    showDataLabel: ${chart.showDataLabel}`,
          '---',
          chart.horizontal ? 'xychart-beta horizontal' : 'xychart-beta',
          ...(chart.title ? [`  title "${chart.title}"`] : []),
          `  x-axis [${chart.categories.join(', ')}]`,
          ...(chart.range ? [`  y-axis ${chart.range[0]! * chart.scale} --> ${chart.range[1]! * chart.scale}`] : []),
          ...chart.series.map((series, index) => `  ${series.kind} "S${index}" [${series.values.map(value => value * chart.scale).join(', ')}]`),
        ].join('\n')
        const svg = renderMermaidSVG(source)
        const [, , width, height] = svg.match(/viewBox="([^"]+)"/)![1]!.split(' ').map(Number)
        // Bars clamp both ends into the axis range, so a value beyond an
        // authored range cannot push its bar (or its label) off the canvas.
        for (const match of svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" class="xychart-bar/g)) {
          const [x, y, w, h] = match.slice(1, 5).map(Number) as [number, number, number, number]
          expect({ bar: [x, y, w, h], inside: x >= 0 && y >= 0 && x + w <= width! + 0.01 && y + h <= height! + 0.01 }).toEqual({ bar: [x, y, w, h], inside: true })
        }
        const box = new Resvg(textOnly(svg), { font: { loadSystemFonts: false, fontDirs: [FONT_DIR], defaultFontFamily: 'Inter' } }).getBBox()
        if (!box) return
        expect({ left: box.x >= -TOLERANCE, top: box.y >= -TOLERANCE, right: box.x + box.width <= width! + TOLERANCE, bottom: box.y + box.height <= height! + TOLERANCE })
          .toEqual({ left: true, top: true, right: true, bottom: true })
      }),
      { numRuns: 150 },
    )
  })
})
