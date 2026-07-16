import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { fitUncalibratedSvgText } from '../custom-font-geometry.ts'
import { HOSTED_FONT_RESOURCES } from '../font-manifest.ts'
import { measureFormattedTextWidth, measureMonospaceTextWidth } from '../text-metrics.ts'
import { decodePng, inkColumns } from './helpers/png-pixels.ts'

const BUNDLED_FONT_FAMILIES = [...new Set(HOSTED_FONT_RESOURCES.map(resource => resource.family))]

describe('deterministic custom-font geometry', () => {
  test('resource availability never masquerades as metric calibration', () => {
    const svg = '<svg><text font-size="14">Natural</text></svg>'
    for (const family of BUNDLED_FONT_FAMILIES) {
      const projected = fitUncalibratedSvgText(svg, family)
      expect(projected, family).toContain('data-font-metrics="deterministic-fit"')
      expect(projected, family).toContain('lengthAdjust="spacingAndGlyphs"')
    }
  })

  test('every face paints at the exact deterministic width used by layout', () => {
    const source = 'flowchart LR\n  A[Wide custom label] --> B[Done]'
    for (const font of [...BUNDLED_FONT_FAMILIES, 'Acme Wide']) {
      const options = { style: { font } } as const
      const svg = renderMermaidSVG(source, options)
      const label = svg.match(/<text\b([^>]*)>Wide custom label<\/text>/)
      expect(label, font).not.toBeNull()
      const expected = measureFormattedTextWidth('Wide custom label', 13, 500)
      expect(label![1], font).toContain(`textLength="${Math.round(expected * 1000) / 1000}"`)
      expect(label![1], font).toContain('lengthAdjust="spacingAndGlyphs"')
      expect(label![1], font).toContain('data-font-metrics="deterministic-fit"')
      expect(renderMermaidSVG(source, options)).toBe(svg)
    }
  })

  test('positioned lines and monospace semantic text use their layout measurement authorities', () => {
    const projected = fitUncalibratedSvgText(
      '<svg><text font-size="12" font-weight="600"><tspan x="0">Alpha</tspan><tspan x="0" dy="14">Beta</tspan></text><text class="mono" font-size="11">code()</text></svg>',
      'Acme Wide',
    )
    expect(projected.match(/lengthAdjust="spacingAndGlyphs"/g)).toHaveLength(3)
    expect(projected).toContain(`class="mono" font-size="11" textLength="${measureMonospaceTextWidth('code()', 11)}"`)
  })

  test('mixed plain and formatted content is fitted as one continuous painted advance', () => {
    const fitted = fitUncalibratedSvgText(
      '<svg><text font-size="13" font-weight="500">plain <tspan font-weight="bold">bold</tspan> tail</text></svg>',
      'Acme Wide',
    )
    const expected = Math.round((
      measureFormattedTextWidth('plain ', 13, 500)
      + measureFormattedTextWidth('bold', 13, 700)
      + measureFormattedTextWidth(' tail', 13, 500)
    ) * 1000) / 1000
    expect(fitted).toContain(`<text font-size="13" font-weight="500" textLength="${expected}"`)
    expect(fitted).toContain('plain <tspan font-weight="bold">bold</tspan> tail')
    expect(fitUncalibratedSvgText(fitted, 'Acme Wide')).toBe(fitted)
  })

  test('multiline formatted content fits each positioned line without scaling the parent', () => {
    const fitted = fitUncalibratedSvgText(
      '<svg><text font-size="13"><tspan x="10" y="20">plain <tspan font-weight="bold">bold</tspan></tspan><tspan x="10" dy="16">tail</tspan></text></svg>',
      'Acme Wide',
    )
    expect(fitted.match(/data-font-metrics="deterministic-fit"/g)).toHaveLength(2)
    expect(fitted).toMatch(/<text font-size="13"><tspan x="10" y="20" textLength=/)
    expect(fitted).toMatch(/<tspan x="10" dy="16" textLength=/)
  })

  test('symbolic tspan weights resolve before deterministic width measurement', () => {
    const roundedWidth = (text: string, weight: number) =>
      Math.round(measureFormattedTextWidth(text, 13, weight) * 1000) / 1000
    const fitted = fitUncalibratedSvgText(
      '<svg><text font-size="13" font-weight="500"><tspan x="0" font-weight="bold">world</tspan><tspan x="0" font-weight="bolder">heavy</tspan><tspan x="0" font-weight="lighter">light</tspan><tspan x="0" font-weight="625">numeric</tspan></text><text font-size="13" font-weight="700"><tspan x="0" font-weight="normal">plain</tspan><tspan x="0" font-weight="bolder">heavier</tspan><tspan x="0" font-weight="lighter">lighter</tspan></text></svg>',
      'Acme Wide',
    )
    expect(fitted).toContain(`<tspan x="0" font-weight="bold" textLength="${roundedWidth('world', 700)}"`)
    expect(fitted).toContain(`<tspan x="0" font-weight="bolder" textLength="${roundedWidth('heavy', 700)}"`)
    expect(fitted).toContain(`<tspan x="0" font-weight="lighter" textLength="${roundedWidth('light', 100)}"`)
    expect(fitted).toContain(`<tspan x="0" font-weight="625" textLength="${roundedWidth('numeric', 625)}"`)
    expect(fitted).toContain(`<tspan x="0" font-weight="normal" textLength="${roundedWidth('plain', 400)}"`)
    expect(fitted).toContain(`<tspan x="0" font-weight="bolder" textLength="${roundedWidth('heavier', 900)}"`)
    expect(fitted).toContain(`<tspan x="0" font-weight="lighter" textLength="${roundedWidth('lighter', 400)}"`)
  })

  test('role-local font families are fitted through the same projection as the global face', () => {
    const svg = renderMermaidSVG('flowchart LR\n  subgraph G[Group]\n    A[Alpha]\n  end', {
      style: { roles: { group: { fontFamily: 'Acme Wide' } } },
    })
    expect(svg).toMatch(/<text[^>]*font-family="Acme Wide"[^>]*data-font-metrics="deterministic-fit"[^>]*>Group<\/text>/)
    expect(svg).toMatch(/<text[^>]*data-font-metrics="deterministic-fit"[^>]*>Alpha<\/text>/)
  })

  test('quoted stacks and inline style attributes resolve deterministic metrics', () => {
    const svg = '<svg><text style="font-family: Acme Wide; font-size: 20; font-weight: 700; letter-spacing: 2">Wide</text></svg>'
    const fitted = fitUncalibratedSvgText(svg, '"Fallback Face", sans-serif')
    expect(fitted).toContain(`textLength="${measureFormattedTextWidth('Wide', 20, 700, 2)}"`)
    expect(fitted).toContain('lengthAdjust="spacingAndGlyphs"')
  })

  test('existing explicit geometry remains emitter-owned while nested text inherits deterministic fitting', () => {
    const existing = '<svg><text font-size="14" textLength="99">Owned</text></svg>'
    expect(fitUncalibratedSvgText(existing, 'Acme Wide')).toBe(existing)
    const missingSize = '<svg><text>Unknown size</text></svg>'
    expect(fitUncalibratedSvgText(missingSize, 'Acme Wide')).toBe(missingSize)
    const empty = '<svg><text font-size="14"></text></svg>'
    expect(fitUncalibratedSvgText(empty, 'Acme Wide')).toBe(empty)
    const nested = '<svg><text font-size="14"><a href="#local">Linked</a></text></svg>'
    expect(fitUncalibratedSvgText(nested, 'Acme Wide')).toContain('<text font-size="14" textLength=')
  })

  test('repeated wide glyphs remain inside estimator-sized node geometry for every bundled face', () => {
    const text = 'Wm'.repeat(22)
    const source = `flowchart LR\n  A[${text}]`
    for (const font of BUNDLED_FONT_FAMILIES) {
      const options = { style: { font }, embedFontImport: false } as const
      const svg = renderMermaidSVG(source, options)
      const rect = [...svg.matchAll(/<rect[^>]*x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*>/g)][0]
      expect(rect, font).toBeDefined()
      const [x, y, width, height] = rect!.slice(1, 5).map(Number)
      const scale = 2
      const image = decodePng(renderMermaidPNG(source, { ...options, scale, onWarning: () => {} }))
      const leftOverflow = inkColumns(image, 0, (x! - 2) * scale, (y! + 4) * scale, (y! + height! - 4) * scale)
      const rightOverflow = inkColumns(image, (x! + width! + 2) * scale, image.width, (y! + 4) * scale, (y! + height! - 4) * scale)
      expect({ font, leftOverflow, rightOverflow }).toEqual({ font, leftOverflow: [], rightOverflow: [] })
    }
  })
})
