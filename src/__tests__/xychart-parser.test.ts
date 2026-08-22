/**
 * Tests for the xychart parser.
 *
 * Covers stable syntax, quoted labels, frontmatter config/theme values,
 * comment stripping, and malformed Mermaid lines that should not crash parsing.
 */
import { describe, it, expect } from 'bun:test'
import { preprocessMermaidSource } from '../mermaid-source.ts'
import { applyXYChartFrontmatterConfig, parseXYChart } from '../xychart/parser.ts'

function parse(text: string) {
  const processed = preprocessMermaidSource(text)
  return applyXYChartFrontmatterConfig(parseXYChart(processed.lines), processed.frontmatter)
}

describe('parseXYChart – syntax', () => {
  it('parses the stable header, strips comments, and normalizes quoted categories', () => {
    const chart = parse(`%% ignore me
      xychart
      %% still ignored
      title Revenue
      x-axis ["Q1 Growth", Q2, 'Q3 Upsell']
      bar [10, 20, 30]`)

    expect(chart.title).toBe('Revenue')
    expect(chart.horizontal).toBe(false)
    expect(chart.xAxis.categories).toEqual(['Q1 Growth', 'Q2', 'Q3 Upsell'])
    expect(chart.series).toHaveLength(1)
    expect(chart.series[0]!.type).toBe('bar')
    expect(chart.series[0]!.data).toEqual([10, 20, 30])
  })

  it('supports semicolon-separated Mermaid statements on one line', () => {
    const chart = parse('xychart; title Revenue; x-axis [Q1, Q2]; bar [10, 20]')

    expect(chart.title).toBe('Revenue')
    expect(chart.xAxis.categories).toEqual(['Q1', 'Q2'])
    expect(chart.series).toHaveLength(1)
    expect(chart.series[0]!.data).toEqual([10, 20])
  })

  it('treats axis titles, ranges, and categories as independent component updates', () => {
    const after = parse(`xychart-beta
      x-axis [Jan, Feb]
      x-axis Months
      y-axis 0 --> 100
      y-axis Revenue
      bar [10, 20]`)
    expect(after.xAxis).toMatchObject({ title: 'Months', categories: ['Jan', 'Feb'] })
    expect(after.yAxis).toMatchObject({ title: 'Revenue', range: { min: 0, max: 100 } })

    const before = parse(`xychart-beta
      x-axis Months
      x-axis [Jan, Feb]
      y-axis Revenue
      y-axis 0 --> 100
      bar [10, 20]`)
    expect(before.xAxis).toMatchObject({ title: 'Months', categories: ['Jan', 'Feb'] })
    expect(before.yAxis).toMatchObject({ title: 'Revenue', range: { min: 0, max: 100 } })
  })

  it('recognizes body directive keywords case-insensitively like Mermaid 11.16', () => {
    const chart = parse(`xychart-beta
      TITLE Revenue
      X-AXIS [Q1, Q2]
      Y-AXIS 0 --> 100
      BAR [10, 20]`)
    expect(chart.title).toBe('Revenue')
    expect(chart.xAxis.categories).toEqual(['Q1', 'Q2'])
    expect(chart.yAxis.range).toEqual({ min: 0, max: 100 })
    expect(chart.series[0]?.data).toEqual([10, 20])
  })

  it('rejects empty and sparse data lists instead of silently deleting tokens', () => {
    for (const points of ['', ',', '1,,2', '1,']) {
      expect(() => parse(`xychart-beta\n  bar [${points}]`), points).toThrow()
    }
  })

  it('keeps accessibility directives in semicolon-separated statements', () => {
    const inline = parse('xychart; accTitle: Revenue chart; accDescr: Quarterly sales; bar [10, 20]')
    expect(inline.accessibility).toEqual({
      title: 'Revenue chart',
      description: 'Quarterly sales',
    })

    const block = parse(`xychart; accDescr { First; still description
      } ; bar [10, 20]`)
    expect(block.accessibility).toEqual({ description: 'First; still description' })
    expect(block.series[0]!.data).toEqual([10, 20])
  })

  it('parses numeric axes and quoted axis titles', () => {
    const chart = parse(`xychart-beta
      x-axis "Month Index" 0 --> 12
      y-axis "Users" -10 --> 90
      line [0, 20, 40, 60]`)

    expect(chart.xAxis.title).toBe('Month Index')
    expect(chart.xAxis.range).toEqual({ min: 0, max: 12 })
    expect(chart.yAxis.title).toBe('Users')
    expect(chart.yAxis.range).toEqual({ min: -10, max: 90 })
    expect(chart.series[0]!.type).toBe('line')
  })

  it('parses Mermaid accessibility directives, including block descriptions', () => {
    const chart = parse(`xychart
      accTitle: Revenue chart
      accDescr {
        Quarterly sales
        across two regions.
      }
      bar [10, 20]`)

    expect(chart.accessibility).toEqual({
      title: 'Revenue chart',
      description: 'Quarterly sales\nacross two regions.',
    })
  })

  it('keeps the historical tolerant policy for an unclosed accDescr block', () => {
    const chart = parse(`xychart
      accDescr {
        Never closed
      bar [10, 20]`)

    expect(chart.accessibility).toEqual({ description: 'Never closed\nbar [10, 20]' })
    expect(chart.series).toEqual([])
  })

  it('retains filtered family statements before a later unclosed accDescr block', () => {
    const chart = parse(`xychart
      accDescr { Earlier description
      }
      bar [10]
      accDescr { Final description
      bar [20]`)

    expect(chart.accessibility).toEqual({ description: 'Final description\nbar [20]' })
    expect(chart.series.map(item => item.data)).toEqual([[10]])
  })

  it('applies Mermaid frontmatter config and theme overrides', () => {
    const chart = parse(`---
config:
  xyChart:
    width: 720
    height: 320
    showDataLabel: true
    xAxis:
      showLabel: false
  themeVariables:
    xyChart:
      titleColor: "#123456"
      plotColorPalette: "#ff6b6b, #0ea5e9"
---
xychart
  title Revenue
  x-axis [Q1, Q2]
  bar [30, 60]`)

    expect(chart.config.width).toBe(720)
    expect(chart.config.height).toBe(320)
    expect(chart.config.showDataLabel).toBe(true)
    expect(chart.config.xAxis?.showLabel).toBe(false)
    expect(chart.theme.titleColor).toBe('#123456')
    expect(chart.theme.plotColorPalette).toEqual(['#ff6b6b', '#0ea5e9'])
  })

  it('parses Mermaid init directives into the same config surface', () => {
    const chart = parse(`%%{init: {
      "theme": "dark",
      "fontFamily": "Fira Code",
      "xyChart": {
        "showDataLabel": true,
        "xAxis": { "showLabel": false }
      },
      "themeVariables": {
        "xyChart": {
          "plotColorPalette": ["#ff6b6b", "#0ea5e9"]
        }
      }
    }}%%
xychart
  title Revenue
  x-axis [Q1, Q2]
  bar [30, 60]`)

    expect(chart.config.showDataLabel).toBe(true)
    expect(chart.config.xAxis?.showLabel).toBe(false)
    expect(chart.theme.plotColorPalette).toEqual(['#ff6b6b', '#0ea5e9'])
  })

  it('accepts Mermaid init directives written as loose object literals', () => {
    const chart = parse(`%%{init: {
      'useMaxWidth': false,
      'xyChart': {
        'showDataLabel': true
      }
    }}%%
xychart
  x-axis [Q1, Q2]
  bar [30, 60]`)

    expect(chart.config.useMaxWidth).toBe(false)
    expect(chart.config.showDataLabel).toBe(true)
  })

  it('merges grouped Mermaid directives with later values winning', () => {
    const chart = parse(`%%{init: {
      "xyChart": {
        "showDataLabel": false,
        "xAxis": { "showLabel": true }
      }
    }}%%
%%{initialize: {
      "xyChart": {
        "showDataLabel": true,
        "xAxis": { "showLabel": false }
      },
      "themeVariables": {
        "xyChart": {
          "plotColorPalette": ["#ff6b6b", "#0ea5e9"]
        }
      }
    }}%%
xychart
  x-axis [Q1, Q2]
  bar [30, 60]`)

    expect(chart.config.showDataLabel).toBe(true)
    expect(chart.config.xAxis?.showLabel).toBe(false)
    expect(chart.theme.plotColorPalette).toEqual(['#ff6b6b', '#0ea5e9'])
  })

  it('accepts the Mermaid initialize alias for directives', () => {
    const chart = parse(`%%{initialize: {
      "xyChart": {
        "showDataLabel": true
      }
    }}%%
xychart
  x-axis [Q1, Q2]
  bar [30, 60]`)

    expect(chart.config.showDataLabel).toBe(true)
  })

  it('parses the full documented Mermaid xychart config surface', () => {
    const chart = parse(`---
config:
  xyChart:
    width: 640
    height: 320
    titleFontSize: 24
    titlePadding: 12
    showDataLabel: true
    showTitle: true
    chartOrientation: horizontal
    plotReservedSpacePercent: 62
    xAxis:
      showLabel: false
      labelFontSize: 13
      labelPadding: 7
      showTitle: false
      titleFontSize: 15
      titlePadding: 8
      showTick: false
      tickLength: 9
      tickWidth: 3
      showAxisLine: false
      axisLineWidth: 4
    yAxis:
      showLabel: true
      labelFontSize: 12
      labelPadding: 6
      showTitle: true
      titleFontSize: 17
      titlePadding: 10
      showTick: true
      tickLength: 11
      tickWidth: 5
      showAxisLine: true
      axisLineWidth: 6
  themeVariables:
    xyChart:
      backgroundColor: "#fdfaf5"
      titleColor: "#102030"
      xAxisLabelColor: "#203040"
      xAxisTickColor: "#304050"
      xAxisLineColor: "#405060"
      xAxisTitleColor: "#506070"
      yAxisLabelColor: "#607080"
      yAxisTickColor: "#708090"
      yAxisLineColor: "#8090a0"
      yAxisTitleColor: "#90a0b0"
      plotColorPalette: "#ff6b6b, #0ea5e9"
---
xychart
  title Revenue
  x-axis Month [Jan, Feb]
  y-axis Users 0 --> 100
  bar [30, 60]`)

    expect(chart.config).toEqual({
      width: 640,
      height: 320,
      useMaxWidth: undefined,
      useWidth: undefined,
      titleFontSize: 24,
      titlePadding: 12,
      showDataLabel: true,
      showTitle: true,
      chartOrientation: 'horizontal',
      plotReservedSpacePercent: 62,
      xAxis: {
        showLabel: false,
        labelFontSize: 13,
        labelPadding: 7,
        showTitle: false,
        titleFontSize: 15,
        titlePadding: 8,
        showTick: false,
        tickLength: 9,
        tickWidth: 3,
        showAxisLine: false,
        axisLineWidth: 4,
      },
      yAxis: {
        showLabel: true,
        labelFontSize: 12,
        labelPadding: 6,
        showTitle: true,
        titleFontSize: 17,
        titlePadding: 10,
        showTick: true,
        tickLength: 11,
        tickWidth: 5,
        showAxisLine: true,
        axisLineWidth: 6,
      },
    })
    expect(chart.theme).toEqual({
      backgroundColor: '#fdfaf5',
      themeCss: undefined,
      titleColor: '#102030',
      xAxisLabelColor: '#203040',
      xAxisTickColor: '#304050',
      xAxisLineColor: '#405060',
      xAxisTitleColor: '#506070',
      yAxisLabelColor: '#607080',
      yAxisTickColor: '#708090',
      yAxisLineColor: '#8090a0',
      yAxisTitleColor: '#90a0b0',
      plotColorPalette: ['#ff6b6b', '#0ea5e9'],
    })
  })

  it('parses YAML palette lists and block-scalar themeCSS from frontmatter', () => {
    const chart = parse(`---
  config:
    themeCSS: |
      .xychart-title { letter-spacing: 0.08em; }
    xyChart:
      xAxis:
        showLabel: false
  themeVariables:
    xyChart:
      plotColorPalette:
        - "#ff0000"
        - "#00ff00"
---
xychart
  bar [10, 20]`)

    expect(chart.config.xAxis?.showLabel).toBe(false)
    expect(chart.theme.plotColorPalette).toEqual(['#ff0000', '#00ff00'])
    expect(chart.theme.themeCss).toContain('.xychart-title { letter-spacing: 0.08em; }')
  })

  it('uses header orientation ahead of frontmatter orientation', () => {
    const chart = parse(`---
config:
  xyChart:
    chartOrientation: vertical
---
xychart horizontal
  x-axis [A, B, C]
  bar [1, 2, 3]`)

    expect(chart.horizontal).toBe(true)
  })

  it('lets later init directives override YAML frontmatter when both are present', () => {
    const chart = parse(`---
config:
  xyChart:
    showDataLabel: false
---
%%{init: { "xyChart": { "showDataLabel": true } }}%%
xychart
  x-axis [A, B]
  bar [1, 2]`)

    expect(chart.config.showDataLabel).toBe(true)
  })

  it('auto-derives a y-axis range when malformed directives are ignored', () => {
    const chart = parse(`xychart
      x-axis not-a-range --> still-not-a-range
      y-axis nope --> ???
      bar [10, 20, 30]`)

    expect(chart.xAxis.range).toBeUndefined()
    expect(chart.yAxis.title).toBeUndefined()
    expect(chart.yAxis.range).toEqual({ min: 0, max: expect.any(Number) })
    expect(chart.yAxis.range!.max).toBeGreaterThan(30)
  })

  it('ignores unsupported categorical y-axis syntax instead of treating it as valid data', () => {
    const chart = parse(`xychart
      y-axis [Low, Medium, High]
      bar [10, 20, 30]`)

    expect(chart.yAxis.categories).toBeUndefined()
    expect(chart.yAxis.range).toEqual({ min: expect.any(Number), max: expect.any(Number) })
  })

  it('falls back to the default y-axis range when there is no series data', () => {
    const chart = parse(`xychart
      title Empty
      x-axis [A, B, C]`)

    expect(chart.series).toHaveLength(0)
    expect(chart.yAxis.range).toEqual({ min: 0, max: 100 })
  })
})
