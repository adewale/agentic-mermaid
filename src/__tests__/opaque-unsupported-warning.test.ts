// Systemic silent-opaque signal: a non-empty opaque body means the structured
// parser met syntax it does not model and preserved the diagram verbatim, so
// the `as*` narrower returns null and typed mutation is unavailable. Before
// this, only flowchart and quadrant announced that; the other ten families
// fell opaque silently. verify.ts now emits a generic UNSUPPORTED_SYNTAX
// (`<family>_opaque`) for any non-empty opaque body that isn't already flagged
// by a more specific warning.

import { describe, test, expect } from 'bun:test'
import { parseMermaid, verifyMermaid, serializeMermaid, renderMermaidSVG } from '../agent/index.ts'
import { WARNING_TIER, WARNING_SEVERITY } from '../agent/types.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'

// Each source is valid-enough to parse but uses a construct the structured
// parser does not model, so it lands on the opaque path.
const OPAQUE_BY_FAMILY: Record<string, string> = {
  class: 'classDiagram\n  direction LR\n  class Box', // direction remains render-only
  // Notes/pseudostates were promoted to structured (repo #118); `--`
  // concurrency regions render but keep the honest opaque agent body.
  state: 'stateDiagram-v2\n  state P {\n    a --> b\n    --\n    c --> d\n  }',
  er: 'erDiagram\n  CUSTOMER:::highlight ||--o{ ORDER : places', // styling remains typed-opaque
  xychart: 'xychart-beta\n  accTitle: forces opaque\n  bar [1, 2, 3]', // accTitle directive
  pie: 'pie\n  Dogs : 40\n  Cats : 30', // unquoted labels (Mermaid requires quotes)
  sequence: 'sequenceDiagram\n  A->>B: hi\n  end', // unmatched block terminator
  timeline: 'timeline EXTRA\n  2026 : Event', // unmodeled header suffix
  journey: 'journey EXTRA\n  Wake: 3: Me', // unmodeled header suffix
  architecture: 'architecture-beta\n  accTitle: System\n  service api(server)[API]',
  gantt: 'gantt LR\n  Task :t1, 2026-01-01, 1d', // unmodeled header suffix
}

// These fixtures are valid Mermaid syntax that the public renderer supports;
// the remaining fixtures deliberately exercise malformed/header-tolerance
// preservation and therefore are not required to render as their loose family.
const RENDERABLE_OPAQUE_FAMILIES = new Set(['class', 'state', 'er', 'xychart', 'architecture'])

describe('opaque bodies announce UNSUPPORTED_SYNTAX instead of falling silent', () => {
  test('generic plus specific warning fixtures enroll every built-in family', () => {
    const covered = [...Object.keys(OPAQUE_BY_FAMILY), 'flowchart', 'quadrant'].sort()
    expect(covered).toEqual(BUILTIN_FAMILY_METADATA.map(entry => entry.id).sort())
    expect(new Set(covered).size).toBe(covered.length)
  })

  for (const [family, source] of Object.entries(OPAQUE_BY_FAMILY)) {
    test(`${family}: unmodeled syntax → opaque body carries a <family>_opaque warning`, () => {
      const p = parseMermaid(source)
      expect(p.ok).toBe(true)
      if (!p.ok) return
      expect(p.value.body.kind).toBe('opaque')

      // Opaque is a lossless source-preservation contract, not merely a body
      // tag. Serialization may add the canonical terminal newline, but cannot
      // change any authored token; reparsing must stay opaque and idempotent.
      const canonical = serializeMermaid(p.value)
      expect(canonical).toBe(source + '\n')
      const reparsed = parseMermaid(canonical)
      expect(reparsed.ok).toBe(true)
      if (!reparsed.ok) return
      expect(reparsed.value.body.kind).toBe('opaque')
      expect(serializeMermaid(reparsed.value)).toBe(canonical)
      if (RENDERABLE_OPAQUE_FAMILIES.has(family)) {
        expect(() => renderMermaidSVG(canonical)).not.toThrow()
      }

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
