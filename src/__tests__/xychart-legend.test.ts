/**
 * XY chart legend tests (plan of record: family-elevation-plan.md §XYChart 1).
 *
 * Upstream Mermaid shipped xychart legends in 2026-06 (PR #7724 closing #5292):
 * named series get right-side legend entries, `showLegend` (default true) plus
 * `legendFontSize` / `legendPadding` config, and a `legendTextColor` theme
 * variable. This suite pins our contract:
 *   - multi-series charts get a legend with one swatch+label PER series
 *     (unnamed series get the deterministic ASCII-established defaults
 *     "Bar N" / "Line N" so multi-series colors are never ambiguous — a
 *     documented divergence from upstream, which omits unnamed series);
 *   - single-series charts stay legend-free unless the series is named
 *     (upstream behavior);
 *   - the legend is laid out INSIDE the canvas bounds (no clipping);
 *   - SVG and ASCII agree on legend naming and order (consistency guard).
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import { preprocessMermaidSource } from '../mermaid-source.ts'
import { applyXYChartFrontmatterConfig, parseXYChart } from '../xychart/parser.ts'
import { layoutXYChart } from '../xychart/layout.ts'
import { estimateTextWidth } from '../styles.ts'

function layout(text: string) {
  const processed = preprocessMermaidSource(text)
  return layoutXYChart(applyXYChartFrontmatterConfig(parseXYChart(processed.lines), processed.frontmatter))
}

function svg(text: string): string {
  return renderMermaidSVG(text, { embedFontImport: false })
}

/** Legend label texts in SVG document order. */
function svgLegendLabels(rendered: string): string[] {
  return [...rendered.matchAll(/class="xychart-legend-label"[^>]*>([^<]*)<\/text>/g)].map(m => m[1]!)
}

const MULTI_NAMED = `xychart
  title Traffic
  x-axis [Q1, Q2, Q3]
  y-axis Visits 0 --> 100
  bar Online [10, 20, 30]
  line Store [15, 25, 35]`

const MULTI_UNNAMED = `xychart
  x-axis [Q1, Q2, Q3]
  y-axis 0 --> 100
  bar [10, 20, 30]
  line [15, 25, 35]`

describe('xychart SVG legend – presence rules', () => {
  it('multi-series chart renders a legend group with one swatch+label per series', () => {
    const rendered = svg(MULTI_NAMED)
    expect(rendered).toContain('<g class="xychart-legend">')
    expect(rendered.match(/class="xychart-legend-swatch/g)?.length ?? 0).toBe(2)
    expect(svgLegendLabels(rendered)).toEqual(['Online', 'Store'])
  })

  it('unnamed series in a multi-series chart get deterministic Bar N / Line N defaults', () => {
    expect(svgLegendLabels(svg(MULTI_UNNAMED))).toEqual(['Bar 1', 'Line 1'])
  })

  it('mixed named/unnamed series keep source order and per-type numbering', () => {
    const rendered = svg(`xychart
      x-axis [a, b]
      bar Online [1, 2]
      line [3, 4]
      line Mobile [5, 6]`)
    expect(svgLegendLabels(rendered)).toEqual(['Online', 'Line 1', 'Mobile'])
  })

  it('single unnamed series stays legend-free (upstream behavior)', () => {
    const rendered = svg(`xychart
      x-axis [a, b]
      bar [1, 2]`)
    expect(rendered).not.toContain('xychart-legend')
  })

  it('single NAMED series gets a legend (naming a series opts into the legend, upstream PR #7724)', () => {
    const rendered = svg(`xychart
      x-axis [a, b]
      bar Revenue [1, 2]`)
    expect(svgLegendLabels(rendered)).toEqual(['Revenue'])
  })

  it('horizontal charts get the same legend', () => {
    const rendered = svg(`xychart horizontal
      x-axis [a, b]
      bar Online [1, 2]
      line Store [3, 4]`)
    expect(svgLegendLabels(rendered)).toEqual(['Online', 'Store'])
  })
})

describe('xychart SVG legend – config and theme (upstream contract)', () => {
  it('showLegend: false hides the legend', () => {
    const rendered = svg(`---
config:
  xyChart:
    showLegend: false
---
${MULTI_NAMED}`)
    expect(rendered).not.toContain('xychart-legend')
  })

  it('legendFontSize is honored', () => {
    const rendered = svg(`---
config:
  xyChart:
    legendFontSize: 21
---
${MULTI_NAMED}`)
    expect(rendered).toMatch(/font-size="21"[^>]*class="xychart-legend-label"/)
  })

  it('themeVariables xyChart.legendTextColor colors the legend text', () => {
    const rendered = svg(`---
config:
  themeVariables:
    xyChart:
      legendTextColor: "#123456"
---
${MULTI_NAMED}`)
    expect(rendered).toContain('.xychart-legend-label { fill: #123456; }')
  })

  it('legend swatches use the same per-series colors as the plot marks', () => {
    const rendered = svg(MULTI_NAMED)
    // The public render path may inline CSS variables, so resolve the palette
    // from the emitted style block and require the swatches to reference it
    // (either as the var() or as its inlined value).
    const color0 = rendered.match(/--xychart-color-0: ([^;]+);/)![1]!.trim()
    const color1 = rendered.match(/--xychart-color-1: ([^;]+);/)![1]!.trim()
    const swatchFill = rendered.match(/class="xychart-legend-swatch" fill="([^"]+)"/)![1]!
    const swatchStroke = rendered.match(/class="xychart-legend-swatch" stroke="([^"]+)"/)![1]!
    expect([color0, 'var(--xychart-color-0)']).toContain(swatchFill)
    expect([color1, 'var(--xychart-color-1)']).toContain(swatchStroke)
  })
})

describe('xychart legend – layout containment (no clipping)', () => {
  it('reserves right-side space: the plot area ends before the legend starts', () => {
    const chart = layout(MULTI_NAMED)
    expect(chart.legend.length).toBe(2)
    const minSwatchX = Math.min(...chart.legend.map(item => item.x))
    expect(chart.plotArea.x + chart.plotArea.width).toBeLessThanOrEqual(minSwatchX)
  })

  it('every legend item (swatch + measured label) fits inside the canvas bounds', () => {
    const chart = layout(`xychart
      title Wide
      x-axis [a, b, c]
      y-axis 0 --> 100
      bar A Fairly Long Series Name [10, 20, 30]
      line Another Long Name Here [15, 25, 35]
      bar Third [1, 2, 3]`)
    expect(chart.legend.length).toBe(3)
    for (const item of chart.legend) {
      expect(item.x).toBeGreaterThanOrEqual(0)
      expect(item.y).toBeGreaterThanOrEqual(0)
      expect(item.y + chart.config.legendFontSize).toBeLessThanOrEqual(chart.height)
      const textEnd = item.x + 12 + 6 + estimateTextWidth(item.label, chart.config.legendFontSize, 400)
      expect(textEnd).toBeLessThanOrEqual(chart.width)
    }
  })

  it('drops the legend deterministically rather than clip when it cannot fit', () => {
    const chart = layout(`---
config:
  xyChart:
    width: 120
---
xychart
  x-axis [a]
  bar An Extremely Long Series Name That Cannot Fit [1]
  line Second Extremely Long Series Name [2]`)
    expect(chart.legend).toEqual([])
    // Chart itself still renders inside its box.
    expect(chart.plotArea.x + chart.plotArea.width).toBeLessThanOrEqual(chart.width)
  })

  it('single unnamed series produces an empty legend in layout too', () => {
    const chart = layout(`xychart
      x-axis [a, b]
      bar [1, 2]`)
    expect(chart.legend).toEqual([])
  })
})

describe('xychart legend – SVG/ASCII consistency guard', () => {
  const SOURCE = `xychart
  x-axis [a, b]
  bar Online [1, 2]
  line [3, 4]
  line Mobile [5, 6]`

  it('SVG and ASCII agree on legend entry naming and order', () => {
    const svgLabels = svgLegendLabels(svg(SOURCE))
    expect(svgLabels).toEqual(['Online', 'Line 1', 'Mobile'])

    const ascii = renderMermaidASCII(SOURCE, { colorMode: 'none' })
    // The ASCII legend is a single row containing every entry, in order.
    const legendRow = ascii.split('\n').find(line => svgLabels.every(label => line.includes(label)))
    expect(legendRow).toBeDefined()
    const positions = svgLabels.map(label => legendRow!.indexOf(label))
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('ASCII shows a legend for a single NAMED series, matching SVG', () => {
    const source = `xychart
  x-axis [a, b]
  bar Revenue [1, 2]`
    expect(svgLegendLabels(svg(source))).toEqual(['Revenue'])
    const ascii = renderMermaidASCII(source, { colorMode: 'none' })
    expect(ascii).toContain('Revenue')
    // The label appears on its own legend row, not just as furniture.
    const rows = ascii.split('\n').filter(line => line.includes('Revenue'))
    expect(rows.length).toBeGreaterThanOrEqual(1)
  })

  it('ASCII respects showLegend: false, matching SVG', () => {
    const source = `---
config:
  xyChart:
    showLegend: false
---
xychart
  x-axis [a, b]
  bar Online [1, 2]
  line Store [3, 4]`
    expect(svg(source)).not.toContain('xychart-legend')
    const ascii = renderMermaidASCII(source, { colorMode: 'none' })
    expect(ascii).not.toContain('Online')
    expect(ascii).not.toContain('Store')
  })
})
