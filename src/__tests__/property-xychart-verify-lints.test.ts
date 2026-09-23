// verify must say what the chart hides or distorts, and nothing else. These
// properties tie each xychart lint to the rendered SVG rather than to the code
// that emits it:
//   - LABELS_HIDDEN (x-axis) names exactly the authored categories the SVG does
//     not draw;
//   - LABELS_HIDDEN (data-labels) names exactly the bars whose value the SVG
//     does not draw;
//   - BAR_RANGE_EXCLUDES_ZERO fires exactly when a bar chart's authored range
//     excludes zero, and reports the baseline the bars are drawn from
//     (property-xychart-bar-encoding.test.ts pins the drawn baseline).
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { verifyMermaid } from '../agent/index.ts'
import type { LayoutWarning } from '../agent/types.ts'
import { renderMermaidSVG } from '../index.ts'

type HiddenLabels = Extract<LayoutWarning, { code: 'LABELS_HIDDEN' }>

function hidden(source: string, target: HiddenLabels['target']): string[] {
  return verifyMermaid(source).warnings
    .flatMap(warning => warning.code === 'LABELS_HIDDEN' && warning.target === target ? warning.labels : [])
}

function drawnTexts(svg: string, className: string): string[] {
  return [...svg.matchAll(new RegExp(`<text\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>([^<]*)</text>`, 'g'))]
    .map(match => match[1]!)
    .filter(text => text !== '')
}

const categoryArb = fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]{0,15}$/), { minLength: 1, maxLength: 30 })

describe('xychart verify lints match the rendered chart', () => {
  it('reports exactly the authored categories the x-axis does not draw', () => {
    fc.assert(
      fc.property(categoryArb, fc.boolean(), fc.integer({ min: 200, max: 900 }), (categories, horizontal, width) => {
        const source = [
          '---',
          'config:',
          '  xyChart:',
          `    width: ${width}`,
          '---',
          horizontal ? 'xychart-beta horizontal' : 'xychart-beta',
          `  x-axis [${categories.join(', ')}]`,
          `  bar [${categories.map((_unused, index) => index + 1).join(', ')}]`,
        ].join('\n')
        const drawn = new Set(drawnTexts(renderMermaidSVG(source), 'xychart-x-label'))
        expect(hidden(source, 'x-axis')).toEqual(categories.filter(category => !drawn.has(category)))
      }),
      { numRuns: 120 },
    )
  })

  it('reports exactly the bars whose value label is not drawn', () => {
    const arb = fc.integer({ min: 1, max: 10 }).chain(length => fc.record({
      horizontal: fc.boolean(),
      values: fc.uniqueArray(fc.integer({ min: -300, max: 300 }), { minLength: length, maxLength: length }),
      // A range pinned to the data leaves no room beyond the extreme bars.
      tight: fc.boolean(),
      height: fc.integer({ min: 120, max: 500 }),
    }))
    fc.assert(
      fc.property(arb, ({ horizontal, values, tight, height }) => {
        const lo = Math.min(0, ...values)
        const hi = Math.max(1, ...values)
        const source = [
          '---',
          'config:',
          '  xyChart:',
          '    showDataLabel: true',
          `    height: ${height}`,
          '---',
          horizontal ? 'xychart-beta horizontal' : 'xychart-beta',
          `  x-axis [${values.map((_unused, index) => `c${index}`).join(', ')}]`,
          ...(tight ? [`  y-axis ${lo} --> ${hi}`] : []),
          `  bar [${values.join(', ')}]`,
        ].join('\n')
        const drawn = new Set(drawnTexts(renderMermaidSVG(source), 'xychart-data-label'))
        const expected = values.flatMap((value, index) => drawn.has(String(value)) ? [] : [`c${index} = ${value}`])
        expect(hidden(source, 'data-labels')).toEqual(expected)
      }),
      { numRuns: 120 },
    )
  })

  it('flags a bar chart exactly when its authored range excludes zero, naming the drawn baseline', () => {
    const arb = fc.record({
      range: fc.tuple(fc.integer({ min: -500, max: 500 }), fc.integer({ min: -500, max: 500 })).filter(([a, b]) => a !== b),
      kinds: fc.array(fc.constantFrom('bar', 'line'), { minLength: 1, maxLength: 3 }),
      horizontal: fc.boolean(),
    })
    fc.assert(
      fc.property(arb, ({ range: [min, max], kinds, horizontal }) => {
        const source = [
          horizontal ? 'xychart-beta horizontal' : 'xychart-beta',
          '  x-axis [a, b]',
          `  y-axis ${min} --> ${max}`,
          ...kinds.map(kind => `  ${kind} [${min}, ${max}]`),
        ].join('\n')
        const warnings = verifyMermaid(source).warnings.filter(warning => warning.code === 'BAR_RANGE_EXCLUDES_ZERO')
        const excludesZero = Math.min(min, max) > 0 || Math.max(min, max) < 0
        const nearestToZero = Math.min(Math.max(min, max), Math.max(Math.min(min, max), 0))
        expect(warnings.map(warning => warning.baseline)).toEqual(kinds.includes('bar') && excludesZero ? [nearestToZero] : [])
      }),
      { numRuns: 200 },
    )
  })
})
