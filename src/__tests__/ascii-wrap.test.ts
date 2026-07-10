/**
 * Tests for the shared width-aware wrap module (src/ascii/wrap.ts).
 *
 * Wrapping must honor the terminal width contract for grapheme clusters:
 * FE0F emoji measure 2 cells (not the per-codepoint 1), ZWJ sequences are
 * never split mid-grapheme, and mid-word breaks follow the SVG layout's
 * hyphenation convention (hyphen at alphabetic breaks, none between
 * double-width CJK/fullwidth clusters).
 */
import { describe, it, expect } from 'bun:test'
import { breakWord, graphemes, wrapParagraph, wrapText } from '../ascii/wrap.ts'
import { visualWidth } from '../ascii/width.ts'

describe('graphemes', () => {
  it('keeps ZWJ sequences and FE0F emoji as single clusters', () => {
    expect(graphemes('👩‍🔬❤️a')).toEqual(['👩‍🔬', '❤️', 'a'])
  })
})

describe('breakWord', () => {
  it('measures FE0F emoji at display width so chunks respect maxWidth', () => {
    const lines = breakWord('❤️'.repeat(9), 6)
    expect(lines).toEqual(['❤️❤️❤️', '❤️❤️❤️', '❤️❤️❤️'])
    for (const line of lines) {
      expect(visualWidth(line)).toBeLessThanOrEqual(6)
    }
  })

  it('never splits ZWJ sequences mid-grapheme', () => {
    const lines = breakWord('👩‍🔬'.repeat(6), 3)
    expect(lines).toEqual(Array(6).fill('👩‍🔬'))
    expect(lines.join('')).toBe('👩‍🔬'.repeat(6))
  })

  it('hyphenates alphabetic breaks and reserves a cell for the hyphen', () => {
    const lines = breakWord('internationalization', 8)
    expect(lines).toEqual(['interna-', 'tionali-', 'zation'])
    for (const line of lines) {
      expect(visualWidth(line)).toBeLessThanOrEqual(8)
    }
  })

  it('breaks between CJK characters without a trailing hyphen', () => {
    const lines = breakWord('国際化対応チーム', 6)
    expect(lines).toEqual(['国際化', '対応チ', 'ーム'])
    expect(lines.join('')).not.toContain('-')
  })

  it('suppresses the hyphen when it cannot fit', () => {
    expect(breakWord('ab', 1)).toEqual(['a', 'b'])
  })

  it('supports hyphenation-free chunking for glyph strips', () => {
    expect(breakWord('abcdef', 3, { hyphenate: false })).toEqual(['abc', 'def'])
  })
})

describe('wrapParagraph', () => {
  it('wraps at word boundaries by display width', () => {
    expect(wrapParagraph('hello world foo', 11)).toEqual(['hello world', 'foo'])
  })

  it('keeps every line within maxWidth for mixed-width text', () => {
    const lines = wrapParagraph('国際化🙂担当 review team', 8)
    for (const line of lines) {
      expect(visualWidth(line)).toBeLessThanOrEqual(8)
    }
    expect(lines).toContain('review')
  })
})

describe('wrapText', () => {
  it('splits on newlines only when maxWidth is unset', () => {
    expect(wrapText('one two\nthree', undefined)).toEqual(['one two', 'three'])
  })

  it('honors newlines as hard breaks while wrapping', () => {
    expect(wrapText('alpha beta\ngamma', 5)).toEqual(['alpha', 'beta', 'gamma'])
  })
})
