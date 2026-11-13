/**
 * Loop 8 M2 — CSS-variable fonts + embedFontImport toggle.
 *
 * Asserts that:
 *  - The default SVG does not fetch Google Fonts; imports are explicit opt-in.
 *  - `--font:` is now emitted on the SVG root inline style so consumers can
 *    swap the family post-render by mutating `style="--font:Roboto"`.
 *  - When `embedFontImport: false` is passed, the @import line is absent
 *    but `--font:` still appears (CLI / PNG path uses this).
 *
 * Computed font retheming is covered by svg-style-isolation-browser.test.ts.
 * These checks protect emitted CSS, import policy, and raster fallbacks.
 */
import { describe, expect, it } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { inlineFontVarForRaster } from '../theme.ts'

const SRC = 'graph TD\n  A --> B\n'

describe('Loop 8 M2 — CSS-variable fonts + embedFontImport toggle', () => {
  it('default render does not embed a Google Fonts @import', () => {
    const svg = renderMermaidSVG(SRC)
    expect(svg).not.toContain('fonts.googleapis.com')
    expect(svg).not.toContain('@import url')
  })

  it('default render emits --font on the SVG root style', () => {
    const svg = renderMermaidSVG(SRC)
    // svgOpenTag concatenates the variables into the style attribute.
    expect(svg).toContain('--font:Inter')
  })

  it('uses var(--font, ...) in the inherited root font-family rule', () => {
    const svg = renderMermaidSVG(SRC)
    // The rule must reference var(--font, ...) so style="--font:Roboto" swaps the family.
    expect(svg).toMatch(/svg[^{}]*\{ font-family: var\(--font, 'Inter'\)/)
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
    expect(svg).toMatch(/svg[^{}]*\{ font-family: var\(--font/)
    // Color variables still derived as before.
    expect(svg).toContain('--bg:')
    expect(svg).toContain('--fg:')
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
    expect(svg).toContain('font-family: var(--font, var(--brand-font)), system-ui, sans-serif; }')
    expect(svg).not.toContain("'var(--brand-font)'")
    // Root variable still emitted so host pages resolve --brand-font live.
    expect(svg).toContain('--font:var(--brand-font)')
  })

  it('var() font: raster inlining resolves to the default concrete family', () => {
    const svg = renderMermaidSVG(SRC, { font: VAR_FONT, embedFontImport: false })
    const inlined = inlineFontVarForRaster(svg)
    // No host page exists under resvg, so var(--brand-font) can never
    // resolve — substitute the default family rather than a broken literal.
    expect(inlined).toContain("font-family: 'Inter', system-ui, sans-serif; }")
    expect(inlined).not.toContain("'var(--brand-font)'")
    expect(inlined).not.toContain('var(--font')
  })

  it('var() font with concrete fallback: raster inlining uses that fallback family', () => {
    const svg = renderMermaidSVG(SRC, { font: 'var(--brand-font, Georgia)', embedFontImport: false })
    const inlined = inlineFontVarForRaster(svg)
    expect(inlined).toContain('font-family: Georgia, system-ui, sans-serif; }')
  })

  it('font stack emits no @import and preserves the stack unquoted', () => {
    const svg = renderMermaidSVG(SRC, { font: STACK_FONT })
    expect(svg).not.toContain('fonts.googleapis.com')
    expect(svg).not.toContain('@import')
    expect(svg).toContain('font-family: var(--font, Inter, system-ui), system-ui, sans-serif; }')
    expect(svg).not.toContain("'Inter, system-ui'")
  })

  it('font stack: raster inlining preserves the stack', () => {
    const svg = renderMermaidSVG(SRC, { font: STACK_FONT, embedFontImport: false })
    const inlined = inlineFontVarForRaster(svg)
    expect(inlined).toContain('font-family: Inter, system-ui, system-ui, sans-serif; }')
  })

  it('explicit font-import opt-in includes the concrete mono face but not a var() family', () => {
    const svg = renderMermaidSVG('classDiagram\n  class A', { font: VAR_FONT, embedFontImport: true })
    expect(svg).toContain('family=JetBrains+Mono')
    expect(svg).not.toContain('family=var')
  })

  it('quoted family names render single-quoted, so the root style attribute stays whole', () => {
    // Mermaid's own default theme font is a double-quoted stack.
    const cases: Array<[string, Parameters<typeof renderMermaidSVG>[1]]> = [
      [SRC, { font: '"Open Sans", Arial' }],
      ['%%{init: {"themeVariables": {"fontFamily": "\\"trebuchet ms\\", verdana, arial, sans-serif"}}}%%\n' + SRC, {}],
      ['---\nconfig:\n  fontFamily: \'"Open Sans", Arial\'\n---\nclassDiagram\n  class A', {}],
    ]
    for (const [source, options] of cases) {
      const svg = renderMermaidSVG(source, options)
      const style = /^<svg [^>]*?style="([^"]*)"/.exec(svg)?.[1]
      expect(style).toMatch(/--font:'(?:Open Sans|trebuchet ms)', /)
      expect(svg).toMatch(/font-family: var\(--font, '(?:Open Sans|trebuchet ms)', [^)]*\), system-ui, sans-serif; \}/)
    }
    // Quotes that do not close or cannot be requoted, and whitespace XML or a
    // quoted CSS name cannot carry, stay refused.
    for (const font of ['"Open Sans, Arial', "Open Sans', Arial", `"O'Brien Sans", Arial`, `'a"b"c'`, "'Open\fSans', Arial", "'Open\nSans', Arial"]) {
      expect(() => renderMermaidSVG(SRC, { font })).toThrow(/safe, non-fetching CSS font family/)
    }
  })

  it('plain names use the exact @import URL when explicitly enabled', () => {
    const svg = renderMermaidSVG(SRC, { font: 'IBM Plex Sans', embedFontImport: true })
    expect(svg).toContain("@import url('https://fonts.googleapis.com/css2?family=IBM%20Plex%20Sans:wght@400;500;600;700&amp;display=swap');")
    expect(svg).toContain("font-family: var(--font, 'IBM Plex Sans'), system-ui, sans-serif; }")
    expect(inlineFontVarForRaster(svg)).toContain("font-family: 'IBM Plex Sans', system-ui, sans-serif; }")
  })
})
