import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { verifyMermaid } from '../agent/index.ts'
import { layoutPieChart } from '../pie/layout.ts'
import { parsePieChart } from '../pie/parser.ts'
import { layoutRadarChart } from '../radar/layout.ts'
import { parseRadarChart } from '../radar/parser.ts'
import { resolvePieVisualConfig } from '../pie/config.ts'

const pie = 'pie title Delivery readiness across the product portfolio\n"Completed work across the whole organisation": 6\n"Work currently being implemented": 3\n"Remaining work awaiting review": 1'
const radar = 'radar-beta\ntitle Delivery readiness across the product portfolio\naxis a["Speed"], b["Quality"], c["Cost"], d["Coverage"]\ncurve current["Current delivery readiness across the organisation"]{3,4,2,4}\ncurve target["Target delivery readiness across the organisation"]{4,5,4,5}\nmax 5'
const lines = (source: string) => source.split('\n')
const width = (svg: string) => Number(svg.match(/<svg[^>]*\bwidth="([\d.]+)"/)?.[1])

describe('bounded chart width fitting', () => {
  for (const [family, source] of [['pie', pie], ['radar', radar]] as const) {
    test(`${family} fits narrow hosts without scaling typography or hiding legend text`, () => {
      const options = { [family]: { maxWidth: 360 }, embedFontImport: false }
      const svg = renderMermaidSVG(source, options)
      expect(width(svg)).toBeLessThanOrEqual(360.01)
      const result = verifyMermaid(source, { renderOptions: options })
      expect(result.ok).toBe(true)
      expect(result.warnings.filter(w => ['LAYOUT_LIMIT_EXCEEDED', 'CONTENT_OCCLUDED', 'LABELS_HIDDEN', 'OFF_CANVAS'].includes(w.code))).toEqual([])
    })
    test(`${family} retains ordinary SVG when its natural layout already fits`, () => {
      expect(renderMermaidSVG(source, { [family]: { maxWidth: 5000 }, embedFontImport: false }))
        .toBe(renderMermaidSVG(source, { embedFontImport: false }))
    })
    test(`${family} reports an unmet budget while retaining a complete diagram`, () => {
      const result = verifyMermaid(source, { renderOptions: { [family]: { maxWidth: 80 } } })
      expect(result.ok).toBe(true)
      expect(result.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'LAYOUT_LIMIT_EXCEEDED', constraint: `${family}.maxWidth` }),
      ]))
      expect(result.layout.bounds.w).toBeGreaterThan(80)
    })
  }

  test('Pie keeps slice meaning and selected text sizes when its legend wraps', () => {
    const chart = layoutPieChart(parsePieChart(lines(pie)), { pie: { maxWidth: 360 } })
    expect(chart.slices.map(s => [s.value, s.fraction])).toEqual([[6, 0.6], [3, 0.3], [1, 0.1]])
    expect(chart.legend.map(l => l.label)).toEqual(['Completed work across the whole organisation', 'Work currently being implemented', 'Remaining work awaiting review'])
    expect(chart.legend.every(l => l.block?.fontSize === 13)).toBe(true)
    expect(chart.legend.some(l => l.lines.length > 1)).toBe(true)
    expect(chart.widthFit?.attempts).toBeLessThanOrEqual(3)
  })

  test('Radar keeps axis/curve order, values and text sizes through fitting', () => {
    const chart = layoutRadarChart(parseRadarChart(lines(radar)), { radar: { maxWidth: 360 } })
    expect(chart.axes.map(a => a.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(chart.curves.map(c => c.id)).toEqual(['current', 'target'])
    expect(chart.curves[0]!.vertices[0]!.y).toBeCloseTo(chart.cy - chart.radius * 3 / 5, 1)
    expect(chart.legend.map(l => l.label)).toEqual(['Current delivery readiness across the organisation', 'Target delivery readiness across the organisation'])
    expect(chart.legend.every(l => l.block?.fontSize === 13)).toBe(true)
    expect(chart.widthFit?.attempts).toBeLessThanOrEqual(3)
  })

  test('explicit legend placement and Radar frames retain precedence', () => {
    const left = layoutPieChart(parsePieChart(lines(pie)), { pie: { maxWidth: 360 } }, resolvePieVisualConfig({ pie: { legendPosition: 'left' } }))
    expect(left.width).toBeLessThanOrEqual(360.01)
    expect(left.legend.every(l => l.x < left.cx - left.radius)).toBe(true)
    const result = verifyMermaid(radar, { renderOptions: { radar: { maxWidth: 360 }, mermaidConfig: { radar: { width: 500, height: 500 } } } })
    expect(result.layout.bounds.w).toBeGreaterThanOrEqual(500)
    expect(result.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'LAYOUT_LIMIT_EXCEEDED' })]))
  })

  test('larger selected legend type wraps losslessly into disjoint rows', () => {
    const p = layoutPieChart(parsePieChart(lines(pie)), { pie: { maxWidth: 360 } }, { ...resolvePieVisualConfig(), legendTextSize: 24 })
    const r = layoutRadarChart(parseRadarChart(lines(radar)), { radar: { maxWidth: 360 } }, { legendFontSize: 24 })
    for (const chart of [p, r]) {
      expect(chart.width).toBeLessThanOrEqual(360.01)
      expect(chart.legend.every(l => l.block?.fontSize === 24)).toBe(true)
      for (const [i, row] of chart.legend.entries()) {
        expect(row.lines.join('').replace(/\s/g, '')).toContain(row.label.replace(/\s/g, ''))
        if (i) {
          const prior = chart.legend[i - 1]!
          expect(row.textY - row.block!.height / 2).toBeGreaterThanOrEqual(prior.textY + prior.block!.height / 2)
        }
      }
    }
  })
})
