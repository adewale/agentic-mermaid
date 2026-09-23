// Loop 10 M2 (#116): auto-contrast node text on custom fills.
//
// NOTE: this feature was already implemented (contrastTextColor + nodeTextColor
// in renderer.ts) before Loop 10 — the Loop 10 verification pass initially
// missed it (checked theme.ts's isColorDark, not renderer.ts's
// contrastTextColor). This file adds the regression coverage that was missing
// so the behavior can't silently regress.

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { contrastTextColor } from '../color-resolver.ts'
import { renderMermaidSVG } from '../index.ts'
import { wcagContrastRatio } from '../shared/color-math.ts'

function firstTextFill(svg: string): string | undefined {
  return svg.match(/<text[^>]*fill="([^"]+)"/)?.[1]
}

describe('#116 auto-contrast node text on custom fills', () => {
  test('dark fill → white text', () => {
    const svg = renderMermaidSVG('flowchart TD\n  A\n  style A fill:#000000')
    expect(firstTextFill(svg)).toBe('#FFFFFF')
  })

  test('light fill → black text', () => {
    const svg = renderMermaidSVG('flowchart TD\n  A\n  style A fill:#ffffff')
    expect(firstTextFill(svg)).toBe('#000000')
  })

  test('no custom fill → theme default (not forced black/white)', () => {
    const svg = renderMermaidSVG('flowchart TD\n  A')
    const fill = firstTextFill(svg)
    expect(fill).not.toBe('#FFFFFF')
    expect(fill).not.toBe('#000000')
  })

  test('mid-tone fill resolves to a contrasting color', () => {
    const darkBlue = renderMermaidSVG('flowchart TD\n  A\n  style A fill:#1a2b4c')
    expect(firstTextFill(darkBlue)).toBe('#FFFFFF')
    const paleYellow = renderMermaidSVG('flowchart TD\n  A\n  style A fill:#fff8b0')
    expect(firstTextFill(paleYellow)).toBe('#000000')
  })

  test('explicit color: overrides auto-contrast', () => {
    const svg = renderMermaidSVG('flowchart TD\n  A\n  style A fill:#000000,color:#ff0000')
    expect(firstTextFill(svg)).toBe('#ff0000')
  })

  test('classDef fill drives contrast the same as inline style', () => {
    const svg = renderMermaidSVG('flowchart TD\n  A\n  classDef dark fill:#101010\n  class A dark')
    expect(firstTextFill(svg)).toBe('#FFFFFF')
  })

  // Loop 12 M4: `style A fill:rgb(10,10,10)` now works — the style parser
  // splits on top-level commas only, so rgb()/rgba()/hsl() survive intact
  // and drive contrast end-to-end.
  test('rgb() fill drives contrast (Loop 12 M4 fix)', () => {
    const svg = renderMermaidSVG('flowchart TD\n A\n style A fill:rgb(10,10,10)')
    expect(firstTextFill(svg)).toBe('#FFFFFF')
  })
})

// Auto ink is the better of black and white, which clears WCAG AA (4.5:1) on
// every opaque fill. A brightness cut-off picked white on mid-tone fills such
// as #3b82f6 (3.68:1) and #10b981 (2.54:1).
describe('auto-contrast ink contract', () => {
  const hexArb = fc.integer({ min: 0, max: 0xffffff }).map(value => `#${value.toString(16).padStart(6, '0')}`)

  test('picks the higher-contrast ink, at least 4.5:1, for any opaque fill', () => {
    fc.assert(fc.property(hexArb, fill => {
      const ink = contrastTextColor(fill)!
      const other = ink === '#000000' ? '#FFFFFF' : '#000000'
      expect(wcagContrastRatio(ink, fill)!).toBeGreaterThanOrEqual(Math.max(4.5, wcagContrastRatio(other, fill)!))
    }), { numRuns: 2000 })
  })

  test('node text on a custom fill clears WCAG AA end to end', () => {
    fc.assert(fc.property(hexArb, fill => {
      const svg = renderMermaidSVG(`flowchart TD\n  A\n  style A fill:${fill}`)
      expect(wcagContrastRatio(firstTextFill(svg)!, fill)!).toBeGreaterThanOrEqual(4.5)
    }), { numRuns: 60 })
  })
})
