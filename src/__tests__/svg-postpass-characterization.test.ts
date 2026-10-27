import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG, verifyNoExternalRefs } from '../index.ts'
import { namespaceSvgIds } from '../renderer.ts'
import { prepareSvgForPngRasterization } from '../png-contract.ts'
import { createInlineColorAttributeResolver, inlineFontVarForRaster, inlineResolvedColors, resolveColors, resolveInlineColorAttribute, type DiagramColors } from '../theme.ts'
import { escapeAttr } from '../multiline-utils.ts'
import { decodedSvgAttributeValue, scanSvgStartTags } from '../svg-structure.ts'
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

  test('scalar Scene paints retain CSS expressions, fallbacks and XML attribute values', () => {
    const colors = { bg: '#fff', fg: '#000', accent: 'var(--brand, #0ff)' }
    const cases = [
      ['#fff8', '#fff8'],
      ['red', 'red'],
      ['rgba(1,2,3,0.5)', 'rgba(1,2,3,0.5)'],
      ['var(--fg)', '#000'],
      ['var(--missing, #abc)', '#abc'],
      ['var(--missing, var(--fg))', '#000'],
      ['color-mix(in srgb, var(--fg) 50%, var(--bg))', '#808080'],
      ['color-mix(in srgb, #000000 50%, transparent)', '#808080'],
      ['var(--brand, #f00)', 'var(--brand, #f00)'],
      ['var(--font, #abc)', 'var(--font, #abc)'],
      ['var( --fg )', 'var( --fg )'],
      ['var(--missing, &#35;fff)', '&#35;fff'],
      ['var(--missing, #abc\n)', '#abc\n'],
      ['"<&\t\r\n', '"<&\t\r\n'],
    ] as const
    for (const palette of [colors, Object.freeze({ line: undefined, muted: undefined, surface: undefined, border: undefined, font: undefined, ...colors })]) {
      const resolveColor = createInlineColorAttributeResolver()
      for (const [paint, expected] of cases) {
        expect(resolveInlineColorAttribute(paint, palette), paint).toBe(expected)
        expect(resolveColor(paint, palette), paint).toBe(expected)
        const svg = inlineResolvedColors(`<rect fill="${escapeAttr(paint)}"/>`, palette)
        expect(decodedSvgAttributeValue(scanSvgStartTags(svg)[0]!, 'fill'), paint).toBe(expected)
      }
    }

    // Literal RGB pages normalize for mixing; a host-controlled page keeps
    // every reference live, even an otherwise resolvable authored fallback.
    expect(resolveInlineColorAttribute('color-mix(in srgb, var(--fg) 50%, var(--bg))', { bg: 'white', fg: 'rgb(0 0 0)' })).toBe('#808080')
    expect(resolveInlineColorAttribute('var(--missing, #abc)', { bg: 'var(--page)', fg: '#000' })).toBe('var(--missing, #abc)')
  })

  test('scalar resolution observes each palette call and retains unusual substituted attribute bytes', () => {
    for (const resolveColor of [resolveInlineColorAttribute, createInlineColorAttributeResolver()]) {
      const colors: DiagramColors = { bg: '#fff', fg: '#000', line: undefined, accent: undefined, muted: undefined, surface: undefined, border: undefined, font: undefined }
      expect(resolveColor('var(--fg)', colors)).toBe('#000')
      colors.fg = '#112233'
      expect(resolveColor('var(--fg)', colors)).toBe('#112233')
      colors.muted = 'var(--missing, #abc)'
      expect(resolveColor('var(--_text-sec)', colors)).toBe('var(--missing, #abc)')
      colors.muted = '"'
      expect(() => resolveColor('var(--_text-sec)', Object.freeze({ ...colors }))).toThrow(TypeError)
      colors.muted = '<style>.x{fill:var(--fg)}</style>'
      expect(resolveColor('var(--_text-sec)', Object.freeze({ ...colors }))).toBe('<style>.x{fill:#112233}</style>')
      let foreground = '#123456'
      const accessor = Object.freeze({ bg: '#fff', get fg() { return foreground } })
      expect(resolveColor('var(--fg)', accessor)).toBe('#123456')
      foreground = '#654321'
      expect(resolveColor('var(--fg)', accessor)).toBe('#654321')
      const parent = { bg: '#fff', fg: '#123456' }
      const inherited: DiagramColors = Object.freeze(Object.create(parent))
      expect(resolveColor('var(--fg)', inherited)).toBe('#123456')
      parent.fg = '#654321'
      expect(resolveColor('var(--fg)', inherited)).toBe('#654321')
      const optional: { muted?: string } = {}
      const inheritedOptional: DiagramColors = Object.freeze(Object.assign(Object.create(optional), { bg: '#fff', fg: '#000' }))
      expect(resolveColor('var(--muted, #abc)', inheritedOptional)).toBe('#abc')
      optional.muted = '#123456'
      expect(resolveColor('var(--muted, #abc)', inheritedOptional)).toBe('#123456')
      let reject = false
      const symbol = Symbol('palette metadata')
      const extra = Object.freeze({ bg: 'white', fg: '#000', line: undefined, accent: undefined, muted: undefined, surface: undefined, border: undefined, font: undefined,
        get [symbol]() { if (reject) throw new Error('changed palette metadata'); return 'metadata' },
      })
      expect(resolveColor('var(--fg)', extra)).toBe('#000000')
      reject = true
      expect(() => resolveColor('var(--fg)', extra)).toThrow('changed palette metadata')
    }
  })

  test('CSS substitutions preserve tag-like text inside a CDATA style body', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><style><![CDATA[.x{content:\'<g fill="red">\';fill:var(--fg)}]]></style><rect class="x" width="10" height="10"/></svg>'
    expect(inlineResolvedColors(svg, { bg: '#ffffff', fg: '#112233' }))
      .toBe(svg.replace('var(--fg)', '#112233'))
  })

  test('family CSS overrides public colors while normalized pages and internal tones retain palette priority', () => {
    const svg = '<svg style="--bg:red;--fg:blue;--line:#123456;--_text:#abcdef;--family:#fedcba">'
      + '<path fill="var(--line)" stroke="var(--_text)"/>'
      + '<rect fill="color-mix(in srgb, var(--fg) 50%, var(--bg))" stroke="var(--family)"/></svg>'
    const resolved = inlineResolvedColors(svg, { bg: 'white', fg: 'black', line: '#111111' })
    expect(resolved).toContain('<path fill="#123456" stroke="#000000"/>')
    expect(resolved).toContain('<rect fill="#808080" stroke="#fedcba"/>')
  })

  test('an optional color that becomes absent preserves live font palette references', () => {
    for (const resolveColor of [resolveInlineColorAttribute, createInlineColorAttributeResolver()]) {
      resolveColors({ bg: '#fff', fg: '#000', line: '#123456' })
      const values = ['#123456', '#123456', '#123456', undefined]
      const colors = { bg: '#fff', fg: '#000', font: 'var(--line, #abc)', get line() { return values.shift() } }
      expect(resolveColor('var(--line, #abc)', colors)).toBe('var(--line, #abc)')
    }
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
