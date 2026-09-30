/**
 * Tests for styles module — text measurement and constants.
 * Theme resolution tests are in theme.test.ts (CSS custom property system).
 */
import { describe, it, expect } from 'bun:test'
import { estimateTextWidth, FONT_SIZES, FONT_WEIGHTS, NODE_PADDING, STROKE_WIDTHS, ARROW_HEAD } from '../styles.ts'
import { measureTextWidth } from '../text-metrics.ts'
import { DEFAULTS, fromShikiTheme, buildStyleBlock, svgOpenTag } from '../theme.ts'
import type { DiagramColors } from '../theme.ts'
import { BUILTIN_PALETTE_DEFINITIONS } from '../palette-catalog.ts'

// ============================================================================
// Theme system (CSS custom properties)
// ============================================================================

describe('built-in palette catalog', () => {
  it('contains well-known theme palettes with valid colors', () => {
    for (const name of ['zinc-light', 'zinc-dark', 'tokyo-night', 'catppuccin-mocha', 'nord'] as const) {
      const theme = BUILTIN_PALETTE_DEFINITIONS.find(palette => palette.inputName === name)!.colors
      expect(theme.bg).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(theme.fg).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('each theme has valid bg and fg colors', () => {
    for (const { colors } of BUILTIN_PALETTE_DEFINITIONS) {
      expect(colors.bg).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(colors.fg).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })
})

describe('DEFAULTS', () => {
  it('provides zinc-light bg/fg', () => {
    expect(DEFAULTS.bg).toBe('#FFFFFF')
    expect(DEFAULTS.fg).toBe('#27272A')
  })
})

describe('svgOpenTag', () => {
  it('sets --bg and --fg CSS variables in inline style', () => {
    const tag = svgOpenTag(400, 300, { bg: '#1a1b26', fg: '#a9b1d6' })
    expect(tag).toContain('--bg:#1a1b26')
    expect(tag).toContain('--fg:#a9b1d6')
    expect(tag).toContain('background:var(--bg)')
  })

  it('includes optional enrichment variables when provided', () => {
    const colors: DiagramColors = {
      bg: '#1a1b26', fg: '#a9b1d6',
      line: '#3d59a1', accent: '#7aa2f7',
    }
    const tag = svgOpenTag(400, 300, colors)
    expect(tag).toContain('--line:#3d59a1')
    expect(tag).toContain('--accent:#7aa2f7')
  })

  it('omits unset enrichment variables', () => {
    const tag = svgOpenTag(400, 300, { bg: '#fff', fg: '#000' })
    expect(tag).not.toContain('--line')
    expect(tag).not.toContain('--accent')
    expect(tag).not.toContain('--muted')
  })

  it('adds extra root attributes when requested', () => {
    const tag = svgOpenTag(400, 300, { bg: '#fff', fg: '#000' }, false, {
      role: 'img',
      'aria-labelledby': 'bm-a11y-title',
    })

    expect(tag).toContain('role="img"')
    expect(tag).toContain('aria-labelledby="bm-a11y-title"')
  })
})

describe('buildStyleBlock', () => {
  it('includes derived CSS variable declarations', () => {
    const style = buildStyleBlock('Inter', false)
    expect(style).toContain('--_text')
    expect(style).toContain('--_line')
    expect(style).toContain('--_arrow')
    expect(style).toContain('--_node-fill')
    expect(style).toContain('--_node-stroke')
  })

  it('includes mono font class when requested', () => {
    const withMono = buildStyleBlock('Inter', true)
    expect(withMono).toContain('.mono')
    expect(withMono).toContain('JetBrains Mono')

    const withoutMono = buildStyleBlock('Inter', false)
    expect(withoutMono).not.toContain('.mono')
  })
})

describe('fromShikiTheme', () => {
  it('extracts bg/fg from editor colors', () => {
    const colors = fromShikiTheme({
      type: 'dark',
      colors: {
        'editor.background': '#1a1b26',
        'editor.foreground': '#a9b1d6',
      },
    })
    expect(colors.bg).toBe('#1a1b26')
    expect(colors.fg).toBe('#a9b1d6')
  })

  it('falls back for missing editor colors', () => {
    const dark = fromShikiTheme({ type: 'dark' })
    expect(dark.bg).toBe('#1e1e1e')
    expect(dark.fg).toBe('#d4d4d4')

    const light = fromShikiTheme({ type: 'light' })
    expect(light.bg).toBe('#ffffff')
    expect(light.fg).toBe('#333333')
  })
})

// ============================================================================
// Text width estimation
// ============================================================================

// Width behaviour (length, size, weight, empty-text padding) is owned and
// tested by measureTextWidth in text-metrics.test.ts; this only pins the
// delegation, so the two cannot drift apart.
describe('estimateTextWidth', () => {
  it('delegates to measureTextWidth for every script and weight', () => {
    for (const [text, size, weight] of [['', 13, 500], ['Hello', 13, 500], ['Hello World', 11, 400], ['漢字 😀 Ω', 16, 600]] as const) {
      expect({ text, width: estimateTextWidth(text, size, weight) }).toEqual({ text, width: measureTextWidth(text, size, weight) })
    }
  })
})

// ============================================================================
// Exported constants
// ============================================================================

describe('constants', () => {
  it('FONT_SIZES has expected values', () => {
    expect(FONT_SIZES.nodeLabel).toBe(13)
    expect(FONT_SIZES.edgeLabel).toBe(11)
    expect(FONT_SIZES.groupHeader).toBe(12)
  })

  it('FONT_WEIGHTS has expected values', () => {
    expect(FONT_WEIGHTS.nodeLabel).toBe(500)
    expect(FONT_WEIGHTS.edgeLabel).toBe(400)
    expect(FONT_WEIGHTS.groupHeader).toBe(600)
  })

  it('NODE_PADDING has expected values', () => {
    expect(NODE_PADDING.horizontal).toBe(20)
    expect(NODE_PADDING.vertical).toBe(10)
    expect(NODE_PADDING.diamondExtra).toBe(24)
  })

  it('STROKE_WIDTHS has expected values', () => {
    expect(STROKE_WIDTHS.outerBox).toBe(1)
    expect(STROKE_WIDTHS.innerBox).toBe(0.75)
    expect(STROKE_WIDTHS.connector).toBe(1)
  })

  it('ARROW_HEAD has expected values', () => {
    expect(ARROW_HEAD.width).toBe(8)
    expect(ARROW_HEAD.height).toBe(5)
  })
})
