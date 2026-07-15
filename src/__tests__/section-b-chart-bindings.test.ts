import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'

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
  return [...svg.matchAll(/class="radar-area"[^>]*(?:points|d)="([^"]+)"/g)].map(match => match[1]!)
}

function barGeometry(svg: string): string[] {
  return [...svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" class="xychart-bar/g)]
    .map(match => match.slice(1).join(','))
}

describe('Section B chart semantic bindings', () => {
  test('one semantic slot paints Radar categories and XYChart series without changing data geometry', () => {
    const radarBaseline = renderMermaidSVG(RADAR)
    const radarBranded = renderMermaidSVG(RADAR, { style: STYLE as any })
    const xyBaseline = renderMermaidSVG(XY)
    const xyBranded = renderMermaidSVG(XY, { style: STYLE as any })

    expect(radarGeometry(radarBranded)).toEqual(radarGeometry(radarBaseline))
    expect(barGeometry(xyBranded)).toEqual(barGeometry(xyBaseline))
    expect(radarBranded).toMatch(/class="radar-area"[^>]*fill="#ff00ff"[^>]*stroke="#007700"/)
    expect(xyBranded).toMatch(/class="xychart-bar[^>]*style="[^"]*fill:#ff00ff[^"]*stroke:#007700[^"]*stroke-width:6/)
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
    const radarSvg = renderMermaidSVG(authoredRadar, { style: STYLE as any })
    const xySvg = renderMermaidSVG(authoredXY, { style: STYLE as any })

    expect(radarSvg).toMatch(/class="radar-area"[^>]*fill="#123456"/)
    expect(radarSvg).not.toMatch(/class="radar-area"[^>]*fill="#ff00ff"/)
    expect(xySvg).toContain('--xychart-color-0: #654321;')
    expect(xySvg).not.toMatch(/class="xychart-bar[^>]*style="[^"]*fill:#ff00ff/)
  })
})
