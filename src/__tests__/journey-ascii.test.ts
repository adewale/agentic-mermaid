/**
 * Tests for journey ASCII rendering.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidASCII } from '../ascii/index.ts'
import { visualWidth } from '../ascii/width.ts'

function render(text: string, options: Parameters<typeof renderMermaidASCII>[1] = {}): string {
  return renderMermaidASCII(text, { colorMode: 'none', ...options })
}

describe('journey ASCII', () => {
  it('renders a basic journey with title, section, score, and actors', () => {
    const result = render(`journey
      title My working day
      section Go to work
      Make tea: 5: Me`)

    expect(result).toContain('My working day')
    expect(result).toContain('[Go to work]')
    expect(result).toContain('●●●●● Make tea')
    expect(result).toContain('by Me')
  })

  it('renders multiple actors', () => {
    const result = render(`journey
      section Work
      Ship feature: 4: Me, QA`)

    expect(result).toContain('●●●●○ Ship feature')
    expect(result).toContain('by Me, QA')
  })

  it('supports journey routing through frontmatter and Mermaid init directives', () => {
    const result = render(`---
      title: Journey sample
      config:
        theme: dark
      ---
      %%{init: {'theme': 'base'}}%%
      journey
      section Work
      Deep work: 3: Me`)

    expect(result).toContain('[Work]')
    expect(result).toContain('●●●○○ Deep work')
  })

  it('uses ASCII-safe glyphs in ASCII mode', () => {
    const result = render(`journey
      section Work
      Deep work: 3: Me`, { useAscii: true })

    expect(result).toContain('###.. Deep work')
    expect(result).not.toContain('●')
    expect(result).not.toContain('○')
  })

  it('renders multiline task text on subsequent indented lines', () => {
    const result = render(`journey
      section Work
      Make<br>tea: 5: Me`)

    expect(result).toContain('Make')
    expect(result).toContain('tea')
  })

  it('keeps FE0F variation-selector emoji lines within maxWidth', () => {
    const result = render(`journey
      section Feels
      ${'❤️'.repeat(9)}: 2: Me`, { maxWidth: 12 })

    expect(result).toContain('❤️')
    for (const line of result.split('\n')) {
      expect(visualWidth(line)).toBeLessThanOrEqual(12)
    }
  })

  it('never splits ZWJ emoji sequences when breaking words', () => {
    const result = render(`journey
      section Team
      ${'👩‍🔬'.repeat(6)}: 3: Me`, { maxWidth: 9 })

    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    for (const line of result.split('\n')) {
      expect(visualWidth(line)).toBeLessThanOrEqual(9)
      for (const { segment } of segmenter.segment(line)) {
        if (segment.includes('👩') || segment.includes('🔬')) {
          expect(segment).toBe('👩‍🔬')
        }
      }
    }
  })

  it('hyphenates broken Latin words but not CJK breaks', () => {
    const latin = render(`journey
      section Work
      Internationalization: 3: Me`, { maxWidth: 14 })
    expect(latin).toContain('-')

    const cjk = render(`journey
      section Work
      国際化対応チーム作業: 3: Me`, { maxWidth: 12 })
    expect(cjk).not.toContain('-')
  })

  it('brackets only the first line of a wrapped section label', () => {
    const result = render(`journey
      section Customer onboarding
      Sign up: 3: Me`, { maxWidth: 12 })

    expect(result).toContain('[Customer')
    expect(result).toContain(' onboarding]')
    expect(result).not.toContain('[Customer]')
    expect(result).not.toContain('[onboarding]')
  })

  it('renders a score trajectory strip between title and first section', () => {
    const source = `journey
      title Day
      section Morning
      Wake: 5: Me
      Commute: 3: Me
      Email: 1: Me
      section Afternoon
      Ship: 5: Me
      Retro: 3: Me`

    const unicode = render(source)
    expect(unicode).toContain('scores: █▄▁ █▄')
    expect(unicode.indexOf('scores:')).toBeGreaterThan(unicode.indexOf('Day'))
    expect(unicode.indexOf('scores:')).toBeLessThan(unicode.indexOf('[Morning]'))

    const ascii = render(source, { useAscii: true })
    expect(ascii).toContain('scores: 531 53')
  })

  it('chunks the score strip to maxWidth with indented continuations', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => `T${i}: ${(i % 5) + 1}: Me`).join('\n      ')
    const result = render(`journey
      section S
      ${tasks}`, { maxWidth: 14, useAscii: true })

    const lines = result.split('\n')
    const stripStart = lines.findIndex(line => line.startsWith('scores: '))
    expect(stripStart).toBeGreaterThanOrEqual(0)
    expect(lines[stripStart + 1]!.startsWith(' '.repeat('scores: '.length))).toBe(true)
    for (const line of lines) {
      expect(visualWidth(line)).toBeLessThanOrEqual(14)
    }
  })

  it('wraps long Journey task and actor labels by terminal display width', () => {
    const result = render(`journey
      section サポート
      国際化🙂担当チームがレビューする長いタスク名: 4: 国際化🙂担当チーム, レビュー担当`, { maxWidth: 32 })

    expect(result).toContain('国際化')
    expect(result).toContain('🙂')
    for (const line of result.split('\n')) {
      expect(visualWidth(line)).toBeLessThanOrEqual(32)
    }
  })

  it('supports themed HTML output and escapes labels safely', () => {
    const result = render(`journey
      title Roadmap < 2025
      section Phase <1>
      Ship <alpha>: 3: Me, QA <Lead>`, {
      colorMode: 'html',
      theme: {
        fg: '#101010',
        border: '#202020',
        line: '#303030',
        arrow: '#404040',
        junction: '#505050',
        corner: '#606060',
      },
    })

    expect(result).toContain('<span style="color:#101010">Roadmap</span>')
    expect(result).toContain('<span style="color:#101010">&lt;</span>')
    expect(result).toContain('<span style="color:#202020">[</span>')
    expect(result).toContain('<span style="color:#101010">Phase</span>')
    expect(result).toContain('<span style="color:#202020">]</span>')
    expect(result).toContain('<span style="color:#404040">●●●</span>')
    expect(result).toContain('<span style="color:#202020">○○</span>')
    expect(result).toContain('<span style="color:#202020">by</span>')
    expect(result).toContain('<span style="color:#101010">&lt;Lead&gt;</span>')
    expect(result).not.toContain('QA <Lead>')
  })
})
