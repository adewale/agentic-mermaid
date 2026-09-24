// Bar value labels are data. These properties state their contract against the
// rendered SVG: every label is readable against the surface it is actually
// drawn on (its bar, the page, or the page-colored halo the sketch looks draw
// behind text), one bar can never take another bar's label away, and a sparse
// chart labels every bar.
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { knownStyles, renderMermaidSVG } from '../index.ts'
import { wcagContrastRatio } from '../shared/color-math.ts'

// Every palette and every look: the looks repaint bars as hatching or washes
// and halo text with the page color, which changes the surface under a label.
const STYLES: Array<string | undefined> = [undefined, ...knownStyles()]

interface Bar { value: number; x: number; y: number; width: number; height: number; colorIndex: number }
interface Label { text: string; x: number; y: number; fill: string; halo?: string }

function sourceFor(input: { horizontal: boolean; outside: boolean; series: number[][]; range?: { min: number; max: number } }): string {
  const count = Math.max(...input.series.map(values => values.length))
  return [
    '---',
    'config:',
    '  xyChart:',
    '    showDataLabel: true',
    ...(input.outside ? ['    showDataLabelOutsideBar: true'] : []),
    '---',
    input.horizontal ? 'xychart-beta horizontal' : 'xychart-beta',
    `  x-axis [${Array.from({ length: count }, (_unused, index) => `c${index}`).join(', ')}]`,
    ...(input.range ? [`  y-axis ${input.range.min} --> ${input.range.max}`] : []),
    ...input.series.map((values, index) => `  bar "s${index}" [${values.join(', ')}]`),
  ].join('\n')
}

function parse(svg: string): { bars: Bar[]; labels: Label[]; background: string; seriesColors: Map<number, string> } {
  const seriesColors = new Map([...svg.matchAll(/--xychart-color-(\d+):\s*(#[0-9a-fA-F]{6})/g)].map(match => [Number(match[1]), match[2]!]))
  const bars = [...svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" class="xychart-bar xychart-color-(\d+)" data-value="([^"]+)"/g)]
    .map(match => ({ x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]), colorIndex: Number(match[5]), value: Number(match[6]) }))
  const labels = [...svg.matchAll(/<text\b([^>]*)class="xychart-data-label"[^>]*>([^<]*)<\/text>/g)].flatMap(match => {
    const attributes = match[1]!
    const x = attributes.match(/\sx="([^"]+)"/)?.[1]
    const y = attributes.match(/\sy="([^"]+)"/)?.[1]
    const fill = attributes.match(/\sfill="([^"]+)"/)?.[1]
    if (x === undefined || y === undefined || fill === undefined) return []
    // A halo is a stroke painted under the glyphs (paint-order="stroke").
    const halo = /\spaint-order="stroke"/.test(attributes) ? attributes.match(/\sstroke="([^"]+)"/)?.[1] : undefined
    return [{ x: Number(x), y: Number(y), fill, text: match[2]!, ...(halo ? { halo } : {}) }]
  })
  // Guard against a vacuous parse: every emitted label element must be read.
  expect(labels).toHaveLength((svg.match(/<text\b[^>]*class="xychart-data-label"/g) ?? []).length)
  const background = svg.match(/<svg\b[^>]*style="[^"]*background:(#[0-9a-fA-F]{6})/)?.[1]
    ?? svg.match(/<svg\b[^>]*style="[^"]*--bg:(#[0-9a-fA-F]{6})/)![1]!
  return { bars, labels, background, seriesColors }
}

/** The surface under a label's glyphs: its halo when it has one, else the bar
 * that contains its anchor, else the page. */
function backdrop(label: Label, parsed: ReturnType<typeof parse>): string {
  if (label.halo) return label.halo === 'var(--bg)' ? parsed.background : label.halo
  const bar = parsed.bars.find(candidate => label.x >= candidate.x - 0.5 && label.x <= candidate.x + candidate.width + 0.5
    && label.y >= candidate.y - 0.5 && label.y <= candidate.y + candidate.height + 0.5)
  return bar ? parsed.seriesColors.get(bar.colorIndex)! : parsed.background
}

const valuesArb = (length: number) => fc.array(fc.integer({ min: -200, max: 200 }), { minLength: length, maxLength: length })

const chartArb = fc.integer({ min: 1, max: 12 }).chain(length => fc.record({
  horizontal: fc.boolean(),
  outside: fc.boolean(),
  series: fc.array(valuesArb(length), { minLength: 1, maxLength: 3 }),
  style: fc.integer({ min: 0, max: STYLES.length - 1 }),
}))

describe('xychart bar value labels', () => {
  it('draws every label at WCAG AA contrast against the surface it sits on', () => {
    fc.assert(
      fc.property(chartArb, ({ style, ...chart }) => {
        const name = STYLES[style]
        const parsed = parse(renderMermaidSVG(sourceFor(chart), name ? { style: name } : {}))
        for (const label of parsed.labels) {
          const ratio = wcagContrastRatio(label.fill, backdrop(label, parsed))!
          expect({ style: name, label: label.text, fill: label.fill, ratio: ratio >= 4.5 }).toEqual({ style: name, label: label.text, fill: label.fill, ratio: true })
        }
      }),
      { numRuns: 200 },
    )
  })

  it('never removes one bar\'s label because another bar shrinks', () => {
    const arb = fc.integer({ min: 2, max: 8 }).chain(length => fc.record({
      horizontal: fc.boolean(),
      values: fc.array(fc.integer({ min: 10, max: 100 }), { minLength: length, maxLength: length }),
      shrink: fc.integer({ min: 0, max: length - 1 }),
    }))
    fc.assert(
      fc.property(arb, ({ horizontal, values, shrink }) => {
        const range = { min: 0, max: 100 }
        const before = parse(renderMermaidSVG(sourceFor({ horizontal, outside: false, series: [values], range })))
        const shrunk = values.map((value, index) => index === shrink ? 1 : value)
        const after = parse(renderMermaidSVG(sourceFor({ horizontal, outside: false, series: [shrunk], range })))
        const labelled = (parsed: ReturnType<typeof parse>): Set<string> => new Set(parsed.labels.map(label => label.text))
        const kept = labelled(after)
        values.forEach((value, index) => {
          if (index !== shrink && labelled(before).has(String(value))) expect(kept.has(String(value))).toBe(true)
        })
      }),
      { numRuns: 100 },
    )
  })

  it('labels every bar of a sparse chart with room at its ends, however short its bars', () => {
    const arb = fc.integer({ min: 1, max: 8 }).chain(length => fc.record({
      horizontal: fc.boolean(),
      outside: fc.boolean(),
      values: fc.array(fc.integer({ min: -200, max: 200 }), { minLength: length, maxLength: length }),
      // An authored range that holds every bar with a tenth of its span to
      // spare at each end, so a near-zero bar stays a sliver and the label of
      // a bar that reaches an extreme still has room beyond it.
      marginPercent: fc.option(fc.integer({ min: 10, max: 200 }), { nil: undefined }),
    }))
    fc.assert(
      fc.property(arb, ({ horizontal, outside, values, marginPercent }) => {
        const lo = Math.min(0, ...values)
        const hi = Math.max(1, ...values)
        const margin = marginPercent === undefined ? 0 : Math.ceil((hi - lo) * marginPercent / 100)
        const range = marginPercent === undefined ? undefined : { min: lo - margin, max: hi + margin }
        const parsed = parse(renderMermaidSVG(sourceFor({ horizontal, outside, series: [values], range })))
        expect(parsed.labels.map(label => label.text).sort()).toEqual(values.map(String).sort())
      }),
      { numRuns: 100 },
    )
  })
})
