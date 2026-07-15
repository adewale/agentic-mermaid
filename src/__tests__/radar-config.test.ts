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
    const cfg = resolveRadarVisualConfig({ radar: { width: -1, curveTension: 2, axisScaleFactor: 0, axisLabelFactor: 1.05, marginLeft: 1e308 } } as never)
    expect(cfg.width).toBeUndefined()
    expect(cfg.curveTension).toBeUndefined()
    expect(cfg.axisScaleFactor).toBeUndefined()
    expect(cfg.axisLabelFactor).toBeUndefined()
    expect(cfg.marginLeft).toBeUndefined()
  })

  test('axisLabelFactor rejects ineffective low values and moves labels when accepted', () => {
    const source = 'radar-beta\n axis top, right, bottom, left\n max 5'
    const chart = parseRadarChart(lines(source))
    const near = layoutRadarChart(chart, {}, { axisLabelFactor: 1.1 })
    const far = layoutRadarChart(chart, {}, { axisLabelFactor: 1.2 })
    expect(far.cy - far.axes[0]!.labelY).toBeGreaterThan(near.cy - near.axes[0]!.labelY)

    const configured = `---\nconfig:\n  radar:\n    axisLabelFactor: 1.05\n---\n${source}`
    expect(verifyMermaid(configured).warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INEFFECTIVE_CONFIG', field: 'radar.axisLabelFactor' }),
    ]))
  })

  test('bounds finite geometry config before arithmetic can overflow', () => {
    const source = `---
config:
  radar:
    marginLeft: 1e308
    axisScaleFactor: 1e308
---
radar-beta
  axis a, b, c
  curve x{1,2,3}
  max 5`
    expect(() => renderMermaidSVG(source)).not.toThrow()
    expect(verifyMermaid(source).warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INEFFECTIVE_CONFIG', field: 'radar.marginLeft' }),
      expect.objectContaining({ code: 'INEFFECTIVE_CONFIG', field: 'radar.axisScaleFactor' }),
    ]))
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
    expect(svg).toContain('.radar-axis-label { fill: #111111; }')
    expect(svg).toContain('.radar-ring { stroke: #222222; stroke-width: 1.5; stroke-opacity: 0.4;')
    expect(svg).toContain('.radar-ring-outer { stroke-width: 2.0999999999999996; stroke-opacity: 0.4; }')
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

  test('wires global radar title fontSize into measured and painted geometry', () => {
    const source = `---
config:
  themeVariables:
    fontSize: 80
---
radar-beta
  title Large title
  axis a, b, c
  curve x{1,2,3}
  max 5`
    const svg = renderMermaidSVG(source)
    expect(svg).toMatch(/class="radar-title"[^>]*font-size="80"/)
  })

  test('curve opacity reaches legend and styled replacement geometry', () => {
    const source = `---
config:
  themeVariables:
    radar:
      curveOpacity: 0.2
---
radar-beta
  axis a, b, c
  curve x{1,2,3}
  max 5`
    const crisp = renderMermaidSVG(source)
    expect(crisp).toMatch(/class="radar-legend-swatch"[^>]*fill-opacity="0.2"/)
    expect(renderMermaidSVG(source, { style: 'watercolor' })).toContain('fill-opacity="0.2"')
    expect(renderMermaidSVG(source, { style: 'hand-drawn' })).toContain('stroke-opacity="0.2"')
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
