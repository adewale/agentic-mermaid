import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG, verifyNoExternalRefs } from '../index.ts'
import { namespaceSvgIds } from '../renderer.ts'
import { prepareSvgForPngRasterization } from '../png-contract.ts'
import { inlineFontVarForRaster, inlineResolvedColors } from '../theme.ts'

const SOURCE = `flowchart TD
  accTitle: Post pass contract
  accDescr: Accessibility survives namespacing
  A[Start] --> B[Finish]
  click A "https://example.com/private"`

describe('SVG post-pass interaction contract', () => {
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
