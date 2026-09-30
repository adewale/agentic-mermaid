/**
 * Theme switching tests — verify that when rendered with non-blue theme
 * colors, the accent actually paints the family's accent marks and no
 * hardcoded default blue survives, in the markup or in the pixels.
 *
 * Background: the demo page originally patched CSS vars on existing SVGs
 * instead of re-rendering. CSS custom properties set on an SVG element's
 * inline style don't cascade into the SVG's embedded <style> block, so
 * derived vars like --_arrow retained stale values. The fix: re-render
 * SVGs with theme colors. These tests verify that re-rendering produces
 * correct output for every diagram type.
 *
 * The oracle is the rasterized output (resvg): the root `--accent:` variable
 * always echoes the option, so finding the accent hex in the markup proves
 * nothing about the marks that should use it.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { bluePixel, colorPixelCount, hexPixel } from './helpers/raster.ts'

const THEMES = {
  Tufte: { bg: '#FFFFF8', fg: '#111111', accent: '#7A0000', line: '#AAAAAA', muted: '#888888' },
  Salmon: { bg: '#FFFBF5', fg: '#521000', accent: '#FF4801', line: '#C9A88A', muted: '#85532E' },
} as const

// Default blue accent hex values — should never appear hardcoded in themed SVG output
const DEFAULT_BLUE_HEX = [/#3b82f6/i, /#58a6ff/i]

function assertNoDefaultBlue(svg: string) {
  for (const pattern of DEFAULT_BLUE_HEX) {
    expect(svg).not.toMatch(pattern)
  }
  expect(colorPixelCount(svg, bluePixel)).toBe(0)
}

// [family, accent marks, source, minimum accent pixels]. The minimums sit well
// below today's counts (flowchart ~29, sequence ~28, class ~25, architecture
// ~103, timeline ~86, journey ~542) and far above zero, the count when the
// marks keep a stale or hardcoded color.
const ACCENT_CASES = [
  ['flowchart', 'arrowheads', `graph TD
      A[Start] --> B{Decision}
      B -->|Yes| C[Done]`, 12],
  ['architecture', 'icons and arrows', `architecture-beta
      group app(cloud)[App]
      service api(server)[API] in app
      service db(database)[DB]
      api:R --> L:db`, 24],
  ['sequence', 'arrowheads', `sequenceDiagram
      Alice->>Bob: Hello
      Bob-->>Alice: Hi`, 12],
  ['class', 'inheritance arrowhead', `classDiagram
      Animal <|-- Dog
      Animal : +name string`, 6],
  ['journey', 'score markers', `journey
      title Test
      section Work
      Task: 5: Me`, 100],
  ['timeline', 'period markers', `timeline
      title Test
      2024 : Alpha`, 24],
  ['xychart', 'bars', `xychart
      x-axis [A, B, C]
      bar [10, 20, 30]`, 1000],
] as const

describe('theme switching — accent propagation', () => {
  for (const [themeName, theme] of Object.entries(THEMES)) {
    it.each(ACCENT_CASES)(`%s: paints its %s in the ${themeName} accent, never default blue`, (_family, _marks, source, minAccentPixels) => {
      const svg = renderMermaidSVG(source, { ...theme, embedFontImport: false })
      expect(colorPixelCount(svg, hexPixel(theme.accent))).toBeGreaterThanOrEqual(minAccentPixels)
      assertNoDefaultBlue(svg)
    })
  }

  // ER draws nothing in the accent, so only the negative half applies.
  it('ER diagram: does not emit default blue under the Tufte theme', () => {
    const svg = renderMermaidSVG(`erDiagram
      CUSTOMER ||--o{ ORDER : places`, { ...THEMES.Tufte, embedFontImport: false })
    assertNoDefaultBlue(svg)
  })
})
