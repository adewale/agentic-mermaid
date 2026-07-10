/**
 * ER subgraph-direction tolerance (repo #103, option 2 as decided there).
 *
 * Upstream's parser tolerates flowchart-style `subgraph … direction RL … end`
 * inside an erDiagram (one upstream test pins it, with the subgraph clause
 * riding the header line). This renderer used to hard-fail on the
 * header-riding form ("Invalid mermaid header") because the strict family
 * detector only accepted a bare `erDiagram` header.
 *
 * Tolerance contract:
 *   - the source parses and renders; subgraph/end lines are ignored content,
 *   - entities/relationships around (and inside) the ignored blocks render,
 *   - `direction` INSIDE a subgraph block belongs to the dropped construct
 *     and must NOT leak into the diagram-level direction,
 *   - verify announces the dropped grouping with the existing
 *     UNSUPPORTED_SYNTAX Tier-3 lint (naming the construct; suppressing the
 *     generic `er_opaque` double-flag),
 *   - the agent body stays a lossless opaque round-trip (the ER body has no
 *     statement-segment architecture to preserve structure around opaque
 *     blocks — see docs/design/families/er.md).
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { parseErDiagram } from '../er/parser.ts'
import { parseMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { toMermaidLines } from '../mermaid-source.ts'

const UPSTREAM_FORM = `erDiagram subgraph WithRL
direction RL
A
B
end`

const BODY_FORM = `erDiagram
  subgraph Domain
    CUSTOMER ||--o{ ORDER : places
  end
  ORDER ||--|| INVOICE : bills`

describe('er subgraph tolerance (#103)', () => {
  it('the upstream header-riding form renders instead of hard-failing', () => {
    const svg = renderMermaidSVG(UPSTREAM_FORM)
    expect(svg).toContain('<svg')
  })

  it('body-form subgraph blocks are ignored; content around and inside renders', () => {
    const svg = renderMermaidSVG(BODY_FORM)
    expect(svg).toContain('CUSTOMER')
    expect(svg).toContain('ORDER')
    expect(svg).toContain('INVOICE')
    expect(svg).not.toContain('Domain')
  })

  it('direction inside a subgraph block does not leak to the diagram', () => {
    const d = parseErDiagram(toMermaidLines(BODY_FORM.replace('subgraph Domain', 'subgraph Domain\ndirection RL')))
    expect(d.direction).toBeUndefined()
    // top-level direction still works with subgraph blocks present
    const d2 = parseErDiagram(toMermaidLines(`erDiagram\ndirection TB\nsubgraph G\nA ||--|| B : x\nend`))
    expect(d2.direction).toBe('TB')
  })

  it('verify emits UNSUPPORTED_SYNTAX naming the subgraph construct (no generic double-flag)', () => {
    const v = verifyMermaid(BODY_FORM)
    const unsupported = v.warnings.filter(w => w.code === 'UNSUPPORTED_SYNTAX')
    expect(unsupported.length).toBe(1)
    expect((unsupported[0] as { syntax: string }).syntax).toBe('er_subgraph')
    expect((unsupported[0] as { message: string }).message).toContain('subgraph')
  })

  it('the header-riding form also verifies with the named lint and renders clean', () => {
    const v = verifyMermaid(UPSTREAM_FORM)
    const codes = v.warnings.map(w => w.code)
    expect(codes).toContain('UNSUPPORTED_SYNTAX')
    expect(v.warnings.some(w => w.code === 'UNSUPPORTED_SYNTAX' && (w as { syntax?: string }).syntax === 'er_subgraph')).toBe(true)
    expect(codes).not.toContain('RENDER_FAILED')
  })

  it('agent body stays a lossless opaque round-trip', () => {
    const r = parseMermaid(BODY_FORM)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.kind).toBe('opaque')
    expect(serializeMermaid(r.value)).toBe(BODY_FORM + '\n')
  })
})
