import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { renderMermaidSVG } from '../index.ts'
import {
  type DiagramColors,
  buildStyleBlock,
  buildShadowDefs,
  svgOpenTag,
} from '../theme.ts'
import { BUILTIN_PALETTE_DEFINITIONS } from '../palette-catalog.ts'
import { diagramColorsToAsciiTheme } from '../ascii/ansi.ts'
import { getSeriesColor } from '../xychart/colors.ts'
import { resolveArchitectureVisualConfig } from '../architecture/config.ts'
import type { MermaidFrontmatterMap } from '../mermaid-source.ts'

const NUM_RUNS = 200

// ============================================================================
// Arbitrary generators
// ============================================================================

/** Generate a valid 6-digit hex color string like "#a3f0b2". */
const hexColorArb = fc
  .integer({ min: 0, max: 0xffffff })
  .map(n => '#' + n.toString(16).padStart(6, '0'))

/** Generate a DiagramColors object with required bg/fg and optional enrichment fields. */
const diagramColorsArb: fc.Arbitrary<DiagramColors> = fc.record({
  bg: hexColorArb,
  fg: hexColorArb,
  line: fc.option(hexColorArb, { nil: undefined }),
  accent: fc.option(hexColorArb, { nil: undefined }),
  muted: fc.option(hexColorArb, { nil: undefined }),
  surface: fc.option(hexColorArb, { nil: undefined }),
  border: fc.option(hexColorArb, { nil: undefined }),
  shadow: fc.option(fc.boolean(), { nil: undefined }),
})

// ============================================================================
// 1. All built-in themes produce valid output
// ============================================================================

describe('All built-in themes produce valid output', () => {
  for (const { inputName: name, colors: theme } of BUILTIN_PALETTE_DEFINITIONS) {
    it(`theme "${name}" produces SVG with --bg:, --fg:, and no NaN`, () => {
      const svg = renderMermaidSVG('graph TD\n  A-->B', theme)
      expect(svg).toContain('--bg:')
      expect(svg).toContain('--fg:')
      expect(svg).not.toContain('NaN')
    })
  }
})

// ============================================================================
// 2. diagramColorsToAsciiTheme always returns complete theme
// ============================================================================

describe('diagramColorsToAsciiTheme returns complete theme', () => {
  it('result has all required AsciiTheme keys with non-empty string values', () => {
    const requiredKeys = [
      'fg', 'bg', 'border', 'line', 'arrow', 'corner', 'junction',
    ] as const

    fc.assert(
      fc.property(diagramColorsArb, (colors) => {
        const theme = diagramColorsToAsciiTheme(colors)

        for (const key of requiredKeys) {
          const value = theme[key]
          expect(typeof value).toBe('string')
          expect((value as string).length).toBeGreaterThan(0)
        }

        // fg should match input fg
        expect(theme.fg).toBe(colors.fg)
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// ============================================================================
// 3. getSeriesColor always returns valid hex
// ============================================================================

describe('getSeriesColor returns valid hex', () => {
  it('returns a value matching /^#[0-9a-f]{6}$/i for any index, accent, and background', () => {
    const hexPattern = /^#[0-9a-f]{6}$/i

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        hexColorArb,
        hexColorArb,
        (index, accent, bg) => {
          const color = getSeriesColor(index, accent, bg)
          expect(color).toMatch(hexPattern)
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })
})

// ============================================================================
// 4. resolveArchitectureVisualConfig produces finite metrics
// ============================================================================

describe('resolveArchitectureVisualConfig produces finite metrics', () => {
  it('all numeric fields are finite, positive, and within sane bounds (1-1000)', () => {
    const fontSizeArb = fc.integer({ min: 1, max: 100 })
    const iconSizeArb = fc.integer({ min: 1, max: 100 })

    const frontmatterArb = fc.record({
      fontSize: fc.option(fontSizeArb, { nil: undefined }),
      iconSize: fc.option(iconSizeArb, { nil: undefined }),
    }).map(({ fontSize, iconSize }) => {
      const map: MermaidFrontmatterMap = {}
      if (fontSize !== undefined) {
        map['architecture'] = { fontSize, iconSize: iconSize ?? undefined }
      } else if (iconSize !== undefined) {
        map['architecture'] = { iconSize }
      }
      return map
    })

    fc.assert(
      fc.property(frontmatterArb, diagramColorsArb, (frontmatter, colors) => {
        const result = resolveArchitectureVisualConfig(frontmatter, colors)
        const v = result.visual

        const numericFields: number[] = [
          v.groupHeaderHeight,
          v.groupFontSize,
          v.groupFontWeight,
          v.serviceFontSize,
          v.serviceFontWeight,
          v.edgeFontSize,
          v.edgeFontWeight,
          v.iconSize,
          v.serviceIconSize,
          v.junctionOuterRadius,
          v.junctionInnerRadius,
        ]

        for (const value of numericFields) {
          expect(Number.isFinite(value)).toBe(true)
          expect(value).toBeGreaterThan(0)
          expect(value).toBeLessThanOrEqual(1000)
        }
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// ============================================================================
// 5. svgOpenTag produces valid opening tag
// ============================================================================

describe('svgOpenTag produces valid opening tag', () => {
  it('output starts with <svg, contains xmlns, viewBox, style=, and ends with >', () => {
    const dimensionArb = fc.integer({ min: 1, max: 5000 })

    fc.assert(
      fc.property(dimensionArb, dimensionArb, diagramColorsArb, (w, h, colors) => {
        const tag = svgOpenTag(w, h, colors)

        expect(tag.startsWith('<svg')).toBe(true)
        expect(tag).toContain('xmlns')
        expect(tag).toContain('viewBox')
        expect(tag).toContain('style=')
        expect(tag.endsWith('>')).toBe(true)

        // Must not be self-closing (no />)
        expect(tag.endsWith('/>')).toBe(false)
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// ============================================================================
// 6. buildStyleBlock contains all derived vars
// ============================================================================

describe('buildStyleBlock contains all derived vars', () => {
  it('output always includes --_arrow, --_line, --_text, --_node-fill, --_node-stroke', () => {
    const fontArb = fc.constantFrom('Inter', 'Roboto', 'Fira Sans', 'JetBrains Mono')
    const hasMonoArb = fc.boolean()
    const shadowArb = fc.option(fc.boolean(), { nil: undefined })

    fc.assert(
      fc.property(fontArb, hasMonoArb, shadowArb, (font, hasMono, shadow) => {
        const style = buildStyleBlock(font, hasMono, shadow ?? undefined)

        expect(style).toContain('--_arrow')
        expect(style).toContain('--_line')
        expect(style).toContain('--_text')
        expect(style).toContain('--_node-fill')
        expect(style).toContain('--_node-stroke')

        // Should be wrapped in <style> tags
        expect(style).toContain('<style>')
        expect(style).toContain('</style>')
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// ============================================================================
// 7. Shadow defs conditional
// ============================================================================

describe('buildShadowDefs conditional behavior', () => {
  it('returns empty string when shadow is false or undefined', () => {
    fc.assert(
      fc.property(diagramColorsArb, (colors) => {
        const noShadow = { ...colors, shadow: false }
        const undefinedShadow = { ...colors, shadow: undefined }

        expect(buildShadowDefs(noShadow)).toBe('')
        expect(buildShadowDefs(undefinedShadow)).toBe('')
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('contains <filter when shadow is true', () => {
    fc.assert(
      fc.property(diagramColorsArb, (colors) => {
        const withShadow = { ...colors, shadow: true }
        const result = buildShadowDefs(withShadow)

        expect(result).toContain('<filter')
      }),
      { numRuns: NUM_RUNS },
    )
  })
})
