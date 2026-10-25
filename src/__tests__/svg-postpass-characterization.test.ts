import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG, verifyNoExternalRefs } from '../index.ts'
import { namespaceSvgIds } from '../renderer.ts'
import { prepareSvgForPngRasterization } from '../png-contract.ts'
import { inlineFontVarForRaster, inlineResolvedColors } from '../theme.ts'
import * as svgPostprocess from '../svg-postprocess.ts'

const SOURCE = `flowchart TD
  accTitle: Post pass contract
  accDescr: Accessibility survives namespacing
  A[Start] --> B[Finish]
  click A "https://example.com/private"`

describe('SVG post-pass interaction contract', () => {
  test('numeric serialization preserves authored text, IDs, CSS and adjacent path tokens', () => {
    const authored = '36.900000000000006'
    const input = `<svg viewBox="0 0 ${authored} 100" data-value="${authored}">`
      + `<style>.x{--authored:${authored};content:"${authored}"}</style>`
      + `<path id="id-${authored}" d="M1e-8.3333333333333333-.6666666666666666 L0 0" stroke-width="2.0999999999999996"/>`
      + `<text x="${authored}" dx="-0.000000000000000000123456789012345">${authored}</text></svg>`
    const output = svgPostprocess.formatSvgNumbers(input)
    expect(output).toContain('viewBox="0 0 36.9 100"')
    expect(output).toContain('d="M1e-8 0.333333333333-0.666666666667 L0 0"')
    expect(output).toContain('stroke-width="2.1"')
    expect(output).toContain('x="36.9"')
    expect(output).toContain('dx="-1.23456789012e-19"')
    expect(output).toContain(`data-value="${authored}"`)
    expect(output).toContain(`id="id-${authored}"`)
    expect(output).toContain(`<style>.x{--authored:${authored};content:"${authored}"}</style>`)
    expect(output).toContain(`>${authored}</text>`)
    expect(svgPostprocess.formatSvgNumbers(output)).toBe(output)
  })

  test.each([undefined, 'hand-drawn', 'watercolor'] as const)('%s: public SVG keeps numeric label text while compacting geometry', style => {
    const svg = renderMermaidSVG('stateDiagram-v2\n[*] --> A\nA: 36.900000000000006\nA --> [*]', { style: [...(style ? [style] : []), { strokeWidth: 1.5 * 1.4 }], seed: 7 })
    expect(svg).toContain('36.900000000000006</')
    expect(svg).not.toMatch(/(?:height|stroke-width|dy)="[^"<>]*\.\d{12}/)
  })

  test('CSS substitutions preserve tag-like text inside a CDATA style body', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><style><![CDATA[.x{content:\'<g fill="red">\';fill:var(--fg)}]]></style><rect class="x" width="10" height="10"/></svg>'
    expect(inlineResolvedColors(svg, { bg: '#ffffff', fg: '#112233' }))
      .toBe(svg.replace('var(--fg)', '#112233'))
  })

  for (const style of [undefined, 'hand-drawn'] as const) {
    test(`${style ?? 'crisp'}: colors, identity, ARIA, strict security, namespacing, and compacting compose`, () => {
      const options = { idPrefix: 'probe-', security: 'strict' as const, compact: true, ...(style ? { style, seed: 7 } : {}) }
      const first = renderMermaidSVG(SOURCE, options)
      const second = renderMermaidSVG(SOURCE, options)
      expect(second).toBe(first)
      expect(first).toContain('id="probe-svg-title"')
      expect(first).toContain('aria-labelledby="probe-svg-title"')
      expect(first).toContain('aria-describedby="probe-svg-desc"')
      expect(first).toContain('data-id="A"')
      expect(first).not.toContain('data-id="probe-A"')
      expect(first).not.toContain('data-href=')
      expect(first).not.toContain('https://example.com/private')
      expect(first).not.toMatch(/\s(?:xlink:)?href="https:\/\//)
      expect(verifyNoExternalRefs(first).ok).toBe(true)
      expect(first).not.toMatch(/(?:fill|stroke)="var\(--/)
    })
  }

  test('post-passes mutate only structural SVG/CSS contexts and preserve authored lookalikes', () => {
    const authored = [
      'var(--fg)',
      'color-mix(in srgb, #000 50%, #fff)',
      'var(--missing, #abcdef)',
      'url(#arrowhead)',
      'var(--font, Courier)',
    ].join(' | ')
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60" data-comparison="1 > 0">' +
      '<style>.node{fill:var(--fg);stroke:color-mix(in srgb, #000000 50%, #ffffff);' +
      'color:var(--missing, #abcdef);font-family:var(--font, var(--brand-font, Courier))}</style>' +
      '<defs><marker id="arrowhead"/></defs>' +
      `<text data-authored="${authored}">${authored}</text>` +
      '<path marker-end="url(#arrowhead)"/></svg>'

    const colored = inlineResolvedColors(svg, { bg: '#ffffff', fg: '#000000' })
    expect(colored).toContain(`data-authored="${authored}"`)
    expect(colored).toContain(`>${authored}</text>`)
    expect(colored).not.toContain('.node{fill:var(--fg)')
    expect(colored).not.toContain('stroke:color-mix(')

    const namespaced = namespaceSvgIds(colored, 'ctx-')
    expect(namespaced).toContain('id="ctx-arrowhead"')
    expect(namespaced).toContain('marker-end="url(#ctx-arrowhead)"')
    expect(namespaced).toContain(`>${authored}</text>`)

    const raster = prepareSvgForPngRasterization(
      inlineFontVarForRaster(namespaced),
      { width: 320, height: 160, pixels: 320 * 160 },
    )
    expect(raster).toContain('data-comparison="1 > 0"')
    expect(raster).toContain('font-family:Courier')
    expect(raster).toContain(`>${authored}</text>`)
    expect(raster).toContain('width="320"')
    expect(raster).toContain('height="160"')
  })
})
