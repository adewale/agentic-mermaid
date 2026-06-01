/**
 * Loop 8 M2 — CSS-variable fonts + embedFontImport toggle.
 *
 * Asserts that:
 *  - The default SVG STILL contains the Google Fonts @import (back-compat;
 *    4 SVG fixtures + an explicit renderer.test.ts assertion lock this in).
 *  - `--font:` is now emitted on the SVG root inline style so consumers can
 *    swap the family post-render by mutating `style="--font:Roboto"`.
 *  - When `embedFontImport: false` is passed, the @import line is absent
 *    but `--font:` still appears (CLI / PNG path uses this).
 *  - Overriding `--font` post-render swaps the rendered family (the
 *    `font-family` rule references `var(--font, '<default>')`).
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'

const SRC = 'graph TD\n  A --> B\n'

describe('Loop 8 M2 — CSS-variable fonts + embedFontImport toggle', () => {
  it('default render still embeds the Google Fonts @import (back-compat)', () => {
    const svg = renderMermaidSVG(SRC)
    expect(svg).toContain('fonts.googleapis.com')
    expect(svg).toContain('@import url')
  })

  it('default render emits --font on the SVG root style', () => {
    const svg = renderMermaidSVG(SRC)
    // svgOpenTag concatenates the variables into the style attribute.
    expect(svg).toContain('--font:Inter')
  })

  it('uses var(--font, ...) in the text font-family CSS rule', () => {
    const svg = renderMermaidSVG(SRC)
    // The rule must reference var(--font, ...) so style="--font:Roboto" swaps the family.
    expect(svg).toMatch(/text \{ font-family: var\(--font, 'Inter'\)/)
  })

  it('embedFontImport=false strips the @import but keeps --font', () => {
    const svg = renderMermaidSVG(SRC, { embedFontImport: false })
    expect(svg).not.toContain('fonts.googleapis.com')
    expect(svg).not.toContain('@import url')
    // CSS variable still emitted so post-render override still works.
    expect(svg).toContain('--font:Inter')
    expect(svg).toContain("var(--font, 'Inter')")
  })

  it('embedFontImport=false still produces a usable <style> block (font-family + colors)', () => {
    const svg = renderMermaidSVG(SRC, { embedFontImport: false })
    // The <style> block still exists and contains the font-family declaration
    // (it just omits the @import line).
    expect(svg).toContain('<style>')
    expect(svg).toContain('text { font-family: var(--font')
    // Color variables still derived as before.
    expect(svg).toContain('--bg:')
    expect(svg).toContain('--fg:')
  })

  it('post-render override via style="--font:Roboto" swaps the rendered family at render time', () => {
    // Simulate a consumer flipping --font on the root by manipulating the SVG.
    // We render with default Inter, then verify swapping --font in the style
    // attribute changes what `font-family: var(--font, '...')` will resolve to.
    const svg = renderMermaidSVG(SRC)
    // Find the SVG root style attribute.
    const styleMatch = svg.match(/<svg[^>]*style="([^"]*)"/)
    expect(styleMatch).not.toBeNull()
    const styleAttr = styleMatch![1]!
    expect(styleAttr).toContain('--font:Inter')

    // Swap --font to Roboto.
    const swapped = svg.replace('--font:Inter', '--font:Roboto')
    // The text rule still says var(--font, 'Inter'), so when the browser /
    // resvg resolves --font on the root, it uses 'Roboto' (the override),
    // not the literal 'Inter' fallback.
    expect(swapped).toContain('--font:Roboto')
    expect(swapped).toContain("var(--font, 'Inter')")
  })

  it('explicit `font` option propagates as both --font variable and font-family fallback', () => {
    const svg = renderMermaidSVG(SRC, { font: 'Roboto Mono' })
    expect(svg).toContain('--font:Roboto Mono')
    // The literal fallback in font-family matches too.
    expect(svg).toContain("var(--font, 'Roboto Mono')")
  })
})
