/**
 * Tests for the xychart SVG renderer.
 *
 * Uses the real xychart parse/layout pipeline to produce positioned charts,
 * then asserts renderer-specific SVG structure and escaping behavior.
 */
import { describe, it, expect } from 'bun:test'
import { preprocessMermaidSource } from '../mermaid-source.ts'
import { applyXYChartFrontmatterConfig, parseXYChart } from '../xychart/parser.ts'
import { layoutXYChart } from '../xychart/layout.ts'
import { renderXYChartSvg } from '../xychart/renderer.ts'
import type { DiagramColors } from '../theme.ts'

const lightColors: DiagramColors = { bg: '#FFFFFF', fg: '#27272A' }

function render(text: string, interactive: boolean = false) {
  const processed = preprocessMermaidSource(text)
  const chart = layoutXYChart(applyXYChartFrontmatterConfig(parseXYChart(processed.lines), processed.frontmatter))
  return renderXYChartSvg({ positioned: chart, colors: { ...lightColors, font: 'Inter' }, options: { interactive } })
}

describe('renderXYChartSvg – structure', () => {
  it('emits semantic grid, axis, tick, bar, and line classes', () => {
    const svg = render(`xychart
      x-axis [Q1, Q2, Q3]
      y-axis Revenue 0 --> 100
      bar [10, 20, 30]
      line [15, 25, 35]`)

    expect(svg).toContain('data-xychart-colors="1"')
    expect(svg).toContain('class="xychart-grid"')
    expect(svg).toContain('class="xychart-axis-line xychart-x-axis-line"')
    expect(svg).toContain('class="xychart-axis-line xychart-y-axis-line"')
    expect(svg).toContain('class="xychart-tick xychart-x-tick"')
    expect(svg).toContain('class="xychart-tick xychart-y-tick"')
    expect(svg).toContain('class="xychart-bar xychart-color-0"')
    expect(svg).toContain('class="xychart-line xychart-color-1"')
  })

  it('escapes text nodes and data-label attributes', () => {
    const svg = render(`xychart
      title "Revenue < Growth"
      x-axis "Team <Label>" ["R&D", "<Q2>", "Ops & Support"]
      y-axis "Users > Total" 0 --> 100
      bar [30, 60, 45]`)

    expect(svg).toContain('Revenue &lt; Growth')
    expect(svg).toContain('Team &lt;Label&gt;')
    expect(svg).toContain('Users &gt; Total')
    expect(svg).toContain('data-label="R&amp;D"')
    expect(svg).toContain('data-label="&lt;Q2&gt;"')
    expect(svg).toContain('Ops &amp; Support')
  })
})

describe('renderXYChartSvg – theming and interactivity', () => {
  it('uses theme overrides and renders bar-only data labels', () => {
    const svg = render(`---
config:
  xyChart:
    showDataLabel: true
  themeVariables:
    xyChart:
      xAxisLineColor: "#112233"
      yAxisTickColor: "#445566"
      plotColorPalette: "#ff0000, #00ff00"
---
xychart
  title Revenue
  x-axis [A, B, C]
  y-axis Users 0 --> 100
  bar [10, 20, 30]
  line [15, 25, 35]`)

    expect(svg).toContain('--xychart-color-0: #ff0000;')
    expect(svg).toContain('--xychart-color-1: #00ff00;')
    expect(svg).toContain('.xychart-x-axis-line { stroke: #112233; }')
    expect(svg).toContain('.xychart-y-tick { stroke: #445566; }')
    expect(svg.match(/class="xychart-data-label"/g)?.length ?? 0).toBe(3)
  })

  it('renders the full documented Mermaid xychart style surface', () => {
    const svg = render(`---
config:
  xyChart:
    width: 640
    height: 320
    titleFontSize: 24
    titlePadding: 12
    showTitle: true
    xAxis:
      showLabel: false
      showTitle: false
      showTick: false
      showAxisLine: false
    yAxis:
      labelFontSize: 13
      titleFontSize: 17
      tickWidth: 5
      axisLineWidth: 4
  themeVariables:
    xyChart:
      titleColor: "#102030"
      yAxisLabelColor: "#304050"
      yAxisTickColor: "#506070"
      yAxisLineColor: "#708090"
      yAxisTitleColor: "#90a0b0"
      plotColorPalette: "#ff0000, #00ff00"
---
xychart
  title Revenue
  x-axis Month [Jan, Feb, Mar]
  y-axis Users 0 --> 100
  bar [10, 20, 30]
  line [15, 25, 35]`)

    expect(svg).toContain('viewBox="0 0 640 320"')
    expect(svg).toContain('width="100%"')
    expect(svg).toContain('height="100%"')
    expect(svg).toContain('max-width:640px')
    expect(svg).toContain('--xychart-color-0: #ff0000;')
    expect(svg).toContain('--xychart-color-1: #00ff00;')
    expect(svg).toContain('.xychart-title { fill: #102030; }')
    expect(svg).toContain('.xychart-y-label { fill: #304050; }')
    expect(svg).toContain('.xychart-y-tick { stroke: #506070; }')
    expect(svg).toContain('.xychart-y-axis-line { stroke: #708090; }')
    expect(svg).toContain('.xychart-y-axis-title { fill: #90a0b0; }')
    expect(svg).not.toContain('class="xychart-label xychart-x-label"')
    expect(svg).not.toContain('class="xychart-axis-title xychart-x-axis-title"')
    expect(svg).not.toContain('class="xychart-tick xychart-x-tick"')
    expect(svg).not.toContain('class="xychart-axis-line xychart-x-axis-line"')
    expect(svg).toContain('class="xychart-tick xychart-y-tick" stroke-width="5"')
    expect(svg).toContain('class="xychart-axis-line xychart-y-axis-line" stroke-width="4"')
    expect(svg).toContain('dominant-baseline="middle"')
    expect(svg).toContain('font-size="13" font-weight="400"')
    expect(svg).toMatch(/font-size="17" font-weight="400" dy="0.35em" class="xychart-axis-title xychart-y-axis-title"[^>]*>Users<\/text>/)
  })

  it('renders tooltip groups and line dots only when interactive', () => {
    const source = `xychart
      x-axis [Q1, Q2, Q3]
      y-axis Revenue 0 --> 100
      bar [10, 20, 30]
      line [15, 25, 35]`

    const staticSvg = render(source, false)
    expect(staticSvg).not.toContain('xychart-bar-group')
    expect(staticSvg).not.toContain('xychart-dot-group')

    const interactiveSvg = render(source, true)
    expect(interactiveSvg).toContain('xychart-bar-group')
    expect(interactiveSvg).toContain('xychart-dot-group')
    expect(interactiveSvg).toContain('xychart-tip xychart-tip-bg')
  })

  it('emits fixed SVG sizing when Mermaid useMaxWidth is disabled', () => {
    const svg = render(`---
config:
  useMaxWidth: false
  useWidth: 900
---
xychart
  bar [10, 20]`)

    expect(svg).toContain('width="900"')
    expect(svg).toContain('height="643"')
    expect(svg).not.toContain('max-width:')
  })

  it('appends Mermaid themeCSS from frontmatter to the SVG styles', () => {
    const svg = render(`---
config:
  themeCSS: |
    .xychart-title { letter-spacing: 0.08em; }
---
xychart
  title Revenue
  bar [10, 20]`)

    expect(svg).toContain('.xychart-title { letter-spacing: 0.08em; }')
  })
})
