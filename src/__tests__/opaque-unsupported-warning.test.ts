// Systemic silent-opaque signal: a non-empty opaque body means the structured
// parser met syntax it does not model and preserved the diagram verbatim, so
// the `as*` narrower returns null and typed mutation is unavailable. Before
// this, only flowchart and quadrant announced that; the other ten families
// fell opaque silently. verify.ts now emits a generic UNSUPPORTED_SYNTAX
// (`<family>_opaque`) for any non-empty opaque body that isn't already flagged
// by a more specific warning.

import { describe, test, expect } from 'bun:test'
import { parseMermaid, verifyMermaid } from '../agent/index.ts'
import { WARNING_TIER, WARNING_SEVERITY } from '../agent/types.ts'

// Each source is valid-enough to parse but uses a construct the structured
// parser does not model, so it lands on the opaque path.
const OPAQUE_BY_FAMILY: Record<string, string> = {
  class: 'classDiagram\n  class Box~T~\n  Box~T~ <|-- IntBox', // generics
  // Notes/pseudostates were promoted to structured (repo #118); `--`
  // concurrency regions render but keep the honest opaque agent body.
  state: 'stateDiagram-v2\n  state P {\n    a --> b\n    --\n    c --> d\n  }',
  er: 'erDiagram\n  CUSTOMER["The Customer"] ||--o{ ORDER : places', // quoted alias
  xychart: 'xychart-beta\n  accTitle: forces opaque\n  bar [1, 2, 3]', // accTitle directive
  pie: 'pie\n  Dogs : 40\n  Cats : 30', // unquoted labels (Mermaid requires quotes)
}

describe('opaque bodies announce UNSUPPORTED_SYNTAX instead of falling silent', () => {
  for (const [family, source] of Object.entries(OPAQUE_BY_FAMILY)) {
    test(`${family}: unmodeled syntax → opaque body carries a <family>_opaque warning`, () => {
      const p = parseMermaid(source)
      expect(p.ok).toBe(true)
      if (!p.ok) return
      expect(p.value.body.kind).toBe('opaque')
      const v = verifyMermaid(p.value)
      const unsupported = v.warnings.filter(w => w.code === 'UNSUPPORTED_SYNTAX')
      expect(unsupported.length).toBeGreaterThanOrEqual(1)
      expect(unsupported.some(w => 'syntax' in w && w.syntax === `${family}_opaque`)).toBe(true)
    })
  }

  test('it is a lint that never flips verify.ok', () => {
    expect(WARNING_TIER.UNSUPPORTED_SYNTAX).toBe('lint')
    expect(WARNING_SEVERITY.UNSUPPORTED_SYNTAX).toBe('warning')
    const p = parseMermaid(OPAQUE_BY_FAMILY.class!)
    expect(p.ok && verifyMermaid(p.value).ok).toBe(true)
  })

  test('a structured (non-opaque) body carries no _opaque warning', () => {
    const p = parseMermaid('classDiagram\n  class A\n  class B\n  A <|-- B')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.value.body.kind).toBe('class')
    const opaqueFlags = verifyMermaid(p.value).warnings.filter(
      w => w.code === 'UNSUPPORTED_SYNTAX' && 'syntax' in w && w.syntax.endsWith('_opaque'),
    )
    expect(opaqueFlags).toEqual([])
  })

  test('flowchart and quadrant keep their SPECIFIC warning (no generic double-flag)', () => {
    // Flowchart interaction directive → flowchart_interaction_directive, not
    // flowchart_opaque.
    const flow = parseMermaid('flowchart TD\n  A --> B\n  click A "https://x" _blank')
    expect(flow.ok).toBe(true)
    if (flow.ok) {
      const codes = verifyMermaid(flow.value).warnings.filter(w => w.code === 'UNSUPPORTED_SYNTAX')
      expect(codes.some(w => 'syntax' in w && w.syntax === 'flowchart_opaque')).toBe(false)
      expect(codes.length).toBeGreaterThanOrEqual(1)
    }
    // Quadrant point-style metadata → quadrant_point_style_metadata, not
    // quadrant_opaque.
    const quad = parseMermaid('quadrantChart\n  title Q\n  x-axis Low --> High\n  A: [0.3, 0.4]:::c')
    expect(quad.ok).toBe(true)
    if (quad.ok) {
      const codes = verifyMermaid(quad.value).warnings.filter(w => w.code === 'UNSUPPORTED_SYNTAX')
      expect(codes.some(w => 'syntax' in w && w.syntax === 'quadrant_opaque')).toBe(false)
      expect(codes.some(w => 'syntax' in w && w.syntax === 'quadrant_point_style_metadata')).toBe(true)
    }
  })
})
