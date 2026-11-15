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

  test('infeasible budgets do not wrap titles and legends narrower than the plot', () => {
    const p = layoutPieChart(parsePieChart(lines(pie)), { pie: { maxWidth: 80 } })
    const r = layoutRadarChart(parseRadarChart(lines(radar)), { radar: { maxWidth: 80 } })
    for (const chart of [p, r]) {
      expect(chart.widthFit?.status).toBe('exceeded')
      expect(chart.legend.every(row => row.lines.length <= 4)).toBe(true)
      expect(chart.height).toBeLessThan(1000)
    }
    for (const legendPosition of ['left', 'right'] as const) for (const maxWidth of [80, 300]) {
      const chart = layoutPieChart(parsePieChart(lines(pie)), { pie: { maxWidth } }, resolvePieVisualConfig({ pie: { legendPosition } }))
      expect(chart.legend.every(row => row.lines.length === 1)).toBe(true)
      expect(chart.height).toBeLessThan(1000)
    }
    const swatch = layoutRadarChart(parseRadarChart(lines(radar)), { radar: { maxWidth: 80 } }, { legendBoxSize: 240 })
    expect(swatch.legend.every(row => row.lines.length <= 4)).toBe(true)
    expect(swatch.height).toBeLessThan(1500)
  })

  test('bottom Radar legends use the available width instead of the side-column cap', () => {
    const source = 'radar-beta\naxis a["Speed"], b["Quality"], c["Cost"], d["Coverage"]\ncurve current["Reliability and operational readiness"]{3,4,2,4}\nmax 5'
    const chart = layoutRadarChart(parseRadarChart(lines(source)), { radar: { maxWidth: 360 } })
    expect(chart.width).toBeLessThanOrEqual(360.01)
    expect(chart.legend[0]!.lines).toEqual(['Reliability and operational readiness'])
    expect(chart.legend[0]!.block!.fontSize).toBe(13)
  })

  test('Radar fitting retains visible scale annotations even when the budget must be exceeded', () => {
    const source = 'radar-beta\naxis a["Speed"], b["Quality"], c["Cost"], d["Coverage"]\ncurve current{3,4,2,4}\nmax 5\nticks 5'
    const chart = layoutRadarChart(parseRadarChart(lines(source)), { radar: { maxWidth: 360 } }, { tickLabels: true })
    expect(chart.tickLabels.map(tick => tick.text)).toEqual(['1', '2', '3', '4', '5'])
    expect(chart.widthFit?.status).toBe('exceeded')
    const result = verifyMermaid(source, { renderOptions: { radar: { maxWidth: 360 }, mermaidConfig: { radar: { tickLabels: true } } } })
    expect(result.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'LAYOUT_LIMIT_EXCEEDED' })]))
  })

  test('short Pie legends pack in source order without reducing selected type or the plot', () => {
    const labels = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett', 'Kilo', 'Lima']
    const source = 'pie title Slice palette\n' + labels.map((label, i) => `"${label}": ${12 - i}`).join('\n')
    const chart = layoutPieChart(parsePieChart(lines(source)), { pie: { maxWidth: 360 } })
    expect(chart.width).toBeLessThanOrEqual(360.01)
    expect(chart.height).toBeLessThan(500)
    expect(chart.radius).toBe(95)
    expect(chart.legend.map(row => row.label)).toEqual(labels)
    expect(chart.legend.every(row => row.block?.fontSize === 13)).toBe(true)
    expect(chart.legend[0]!.y).toBe(chart.legend[1]!.y)
    expect(chart.legend[0]!.x).toBeLessThan(chart.legend[1]!.x)
    expect(chart.legend[2]!.y).toBeGreaterThan(chart.legend[0]!.y)
  })

  test('short Radar legends share measured column packing and keep series association', () => {
    const source = 'radar-beta\naxis a["Speed"], b["Quality"], c["Cost"], d["Coverage"]\ncurve alpha["Alpha"]{3,4,2,4}\ncurve beta["Beta"]{4,3,4,2}\ncurve gamma["Gamma"]{2,5,3,4}\ncurve delta["Delta"]{5,2,4,3}\nmax 5'
    const chart = layoutRadarChart(parseRadarChart(lines(source)), { radar: { maxWidth: 360 } })
    expect(chart.width).toBeLessThanOrEqual(360.01)
    expect(chart.legend.map(row => [row.label, row.colorIndex])).toEqual([['Alpha', 0], ['Beta', 1], ['Gamma', 2], ['Delta', 3]])
    expect(chart.legend.every(row => row.block?.fontSize === 13)).toBe(true)
    expect(chart.legend[0]!.y).toBe(chart.legend[1]!.y)
    expect(chart.legend[0]!.x).toBeLessThan(chart.legend[1]!.x)
    expect(chart.legend[2]!.y).toBeGreaterThan(chart.legend[0]!.y)
  })

  for (const [axes, values] of [
    ['Agility, Speed, Strength, Stam["Stamina"], Intel["Intelligence"]', '2,2,3,5,0'],
    ['m["Math"], s["Science"], e["English"], h["History"], g["Geography"], a["Art"]', '85,90,80,70,75,90'],
  ]) test(`Radar uses horizontal spoke reach to fit ${values!.split(',').length} axes within three layouts`, () => {
    const source = `radar-beta\naxis ${axes}\ncurve current{${values}}\nmax 100`
    const chart = layoutRadarChart(parseRadarChart(lines(source)), { radar: { maxWidth: 360 } })
    expect(chart.width).toBeLessThanOrEqual(360.01)
    expect(chart.radius).toBeGreaterThan(60)
    expect(chart.widthFit?.attempts).toBeLessThanOrEqual(3)
  })
})
