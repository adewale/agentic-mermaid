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

function layout(text: string) {
  const processed = preprocessMermaidSource(text)
  return layoutXYChart(applyXYChartFrontmatterConfig(parseXYChart(processed.lines), processed.frontmatter))
}

describe('xychart layout – dimensions and bounds', () => {
  it('rounds a fractional plot frame by its endpoints without inventing off-canvas geometry', () => {
    const source = '---\nconfig:\n  xyChart:\n    showDataLabel: true\n---\nxychart-beta horizontal\nx-axis [c0,c1,c2,c3,c4,c5,c6,c7]\nbar s0 [0,0,0,0,0,0,0,0]'
    const projected = layoutMermaidWithReceipt(source, { style: 'risograph' }).layout
    const plot = projected.groups.find(group => group.id === 'plot')!
    expect(plot.y + plot.h).toBe(projected.bounds.h)
    const svg = renderMermaidSVG(source, { style: 'risograph' })
    expect(svg).toContain('viewBox="0 0 700 500"')
  })

  it('an invisible out-of-domain single line sample retains its value without an off-canvas measurement footprint', () => {
    const source = '---\nconfig:\n  xyChart:\n    width: 300\n    height: 241\n    showDataLabel: false\n---\nxychart-beta\nx-axis [a]\ny-axis 0 --> 100\nline S0 [-17]'
    const positioned = layout(source)
    const point = positioned.lines[0]!.points[0]!
    expect(point.value).toBe(-17)
    expect(point.y).toBeGreaterThan(positioned.height)
    const original = { ...point }
    const projected = projectXyChartPositioned({ positioned, options: {} })
    const sample = projected.nodes.find(node => node.id === 'line#0:pt#0')!
    expect(Number(sample.y)).toBe(241)
    expect(Number(sample.h)).toBe(0)
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

  it('stacks an axis title\'s authored lines between its tick labels and the canvas edge', () => {
    for (const header of ['xychart', 'xychart horizontal']) {
      const chart = layout(`${header}
        x-axis "one\ntwo\nthree" [Jan, Feb]
        y-axis "Users\nper day" 0 --> 100
        bar [10, 20]`)
      for (const axis of [chart.xAxis, chart.yAxis]) {
        const title = axis.title!
        const half = title.block!.height / 2
        const ticks = axis.ticks.filter(tick => tick.label)
        expect(title.block!.lines.length, header).toBeGreaterThan(1)
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
