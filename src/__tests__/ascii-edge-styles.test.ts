// ============================================================================
// ASCII edge style tests — dotted and thick line rendering
// ============================================================================

import { describe, it, expect } from 'bun:test'
import fc from 'fast-check'
import { renderMermaidAscii } from '../ascii/index.ts'

function rowContaining(rendered: string, ...tokens: string[]): string {
  const row = rendered.split('\n').find(line => tokens.every(token => line.includes(token)))
  expect(row).toBeDefined()
  return row!
}

describe('ASCII edge styles', () => {
  describe('connector-row visual contracts', () => {
    it('places each LR line style on the actual connector row in unicode mode', () => {
      const cases = [
        ['graph LR\n  A --> B', '├────►'],
        ['graph LR\n  A -.-> B', '├┄┄┄┄►'],
        ['graph LR\n  A ==> B', '├━━━━►'],
      ] as const

      for (const [source, connector] of cases) {
        const row = rowContaining(renderMermaidAscii(source), 'A', 'B')
        expect(row).toContain(connector)
      }
    })

    it('places each LR line style on the actual connector row in ascii mode', () => {
      const cases = [
        ['graph LR\n  A --> B', '|---->'],
        ['graph LR\n  A -.-> B', '|....>'],
        ['graph LR\n  A ==> B', '|====>'],
      ] as const

      for (const [source, connector] of cases) {
        const row = rowContaining(renderMermaidAscii(source, { useAscii: true }), 'A', 'B')
        expect(row).toContain(connector)
      }
    })

    it('keeps bidirectional endpoint markers on the connector row in direction order', () => {
      const row = rowContaining(renderMermaidAscii('graph LR\n  A o--x B'), 'A', 'B')
      expect(row).toContain('◯────✕')
      expect(row.indexOf('◯')).toBeLessThan(row.indexOf('✕'))
    })

    // Property: for ANY single LR edge with random labels, the chosen line style
    // renders its own glyph and never leaks another style's dashed/thick glyph
    // (the solid glyph aliases box borders, so it is only asserted present). Holds
    // in both unicode and ascii modes.
    it('renders the chosen LR line-style glyph without leaking another style (property)', () => {
      const GLYPH = {
        unicode: { solid: '─', dotted: '┄', thick: '━' },
        ascii: { solid: '-', dotted: '.', thick: '=' },
      } as const
      const OP = { solid: '-->', dotted: '-.->', thick: '==>' } as const
      const labelArb = fc.array(fc.constantFrom(...'abcXYZ012'.split('')), { minLength: 1, maxLength: 5 })
        .map(cs => cs.join('') || 'N')
      fc.assert(
        fc.property(
          labelArb, labelArb,
          fc.constantFrom('solid', 'dotted', 'thick'),
          fc.boolean(),
          (a, b, style, ascii) => {
            if (a === b) return true
            const out = renderMermaidAscii(`graph LR\n  ${a} ${OP[style]} ${b}`, ascii ? { useAscii: true } : undefined)
            const glyph = ascii ? GLYPH.ascii : GLYPH.unicode
            if (!out.includes(glyph[style])) return false
            // No OTHER style's special (dashed/thick) glyph leaks in.
            for (const other of ['dotted', 'thick'] as const) {
              if (other !== style && out.includes(glyph[other])) return false
            }
            return true
          },
        ),
        { numRuns: 500 },
      )
    })
  })

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

  describe('all circle/cross operator forms (Loop 7 A2 — mk668a#110)', () => {
    // Regression coverage for every mermaid circle/cross arrow operator form.
    // The upstream change (mk668a#110) added recognition; these tests pin
    // the rendered output for each operator so silent regressions surface.
    // Note: `o--` and `x--` (one-sided, no head) are not standalone edge
    // operators in Mermaid — they need a head/marker on the other side.
    // The supported forms below are the ones we render markers for.
    const forms: Array<[string, string[]]> = [
      ['--o', ['◯']],
      ['o--o', ['◯']],
      ['--x', ['✕']],
      ['x--x', ['✕']],
      ['o--x', ['◯', '✕']],
      ['x--o', ['✕', '◯']],
    ]

    for (const [op, expectedMarkers] of forms) {
      it(`renders A ${op} B with correct markers`, () => {
        const result = renderMermaidAscii(`graph LR\n  A ${op} B`)
        for (const m of expectedMarkers) {
          expect(result).toContain(m)
        }
        // Source / target labels must still appear.
        expect(result).toContain('A')
        expect(result).toContain('B')
      })
    }

    it('renders both endpoints for o--x in unicode mode', () => {
      const result = renderMermaidAscii('graph LR\n  A o--x B')
      const lines = result.split('\n')
      // Find the edge line — the row with one of the markers.
      const edgeRow = lines.find(l => l.includes('◯') || l.includes('✕'))!
      expect(edgeRow).toBeDefined()
      expect(edgeRow).toContain('◯')
      expect(edgeRow).toContain('✕')
      // The circle should be to the LEFT of the cross (A→B direction).
      expect(edgeRow.indexOf('◯')).toBeLessThan(edgeRow.indexOf('✕'))
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
