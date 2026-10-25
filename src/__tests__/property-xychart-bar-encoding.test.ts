// A bar's contract is length proportional to its value measured from zero.
// These properties state that contract against the public SVG and ASCII
// projections: every bar shares one baseline, its length is proportional to
// its distance from that baseline, it grows toward its own sign, an automatic
// range for a bar chart contains zero, and both projections agree on sign.
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'

import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { parseXYChart } from '../xychart/parser.ts'

const PROPERTY_RUNS = 80
const EPSILON = 0.05

interface RenderedBar {
  value: number
  x: number
  y: number
  width: number
  height: number
}

const valueArb = fc.integer({ min: -500, max: 500 }).filter(value => value !== 0)

const chartArb = fc.record({
  horizontal: fc.boolean(),
  values: fc.array(valueArb, { minLength: 2, maxLength: 6 }),
  authored: fc.option(
    fc.record({ below: fc.integer({ min: 0, max: 400 }), above: fc.integer({ min: 0, max: 400 }), cutsZero: fc.boolean() }),
    { nil: undefined },
  ),
})

function authoredRange(values: number[], authored: { below: number; above: number; cutsZero: boolean }): { min: number; max: number } {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  // cutsZero keeps the authored range on the data's side of zero when every
  // value shares one sign, which is exactly the truncated-axis case.
  if (authored.cutsZero && lo > 0) return { min: Math.max(0, lo - authored.below), max: hi + authored.above }
  if (authored.cutsZero && hi < 0) return { min: lo - authored.below, max: Math.min(0, hi + authored.above) }
  return { min: lo - authored.below, max: hi + authored.above }
}

function sourceFor(chart: { horizontal: boolean; values: number[]; range?: { min: number; max: number } }): string {
  const labels = chart.values.map((_value, index) => `c${index}`)
  return [
    chart.horizontal ? 'xychart-beta horizontal' : 'xychart-beta',
    `    x-axis [${labels.join(', ')}]`,
    ...(chart.range ? [`    y-axis ${chart.range.min} --> ${chart.range.max}`] : []),
    `    bar [${chart.values.join(', ')}]`,
  ].join('\n')
}

function renderedBars(svg: string): RenderedBar[] {
  const attribute = (tag: string, name: string): number => Number(tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1])
  return [...svg.matchAll(/<rect\b[^>]*\sclass="xychart-bar[^"]*"[^>]*>/g)]
    .map(([tag]) => ({
      x: attribute(tag, 'x'),
      y: attribute(tag, 'y'),
      width: attribute(tag, 'width'),
      height: attribute(tag, 'height'),
      value: attribute(tag, 'data-value'),
    }))
}

/** Zero, clamped into the axis range: the only honest reference once an
 * authored range excludes zero. Written independently of the renderer. */
function expectedBaseline(range: { min: number; max: number }): number {
  const lo = Math.min(range.min, range.max)
  const hi = Math.max(range.min, range.max)
  return Math.min(hi, Math.max(lo, 0))
}

function parsedRange(source: string): { min: number; max: number } {
  return parseXYChart(toMermaidLines(source)).yAxis.range!
}

describe('xychart bars encode value as length from a shared baseline', () => {
  it('starts every SVG bar at one baseline, grows it toward its sign, and keeps lengths proportional', () => {
    fc.assert(
      fc.property(chartArb, ({ horizontal, values, authored }) => {
        const range = authored ? authoredRange(values, authored) : undefined
        const source = sourceFor({ horizontal, values, range })
        const baseline = expectedBaseline(parsedRange(source))
        const bars = renderedBars(renderMermaidSVG(source))
        expect(bars).toHaveLength(values.length)
        expect(bars.map(bar => bar.value)).toEqual(values)

        // Near end = the edge at the baseline; far end = the edge at the value.
        // Vertical: larger values sit higher (smaller y). Horizontal: to the right.
        const nearEnds = bars.map(bar => horizontal
          ? (bar.value >= baseline ? bar.x : bar.x + bar.width)
          : (bar.value >= baseline ? bar.y + bar.height : bar.y))
        for (const near of nearEnds) expect(Math.abs(near - nearEnds[0]!)).toBeLessThan(EPSILON)

        // Derive the scale from the longest bar: SVG coordinates are rounded to
        // 0.01 px, and a short reference bar would magnify that rounding.
        const lengths = bars.map(bar => horizontal ? bar.width : bar.height)
        const distances = bars.map(bar => Math.abs(bar.value - baseline))
        const reference = distances.indexOf(Math.max(...distances))
        if (distances[reference] === 0) return
        const pixelsPerUnit = lengths[reference]! / distances[reference]!
        bars.forEach((_bar, index) => {
          expect(Math.abs(lengths[index]! - pixelsPerUnit * distances[index]!)).toBeLessThan(EPSILON)
        })
      }),
      fcParameters({ numRuns: PROPERTY_RUNS }),
    )
  })

  it('includes zero in the automatic value range of any chart with a bar series', () => {
    fc.assert(
      fc.property(fc.array(valueArb, { minLength: 1, maxLength: 6 }), fc.boolean(), (values, horizontal) => {
        const range = parsedRange(sourceFor({ horizontal, values }))
        expect(Math.min(range.min, range.max)).toBeLessThanOrEqual(0)
        expect(Math.max(range.min, range.max)).toBeGreaterThanOrEqual(0)
      }),
      fcParameters({ numRuns: PROPERTY_RUNS }),
    )
  })

  it('draws the same sign in SVG and ASCII: positive bars rise from the zero row, negative bars hang from it', () => {
    const signedArb = fc.array(fc.integer({ min: 20, max: 100 }).chain(magnitude => fc.constantFrom(magnitude, -magnitude)), { minLength: 2, maxLength: 5 })
    fc.assert(
      fc.property(signedArb, values => {
        const source = sourceFor({ horizontal: false, values })
        const svgBars = renderedBars(renderMermaidSVG(source))
        expect(svgBars.map(bar => bar.value)).toEqual(values)
        const baselineY = svgBars.map(bar => bar.value > 0 ? bar.y + bar.height : bar.y)[0]!
        for (const bar of svgBars) {
          if (bar.value > 0) expect(bar.y).toBeLessThan(baselineY)
          else expect(bar.y + bar.height).toBeGreaterThan(baselineY)
        }

        const { ascii, regions } = renderMermaidASCIIWithMeta(source, { useAscii: true, colorMode: 'none' })
        const rows = ascii.split('\n')
        const zero = regions.find(region => region.kind === 'label' && region.id === 'y-tick-0')!
        const plot = regions.find(region => region.kind === 'plot' && region.id === 'plot')!
        expect(zero).toBeDefined()
        expect(plot).toBeDefined()
        const zeroRow = zero.canvasRow
        const plotExtent = plot.rowSpan! - 1
        const range = parsedRange(source)
        const cellsPerUnit = plotExtent / (range.max - range.min)
        expect(Math.abs(zeroRow - (plot.canvasRow + range.max * cellsPerUnit))).toBeLessThanOrEqual(0.5)
        values.forEach((value, index) => {
          const category = regions.find(region => region.kind === 'node' && region.id === `x-category-${index}`)!
          const column = Math.floor((category.canvasColStart + category.canvasColEnd) / 2)
          const filled = rows.flatMap((row, rowIndex) => row[column] === '#' ? [rowIndex] : [])
          expect(filled.length).toBeGreaterThan(0)
          // ASCII rounds each boundary to a whole cell. Their two independent
          // rounding errors can change interval length by at most one cell.
          expect(Math.abs(filled.length - Math.abs(value) * cellsPerUnit)).toBeLessThanOrEqual(1)
          if (value > 0) {
            expect(Math.max(...filled)).toBe(zeroRow - 1)
            expect(Math.min(...filled)).toBeLessThan(zeroRow)
          } else {
            expect(Math.min(...filled)).toBe(zeroRow)
            // A short negative interval can quantize to the zero-row cell
            // alone; it must never paint above that boundary.
            expect(Math.max(...filled)).toBeGreaterThanOrEqual(zeroRow)
          }
        })
      }),
      fcParameters({ numRuns: PROPERTY_RUNS, examples: [[[20, 20]], [[-20, -20]], [[20, -20]], [[-91, -20, 81]]] }),
    )
  })
})
