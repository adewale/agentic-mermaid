// ============================================================================
// ASCII edge style tests — dotted and thick line rendering
// ============================================================================

import { describe, it, expect } from 'bun:test'
import { renderMermaidAscii } from '../ascii/index.ts'

describe('ASCII edge styles', () => {
  describe('solid edges (default)', () => {
    it('renders solid edges with ─ in unicode mode', () => {
      const result = renderMermaidAscii(`
        graph LR
          A --> B
      `)
      expect(result).toContain('─')
      expect(result).not.toContain('┄')
      expect(result).not.toContain('━')
    })

    it('renders solid edges with - in ascii mode', () => {
      const result = renderMermaidAscii(`
        graph LR
          A --> B
      `, { useAscii: true })
      expect(result).toContain('-')
    })
  })

  describe('dotted edges (-.->)', () => {
    it('renders dotted edges with ┄ in unicode mode', () => {
      const result = renderMermaidAscii(`
        graph LR
          A -.-> B
      `)
      // Should contain dotted horizontal line character
      expect(result).toContain('┄')
    })

    it('renders dotted edges with . in ascii mode', () => {
      const result = renderMermaidAscii(`
        graph LR
          A -.-> B
      `, { useAscii: true })
      // Should contain dots for dotted lines
      expect(result).toContain('.')
    })

    it('renders dotted vertical edges with ┆ in unicode mode', () => {
      const result = renderMermaidAscii(`
        graph TD
          A -.-> B
      `)
      // Should contain dotted vertical line character
      expect(result).toContain('┆')
    })

    it('renders dotted vertical edges with : in ascii mode', () => {
      const result = renderMermaidAscii(`
        graph TD
          A -.-> B
      `, { useAscii: true })
      // Should contain colons for dotted vertical lines
      expect(result).toContain(':')
    })

    it('renders dotted edges with labels', () => {
      const result = renderMermaidAscii(`
        graph LR
          A -.->|optional| B
      `)
      expect(result).toContain('┄')
      expect(result).toContain('optional')
    })
  })

  describe('thick edges (==>)', () => {
    it('renders thick edges with ━ in unicode mode', () => {
      const result = renderMermaidAscii(`
        graph LR
          A ==> B
      `)
      // Should contain thick horizontal line character
      expect(result).toContain('━')
    })

    it('renders thick edges with = in ascii mode', () => {
      const result = renderMermaidAscii(`
        graph LR
          A ==> B
      `, { useAscii: true })
      // Should contain equals for thick lines
      expect(result).toContain('=')
    })

    it('renders thick vertical edges with ┃ in unicode mode', () => {
      const result = renderMermaidAscii(`
        graph TD
          A ==> B
      `)
      // Should contain thick vertical line character
      expect(result).toContain('┃')
    })
  })

  describe('circle and cross endpoint markers', () => {
    it('renders --o and --x target markers while preserving target nodes', () => {
      const circle = renderMermaidAscii('graph LR\n  A --o B')
      expect(circle).toContain('◯')
      expect(circle).toContain('B')

      const cross = renderMermaidAscii('graph LR\n  A --x B')
      expect(cross).toContain('✕')
      expect(cross).toContain('B')
    })

    it('renders mixed endpoint markers in unicode and ascii modes', () => {
      const unicode = renderMermaidAscii('graph LR\n  A o--x B')
      expect(unicode).toContain('◯')
      expect(unicode).toContain('✕')

      const ascii = renderMermaidAscii('graph LR\n  A x--o B', { useAscii: true })
      expect(ascii).toContain('x')
      expect(ascii).toContain('o')
    })
  })

  describe('mixed edge styles', () => {
    it('renders different styles in the same diagram', () => {
      const result = renderMermaidAscii(`
        graph LR
          A --> B
          B -.-> C
          C ==> D
      `)
      // Should have all three line types
      expect(result).toContain('─')  // solid
      expect(result).toContain('┄')  // dotted
      expect(result).toContain('━')  // thick
    })

    it('renders mixed styles in ascii mode', () => {
      const result = renderMermaidAscii(`
        graph LR
          A --> B
          B -.-> C
          C ==> D
      `, { useAscii: true })
      // Note: ASCII mode uses - for solid, . for dotted, = for thick
      // We just check that the diagram renders without error
      expect(result).toContain('A')
      expect(result).toContain('B')
      expect(result).toContain('C')
      expect(result).toContain('D')
    })
  })
})
