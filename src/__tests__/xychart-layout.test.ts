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

function layout(text: string) {
  const processed = preprocessMermaidSource(text)
  return layoutXYChart(applyXYChartFrontmatterConfig(parseXYChart(processed.lines), processed.frontmatter))
}

describe('xychart layout – dimensions and bounds', () => {
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
