// A bar's contract is length proportional to its value measured from zero.
// These properties state that contract against the public SVG and ASCII
// projections: every bar shares one baseline, its length is proportional to
// its distance from that baseline, it grows toward its own sign, an automatic
// range for a bar chart contains zero, and both projections agree on sign.
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
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
  return [...svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" class="xychart-bar[^"]*" data-value="([^"]+)"/g)]
    .map(match => ({
      x: Number(match[1]),
      y: Number(match[2]),
      width: Number(match[3]),
      height: Number(match[4]),
      value: Number(match[5]),
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
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('includes zero in the automatic value range of any chart with a bar series', () => {
    fc.assert(
      fc.property(fc.array(valueArb, { minLength: 1, maxLength: 6 }), fc.boolean(), (values, horizontal) => {
        const range = parsedRange(sourceFor({ horizontal, values }))
        expect(Math.min(range.min, range.max)).toBeLessThanOrEqual(0)
        expect(Math.max(range.min, range.max)).toBeGreaterThanOrEqual(0)
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('draws the same sign in SVG and ASCII: positive bars rise from the zero row, negative bars hang from it', () => {
    const signedArb = fc.array(fc.integer({ min: 20, max: 100 }).chain(magnitude => fc.constantFrom(magnitude, -magnitude)), { minLength: 2, maxLength: 5 })
    fc.assert(
      fc.property(signedArb, values => {
        const source = sourceFor({ horizontal: false, values })
        const svgBars = renderedBars(renderMermaidSVG(source))
        const baselineY = svgBars.map(bar => bar.value > 0 ? bar.y + bar.height : bar.y)[0]!
        for (const bar of svgBars) {
          if (bar.value > 0) expect(bar.y).toBeLessThan(baselineY)
          else expect(bar.y + bar.height).toBeGreaterThan(baselineY)
        }

        const rows = renderMermaidASCII(source, { useAscii: true }).split('\n')
        const zeroRow = rows.findIndex(row => /^\s*0\+/.test(row))
        expect(zeroRow).toBeGreaterThanOrEqual(0)
        const axisRow = rows.findIndex((row, index) => index > zeroRow && /^\s*\+-/.test(row))
        const tickColumns = [...rows[axisRow]!.matchAll(/\+/g)].map(match => match.index!).slice(1)
        expect(tickColumns).toHaveLength(values.length)
        values.forEach((value, index) => {
          const column = tickColumns[index]!
          const filled = rows.slice(0, axisRow).flatMap((row, rowIndex) => row[column] === '#' ? [rowIndex] : [])
          expect(filled.length).toBeGreaterThan(1)
          if (value > 0) {
            expect(Math.max(...filled)).toBe(zeroRow)
            expect(Math.min(...filled)).toBeLessThan(zeroRow)
          } else {
            expect(Math.min(...filled)).toBe(zeroRow)
            expect(Math.max(...filled)).toBeGreaterThan(zeroRow)
          }
        })
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})
