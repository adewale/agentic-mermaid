// Loop 10 M2 (#116): auto-contrast node text on custom fills.
//
// NOTE: this feature was already implemented (contrastTextColor + nodeTextColor
// in renderer.ts) before Loop 10 — the Loop 10 verification pass initially
// missed it (checked theme.ts's isColorDark, not renderer.ts's
// contrastTextColor). This file adds the regression coverage that was missing
// so the behavior can't silently regress.

import { describe, test, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'

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

  // NOTE: `style A fill:rgb(10,10,10)` does NOT currently work — the `style`
  // statement parser splits on commas, mangling `rgb(10,10,10)` into
  // `rgb(10`. This is a style-parser bug (separate from contrast, which
  // handles valid rgb() via parseRgbFunction). Tracked as a Loop 11 candidate
  // in DIVERGENCES.md. Hex fills are the supported path for now.
})
