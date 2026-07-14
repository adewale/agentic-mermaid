import { describe, expect, test } from 'bun:test'
import { resolveRadarVisualConfig, RADAR_NOOP_CONFIG_FIELDS } from '../radar/config.ts'
import { layoutRadarChart } from '../radar/layout.ts'
import { parseRadarChart } from '../radar/parser.ts'
import { renderMermaidSVG, verifyMermaid } from '../agent/index.ts'

const lines = (src: string): string[] => src.split('\n').map(l => l.trim()).filter(Boolean)

describe('radar config (wire-or-warn)', () => {
  test('resolves the wired radar section keys', () => {
    const cfg = resolveRadarVisualConfig({
      radar: { width: 500, height: 500, marginTop: 30, axisScaleFactor: 0.9, axisLabelFactor: 1.2, curveTension: 0.1, useMaxWidth: true, tickLabels: true },
    } as never)
    expect(cfg).toMatchObject({ width: 500, height: 500, marginTop: 30, axisScaleFactor: 0.9, axisLabelFactor: 1.2, curveTension: 0.1, useMaxWidth: true, tickLabels: true })
  })

  test('drops out-of-domain values', () => {
    const cfg = resolveRadarVisualConfig({ radar: { width: -1, curveTension: 2, axisScaleFactor: 0 } } as never)
    expect(cfg.width).toBeUndefined()
    expect(cfg.curveTension).toBeUndefined()
    expect(cfg.axisScaleFactor).toBeUndefined()
  })

  test('reads the complete safe radar theme surface and cScale palette overrides', () => {
    const cfg = resolveRadarVisualConfig({
      themeVariables: {
        titleColor: '#101010',
        radar: {
          axisColor: '#111111', axisStrokeWidth: 2.5, axisLabelFontSize: 14,
          curveOpacity: 0.3, curveStrokeWidth: 3,
          graticuleColor: '#222222', graticuleStrokeWidth: 1.5, graticuleOpacity: 0.4,
          legendBoxSize: 16, legendFontSize: 15,
        },
        cScale0: '#ff0000', cScale2: '#00ff00',
      },
    } as never)
    expect(cfg).toMatchObject({
      titleColor: '#101010', axisColor: '#111111', axisStrokeWidth: 2.5, axisLabelFontSize: 14,
      curveOpacity: 0.3, curveStrokeWidth: 3,
      graticuleColor: '#222222', graticuleStrokeWidth: 1.5, graticuleOpacity: 0.4,
      legendBoxSize: 16, legendFontSize: 15,
    })
    expect(cfg.paletteOverrides?.[0]).toBe('#ff0000')
    expect(cfg.paletteOverrides?.[2]).toBe('#00ff00')
  })

  test('theme variables reach final SVG paint and invalid values warn instead of disappearing', () => {
    const source = `---
config:
  themeVariables:
    titleColor: "#101010"
    cScale0: "#ff0000"
    radar:
      axisColor: "#111111"
      axisStrokeWidth: 2.5
      axisLabelFontSize: 14
      curveOpacity: 0.3
      curveStrokeWidth: 3
      graticuleColor: "#222222"
      graticuleStrokeWidth: 1.5
      graticuleOpacity: 0.4
      legendBoxSize: 16
      legendFontSize: 15
---
radar-beta
  title Styled
  axis a, b, c
  curve x{1,2,3}
  max 5`
    const svg = renderMermaidSVG(source)
    expect(svg).toContain('.radar-axis-line { stroke: #111111; stroke-width: 2.5; }')
    expect(svg).toContain('.radar-ring { stroke: #222222; stroke-width: 1.5; stroke-opacity: 0.4;')
    expect(svg).toContain('.radar-area { stroke-width: 3; fill-opacity: 0.3;')
    expect(svg).toContain('font-size="14"')
    expect(svg).toContain('width="16" height="16"')
    expect(svg).toContain('fill="#ff0000"')
    expect(svg).toContain('.radar-title { fill: #101010; }')

    const hostileSource = `---
config:
  themeVariables:
    radar:
      curveOpacity: 2
      axisColor: "url(https://evil.example/x)"
      mystery: 1
---
radar-beta
  axis a, b
  curve x{1,2}
  max 3`
    const hostileSvg = renderMermaidSVG(hostileSource)
    expect(hostileSvg).not.toContain('evil.example')
    expect(hostileSvg).not.toContain('stroke: url(')
    const invalid = verifyMermaid(hostileSource)
    expect(invalid.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INEFFECTIVE_CONFIG', field: 'themeVariables.radar.axisColor' }),
      expect.objectContaining({ code: 'INEFFECTIVE_CONFIG', field: 'themeVariables.radar.curveOpacity' }),
      expect.objectContaining({ code: 'INEFFECTIVE_CONFIG', field: 'themeVariables.radar.mystery' }),
    ]))
  })

  test('curveTension 0 degenerates the smooth curve to straight edges', () => {
    const chart = parseRadarChart(lines('radar-beta\n  axis a, b, c\n  curve x{1,2,3}\n  max 5'))
    const smooth = layoutRadarChart(chart, {}, { curveTension: 0.17 })
    const straight = layoutRadarChart(chart, {}, { curveTension: 0 })
    expect(smooth.curves[0]!.areaPath).toContain('C') // beziers
    expect(straight.curves[0]!.areaPath).not.toContain('C') // polyline
  })

  test('noop fields are declared for the INEFFECTIVE_CONFIG lint', () => {
    expect(RADAR_NOOP_CONFIG_FIELDS).toContain('useWidth')
  })
})
