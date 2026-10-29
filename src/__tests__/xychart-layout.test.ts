/**
 * Layout tests for xychart diagrams.
 *
 * These assert the coordinate-space rules directly so renderer changes do not
 * hide plot sizing or axis-placement regressions.
 */
import { describe, it, expect } from 'bun:test'
import { preprocessMermaidSource } from '../mermaid-source.ts'
import { applyXYChartFrontmatterConfig, parseXYChart } from '../xychart/parser.ts'
import { layoutXYChart } from '../xychart/layout.ts'
import { renderMermaidSVG } from '../index.ts'
import { layoutMermaidWithReceipt } from '../agent/index.ts'
import { projectXyChartPositioned } from '../positioned-views/xychart.ts'
import raynerTitles from './testdata/rayner-528/xy-axis-titles.json'

function layout(text: string) {
  const processed = preprocessMermaidSource(text)
  return layoutXYChart(applyXYChartFrontmatterConfig(parseXYChart(processed.lines), processed.frontmatter))
}

describe('xychart layout – dimensions and bounds', () => {
  it.each(raynerTitles)('fits the original Rayner $id axis title in its authored canvas', ({ source, style }) => {
    let svg = ''
    expect(() => { svg = renderMermaidSVG(source, { style }) }).not.toThrow()
    const { layout: projected } = layoutMermaidWithReceipt(source, { style })
    expect([Number(projected.bounds.w), Number(projected.bounds.h)]).toEqual([540, 250])
    const title = projected.labels!.find(label => label.id === 'axis:y:title')!
    expect(title.text.replace(/\s+/g, ' ')).toBe('Avantage (barres), plafond (ligne), €')
    const box = title.bounds!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.w).toBeLessThanOrEqual(540)
    expect(box.y + box.h).toBeLessThanOrEqual(250)
    expect(svg).toContain('viewBox="0 0 540 250"')
  })

  it.each(['Avantage (barres), plafond (ligne), €', 'Échéance '.repeat(12), 'Throughput'.repeat(12)])('fits a long title on either rotated axis: %s', title => {
    for (const horizontal of [false, true]) {
      const source = `---\nconfig:\n  xyChart:\n    width: 540\n    height: 250\n---\nxychart-beta${horizontal ? ' horizontal' : ''}\nx-axis "${horizontal ? title : 'Category'}" [A,B]\ny-axis "${horizontal ? 'Value' : title}" 0 --> 10\nbar [1,2]`
      const { layout: projected } = layoutMermaidWithReceipt(source, { style: 'pen-and-ink' })
      const axis = projected.labels!.find(label => label.id === `axis:${horizontal ? 'x' : 'y'}:title`)!
      expect(axis.text.replace(/-\n/g, '').replace(/\s/g, '')).toBe(title.replace(/\s/g, ''))
      expect(axis.bounds!.y).toBeGreaterThanOrEqual(0)
      expect(axis.bounds!.y + axis.bounds!.h).toBeLessThanOrEqual(250)
      expect(axis.bounds!.x).toBeGreaterThanOrEqual(0)
      expect(axis.bounds!.x + axis.bounds!.w).toBeLessThanOrEqual(projected.groups.find(group => group.id === 'plot')!.x)
      expect(renderMermaidSVG(source, { style: 'pen-and-ink' })).toContain('viewBox="0 0 540 250"')
    }
  })

  it('rounds a fractional plot frame by its endpoints without inventing off-canvas geometry', () => {
    const source = '---\nconfig:\n  xyChart:\n    showDataLabel: true\n---\nxychart-beta horizontal\nx-axis [c0,c1,c2,c3,c4,c5,c6,c7]\nbar s0 [0,0,0,0,0,0,0,0]'
    const projected = layoutMermaidWithReceipt(source, { style: 'risograph' }).layout
    const plot = projected.groups.find(group => group.id === 'plot')!
    expect(plot.y + plot.h).toBe(projected.bounds.h)
    const svg = renderMermaidSVG(source, { style: 'risograph' })
    expect(svg).toContain('viewBox="0 0 700 500"')
  })

  it('an invisible out-of-domain single line sample retains its value with its footprint inside the plot', () => {
    const source = '---\nconfig:\n  xyChart:\n    width: 300\n    height: 241\n    showDataLabel: false\n---\nxychart-beta\nx-axis [a]\ny-axis 0 --> 100\nline S0 [-17]'
    const positioned = layout(source)
    const point = positioned.lines[0]!.points[0]!
    const plotBottom = positioned.plotArea.y + positioned.plotArea.height
    expect(point.value).toBe(-17)
    expect(point.y).toBe(plotBottom)
    const original = { ...point }
    const projected = projectXyChartPositioned({ positioned, options: {} })
    const sample = projected.nodes.find(node => node.id === 'line#0:pt#0')!
    expect(Number(sample.y) + Number(sample.h)).toBeCloseTo(plotBottom, 1)
    expect(point).toEqual(original)
    const svg = renderMermaidSVG(source)
    // A lone sample has neither a connector nor an unrequested marker. Its
    // semantic datum survives even though it paints no series ink here.
    expect(svg).not.toContain('class="xychart-line ')
    expect(svg).not.toContain('class="xychart-dot ')
  })

  it('retains in-canvas point-label anchors without moving authored samples', () => {
    for (const orientation of ['', ' horizontal']) {
      const prefix = `xychart-beta${orientation}\n x-axis [A,B]\n y-axis 0 --> 10\n`
      const bare = layout(`${prefix} line [10,0]`)
      const labelled = layout(`${prefix} line [10 "Top",0 "Bottom"]`)
      expect(labelled.lines[0]!.points.map(({ x, y, value }) => ({ x, y, value })))
        .toEqual(bare.lines[0]!.points.map(({ x, y, value }) => ({ x, y, value })))
      for (const point of labelled.lines[0]!.points) {
        expect(point.textBlock).toBeDefined()
        const at = point.textPosition
        expect(at).toBeDefined()
        expect(at!.x).toBeGreaterThanOrEqual(0)
        expect(at!.y - point.textBlock!.height / 2).toBeGreaterThanOrEqual(0)
        expect(at!.y + point.textBlock!.height / 2).toBeLessThanOrEqual(labelled.height)
      }
      expect(renderMermaidSVG(`${prefix} line [10 "Top",0 "Bottom"]`)).not.toContain('y="-1" class="xychart-point-label')
    }
  })

  it('uses Mermaid width and height as total chart dimensions', () => {
    const chart = layout(`---
config:
  xyChart:
    width: 720
    height: 240
---
xychart
  title Revenue
  x-axis [Q1, Q2, Q3]
  y-axis Users 0 --> 100
  bar [10, 20, 30]`)

    expect(chart.width).toBe(720)
    expect(chart.height).toBe(240)
    expect(chart.plotArea.x).toBeGreaterThanOrEqual(0)
    expect(chart.plotArea.y).toBeGreaterThanOrEqual(0)
    expect(chart.plotArea.x + chart.plotArea.width).toBeLessThanOrEqual(chart.width)
    expect(chart.plotArea.y + chart.plotArea.height).toBeLessThanOrEqual(chart.height)

    for (const bar of chart.bars) {
      expect(bar.x).toBeGreaterThanOrEqual(chart.plotArea.x)
      expect(bar.x + bar.width).toBeLessThanOrEqual(chart.plotArea.x + chart.plotArea.width)
      expect(bar.y).toBeGreaterThanOrEqual(chart.plotArea.y)
      expect(bar.y + bar.height).toBeLessThanOrEqual(chart.plotArea.y + chart.plotArea.height)
    }
  })

  it('keeps numeric x-axis line points inside the plot area', () => {
    const chart = layout(`xychart
      x-axis 0 --> 100
      y-axis 0 --> 50
      line [10, 20, 35, 40, 45]`)

    expect(chart.lines).toHaveLength(1)
    expect(chart.legend).toEqual([])

    for (const point of chart.lines[0]!.points) {
      expect(point.x).toBeGreaterThanOrEqual(chart.plotArea.x)
      expect(point.x).toBeLessThanOrEqual(chart.plotArea.x + chart.plotArea.width)
      expect(point.y).toBeGreaterThanOrEqual(chart.plotArea.y)
      expect(point.y).toBeLessThanOrEqual(chart.plotArea.y + chart.plotArea.height)
    }
  })
  // Mermaid insets a numeric x-axis by half a bar band at each end when the
  // chart has bars. Without it the end bars hung off the plot, and the chart
  // failed to render.
  it('keeps numeric x-axis bars inside the plot area, with lines on their centres', () => {
    for (const source of ['xychart\n  x-axis 0 --> 10\n  bar [1, 2]', 'xychart\n  x-axis 10 --> 0\n  bar [1, 2, 3]\n  line [3, 2, 1]', 'xychart\n  x-axis 0 --> 10\n  bar [5]']) {
      const chart = layout(source)
      for (const bar of chart.bars) {
        expect(bar.x, source).toBeGreaterThanOrEqual(chart.plotArea.x)
        expect(bar.x + bar.width, source).toBeLessThanOrEqual(chart.plotArea.x + chart.plotArea.width)
      }
      for (const [index, point] of (chart.lines[0]?.points ?? []).entries()) expect(point.x).toBeCloseTo(chart.bars[index]!.x + chart.bars[index]!.width / 2, 5)
      expect(renderMermaidSVG(source), source).toContain('<svg')
    }
  })
})

describe('xychart layout – axis placement', () => {
  it('places the category axis on the left and the value axis at the top in horizontal mode', () => {
    const chart = layout(`xychart horizontal
      title Revenue
      x-axis "Team" [Eng, Sales, Ops]
      y-axis "Users" 0 --> 100
      bar [10, 20, 30]
      line [12, 18, 26]`)

    expect(chart.horizontal).toBe(true)
    expect(chart.xAxis.line.x1).toBeCloseTo(chart.xAxis.line.x2, 5)
    expect(chart.xAxis.line.y1).toBeCloseTo(chart.plotArea.y, 5)
    expect(chart.xAxis.line.y2).toBeCloseTo(chart.plotArea.y + chart.plotArea.height, 5)
    expect(chart.xAxis.ticks[0]!.textAnchor).toBe('end')

    expect(chart.yAxis.line.y1).toBeCloseTo(chart.yAxis.line.y2, 5)
    expect(chart.yAxis.line.x1).toBeCloseTo(chart.plotArea.x, 5)
    expect(chart.yAxis.line.x2).toBeCloseTo(chart.plotArea.x + chart.plotArea.width, 5)
    expect(chart.yAxis.line.y1).toBeLessThanOrEqual(chart.plotArea.y)
    expect(chart.yAxis.ticks[0]!.textAnchor).toBe('middle')
  })

  // Accents, stacked marks and joining scripts get a line box taller than the
  // nominal one; a title placed by its font size alone left the canvas.
  it.each([
    ['one\ntwo\nthree', 'Users\nper day'],
    ['Umsätze', 'عربي'],
    ['x\ný', 'ệ̃'],
  ])('stacks an axis title\'s line boxes between its tick labels and the canvas edge (%j, %j)', (xTitle, yTitle) => {
    for (const header of ['xychart', 'xychart horizontal']) {
      const chart = layout(`${header}
        x-axis "${xTitle}" [Jan, Feb]
        y-axis "${yTitle}" 0 --> 100
        bar [10, 20]`)
      for (const axis of [chart.xAxis, chart.yAxis]) {
        const title = axis.title!
        const half = title.block!.height / 2
        const ticks = axis.ticks.filter(tick => tick.label)
        if (title.rotate) {
          expect(title.x - half).toBeGreaterThanOrEqual(0)
          expect(title.x + half).toBeLessThanOrEqual(Math.min(...ticks.map(tick => tick.labelX - tick.block!.width)))
        } else if (title.y > chart.plotArea.y) {
          expect(title.y + half).toBeLessThanOrEqual(chart.height)
          expect(title.y - half).toBeGreaterThanOrEqual(Math.max(...ticks.map(tick => tick.labelY + tick.block!.height / 2)))
        } else {
          expect(title.y - half).toBeGreaterThanOrEqual(0)
          expect(title.y + half).toBeLessThanOrEqual(Math.min(...ticks.map(tick => tick.labelY - tick.block!.height / 2)))
        }
      }
    }
  })

  it('propagates axis visibility config into the positioned chart', () => {
    const chart = layout(`---
config:
  xyChart:
    xAxis:
      showLabel: false
      showTick: false
    yAxis:
      showTitle: false
---
xychart
  title Revenue
  x-axis Month [Jan, Feb, Mar]
  y-axis Users 0 --> 100
  bar [10, 20, 30]`)

    expect(chart.xAxis.config.showLabel).toBe(false)
    expect(chart.xAxis.config.showTick).toBe(false)
    expect(chart.xAxis.ticks).toHaveLength(0)
    expect(chart.yAxis.config.showTitle).toBe(false)
    expect(chart.yAxis.title).toBeUndefined()
  })
})
