/**
 * Theme switching tests — verify that when rendered with non-blue theme
 * colors, the SVG output contains the correct accent and no hardcoded
 * default blue hex values in the inline style.
 *
 * Background: the demo page originally patched CSS vars on existing SVGs
 * instead of re-rendering. CSS custom properties set on an SVG element's
 * inline style don't cascade into the SVG's embedded <style> block, so
 * derived vars like --_arrow retained stale values. The fix: re-render
 * SVGs with theme colors. These tests verify that re-rendering produces
 * correct output for every diagram type.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'

const TUFTE = { bg: '#FFFFF8', fg: '#111111', accent: '#7A0000', line: '#AAAAAA', muted: '#888888' }
const SALMON = { bg: '#FFFBF5', fg: '#521000', accent: '#FF4801', line: '#C9A88A', muted: '#85532E' }

// Default blue accent hex values — should never appear hardcoded in themed SVG output
const DEFAULT_BLUE_HEX = [/#3b82f6/i, /#58a6ff/i]

function assertNoHardcodedBlue(svg: string) {
  for (const pattern of DEFAULT_BLUE_HEX) {
    expect(svg).not.toMatch(pattern)
  }
}

describe('theme switching — accent propagation', () => {
  describe('flowchart', () => {
    const source = `graph TD
      A[Start] --> B{Decision}
      B -->|Yes| C[Done]`

    it('renders arrowheads with Tufte accent, not default blue', () => {
      const svg = renderMermaidSVG(source, TUFTE)
      expect(svg).toContain('#7A0000')
      assertNoHardcodedBlue(svg)
    })

    it('renders arrowheads with Salmon accent, not default blue', () => {
      const svg = renderMermaidSVG(source, SALMON)
      expect(svg).toContain('#FF4801')
      assertNoHardcodedBlue(svg)
    })
  })

  describe('architecture', () => {
    const source = `architecture-beta
      group app(cloud)[App]
      service api(server)[API] in app
      service db(database)[DB]
      api:R --> L:db`

    it('renders icons and arrows with Tufte accent', () => {
      const svg = renderMermaidSVG(source, TUFTE)
      expect(svg).toContain('--accent:#7A0000')
      expect(svg).toContain('class="architecture-icon-mark"')
      assertNoHardcodedBlue(svg)
    })

    it('renders icons and arrows with Salmon accent', () => {
      const svg = renderMermaidSVG(source, SALMON)
      expect(svg).toContain('--accent:#FF4801')
      assertNoHardcodedBlue(svg)
    })
  })

  describe('sequence', () => {
    const source = `sequenceDiagram
      Alice->>Bob: Hello
      Bob-->>Alice: Hi`

    it('renders with Tufte accent, not default blue', () => {
      const svg = renderMermaidSVG(source, TUFTE)
      expect(svg).toContain('--accent:#7A0000')
      assertNoHardcodedBlue(svg)
    })
  })

  describe('class diagram', () => {
    const source = `classDiagram
      Animal <|-- Dog
      Animal : +name string`

    it('renders with Tufte accent, not default blue', () => {
      const svg = renderMermaidSVG(source, TUFTE)
      expect(svg).toContain('--accent:#7A0000')
      assertNoHardcodedBlue(svg)
    })
  })

  describe('ER diagram', () => {
    const source = `erDiagram
      CUSTOMER ||--o{ ORDER : places`

    it('renders with Tufte accent, not default blue', () => {
      const svg = renderMermaidSVG(source, TUFTE)
      expect(svg).toContain('--accent:#7A0000')
      assertNoHardcodedBlue(svg)
    })
  })

  describe('journey', () => {
    const source = `journey
      title Test
      section Work
      Task: 5: Me`

    it('renders score markers with Tufte accent, not default blue', () => {
      const svg = renderMermaidSVG(source, TUFTE)
      expect(svg).toContain('--accent:#7A0000')
      expect(svg).toContain('class="journey-score-marker"')
      assertNoHardcodedBlue(svg)
    })

    it('renders score markers with Salmon accent, not default blue', () => {
      const svg = renderMermaidSVG(source, SALMON)
      expect(svg).toContain('--accent:#FF4801')
      assertNoHardcodedBlue(svg)
    })
  })

  describe('timeline', () => {
    const source = `timeline
      title Test
      2024 : Alpha`

    it('renders markers with Tufte accent, not default blue', () => {
      const svg = renderMermaidSVG(source, TUFTE)
      expect(svg).toContain('--accent:#7A0000')
      assertNoHardcodedBlue(svg)
    })
  })

  describe('xychart', () => {
    const source = `xychart
      x-axis [A, B, C]
      bar [10, 20, 30]`

    it('renders bars with Tufte accent, not default blue', () => {
      const svg = renderMermaidSVG(source, TUFTE)
      expect(svg).toContain('#7A0000')
      assertNoHardcodedBlue(svg)
    })
  })
})
