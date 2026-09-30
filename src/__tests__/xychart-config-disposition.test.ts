import { describe, expect, test } from 'bun:test'
import { verifyMermaid } from '../agent/index.ts'
import { renderMermaidSVGAsync } from '../browser-lazy.ts'
import { renderMermaidSVG } from '../index.ts'
import { mermaidConfigKeys } from './helpers/mermaid-config-keys.ts'

const CHART = 'xychart-beta\n  x-axis [Jan, Feb]\n  y-axis "Sales" 0 --> 10\n  bar [3, 7]'
const UNWIRED = [
  { path: 'xyChart.xAxis.labelRotation', config: { xAxis: { labelRotation: 45 } }, baseline: {} },
  { path: 'xyChart.yAxis.labelRotation', config: { yAxis: { labelRotation: -45 } }, baseline: {} },
] as const
// Drawn here: value labels move beyond the bar end instead of inside it.
const WIRED = { path: 'xyChart.showDataLabelOutsideBar', config: { showDataLabel: true, showDataLabelOutsideBar: true }, baseline: { showDataLabel: true } } as const

function withConfig(config: object): string {
  return `%%{init: ${JSON.stringify({ xyChart: config })}}%%\n${CHART}`
}

describe('pinned XY Chart configuration dispositions (#248)', () => {
  test('every explicitly diagnosed key is in the pinned Mermaid 11.16 schema', () => {
    const pinned = new Set(mermaidConfigKeys().map(key => key.id))
    for (const { path } of [...UNWIRED, WIRED]) expect(pinned.has(path), path).toBe(true)
  })

  test(`${WIRED.path} is drawn, so it is not reported as a no-op`, async () => {
    const source = withConfig(WIRED.config)
    expect(verifyMermaid(source).warnings.filter(warning => warning.code === 'INEFFECTIVE_CONFIG')).toEqual([])

    const configuredSvg = renderMermaidSVG(source, { embedFontImport: false })
    expect(configuredSvg).not.toBe(renderMermaidSVG(withConfig(WIRED.baseline), { embedFontImport: false }))

    const explicitDiagnostics: Array<{ code: string; field: string; message: string }> = []
    const explicitSvg = renderMermaidSVG(CHART, {
      embedFontImport: false,
      mermaidConfig: { xyChart: WIRED.config },
      onConfigDiagnostic: diagnostic => explicitDiagnostics.push(diagnostic),
    })
    expect(explicitDiagnostics).toEqual([])
    expect(explicitSvg).toBe(configuredSvg)

    const lazyDiagnostics: Array<{ code: string; field: string; message: string }> = []
    const lazySvg = await renderMermaidSVGAsync(CHART, {
      embedFontImport: false,
      mermaidConfig: { xyChart: WIRED.config },
      onConfigDiagnostic: diagnostic => lazyDiagnostics.push(diagnostic),
    })
    expect(lazyDiagnostics).toEqual([])
    expect(lazySvg).toBe(explicitSvg)
  })

  for (const { path, config, baseline } of UNWIRED) {
    test(`${path} is a named no-op through source and explicit options`, async () => {
      const source = withConfig(config)
      const sourceWarnings = verifyMermaid(source).warnings.filter(warning => warning.code === 'INEFFECTIVE_CONFIG' && warning.field === path)
      expect(sourceWarnings).toHaveLength(1)
      expect(sourceWarnings[0]).toMatchObject({ message: expect.stringContaining('has no effect on this renderer') })

      const configuredSvg = renderMermaidSVG(source, {
        embedFontImport: false,
      })

      const explicitDiagnostics: Array<{ code: string; field: string; message: string }> = []
      const explicitSvg = renderMermaidSVG(CHART, {
        embedFontImport: false,
        mermaidConfig: { xyChart: config },
        onConfigDiagnostic: diagnostic => explicitDiagnostics.push(diagnostic),
      })
      expect(explicitDiagnostics).toEqual([expect.objectContaining({
        code: 'INEFFECTIVE_CONFIG',
        field: path,
        message: expect.stringContaining('has no effect on this renderer'),
      })])
      expect(configuredSvg).toBe(renderMermaidSVG(withConfig(baseline), { embedFontImport: false }))
      expect(explicitSvg).toBe(configuredSvg)

      const lazyDiagnostics: Array<{ code: string; field: string; message: string }> = []
      const lazySvg = await renderMermaidSVGAsync(CHART, {
        embedFontImport: false,
        mermaidConfig: { xyChart: config },
        onConfigDiagnostic: diagnostic => lazyDiagnostics.push(diagnostic),
      })
      expect(lazyDiagnostics).toEqual(explicitDiagnostics)
      expect(lazySvg).toBe(explicitSvg)
    })
  }

  test('invalid values are diagnosed, not silently treated as supported options', async () => {
    for (const { path, config } of [
      { path: 'xyChart.showDataLabelOutsideBar', config: { showDataLabelOutsideBar: 'yes' as never } },
      { path: 'xyChart.xAxis.labelRotation', config: { xAxis: { labelRotation: '45deg' } } },
      { path: 'xyChart.yAxis.labelRotation', config: { yAxis: { labelRotation: null } } },
    ]) {
      const warnings = verifyMermaid(withConfig(config)).warnings.filter(warning => warning.code === 'INEFFECTIVE_CONFIG' && warning.field === path)
      expect(warnings, path).toHaveLength(1)
      expect(warnings[0]).toMatchObject({ message: expect.stringContaining('must be') })

      const explicitDiagnostics: Array<{ code: string; field: string; message: string }> = []
      const explicitSvg = renderMermaidSVG(CHART, {
        embedFontImport: false,
        mermaidConfig: { xyChart: config },
        onConfigDiagnostic: diagnostic => explicitDiagnostics.push(diagnostic),
      })
      expect(explicitDiagnostics).toEqual([expect.objectContaining({
        code: 'INEFFECTIVE_CONFIG',
        field: path,
        message: expect.stringContaining('must be'),
      })])
      expect(explicitSvg).toBe(renderMermaidSVG(CHART, { embedFontImport: false }))

      const lazyDiagnostics: Array<{ code: string; field: string; message: string }> = []
      const lazySvg = await renderMermaidSVGAsync(CHART, {
        embedFontImport: false,
        mermaidConfig: { xyChart: config },
        onConfigDiagnostic: diagnostic => lazyDiagnostics.push(diagnostic),
      })
      expect(lazyDiagnostics).toEqual(explicitDiagnostics)
      expect(lazySvg).toBe(explicitSvg)
    }
  })
})
