import { describe, expect, test } from 'bun:test'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'

const RADAR = `radar-beta
  axis speed, cost, safety
  curve Current{4,3,5}
  max 5`
const XY = `xychart-beta
  x-axis [A, B, C]
  y-axis 0 --> 5
  bar [4, 3, 5]`

const STYLE = {
  semanticSlots: { selected: { fillColor: '#ff00ff', borderColor: '#007700', lineWidth: 6 } },
  bindings: [
    { channel: 'category', value: 'Current', slot: 'selected' },
    { channel: 'category', value: 'bar-0', slot: 'selected' },
  ],
} as const

function radarGeometry(svg: string): string[] {
  return [...svg.matchAll(/class="radar-area"[^>]*\s(?:points|d)="([^"]+)"/g)].map(match => match[1]!)
}

function barGeometry(svg: string): string[] {
  return [...svg.matchAll(/<rect\b[^>]*\sclass="xychart-bar[^>]*>/g)]
    .map(([tag]) => ['x', 'y', 'width', 'height'].map(name => {
      const value = tag.match(new RegExp(`\\s${name}="([^"]+)"`))?.[1]
      if (value === undefined) throw new Error(`Missing bar ${name}`)
      return value
    }).join(','))
}

describe('Section B chart semantic bindings', () => {
  test('one semantic slot paints Radar categories and XYChart series without changing data geometry', () => {
    const radarBaseline = renderMermaidSVG(RADAR)
    const radarBranded = renderMermaidSVG(RADAR, { style: STYLE as any })
    const xyBaseline = renderMermaidSVG(XY)
    const xyBranded = renderMermaidSVG(XY, { style: STYLE as any })

    expect(radarGeometry(radarBaseline)).toHaveLength(1)
    expect(radarGeometry(radarBaseline)[0]).toMatch(/[0-9]/)
    expect(radarGeometry(radarBranded)).toEqual(radarGeometry(radarBaseline))
    expect(barGeometry(xyBaseline)).toHaveLength(3)
    for (const geometry of barGeometry(xyBaseline)) {
      const values = geometry.split(',').map(Number)
      expect(values).toHaveLength(4)
      expect(values.every(Number.isFinite)).toBe(true)
      expect(values[2]! > 0 && values[3]! > 0).toBe(true)
    }
    expect(barGeometry(xyBranded)).toEqual(barGeometry(xyBaseline))
    expect(radarBranded).toMatch(/class="radar-area"[^>]*fill="#ff00ff"[^>]*stroke="#007700"/)
    expect(xyBranded).toMatch(/class="xychart-bar[^>]* fill="#ff00ff" stroke="#007700" stroke-width="6"/)
  })

  test('Radar category cues remain perceptible in no-color terminal output', () => {
    const style = {
      semanticSlots: { selected: { cue: 'pattern' } },
      bindings: [{ channel: 'category', value: 'Current', slot: 'selected', role: 'pie-slice' }],
    } as const
    const baseline = renderMermaidASCII(RADAR, { colorMode: 'none' })
    const branded = renderMermaidASCII(RADAR, { colorMode: 'none', style })
    expect(branded).not.toBe(baseline)
    expect(branded).toContain('░ Current')
  })

  test('authored family palettes remain authoritative over semantic slot paint', () => {
    const authoredRadar = `---
config:
  themeVariables:
    cScale0: "#123456"
---
${RADAR}`
    const authoredXY = `---
config:
  themeVariables:
    xyChart:
      plotColorPalette: "#654321"
---
${XY}`
    const authoredPie = `---
config:
  themeVariables:
    pie1: "#2468ac"
---
pie
  "Current" : 4
  "Other" : 3`
    const radarSvg = renderMermaidSVG(authoredRadar, { style: STYLE as any })
    const xySvg = renderMermaidSVG(authoredXY, { style: STYLE as any })
    const pieSvg = renderMermaidSVG(authoredPie, { style: STYLE as any })

    expect(radarSvg).toMatch(/class="radar-area"[^>]*fill="#123456"/)
    expect(radarSvg).not.toMatch(/class="radar-area"[^>]*fill="#ff00ff"/)
    expect(xySvg).toContain('--xychart-color-0: #654321;')
    expect(xySvg).toMatch(/class="xychart-bar[^>]* fill="#654321"/)
    expect(xySvg).not.toMatch(/class="xychart-bar[^>]* fill="#ff00ff"/)
    expect(pieSvg).toMatch(/class="pie-slice"[^>]*fill="#2468ac"/)
    expect(pieSvg).not.toMatch(/class="pie-slice"[^>]*fill="#ff00ff"/)
  })
})
