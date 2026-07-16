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
 *   - the agent body uses ordered typed/opaque statement segments, so entity
 *     and relation edits stay live without dropping tolerated grouping lines.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { parseErDiagram } from '../er/parser.ts'
import { parseRegisteredMermaid as parseMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
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

describe('er subgraph native rendering (#103)', () => {
  it('the upstream header-riding form renders instead of hard-failing', () => {
    const svg = renderMermaidSVG(UPSTREAM_FORM)
    expect(svg).toContain('<svg')
    expect(svg).toContain('>A<')
    expect(svg).toContain('>B<')
    expect(svg).not.toContain('width="0" height="0"')
  })

  it('body-form subgraph blocks render as semantic frames with their content', () => {
    const svg = renderMermaidSVG(BODY_FORM)
    expect(svg).toContain('CUSTOMER')
    expect(svg).toContain('ORDER')
    expect(svg).toContain('INVOICE')
    expect(svg).toContain('class="er-subgraph"')
    expect(svg).toContain('Domain')
  })

  it('direction inside a subgraph is scoped to that group and does not leak', () => {
    const d = parseErDiagram(toMermaidLines(BODY_FORM.replace('subgraph Domain', 'subgraph Domain\ndirection RL')))
    expect(d.direction).toBeUndefined()
    expect(d.groups[0]?.direction).toBe('RL')
    // top-level direction still works with subgraph blocks present
    const d2 = parseErDiagram(toMermaidLines(`erDiagram\ndirection TB\nsubgraph G\nA ||--|| B : x\nend`))
    expect(d2.direction).toBe('TB')
  })

  it('native subgraphs verify without unsupported-syntax or render-failure diagnostics', () => {
    const v = verifyMermaid(BODY_FORM)
    expect(v.warnings.some(w => w.code === 'UNSUPPORTED_SYNTAX' && (w as { syntax?: string }).syntax === 'er_subgraph')).toBe(false)
    expect(v.warnings.map(w => w.code)).not.toContain('RENDER_FAILED')
  })

  it('the legacy header-riding compatibility form remains renderable', () => {
    const v = verifyMermaid(UPSTREAM_FORM)
    expect(v.warnings.map(w => w.code)).not.toContain('RENDER_FAILED')
  })

  it('agent body models subgraph identity and ordered boundaries around typed relations', () => {
    const r = parseMermaid(BODY_FORM)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.kind).toBe('er')
    if (r.value.body.kind === 'er') {
      expect(r.value.body.groups).toEqual([{ id: 'Domain', label: 'Domain' }])
      expect(r.value.body.statements?.map(statement => statement.kind)).toEqual(['group-open', 'relation', 'group-close', 'relation'])
    }
    const canonical = serializeMermaid(r.value)
    expect(canonical).toContain('subgraph Domain')
    expect(canonical).toContain('end')
    const reparsed = parseMermaid(canonical)
    expect(reparsed.ok).toBe(true)
    if (reparsed.ok) expect(serializeMermaid(reparsed.value)).toBe(canonical)
  })
})
