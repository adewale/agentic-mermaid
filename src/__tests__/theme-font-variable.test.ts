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
import { inlineFontVarForRaster } from '../theme.ts'

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

// ============================================================================
// Beautiful Mermaid issue #18 — var()-valued and stack-valued fonts.
//
// `font: 'var(--brand-font)'` used to emit garbage:
//   - `@import url('https://fonts.googleapis.com/css2?family=var(--brand-font)…')`
//     (a nonsense Google Fonts fetch),
//   - an invalid quoted fallback `font-family: var(--font, 'var(--brand-font)')`,
//   - and the raster path inlined the broken `'var(--brand-font)'` literal.
// Multi-family stacks ("Inter, system-ui") hit the same @import garbage.
// ============================================================================

describe('issue #18 — var() and font-stack font values', () => {
  const VAR_FONT = 'var(--brand-font)'
  const STACK_FONT = 'Inter, system-ui'

  it('var() font emits no Google Fonts @import anywhere in the SVG', () => {
    const svg = renderMermaidSVG(SRC, { font: VAR_FONT })
    expect(svg).not.toContain('fonts.googleapis.com')
    expect(svg).not.toContain('@import')
  })

  it('var() font emits a valid unquoted font-family fallback', () => {
    const svg = renderMermaidSVG(SRC, { font: VAR_FONT })
    // The var() reference must pass through unquoted — quoting it turns the
    // fallback into a bogus family literally named "var(--brand-font)".
    expect(svg).toContain('text { font-family: var(--font, var(--brand-font)), system-ui, sans-serif; }')
    expect(svg).not.toContain("'var(--brand-font)'")
    // Root variable still emitted so host pages resolve --brand-font live.
    expect(svg).toContain('--font:var(--brand-font)')
  })

  it('var() font: raster inlining resolves to the default concrete family', () => {
    const svg = renderMermaidSVG(SRC, { font: VAR_FONT, embedFontImport: false })
    const inlined = inlineFontVarForRaster(svg)
    // No host page exists under resvg, so var(--brand-font) can never
    // resolve — substitute the default family rather than a broken literal.
    expect(inlined).toContain("text { font-family: 'Inter', system-ui, sans-serif; }")
    expect(inlined).not.toContain("'var(--brand-font)'")
    expect(inlined).not.toContain('var(--font')
  })

  it('var() font with concrete fallback: raster inlining uses that fallback family', () => {
    const svg = renderMermaidSVG(SRC, { font: 'var(--brand-font, Georgia)', embedFontImport: false })
    const inlined = inlineFontVarForRaster(svg)
    expect(inlined).toContain('text { font-family: Georgia, system-ui, sans-serif; }')
  })

  it('font stack emits no @import and preserves the stack unquoted', () => {
    const svg = renderMermaidSVG(SRC, { font: STACK_FONT })
    expect(svg).not.toContain('fonts.googleapis.com')
    expect(svg).not.toContain('@import')
    expect(svg).toContain('text { font-family: var(--font, Inter, system-ui), system-ui, sans-serif; }')
    expect(svg).not.toContain("'Inter, system-ui'")
  })

  it('font stack: raster inlining preserves the stack', () => {
    const svg = renderMermaidSVG(SRC, { font: STACK_FONT, embedFontImport: false })
    const inlined = inlineFontVarForRaster(svg)
    expect(inlined).toContain('text { font-family: Inter, system-ui, system-ui, sans-serif; }')
  })

  it('the JetBrains Mono @import survives var() font suppression (mono diagrams)', () => {
    // Class diagrams request the mono face; only the family import derived
    // from the font setting is garbage, so only that one is suppressed.
    const svg = renderMermaidSVG('classDiagram\n  class A', { font: VAR_FONT })
    expect(svg).toContain('family=JetBrains+Mono')
    expect(svg).not.toContain('family=var')
  })

  it('plain names keep the exact @import URL and quoted fallback (byte-compat)', () => {
    const svg = renderMermaidSVG(SRC, { font: 'IBM Plex Sans' })
    expect(svg).toContain(
      "@import url('https://fonts.googleapis.com/css2?family=IBM%20Plex%20Sans:wght@400;500;600;700&amp;display=swap');",
    )
    expect(svg).toContain("text { font-family: var(--font, 'IBM Plex Sans'), system-ui, sans-serif; }")
    // Raster inlining of plain names is also byte-identical to before.
    expect(inlineFontVarForRaster(svg)).toContain("text { font-family: 'IBM Plex Sans', system-ui, sans-serif; }")
  })
})
